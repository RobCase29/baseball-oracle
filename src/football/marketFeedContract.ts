export const FOOTBALL_MARKET_FORMAT_IDS = [
  'one_qb_12t_half_ppr_no_tep',
  'one_qb_12t_half_ppr_tep',
  'one_qb_12t_half_ppr_tepp',
  'one_qb_12t_half_ppr_teppp',
  'sf_12t_half_ppr_no_tep',
  'sf_12t_half_ppr_tep',
  'sf_12t_half_ppr_tepp',
  'sf_12t_half_ppr_teppp',
] as const

export type FootballMarketFormatId = (typeof FOOTBALL_MARKET_FORMAT_IDS)[number]
export type FootballMarketUniverse = 'college' | 'nfl'
export type FootballMarketPosition = 'QB' | 'WR' | 'RB' | 'TE'
export type FootballMarketProviderId = 'keeptradecut' | 'dynasty-daddy'
export type FootballMarketProviderStatusValue = 'available' | 'unavailable' | 'unsupported'
export type FootballMarketComparisonScope = 'exact_format' | 'provider_default_directional'
export type DynastyDaddyFormatId = 'dd_1qb_provider_default' | 'dd_sf_provider_default'
export type FootballMarketProviderFormatId = FootballMarketFormatId | DynastyDaddyFormatId
export type FootballMarketProviderErrorCode =
  | 'network_error'
  | 'response_too_large'
  | 'schema_drift'
  | 'unsupported_universe'
  | 'upstream_http_error'
  | 'upstream_timeout'

export interface FootballMarketFeedRequest {
  universe: FootballMarketUniverse
  formatId: FootballMarketFormatId
}

export interface FootballMarketProviderStatus {
  provider: FootballMarketProviderId
  label: string
  status: FootballMarketProviderStatusValue
  sourceUrl: string
  fetchedAt: string | null
  /** Number of normalized skill-position rows included in this response. */
  rowCount: number
  errorCode: FootballMarketProviderErrorCode | null
  comparisonScope: FootballMarketComparisonScope
  formatId: FootballMarketProviderFormatId
}

export interface FootballMarketRanking {
  provider: FootballMarketProviderId
  providerLabel: string
  providerPlayerId: string
  name: string
  normalizedName: string
  universe: FootballMarketUniverse
  position: FootballMarketPosition
  requestedFormatId: FootballMarketFormatId
  formatId: FootballMarketProviderFormatId
  comparisonScope: FootballMarketComparisonScope
  positionRank: number
  positionUniverseSize: number
  positionPercentile: number
  overallRank: number | null
  value: number | null
  /** The provider's position tier when it supplies one. */
  tier: number | null
  sourceUrl: string
  fetchedAt: string
}

export interface FootballMarketFeedResponse {
  schemaVersion: 'football-market-feed.v1'
  generatedAt: string
  request: FootballMarketFeedRequest
  providers: FootballMarketProviderStatus[]
  rankings: FootballMarketRanking[]
}

const FORMAT_ID_SET = new Set<string>(FOOTBALL_MARKET_FORMAT_IDS)

export function isFootballMarketFormatId(value: string): value is FootballMarketFormatId {
  return FORMAT_ID_SET.has(value)
}

export function footballMarketFormatFamily(formatId: FootballMarketFormatId): {
  lineup: 'one_qb' | 'sf'
  tightEndPremium: 'no_tep' | 'tep' | 'tepp' | 'teppp'
} {
  return {
    lineup: formatId.startsWith('sf_') ? 'sf' : 'one_qb',
    tightEndPremium: formatId.endsWith('_no_tep')
      ? 'no_tep'
      : formatId.endsWith('_teppp')
        ? 'teppp'
        : formatId.endsWith('_tepp')
          ? 'tepp'
          : 'tep',
  }
}

export function dynastyDaddyFormatFor(formatId: FootballMarketFormatId): DynastyDaddyFormatId {
  return footballMarketFormatFamily(formatId).lineup === 'sf'
    ? 'dd_sf_provider_default'
    : 'dd_1qb_provider_default'
}

export function normalizeFootballMarketPlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/\b(?:jr|sr|ii|iii|iv)\b/gu, '')
    .replace(/[^a-z0-9]/gu, '')
}
