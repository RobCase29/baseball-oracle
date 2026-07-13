import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type JsonRecord = Record<string, unknown>

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const paths = {
  arrival: resolve(root, 'api/_data/research-arrival-2025.json'),
  career: resolve(root, 'api/_data/career-oracle-preview.json'),
  impact: resolve(root, 'api/_data/milb-impact-2025.json'),
  output: resolve(root, 'api/_data/artifact-status.json'),
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

async function readJson(path: string): Promise<{ body: string; value: JsonRecord }> {
  const body = await readFile(path, 'utf8')
  return { body, value: record(JSON.parse(body)) }
}

export async function exportArtifactStatus(): Promise<void> {
  const [arrivalFile, careerFile, impactFile] = await Promise.all([
    readJson(paths.arrival),
    readJson(paths.career),
    readJson(paths.impact),
  ])
  const arrival = arrivalFile.value
  const career = careerFile.value
  const impact = impactFile.value
  const careerLineage = record(career.lineage)
  const careerInputs = record(careerLineage.inputs)
  const activeRoster = record(careerInputs.activeRoster)
  const sourceManifest = record(careerLineage.sourceManifest)
  const sourceCoverage = record(sourceManifest.coverage)

  const output = {
    schemaVersion: 'artifact-status/v1',
    artifacts: {
      arrival: {
        featureAsOf: string(arrival.asOf),
        status: string(arrival.status),
        releaseEligible: boolean(arrival.releaseEligible),
        rows: number(arrival.rows),
        sha256: sha256(arrivalFile.body),
      },
      milbImpact: {
        featureAsOf: string(impact.frozenAsOf),
        sourceRunAsOf: string(impact.sourceRunAsOf),
        modelVersion: string(impact.modelVersion),
        status: string(impact.status),
        releaseEligible: boolean(impact.releaseEligible),
        rows: number(impact.universeRows),
        sha256: sha256(impactFile.body),
      },
      career: {
        rosterAsOf: string(activeRoster.knownAtLast),
        artifactAsOf: string(career.asOf),
        latestCompleteFeatureSeason: number(sourceCoverage.latestCompleteSeason),
        modelVersion: string(career.modelVersion),
        targetVersion: string(career.targetVersion),
        status: string(career.status),
        releaseEligible: boolean(career.releaseEligible),
        players: Array.isArray(career.players) ? career.players.length : null,
        sha256: sha256(careerFile.body),
      },
    },
  }

  await writeFile(paths.output, `${JSON.stringify(output)}\n`, 'utf8')
}

await exportArtifactStatus()
