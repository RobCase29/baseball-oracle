import type {
  PlayerStage,
  PlayerType,
  ProspectCoverageSummary,
  WarQuantiles,
} from './forecast.js'
import type { PlayerMapRoute } from './playerMap.js'

export const PLAYER_SIGNALS_SCHEMA_VERSION = 'player-signals.v1' as const
export const PLAYER_SIGNALS_CONTRACT_VERSION = 'player-signals-contract/v1' as const

export type PlayerSignalAvailability =
  | 'available'
  | 'unavailable'
  | 'withheld'
  | 'insufficient_sample'
  | 'unmatched'
  | 'stale'

export type StageRankLabel = 'Prospect Rank' | 'Pre-Debut Rank' | 'MLB Career Rank'

export type CareerOutlookBandId =
  | 'historic_ceiling'
  | 'hall_level_upside'
  | 'star_upside'
  | 'mlb_regular'
  | 'mlb_contributor'
  | 'limited_mlb_value'
  | 'no_positive_value'

export interface PlayerSignalsItem {
  recordVersion: string
  player: {
    id: string
    name: string
    externalIds: {
      mlbam: string | null
      baseballReference: string | null
      prospectSavant: string | null
      minorMaster: string | null
    }
    identityStatus: 'mlbam_linked' | 'profile_only'
  }
  classification: {
    route: PlayerMapRoute
    careerStage: PlayerStage
    currentLevel: string | null
    competition: 'MiLB' | 'MLB'
    rankingRole: 'hitter' | 'pitcher'
    observedRoles: Array<'hitter' | 'pitcher'>
    age: number | null
    organization: string | null
    organizationCode: string | null
    position: string | null
    rosterStatus: {
      code: string | null
      description: string | null
      asOf: string | null
    } | null
    effectiveAt: string | null
  }
  transition: {
    status: 'not_transitioning' | 'rookie_monitoring'
    priorRoute: 'milb' | null
    priorRankPreserved: boolean
    updatePolicy: 'current_route' | 'frozen_pre_debut_prior_with_live_confirmation'
  }
  signals: {
    backstopRank: {
      label: 'Backstop Rank'
      availability: 'withheld'
      reasonCodes: readonly ['unified_unconditional_model_not_released']
      rank: null
      universe: null
      metricId: 'unified_unconditional_terminal_career_value'
      targetId: 'terminal_career_value_unconditional'
      comparableAcrossStages: false
      intendedComparableAcrossStages: true
      asOf: null
      modelVersion: null
    }
    stageRank: {
      label: StageRankLabel
      availability: PlayerSignalAvailability
      reasonCodes: string[]
      rank: number | null
      universe: number | null
      metricId:
        | 'milb_five_year_impact'
        | 'frozen_pre_debut_five_year_impact'
        | 'mlb_career_outlook_standing'
      targetId: string | null
      originRoute: PlayerMapRoute
      carriedForward: boolean
      comparableAcrossStages: false
      cohortId: 'prospect_forecast' | 'frozen_prospect_prior' | 'current_mlb'
      asOf: string | null
      modelVersion: string | null
      evidenceTier:
        | 'completed_season_full_model'
        | 'completed_season_prior'
        | 'live_in_season_prior'
        | 'current_mlb_model'
        | null
      volatility: 'standard' | 'high' | 'very_high' | null
    }
    careerOutlook: {
      label: 'Career Outlook'
      availability: PlayerSignalAvailability
      reasonCodes: string[]
      value: number | null
      band: {
        id: CareerOutlookBandId
        label: string
      } | null
      scaleVersion: 'career-index-war-v2'
      basis: 'conditional_on_mlb_arrival' | 'current_mlb_terminal'
      arrivalDependent: boolean
      finalCareerWar: Pick<WarQuantiles, 'p50' | 'p75' | 'p90'> | null
      scaleComparableAcrossStages: true
      estimandComparableAcrossStages: false
      publicationStatus: 'research_only' | 'withheld'
      asOf: string | null
      modelVersion: string | null
    }
    currentResults: {
      label: 'Current Results'
      availability: PlayerSignalAvailability
      reasonCodes: string[]
      competition: 'MiLB' | 'MLB'
      season: number | null
      source: 'MLB StatsAPI' | 'Baseball-Reference' | null
      asOf: string | null
      workload: {
        plateAppearances: number | null
        inningsPitched: number | null
      }
      totalWar: number | null
      warPercentile: number | null
      hitting: {
        pa: number
        war: number | null
        ba: number | null
        obp: number | null
        slg: number | null
        ops: number | null
        homeRuns: number | null
        walks: number | null
        strikeouts: number | null
        stolenBases: number | null
      } | null
      pitching: {
        ip: number
        outs: number | null
        games: number | null
        gamesStarted: number | null
        war: number | null
        era: number | null
        whip: number | null
        strikeoutRate: number | null
        walkRate: number | null
        kMinusBbRate: number | null
        strikeouts: number | null
        walksAllowed: number | null
      } | null
    }
  }
}

export interface PlayerSignalsResponse {
  schemaVersion: typeof PLAYER_SIGNALS_SCHEMA_VERSION
  contractVersion: typeof PLAYER_SIGNALS_CONTRACT_VERSION
  snapshot: {
    id: string
    dataAsOf: string | null
    freshness: {
      status: 'ok' | 'degraded' | 'stale'
      reasonCodes: string[]
      statsChangedAt: string | null
      lastCheckedAt: string | null
      nextDueAt: string | null
      cronObserved: boolean
    }
  }
  items: PlayerSignalsItem[]
  page: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  meta: {
    marketIndependent: true
    marketInputsIncluded: false
    investmentRankIncluded: false
    nullMeans: 'unavailable_not_zero'
    backstopRankStatus: 'withheld_pending_unified_unconditional_model'
    stageRanksComparableAcrossStages: false
    careerOutlookScaleComparableAcrossStages: true
    careerOutlookEstimandComparableAcrossStages: false
    currentResultsNormalizedAcrossStages: true
    paginationConsistency: 'page_number_not_snapshot_bound'
    identityPolicy: 'exact_mlbam_bbref_plus_durable_chadwick_overlay_no_name_matching'
    prospectCoverage: ProspectCoverageSummary | null
  }
}

export function careerOutlookBand(value: number): {
  id: CareerOutlookBandId
  label: string
} {
  if (value >= 92) return { id: 'historic_ceiling', label: 'Historic ceiling' }
  if (value >= 80) return { id: 'hall_level_upside', label: 'Hall-level upside' }
  if (value >= 65) return { id: 'star_upside', label: 'Star upside' }
  if (value >= 45) return { id: 'mlb_regular', label: 'MLB regular' }
  if (value >= 20) return { id: 'mlb_contributor', label: 'MLB contributor' }
  if (value > 0) return { id: 'limited_mlb_value', label: 'Limited MLB value' }
  return { id: 'no_positive_value', label: 'No positive value projected' }
}

export function rankingRole(playerType: PlayerType): 'hitter' | 'pitcher' {
  return playerType === 'Pitcher' ? 'pitcher' : 'hitter'
}
