import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const schemaVersion = 'fangraphs-completed-season-exact-identity-bridge/v1'
const identityPolicy = 'exact_fangraphs_upid_minor_master_to_mlbam_no_name_matching'
const outputPath = resolve(
  'data/reference-locks/fangraphs-completed-season-exact-identity-bridge-2026.json',
)
const sourceLockPath = resolve('data/source-lock.json')

type SourceRole = 'Hitter' | 'Pitcher'

interface SourceLock {
  updatedAt: string
  sources: {
    'fangraphs-prospect-board': {
      resources: Record<string, {
        bytes: number
        sha256: string
        url: string
      }>
    }
  }
}

interface SourceRecord extends Record<string, unknown> {}

interface SourceEnvelope {
  dataScout: SourceRecord[]
  dataStats: SourceRecord[]
}

export interface CompletedSeasonIdentityRecord {
  fangraphsId: string
  minorMasterId: string
  mlbamId: number
  scoutRecordSha256: string
  sourceKey: string
  sourceRole: SourceRole
  statsAge: number | null
  statsIp: number | null
  statsLevel: string | null
  statsPa: number | null
  statsRecordSha256: string
  statsSeason: number
}

export interface CompletedSeasonIdentityBridge {
  boardEdition: number
  identityPolicy: typeof identityPolicy
  lockedAt: string
  records: CompletedSeasonIdentityRecord[]
  recordsSha256: string
  schemaVersion: typeof schemaVersion
  sourceLocks: Array<{
    bytes: number
    path: string
    sha256: string
    sourceKey: string
    sourceRole: SourceRole
    url: string
  }>
  statsSeason: number
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).toSorted().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(record[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function identifier(record: SourceRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() && value.trim() !== '0') {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return String(value)
    }
  }
  return null
}

function finiteNumber(record: SourceRecord, key: string): number | null {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function exactTuple(record: SourceRecord): [string | null, string | null] {
  return [
    identifier(record, 'UPID', 'playerids', 'PlayerId'),
    identifier(record, 'minormasterid', 'minorMasterId'),
  ]
}

export async function buildCompletedSeasonIdentityBridge(): Promise<CompletedSeasonIdentityBridge> {
  const sourceLock = JSON.parse(await readFile(sourceLockPath, 'utf8')) as SourceLock
  const sourceResources = sourceLock.sources['fangraphs-prospect-board'].resources
  const envelopes = new Map<string, SourceEnvelope>()
  const sourceLocks: CompletedSeasonIdentityBridge['sourceLocks'] = []

  for (const [sourceKey, sourceRole] of [
    ['2026-bat.json', 'Hitter'],
    ['2026-pit.json', 'Pitcher'],
  ] as const) {
    const path = `data/raw/fangraphs-prospect-board/2017-2026-editions/${sourceKey}`
    const body = await readFile(resolve(path))
    const lock = sourceResources[sourceKey]
    if (!lock || sha256(body) !== lock.sha256 || body.byteLength !== lock.bytes) {
      throw new Error(`FanGraphs source lock mismatch for ${sourceKey}`)
    }
    const envelope = JSON.parse(body.toString('utf8')) as SourceEnvelope
    if (!Array.isArray(envelope.dataScout) || !Array.isArray(envelope.dataStats)) {
      throw new Error(`Invalid FanGraphs source envelope for ${sourceKey}`)
    }
    envelopes.set(sourceKey, envelope)
    sourceLocks.push({ sourceKey, sourceRole, path, ...lock })
  }

  const records = sourceLocks.flatMap((source): CompletedSeasonIdentityRecord[] => {
    const envelope = envelopes.get(source.sourceKey)
    if (!envelope) throw new Error(`Missing source envelope for ${source.sourceKey}`)
    const scoutsByTuple = new Map<string, SourceRecord[]>()
    for (const scout of envelope.dataScout) {
      const [fangraphsId, minorMasterId] = exactTuple(scout)
      if (!fangraphsId || !minorMasterId) continue
      const key = `${fangraphsId}\u0000${minorMasterId}`
      const rows = scoutsByTuple.get(key) ?? []
      rows.push(scout)
      scoutsByTuple.set(key, rows)
    }

    return envelope.dataStats.flatMap((stats): CompletedSeasonIdentityRecord[] => {
      const [fangraphsId, minorMasterId] = exactTuple(stats)
      const mlbamId = finiteNumber(stats, 'xMLBAMID')
      if (!fangraphsId || !minorMasterId || !mlbamId) return []
      const scoutRows = scoutsByTuple.get(`${fangraphsId}\u0000${minorMasterId}`) ?? []
      if (scoutRows.length === 0) return []
      if (scoutRows.length !== 1) {
        throw new Error(`Conflicting scout tuple ${fangraphsId}/${minorMasterId}`)
      }
      const statsSeason = finiteNumber(stats, 'Season')
      if (statsSeason !== 2025 || !Number.isSafeInteger(mlbamId)) {
        throw new Error(`Invalid exact stat identity for ${fangraphsId}/${minorMasterId}`)
      }
      const scout = scoutRows[0]!
      return [{
        sourceRole: source.sourceRole,
        sourceKey: source.sourceKey,
        fangraphsId,
        minorMasterId,
        mlbamId,
        statsSeason,
        statsLevel: identifier(stats, 'level'),
        statsPa: finiteNumber(stats, 'PA'),
        statsIp: finiteNumber(stats, 'IP'),
        statsAge: finiteNumber(stats, 'Age'),
        scoutRecordSha256: sha256(stableStringify(scout)),
        statsRecordSha256: sha256(stableStringify(stats)),
      }]
    })
  }).toSorted((left, right) => (
    left.sourceRole.localeCompare(right.sourceRole) ||
    left.fangraphsId.localeCompare(right.fangraphsId)
  ))

  const tupleKeys = new Set(records.map((record) => (
    `${record.sourceRole}\u0000${record.fangraphsId}\u0000${record.minorMasterId}`
  )))
  const mlbamPersonTuples = new Map<number, Set<string>>()
  const personTupleMlbams = new Map<string, Set<number>>()
  for (const record of records) {
    const personTuple = `${record.fangraphsId}\u0000${record.minorMasterId}`
    const tuples = mlbamPersonTuples.get(record.mlbamId) ?? new Set<string>()
    tuples.add(personTuple)
    mlbamPersonTuples.set(record.mlbamId, tuples)
    const mlbamIds = personTupleMlbams.get(personTuple) ?? new Set<number>()
    mlbamIds.add(record.mlbamId)
    personTupleMlbams.set(personTuple, mlbamIds)
  }
  if (
    tupleKeys.size !== records.length ||
    [...mlbamPersonTuples.values()].some((tuples) => tuples.size !== 1) ||
    [...personTupleMlbams.values()].some((mlbamIds) => mlbamIds.size !== 1)
  ) {
    throw new Error('Completed-season identity bridge contains an identity conflict')
  }

  return {
    schemaVersion,
    identityPolicy,
    boardEdition: 2026,
    statsSeason: 2025,
    lockedAt: sourceLock.updatedAt,
    sourceLocks,
    records,
    recordsSha256: sha256(stableStringify(records)),
  }
}

async function run(): Promise<void> {
  const bridge = await buildCompletedSeasonIdentityBridge()
  const body = `${JSON.stringify(bridge, null, 2)}\n`
  if (process.argv.includes('--check')) {
    const existing = await readFile(outputPath, 'utf8')
    if (existing !== body) throw new Error('Committed completed-season identity bridge is stale')
    process.stdout.write(`Verified ${bridge.records.length} exact identity records\n`)
    return
  }
  await writeFile(outputPath, body)
  process.stdout.write(`Wrote ${bridge.records.length} exact identity records\n`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  run().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unknown error'}\n`)
    process.exitCode = 1
  })
}
