import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'

const chadwickVersion = '7e23e7dfaff51b3ae72c16393703eda7e5ecad27'
const expectedShardNames = Array.from(
  { length: 16 },
  (_, index) => `people-${index.toString(16)}.csv`,
)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const keyPersonSchema = z.string().regex(/^[0-9a-f]{8}$/u)
const mlbamSchema = z.number().int().positive()

const sourceFileSchema = z.object({
  path: z.string().min(1),
  sha256: sha256Schema,
  bytes: z.number().int().positive(),
}).strict()

const recordSchema = z.tuple([keyPersonSchema, mlbamSchema])

const artifactSchema = z.object({
  schemaVersion: z.literal('chadwick-key-mlbam/v1'),
  asOf: z.iso.datetime({ offset: true }),
  identityPolicy: z.literal(
    'exact_chadwick_key_person_to_mlbam_no_name_matching',
  ),
  recordCount: z.number().int().positive(),
  source: z.object({
    chadwickRegister: z.object({
      version: z.literal(chadwickVersion),
      sourceLockPath: z.literal('data/source-lock.json'),
      sourceLockSha256: sha256Schema,
      shards: z.array(sourceFileSchema).length(16),
    }).strict(),
  }).strict(),
  recordShape: z.tuple([
    z.literal('keyPerson'),
    z.literal('mlbam'),
  ]),
  records: z.array(recordSchema).min(1),
}).strict()

export interface ChadwickKeyMlbamSummary {
  schemaVersion: 'chadwick-key-mlbam/v1'
  asOf: string
  identityPolicy: 'exact_chadwick_key_person_to_mlbam_no_name_matching'
  recordCount: number
  source: z.infer<typeof artifactSchema>['source']
}

export interface ChadwickKeyMlbamLookup {
  summary: ChadwickKeyMlbamSummary
  byKeyPerson(value: string | null): number | null
  keyPersonByMlbam(value: bigint | number | string | null): string | null
}

const defaultLookupPath = new URL('./_data/chadwick-key-mlbam.json', import.meta.url)
let cachedDefaultLookup: ChadwickKeyMlbamLookup | undefined

export function validateChadwickKeyMlbamArtifact(value: unknown) {
  const artifact = artifactSchema.parse(value)
  if (artifact.records.length !== artifact.recordCount) {
    throw new Error('Chadwick key/MLBAM record count does not match the artifact')
  }
  const shardNames = artifact.source.chadwickRegister.shards.map((entry) => (
    entry.path.split('/').at(-1)
  ))
  if (shardNames.some((name, index) => name !== expectedShardNames[index])) {
    throw new Error('Chadwick key/MLBAM artifact has unexpected pinned shards')
  }

  const mlbamIds = new Set<number>()
  let priorKey = ''
  for (const [keyPerson, mlbam] of artifact.records) {
    if (keyPerson <= priorKey) {
      throw new Error('Chadwick key/MLBAM records must be unique and ordered by key_person')
    }
    priorKey = keyPerson
    if (mlbamIds.has(mlbam)) {
      throw new Error(`Duplicate MLBAM in Chadwick key lookup: ${mlbam}`)
    }
    mlbamIds.add(mlbam)
  }
  return artifact
}

function buildLookup(value: unknown): ChadwickKeyMlbamLookup {
  const artifact = validateChadwickKeyMlbamArtifact(value)
  const records = new Map<string, number>(artifact.records)
  const keysByMlbam = new Map<string, string>(
    artifact.records.map(([keyPerson, mlbam]) => [String(mlbam), keyPerson]),
  )
  return {
    summary: {
      schemaVersion: artifact.schemaVersion,
      asOf: artifact.asOf,
      identityPolicy: artifact.identityPolicy,
      recordCount: artifact.recordCount,
      source: artifact.source,
    },
    byKeyPerson(value) {
      if (typeof value !== 'string' || !/^[0-9a-f]{8}$/u.test(value)) return null
      return records.get(value) ?? null
    },
    keyPersonByMlbam(value) {
      const key = typeof value === 'bigint'
        ? (value > 0n ? value.toString() : null)
        : typeof value === 'number'
          ? (Number.isSafeInteger(value) && value > 0 ? String(value) : null)
          : typeof value === 'string' && /^[1-9]\d*$/u.test(value)
            ? value
            : null
      return key === null ? null : (keysByMlbam.get(key) ?? null)
    },
  }
}

export function loadChadwickKeyMlbamLookup(
  path: URL | string = defaultLookupPath,
): ChadwickKeyMlbamLookup | null {
  const isDefaultPath = path === defaultLookupPath ||
    (path instanceof URL && path.href === defaultLookupPath.href)
  if (isDefaultPath && cachedDefaultLookup !== undefined) return cachedDefaultLookup
  if (!existsSync(path)) return null
  try {
    const lookup = buildLookup(JSON.parse(readFileSync(path, 'utf8')) as unknown)
    if (isDefaultPath) cachedDefaultLookup = lookup
    return lookup
  } catch (error) {
    console.error('Chadwick key/MLBAM artifact is invalid', error)
    return null
  }
}

export function requireChadwickKeyMlbamLookup(): ChadwickKeyMlbamLookup {
  const lookup = loadChadwickKeyMlbamLookup()
  if (!lookup) throw new Error('The pinned Chadwick key/MLBAM lookup is unavailable')
  return lookup
}
