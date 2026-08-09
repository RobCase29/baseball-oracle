import { createHash } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { normalizeHobbyPlayerName } from '../../src/domain/hobbyPlayerRanking.js'

const schemaVersion = 'backstop-hobby-player-signals.v2'
const contractVersion = '2.0.0'
const defaultSource = resolve(
  '../Checklist.BackstopCards.com/data/oracle/hobby-player-signals.v2.json',
)
const defaultOutput = resolve(
  'api/_data/checklist-hobby-player-signals.json',
)
const sha256Pattern = /^[a-f0-9]{64}$/u

interface ExchangeSource {
  sourceId: string
  provider: string
  sport: 'football' | 'basketball'
  snapshotSha256: string
  sourceUrl: string
  rights: {
    trainingAllowed: false
    rawSourceRedistributionAllowed: false
  }
}

interface ExchangeRow {
  sourceId: string
  sport: 'football' | 'basketball'
  providerPlayerId: string
  sourceDisplayName: string
  normalizedName: string
  careerStartYear: number | null
}

interface ExchangeArtifact {
  schemaVersion: typeof schemaVersion
  contractVersion: typeof contractVersion
  generatedAt: string
  counts: {
    publishedRows: number
    bySport: {
      football: number
      basketball: number
    }
  }
  sources: ExchangeSource[]
  rows: ExchangeRow[]
  quarantine: unknown[]
  contentSha256: string
  [key: string]: unknown
}

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function contentHash(value: ExchangeArtifact): string {
  const { contentSha256: _contentSha256, ...body } = value
  return createHash('sha256').update(stableJson(body)).digest('hex')
}

function validCareerStartYear(value: unknown): value is number | null {
  return value === null || (
    Number.isSafeInteger(value) &&
    (value as number) >= 1900 &&
    (value as number) <= 2200
  )
}

function parseArtifact(source: string): ExchangeArtifact {
  const value = JSON.parse(source) as unknown
  if (!isRecord(value)) {
    throw new Error('Checklist player-signal exchange must be an object')
  }
  const artifact = value as unknown as ExchangeArtifact
  if (
    artifact.schemaVersion !== schemaVersion ||
    artifact.contractVersion !== contractVersion ||
    !Number.isFinite(Date.parse(artifact.generatedAt)) ||
    !isRecord(artifact.counts) ||
    !isRecord(artifact.counts.bySport) ||
    !Array.isArray(artifact.sources) ||
    artifact.sources.length !== 2 ||
    !Array.isArray(artifact.rows) ||
    artifact.rows.length < 800 ||
    !Array.isArray(artifact.quarantine) ||
    !sha256Pattern.test(artifact.contentSha256)
  ) {
    throw new Error('Checklist player-signal exchange failed its import contract')
  }
  if (
    artifact.counts.publishedRows !== artifact.rows.length ||
    artifact.counts.bySport.football !==
      artifact.rows.filter((row) => row.sport === 'football').length ||
    artifact.counts.bySport.basketball !==
      artifact.rows.filter((row) => row.sport === 'basketball').length
  ) {
    throw new Error('Checklist player-signal exchange counts do not reconcile')
  }
  if (
    artifact.sources.some((entry) => (
      !sha256Pattern.test(entry.snapshotSha256) ||
      !['football', 'basketball'].includes(entry.sport) ||
      entry.rights?.trainingAllowed !== false ||
      entry.rights?.rawSourceRedistributionAllowed !== false
    ))
  ) {
    throw new Error('Checklist player-signal exchange source boundary changed')
  }
  const sourceIds = new Set(artifact.sources.map((entry) => entry.sourceId))
  const identities = new Set<string>()
  for (const row of artifact.rows) {
    const identity = `${row.sourceId}:${row.providerPlayerId}`
    if (
      !sourceIds.has(row.sourceId) ||
      !['football', 'basketball'].includes(row.sport) ||
      !row.providerPlayerId ||
      !row.sourceDisplayName ||
      row.normalizedName !== normalizeHobbyPlayerName(row.sourceDisplayName) ||
      !Object.prototype.hasOwnProperty.call(row, 'careerStartYear') ||
      !validCareerStartYear(row.careerStartYear) ||
      (row.sport === 'basketball' && row.careerStartYear !== null) ||
      identities.has(identity)
    ) {
      throw new Error(
        `Checklist player-signal row failed contract validation: ${identity}`,
      )
    }
    identities.add(identity)
  }
  if (contentHash(artifact) !== artifact.contentSha256) {
    throw new Error('Checklist player-signal exchange content hash mismatch')
  }
  return artifact
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(temporary, contents)
    await rename(temporary, filePath)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {}
    throw error
  }
}

const sourcePath = resolve(argumentValue('--source') ?? defaultSource)
const outputPath = resolve(argumentValue('--output') ?? defaultOutput)
const source = await readFile(sourcePath, 'utf8')
const artifact = parseArtifact(source)

if (process.argv.includes('--check')) {
  const current = parseArtifact(await readFile(outputPath, 'utf8'))
  if (current.contentSha256 !== artifact.contentSha256) {
    throw new Error(
      'Committed Hobby Oracle player-signal exchange is not current',
    )
  }
} else {
  await atomicWrite(outputPath, source.endsWith('\n') ? source : `${source}\n`)
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: process.argv.includes('--check') ? 'check' : 'import',
  schemaVersion: artifact.schemaVersion,
  contractVersion: artifact.contractVersion,
  contentSha256: artifact.contentSha256,
  rows: artifact.rows.length,
  football: artifact.counts.bySport.football,
  basketball: artifact.counts.bySport.basketball,
})}\n`)
