import type {
  MlbIdentityCrosswalk,
  MlbIdentityRecord,
} from './_mlb-identity-crosswalk.js'

export interface MlbIdentityOverlayRow {
  bbref_id: string
  chadwick_key: string
  mlbam_id: bigint | number | string
  first_mlb_season: bigint | number | string
  first_observed_at?: string | null
  last_observed_at?: string | null
}

export interface MlbIdentityOverlayConflict {
  bbrefId: string
  chadwickKey: string
  mlbamId: number | null
  reason:
    | 'invalid_overlay_row'
    | 'duplicate_bbref'
    | 'duplicate_chadwick'
    | 'duplicate_mlbam'
    | 'unknown_chadwick'
    | 'chadwick_mlbam_conflict'
    | 'static_bbref_conflict'
    | 'static_mlbam_conflict'
}

export interface ComposedMlbIdentityCrosswalk {
  crosswalk: MlbIdentityCrosswalk
  overlay: {
    acceptedRecords: number
    conflicts: MlbIdentityOverlayConflict[]
    newestObservedAt: string | null
  }
}

const bbrefPattern = /^[a-z0-9_'.]+$/u
const chadwickPattern = /^[0-9a-f]{8}$/u

export interface ChadwickMlbamResolver {
  byKeyPerson(value: string | null): number | null
}

function positiveInteger(value: bigint | number | string): number | null {
  if (typeof value === 'bigint') {
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (!/^[1-9]\d*$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function season(value: bigint | number | string): number | null {
  const parsed = positiveInteger(value)
  return parsed !== null && parsed >= 1871 && parsed <= 2100 ? parsed : null
}

function newestIso(rows: readonly MlbIdentityOverlayRow[]): string | null {
  const timestamps = rows
    .flatMap((row) => [row.first_observed_at, row.last_observed_at])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
  return timestamps.length === 0 ? null : new Date(Math.max(...timestamps)).toISOString()
}

function validEvidenceTimestamp(value: string | null | undefined): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function composeMlbIdentityCrosswalk(
  staticCrosswalk: MlbIdentityCrosswalk,
  rows: readonly MlbIdentityOverlayRow[],
  chadwickLookup: ChadwickMlbamResolver,
): ComposedMlbIdentityCrosswalk {
  const acceptedByBbref = new Map<string, MlbIdentityRecord>()
  const acceptedByChadwick = new Map<string, MlbIdentityRecord>()
  const acceptedByMlbam = new Map<number, MlbIdentityRecord>()
  const acceptedRows: MlbIdentityOverlayRow[] = []
  const conflicts: MlbIdentityOverlayConflict[] = []

  for (const row of rows) {
    const bbrefId = row.bbref_id
    const chadwickKey = row.chadwick_key
    const mlbamId = positiveInteger(row.mlbam_id)
    const firstMlbSeason = season(row.first_mlb_season)
    if (
      !bbrefPattern.test(bbrefId) ||
      !chadwickPattern.test(chadwickKey) ||
      mlbamId === null ||
      firstMlbSeason === null ||
      !validEvidenceTimestamp(row.first_observed_at) ||
      !validEvidenceTimestamp(row.last_observed_at)
    ) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'invalid_overlay_row',
      })
      continue
    }

    const chadwickMlbamId = chadwickLookup.byKeyPerson(chadwickKey)
    if (chadwickMlbamId === null) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'unknown_chadwick',
      })
      continue
    }
    if (chadwickMlbamId !== mlbamId) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'chadwick_mlbam_conflict',
      })
      continue
    }

    const staticByBbref = staticCrosswalk.byBbref(bbrefId)
    if (staticByBbref !== null && staticByBbref.mlbam !== mlbamId) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'static_bbref_conflict',
      })
      continue
    }
    const staticByMlbam = staticCrosswalk.byMlbam(mlbamId)
    if (
      staticByMlbam !== null &&
      staticByMlbam.bbref !== null &&
      staticByMlbam.bbref !== bbrefId
    ) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'static_mlbam_conflict',
      })
      continue
    }
    if (acceptedByBbref.has(bbrefId)) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'duplicate_bbref',
      })
      continue
    }
    if (acceptedByChadwick.has(chadwickKey)) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'duplicate_chadwick',
      })
      continue
    }
    if (acceptedByMlbam.has(mlbamId)) {
      conflicts.push({
        bbrefId,
        chadwickKey,
        mlbamId,
        reason: 'duplicate_mlbam',
      })
      continue
    }

    const staticSeasonRecord = staticByBbref ?? staticByMlbam
    const record: MlbIdentityRecord = staticSeasonRecord?.firstMlbSeason !== null &&
      staticSeasonRecord?.firstMlbSeason !== undefined
      ? { ...staticSeasonRecord, bbref: bbrefId }
      : {
          mlbam: mlbamId,
          bbref: bbrefId,
          firstMlbSeason,
          lastMlbSeason: firstMlbSeason,
          seasonEvidence: 'baseball-reference-player-seasons',
        }
    acceptedByBbref.set(bbrefId, record)
    acceptedByChadwick.set(chadwickKey, record)
    acceptedByMlbam.set(mlbamId, record)
    acceptedRows.push(row)
  }

  return {
    crosswalk: {
      summary: staticCrosswalk.summary,
      byBbref(value) {
        if (typeof value !== 'string') return null
        return acceptedByBbref.get(value) ?? staticCrosswalk.byBbref(value)
      },
      byMlbam(value) {
        const key = value === null ? null : positiveInteger(value)
        return key === null
          ? staticCrosswalk.byMlbam(value)
          : acceptedByMlbam.get(key) ?? staticCrosswalk.byMlbam(value)
      },
    },
    overlay: {
      acceptedRecords: acceptedByBbref.size,
      conflicts,
      newestObservedAt: newestIso(acceptedRows),
    },
  }
}
