import { neon } from '@neondatabase/serverless'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  researchArrivalEstimate,
  researchArrivalProbability,
  researchMilbAlphaSignal,
  researchPreviewSummary,
  type ResearchMilbAlphaSignal,
} from './_research-arrival.js'
import { minorTraitEvidence } from './_minor-trait-evidence.js'
import {
  researchMilbImpactRanking,
  researchMilbImpactSummary,
  type ResearchMilbImpactRanking,
} from './_milb-impact.js'
import {
  loadCareerOraclePreview,
  type CareerOraclePreview,
  type CareerPreviewPlayer,
} from './_career-oracle-preview.js'
import type {
  CareerForecast,
} from './_career-oracle-types.js'

const playerTypes = ['All', 'Hitter', 'Pitcher', 'Two-way'] as const
const playerStages = ['All', 'Minors', 'MLB'] as const
const playerLevels = ['All', 'Rk', 'A', 'A+', 'AA', 'AAA'] as const
const playerSorts = [
  'alphaOpportunity',
  'hofProbability',
  'nearTermImpact',
  'finalWar',
  'arrival36',
  'age',
  'name',
] as const
const queryParameterNames = new Set([
  'q',
  'stage',
  'playerType',
  'level',
  'team',
  'position',
  'sort',
  'page',
  'limit',
])

function hasNoControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 32 && codePoint !== 127
  })
}

const querySchema = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .refine(hasNoControlCharacters)
    .default(''),
  stage: z.enum(playerStages).default('All'),
  playerType: z.enum(playerTypes).default('All'),
  level: z.enum(playerLevels).default('All'),
  team: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\p{L}\p{N} .'&()-]+$/u)
    .refine(hasNoControlCharacters)
    .refine((value) => value.toLocaleLowerCase('en-US') !== 'all')
    .nullable()
    .default(null),
  position: z
    .string()
    .trim()
    .transform((value) => value.toLocaleUpperCase('en-US'))
    .pipe(z.string().regex(/^[A-Z0-9_-]{1,24}$/u))
    .refine((value) => value !== 'ALL')
    .nullable()
    .default(null),
  sort: z.enum(playerSorts).default('alphaOpportunity'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

type PlayerType = (typeof playerTypes)[number]
type PlayerStage = (typeof playerStages)[number]
type PlayerLevel = (typeof playerLevels)[number]
type PlayerSort = (typeof playerSorts)[number]

export interface PlayerQuery {
  q: string
  stage: PlayerStage
  playerType: PlayerType
  level: PlayerLevel
  team: string | null
  position: string | null
  sort: PlayerSort
  page: number
  limit: number
}

type DatabaseNumber = bigint | number | string | null

interface PlayerRow {
  profile_id: string
  source_player_id: string
  player_type: 'Hitter' | 'Pitcher'
  display_name: string
  organization_code: string | null
  organization_name: string | null
  position: string | null
  age: DatabaseNumber
  level: string
  levels_observed: unknown
  season: DatabaseNumber
  bats: string | null
  throws: string | null
  mlbam_id: DatabaseNumber
  minor_master_id: string | null
  fangraphs_path: string | null
  known_at: string
  has_statcast: boolean
  has_traditional: boolean
  has_complementary_rows: boolean
  cohort_mismatch: boolean | null
  source_variants: unknown
  organization_conflict: boolean
  ps_score: DatabaseNumber
  ps_percentile: DatabaseNumber
  pa: DatabaseNumber
  ip: DatabaseNumber
  pitches: DatabaseNumber
  ba: DatabaseNumber
  obp: DatabaseNumber
  slg: DatabaseNumber
  iso: DatabaseNumber
  woba: DatabaseNumber
  xwoba: DatabaseNumber
  ev: DatabaseNumber
  ev90: DatabaseNumber
  max_ev: DatabaseNumber
  hard_hit_rate: DatabaseNumber
  barrel_rate: DatabaseNumber
  chase_rate: DatabaseNumber
  whiff_rate: DatabaseNumber
  zone_contact_rate: DatabaseNumber
  swinging_strike_rate: DatabaseNumber
  strikeout_rate: DatabaseNumber
  walk_rate: DatabaseNumber
  k_minus_bb_rate: DatabaseNumber
  velocity: DatabaseNumber
  max_velocity: DatabaseNumber
  spin_rate: DatabaseNumber
  woba_percentile: DatabaseNumber
  xwoba_percentile: DatabaseNumber
  ev_percentile: DatabaseNumber
  ev90_percentile: DatabaseNumber
  max_ev_percentile: DatabaseNumber
  hard_hit_percentile: DatabaseNumber
  barrel_percentile: DatabaseNumber
  chase_percentile: DatabaseNumber
  whiff_percentile: DatabaseNumber
  zone_contact_percentile: DatabaseNumber
  swinging_strike_percentile: DatabaseNumber
  strikeout_percentile: DatabaseNumber
  walk_percentile: DatabaseNumber
  k_minus_bb_percentile: DatabaseNumber
  velocity_percentile: DatabaseNumber
  age_percentile: DatabaseNumber
}

interface MinorCandidateRow {
  profile_id: string
  player_type: 'Hitter' | 'Pitcher'
  display_name: string
  organization_code: string | null
  organization_name: string | null
  position: string | null
  age: DatabaseNumber
  level: string
  season: DatabaseNumber
  mlbam_id: DatabaseNumber
  known_at: string
  pa: DatabaseNumber
  ip: DatabaseNumber
  pitches: DatabaseNumber
}

interface ObservedMetric {
  key: string
  label: string
  value: string
  percentile: number | null
  source: 'Prospect Savant'
}

const publicCache = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600'

function setResponseHeaders(response: ServerResponse, cacheControl: string): void {
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  cacheControl = 'no-store',
): void {
  const json = JSON.stringify(body)
  response.statusCode = statusCode
  setResponseHeaders(response, cacheControl)
  response.setHeader('Content-Length', Buffer.byteLength(json).toString())
  response.end(request.method === 'HEAD' ? undefined : json)
}

function readSingleParameter(
  searchParams: URLSearchParams,
  name: keyof PlayerQuery,
): string | undefined {
  const values = searchParams.getAll(name)
  if (values.length > 1) throw new Error(`Duplicate query parameter: ${name}`)
  return name === 'q' && values[0] !== undefined
    ? normalizeQueryText(values[0])
    : values[0]
}

export function normalizeQueryText(value: string): string {
  return value.replaceAll('+', ' ')
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
}

export function parseQuery(request: IncomingMessage): PlayerQuery | null {
  let url: URL
  try {
    url = new URL(request.url ?? '/', 'https://baseball-oracle.local')
  } catch {
    return null
  }

  try {
    if (Array.from(url.searchParams.keys()).some((name) => !queryParameterNames.has(name))) {
      return null
    }

    const input = {
      q: readSingleParameter(url.searchParams, 'q'),
      stage: readSingleParameter(url.searchParams, 'stage'),
      playerType: readSingleParameter(url.searchParams, 'playerType'),
      level: readSingleParameter(url.searchParams, 'level'),
      team: readSingleParameter(url.searchParams, 'team'),
      position: readSingleParameter(url.searchParams, 'position'),
      sort: readSingleParameter(url.searchParams, 'sort'),
      page: readSingleParameter(url.searchParams, 'page'),
      limit: readSingleParameter(url.searchParams, 'limit'),
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function numberOrNull(value: DatabaseNumber): number | null {
  if (value === null) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function roundedNumber(value: DatabaseNumber, digits = 1): number | null {
  const number = numberOrNull(value)
  if (number === null) return null
  const scale = 10 ** digits
  return Math.round(number * scale) / scale
}

function percentileOrNull(value: DatabaseNumber): number | null {
  const number = roundedNumber(value, 1)
  if (number === null) return null
  return Math.min(100, Math.max(0, number))
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  )
}

function isoDate(value: string | null): string | null {
  if (!value) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  const selected = parts.length > 1 ? [parts[0], parts.at(-1)] : parts
  return selected
    .map((part) => Array.from(part ?? '')[0] ?? '')
    .join('')
    .toLocaleUpperCase('en-US')
}

function formatDecimal(value: DatabaseNumber, digits = 3): string | null {
  const number = numberOrNull(value)
  return number === null ? null : number.toFixed(digits).replace(/^0(?=\.)/u, '')
}

function formatRate(value: DatabaseNumber): string | null {
  const number = numberOrNull(value)
  if (number === null) return null
  const percentage = Math.abs(number) <= 1.5 ? number * 100 : number
  return `${percentage.toFixed(1)}%`
}

function formatMeasurement(
  value: DatabaseNumber,
  unit: 'mph' | 'rpm',
): string | null {
  const number = numberOrNull(value)
  if (number === null) return null
  const digits = unit === 'rpm' ? 0 : 1
  return `${number.toFixed(digits)} ${unit}`
}

function formatCount(value: DatabaseNumber, digits = 0): string | null {
  const number = numberOrNull(value)
  if (number === null) return null
  return number.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function metric(
  key: string,
  label: string,
  value: string | null,
  percentile: DatabaseNumber = null,
): ObservedMetric | null {
  if (value === null) return null
  return {
    key,
    label,
    value,
    percentile: percentileOrNull(percentile),
    source: 'Prospect Savant',
  }
}

export function shouldSuppressSlashLine(
  playerType: string,
  pa: DatabaseNumber,
  ba: DatabaseNumber,
  obp: DatabaseNumber,
  slg: DatabaseNumber,
  woba: DatabaseNumber,
): boolean {
  return playerType === 'Hitter' &&
    (numberOrNull(pa) ?? 0) >= 20 &&
    numberOrNull(ba) === 0 &&
    numberOrNull(obp) === 0 &&
    numberOrNull(slg) === 0 &&
    (numberOrNull(woba) ?? 0) > 0
}

function observedMetrics(row: PlayerRow): ObservedMetric[] {
  const slashLineLooksMissing = shouldSuppressSlashLine(
    row.player_type,
    row.pa,
    row.ba,
    row.obp,
    row.slg,
    row.woba,
  )
  const common = [
    metric('woba', row.player_type === 'Pitcher' ? 'wOBA allowed' : 'wOBA', formatDecimal(row.woba), row.woba_percentile),
    metric('xwoba', row.player_type === 'Pitcher' ? 'xwOBA allowed' : 'xwOBA', formatDecimal(row.xwoba), row.xwoba_percentile),
    metric('chase-rate', 'Chase rate', formatRate(row.chase_rate), row.chase_percentile),
    metric('whiff-rate', 'Whiff rate', formatRate(row.whiff_rate), row.whiff_percentile),
    metric('swinging-strike-rate', 'Swinging-strike rate', formatRate(row.swinging_strike_rate), row.swinging_strike_percentile),
    metric('strikeout-rate', 'Strikeout rate', formatRate(row.strikeout_rate), row.strikeout_percentile),
    metric('walk-rate', 'Walk rate', formatRate(row.walk_rate), row.walk_percentile),
  ]

  const roleSpecific = row.player_type === 'Hitter'
    ? [
        metric('batting-average', 'Batting average', slashLineLooksMissing ? null : formatDecimal(row.ba)),
        metric('on-base-percentage', 'On-base percentage', slashLineLooksMissing ? null : formatDecimal(row.obp)),
        metric('slugging', 'Slugging', slashLineLooksMissing ? null : formatDecimal(row.slg)),
        metric('isolated-power', 'Isolated power', slashLineLooksMissing ? null : formatDecimal(row.iso)),
        metric('exit-velocity', 'Average exit velocity', formatMeasurement(row.ev, 'mph'), row.ev_percentile),
        metric('exit-velocity-90', '90th percentile exit velocity', formatMeasurement(row.ev90, 'mph'), row.ev90_percentile),
        metric('max-exit-velocity', 'Maximum exit velocity', formatMeasurement(row.max_ev, 'mph'), row.max_ev_percentile),
        metric('hard-hit-rate', 'Hard-hit rate', formatRate(row.hard_hit_rate), row.hard_hit_percentile),
        metric('barrel-rate', 'Barrel rate', formatRate(row.barrel_rate), row.barrel_percentile),
        metric('zone-contact-rate', 'Zone contact rate', formatRate(row.zone_contact_rate), row.zone_contact_percentile),
      ]
    : [
        metric('velocity', 'Average velocity', formatMeasurement(row.velocity, 'mph'), row.velocity_percentile),
        metric('max-velocity', 'Maximum velocity', formatMeasurement(row.max_velocity, 'mph')),
        metric('spin-rate', 'Spin rate', formatMeasurement(row.spin_rate, 'rpm')),
        metric('k-minus-bb-rate', 'K-BB rate', formatRate(row.k_minus_bb_rate), row.k_minus_bb_percentile),
      ]

  return [...common, ...roleSpecific].filter(
    (entry): entry is ObservedMetric => entry !== null,
  )
}

function coverageLabel(row: PlayerRow): string {
  if (row.has_statcast && row.has_traditional) return 'Statcast and traditional statistics'
  if (row.has_statcast) return 'Statcast tracking'
  if (row.has_traditional) return 'Traditional statistics'
  return 'Player profile only'
}

function opportunity(row: PlayerRow): { label: string; value: string } | null {
  if (row.player_type === 'Hitter') {
    const value = formatCount(row.pa)
    return value === null ? null : { label: 'PA', value }
  }

  const innings = formatCount(row.ip, 1)
  if (innings !== null) return { label: 'IP', value: innings }
  const pitches = formatCount(row.pitches)
  return pitches === null ? null : { label: 'Pitches', value: pitches }
}

function playerRecord(
  row: PlayerRow,
  careerForecast: CareerForecast | null,
  milbAlphaSignal: ResearchMilbAlphaSignal | null,
  milbImpactRanking: ResearchMilbImpactRanking | null,
) {
  const bats = row.bats && row.bats !== '0' ? row.bats : null
  const throws = row.throws && row.throws !== '0' ? row.throws : null
  const batsThrows = bats && throws ? `${bats}/${throws}` : bats ?? throws

  const metrics = observedMetrics(row)
  return {
    id: row.profile_id,
    name: row.display_name,
    initials: initials(row.display_name),
    organization: row.organization_name ?? row.organization_code,
    organizationCode: row.organization_code,
    position: row.position,
    playerType: row.player_type,
    stage: 'pre_debut' as const,
    age: roundedNumber(row.age, 0),
    level: row.level,
    batsThrows,
    psScore: roundedNumber(row.ps_score, 2),
    psPercentile: percentileOrNull(row.ps_percentile),
    agePercentile: percentileOrNull(row.age_percentile),
    opportunity: opportunity(row),
    metrics,
    coverage: {
      label: coverageLabel(row),
      hasStatcast: row.has_statcast === true,
      hasTraditional: row.has_traditional === true,
      hasComplementaryRows: row.has_complementary_rows === true,
      levelsObserved: stringArray(row.levels_observed),
      sourceVariants: stringArray(row.source_variants),
      organizationConflict: row.organization_conflict === true,
      cohortMismatch: row.cohort_mismatch === true,
    },
    provenance: {
      source: 'Prospect Savant',
      dataset: 'Minor League Leaders',
      datasetKey: 'minor-league-leaders',
      season: roundedNumber(row.season, 0),
      retrievedAt: isoDate(row.known_at),
      cohort: {
        pitchQualifier: 1,
        minAge: 16,
        maxAge: 40,
      },
      externalIds: {
        prospectSavant: row.source_player_id,
        mlbam: numberOrNull(row.mlbam_id)?.toString() ?? null,
        minorMaster: row.minor_master_id,
        fangraphsPath: row.fangraphs_path,
      },
    },
    researchEstimate: researchArrivalEstimate(row.mlbam_id, row.player_type),
    milbAlphaSignal,
    milbImpactRanking,
    minorTraitEvidence: minorTraitEvidence({
      playerType: row.player_type,
      metrics,
      opportunity: {
        plateAppearances: row.pa,
        inningsPitched: row.ip,
        pitches: row.pitches,
      },
    }),
    careerForecast,
  }
}

function previewPlayerRecord(
  player: CareerPreviewPlayer,
  preview: CareerOraclePreview,
  careerForecast: CareerForecast,
) {
  const context = [...new Set(
    [player.level, player.stage === 'pre_debut' ? 'Minor leagues' : 'MLB']
      .filter((value): value is string => Boolean(value)),
  )]

  return {
    id: player.id,
    name: player.name,
    initials: initials(player.name),
    organization: player.organization,
    organizationCode: player.organizationCode,
    position: player.position,
    playerType: player.playerType,
    stage: player.stage,
    age: player.age,
    level: player.level,
    batsThrows: player.batsThrows,
    psScore: null,
    psPercentile: null,
    agePercentile: null,
    opportunity: null,
    metrics: [],
    coverage: {
      label: 'Career Oracle preview evidence',
      hasStatcast: false,
      hasTraditional: false,
      hasComplementaryRows: false,
      levelsObserved: context,
      sourceVariants: [],
      organizationConflict: false,
      cohortMismatch: false,
    },
    provenance: {
      source: 'Baseball Oracle',
      dataset: 'Career Oracle research preview',
      datasetKey: preview.modelVersion,
      season: null,
      retrievedAt: isoDate(preview.asOf),
      cohort: null,
      externalIds: player.externalIds,
    },
    researchEstimate: null,
    milbAlphaSignal: null,
    milbImpactRanking: null,
    minorTraitEvidence: null,
    careerForecast,
  }
}

function databaseIdentifier(value: DatabaseNumber): string | null {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : null
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value.toString() : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^\d+$/u.test(trimmed) ? trimmed : null
}

function previewMlbamId(player: CareerPreviewPlayer): string | null {
  const value = player.externalIds.mlbam ?? player.externalIds.mlbamId
  return databaseIdentifier(value)
}

function isMlbPreviewPlayer(
  player: CareerPreviewPlayer,
): player is CareerPreviewPlayer & { stage: 'early_mlb' | 'established_mlb' } {
  return player.stage === 'early_mlb' || player.stage === 'established_mlb'
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: 'ascending' | 'descending',
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'ascending' ? left - right : right - left
}

export interface UnifiedBoardCandidate {
  id: string
  source: 'mlb' | 'minor'
  name: string
  playerType: 'Hitter' | 'Pitcher' | 'Two-way'
  stage: 'pre_debut' | 'early_mlb' | 'established_mlb'
  age: number | null
  level: string | null
  organization: string | null
  organizationCode: string | null
  position: string | null
  mlbamId: string | null
  opportunityScore: number
  careerForecast: CareerForecast | null
  milbAlphaSignal: ResearchMilbAlphaSignal | null
  milbImpactRanking: ResearchMilbImpactRanking | null
  arrivalProbability36: number | null
  minorProfileId: string | null
  previewPlayer: CareerPreviewPlayer | null
}

function candidateKey(candidate: UnifiedBoardCandidate): string {
  return `${candidate.source}:${candidate.id}`
}

export function sortUnifiedCandidates(
  items: UnifiedBoardCandidate[],
  sort: PlayerSort,
): UnifiedBoardCandidate[] {
  return items.toSorted((left, right) => {
    const idTie = left.id.localeCompare(right.id) || left.source.localeCompare(right.source)
    if (sort === 'name') return left.name.localeCompare(right.name) || idTie
    if (sort === 'age') {
      return compareNullableNumber(left.age, right.age, 'ascending') || idTie
    }
    if (sort === 'arrival36') {
      if (left.source === 'minor' && right.source === 'minor') {
        return (
          compareNullableNumber(left.milbAlphaSignal?.rank ?? null, right.milbAlphaSignal?.rank ?? null, 'ascending') ||
          idTie
        )
      }
      return (
        compareNullableNumber(left.arrivalProbability36, right.arrivalProbability36, 'descending') ||
        idTie
      )
    }
    if (sort === 'nearTermImpact') {
      return (
        compareNullableNumber(
          left.source === 'mlb'
            ? left.careerForecast?.careerChapter?.status === 'research'
              ? left.careerForecast.careerChapter.exceptionalTrajectory?.probability ?? null
              : null
            : left.arrivalProbability36,
          right.source === 'mlb'
            ? right.careerForecast?.careerChapter?.status === 'research'
              ? right.careerForecast.careerChapter.exceptionalTrajectory?.probability ?? null
              : null
            : right.arrivalProbability36,
          'descending',
        ) ||
        compareNullableNumber(
          left.careerForecast?.hofCaliberProbability ?? null,
          right.careerForecast?.hofCaliberProbability ?? null,
          'descending',
        ) ||
        idTie
      )
    }
    if (sort === 'alphaOpportunity') {
      const leftAlpha = left.source === 'mlb' &&
          left.careerForecast?.alphaSignal?.status === 'research' &&
          left.careerForecast.alphaSignal.eligible
        ? left.careerForecast.alphaSignal
        : null
      const rightAlpha = right.source === 'mlb' &&
          right.careerForecast?.alphaSignal?.status === 'research' &&
          right.careerForecast.alphaSignal.eligible
        ? right.careerForecast.alphaSignal
        : null
      const leftMilbAlpha = left.source === 'minor' && left.milbAlphaSignal?.eligible
        ? left.milbAlphaSignal
        : null
      const rightMilbAlpha = right.source === 'minor' && right.milbAlphaSignal?.eligible
        ? right.milbAlphaSignal
        : null
      const leftMilbImpact = leftMilbAlpha &&
          left.milbImpactRanking && left.milbImpactRanking.rankPercentile >= 90
        ? left.milbImpactRanking
        : null
      const rightMilbImpact = rightMilbAlpha &&
          right.milbImpactRanking && right.milbImpactRanking.rankPercentile >= 90
        ? right.milbImpactRanking
        : null

      if (left.source === 'minor' && right.source === 'minor') {
        return (
          compareNullableNumber(leftMilbImpact?.rank ?? null, rightMilbImpact?.rank ?? null, 'ascending') ||
          compareNullableNumber(leftMilbAlpha?.rank ?? null, rightMilbAlpha?.rank ?? null, 'ascending') ||
          compareNullableNumber(
            leftMilbAlpha?.ageContext?.percentileWithinRoleLevel ?? null,
            rightMilbAlpha?.ageContext?.percentileWithinRoleLevel ?? null,
            'ascending',
          ) ||
          idTie
        )
      }
      return (
        compareNullableNumber(
          leftAlpha?.edge?.probabilityDelta ?? leftMilbAlpha?.primaryEdge.probabilityDelta ?? null,
          rightAlpha?.edge?.probabilityDelta ?? rightMilbAlpha?.primaryEdge.probabilityDelta ?? null,
          'descending',
        ) ||
        compareNullableNumber(
          leftAlpha?.nearTermImpact?.probability ?? (
            left.source === 'mlb'
              ? left.careerForecast?.careerChapter?.status === 'research'
                ? left.careerForecast.careerChapter.exceptionalTrajectory?.probability ?? null
                : null
              : left.arrivalProbability36
          ),
          rightAlpha?.nearTermImpact?.probability ?? (
            right.source === 'mlb'
              ? right.careerForecast?.careerChapter?.status === 'research'
                ? right.careerForecast.careerChapter.exceptionalTrajectory?.probability ?? null
                : null
              : right.arrivalProbability36
          ),
          'descending',
        ) ||
        compareNullableNumber(left.age, right.age, 'ascending') ||
        idTie
      )
    }
    if (sort === 'finalWar') {
      return (
        compareNullableNumber(
          left.careerForecast?.finalCareerWar?.p50 ?? null,
          right.careerForecast?.finalCareerWar?.p50 ?? null,
          'descending',
        ) || idTie
      )
    }
    return (
      compareNullableNumber(
        left.careerForecast?.hofCaliberProbability ?? null,
        right.careerForecast?.hofCaliberProbability ?? null,
        'descending',
      ) ||
      compareNullableNumber(
        left.careerForecast?.finalCareerWar?.p50 ?? null,
        right.careerForecast?.finalCareerWar?.p50 ?? null,
        'descending',
      ) ||
      idTie
    )
  })
}

export function sortBoardCandidates(
  items: UnifiedBoardCandidate[],
  query: Pick<PlayerQuery, 'stage' | 'sort'>,
): UnifiedBoardCandidate[] {
  const sorted = sortUnifiedCandidates(items, query.sort)
  if (query.stage !== 'All' || query.sort === 'age' || query.sort === 'name') {
    return sorted
  }

  const sourceOrder = query.sort === 'arrival36'
    ? (['minor', 'mlb'] as const)
    : (['mlb', 'minor'] as const)
  return sourceOrder.flatMap((source) => sorted.filter((candidate) => candidate.source === source))
}

export function assignStageRanks(
  candidates: UnifiedBoardCandidate[],
): UnifiedBoardCandidate[] {
  const rankedKeys = new Map<string, number>()
  for (const source of ['mlb', 'minor'] as const) {
    sortUnifiedCandidates(
      candidates.filter((candidate) => candidate.source === source),
      'hofProbability',
    )
      .filter((candidate) => candidate.careerForecast?.hofCaliberProbability != null)
      .forEach((candidate, index) => rankedKeys.set(candidateKey(candidate), index + 1))
  }

  return candidates.map((candidate) => {
    if (candidate.careerForecast === null) return candidate
    const artifactRank = candidate.careerForecast.rank
    return {
      ...candidate,
      careerForecast: {
        ...candidate.careerForecast,
        rank: rankedKeys.get(candidateKey(candidate)) ?? null,
        lineage: {
          ...candidate.careerForecast.lineage,
          ...(artifactRank === null ? {} : { artifactRank }),
          rankUniverse: candidate.source === 'mlb'
            ? 'current_mlb'
            : 'live_milb_research_proxy',
        },
      },
    }
  })
}

function minorOpportunityScore(row: MinorCandidateRow): number {
  if (row.player_type === 'Hitter') return Math.max(numberOrNull(row.pa) ?? 0, 0)
  const estimatedBattersFromPitches = (numberOrNull(row.pitches) ?? 0) / 3.9
  const estimatedBattersFromInnings = (numberOrNull(row.ip) ?? 0) * 4.3
  return Math.max(estimatedBattersFromPitches, estimatedBattersFromInnings, 0)
}

export interface MinorDedupeSummary {
  items: UnifiedBoardCandidate[]
  inputRoleRows: number
  canonicalPlayers: number
  duplicateRoleRowsRemoved: number
  missingMlbam: number
}

export function dedupeMinorCandidates(
  candidates: UnifiedBoardCandidate[],
): MinorDedupeSummary {
  const selected = new Map<string, UnifiedBoardCandidate>()
  let missingMlbam = 0

  for (const candidate of candidates) {
    const identity = candidate.mlbamId === null
      ? `profile:${candidate.id}`
      : `mlbam:${candidate.mlbamId}`
    if (candidate.mlbamId === null) missingMlbam += 1
    const existing = selected.get(identity)
    if (!existing) {
      selected.set(identity, candidate)
      continue
    }

    const candidateHasForecast = candidate.careerForecast !== null
    const existingHasForecast = existing.careerForecast !== null
    if (candidateHasForecast !== existingHasForecast) {
      if (candidateHasForecast) selected.set(identity, candidate)
      continue
    }
    if (
      candidate.opportunityScore > existing.opportunityScore ||
      (candidate.opportunityScore === existing.opportunityScore && candidate.id < existing.id)
    ) {
      selected.set(identity, candidate)
    }
  }

  const items = Array.from(selected.values())
  return {
    items,
    inputRoleRows: candidates.length,
    canonicalPlayers: items.length,
    duplicateRoleRowsRemoved: candidates.length - items.length,
    missingMlbam,
  }
}

export interface CurrentUniverseMerge {
  items: UnifiedBoardCandidate[]
  canonicalMinors: UnifiedBoardCandidate[]
  crossStageDuplicatesRemoved: number
}

export function mergeCurrentUniverse(
  mlb: UnifiedBoardCandidate[],
  minors: UnifiedBoardCandidate[],
): CurrentUniverseMerge {
  const currentMlbamIds = new Set(
    mlb.map((candidate) => candidate.mlbamId).filter((value): value is string => value !== null),
  )
  const canonicalMinors = minors.filter(
    (candidate) => candidate.mlbamId === null || !currentMlbamIds.has(candidate.mlbamId),
  )
  return {
    items: assignStageRanks([...mlb, ...canonicalMinors]),
    canonicalMinors,
    crossStageDuplicatesRemoved: minors.length - canonicalMinors.length,
  }
}

function mlbCandidates(preview: CareerOraclePreview | null): UnifiedBoardCandidate[] {
  if (!preview) return []
  return preview.items.filter(isMlbPreviewPlayer).map((player) => ({
    id: player.id,
    source: 'mlb',
    name: player.name,
    playerType: player.playerType,
    stage: player.stage,
    age: player.age,
    level: player.level,
    organization: player.organization,
    organizationCode: player.organizationCode,
    position: player.position,
    mlbamId: previewMlbamId(player),
    opportunityScore: 0,
    careerForecast: player.careerForecast,
    milbAlphaSignal: null,
    milbImpactRanking: null,
    arrivalProbability36: player.careerForecast.arrivalProbability36,
    minorProfileId: null,
    previewPlayer: player,
  }))
}

function minorCandidates(
  rows: MinorCandidateRow[],
  preview: CareerOraclePreview | null,
): UnifiedBoardCandidate[] {
  return rows.map((row) => {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    const forecastKey = mlbamId === null
      ? null
      : `${mlbamId}:${row.player_type.toLocaleLowerCase('en-US')}`
    const forecast = forecastKey === null
      ? null
      : preview?.prospectForecasts[forecastKey]?.careerForecast ?? null
    return {
      id: row.profile_id,
      source: 'minor' as const,
      name: row.display_name,
      playerType: row.player_type,
      stage: 'pre_debut' as const,
      age: roundedNumber(row.age, 0),
      level: row.level,
      organization: row.organization_name ?? row.organization_code,
      organizationCode: row.organization_code,
      position: row.position,
      mlbamId,
      opportunityScore: minorOpportunityScore(row),
      careerForecast: forecast,
      milbAlphaSignal: researchMilbAlphaSignal(row.mlbam_id, row.player_type),
      milbImpactRanking: researchMilbImpactRanking(row.mlbam_id, row.player_type),
      arrivalProbability36: forecast?.arrivalProbability36 ??
        researchArrivalProbability(row.mlbam_id, row.player_type, 36),
      minorProfileId: row.profile_id,
      previewPlayer: null,
    }
  })
}

export function playerPositionTokens(value: string | null): string[] {
  if (!value) return []
  return [...new Set(
    value
      .split(/[/,;|]+/u)
      .map((token) => token.trim().toLocaleUpperCase('en-US'))
      .filter(Boolean),
  )]
}

type FacetFilter = 'team' | 'position'

export function matchesQuery(
  candidate: UnifiedBoardCandidate,
  query: PlayerQuery,
  omittedFacet?: FacetFilter,
): boolean {
  const needle = normalizeSearchText(query.q)
  const textMatches = needle.length === 0 || [
    candidate.name,
    candidate.organization,
    candidate.organizationCode,
    candidate.position,
  ].some((value) => value ? normalizeSearchText(value).includes(needle) : false)
  const stageMatches = query.stage === 'All' ||
    (query.stage === 'Minors' ? candidate.source === 'minor' : candidate.source === 'mlb')
  const typeMatches = query.playerType === 'All' || candidate.playerType === query.playerType
  const levelMatches = query.level === 'All' || candidate.level === query.level
  const teamNeedle = query.team?.toLocaleLowerCase('en-US') ?? null
  const teamMatches = omittedFacet === 'team' || teamNeedle === null || [
    candidate.organizationCode,
    candidate.organization,
  ].some((value) => value?.trim().toLocaleLowerCase('en-US') === teamNeedle)
  const positionMatches = omittedFacet === 'position' || query.position === null ||
    playerPositionTokens(candidate.position).includes(query.position)
  return textMatches && stageMatches && typeMatches && levelMatches && teamMatches && positionMatches
}

interface PlayerFacetOption {
  value: string
  label: string
  count: number
}

export interface PlayerFacets {
  teams: PlayerFacetOption[]
  positions: PlayerFacetOption[]
}

function teamFacet(candidate: UnifiedBoardCandidate): Omit<PlayerFacetOption, 'count'> | null {
  const code = candidate.organizationCode?.trim() || null
  const organization = candidate.organization?.trim() || null
  const value = code ?? organization
  if (!value) return null
  const label = code && organization && organization.toLocaleUpperCase('en-US') !== code.toLocaleUpperCase('en-US')
    ? `${organization} (${code})`
    : value
  return { value, label }
}

function sortedFacetOptions(options: Map<string, PlayerFacetOption>): PlayerFacetOption[] {
  return Array.from(options.values()).toSorted(
    (left, right) => left.label.localeCompare(right.label, 'en-US') || left.value.localeCompare(right.value, 'en-US'),
  )
}

export function buildPlayerFacets(
  candidates: UnifiedBoardCandidate[],
  query: PlayerQuery,
): PlayerFacets {
  const teamOptions = new Map<string, PlayerFacetOption>()
  for (const candidate of candidates.filter((item) => matchesQuery(item, query, 'team'))) {
    const facet = teamFacet(candidate)
    if (!facet) continue
    const key = facet.value.toLocaleLowerCase('en-US')
    const existing = teamOptions.get(key)
    teamOptions.set(key, existing ? { ...existing, count: existing.count + 1 } : { ...facet, count: 1 })
  }

  const positionOptions = new Map<string, PlayerFacetOption>()
  for (const candidate of candidates.filter((item) => matchesQuery(item, query, 'position'))) {
    for (const token of playerPositionTokens(candidate.position)) {
      const existing = positionOptions.get(token)
      positionOptions.set(token, existing
        ? { ...existing, count: existing.count + 1 }
        : { value: token, label: token === 'TWO_WAY' ? 'Two-way' : token, count: 1 })
    }
  }

  return {
    teams: sortedFacetOptions(teamOptions),
    positions: sortedFacetOptions(positionOptions),
  }
}

function latestIso(values: Array<string | null>): string | null {
  const timestamps = values
    .map((value) => value === null ? Number.NaN : Date.parse(value))
    .filter(Number.isFinite)
  return timestamps.length === 0 ? null : new Date(Math.max(...timestamps)).toISOString()
}

function pageDetails(total: number, query: PlayerQuery) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  }
}

function degradedStaticResponse(
  request: IncomingMessage,
  response: ServerResponse,
  query: PlayerQuery,
  preview: CareerOraclePreview,
  reason: string,
): void {
  const universe = assignStageRanks(mlbCandidates(preview))
  const candidates = sortBoardCandidates(
    universe.filter((candidate) => matchesQuery(candidate, query)),
    query,
  )
  const offset = (query.page - 1) * query.limit
  const page = candidates.slice(offset, offset + query.limit)
  sendJson(request, response, 200, {
    schemaVersion: 'players.v1',
    items: page.map((candidate) => previewPlayerRecord(
      candidate.previewPlayer!,
      preview,
      candidate.careerForecast!,
    )),
    page: pageDetails(candidates.length, query),
    meta: {
      source: 'Baseball Oracle',
      dataset: 'Career Oracle MLB research preview',
      season: null,
      dataAsOf: isoDate(preview.asOf),
      coverage: 'MLB preview only; the live minor-league directory is unavailable',
      forecastStatus: preview.releaseEligible ? 'published' : 'research_only',
      researchCoverage: candidates.filter(
        (candidate) => candidate.careerForecast?.hofCaliberProbability != null,
      ).length,
      careerChapterCoverage: candidates.filter(
        (candidate) => candidate.careerForecast?.careerChapter?.status === 'research',
      ).length,
      careerChapterVersion: 'career-chapter-v1',
      alphaSignalCoverage: candidates.filter(
        (candidate) => candidate.careerForecast?.alphaSignal?.status === 'research',
      ).length,
      alphaSignalEligible: candidates.filter(
        (candidate) => candidate.careerForecast?.alphaSignal?.eligible === true,
      ).length,
      alphaSignalVersion: 'alpha-signal-v1',
      milbAlphaSignalCoverage: 0,
      milbAlphaSignalEligible: 0,
      milbAlphaSignalVersion: null,
      milbImpactRankingCoverage: 0,
      milbImpactAlphaEligible: 0,
      milbImpactRankingVersion: null,
      milbImpactRankingUniverse: researchMilbImpactSummary.universeRows,
      minorTraitEvidenceVersion: null,
      researchAsOf: preview.asOf,
      releaseEligible: preview.releaseEligible,
      targetVersion: preview.targetVersion,
      stageCoverage: { minors: 0, mlb: mlbCandidates(preview).length },
      degraded: true,
      degradedReason: reason,
      rankScope: 'stage_specific',
      stageRankAvailability: { mlb: true, minors: false },
      facets: buildPlayerFacets(universe, query),
    },
  }, publicCache)
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    sendJson(request, response, 405, { error: 'Method not allowed' })
    return
  }

  const query = parseQuery(request)
  if (!query) {
    sendJson(request, response, 400, { error: 'Invalid query parameters' })
    return
  }

  const careerPreview = loadCareerOraclePreview()

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!databaseUrl) {
    if (careerPreview && query.stage !== 'Minors') {
      degradedStaticResponse(
        request,
        response,
        query,
        careerPreview,
        'The live minor-league database is not configured.',
      )
      return
    }
    sendJson(request, response, 503, { error: 'Player data is not configured' })
    return
  }

  const offset = (query.page - 1) * query.limit

  try {
    const sql = neon(databaseUrl)
    const candidateResult = await sql`
      SELECT
        profile_id,
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
    const minorRoleRows = candidateResult as unknown as MinorCandidateRow[]
    const minorDedupe = dedupeMinorCandidates(minorCandidates(minorRoleRows, careerPreview))
    const mlb = mlbCandidates(careerPreview)
    const merged = mergeCurrentUniverse(mlb, minorDedupe.items)
    const { canonicalMinors, crossStageDuplicatesRemoved } = merged
    const currentUniverse = merged.items
    const facets = buildPlayerFacets(currentUniverse, query)
    const filtered = sortBoardCandidates(
      currentUniverse.filter((candidate) => matchesQuery(candidate, query)),
      query,
    )
    const pageCandidates = filtered.slice(offset, offset + query.limit)
    const minorPageIds = pageCandidates
      .map((candidate) => candidate.minorProfileId)
      .filter((value): value is string => value !== null)

    const rowResult = minorPageIds.length === 0 ? [] : await sql`
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
        levels_observed,
        season,
        bats,
        throws,
        mlbam_id,
        minor_master_id,
        fangraphs_path,
        known_at::text AS known_at,
        has_statcast,
        has_traditional,
        has_complementary_rows,
        cohort_mismatch,
        source_variants,
        organization_conflict,
        ps_score,
        ps_percentile,
        pa,
        ip,
        pitches,
        ba,
        obp,
        slg,
        iso,
        woba,
        xwoba,
        ev,
        ev90,
        max_ev,
        hard_hit_rate,
        barrel_rate,
        chase_rate,
        whiff_rate,
        zone_contact_rate,
        swinging_strike_rate,
        strikeout_rate,
        walk_rate,
        k_minus_bb_rate,
        velocity,
        max_velocity,
        spin_rate,
        woba_percentile,
        xwoba_percentile,
        ev_percentile,
        ev90_percentile,
        max_ev_percentile,
        hard_hit_percentile,
        barrel_percentile,
        chase_percentile,
        whiff_percentile,
        zone_contact_percentile,
        swinging_strike_percentile,
        strikeout_percentile,
        walk_percentile,
        k_minus_bb_percentile,
        velocity_percentile,
        age_percentile
      FROM app.player_directory_snapshot
      WHERE profile_id = ANY(${minorPageIds}::text[])
    `
    const minorRowsById = new Map(
      (rowResult as unknown as PlayerRow[]).map((row) => [row.profile_id, row]),
    )
    if (minorRowsById.size !== minorPageIds.length) {
      throw new Error('Selected minor-league profiles changed during the directory request')
    }

    const items = pageCandidates.map((candidate) => {
      if (candidate.source === 'mlb') {
        return previewPlayerRecord(
          candidate.previewPlayer!,
          careerPreview!,
          candidate.careerForecast!,
        )
      }
      return playerRecord(
        minorRowsById.get(candidate.minorProfileId!)!,
        candidate.careerForecast,
        candidate.milbAlphaSignal,
        candidate.milbImpactRanking,
      )
    })
    const minorDataAsOf = latestIso(minorRoleRows.map((row) => isoDate(row.known_at)))
    const minorSeason = Math.max(
      ...minorRoleRows.map((row) => numberOrNull(row.season) ?? Number.NEGATIVE_INFINITY),
    )

    sendJson(
      request,
      response,
      200,
      {
        schemaVersion: 'players.v1',
        items,
        page: pageDetails(filtered.length, query),
        meta: {
          source: careerPreview ? 'Baseball Oracle + Prospect Savant' : 'Prospect Savant',
          dataset: careerPreview
            ? 'Current Career Oracle universe'
            : 'Minor League Leaders',
          season: Number.isFinite(minorSeason) ? minorSeason : null,
          dataAsOf: latestIso([minorDataAsOf, careerPreview ? isoDate(careerPreview.asOf) : null]),
          coverage: 'Current MLB preview plus live canonical minor-league players; research only',
          forecastStatus: careerPreview?.releaseEligible ? 'published' : 'research_only',
          researchCoverage: currentUniverse.filter(
            (candidate) => candidate.careerForecast?.hofCaliberProbability != null,
          ).length,
          careerChapterCoverage: currentUniverse.filter(
            (candidate) => candidate.careerForecast?.careerChapter?.status === 'research',
          ).length,
          careerChapterVersion: careerPreview ? 'career-chapter-v1' : null,
          alphaSignalCoverage: currentUniverse.filter(
            (candidate) => candidate.careerForecast?.alphaSignal?.status === 'research',
          ).length,
          alphaSignalEligible: currentUniverse.filter(
            (candidate) => candidate.careerForecast?.alphaSignal?.eligible === true,
          ).length,
          alphaSignalVersion: careerPreview ? 'alpha-signal-v1' : null,
          milbAlphaSignalCoverage: currentUniverse.filter(
            (candidate) => candidate.source === 'minor' && candidate.milbAlphaSignal !== null,
          ).length,
          milbAlphaSignalEligible: currentUniverse.filter(
            (candidate) => candidate.source === 'minor' && candidate.milbAlphaSignal?.eligible === true,
          ).length,
          milbAlphaSignalVersion: 'milb-alpha-signal-v1',
          milbImpactRankingCoverage: currentUniverse.filter(
            (candidate) => candidate.source === 'minor' && candidate.milbImpactRanking !== null,
          ).length,
          milbImpactAlphaEligible: currentUniverse.filter(
            (candidate) => candidate.source === 'minor' &&
              candidate.milbAlphaSignal?.eligible === true &&
              (candidate.milbImpactRanking?.rankPercentile ?? -1) >= 90,
          ).length,
          milbImpactRankingVersion: researchMilbImpactSummary.modelVersion,
          milbImpactRankingUniverse: researchMilbImpactSummary.universeRows,
          minorTraitEvidenceVersion: 'minor-trait-evidence-v1',
          researchAsOf: careerPreview?.asOf ?? researchPreviewSummary.asOf,
          releaseEligible: careerPreview?.releaseEligible ?? false,
          targetVersion: careerPreview?.targetVersion ?? null,
          stageCoverage: { minors: canonicalMinors.length, mlb: mlb.length },
          rankScope: 'stage_specific',
          stageRankAvailability: {
            mlb: careerPreview !== null,
            minors: careerPreview !== null,
          },
          facets,
          identity: {
            minorRoleRows: minorDedupe.inputRoleRows,
            canonicalMinorPlayers: canonicalMinors.length,
            duplicateMinorRoleRowsRemoved: minorDedupe.duplicateRoleRowsRemoved,
            crossStageDuplicatesRemoved,
            minorPlayersMissingMlbam: minorDedupe.missingMlbam,
            mlbPlayersMissingMlbam: mlb.filter((candidate) => candidate.mlbamId === null).length,
          },
        },
      },
      publicCache,
    )
  } catch (error) {
    console.error('Player directory query failed', error)
    if (careerPreview && query.stage !== 'Minors') {
      degradedStaticResponse(
        request,
        response,
        query,
        careerPreview,
        'The live minor-league directory query failed.',
      )
      return
    }
    sendJson(request, response, 503, { error: 'Player data is temporarily unavailable' })
  }
}
