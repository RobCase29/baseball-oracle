import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'

const chadwickVersion = '7e23e7dfaff51b3ae72c16393703eda7e5ecad27'
const expectedShardNames = Array.from(
  { length: 16 },
  (_, index) => `people-${index.toString(16)}.csv`,
)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const positiveIntegerSchema = z.number().int().positive()
const seasonSchema = z.number().int().min(1871).max(2100)
const bbrefSchema = z.string().min(1).regex(/^[a-z0-9_'.]+$/u)

const sourceFileSchema = z.object({
  path: z.string().min(1),
  sha256: sha256Schema,
  bytes: positiveIntegerSchema,
}).strict()

const compactRecordSchema = z.tuple([
  positiveIntegerSchema,
  bbrefSchema.nullable(),
  seasonSchema.nullable(),
  seasonSchema.nullable(),
  z.enum(['bref', 'chadwick']).nullable(),
])

const artifactSchema = z.object({
  schemaVersion: z.literal('mlb-identity-crosswalk/v1'),
  asOf: z.iso.datetime({ offset: true }),
  identityPolicy: z.literal('exact_mlbam_bbref_only_no_name_matching'),
  recordCount: positiveIntegerSchema,
  coverage: z.object({
    recordsWithBbref: z.number().int().nonnegative(),
    baseballReferenceSeasonEvidence: z.number().int().nonnegative(),
    chadwickSeasonEvidence: z.number().int().nonnegative(),
    crosswalkOnly: z.number().int().nonnegative(),
  }).strict(),
  source: z.object({
    chadwickRegister: z.object({
      version: z.literal(chadwickVersion),
      sourceLockPath: z.literal('data/source-lock.json'),
      sourceLockSha256: sha256Schema,
      shards: z.array(sourceFileSchema).length(16),
    }).strict(),
    baseballReferencePlayerSeasons: sourceFileSchema.extend({
      rows: positiveIntegerSchema,
      manifestPath: z.literal('data/processed/baseball-reference-mlb-war/manifest.json'),
      manifestSha256: sha256Schema,
      referenceLockPath: z.literal('data/reference-locks/baseball-reference-mlb-war.json'),
      referenceLockSha256: sha256Schema,
      generatedAt: z.iso.datetime({ offset: true }),
    }).strict(),
  }).strict(),
  recordShape: z.tuple([
    z.literal('mlbam'),
    z.literal('bbref'),
    z.literal('firstMlbSeason'),
    z.literal('lastMlbSeason'),
    z.literal('seasonEvidence'),
  ]),
  records: z.array(compactRecordSchema).min(1),
}).strict()

type CompactIdentityRecord = z.infer<typeof compactRecordSchema>
export type MlbSeasonEvidence = 'baseball-reference-player-seasons' | 'chadwick-register'

export interface MlbIdentityRecord {
  mlbam: number
  bbref: string | null
  firstMlbSeason: number | null
  lastMlbSeason: number | null
  seasonEvidence: MlbSeasonEvidence | null
}

export interface MlbIdentityCrosswalkSummary {
  schemaVersion: 'mlb-identity-crosswalk/v1'
  asOf: string
  identityPolicy: 'exact_mlbam_bbref_only_no_name_matching'
  recordCount: number
  coverage: {
    recordsWithBbref: number
    baseballReferenceSeasonEvidence: number
    chadwickSeasonEvidence: number
    crosswalkOnly: number
  }
  source: z.infer<typeof artifactSchema>['source']
}

export interface MlbIdentityCrosswalk {
  summary: MlbIdentityCrosswalkSummary
  byMlbam(value: bigint | number | string | null): MlbIdentityRecord | null
  byBbref(value: string | null): MlbIdentityRecord | null
}

const defaultCrosswalkPath = new URL('./_data/mlb-identity-crosswalk.json', import.meta.url)
let cachedDefaultCrosswalk: MlbIdentityCrosswalk | undefined

function seasonEvidence(code: CompactIdentityRecord[4]): MlbSeasonEvidence | null {
  if (code === 'bref') return 'baseball-reference-player-seasons'
  if (code === 'chadwick') return 'chadwick-register'
  return null
}

function expandRecord(record: CompactIdentityRecord): MlbIdentityRecord {
  return {
    mlbam: record[0],
    bbref: record[1],
    firstMlbSeason: record[2],
    lastMlbSeason: record[3],
    seasonEvidence: seasonEvidence(record[4]),
  }
}

function mlbamKey(value: bigint | number | string | null): string | null {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  return typeof value === 'string' && /^[1-9]\d*$/u.test(value) ? value : null
}

function bbrefKey(value: string | null): string | null {
  return typeof value === 'string' && /^[a-z0-9_'.]+$/u.test(value) ? value : null
}

export function validateMlbIdentityCrosswalkArtifact(value: unknown) {
  const artifact = artifactSchema.parse(value)
  if (artifact.records.length !== artifact.recordCount) {
    throw new Error('MLB identity record count does not match the artifact')
  }
  if (artifact.asOf !== artifact.source.baseballReferencePlayerSeasons.generatedAt) {
    throw new Error('MLB identity as-of timestamp must match its Baseball-Reference lock')
  }

  const shardNames = artifact.source.chadwickRegister.shards.map((entry) => (
    entry.path.split('/').at(-1)
  ))
  if (shardNames.some((name, index) => name !== expectedShardNames[index])) {
    throw new Error('MLB identity artifact does not contain the ordered pinned Chadwick shards')
  }

  const mlbamIds = new Set<number>()
  const bbrefIds = new Set<string>()
  let priorMlbam = 0
  let recordsWithBbref = 0
  let baseballReferenceSeasonEvidence = 0
  let chadwickSeasonEvidence = 0
  let crosswalkOnly = 0
  for (const record of artifact.records) {
    const [mlbam, bbref, firstMlbSeason, lastMlbSeason, evidence] = record
    if (mlbam <= priorMlbam) {
      throw new Error('MLB identity records must be unique and ordered by MLBAM')
    }
    priorMlbam = mlbam
    if (mlbamIds.has(mlbam)) throw new Error(`Duplicate MLBAM identity: ${mlbam}`)
    mlbamIds.add(mlbam)
    if (bbref !== null) {
      if (bbrefIds.has(bbref)) throw new Error(`Duplicate BRef identity: ${bbref}`)
      bbrefIds.add(bbref)
      recordsWithBbref += 1
    }

    if ((firstMlbSeason === null) !== (lastMlbSeason === null)) {
      throw new Error(`Incomplete MLB season span for MLBAM ${mlbam}`)
    }
    if (firstMlbSeason !== null && firstMlbSeason > lastMlbSeason!) {
      throw new Error(`Reversed MLB season span for MLBAM ${mlbam}`)
    }
    if ((firstMlbSeason === null) !== (evidence === null)) {
      throw new Error(`MLB season evidence is inconsistent for MLBAM ${mlbam}`)
    }
    if (evidence === 'bref' && bbref === null) {
      throw new Error(`Baseball-Reference evidence requires a BRef ID for MLBAM ${mlbam}`)
    }
    if (bbref === null && evidence !== 'chadwick') {
      throw new Error(`MLBAM-only identities require Chadwick debut evidence: ${mlbam}`)
    }
    if (evidence === 'bref') baseballReferenceSeasonEvidence += 1
    else if (evidence === 'chadwick') chadwickSeasonEvidence += 1
    else crosswalkOnly += 1
  }

  const computedCoverage = {
    recordsWithBbref,
    baseballReferenceSeasonEvidence,
    chadwickSeasonEvidence,
    crosswalkOnly,
  }
  if (Object.entries(computedCoverage).some(
    ([key, count]) => artifact.coverage[key as keyof typeof computedCoverage] !== count,
  )) {
    throw new Error('MLB identity coverage counts do not match the records')
  }
  return artifact
}

function buildLookup(value: unknown): MlbIdentityCrosswalk {
  const artifact = validateMlbIdentityCrosswalkArtifact(value)
  const byMlbam = new Map<string, CompactIdentityRecord>()
  const byBbref = new Map<string, CompactIdentityRecord>()
  for (const record of artifact.records) {
    byMlbam.set(String(record[0]), record)
    if (record[1] !== null) byBbref.set(record[1], record)
  }
  const summary: MlbIdentityCrosswalkSummary = {
    schemaVersion: artifact.schemaVersion,
    asOf: artifact.asOf,
    identityPolicy: artifact.identityPolicy,
    recordCount: artifact.recordCount,
    coverage: { ...artifact.coverage },
    source: artifact.source,
  }
  return {
    summary,
    byMlbam(value) {
      const key = mlbamKey(value)
      const record = key === null ? undefined : byMlbam.get(key)
      return record ? expandRecord(record) : null
    },
    byBbref(value) {
      const key = bbrefKey(value)
      const record = key === null ? undefined : byBbref.get(key)
      return record ? expandRecord(record) : null
    },
  }
}

export function loadMlbIdentityCrosswalk(
  path: URL | string = defaultCrosswalkPath,
): MlbIdentityCrosswalk | null {
  const isDefaultPath = path === defaultCrosswalkPath ||
    (path instanceof URL && path.href === defaultCrosswalkPath.href)
  if (isDefaultPath && cachedDefaultCrosswalk !== undefined) return cachedDefaultCrosswalk
  if (!existsSync(path)) return null
  try {
    const lookup = buildLookup(JSON.parse(readFileSync(path, 'utf8')) as unknown)
    if (isDefaultPath) cachedDefaultCrosswalk = lookup
    return lookup
  } catch (error) {
    console.error('MLB identity crosswalk artifact is invalid', error)
    return null
  }
}

export function requireMlbIdentityCrosswalk(): MlbIdentityCrosswalk {
  const crosswalk = loadMlbIdentityCrosswalk()
  if (!crosswalk) throw new Error('The MLB identity crosswalk is unavailable or invalid')
  return crosswalk
}
