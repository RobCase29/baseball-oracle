import type {
  ItFactorSource,
  ItFactorSport,
  ItFactorStatus,
  ItFactorTier,
  ItFactorTrajectory,
} from '../../../src/domain/itFactor.js'

export interface ItFactorCurationEntry {
  id: string
  playerName: string
  sport: ItFactorSport
  league: 'MLB' | 'NFL' | 'NBA' | 'NHL'
  teamCode: string
  teamName: string
  position: string
  status: ItFactorStatus
  score: number
  tier: ItFactorTier
  confidence: number
  trajectory: ItFactorTrajectory
  rationale: string
  signals: string[]
  recheckTriggers?: string[]
  sourceIds: string[]
}

export interface ItFactorLeagueCuration {
  sources: ItFactorSource[]
  entries: ItFactorCurationEntry[]
}
