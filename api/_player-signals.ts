import { createHash } from 'node:crypto'
import type {
  CurrentMinorStatsSnapshot,
  CurrentMlbStatsSnapshot,
  PlayerRecord,
  WarQuantiles,
} from '../src/domain/forecast.js'
import type { PlayerMapProfile, PlayerMapRoute } from '../src/domain/playerMap.js'
import {
  PLAYER_SIGNALS_CONTRACT_VERSION,
  PLAYER_SIGNALS_SCHEMA_VERSION,
  careerOutlookBand,
  rankingRole,
  type PlayerSignalAvailability,
  type PlayerSignalsItem,
  type PlayerSignalsResponse,
  type StageRankLabel,
} from '../src/domain/playerSignals.js'

export interface PlayerSignalsRecord extends PlayerRecord {
  playerMap: PlayerMapProfile
}

function canonicalExternalId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.length > 0 ? value : null
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
}

function availabilityForMissing(
  record: PlayerSignalsRecord,
): PlayerSignalAvailability {
  const code = record.playerMap.handling.primary?.code
  if (code === 'identity_link_missing' || code === 'rookie_prior_unmatched') return 'unmatched'
  if (record.playerMap.mappingStatus === 'insufficient_sample') return 'insufficient_sample'
  if (record.playerMap.mappingStatus === 'withheld') return 'withheld'
  return 'unavailable'
}

function reasonCodesForMissing(
  record: PlayerSignalsRecord,
  fallback: string,
): string[] {
  const codes = record.playerMap.handling.notes.map((note) => note.code)
  return codes.length > 0 ? codes : [fallback]
}

function stageRankDescriptor(route: PlayerMapRoute): {
  label: StageRankLabel
  metricId: PlayerSignalsItem['signals']['stageRank']['metricId']
  carriedForward: boolean
} {
  if (route === 'milb') {
    return {
      label: 'Prospect Rank',
      metricId: 'milb_five_year_impact',
      carriedForward: false,
    }
  }
  if (route === 'rookie') {
    return {
      label: 'Pre-Debut Rank',
      metricId: 'frozen_pre_debut_five_year_impact',
      carriedForward: true,
    }
  }
  return {
    label: 'MLB Career Rank',
    metricId: 'mlb_career_outlook_standing',
    carriedForward: false,
  }
}

function finalCareerWar(
  record: PlayerSignalsRecord,
): Pick<WarQuantiles, 'p50' | 'p75' | 'p90'> | null {
  if (record.playerMap.careerIndex.status !== 'research') return null
  const route = record.playerMap.route
  const forecast = route === 'rookie'
    ? record.recentCallup?.prospectPrior?.forecast ?? record.careerForecast
    : record.careerForecast
  const quantiles = route === 'mlb'
    ? forecast?.finalCareerWar
    : forecast?.finalCareerWarConditionalOnArrival
  if (!quantiles) return null
  return { p50: quantiles.p50, p75: quantiles.p75, p90: quantiles.p90 }
}

function minorCurrentResults(
  stats: CurrentMinorStatsSnapshot,
  freshnessStatus: PlayerSignalsResponse['snapshot']['freshness']['status'],
): PlayerSignalsItem['signals']['currentResults'] {
  const plateAppearances = stats.hitting?.pa ?? null
  const inningsPitched = stats.pitching?.ip ?? null
  const stale = stats.asOf === null || freshnessStatus === 'stale'
  return {
    label: 'Current Results',
    availability: stale ? 'stale' : 'available',
    reasonCodes: [
      ...(stats.asOf === null ? ['observation_time_unavailable'] : []),
      ...(freshnessStatus === 'stale' ? ['source_snapshot_stale'] : []),
    ],
    competition: 'MiLB',
    season: stats.season,
    source: stats.source,
    asOf: stats.asOf,
    workload: { plateAppearances, inningsPitched },
    totalWar: null,
    warPercentile: null,
    hitting: stats.hitting === null ? null : {
      ...stats.hitting,
      war: null,
    },
    pitching: stats.pitching === null ? null : {
      ...stats.pitching,
      outs: null,
      games: null,
      gamesStarted: null,
      war: null,
    },
  }
}

function mlbCurrentResults(
  stats: CurrentMlbStatsSnapshot,
  freshnessStatus: PlayerSignalsResponse['snapshot']['freshness']['status'],
): PlayerSignalsItem['signals']['currentResults'] {
  const plateAppearances = stats.hitting?.pa ?? null
  const inningsPitched = stats.pitching?.ip ?? null
  const stale = stats.asOf === null || freshnessStatus === 'stale'
  return {
    label: 'Current Results',
    availability: stale ? 'stale' : 'available',
    reasonCodes: [
      ...(stats.asOf === null ? ['observation_time_unavailable'] : []),
      ...(freshnessStatus === 'stale' ? ['source_snapshot_stale'] : []),
    ],
    competition: 'MLB',
    season: stats.season,
    source: stats.source,
    asOf: stats.asOf,
    workload: { plateAppearances, inningsPitched },
    totalWar: stats.totalWar,
    warPercentile: stats.warPercentile,
    hitting: stats.hitting === null ? null : {
      ...stats.hitting,
      ba: null,
      obp: null,
      slg: null,
      ops: null,
      homeRuns: null,
      walks: null,
      strikeouts: null,
      stolenBases: null,
    },
    pitching: stats.pitching === null ? null : {
      ...stats.pitching,
      era: null,
      whip: null,
      strikeoutRate: null,
      walkRate: null,
      kMinusBbRate: null,
      strikeouts: null,
      walksAllowed: null,
    },
  }
}

function unavailableCurrentResults(
  record: PlayerSignalsRecord,
): PlayerSignalsItem['signals']['currentResults'] {
  const competition = record.playerMap.route === 'milb' ? 'MiLB' : 'MLB'
  return {
    label: 'Current Results',
    availability: 'unavailable',
    reasonCodes: ['current_results_unavailable'],
    competition,
    season: record.provenance.season,
    source: null,
    asOf: null,
    workload: { plateAppearances: null, inningsPitched: null },
    totalWar: null,
    warPercentile: null,
    hitting: null,
    pitching: null,
  }
}

function currentResults(
  record: PlayerSignalsRecord,
  freshnessStatus: PlayerSignalsResponse['snapshot']['freshness']['status'],
): PlayerSignalsItem['signals']['currentResults'] {
  if (record.currentMlbStats) return mlbCurrentResults(record.currentMlbStats, freshnessStatus)
  if (record.currentMinorStats) return minorCurrentResults(record.currentMinorStats, freshnessStatus)
  return unavailableCurrentResults(record)
}

function observedRoles(record: PlayerSignalsRecord): Array<'hitter' | 'pitcher'> {
  const roles: Array<'hitter' | 'pitcher'> = []
  if (record.currentMlbStats?.hitting || record.currentMinorStats?.hitting) roles.push('hitter')
  if (record.currentMlbStats?.pitching || record.currentMinorStats?.pitching) roles.push('pitcher')
  if (roles.length === 0) roles.push(rankingRole(record.playerType))
  return roles
}

export function playerSignalsItem(
  record: PlayerSignalsRecord,
  freshnessStatus: PlayerSignalsResponse['snapshot']['freshness']['status'] = 'ok',
): PlayerSignalsItem {
  const route = record.playerMap.route
  const descriptor = stageRankDescriptor(route)
  const stageStanding = route === 'milb'
    ? record.playerMap.scores.outcome
    : record.playerMap.stageStanding
  const stageRankAvailable = stageStanding.rank !== null
  const outlookValue = record.playerMap.careerIndex.status === 'research'
    ? record.playerMap.careerIndex.value
    : null
  const outlookAvailable = outlookValue !== null
  const missingOutlookAvailability = availabilityForMissing(record)
  const outlookAvailability = outlookAvailable
    ? 'available' as const
    : missingOutlookAvailability === 'unmatched'
      ? missingOutlookAvailability
      : record.playerMap.careerIndex.status === 'withheld'
        ? 'withheld' as const
        : missingOutlookAvailability
  const sourceExternalIds = record.provenance.externalIds
  const externalIds = {
    mlbam: canonicalExternalId(sourceExternalIds.mlbam ?? sourceExternalIds.mlbamId),
    baseballReference: canonicalExternalId(
      sourceExternalIds.bbref ?? sourceExternalIds.baseballReference,
    ),
    prospectSavant: canonicalExternalId(sourceExternalIds.prospectSavant),
    minorMaster: canonicalExternalId(sourceExternalIds.minorMaster),
  }
  const mlbamId = externalIds.mlbam
  const stageModelVersion = route === 'milb'
    ? record.milbImpactRanking?.modelVersion ?? null
    : route === 'rookie'
      ? record.recentCallup?.prospectPrior?.impactRank?.modelVersion ?? null
      : record.careerForecast?.lineage?.modelVersion ?? null
  const itemWithoutVersion = {
    player: {
      id: record.id,
      name: record.name,
      externalIds,
      identityStatus: mlbamId === null ? 'profile_only' as const : 'mlbam_linked' as const,
    },
    classification: {
      route,
      careerStage: record.stage,
      currentLevel: record.level,
      competition: record.currentMlbStats
        ? 'MLB' as const
        : record.currentMinorStats
          ? 'MiLB' as const
          : route === 'milb'
            ? 'MiLB' as const
            : 'MLB' as const,
      rankingRole: rankingRole(record.playerType),
      observedRoles: observedRoles(record),
      age: record.age,
      organization: record.organization,
      organizationCode: record.organizationCode,
      position: record.position,
      effectiveAt: record.provenance.retrievedAt,
    },
    transition: route === 'rookie'
      ? {
          status: 'rookie_monitoring' as const,
          priorRoute: 'milb' as const,
          priorRankPreserved: stageRankAvailable,
          updatePolicy: 'frozen_pre_debut_prior_with_live_confirmation' as const,
        }
      : {
          status: 'not_transitioning' as const,
          priorRoute: null,
          priorRankPreserved: false,
          updatePolicy: 'current_route' as const,
        },
    signals: {
      backstopRank: {
        label: 'Backstop Rank' as const,
        availability: 'withheld' as const,
        reasonCodes: ['unified_unconditional_model_not_released'] as const,
        rank: null,
        universe: null,
        metricId: 'unified_unconditional_terminal_career_value' as const,
        targetId: 'terminal_career_value_unconditional' as const,
        comparableAcrossStages: false as const,
        intendedComparableAcrossStages: true as const,
        asOf: null,
        modelVersion: null,
      },
      stageRank: {
        label: descriptor.label,
        availability: stageRankAvailable
          ? record.playerMap.mappingStatus === 'insufficient_sample'
            ? 'insufficient_sample' as const
            : 'available' as const
          : availabilityForMissing(record),
        reasonCodes: stageRankAvailable
          ? record.playerMap.mappingStatus === 'insufficient_sample'
            ? ['thin_sample_prior']
            : []
          : reasonCodesForMissing(record, 'stage_rank_unavailable'),
        rank: stageStanding.rank,
        universe: stageStanding.universe,
        metricId: descriptor.metricId,
        targetId: stageStanding.target,
        originRoute: route === 'rookie' ? 'milb' as const : route,
        carriedForward: descriptor.carriedForward,
        comparableAcrossStages: false as const,
        cohortId: route === 'milb' ? 'prospect_forecast' : record.playerMap.stageStanding.cohort,
        asOf: stageStanding.asOf,
        modelVersion: stageModelVersion,
      },
      careerOutlook: {
        label: 'Career Outlook' as const,
        availability: outlookAvailability,
        reasonCodes: outlookAvailable ? [] : reasonCodesForMissing(record, 'career_outlook_unavailable'),
        value: outlookValue,
        band: outlookValue === null ? null : careerOutlookBand(outlookValue),
        scaleVersion: record.playerMap.careerIndex.version,
        basis: record.playerMap.careerIndex.basis,
        arrivalDependent: route !== 'mlb',
        finalCareerWar: finalCareerWar(record),
        scaleComparableAcrossStages: true as const,
        estimandComparableAcrossStages: false as const,
        publicationStatus: record.playerMap.careerIndex.status === 'research'
          ? 'research_only' as const
          : 'withheld' as const,
        asOf: record.playerMap.careerIndex.asOf,
        modelVersion: record.playerMap.careerIndex.forecastLineage.modelVersion,
      },
      currentResults: currentResults(record, freshnessStatus),
    },
  }
  const recordVersion = createHash('sha256')
    .update(JSON.stringify(itemWithoutVersion))
    .digest('hex')
  return { recordVersion: `sha256:${recordVersion}`, ...itemWithoutVersion }
}

export function playerSignalsSnapshotId(input: {
  rankingSnapshotId: string
  minorDataAsOf: string | null
  currentMlbDataAsOf: string | null
  forecastDataVersion: string | null
  currentResultsDigest: string | null
  freshnessStatus: PlayerSignalsResponse['snapshot']['freshness']['status']
}): string {
  const digest = createHash('sha256').update(JSON.stringify({
    schemaVersion: PLAYER_SIGNALS_SCHEMA_VERSION,
    contractVersion: PLAYER_SIGNALS_CONTRACT_VERSION,
    ...input,
  })).digest('hex')
  return `player-signals-snapshot/v1:${digest}`
}

export function playerSignalsResponse(input: {
  records: PlayerSignalsRecord[]
  snapshotId: string
  dataAsOf: string | null
  freshness: PlayerSignalsResponse['snapshot']['freshness']
  page: PlayerSignalsResponse['page']
}): PlayerSignalsResponse {
  return {
    schemaVersion: PLAYER_SIGNALS_SCHEMA_VERSION,
    contractVersion: PLAYER_SIGNALS_CONTRACT_VERSION,
    snapshot: {
      id: input.snapshotId,
      dataAsOf: input.dataAsOf,
      freshness: input.freshness,
    },
    items: input.records.map((record) => playerSignalsItem(record, input.freshness.status)),
    page: input.page,
    meta: {
      marketIndependent: true,
      marketInputsIncluded: false,
      investmentRankIncluded: false,
      nullMeans: 'unavailable_not_zero',
      backstopRankStatus: 'withheld_pending_unified_unconditional_model',
      stageRanksComparableAcrossStages: false,
      careerOutlookScaleComparableAcrossStages: true,
      careerOutlookEstimandComparableAcrossStages: false,
      currentResultsNormalizedAcrossStages: true,
      paginationConsistency: 'page_number_not_snapshot_bound',
      identityPolicy: 'exact_mlbam_bbref_plus_durable_chadwick_overlay_no_name_matching',
    },
  }
}
