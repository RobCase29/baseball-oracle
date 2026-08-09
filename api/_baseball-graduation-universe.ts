import { createHash } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import {
  loadCareerOraclePreview,
} from './_career-oracle-preview.js'
import {
  requireMlbIdentityCrosswalk,
} from './_mlb-identity-crosswalk.js'
import {
  attachBinderScores,
  dedupeMinorCandidates,
  frozenProspectRankUniverse,
  mergeCurrentUniverse,
  minorCandidates,
  mlbCandidates,
  scoredMlbUniverse,
  type MinorCandidateRow,
  type UnifiedBoardCandidate,
} from './players.js'

export interface BaseballGraduationUniverse {
  candidates: UnifiedBoardCandidate[]
  modelDataAsOf: string
  directoryDataAsOf: string | null
  previewGeneratedAt: string
  prospectDirectoryIncluded: boolean
  snapshotId: string
}

const UNIVERSE_CACHE_MS = 5 * 60 * 1_000
let cachedUniverse: {
  databaseUrl: string
  expiresAt: number
  value: BaseballGraduationUniverse
} | null = null
let pendingUniverse: {
  databaseUrl: string
  promise: Promise<BaseballGraduationUniverse>
} | null = null

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null
}

export function buildBaseballGraduationUniverseFromRows(
  rows: MinorCandidateRow[],
  now = new Date(),
): BaseballGraduationUniverse {
  const preview = loadCareerOraclePreview()
  if (!preview) {
    throw new Error('Career Oracle preview is unavailable')
  }
  const identityCrosswalk = requireMlbIdentityCrosswalk()
  const mlb = mlbCandidates(preview, identityCrosswalk)
  const minorBuild = minorCandidates(rows, preview, identityCrosswalk)
  const minors = dedupeMinorCandidates(minorBuild.items).items
  const merged = mergeCurrentUniverse(mlb, minors)
  const candidates = attachBinderScores(merged.items, {
    mlbUniverse: scoredMlbUniverse(mlb),
    minorUniverse: frozenProspectRankUniverse(preview),
  }, now)
  // Individual career feature dates can be older when a rostered player did
  // not appear recently. Source freshness belongs to the current model
  // snapshot, not the oldest player's last appearance.
  const modelDataAsOf = preview.asOf
  const directoryDates = rows
    .map((row) => isoDate(row.known_at))
    .filter((value): value is string => value !== null)
    .toSorted()
  const directoryDataAsOf = directoryDates.at(-1) ?? null
  const snapshotId = `baseball-graduation-universe/v1:${
    createHash('sha256').update(JSON.stringify({
      previewDataVersion: preview.dataVersion,
      previewGeneratedAt: preview.asOf,
      modelDataAsOf,
      directoryDataAsOf,
      prospectDirectoryIncluded: rows.length > 0,
      candidates: candidates.map((candidate) => [
        candidate.id,
        candidate.source,
        candidate.mlbamId,
        candidate.stage,
        candidate.age,
        candidate.binderScore?.components.baseballThesis.score ?? null,
      ]),
    })).digest('hex')
  }`
  return {
    candidates,
    modelDataAsOf,
    directoryDataAsOf,
    previewGeneratedAt: preview.asOf,
    prospectDirectoryIncluded: rows.length > 0,
    snapshotId,
  }
}

export async function loadBaseballGraduationUniverse(
  now = new Date(),
  databaseUrl =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
): Promise<BaseballGraduationUniverse> {
  if (!databaseUrl) {
    throw new Error(
      'Baseball prospect directory is unavailable; unified ranking withheld',
    )
  }
  if (
    cachedUniverse?.databaseUrl === databaseUrl &&
    cachedUniverse.expiresAt > now.valueOf()
  ) {
    return cachedUniverse.value
  }
  if (pendingUniverse?.databaseUrl === databaseUrl) {
    return pendingUniverse.promise
  }
  const promise = (async () => {
    const sql = neon(databaseUrl)
    const result = await sql`
      SELECT
        profile_id,
        source_player_id,
        player_type,
        display_name,
        organization_code,
        organization_name,
        position,
        age,
        level,
        season,
        mlbam_id,
        known_at::text AS known_at,
        pa,
        ip,
        pitches
      FROM app.player_directory_snapshot
    `
    const rows = result as unknown as MinorCandidateRow[]
    if (rows.length === 0) {
      throw new Error(
        'Baseball prospect directory is empty; unified ranking withheld',
      )
    }
    const value = buildBaseballGraduationUniverseFromRows(rows, now)
    cachedUniverse = {
      databaseUrl,
      expiresAt: now.valueOf() + UNIVERSE_CACHE_MS,
      value,
    }
    return value
  })()
  pendingUniverse = { databaseUrl, promise }
  try {
    return await promise
  } finally {
    if (pendingUniverse?.promise === promise) pendingUniverse = null
  }
}
