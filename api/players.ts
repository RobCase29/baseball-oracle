import { neon } from '@neondatabase/serverless'
import { createHash } from 'node:crypto'
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
  researchLiveMilbImpactPriorRankings,
  type ResearchLiveMilbImpactPriorRanking,
} from './_milb-impact-live-prior.js'
import {
  loadCareerOraclePreview,
  type CareerOraclePreview,
  type CareerPreviewPlayer,
} from './_career-oracle-preview.js'
import type {
  CareerForecast,
} from './_career-oracle-types.js'
import {
  assessCurrentDataFreshness,
  CURRENT_REFRESH_DAILY_MINUTES_UTC,
  type FreshnessRun,
  type RefreshRunStatus,
  type RefreshSourceStatus,
} from './_freshness.js'
import {
  assessMlbIdentityCrosswalkFreshness,
  requireMlbIdentityCrosswalk,
  type MlbIdentityCrosswalk,
} from './_mlb-identity-crosswalk.js'
import { requireChadwickKeyMlbamLookup } from './_chadwick-key-mlbam.js'
import {
  composeMlbIdentityCrosswalk,
  type MlbIdentityOverlayRow,
} from './_mlb-identity-overlay.js'
import {
  buildPlayerMap,
  CAREER_INDEX_VERSION,
  careerIndexWarQuantiles,
  careerIndexValue,
  FROZEN_PROSPECT_FORECAST_UNIVERSE,
  PLAYER_MAP_VERSION,
  type PlayerMapBuildContext,
  type PlayerMapProfile,
} from '../src/domain/playerMap.js'
import {
  classifyPlayerHandling,
  PLAYER_HANDLING_VERSION,
  type PlayerHandlingCode,
} from '../src/domain/playerHandling.js'
import type {
  CurrentMinorStatsSnapshot,
  CurrentMlbStatsSnapshot,
  CurrentProspectScouting,
  PlayerMapFeedItem,
  PlayerRecord,
  ProspectCoverageSummary,
  RecentCallupContext,
  ServedProspectRank,
} from '../src/domain/forecast.js'
import { defaultSortForStage } from '../src/domain/forecast.js'
import type { PlayerSignalsItem } from '../src/domain/playerSignals.js'
import {
  playerSignalsItem,
  playerSignalsResponse,
  playerSignalsSnapshotId,
} from './_player-signals.js'

const playerTypes = ['All', 'Hitter', 'Pitcher', 'Two-way'] as const
const playerStages = ['All', 'Minors', 'RC', 'MLB'] as const
const playerLevels = ['All', 'Rk', 'A', 'A+', 'AA', 'AAA'] as const
const playerSorts = [
  'prospectScore',
  'careerIndex',
  'stageStanding',
  'alphaOpportunity',
  'hofProbability',
  'nearTermImpact',
  'finalWar',
  'arrival36',
  'age',
  'name',
] as const
const playerViews = ['full', 'map', 'signals'] as const
const maximumPlayerIds = 50
const playerMapFeedSchemaVersion = 'player-map-feed.v4' as const
const rankingContractVersion = 'player-ranking-contract/v1' as const
const decisionHierarchyVersion = 'backstop-decision-hierarchy/v1' as const
const rankingSnapshotVersion = 'oracle-ranking-snapshot/v1' as const
const canonicalPlayerIdPattern = /^[A-Za-z0-9][A-Za-z0-9:._~'@/+-]{0,199}$/u
const queryParameterNames = new Set([
  'q',
  'ids',
  'stage',
  'playerType',
  'level',
  'team',
  'position',
  'sort',
  'page',
  'limit',
  'view',
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
  ids: z
    .string()
    .trim()
    .max(10_000)
    .transform((value) => value.split(',').map((entry) => entry.trim()))
    .refine((values) => values.length <= maximumPlayerIds)
    .refine((values) => values.every((value) => canonicalPlayerIdPattern.test(value)))
    .refine((values) => new Set(values).size === values.length)
    .default([]),
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
  sort: z.enum(playerSorts).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  view: z.enum(playerViews).default('full'),
})

type PlayerType = (typeof playerTypes)[number]
type PlayerStage = (typeof playerStages)[number]
type PlayerLevel = (typeof playerLevels)[number]
type PlayerSort = (typeof playerSorts)[number]
type PlayerView = (typeof playerViews)[number]

export interface PlayerQuery {
  q: string
  ids: string[]
  stage: PlayerStage
  playerType: PlayerType
  level: PlayerLevel
  team: string | null
  position: string | null
  sort: PlayerSort
  page: number
  limit: number
  view: PlayerView
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

export interface MinorCandidateRow {
  profile_id: string
  source_player_id: string
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

export interface CurrentMlbValueRow {
  bbref_id: string
  mlbam_id?: DatabaseNumber
  player_name: string
  season: DatabaseNumber
  observed_role: 'Hitter' | 'Pitcher' | 'Two-way'
  team: string | null
  position: string | null
  age: DatabaseNumber
  b_pa: DatabaseNumber
  b_war: DatabaseNumber
  p_ip: string | null
  p_ip_outs: DatabaseNumber
  p_games: DatabaseNumber
  p_games_started: DatabaseNumber
  p_war: DatabaseNumber
  total_war: DatabaseNumber
  current_war_percentile: DatabaseNumber
  known_at: string
}

export interface CurrentMinorStatsRow {
  mlbam_id: DatabaseNumber
  player_type: 'Hitter' | 'Pitcher'
  season: DatabaseNumber
  current_level: string | null
  highest_observed_level: string | null
  levels_observed: unknown
  known_at: string
  pa: DatabaseNumber
  ba: DatabaseNumber
  obp: DatabaseNumber
  slg: DatabaseNumber
  ops: DatabaseNumber
  home_runs: DatabaseNumber
  walks: DatabaseNumber
  strikeouts: DatabaseNumber
  stolen_bases: DatabaseNumber
  ip: DatabaseNumber
  outs: DatabaseNumber
  era: DatabaseNumber
  whip: DatabaseNumber
  pitching_strikeout_rate: DatabaseNumber
  pitching_walk_rate: DatabaseNumber
  k_minus_bb_rate: DatabaseNumber
  pitching_strikeouts: DatabaseNumber
  walks_allowed: DatabaseNumber
}

export interface CurrentMinorProfileRow extends CurrentMinorStatsRow {
  profile_id: string
  display_name: string
  age: DatabaseNumber
  active: boolean | null
  position: string | null
  bats: string | null
  throws: string | null
  organization_mlbam_id: DatabaseNumber
  organization_name: string | null
  current_team_name: string | null
  pitches: DatabaseNumber
}

export interface CurrentMinorRosterRow {
  profile_id: string
  mlbam_id: DatabaseNumber
  player_type: 'Hitter' | 'Pitcher'
  display_name: string
  age: DatabaseNumber
  active: boolean | null
  mlb_debut_date: string | null
  roster_status_code: string | null
  roster_status_description: string | null
  position: string | null
  bats: string | null
  throws: string | null
  organization_mlbam_id: DatabaseNumber
  organization_name: string | null
  current_team_mlbam_id: DatabaseNumber
  current_team_name: string | null
  current_level: string | null
  sport_id: DatabaseNumber
  season: DatabaseNumber
  known_at: string
}

export interface CurrentFangraphsScoutingRow {
  mlbam_id: DatabaseNumber
  source_role: 'Hitter' | 'Pitcher'
  report_season: DatabaseNumber
  org_rank: DatabaseNumber
  overall_rank: DatabaseNumber
  future_value: string | null
  eta: DatabaseNumber
  present_hit: DatabaseNumber
  future_hit: DatabaseNumber
  present_game_power: DatabaseNumber
  future_game_power: DatabaseNumber
  present_raw_power: DatabaseNumber
  future_raw_power: DatabaseNumber
  present_speed: DatabaseNumber
  future_speed: DatabaseNumber
  present_fielding: DatabaseNumber
  future_fielding: DatabaseNumber
  present_arm: DatabaseNumber
  future_arm: DatabaseNumber
  present_fastball: DatabaseNumber
  future_fastball: DatabaseNumber
  present_slider: DatabaseNumber
  future_slider: DatabaseNumber
  present_curveball: DatabaseNumber
  future_curveball: DatabaseNumber
  present_changeup: DatabaseNumber
  future_changeup: DatabaseNumber
  present_splitter: DatabaseNumber
  future_splitter: DatabaseNumber
  present_cutter: DatabaseNumber
  future_cutter: DatabaseNumber
  present_command: DatabaseNumber
  future_command: DatabaseNumber
  bat_control: DatabaseNumber
  pitch_selection: DatabaseNumber
  known_at: string
}

export interface CurrentFangraphsCandidateRow {
  mlbam_id: DatabaseNumber
  current_mlbam_id: DatabaseNumber
  fangraphs_id: string
  minor_master_id: string
  source_role: 'Hitter' | 'Pitcher'
  player_name: string
  organization_code: string | null
  position: string | null
  age: DatabaseNumber
  report_season: DatabaseNumber
  stats_season: DatabaseNumber
  stats_level: string | null
  stats_pa: DatabaseNumber
  stats_ip: DatabaseNumber
  fangraphs_path: string | null
  known_at: string
  mlbam_resolution_status:
    | 'current_exact'
    | 'historical_exact'
    | 'current_tuple_conflict'
    | 'historical_tuple_conflict'
    | 'current_history_conflict'
    | 'historical_census_conflict'
    | 'unresolved'
  mlbam_resolution_conflict: boolean
  current_mlbam_candidate_count: DatabaseNumber
  current_candidate_mlbam_id: DatabaseNumber
  historical_mlbam_candidate_count: DatabaseNumber
  historical_candidate_mlbam_id: DatabaseNumber
  candidate_mlbam_person_tuples: DatabaseNumber
  historical_identity_observations: DatabaseNumber
  identity_known_at: string | null
}

interface CurrentRefreshRow {
  job_key: string
  trigger_kind: string
  status: string
  season: number | null
  started_at: string
  finished_at: string | null
  result: Record<string, unknown> | null
}

interface CurrentSourceSnapshotRow {
  rows: DatabaseNumber
  known_at: string | null
}

interface ObservedMetric {
  key: string
  label: string
  value: string
  percentile: number | null
  source: 'Prospect Savant' | 'Baseball-Reference' | 'MLB StatsAPI'
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

function weakEtagValue(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed
}

export function matchesIfNoneMatch(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (header === undefined) return false
  const values = (Array.isArray(header) ? header : [header])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
  return values.includes('*') || values.some((value) => weakEtagValue(value) === etag)
}

export function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  cacheControl = 'no-store',
): void {
  const json = JSON.stringify(body)
  const etag = `"${createHash('sha256').update(json).digest('base64url')}"`
  response.statusCode = statusCode
  setResponseHeaders(response, cacheControl)
  response.setHeader('ETag', etag)
  if (statusCode === 200 && matchesIfNoneMatch(request.headers?.['if-none-match'], etag)) {
    response.statusCode = 304
    response.removeHeader('Content-Type')
    response.removeHeader('Content-Length')
    response.end()
    return
  }
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
    .replace(/['’]/gu, '')
    .replace(/[-_./]+/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
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
      ids: readSingleParameter(url.searchParams, 'ids'),
      stage: readSingleParameter(url.searchParams, 'stage'),
      playerType: readSingleParameter(url.searchParams, 'playerType'),
      level: readSingleParameter(url.searchParams, 'level'),
      team: readSingleParameter(url.searchParams, 'team'),
      position: readSingleParameter(url.searchParams, 'position'),
      sort: readSingleParameter(url.searchParams, 'sort'),
      page: readSingleParameter(url.searchParams, 'page'),
      limit: readSingleParameter(url.searchParams, 'limit'),
      view: readSingleParameter(url.searchParams, 'view'),
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    )
    if (!parsed.success) return null

    const sort = parsed.data.sort ?? defaultSortForStage(parsed.data.stage)
    if (
      parsed.data.stage === 'All' &&
      sort !== 'name' &&
      sort !== 'age' &&
      sort !== 'careerIndex'
    ) return null
    if (sort === 'prospectScore' && parsed.data.stage !== 'Minors') return null

    return { ...parsed.data, sort }
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

const currentRefreshSourceKeys = [
  'prospectSavant',
  'baseballReference',
  'mlbStatsApi',
  'mlbRoster',
  'fangraphs',
] as const

function currentRefreshRun(row: CurrentRefreshRow): FreshnessRun {
  const sourceStatuses: Record<string, RefreshSourceStatus> = {}
  for (const key of currentRefreshSourceKeys) {
    const sourceResult = row.result?.[key]
    if (!sourceResult || typeof sourceResult !== 'object') continue
    const status = (sourceResult as { status?: unknown }).status
    if (status === 'succeeded' || status === 'failed' || status === 'not_configured') {
      sourceStatuses[key] = status
    }
  }
  return {
    jobKey: row.job_key,
    triggerKind: row.trigger_kind,
    status: row.status as RefreshRunStatus,
    season: row.season,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourceStatuses: Object.keys(sourceStatuses).length > 0 ? sourceStatuses : undefined,
  }
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

export function formatProspectSavantRate(value: DatabaseNumber): string | null {
  const number = numberOrNull(value)
  if (number === null) return null
  return `${number.toFixed(1)}%`
}

function formatFractionRate(value: DatabaseNumber): string | null {
  const number = numberOrNull(value)
  return number === null ? null : `${(number * 100).toFixed(1)}%`
}

export function formatFanGraphsFutureValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  if (/^\d{2}\+$/u.test(trimmed)) return trimmed
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) return trimmed
  if (Number.isInteger(numeric) && numeric >= 22 && numeric <= 82 && numeric % 5 === 2) {
    return `${numeric - 2}+`
  }
  return Number.isInteger(numeric) ? String(numeric) : trimmed
}

export function currentMinorStatsSnapshot(
  row: CurrentMinorStatsRow | null,
): CurrentMinorStatsSnapshot | null {
  if (!row) return null
  const season = roundedNumber(row.season, 0)
  if (season === null) return null
  const levelsObserved = stringArray(row.levels_observed)
  if (row.player_type === 'Hitter') {
    const pa = Math.max(roundedNumber(row.pa, 0) ?? 0, 0)
    return {
      source: 'MLB StatsAPI',
      season,
      asOf: isoDate(row.known_at),
      currentLevel: row.current_level,
      highestObservedLevel: row.highest_observed_level,
      levelsObserved,
      opportunity: { label: 'PA', value: formatCount(pa) ?? '0' },
      hitting: {
        pa,
        ba: roundedNumber(row.ba, 3),
        obp: roundedNumber(row.obp, 3),
        slg: roundedNumber(row.slg, 3),
        ops: roundedNumber(row.ops, 3),
        homeRuns: roundedNumber(row.home_runs, 0),
        walks: roundedNumber(row.walks, 0),
        strikeouts: roundedNumber(row.strikeouts, 0),
        stolenBases: roundedNumber(row.stolen_bases, 0),
      },
      pitching: null,
    }
  }

  const ip = Math.max(roundedNumber(row.ip, 2) ?? 0, 0)
  const outs = Math.max(roundedNumber(row.outs, 0) ?? 0, 0)
  return {
    source: 'MLB StatsAPI',
    season,
    asOf: isoDate(row.known_at),
    currentLevel: row.current_level,
    highestObservedLevel: row.highest_observed_level,
    levelsObserved,
    opportunity: { label: 'IP', value: inningsFromOuts(outs) },
    hitting: null,
    pitching: {
      ip,
      era: roundedNumber(row.era, 2),
      whip: roundedNumber(row.whip, 2),
      strikeoutRate: roundedNumber(row.pitching_strikeout_rate, 4),
      walkRate: roundedNumber(row.pitching_walk_rate, 4),
      kMinusBbRate: roundedNumber(row.k_minus_bb_rate, 4),
      strikeouts: roundedNumber(row.pitching_strikeouts, 0),
      walksAllowed: roundedNumber(row.walks_allowed, 0),
    },
  }
}

export function currentProspectScouting(
  row: CurrentFangraphsScoutingRow | null,
): CurrentProspectScouting | null {
  if (!row) return null
  const reportSeason = roundedNumber(row.report_season, 0)
  if (reportSeason === null) return null
  const grade = (
    key: string,
    label: string,
    present: DatabaseNumber,
    future: DatabaseNumber,
  ) => ({
    key,
    label,
    present: roundedNumber(present, 0),
    future: roundedNumber(future, 0),
  })
  const grades = [
    grade('hit', 'Hit', row.present_hit, row.future_hit),
    grade('game-power', 'Game power', row.present_game_power, row.future_game_power),
    grade('raw-power', 'Raw power', row.present_raw_power, row.future_raw_power),
    grade('speed', 'Speed', row.present_speed, row.future_speed),
    grade('fielding', 'Fielding', row.present_fielding, row.future_fielding),
    grade('arm', 'Arm', row.present_arm, row.future_arm),
    grade('fastball', 'Fastball', row.present_fastball, row.future_fastball),
    grade('slider', 'Slider', row.present_slider, row.future_slider),
    grade('curveball', 'Curveball', row.present_curveball, row.future_curveball),
    grade('changeup', 'Changeup', row.present_changeup, row.future_changeup),
    grade('splitter', 'Splitter', row.present_splitter, row.future_splitter),
    grade('cutter', 'Cutter', row.present_cutter, row.future_cutter),
    grade('command', 'Command', row.present_command, row.future_command),
    grade('bat-control', 'Bat control', null, row.bat_control),
    grade('pitch-selection', 'Pitch selection', null, row.pitch_selection),
  ].filter((entry) => entry.present !== null || entry.future !== null)
  return {
    source: 'FanGraphs',
    reportSeason,
    asOf: isoDate(row.known_at),
    organizationRank: roundedNumber(row.org_rank, 0),
    overallRank: roundedNumber(row.overall_rank, 0),
    futureValue: formatFanGraphsFutureValue(row.future_value),
    futureValueRaw: row.future_value?.trim() || null,
    eta: roundedNumber(row.eta, 0),
    grades,
  }
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

export function currentMlbComparisonRole(input: {
  plateAppearances: DatabaseNumber
  pitchingOuts: DatabaseNumber
}): 'Hitter' | 'Pitcher' {
  const plateAppearances = Math.max(numberOrNull(input.plateAppearances) ?? 0, 0)
  const pitchingOuts = Math.max(numberOrNull(input.pitchingOuts) ?? 0, 0)
  const battingWorkload = plateAppearances / 600
  const pitchingWorkload = pitchingOuts / 540
  const largerWorkload = Math.max(battingWorkload, pitchingWorkload)
  const workloadRatio = largerWorkload > 0
    ? Math.min(battingWorkload, pitchingWorkload) / largerWorkload
    : 0
  if (plateAppearances >= 60 && pitchingOuts >= 60 && workloadRatio >= 0.25) {
    return 'Hitter'
  }
  return pitchingWorkload > battingWorkload ? 'Pitcher' : 'Hitter'
}

export function currentRoleForModeledPlayer(
  modeledRole: 'Hitter' | 'Pitcher' | 'Two-way',
  row: CurrentMlbValueRow | null,
): 'Hitter' | 'Pitcher' {
  if (modeledRole === 'Two-way') return 'Hitter'
  if (row === null) return modeledRole
  const comparisonRole = currentMlbComparisonRole({
    plateAppearances: row.b_pa,
    pitchingOuts: row.p_ip_outs,
  })
  if (comparisonRole === modeledRole) return comparisonRole

  const comparisonOpportunity = comparisonRole === 'Hitter'
    ? Math.max(numberOrNull(row.b_pa) ?? 0, 0)
    : Math.max(numberOrNull(row.p_ip_outs) ?? 0, 0)
  return comparisonOpportunity >= 60 ? comparisonRole : modeledRole
}

function isAggregateMlbTeamCode(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && /^(?:\d+TM|TOT)$/u.test(value.trim())
}

const mlbTeamNames: Record<string, string> = {
  ARI: 'Arizona Diamondbacks', ATH: 'Athletics', ATL: 'Atlanta Braves',
  BAL: 'Baltimore Orioles', BOS: 'Boston Red Sox', CHC: 'Chicago Cubs',
  CHW: 'Chicago White Sox', CIN: 'Cincinnati Reds', CLE: 'Cleveland Guardians',
  COL: 'Colorado Rockies', DET: 'Detroit Tigers', HOU: 'Houston Astros',
  KCR: 'Kansas City Royals', LAA: 'Los Angeles Angels', LAD: 'Los Angeles Dodgers',
  MIA: 'Miami Marlins', MIL: 'Milwaukee Brewers', MIN: 'Minnesota Twins',
  NYM: 'New York Mets', NYY: 'New York Yankees', OAK: 'Oakland Athletics',
  PHI: 'Philadelphia Phillies', PIT: 'Pittsburgh Pirates', SDP: 'San Diego Padres',
  SEA: 'Seattle Mariners', SFG: 'San Francisco Giants', STL: 'St. Louis Cardinals',
  TBR: 'Tampa Bay Rays', TEX: 'Texas Rangers', TOR: 'Toronto Blue Jays',
  WSN: 'Washington Nationals',
}

const mlbTeamCodeByMlbamId: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KCR', 119: 'LAD', 120: 'WSN', 121: 'NYM', 133: 'ATH',
  134: 'PIT', 135: 'SDP', 136: 'SEA', 137: 'SFG', 138: 'STL',
  139: 'TBR', 140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CHW', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}

function currentMinorOrganizationCode(row: CurrentMinorProfileRow): string | null {
  const organizationId = numberOrNull(row.organization_mlbam_id)
  if (organizationId !== null) {
    const exact = mlbTeamCodeByMlbamId[Math.round(organizationId)]
    if (exact) return exact
  }
  const organizationName = row.organization_name?.trim()
  if (!organizationName) return null
  return Object.entries(mlbTeamNames).find(([, name]) => name === organizationName)?.[0] ?? null
}

function currentMinorOrganizationName(row: CurrentMinorProfileRow): string | null {
  const code = currentMinorOrganizationCode(row)
  return (code ? mlbTeamNames[code] : null) ?? row.organization_name
}

function currentMinorRosterOrganizationCode(row: CurrentMinorRosterRow): string | null {
  const organizationId = numberOrNull(row.organization_mlbam_id)
  if (organizationId !== null) {
    const exact = mlbTeamCodeByMlbamId[Math.round(organizationId)]
    if (exact) return exact
  }
  const organizationName = row.organization_name?.trim()
  if (!organizationName) return null
  return Object.entries(mlbTeamNames).find(([, name]) => name === organizationName)?.[0] ?? null
}

function currentMinorRosterOrganizationName(row: CurrentMinorRosterRow): string | null {
  const code = currentMinorRosterOrganizationCode(row)
  return (code ? mlbTeamNames[code] : null) ?? row.organization_name
}

export function currentMlbTeamContext(
  liveTeam: string | null | undefined,
  fallback: { organization: string | null; organizationCode: string | null } | null = null,
): { organization: string | null; organizationCode: string | null; aggregate: boolean } {
  const team = liveTeam?.trim() || null
  if (team !== null && !isAggregateMlbTeamCode(team)) {
    const sameFallbackTeam = fallback?.organizationCode === team
    return {
      organization: sameFallbackTeam
        ? fallback.organization ?? mlbTeamNames[team] ?? team
        : mlbTeamNames[team] ?? team,
      organizationCode: team,
      aggregate: false,
    }
  }
  if (fallback !== null && (fallback.organization !== null || fallback.organizationCode !== null)) {
    return { ...fallback, aggregate: team !== null }
  }
  return {
    organization: team === null ? null : 'Multiple teams',
    organizationCode: null,
    aggregate: team !== null,
  }
}

function metric(
  key: string,
  label: string,
  value: string | null,
  percentile: DatabaseNumber = null,
  source: ObservedMetric['source'] = 'Prospect Savant',
): ObservedMetric | null {
  if (value === null) return null
  return {
    key,
    label,
    value,
    percentile: percentileOrNull(percentile),
    source,
  }
}

export function currentMlbMetrics(
  row: CurrentMlbValueRow | null,
  playerType: 'Hitter' | 'Pitcher' | 'Two-way',
): ObservedMetric[] {
  if (!row) return []
  const war = (value: DatabaseNumber): string | null => {
    const parsed = numberOrNull(value)
    return parsed === null ? null : `${parsed.toFixed(1)} WAR`
  }
  const inningsValue = Number.parseFloat(row.p_ip ?? '')
  const hasBattingOpportunity = playerType !== 'Pitcher' && (numberOrNull(row.b_pa) ?? 0) > 0
  const hasPitchingOpportunity = playerType !== 'Hitter' && Number.isFinite(inningsValue) && inningsValue > 0
  const innings = hasPitchingOpportunity ? `${row.p_ip} IP` : null
  return [
    metric(
      'current-season-war',
      'Current-season WAR',
      war(row.total_war),
      row.current_war_percentile,
      'Baseball-Reference',
    ),
    hasBattingOpportunity
      ? metric('current-season-batting-war', 'Batting WAR', war(row.b_war), null, 'Baseball-Reference')
      : null,
    hasPitchingOpportunity
      ? metric('current-season-pitching-war', 'Pitching WAR', war(row.p_war), null, 'Baseball-Reference')
      : null,
    hasBattingOpportunity
      ? metric('current-season-pa', 'Plate appearances', formatCount(row.b_pa), null, 'Baseball-Reference')
      : null,
    metric('current-season-ip', 'Innings pitched', innings, null, 'Baseball-Reference'),
    hasPitchingOpportunity
      ? metric('current-season-starts', 'Games started', formatCount(row.p_games_started), null, 'Baseball-Reference')
      : null,
  ].filter((entry): entry is ObservedMetric => entry !== null)
}

export function currentMlbStatsSnapshot(
  row: CurrentMlbValueRow | null,
): CurrentMlbStatsSnapshot | null {
  if (!row) return null
  const season = roundedNumber(row.season, 0)
  if (season === null) return null
  const plateAppearances = roundedNumber(row.b_pa, 0)
  const pitchingOuts = roundedNumber(row.p_ip_outs, 0)
  const inningsPitched = pitchingOuts === null ? null : pitchingOuts / 3
  return {
    source: 'Baseball-Reference',
    season,
    asOf: isoDate(row.known_at),
    totalWar: roundedNumber(row.total_war, 2),
    warPercentile: percentileOrNull(row.current_war_percentile),
    hitting: plateAppearances !== null && plateAppearances > 0
      ? {
          pa: plateAppearances,
          war: roundedNumber(row.b_war, 2),
        }
      : null,
    pitching: inningsPitched !== null && inningsPitched > 0
      ? {
          ip: inningsPitched,
          outs: pitchingOuts,
          games: roundedNumber(row.p_games, 0),
          gamesStarted: roundedNumber(row.p_games_started, 0),
          war: roundedNumber(row.p_war, 2),
        }
      : null,
  }
}

function currentMlbOpportunity(
  playerType: 'Hitter' | 'Pitcher' | 'Two-way',
  row: CurrentMlbValueRow | null,
): { label: string; value: string } | null {
  if (!row) return null
  if (playerType === 'Hitter') {
    const value = formatCount(row.b_pa)
    return value === null ? null : { label: 'PA', value }
  }
  if (playerType === 'Pitcher') {
    return row.p_ip ? { label: 'IP', value: row.p_ip } : null
  }
  const pa = formatCount(row.b_pa)
  if (pa && row.p_ip) return { label: 'PA / IP', value: `${pa} / ${row.p_ip}` }
  return pa ? { label: 'PA', value: pa } : row.p_ip ? { label: 'IP', value: row.p_ip } : null
}

export function withholdForecastForCurrentRoleTransition(
  forecast: CareerForecast,
  modeledRole: 'Hitter' | 'Pitcher' | 'Two-way',
  currentRole: 'Hitter' | 'Pitcher' | 'Two-way',
): CareerForecast {
  if (modeledRole === currentRole) return forecast
  return {
    ...forecast,
    publicationState: 'withheld',
    releaseEligible: false,
    rank: null,
    hofCaliberProbability: null,
    finalCareerWar: null,
    finalCareerWarConditionalOnArrival: null,
    peakSevenWar: null,
    finalJaws: null,
    scenarioSupportExtensionJaws: null,
    arrivalProbability36: null,
    confidenceScore: null,
    confidenceState: 'Withheld',
    intervalWidth: null,
    arc: [],
    decomposition: {
      ...forecast.decomposition,
      hofCaliberGivenMlbProbability: null,
    },
    hofStandard: null,
    summary: 'Current-season role differs from the completed-season model role, so the terminal career forecast is withheld.',
    drivers: [],
    warnings: forecast.warnings.includes('current_role_transition_forecast_withheld')
      ? forecast.warnings
      : [...forecast.warnings, 'current_role_transition_forecast_withheld'],
    relativeSignal: null,
    careerChapter: null,
    alphaSignal: null,
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
    metric('chase-rate', 'Chase rate', formatProspectSavantRate(row.chase_rate), row.chase_percentile),
    metric('whiff-rate', 'Whiff rate', formatProspectSavantRate(row.whiff_rate), row.whiff_percentile),
    metric('swinging-strike-rate', 'Swinging-strike rate', formatProspectSavantRate(row.swinging_strike_rate), row.swinging_strike_percentile),
    metric('strikeout-rate', 'Strikeout rate', formatProspectSavantRate(row.strikeout_rate), row.strikeout_percentile),
    metric('walk-rate', 'Walk rate', formatProspectSavantRate(row.walk_rate), row.walk_percentile),
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
        metric('hard-hit-rate', 'Hard-hit rate', formatProspectSavantRate(row.hard_hit_rate), row.hard_hit_percentile),
        metric('barrel-rate', 'Barrel rate', formatProspectSavantRate(row.barrel_rate), row.barrel_percentile),
        metric('zone-contact-rate', 'Zone contact rate', formatProspectSavantRate(row.zone_contact_rate), row.zone_contact_percentile),
      ]
    : [
        metric('velocity', 'Average velocity', formatMeasurement(row.velocity, 'mph'), row.velocity_percentile),
        metric('max-velocity', 'Maximum velocity', formatMeasurement(row.max_velocity, 'mph')),
        metric('spin-rate', 'Spin rate', formatMeasurement(row.spin_rate, 'rpm')),
        metric('k-minus-bb-rate', 'K-BB rate', formatProspectSavantRate(row.k_minus_bb_rate), row.k_minus_bb_percentile),
      ]

  return [...common, ...roleSpecific].filter(
    (entry): entry is ObservedMetric => entry !== null,
  )
}

function currentMinorObservedMetrics(
  snapshot: CurrentMinorStatsSnapshot | null,
): ObservedMetric[] {
  if (!snapshot) return []
  const hitting = snapshot.hitting
  const pitching = snapshot.pitching
  return [
    hitting ? metric('official-season-pa', 'Official season PA', formatCount(hitting.pa), null, 'MLB StatsAPI') : null,
    hitting ? metric('official-season-ba', 'Season batting average', formatDecimal(hitting.ba), null, 'MLB StatsAPI') : null,
    hitting ? metric('official-season-obp', 'Season on-base percentage', formatDecimal(hitting.obp), null, 'MLB StatsAPI') : null,
    hitting ? metric('official-season-slg', 'Season slugging', formatDecimal(hitting.slg), null, 'MLB StatsAPI') : null,
    hitting ? metric('official-season-home-runs', 'Season home runs', formatCount(hitting.homeRuns), null, 'MLB StatsAPI') : null,
    hitting ? metric('official-season-stolen-bases', 'Season stolen bases', formatCount(hitting.stolenBases), null, 'MLB StatsAPI') : null,
    pitching ? metric('official-season-ip', 'Official season IP', snapshot.opportunity.value, null, 'MLB StatsAPI') : null,
    pitching ? metric('official-season-era', 'Season ERA', formatDecimal(pitching.era, 2), null, 'MLB StatsAPI') : null,
    pitching ? metric('official-season-whip', 'Season WHIP', formatDecimal(pitching.whip, 2), null, 'MLB StatsAPI') : null,
    pitching ? metric('official-season-k-rate', 'Season strikeout rate', formatFractionRate(pitching.strikeoutRate), null, 'MLB StatsAPI') : null,
    pitching ? metric('official-season-bb-rate', 'Season walk rate', formatFractionRate(pitching.walkRate), null, 'MLB StatsAPI') : null,
  ].filter((entry): entry is ObservedMetric => entry !== null)
}

function coverageLabel(row: PlayerRow, hasOfficialStats = false): string {
  if (hasOfficialStats && row.has_statcast) return 'Official season totals and Statcast tracking'
  if (hasOfficialStats) return 'Official season totals and current player profile'
  if (row.has_statcast && row.has_traditional) return 'Statcast and traditional statistics'
  if (row.has_statcast) return 'Statcast tracking'
  if (row.has_traditional) return 'Traditional statistics'
  return 'Player profile only'
}

export function currentMinorAgePercentile(
  prospectSavantLevel: string,
  agePercentile: DatabaseNumber,
  displayedLevel: string | null,
): number | null {
  if (displayedLevel !== null && displayedLevel !== prospectSavantLevel) {
    return null
  }
  return percentileOrNull(agePercentile)
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

function inningsFromOuts(outs: number): string {
  const normalizedOuts = Math.max(Math.round(outs), 0)
  return `${Math.floor(normalizedOuts / 3)}.${normalizedOuts % 3}`
}

export function minorTwoWayEvidenceDisplay(
  representativeRole: 'Hitter' | 'Pitcher',
  workload: { plateAppearances: number; pitchingOuts: number },
) {
  return {
    opportunity: {
      label: 'PA / IP',
      value: `${formatCount(workload.plateAppearances) ?? '0'} / ${inningsFromOuts(workload.pitchingOuts)}`,
    },
    coverageLabel: `Two-way workload; partial metrics shown from representative ${representativeRole.toLocaleLowerCase('en-US')} row`,
  }
}

function playerRecord(
  row: PlayerRow,
  careerForecast: CareerForecast | null,
  milbAlphaSignal: ResearchMilbAlphaSignal | null,
  milbImpactRanking: ResearchMilbImpactRanking | null,
  context: PlayerMapBuildContext,
  lifecycle: {
    stage: 'pre_debut' | 'post_debut_minors'
    mlbamId: string | null
    playerType?: 'Hitter' | 'Pitcher' | 'Two-way'
    position?: string | null
    minorRoleWorkload?: {
      plateAppearances: number
      pitchingOuts: number
    }
    currentMinorStats?: CurrentMinorStatsRow | null
    currentProspectScouting?: CurrentFangraphsScoutingRow | null
    age?: number | null
    level?: string | null
    organization?: string | null
    organizationCode?: string | null
    profileSource?: 'Prospect Savant' | 'MLB StatsAPI' | 'MLB StatsAPI Roster' | 'FanGraphs'
    rosterStatus?: {
      code: string | null
      description: string | null
      asOf: string | null
    } | null
    servedProspectRank?: ServedProspectRank | null
  } = { stage: 'pre_debut', mlbamId: databaseIdentifier(row.mlbam_id) },
) {
  const bats = row.bats && row.bats !== '0' ? row.bats : null
  const throws = row.throws && row.throws !== '0' ? row.throws : null
  const batsThrows = bats && throws ? `${bats}/${throws}` : bats ?? throws

  const officialStats = currentMinorStatsSnapshot(lifecycle.currentMinorStats ?? null)
  const scouting = currentProspectScouting(lifecycle.currentProspectScouting ?? null)
  const displayedLevel = officialStats?.currentLevel ?? lifecycle.level ?? row.level
  const trackedMetrics = observedMetrics(row).filter((entry) => (
    officialStats === null || ![
      'batting-average',
      'on-base-percentage',
      'slugging',
    ].includes(entry.key)
  ))
  const metrics = [...currentMinorObservedMetrics(officialStats), ...trackedMetrics]
  const twoWayEvidence = lifecycle.playerType === 'Two-way' && lifecycle.minorRoleWorkload
    ? minorTwoWayEvidenceDisplay(row.player_type, lifecycle.minorRoleWorkload)
    : null
  const stageCoverageSuffix = lifecycle.stage === 'post_debut_minors'
    ? ' after verified MLB experience'
    : ''
  const profileSource = lifecycle.profileSource ?? 'Prospect Savant'
  const prospectSavantProfile = profileSource === 'Prospect Savant'
  const profileDataset = profileSource === 'MLB StatsAPI'
    ? {
        dataset: 'Current MiLB Season Stats',
        datasetKey: 'current-milb-season-stats',
      }
    : profileSource === 'MLB StatsAPI Roster'
      ? {
          dataset: 'Current MiLB Rosters',
          datasetKey: 'current-milb-rosters',
        }
    : profileSource === 'FanGraphs'
      ? {
          dataset: 'Current Prospect Scouting',
          datasetKey: 'fangraphs-current-scouting',
        }
      : {
          dataset: 'Minor League Leaders',
          datasetKey: 'minor-league-leaders',
        }
  const record = {
    id: row.profile_id,
    name: row.display_name,
    initials: initials(row.display_name),
    organization: lifecycle.organization !== undefined
      ? lifecycle.organization
      : row.organization_name ?? row.organization_code,
    organizationCode: lifecycle.organizationCode !== undefined
      ? lifecycle.organizationCode
      : row.organization_code,
    position: lifecycle.position ?? row.position,
    playerType: lifecycle.playerType ?? row.player_type,
    stage: lifecycle.stage,
    age: lifecycle.age !== undefined ? lifecycle.age : roundedNumber(row.age, 0),
    level: displayedLevel,
    batsThrows,
    rosterStatus: lifecycle.rosterStatus ?? null,
    psScore: roundedNumber(row.ps_score, 2),
    psPercentile: percentileOrNull(row.ps_percentile),
    agePercentile: currentMinorAgePercentile(
      row.level,
      row.age_percentile,
      displayedLevel,
    ),
    currentMinorStats: officialStats,
    currentProspectScouting: scouting,
    opportunity: twoWayEvidence?.opportunity ?? officialStats?.opportunity ?? opportunity(row),
    metrics,
    coverage: {
      label: `${twoWayEvidence?.coverageLabel ?? coverageLabel(row, officialStats !== null)}${stageCoverageSuffix}`,
      hasStatcast: row.has_statcast === true,
      hasTraditional: officialStats !== null || row.has_traditional === true,
      hasComplementaryRows: officialStats !== null || scouting !== null || row.has_complementary_rows === true,
      levelsObserved: [...new Set([
        ...(officialStats?.levelsObserved ?? []),
        ...stringArray(row.levels_observed),
      ])],
      sourceVariants: [...new Set([
        ...stringArray(row.source_variants),
        ...(officialStats ? ['mlb-statsapi-current-milb'] : []),
        ...(scouting ? ['fangraphs-current-scouting'] : []),
      ])],
      organizationConflict: row.organization_conflict === true,
      cohortMismatch: row.cohort_mismatch === true,
    },
    provenance: {
      source: profileSource,
      ...profileDataset,
      season: roundedNumber(row.season, 0),
      retrievedAt: isoDate(row.known_at),
      cohort: prospectSavantProfile
        ? {
            pitchQualifier: 1,
            minAge: 16,
            maxAge: 40,
          }
        : null,
      externalIds: {
        prospectSavant: prospectSavantProfile ? row.source_player_id : null,
        mlbam: lifecycle.mlbamId,
        minorMaster: row.minor_master_id,
        fangraphsPath: row.fangraphs_path,
      },
    },
    researchEstimate: lifecycle.stage === 'pre_debut' && lifecycle.playerType !== 'Two-way'
      ? researchArrivalEstimate(lifecycle.mlbamId, row.player_type)
      : null,
    milbAlphaSignal,
    milbImpactRanking,
    servedProspectRank: lifecycle.servedProspectRank ?? null,
    minorTraitEvidence: lifecycle.playerType === 'Two-way'
      ? null
      : minorTraitEvidence({
          playerType: row.player_type,
          metrics,
          opportunity: {
            plateAppearances: row.pa,
            inningsPitched: row.ip,
            pitches: row.pitches,
          },
        }),
    careerForecast,
    recentCallup: null,
  }
  return {
    ...record,
    playerMap: buildPlayerMap(record, context),
  }
}

function previewPlayerRecord(
  candidate: UnifiedBoardCandidate,
  preview: CareerOraclePreview,
  buildContext: PlayerMapBuildContext,
) {
  const player = candidate.previewPlayer
  const careerForecast = candidate.careerForecast
  if (player === null || careerForecast === null) {
    throw new Error('Modeled MLB record is missing its preview forecast')
  }
  const currentStats = candidate.currentStats ?? null
  const currentOpportunity = currentMlbOpportunity(candidate.playerType, currentStats)
  const currentMlbEvidence = {
    asOf: isoDate(currentStats?.known_at ?? null),
    opportunity: currentOpportunity,
    war: roundedNumber(currentStats?.total_war ?? null, 2),
    warPercentile: percentileOrNull(currentStats?.current_war_percentile ?? null),
  }
  const recentCallup: RecentCallupContext | null = isRecentCallupPreviewPlayer(player)
    ? {
        version: 'rookie-track-v2',
        status: 'monitoring',
        reason: 'first_mlb_season_partial_only',
        prospectPrior: candidate.recentCallupPrior,
        currentMlbEvidence,
      }
    : null
  const levelsObserved = [...new Set(
    [player.level, 'MLB']
      .filter((value): value is string => Boolean(value)),
  )]

  const record = {
    id: player.id,
    name: player.name,
    initials: initials(player.name),
    organization: candidate.organization,
    organizationCode: candidate.organizationCode,
    position: candidate.position,
    playerType: candidate.playerType,
    stage: recentCallup ? 'recent_callup' as const : player.stage,
    age: candidate.age,
    level: candidate.level,
    batsThrows: player.batsThrows,
    psScore: null,
    psPercentile: null,
    agePercentile: null,
    currentMlbStats: currentMlbStatsSnapshot(currentStats),
    opportunity: currentOpportunity,
    metrics: currentMlbMetrics(currentStats, candidate.playerType),
    coverage: {
      label: currentStats
        ? 'Current MLB value statistics and career model'
        : 'Career model evidence; current value statistics unavailable',
      hasStatcast: false,
      hasTraditional: currentStats !== null,
      hasComplementaryRows: false,
      levelsObserved,
      sourceVariants: currentStats
        ? [`baseball-reference-current-${currentStats.observed_role.toLowerCase()}`]
        : [],
      organizationConflict: false,
      cohortMismatch: false,
    },
    provenance: {
      source: currentStats ? 'Baseball-Reference + Baseball Oracle' : 'Baseball Oracle',
      dataset: currentStats
        ? 'Current MLB value and Career Oracle research preview'
        : 'Career Oracle research preview',
      datasetKey: currentStats
        ? `baseball-reference-current-value+${preview.modelVersion}`
        : preview.modelVersion,
      season: currentStats ? roundedNumber(currentStats.season, 0) : null,
      retrievedAt: isoDate(currentStats?.known_at ?? preview.asOf),
      cohort: null,
      externalIds: {
        ...player.externalIds,
        mlbam: candidate.mlbamId,
      },
    },
    researchEstimate: null,
    milbAlphaSignal: null,
    milbImpactRanking: null,
    minorTraitEvidence: null,
    careerForecast,
    recentCallup,
  }
  return {
    ...record,
    playerMap: buildPlayerMap(record, buildContext),
  }
}

function currentOnlyMlbPlayerRecord(
  candidate: UnifiedBoardCandidate,
  buildContext: PlayerMapBuildContext,
): MappedPlayerRecord {
  const currentStats = candidate.currentStats
  if (!currentStats) throw new Error('Current-only MLB candidate is missing current statistics')
  const currentOpportunity = currentMlbOpportunity(candidate.playerType, currentStats)
  const currentMlbEvidence = {
    asOf: isoDate(currentStats.known_at),
    opportunity: currentOpportunity,
    war: roundedNumber(currentStats.total_war, 2),
    warPercentile: percentileOrNull(currentStats.current_war_percentile),
  }
  const recentCallup = candidate.stage === 'recent_callup'
    ? {
        version: 'rookie-track-v2' as const,
        status: 'monitoring' as const,
        reason: 'current_mlb_record_not_in_model_census' as const,
        prospectPrior: candidate.recentCallupPrior,
        currentMlbEvidence,
      }
    : null
  const record = {
    id: candidate.id,
    name: candidate.name,
    initials: initials(candidate.name),
    organization: candidate.organization,
    organizationCode: candidate.organizationCode,
    position: candidate.position,
    playerType: candidate.playerType,
    stage: candidate.stage,
    age: candidate.age,
    level: 'MLB',
    batsThrows: null,
    psScore: null,
    psPercentile: null,
    agePercentile: null,
    currentMlbStats: currentMlbStatsSnapshot(currentStats),
    opportunity: currentOpportunity,
    metrics: currentMlbMetrics(currentStats, candidate.playerType),
    coverage: {
      label: 'Current MLB statistics; career model match pending',
      hasStatcast: false,
      hasTraditional: true,
      hasComplementaryRows: false,
      levelsObserved: ['MLB'],
      sourceVariants: [`baseball-reference-current-${currentStats.observed_role.toLowerCase()}`],
      organizationConflict: false,
      cohortMismatch: false,
    },
    provenance: {
      source: 'Baseball-Reference',
      dataset: 'Current MLB value outside the completed-season model census',
      datasetKey: 'baseball-reference-current-value',
      season: roundedNumber(currentStats.season, 0),
      retrievedAt: isoDate(currentStats.known_at),
      cohort: null,
      externalIds: {
        bbref: currentStats.bbref_id,
        mlbam: candidate.mlbamId,
      },
    },
    researchEstimate: null,
    milbAlphaSignal: null,
    milbImpactRanking: null,
    minorTraitEvidence: null,
    careerForecast: null,
    recentCallup,
  }
  return {
    ...record,
    playerMap: buildPlayerMap(record, buildContext),
  }
}

interface MappedPlayerRecord extends PlayerRecord {
  playerMap: PlayerMapProfile
}

export function canonicalExternalId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.length > 0 ? value : null
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
}

export function playerMapFeedItem(record: MappedPlayerRecord): PlayerMapFeedItem {
  return {
    playerId: record.id,
    identity: {
      name: record.name,
    },
    externalIds: Object.fromEntries(Object.entries(record.provenance.externalIds).map(
      ([key, value]) => [key, canonicalExternalId(value)],
    )),
    context: {
      playerType: record.playerType,
      stage: record.stage,
      age: record.age,
      level: record.level,
      organization: record.organization,
      organizationCode: record.organizationCode,
      position: record.position,
    },
    currentEvidence: {
      minorStats: record.currentMinorStats ?? null,
      prospectScouting: record.currentProspectScouting ?? null,
    },
    assessment: {
      ...record.playerMap,
      oracleScore: {
        ...record.playerMap.oracleScore,
        deprecated: true,
        replacement: 'careerIndex',
      },
    },
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

function previewBbrefId(player: CareerPreviewPlayer): string | null {
  const value = player.externalIds.bbref ?? player.externalIds.baseballReference
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[a-z0-9][a-z0-9_.'-]{2,9}\d{2}$/u.test(trimmed) ? trimmed : null
}

function isMlbPreviewPlayer(
  player: CareerPreviewPlayer,
): player is CareerPreviewPlayer & { stage: 'early_mlb' | 'established_mlb' } {
  return player.stage === 'early_mlb' || player.stage === 'established_mlb'
}

function prospectRole(playerType: 'Hitter' | 'Pitcher' | 'Two-way'): 'hitter' | 'pitcher' | null {
  if (playerType === 'Hitter' || playerType === 'Two-way') return 'hitter'
  if (playerType === 'Pitcher') return 'pitcher'
  return null
}

export function frozenProspectRankUniverse(
  preview: CareerOraclePreview | null,
): number | null {
  if (preview === null) return null
  const forecasts = Object.values(preview.prospectForecasts)
  if (forecasts.length !== FROZEN_PROSPECT_FORECAST_UNIVERSE) return null
  const supported = forecasts.filter(
    (entry) => entry.careerForecast.publicationState !== 'withheld',
  )
  const ranks = supported.map((entry) => entry.careerForecast.rank)
  if (
    ranks.some((rank) => rank === null) ||
    forecasts.some((entry) => (
      entry.careerForecast.publicationState === 'withheld' &&
      entry.careerForecast.rank !== null
    ))
  ) return null

  const completeRanks = ranks as number[]
  const universe = supported.length
  const uniqueRanks = new Set(completeRanks)
  const isCompleteOrdinalUniverse = uniqueRanks.size === universe &&
    completeRanks.every((rank) => Number.isInteger(rank) && rank >= 1 && rank <= universe)
  return isCompleteOrdinalUniverse ? universe : null
}

export function recentCallupProspectPrior(
  player: CareerPreviewPlayer,
  preview: CareerOraclePreview,
): RecentCallupContext['prospectPrior'] | null {
  if (!isRecentCallupPreviewPlayer(player)) return null
  const mlbamId = previewMlbamId(player)
  return prospectPriorByIdentity(mlbamId, player.playerType, preview)
}

export function prospectPriorByIdentity(
  mlbamId: string | null,
  playerType: 'Hitter' | 'Pitcher' | 'Two-way',
  preview: CareerOraclePreview,
): RecentCallupContext['prospectPrior'] | null {
  const role = prospectRole(playerType)
  if (role === null || mlbamId === null) return null

  const prior = preview.prospectForecasts[`${mlbamId}:${role}`]
  if (!prior || prior.playerType !== playerType) return null
  const impactPlayerType = playerType === 'Pitcher' ? 'Pitcher' : 'Hitter'
  const impact = researchMilbImpactRanking(mlbamId, impactPlayerType)
  const arrivalSignal = researchMilbAlphaSignal(mlbamId, impactPlayerType)
  const impactUsesPrior = Boolean(
    impact &&
    arrivalSignal?.gates.minimumRawWorkload === false &&
    Number.isInteger(impact.priorRank),
  )
  const impactRank = impact
    ? {
        rank: impactUsesPrior ? impact.priorRank : impact.rank,
        universe: impact.universeRows,
        target: impact.target.id,
        asOf: impact.frozenAsOf,
        modelVersion: impact.modelVersion,
        evidenceTier: impactUsesPrior ? 'early_estimate' as const : 'full_model' as const,
      }
    : null

  const rawCareerRank = prior.careerForecast.rank
  const careerUniverse = frozenProspectRankUniverse(preview)
  const careerRankSupported = prior.careerForecast.publicationState !== 'withheld' &&
    rawCareerRank !== null &&
    careerUniverse !== null &&
    rawCareerRank <= careerUniverse
  if (!impactRank && !careerRankSupported) return null

  return {
    rank: careerRankSupported ? rawCareerRank : null,
    universe: careerRankSupported ? careerUniverse : null,
    target: prior.careerForecast.lineage.targetVersion,
    asOf: prior.careerForecast.asOf,
    forecast: prior.careerForecast,
    impactRank,
  }
}

export function isRecentCallupPreviewPlayer(player: CareerPreviewPlayer): boolean {
  return player.stage === 'early_mlb' &&
    player.careerForecast.careerChapter?.evidence.mlbSeasonNumber === 1 &&
    player.careerForecast.warnings.includes('partial_only_unvalidated_forecast_withheld')
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
  stage: 'pre_debut' | 'post_debut_minors' | 'recent_callup' | 'early_mlb' | 'established_mlb'
  age: number | null
  level: string | null
  organization: string | null
  organizationCode: string | null
  position: string | null
  mlbamId: string | null
  opportunityScore: number
  minorRoleWorkload?: {
    plateAppearances: number
    pitchingOuts: number
  }
  careerForecast: CareerForecast | null
  milbAlphaSignal: ResearchMilbAlphaSignal | null
  milbImpactRanking: ResearchMilbImpactRanking | null
  liveMilbImpactPriorRanking?: ResearchLiveMilbImpactPriorRanking | null
  servedProspectRank?: ServedProspectRank | null
  arrivalProbability36: number | null
  minorProfileId: string | null
  minorProfileSource?: 'prospectSavant' | 'mlbStatsApi' | 'mlbStatsApiRoster' | 'fangraphs'
  rosterStatus?: {
    code: string | null
    description: string | null
    asOf: string | null
  } | null
  previewPlayer: CareerPreviewPlayer | null
  recentCallupPrior: RecentCallupContext['prospectPrior'] | null
  currentStats?: CurrentMlbValueRow | null
}

function candidateKey(candidate: UnifiedBoardCandidate): string {
  return `${candidate.source}:${candidate.id}`
}

function candidateOutcomeForecast(candidate: UnifiedBoardCandidate) {
  const forecast = candidate.stage === 'recent_callup'
    ? candidate.recentCallupPrior?.forecast ?? null
    : candidate.careerForecast
  return forecast?.publicationState === 'withheld' ? null : forecast
}

function candidateOutcomeRank(candidate: UnifiedBoardCandidate): number | null {
  if (candidate.stage === 'recent_callup') {
    return candidate.recentCallupPrior?.impactRank?.rank ?? null
  }
  return candidate.careerForecast?.publicationState === 'withheld'
    ? null
    : candidate.careerForecast?.rank ?? null
}

function candidateCareerIndex(candidate: UnifiedBoardCandidate): number | null {
  const forecast = candidateOutcomeForecast(candidate)
  return careerIndexValue(
    careerIndexWarQuantiles(candidatePlayerMapRoute(candidate), forecast),
  )
}

function prospectScoringRole(
  playerType: UnifiedBoardCandidate['playerType'],
): 'Hitter' | 'Pitcher' {
  return playerType === 'Pitcher' ? 'Pitcher' : 'Hitter'
}

function safeRate(numerator: DatabaseNumber, denominator: DatabaseNumber): number | null {
  const top = numberOrNull(numerator)
  const bottom = numberOrNull(denominator)
  return top !== null && bottom !== null && bottom > 0 ? top / bottom : null
}

function officialCurrentMinorWorkloadObserved(
  row: CurrentMinorProfileRow,
  scoringRole: 'Hitter' | 'Pitcher',
): boolean {
  return scoringRole === 'Pitcher'
    ? (numberOrNull(row.outs) ?? 0) > 0 || (numberOrNull(row.ip) ?? 0) > 0
    : (numberOrNull(row.pa) ?? 0) > 0
}

export function attachLiveProspectPriorRankings(
  candidates: UnifiedBoardCandidate[],
  currentStatsRows: CurrentMinorProfileRow[],
): UnifiedBoardCandidate[] {
  const statsByIdentity = new Map<string, CurrentMinorProfileRow>()
  for (const row of currentStatsRows) {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    if (mlbamId === null) continue
    const identity = `${mlbamId}:${row.player_type}`
    if (statsByIdentity.has(identity)) {
      throw new Error(`Duplicate official current MiLB stat identity: ${identity}`)
    }
    statsByIdentity.set(identity, row)
  }

  const inputs = candidates.flatMap((candidate) => {
    if (
      candidate.source !== 'minor' ||
      candidate.stage !== 'pre_debut' ||
      candidate.mlbamId === null ||
      candidate.milbImpactRanking !== null
    ) return []
    const scoringRole = prospectScoringRole(candidate.playerType)
    const row = statsByIdentity.get(`${candidate.mlbamId}:${scoringRole}`)
    if (!row) return []
    const officialStatsObserved = officialCurrentMinorWorkloadObserved(row, scoringRole)
    if (!officialStatsObserved) return []
    return [{
      mlbamId: candidate.mlbamId,
      playerType: scoringRole,
      officialStatsObserved,
      season: row.season,
      knownAt: row.known_at,
      age: row.age ?? candidate.age,
      level: row.current_level ?? row.highest_observed_level ?? candidate.level,
      teamName: row.current_team_name,
      pa: row.pa,
      ba: row.ba,
      slg: row.slg,
      walkRate: safeRate(row.walks, row.pa),
      strikeoutRate: safeRate(row.strikeouts, row.pa),
      ip: row.ip,
      kMinusBbRate: row.k_minus_bb_rate,
    }]
  })
  const liveRankings = researchLiveMilbImpactPriorRankings(inputs)

  return candidates.map((candidate) => {
    const mlbamId = candidate.mlbamId
    if (
      candidate.source !== 'minor' ||
      candidate.stage !== 'pre_debut' ||
      mlbamId === null ||
      candidate.milbImpactRanking !== null
    ) {
      return {
        ...candidate,
        liveMilbImpactPriorRanking: null,
        servedProspectRank: null,
      }
    }
    const role = prospectScoringRole(candidate.playerType).toLocaleLowerCase('en-US')
    return {
      ...candidate,
      liveMilbImpactPriorRanking: liveRankings.get(`${mlbamId}:${role}`) ?? null,
      servedProspectRank: null,
    }
  })
}

interface ProspectOrdinalBasis {
  sourcePercentile: number
  sourceRank: number
  asOf: string
  modelVersion: ServedProspectRank['modelVersion']
  evidenceTier: ServedProspectRank['evidenceTier']
  reasonCode: ServedProspectRank['reasonCode']
  volatility: ServedProspectRank['volatility']
  target: ServedProspectRank['target']
}

function supportedPercentile(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function candidateProspectOrdinalBasis(
  candidate: UnifiedBoardCandidate,
): ProspectOrdinalBasis | null {
  if (candidate.source !== 'minor' || candidate.stage !== 'pre_debut') return null
  const frozen = candidate.milbImpactRanking
  if (frozen !== null) {
    const usesPrior = candidate.milbAlphaSignal?.gates.minimumRawWorkload === false
    const sourceRank = usesPrior ? frozen.priorRank : frozen.rank
    const sourcePercentile = usesPrior ? frozen.priorRankPercentile : frozen.rankPercentile
    if (!Number.isInteger(sourceRank) || !supportedPercentile(sourcePercentile)) return null
    return {
      sourcePercentile,
      sourceRank,
      asOf: frozen.frozenAsOf,
      modelVersion: frozen.modelVersion,
      evidenceTier: usesPrior
        ? 'completed_season_prior'
        : 'completed_season_full_model',
      reasonCode: usesPrior ? 'thin_sample_prior' : null,
      volatility: usesPrior ? 'high' : 'standard',
      target: {
        id: frozen.target.id,
        label: frozen.target.label,
        scope: frozen.target.scope,
        windowStartSeason: frozen.target.windowStartSeason,
        windowEndSeason: frozen.target.windowEndSeason,
      },
    }
  }

  const live = candidate.liveMilbImpactPriorRanking ?? null
  if (live === null || !Number.isInteger(live.rank) || !supportedPercentile(live.rankPercentile)) {
    return null
  }
  return {
    sourcePercentile: live.rankPercentile,
    sourceRank: live.rank,
    asOf: live.featureAsOf,
    modelVersion: 'milb-impact-live-prior-v1',
    evidenceTier: 'live_in_season_prior',
    reasonCode: 'live_in_season_prior',
    volatility: live.volatility,
    target: { ...live.target },
  }
}

const prospectEvidenceTierOrder: Record<ServedProspectRank['evidenceTier'], number> = {
  completed_season_full_model: 0,
  completed_season_prior: 1,
  live_in_season_prior: 2,
}

function exactProspectIdentityCompare(
  left: UnifiedBoardCandidate,
  right: UnifiedBoardCandidate,
): number {
  if (left.mlbamId !== null && right.mlbamId !== null) {
    const leftMlbam = BigInt(left.mlbamId)
    const rightMlbam = BigInt(right.mlbamId)
    if (leftMlbam !== rightMlbam) return leftMlbam < rightMlbam ? -1 : 1
  }
  return prospectScoringRole(left.playerType).localeCompare(
    prospectScoringRole(right.playerType),
    'en-US',
  ) || left.id.localeCompare(right.id)
}

export function assignServedProspectRanks(
  candidates: UnifiedBoardCandidate[],
): UnifiedBoardCandidate[] {
  const reset = candidates.map((candidate) => ({ ...candidate, servedProspectRank: null }))
  const scoreable = reset.flatMap((candidate) => {
    const basis = candidateProspectOrdinalBasis(candidate)
    return basis === null ? [] : [{ candidate, basis }]
  }).toSorted((left, right) => (
    right.basis.sourcePercentile - left.basis.sourcePercentile ||
    prospectEvidenceTierOrder[left.basis.evidenceTier] -
      prospectEvidenceTierOrder[right.basis.evidenceTier] ||
    left.basis.sourceRank - right.basis.sourceRank ||
    exactProspectIdentityCompare(left.candidate, right.candidate)
  ))
  const universeRows = scoreable.length
  const servedByCandidate = new Map<string, ServedProspectRank>()
  scoreable.forEach(({ candidate, basis }, index) => {
    const rank = index + 1
    servedByCandidate.set(candidateKey(candidate), {
      rank,
      rankPercentile: universeRows <= 1
        ? 100
        : Math.round(100_000_000 * (universeRows - rank) / (universeRows - 1)) / 1_000_000,
      universeRows,
      asOf: basis.asOf,
      modelVersion: basis.modelVersion,
      evidenceTier: basis.evidenceTier,
      reasonCode: basis.reasonCode,
      volatility: basis.volatility,
      target: basis.target,
    })
  })
  return reset.map((candidate) => ({
    ...candidate,
    servedProspectRank: servedByCandidate.get(candidateKey(candidate)) ?? null,
  }))
}

export function scoreCurrentProspectUniverse(
  candidates: UnifiedBoardCandidate[],
  currentStatsRows: CurrentMinorProfileRow[],
): UnifiedBoardCandidate[] {
  const ranked = assignServedProspectRanks(
    attachLiveProspectPriorRankings(candidates, currentStatsRows),
  )
  const officialWorkloadIdentities = new Set(currentStatsRows.flatMap((row) => {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    if (mlbamId === null || !officialCurrentMinorWorkloadObserved(row, row.player_type)) return []
    return [`${mlbamId}:${row.player_type}`]
  }))
  const missingRankIdentities = ranked.flatMap((candidate) => {
    if (candidate.stage !== 'pre_debut' || candidate.mlbamId === null) return []
    const identity = `${candidate.mlbamId}:${prospectScoringRole(candidate.playerType)}`
    return officialWorkloadIdentities.has(identity) && candidate.servedProspectRank == null
      ? [identity]
      : []
  })
  if (missingRankIdentities.length > 0) {
    throw new Error(
      `Prospect scoring postcondition failed for official current MiLB workload identities: ` +
        [...new Set(missingRankIdentities)].sort().join(', '),
    )
  }
  return ranked
}

function candidateProspectScoreRank(candidate: UnifiedBoardCandidate): number | null {
  if (candidate.source !== 'minor' || candidate.stage !== 'pre_debut') return null
  if (candidate.servedProspectRank !== undefined) {
    return candidate.servedProspectRank?.rank ?? null
  }
  if (candidate.milbAlphaSignal?.gates.minimumRawWorkload === false) {
    return candidate.milbImpactRanking?.priorRank ?? null
  }
  return candidate.milbImpactRanking?.rank ?? null
}

function coverageRate(covered: number, total: number): number {
  return total === 0 ? 0 : Math.round(covered / total * 10_000) / 10_000
}

export function buildProspectCoverageSummary(input: {
  canonicalMinors: UnifiedBoardCandidate[]
  rosterRows: CurrentMinorRosterRow[]
  currentStatsRows: CurrentMinorProfileRow[]
  identityCrosswalk: MlbIdentityCrosswalk
  censusAsOf: string | null
}): ProspectCoverageSummary {
  const prospects = input.canonicalMinors.filter(
    (candidate) => candidate.stage === 'pre_debut',
  )
  const prospectMlbamIds = new Set(prospects.flatMap(
    (candidate) => candidate.mlbamId === null ? [] : [candidate.mlbamId],
  ))
  const rosterPlayerIds = new Set(input.rosterRows.flatMap((row) => {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    return mlbamId === null ? [] : [mlbamId]
  }))
  const rosteredPreDebutIds = new Set(input.rosterRows.flatMap((row) => {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    if (mlbamId === null || row.mlb_debut_date !== null) return []
    const exactIdentity = input.identityCrosswalk.byMlbam(mlbamId)
    return exactIdentity?.firstMlbSeason === null || exactIdentity === null
      ? [mlbamId]
      : []
  }))
  const servedRosteredPreDebutPlayers = [...rosteredPreDebutIds].filter(
    (mlbamId) => prospectMlbamIds.has(mlbamId),
  ).length
  const availableRankPlayers = prospects.filter(
    (candidate) => candidateProspectScoreRank(candidate) !== null,
  )
  const fullModelPlayers = availableRankPlayers.filter((candidate) => (
    candidate.servedProspectRank?.evidenceTier === 'completed_season_full_model' ||
    (
      candidate.servedProspectRank === undefined &&
      candidate.milbImpactRanking !== null &&
      candidate.milbAlphaSignal?.gates.minimumRawWorkload !== false
    )
  )).length
  const liveInSeasonPriorPlayers = availableRankPlayers.filter(
    (candidate) => candidate.servedProspectRank?.evidenceTier === 'live_in_season_prior',
  ).length
  const thinSamplePriorPlayers = availableRankPlayers.length -
    fullModelPlayers - liveInSeasonPriorPlayers
  const careerOutlookPlayers = prospects.filter(
    (candidate) => candidateCareerIndex(candidate) !== null,
  ).length
  const currentStatsIdentityRoles = new Set(input.currentStatsRows.flatMap((row) => {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    return mlbamId === null ? [] : [`${mlbamId}:${row.player_type}`]
  }))
  const currentResultsPlayers = prospects.filter((candidate) => {
    if (candidate.mlbamId === null) return false
    if (candidate.playerType === 'Two-way') {
      return currentStatsIdentityRoles.has(`${candidate.mlbamId}:Hitter`) ||
        currentStatsIdentityRoles.has(`${candidate.mlbamId}:Pitcher`)
    }
    return currentStatsIdentityRoles.has(`${candidate.mlbamId}:${candidate.playerType}`)
  }).length
  const missingRosteredPreDebutPlayers = Math.max(
    rosteredPreDebutIds.size - servedRosteredPreDebutPlayers,
    0,
  )

  return {
    version: 'prospect-coverage/v1',
    census: {
      source: 'MLB StatsAPI affiliated full rosters',
      asOf: input.censusAsOf,
      rosterPlayers: rosterPlayerIds.size,
      rosteredPreDebutPlayers: rosteredPreDebutIds.size,
      servedRosteredPreDebutPlayers,
      missingRosteredPreDebutPlayers,
      status: rosterPlayerIds.size === 0
        ? 'unavailable'
        : missingRosteredPreDebutPlayers === 0
          ? 'complete'
          : 'incomplete',
    },
    sourceUnionPreDebutPlayers: prospects.length,
    identity: {
      mlbamLinkedPlayers: prospectMlbamIds.size,
      profileOnlyPlayers: prospects.filter((candidate) => candidate.mlbamId === null).length,
    },
    prospectRank: {
      availablePlayers: availableRankPlayers.length,
      fullModelPlayers,
      thinSamplePriorPlayers,
      liveInSeasonPriorPlayers,
      frozenModelGapPlayers: prospects.length - availableRankPlayers.length,
      coverageRate: coverageRate(availableRankPlayers.length, prospects.length),
      frozenAsOf: researchMilbImpactSummary.frozenAsOf,
    },
    careerOutlook: {
      availablePlayers: careerOutlookPlayers,
      coverageRate: coverageRate(careerOutlookPlayers, prospects.length),
    },
    currentResults: {
      availablePlayers: currentResultsPlayers,
      coverageRate: coverageRate(currentResultsPlayers, prospects.length),
    },
    nullPolicy: 'unavailable_not_zero',
  }
}

function candidateCareerWar(candidate: UnifiedBoardCandidate) {
  return careerIndexWarQuantiles(
    candidatePlayerMapRoute(candidate),
    candidateOutcomeForecast(candidate),
  )
}

function candidatePlayerMapRoute(candidate: UnifiedBoardCandidate): 'milb' | 'rookie' | 'mlb' {
  if (candidate.stage === 'recent_callup') return 'rookie'
  return candidate.source === 'minor' && candidate.stage === 'pre_debut' ? 'milb' : 'mlb'
}

export function sortUnifiedCandidates(
  items: UnifiedBoardCandidate[],
  sort: PlayerSort,
): UnifiedBoardCandidate[] {
  return items.toSorted((left, right) => {
    const idTie = left.id.localeCompare(right.id) ||
      candidatePlayerMapRoute(left).localeCompare(candidatePlayerMapRoute(right))
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
          candidateOutcomeForecast(left)?.hofCaliberProbability ?? null,
          candidateOutcomeForecast(right)?.hofCaliberProbability ?? null,
          'descending',
        ) ||
        idTie
      )
    }
    if (sort === 'prospectScore') {
      return (
        compareNullableNumber(
          candidateProspectScoreRank(left),
          candidateProspectScoreRank(right),
          'ascending',
        ) ||
        compareNullableNumber(candidateCareerIndex(left), candidateCareerIndex(right), 'descending') ||
        idTie
      )
    }
    if (sort === 'careerIndex') {
      return (
        compareNullableNumber(
          candidateCareerIndex(left),
          candidateCareerIndex(right),
          'descending',
        ) ||
        compareNullableNumber(
          candidateOutcomeRank(left),
          candidateOutcomeRank(right),
          'ascending',
        ) ||
        idTie
      )
    }
    if (sort === 'stageStanding' || sort === 'alphaOpportunity') {
      return (
        compareNullableNumber(
          candidateOutcomeRank(left),
          candidateOutcomeRank(right),
          'ascending',
        ) ||
        idTie
      )
    }
    if (sort === 'finalWar') {
      return (
        compareNullableNumber(
          candidateCareerWar(left)?.p50 ?? null,
          candidateCareerWar(right)?.p50 ?? null,
          'descending',
        ) || idTie
      )
    }
    return (
      compareNullableNumber(
        candidateOutcomeForecast(left)?.hofCaliberProbability ?? null,
        candidateOutcomeForecast(right)?.hofCaliberProbability ?? null,
        'descending',
      ) ||
      compareNullableNumber(
        candidateCareerWar(left)?.p50 ?? null,
        candidateCareerWar(right)?.p50 ?? null,
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
  if (query.stage === 'All' && query.sort === 'careerIndex') {
    return items.toSorted((left, right) => (
      compareNullableNumber(candidateCareerIndex(left), candidateCareerIndex(right), 'descending') ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id) ||
      candidatePlayerMapRoute(left).localeCompare(candidatePlayerMapRoute(right))
    ))
  }
  if (query.stage === 'All') {
    return sortUnifiedCandidates(items, query.sort === 'age' ? 'age' : 'name')
  }
  return sortUnifiedCandidates(items, query.sort)
}

export function responseOrdering(query: Pick<PlayerQuery, 'stage' | 'sort' | 'view'>) {
  const appliedSort = query.sort === 'alphaOpportunity' ? 'stageStanding' : query.sort
  const compact = query.view === 'map'
  type Direction = 'ascending' | 'descending'
  type Metric = {
    metric: string
    field: string | null
    fieldExposed: boolean
    direction: Direction
  }
  const metric = (
    name: string,
    direction: Direction,
    exposedField: string | null,
  ): Metric => ({
    metric: name,
    field: exposedField,
    fieldExposed: exposedField !== null,
    direction,
  })
  const careerIndexField = compact ? 'assessment.careerIndex.value' : 'playerMap.careerIndex.value'
  const stageStandingField = compact
    ? 'assessment.stageStanding.rank'
    : 'playerMap.stageStanding.rank'
  const prospectScoreRankField = compact
    ? 'assessment.scores.outcome.rank'
    : 'playerMap.scores.outcome.rank'
  const playerIdField = compact ? 'playerId' : 'id'
  const nameField = compact ? 'identity.name' : 'name'
  const routeField = compact ? 'assessment.route' : 'playerMap.route'
  const forecastField = (suffix: string): string | null => {
    if (compact) return null
    return query.stage === 'RC'
      ? `recentCallup.prospectPrior.forecast.${suffix}`
      : `careerForecast.${suffix}`
  }
  const finalCareerWarP50Field = forecastField(
    query.stage === 'Minors' || query.stage === 'RC'
      ? 'finalCareerWarConditionalOnArrival.p50'
      : 'finalCareerWar.p50',
  )

  const primaryBySort: Record<typeof appliedSort, Metric> = {
    prospectScore: metric('prospect_score_rank', 'ascending', prospectScoreRankField),
    careerIndex: metric('career_index', 'descending', careerIndexField),
    stageStanding: metric('stage_standing', 'ascending', stageStandingField),
    hofProbability: metric(
      'hof_caliber_probability',
      'descending',
      forecastField('hofCaliberProbability'),
    ),
    nearTermImpact: query.stage === 'Minors'
      ? metric('derived_arrival_probability_36', 'descending', null)
      : metric(
        'exceptional_trajectory_probability',
        'descending',
        compact ? null : 'careerForecast.careerChapter.exceptionalTrajectory.probability',
      ),
    finalWar: metric(
      'final_career_war_p50',
      'descending',
      finalCareerWarP50Field,
    ),
    arrival36: query.stage === 'Minors'
      ? metric('milb_alpha_signal_rank', 'ascending', compact ? null : 'milbAlphaSignal.rank')
      : metric(
        'arrival_probability_36',
        'descending',
        compact ? null : 'careerForecast.arrivalProbability36',
      ),
    age: metric('age', 'ascending', compact ? 'context.age' : 'age'),
    name: metric('display_name', 'ascending', nameField),
  }
  const primary = primaryBySort[appliedSort]
  const scope = query.stage === 'All'
    ? appliedSort === 'careerIndex' ? 'cross_stage' as const : 'directory' as const
    : 'stage' as const
  const stableIdentityTies = [
    metric('player_id', 'ascending', playerIdField),
    metric('player_map_route', 'ascending', routeField),
  ]
  const tieBreakers = appliedSort === 'prospectScore'
    ? [metric('career_index', 'descending', careerIndexField), ...stableIdentityTies]
    : appliedSort === 'careerIndex'
    ? query.stage === 'All'
      ? [metric('display_name', 'ascending', nameField), ...stableIdentityTies]
      : [metric('stage_standing', 'ascending', stageStandingField), ...stableIdentityTies]
    : appliedSort === 'hofProbability'
      ? [metric('final_career_war_p50', 'descending', finalCareerWarP50Field), ...stableIdentityTies]
      : appliedSort === 'nearTermImpact'
        ? [metric('hof_caliber_probability', 'descending', forecastField('hofCaliberProbability')), ...stableIdentityTies]
        : stableIdentityTies

  return {
    requestedSort: query.sort,
    appliedSort,
    legacyAliasUsed: query.sort === 'alphaOpportunity',
    ...primary,
    scope,
    nulls: 'last' as const,
    tieBreakers,
  }
}

export function assignStageRanks(
  candidates: UnifiedBoardCandidate[],
): UnifiedBoardCandidate[] {
  const rankedKeys = new Map<string, number>()
  sortUnifiedCandidates(
    candidates.filter((candidate) => (
      candidate.source === 'mlb' && candidate.careerForecast?.publicationState !== 'withheld'
    )),
    'hofProbability',
  )
    .filter((candidate) => candidate.careerForecast?.hofCaliberProbability != null)
    .forEach((candidate, index) => rankedKeys.set(candidateKey(candidate), index + 1))

  return candidates.map((candidate) => {
    if (candidate.careerForecast === null) return candidate
    const artifactRank = candidate.careerForecast.rank
    return {
      ...candidate,
      careerForecast: {
        ...candidate.careerForecast,
        rank: candidate.source === 'minor'
          ? artifactRank
          : rankedKeys.get(candidateKey(candidate)) ?? null,
        lineage: {
          ...candidate.careerForecast.lineage,
          ...(artifactRank === null ? {} : { artifactRank }),
          rankUniverse: candidate.source === 'mlb'
            ? 'current_mlb'
            : 'frozen_prospect_forecast',
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

function minorInningsToOuts(value: DatabaseNumber): number {
  const innings = numberOrNull(value)
  if (innings === null || innings <= 0) return 0
  const whole = Math.floor(innings)
  const partialOuts = Math.round((innings - whole) * 10)
  return partialOuts >= 0 && partialOuts <= 2
    ? whole * 3 + partialOuts
    : Math.round(innings * 3)
}

function preferredMinorRoleRow(
  left: UnifiedBoardCandidate,
  right: UnifiedBoardCandidate,
): UnifiedBoardCandidate {
  const leftHasForecast = left.careerForecast !== null
  const rightHasForecast = right.careerForecast !== null
  if (leftHasForecast !== rightHasForecast) return leftHasForecast ? left : right
  if (left.opportunityScore !== right.opportunityScore) {
    return left.opportunityScore > right.opportunityScore ? left : right
  }
  return left.id < right.id ? left : right
}

function minorRoleWorkload(candidate: UnifiedBoardCandidate) {
  if (candidate.minorRoleWorkload) return candidate.minorRoleWorkload
  return candidate.playerType === 'Pitcher'
    ? { plateAppearances: 0, pitchingOuts: candidate.opportunityScore }
    : { plateAppearances: candidate.opportunityScore, pitchingOuts: 0 }
}

function substantiveMinorTwoWay(input: {
  plateAppearances: number
  pitchingOuts: number
}): boolean {
  const battingWorkload = input.plateAppearances / 600
  const pitchingWorkload = input.pitchingOuts / 540
  const largerWorkload = Math.max(battingWorkload, pitchingWorkload)
  return input.plateAppearances >= 60 &&
    input.pitchingOuts >= 60 &&
    largerWorkload > 0 &&
    Math.min(battingWorkload, pitchingWorkload) / largerWorkload >= 0.25
}

export interface MinorDedupeSummary {
  items: UnifiedBoardCandidate[]
  inputRoleRows: number
  canonicalPlayers: number
  duplicateRoleRowsRemoved: number
  twoWayPlayers: number
  missingMlbam: number
}

export function dedupeMinorCandidates(
  candidates: UnifiedBoardCandidate[],
): MinorDedupeSummary {
  const groups = new Map<string, UnifiedBoardCandidate[]>()
  let missingMlbam = 0

  for (const candidate of candidates) {
    const identity = candidate.mlbamId === null
      ? `profile:${candidate.id}`
      : `mlbam:${candidate.mlbamId}`
    if (candidate.mlbamId === null) missingMlbam += 1
    groups.set(identity, [...(groups.get(identity) ?? []), candidate])
  }

  const items = Array.from(groups.values()).map((group) => {
    const hitters = group.filter((candidate) => candidate.playerType === 'Hitter')
    const pitchers = group.filter((candidate) => candidate.playerType === 'Pitcher')
    if (hitters.length === 0 || pitchers.length === 0) {
      return group.reduce(preferredMinorRoleRow)
    }

    const hitter = hitters.reduce(preferredMinorRoleRow)
    const pitcher = pitchers.reduce(preferredMinorRoleRow)
    const batting = minorRoleWorkload(hitter)
    const pitching = minorRoleWorkload(pitcher)
    const workload = {
      plateAppearances: batting.plateAppearances,
      pitchingOuts: pitching.pitchingOuts,
    }
    const battingScale = workload.plateAppearances / 600
    const pitchingScale = workload.pitchingOuts / 540
    const representative = battingScale === pitchingScale
      ? preferredMinorRoleRow(hitter, pitcher)
      : battingScale > pitchingScale ? hitter : pitcher
    if (!substantiveMinorTwoWay(workload)) return representative
    return { ...hitter, minorRoleWorkload: workload }
  })
  return {
    items,
    inputRoleRows: candidates.length,
    canonicalPlayers: items.length,
    duplicateRoleRowsRemoved: candidates.length - items.length,
    twoWayPlayers: items.filter((candidate) => candidate.playerType === 'Two-way').length,
    missingMlbam,
  }
}

export interface CurrentUniverseMerge {
  items: UnifiedBoardCandidate[]
  canonicalMinors: UnifiedBoardCandidate[]
  crossStageDuplicatesRemoved: number
}

interface MinorCandidateBuild {
  items: UnifiedBoardCandidate[]
  experiencedRowsExcludedFromProspectRankings: number
  currentSeasonDebutRowsIdentified: number
  idsRecoveredFromExactCrosswalk: number
  idsRecoveredFromAuthoritativeCurrentSources: number
}

export function mergeCurrentUniverse(
  mlb: UnifiedBoardCandidate[],
  minors: UnifiedBoardCandidate[],
): CurrentUniverseMerge {
  const mlbByMlbam = new Map<string, UnifiedBoardCandidate[]>()
  for (const candidate of mlb) {
    if (candidate.mlbamId === null) continue
    mlbByMlbam.set(candidate.mlbamId, [
      ...(mlbByMlbam.get(candidate.mlbamId) ?? []),
      candidate,
    ])
  }

  const canonicalMinors = minors.filter((candidate) => {
    if (candidate.mlbamId === null) return true
    const matchingMlb = mlbByMlbam.get(candidate.mlbamId)
    return !matchingMlb || matchingMlb.length === 0
  })
  const canonicalMlb = mlb
  const merged = [...canonicalMlb, ...canonicalMinors]
  return {
    items: assignStageRanks(merged),
    canonicalMinors,
    crossStageDuplicatesRemoved: mlb.length + minors.length - merged.length,
  }
}

export function mlbCandidates(
  preview: CareerOraclePreview | null,
  identityCrosswalk: MlbIdentityCrosswalk = requireMlbIdentityCrosswalk(),
  currentRows: CurrentMlbValueRow[] = [],
): UnifiedBoardCandidate[] {
  if (!preview) return []
  const currentRowsByBbref = new Map(currentRows.map((row) => [row.bbref_id, row]))
  return preview.items.filter(isMlbPreviewPlayer).map((player) => {
    const isRecentCallup = isRecentCallupPreviewPlayer(player)
    const bbrefId = previewBbrefId(player)
    const currentStats = bbrefId === null ? null : currentRowsByBbref.get(bbrefId) ?? null
    const exactIdentity = identityCrosswalk.byBbref(bbrefId)
    const mlbamId = previewMlbamId(player) ?? exactIdentity?.mlbam.toString() ?? null
    const currentRole = currentRoleForModeledPlayer(player.playerType, currentStats)
    const teamContext = currentMlbTeamContext(currentStats?.team, {
      organization: player.organization,
      organizationCode: player.organizationCode,
    })
    const careerForecast = withholdForecastForCurrentRoleTransition(
      player.careerForecast,
      player.playerType,
      currentRole,
    )
    const recentCallupPrior = isRecentCallup && currentRole === player.playerType
      ? prospectPriorByIdentity(mlbamId, player.playerType, preview)
      : null
    return {
      id: player.id,
      source: 'mlb',
      name: player.name,
      playerType: currentRole,
      stage: isRecentCallup ? 'recent_callup' as const : player.stage,
      age: roundedNumber(currentStats?.age ?? player.age, 0),
      level: 'MLB',
      organization: teamContext.organization,
      organizationCode: teamContext.organizationCode,
      position: currentStats?.observed_role === 'Two-way'
        ? 'DH'
        : currentStats?.position ?? player.position,
      mlbamId,
      opportunityScore: currentStats === null
        ? 0
        : currentRole === 'Pitcher'
          ? Math.max(numberOrNull(currentStats.p_ip_outs) ?? 0, 0)
          : Math.max(numberOrNull(currentStats.b_pa) ?? 0, 0),
      careerForecast,
      milbAlphaSignal: null,
      milbImpactRanking: null,
      arrivalProbability36: careerForecast.arrivalProbability36,
      minorProfileId: null,
      previewPlayer: player,
      recentCallupPrior,
      currentStats,
    }
  })
}

export function currentOnlyMlbCandidates(
  rows: CurrentMlbValueRow[],
  preview: CareerOraclePreview | null,
  identityCrosswalk: MlbIdentityCrosswalk = requireMlbIdentityCrosswalk(),
): UnifiedBoardCandidate[] {
  const modeledBbrefIds = new Set(
    (preview?.items ?? [])
      .map(previewBbrefId)
      .filter((value): value is string => value !== null),
  )

  return rows
    .filter((row) => !modeledBbrefIds.has(row.bbref_id))
    .map((row) => {
      const exactIdentity = identityCrosswalk.byBbref(row.bbref_id)
      const rowSeason = numberOrNull(row.season)
      const firstMlbSeason = exactIdentity?.firstMlbSeason ?? null
      const stage = rowSeason !== null && firstMlbSeason === rowSeason
        ? 'recent_callup' as const
        : rowSeason !== null && firstMlbSeason !== null && rowSeason - firstMlbSeason <= 2
          ? 'early_mlb' as const
          : firstMlbSeason === null
            ? 'recent_callup' as const
            : 'established_mlb' as const
      const playerType = currentMlbComparisonRole({
        plateAppearances: row.b_pa,
        pitchingOuts: row.p_ip_outs,
      })
      const mlbamId = exactIdentity?.mlbam.toString() ?? null
      const recentCallupPrior = stage === 'recent_callup' && preview
        ? prospectPriorByIdentity(mlbamId, playerType, preview)
        : null
      const teamContext = currentMlbTeamContext(row.team)
      return {
        id: `bbref:${row.bbref_id}`,
        source: 'mlb' as const,
        name: row.player_name,
        playerType,
        stage,
        age: roundedNumber(row.age, 0),
        level: 'MLB',
        organization: teamContext.organization,
        organizationCode: teamContext.organizationCode,
        position: row.observed_role === 'Two-way'
          ? 'DH'
          : playerType === 'Pitcher'
          ? row.position ?? 'P'
          : row.position,
        mlbamId,
        opportunityScore: playerType === 'Pitcher'
        ? Math.max(numberOrNull(row.p_ip_outs) ?? 0, 0)
        : Math.max(numberOrNull(row.b_pa) ?? 0, 0),
        careerForecast: null,
        milbAlphaSignal: null,
        milbImpactRanking: null,
        arrivalProbability36: null,
        minorProfileId: null,
        previewPlayer: null,
        recentCallupPrior,
        currentStats: row,
      }
    })
}

export function minorCandidates(
  rows: MinorCandidateRow[],
  preview: CareerOraclePreview | null,
  identityCrosswalk: MlbIdentityCrosswalk,
  authoritativeCurrentIdentityRoles: ReadonlySet<string> = new Set(),
): MinorCandidateBuild {
  const explicitMlbamIds = new Set(
    rows
      .map((row) => databaseIdentifier(row.mlbam_id))
      .filter((value): value is string => value !== null),
  )
  let experiencedRowsExcludedFromProspectRankings = 0
  let currentSeasonDebutRowsIdentified = 0
  let idsRecoveredFromExactCrosswalk = 0
  let idsRecoveredFromAuthoritativeCurrentSources = 0
  const items: UnifiedBoardCandidate[] = []

  for (const row of rows) {
    const explicitMlbamId = databaseIdentifier(row.mlbam_id)
    const sourceMlbamId = databaseIdentifier(row.source_player_id)
    const sourceIdentity = explicitMlbamId === null && sourceMlbamId !== null
      ? identityCrosswalk.byMlbam(sourceMlbamId)
      : null
    const authoritativeCurrentMatch = sourceMlbamId !== null &&
      authoritativeCurrentIdentityRoles.has(`${sourceMlbamId}:${row.player_type}`)
    const mlbamId = explicitMlbamId ?? (
      sourceMlbamId !== null && (
        sourceIdentity !== null ||
        explicitMlbamIds.has(sourceMlbamId) ||
        authoritativeCurrentMatch
      )
        ? sourceMlbamId
        : null
    )
    if (explicitMlbamId === null && mlbamId !== null) idsRecoveredFromExactCrosswalk += 1
    if (
      explicitMlbamId === null &&
      sourceIdentity === null &&
      !explicitMlbamIds.has(sourceMlbamId ?? '') &&
      authoritativeCurrentMatch
    ) idsRecoveredFromAuthoritativeCurrentSources += 1
    const exactIdentity = identityCrosswalk.byMlbam(mlbamId)
    const hasMlbExperience = exactIdentity?.firstMlbSeason !== null &&
      exactIdentity?.firstMlbSeason !== undefined
    const rowSeason = numberOrNull(row.season)
    if (hasMlbExperience) experiencedRowsExcludedFromProspectRankings += 1
    if (hasMlbExperience && exactIdentity.firstMlbSeason === rowSeason) {
      currentSeasonDebutRowsIdentified += 1
    }
    const stage = hasMlbExperience ? 'post_debut_minors' as const : 'pre_debut' as const
    const forecastKey = stage !== 'pre_debut' || mlbamId === null
      ? null
      : `${mlbamId}:${row.player_type.toLocaleLowerCase('en-US')}`
    const forecast = forecastKey === null
      ? null
      : preview?.prospectForecasts[forecastKey]?.careerForecast ?? null
    items.push({
      id: row.profile_id,
      source: 'minor' as const,
      name: row.display_name,
      playerType: row.player_type,
      stage,
      age: roundedNumber(row.age, 0),
      level: row.level,
      organization: row.organization_name ?? row.organization_code,
      organizationCode: row.organization_code,
      position: row.position,
      mlbamId,
      opportunityScore: minorOpportunityScore(row),
      minorRoleWorkload: row.player_type === 'Hitter'
        ? {
            plateAppearances: Math.max(numberOrNull(row.pa) ?? 0, 0),
            pitchingOuts: 0,
          }
        : {
            plateAppearances: 0,
            pitchingOuts: minorInningsToOuts(row.ip),
          },
      careerForecast: forecast,
      milbAlphaSignal: stage === 'pre_debut'
        ? researchMilbAlphaSignal(mlbamId, row.player_type)
        : null,
      milbImpactRanking: stage === 'pre_debut'
        ? researchMilbImpactRanking(mlbamId, row.player_type)
        : null,
      arrivalProbability36: stage === 'pre_debut'
        ? forecast?.arrivalProbability36 ?? researchArrivalProbability(mlbamId, row.player_type, 36)
        : null,
      minorProfileId: row.profile_id,
      minorProfileSource: 'prospectSavant',
      previewPlayer: null,
      recentCallupPrior: null,
    })
  }
  return {
    items,
    experiencedRowsExcludedFromProspectRankings,
    currentSeasonDebutRowsIdentified,
    idsRecoveredFromExactCrosswalk,
    idsRecoveredFromAuthoritativeCurrentSources,
  }
}

export function authoritativeCurrentMinorIdentityRoles(
  statsRows: CurrentMinorProfileRow[],
  rosterRows: CurrentMinorRosterRow[],
): ReadonlySet<string> {
  return new Set([...statsRows, ...rosterRows].flatMap((row) => {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    return mlbamId === null ? [] : [`${mlbamId}:${row.player_type}`]
  }))
}

export interface CurrentMinorUniverseAugmentation {
  items: UnifiedBoardCandidate[]
  liveProfileOverlays: number
  officialOnlyRoleRows: number
}

export interface CurrentMinorRosterAugmentation {
  items: UnifiedBoardCandidate[]
  liveProfileOverlays: number
  rosterOnlyPlayers: number
}

function currentMinorCandidateLevel(row: CurrentMinorProfileRow): string {
  return row.current_level ?? row.highest_observed_level ?? 'Rk'
}

function currentMinorRoleWorkload(row: CurrentMinorProfileRow) {
  return row.player_type === 'Hitter'
    ? {
        plateAppearances: Math.max(numberOrNull(row.pa) ?? 0, 0),
        pitchingOuts: 0,
      }
    : {
        plateAppearances: 0,
        pitchingOuts: Math.max(numberOrNull(row.outs) ?? 0, 0),
      }
}

function currentMinorOpportunityScore(row: CurrentMinorProfileRow): number {
  if (row.player_type === 'Hitter') return Math.max(numberOrNull(row.pa) ?? 0, 0)
  const estimatedBattersFromPitches = (numberOrNull(row.pitches) ?? 0) / 3.9
  const estimatedBattersFromOuts = (numberOrNull(row.outs) ?? 0) / 3 * 4.3
  return Math.max(estimatedBattersFromPitches, estimatedBattersFromOuts, 0)
}

const fangraphsLevelRank: Record<string, number> = {
  Rk: 0,
  A: 1,
  'A+': 2,
  AA: 3,
  AAA: 4,
}

function fangraphsLevels(value: string | null): string[] {
  if (!value) return []
  const normalized = value.split(',').flatMap((entry) => {
    const token = entry.trim().toLocaleUpperCase('en-US')
    if (token === 'AAA') return ['AAA']
    if (token === 'AA') return ['AA']
    if (token === 'A+' || token === 'A-ADV') return ['A+']
    if (token === 'A' || token === 'A-') return ['A']
    if (
      token === 'RK' || token === 'R' || token === 'ROK' || token === 'ROOKIE' ||
      token === 'ACL' || token === 'CPX' || token === 'DSL' || token === 'FCL'
    ) return ['Rk']
    return []
  })
  return [...new Set(normalized)].toSorted(
    (left, right) => fangraphsLevelRank[right]! - fangraphsLevelRank[left]!,
  )
}

export function currentFangraphsCandidateLevel(value: string | null): string {
  return fangraphsLevels(value)[0] ?? 'Rk'
}

const currentFangraphsResolutionStatuses = {
  current_exact: true,
  historical_exact: true,
  current_tuple_conflict: true,
  historical_tuple_conflict: true,
  current_history_conflict: true,
  historical_census_conflict: true,
  unresolved: true,
} as const

type CurrentFangraphsResolutionStatus = keyof typeof currentFangraphsResolutionStatuses

const currentFangraphsConflictStatuses = new Set<CurrentFangraphsResolutionStatus>([
  'current_tuple_conflict',
  'historical_tuple_conflict',
  'current_history_conflict',
  'historical_census_conflict',
])

function nonNegativeIntegerOrNull(value: DatabaseNumber): number | null {
  const number = numberOrNull(value)
  return number !== null && Number.isSafeInteger(number) && number >= 0 ? number : null
}

function fangraphsMlbamId(value: DatabaseNumber): string | null {
  const identifier = databaseIdentifier(value)
  return identifier === '0' ? null : identifier
}

function currentFangraphsResolutionStatus(
  row: CurrentFangraphsCandidateRow,
): CurrentFangraphsResolutionStatus | null {
  const status: string = row.mlbam_resolution_status
  return Object.hasOwn(currentFangraphsResolutionStatuses, status)
    ? status as CurrentFangraphsResolutionStatus
    : null
}

function currentFangraphsResolutionIsStructurallyValid(
  row: CurrentFangraphsCandidateRow,
): boolean {
  const status = currentFangraphsResolutionStatus(row)
  const currentCount = nonNegativeIntegerOrNull(row.current_mlbam_candidate_count)
  const historicalCount = nonNegativeIntegerOrNull(row.historical_mlbam_candidate_count)
  const candidatePersonTuples = nonNegativeIntegerOrNull(row.candidate_mlbam_person_tuples)
  const historicalObservations = nonNegativeIntegerOrNull(
    row.historical_identity_observations,
  )
  if (
    status === null ||
    currentCount === null ||
    currentCount > 2 ||
    historicalCount === null ||
    candidatePersonTuples === null ||
    historicalObservations === null ||
    typeof row.fangraphs_id !== 'string' ||
    !row.fangraphs_id.trim() ||
    typeof row.minor_master_id !== 'string' ||
    !row.minor_master_id.trim() ||
    (row.source_role !== 'Hitter' && row.source_role !== 'Pitcher') ||
    typeof row.mlbam_resolution_conflict !== 'boolean' ||
    (row.identity_known_at !== null && typeof row.identity_known_at !== 'string')
  ) return false

  const resolvedId = fangraphsMlbamId(row.mlbam_id)
  const currentRowId = fangraphsMlbamId(row.current_mlbam_id)
  const currentCandidateId = fangraphsMlbamId(row.current_candidate_mlbam_id)
  const historicalCandidateId = fangraphsMlbamId(row.historical_candidate_mlbam_id)
  const malformedMlbamField = [
    [row.mlbam_id, resolvedId],
    [row.current_mlbam_id, currentRowId],
    [row.current_candidate_mlbam_id, currentCandidateId],
    [row.historical_candidate_mlbam_id, historicalCandidateId],
  ].some(([rawValue, parsedValue]) => rawValue !== null && parsedValue === null)
  const hasCandidateMlbam = (
    currentCount === 1 && currentRowId !== null
  ) || (
    currentCount === 0 && historicalCount === 1
  )
  if (
    malformedMlbamField ||
    (currentCount === 0 && (currentCandidateId !== null || currentRowId !== null)) ||
    (currentCount > 0 && currentCandidateId === null) ||
    (currentCount === 1 && currentRowId !== null && currentRowId !== currentCandidateId) ||
    (hasCandidateMlbam && candidatePersonTuples === 0) ||
    (!hasCandidateMlbam && candidatePersonTuples !== 0) ||
    (historicalCount === 0 && (
      historicalCandidateId !== null ||
      historicalObservations !== 0 ||
      row.identity_known_at !== null
    )) ||
    (historicalCount > 0 && (
      historicalCandidateId === null ||
      historicalObservations < historicalCount ||
      row.identity_known_at === null
    ))
  ) return false

  const expectedStatus: CurrentFangraphsResolutionStatus = currentCount > 1
    ? 'current_tuple_conflict'
    : historicalCount > 1
      ? 'historical_tuple_conflict'
      : currentCount === 1 && historicalCount === 1 &&
          currentCandidateId !== historicalCandidateId
        ? 'current_history_conflict'
        : candidatePersonTuples > 1
          ? 'historical_census_conflict'
          : currentRowId !== null && currentCount === 1
            ? 'current_exact'
            : currentRowId === null && currentCount === 0 && historicalCount === 1
              ? 'historical_exact'
              : 'unresolved'
  const expectedConflict = currentFangraphsConflictStatuses.has(expectedStatus)
  if (
    status !== expectedStatus ||
    row.mlbam_resolution_conflict !== expectedConflict
  ) return false

  if (status === 'current_exact') {
    return candidatePersonTuples === 1 &&
      resolvedId !== null &&
      resolvedId === currentRowId &&
      (historicalCount === 0 || historicalCandidateId === resolvedId)
  }
  if (status === 'historical_exact') {
    return candidatePersonTuples === 1 &&
      resolvedId !== null &&
      resolvedId === historicalCandidateId
  }
  return resolvedId === null
}

export function currentFangraphsValidResolvedMlbamId(
  row: CurrentFangraphsCandidateRow,
): string | null {
  if (!currentFangraphsResolutionIsStructurallyValid(row)) return null
  const status = currentFangraphsResolutionStatus(row)
  if (status !== 'current_exact' && status !== 'historical_exact') return null
  return fangraphsMlbamId(row.mlbam_id)
}

export function currentFangraphsResolutionAudit(
  rows: CurrentFangraphsCandidateRow[],
) {
  const statusCounts: Record<CurrentFangraphsResolutionStatus, number> = {
    current_exact: 0,
    historical_exact: 0,
    current_tuple_conflict: 0,
    historical_tuple_conflict: 0,
    current_history_conflict: 0,
    historical_census_conflict: 0,
    unresolved: 0,
  }
  let invalidResolutionRows = 0
  const historicalObservationsByTuple = new Map<string, number>()

  for (const row of rows) {
    const status = currentFangraphsResolutionStatus(row)
    if (status === null || !currentFangraphsResolutionIsStructurallyValid(row)) {
      invalidResolutionRows += 1
      continue
    }
    statusCounts[status] += 1
    const observations = nonNegativeIntegerOrNull(row.historical_identity_observations) ?? 0
    if (observations > 0) {
      historicalObservationsByTuple.set(
        JSON.stringify([row.fangraphs_id, row.minor_master_id]),
        observations,
      )
    }
  }

  const historicalIdentityObservations = [...historicalObservationsByTuple.values()]
    .reduce((total, observations) => total + observations, 0)

  return {
    totalRoleRows: rows.length,
    resolvedRoleRows: statusCounts.current_exact + statusCounts.historical_exact,
    currentExactRoleRows: statusCounts.current_exact,
    historicalExactRoleRows: statusCounts.historical_exact,
    unresolvedRoleRows: statusCounts.unresolved,
    conflictRoleRows:
      statusCounts.current_tuple_conflict +
      statusCounts.historical_tuple_conflict +
      statusCounts.current_history_conflict +
      statusCounts.historical_census_conflict,
    currentTupleConflictRoleRows: statusCounts.current_tuple_conflict,
    historicalTupleConflictRoleRows: statusCounts.historical_tuple_conflict,
    currentHistoryConflictRoleRows: statusCounts.current_history_conflict,
    historicalCensusConflictRoleRows: statusCounts.historical_census_conflict,
    historicalIdentityTuples: historicalObservationsByTuple.size,
    historicalIdentityObservations,
    invalidResolutionRows,
  }
}

function currentFangraphsOrganizationCode(row: CurrentFangraphsCandidateRow): string | null {
  const code = row.organization_code?.trim().toLocaleUpperCase('en-US') ?? ''
  return code && code !== '- - -' ? code : null
}

function currentFangraphsProfileId(row: CurrentFangraphsCandidateRow): string | null {
  const mlbamId = currentFangraphsValidResolvedMlbamId(row)
  return mlbamId === null
    ? null
    : `fangraphs:${mlbamId}:${row.source_role.toLocaleLowerCase('en-US')}`
}

function currentFangraphsRoleWorkload(row: CurrentFangraphsCandidateRow) {
  return row.source_role === 'Hitter'
    ? {
        plateAppearances: Math.max(numberOrNull(row.stats_pa) ?? 0, 0),
        pitchingOuts: 0,
      }
    : {
        plateAppearances: 0,
        pitchingOuts: minorInningsToOuts(row.stats_ip),
      }
}

function currentFangraphsOpportunityScore(row: CurrentFangraphsCandidateRow): number {
  const workload = currentFangraphsRoleWorkload(row)
  return row.source_role === 'Hitter'
    ? workload.plateAppearances
    : workload.pitchingOuts / 3 * 4.3
}

export interface CurrentFangraphsUniverseAugmentation {
  items: UnifiedBoardCandidate[]
  exactIdentityRoleRows: number
  liveProfileOverlays: number
  fangraphsOnlyRoleRows: number
  rowsWithoutExactMlbam: number
}

export function augmentMinorCandidatesWithCurrentFangraphs(
  candidates: UnifiedBoardCandidate[],
  rows: CurrentFangraphsCandidateRow[],
  preview: CareerOraclePreview | null,
  identityCrosswalk: MlbIdentityCrosswalk,
): CurrentFangraphsUniverseAugmentation {
  const currentByRole = new Map<string, CurrentFangraphsCandidateRow>()
  let rowsWithoutExactMlbam = 0
  for (const row of rows) {
    const mlbamId = currentFangraphsValidResolvedMlbamId(row)
    if (mlbamId === null) {
      rowsWithoutExactMlbam += 1
      continue
    }
    currentByRole.set(`${mlbamId}:${row.source_role}`, row)
  }

  const matchedCurrentKeys = new Set<string>()
  let liveProfileOverlays = 0
  const overlaid = candidates.map((candidate) => {
    if (candidate.mlbamId === null || candidate.playerType === 'Two-way') return candidate
    const key = `${candidate.mlbamId}:${candidate.playerType}`
    const row = currentByRole.get(key)
    if (!row) return candidate
    matchedCurrentKeys.add(key)
    liveProfileOverlays += 1
    const organizationCode = currentFangraphsOrganizationCode(row)
    return {
      ...candidate,
      name: row.player_name.trim() || candidate.name,
      age: roundedNumber(row.age, 0) ?? candidate.age,
      organization: (organizationCode ? mlbTeamNames[organizationCode] : null) ??
        organizationCode ?? candidate.organization,
      organizationCode: organizationCode ?? candidate.organizationCode,
      position: row.position ?? candidate.position,
    }
  })

  const fangraphsOnly = [...currentByRole.entries()].flatMap(
    ([key, row]): UnifiedBoardCandidate[] => {
      if (matchedCurrentKeys.has(key)) return []
      const mlbamId = currentFangraphsValidResolvedMlbamId(row)
      const profileId = currentFangraphsProfileId(row)
      if (mlbamId === null || profileId === null) return []
      const exactIdentity = identityCrosswalk.byMlbam(mlbamId)
      const hasMlbExperience = exactIdentity?.firstMlbSeason !== null &&
        exactIdentity?.firstMlbSeason !== undefined
      const stage = hasMlbExperience ? 'post_debut_minors' as const : 'pre_debut' as const
      const forecastKey = `${mlbamId}:${row.source_role.toLocaleLowerCase('en-US')}`
      const careerForecast = stage === 'pre_debut'
        ? preview?.prospectForecasts[forecastKey]?.careerForecast ?? null
        : null
      const organizationCode = currentFangraphsOrganizationCode(row)
      return [{
        id: profileId,
        source: 'minor' as const,
        name: row.player_name,
        playerType: row.source_role,
        stage,
        age: roundedNumber(row.age, 0),
        level: currentFangraphsCandidateLevel(row.stats_level),
        organization: (organizationCode ? mlbTeamNames[organizationCode] : null) ??
          organizationCode,
        organizationCode,
        position: row.position ?? (row.source_role === 'Pitcher' ? 'P' : null),
        mlbamId,
        opportunityScore: currentFangraphsOpportunityScore(row),
        minorRoleWorkload: currentFangraphsRoleWorkload(row),
        careerForecast,
        milbAlphaSignal: stage === 'pre_debut'
          ? researchMilbAlphaSignal(mlbamId, row.source_role)
          : null,
        milbImpactRanking: stage === 'pre_debut'
          ? researchMilbImpactRanking(mlbamId, row.source_role)
          : null,
        arrivalProbability36: stage === 'pre_debut'
          ? careerForecast?.arrivalProbability36 ??
            researchArrivalProbability(mlbamId, row.source_role, 36)
          : null,
        minorProfileId: profileId,
        minorProfileSource: 'fangraphs' as const,
        previewPlayer: null,
        recentCallupPrior: null,
      }]
    },
  )

  return {
    items: [...overlaid, ...fangraphsOnly],
    exactIdentityRoleRows: currentByRole.size,
    liveProfileOverlays,
    fangraphsOnlyRoleRows: fangraphsOnly.length,
    rowsWithoutExactMlbam,
  }
}

export function augmentMinorCandidatesWithCurrentProfiles(
  candidates: UnifiedBoardCandidate[],
  rows: CurrentMinorProfileRow[],
  preview: CareerOraclePreview | null,
  identityCrosswalk: MlbIdentityCrosswalk,
): CurrentMinorUniverseAugmentation {
  const currentByRole = new Map<string, CurrentMinorProfileRow>()
  for (const row of rows) {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    if (mlbamId === null) continue
    currentByRole.set(`${mlbamId}:${row.player_type}`, row)
  }

  const matchedCurrentKeys = new Set<string>()
  let liveProfileOverlays = 0
  const overlaid = candidates.map((candidate) => {
    if (candidate.mlbamId === null || candidate.playerType === 'Two-way') return candidate
    const key = `${candidate.mlbamId}:${candidate.playerType}`
    const row = currentByRole.get(key)
    if (!row) return candidate
    matchedCurrentKeys.add(key)
    liveProfileOverlays += 1
    const organizationCode = currentMinorOrganizationCode(row)
    return {
      ...candidate,
      name: row.display_name.trim() || candidate.name,
      age: roundedNumber(row.age, 0) ?? candidate.age,
      level: currentMinorCandidateLevel(row),
      organization: currentMinorOrganizationName(row) ?? candidate.organization,
      organizationCode: organizationCode ?? candidate.organizationCode,
      position: row.position ?? candidate.position,
      opportunityScore: currentMinorOpportunityScore(row),
      minorRoleWorkload: currentMinorRoleWorkload(row),
    }
  })

  const officialOnly = rows.flatMap((row): UnifiedBoardCandidate[] => {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    if (mlbamId === null) return []
    const key = `${mlbamId}:${row.player_type}`
    if (matchedCurrentKeys.has(key)) return []
    const exactIdentity = identityCrosswalk.byMlbam(mlbamId)
    const hasMlbExperience = exactIdentity?.firstMlbSeason !== null &&
      exactIdentity?.firstMlbSeason !== undefined
    const stage = hasMlbExperience ? 'post_debut_minors' as const : 'pre_debut' as const
    const forecastKey = `${mlbamId}:${row.player_type.toLocaleLowerCase('en-US')}`
    const careerForecast = stage === 'pre_debut'
      ? preview?.prospectForecasts[forecastKey]?.careerForecast ?? null
      : null
    const organizationCode = currentMinorOrganizationCode(row)
    return [{
      id: row.profile_id,
      source: 'minor' as const,
      name: row.display_name,
      playerType: row.player_type,
      stage,
      age: roundedNumber(row.age, 0),
      level: currentMinorCandidateLevel(row),
      organization: currentMinorOrganizationName(row),
      organizationCode,
      position: row.position ?? (row.player_type === 'Pitcher' ? 'P' : null),
      mlbamId,
      opportunityScore: currentMinorOpportunityScore(row),
      minorRoleWorkload: currentMinorRoleWorkload(row),
      careerForecast,
      milbAlphaSignal: stage === 'pre_debut'
        ? researchMilbAlphaSignal(mlbamId, row.player_type)
        : null,
      milbImpactRanking: stage === 'pre_debut'
        ? researchMilbImpactRanking(mlbamId, row.player_type)
        : null,
      arrivalProbability36: stage === 'pre_debut'
        ? careerForecast?.arrivalProbability36 ??
          researchArrivalProbability(mlbamId, row.player_type, 36)
        : null,
      minorProfileId: row.profile_id,
      minorProfileSource: 'mlbStatsApi' as const,
      previewPlayer: null,
      recentCallupPrior: null,
    }]
  })

  return {
    items: [...overlaid, ...officialOnly],
    liveProfileOverlays,
    officialOnlyRoleRows: officialOnly.length,
  }
}

export function augmentMinorCandidatesWithCurrentRoster(
  candidates: UnifiedBoardCandidate[],
  rows: CurrentMinorRosterRow[],
  preview: CareerOraclePreview | null,
  identityCrosswalk: MlbIdentityCrosswalk,
): CurrentMinorRosterAugmentation {
  const rosterByRole = new Map<string, CurrentMinorRosterRow>()
  for (const row of rows) {
    const mlbamId = databaseIdentifier(row.mlbam_id)
    if (mlbamId === null) continue
    rosterByRole.set(`${mlbamId}:${row.player_type}`, row)
  }

  const matchedRosterKeys = new Set<string>()
  let liveProfileOverlays = 0
  const overlaid = candidates.map((candidate) => {
    if (candidate.mlbamId === null || candidate.playerType === 'Two-way') return candidate
    const key = `${candidate.mlbamId}:${candidate.playerType}`
    const row = rosterByRole.get(key)
    if (!row) return candidate
    matchedRosterKeys.add(key)
    liveProfileOverlays += 1
    const organizationCode = currentMinorRosterOrganizationCode(row)
    return {
      ...candidate,
      name: row.display_name.trim() || candidate.name,
      age: roundedNumber(row.age, 0) ?? candidate.age,
      level: row.current_level,
      organization: currentMinorRosterOrganizationName(row) ?? candidate.organization,
      organizationCode: organizationCode ?? candidate.organizationCode,
      position: row.position ?? candidate.position,
      rosterStatus: {
        code: row.roster_status_code,
        description: row.roster_status_description,
        asOf: isoDate(row.known_at),
      },
    }
  })

  const rosterOnly = [...rosterByRole.entries()].flatMap(
    ([key, row]): UnifiedBoardCandidate[] => {
      if (matchedRosterKeys.has(key)) return []
      const mlbamId = databaseIdentifier(row.mlbam_id)
      if (mlbamId === null) return []
      const exactIdentity = identityCrosswalk.byMlbam(mlbamId)
      const hasMlbExperience = exactIdentity?.firstMlbSeason !== null &&
        exactIdentity?.firstMlbSeason !== undefined
      const stage = hasMlbExperience ? 'post_debut_minors' as const : 'pre_debut' as const
      const forecastKey = `${mlbamId}:${row.player_type.toLocaleLowerCase('en-US')}`
      const careerForecast = stage === 'pre_debut'
        ? preview?.prospectForecasts[forecastKey]?.careerForecast ?? null
        : null
      const organizationCode = currentMinorRosterOrganizationCode(row)
      return [{
        id: row.profile_id,
        source: 'minor' as const,
        name: row.display_name,
        playerType: row.player_type,
        stage,
        age: roundedNumber(row.age, 0),
        level: row.current_level,
        organization: currentMinorRosterOrganizationName(row),
        organizationCode,
        position: row.position ?? (row.player_type === 'Pitcher' ? 'P' : null),
        mlbamId,
        opportunityScore: 0,
        minorRoleWorkload: { plateAppearances: 0, pitchingOuts: 0 },
        careerForecast,
        milbAlphaSignal: stage === 'pre_debut'
          ? researchMilbAlphaSignal(mlbamId, row.player_type)
          : null,
        milbImpactRanking: stage === 'pre_debut'
          ? researchMilbImpactRanking(mlbamId, row.player_type)
          : null,
        arrivalProbability36: stage === 'pre_debut'
          ? careerForecast?.arrivalProbability36 ??
            researchArrivalProbability(mlbamId, row.player_type, 36)
          : null,
        minorProfileId: row.profile_id,
        minorProfileSource: 'mlbStatsApiRoster' as const,
        rosterStatus: {
          code: row.roster_status_code,
          description: row.roster_status_description,
          asOf: isoDate(row.known_at),
        },
        previewPlayer: null,
        recentCallupPrior: null,
      }]
    },
  )

  return {
    items: [...overlaid, ...rosterOnly],
    liveProfileOverlays,
    rosterOnlyPlayers: rosterOnly.length,
  }
}

function currentMinorProfilePlayerRow(row: CurrentMinorProfileRow): PlayerRow {
  const organizationCode = currentMinorOrganizationCode(row)
  return {
    profile_id: row.profile_id,
    source_player_id: databaseIdentifier(row.mlbam_id) ?? row.profile_id,
    player_type: row.player_type,
    display_name: row.display_name,
    organization_code: organizationCode,
    organization_name: currentMinorOrganizationName(row),
    position: row.position,
    age: row.age,
    level: currentMinorCandidateLevel(row),
    levels_observed: row.levels_observed,
    season: row.season,
    bats: row.bats,
    throws: row.throws,
    mlbam_id: row.mlbam_id,
    minor_master_id: null,
    fangraphs_path: null,
    known_at: row.known_at,
    has_statcast: false,
    has_traditional: true,
    has_complementary_rows: false,
    cohort_mismatch: false,
    source_variants: ['mlb-statsapi-current-milb'],
    organization_conflict: false,
    ps_score: null,
    ps_percentile: null,
    pa: row.pa,
    ip: row.ip,
    pitches: row.pitches,
    ba: row.ba,
    obp: row.obp,
    slg: row.slg,
    iso: null,
    woba: null,
    xwoba: null,
    ev: null,
    ev90: null,
    max_ev: null,
    hard_hit_rate: null,
    barrel_rate: null,
    chase_rate: null,
    whiff_rate: null,
    zone_contact_rate: null,
    swinging_strike_rate: null,
    strikeout_rate: null,
    walk_rate: null,
    k_minus_bb_rate: null,
    velocity: null,
    max_velocity: null,
    spin_rate: null,
    woba_percentile: null,
    xwoba_percentile: null,
    ev_percentile: null,
    ev90_percentile: null,
    max_ev_percentile: null,
    hard_hit_percentile: null,
    barrel_percentile: null,
    chase_percentile: null,
    whiff_percentile: null,
    zone_contact_percentile: null,
    swinging_strike_percentile: null,
    strikeout_percentile: null,
    walk_percentile: null,
    k_minus_bb_percentile: null,
    velocity_percentile: null,
    age_percentile: null,
  }
}

function currentMinorRosterPlayerRow(row: CurrentMinorRosterRow): PlayerRow {
  const profile: CurrentMinorProfileRow = {
    profile_id: row.profile_id,
    mlbam_id: row.mlbam_id,
    player_type: row.player_type,
    display_name: row.display_name,
    age: row.age,
    active: row.active,
    position: row.position,
    bats: row.bats,
    throws: row.throws,
    organization_mlbam_id: row.organization_mlbam_id,
    organization_name: row.organization_name,
    current_team_name: row.current_team_name,
    season: row.season,
    current_level: row.current_level,
    highest_observed_level: row.current_level,
    levels_observed: row.current_level === null ? [] : [row.current_level],
    known_at: row.known_at,
    pa: null,
    ba: null,
    obp: null,
    slg: null,
    ops: null,
    home_runs: null,
    walks: null,
    strikeouts: null,
    stolen_bases: null,
    ip: null,
    outs: null,
    pitches: null,
    era: null,
    whip: null,
    pitching_strikeout_rate: null,
    pitching_walk_rate: null,
    k_minus_bb_rate: null,
    pitching_strikeouts: null,
    walks_allowed: null,
  }
  return {
    ...currentMinorProfilePlayerRow(profile),
    level: row.current_level ?? 'Org',
    has_traditional: false,
    source_variants: ['mlb-statsapi-current-milb-roster'],
  }
}

function currentFangraphsProfilePlayerRow(row: CurrentFangraphsCandidateRow): PlayerRow {
  const organizationCode = currentFangraphsOrganizationCode(row)
  const levelsObserved = fangraphsLevels(row.stats_level)
  return {
    profile_id: currentFangraphsProfileId(row)!,
    source_player_id: row.fangraphs_id,
    player_type: row.source_role,
    display_name: row.player_name,
    organization_code: organizationCode,
    organization_name: (organizationCode ? mlbTeamNames[organizationCode] : null) ??
      organizationCode,
    position: row.position,
    age: row.age,
    level: currentFangraphsCandidateLevel(row.stats_level),
    levels_observed: levelsObserved,
    season: row.stats_season ?? row.report_season,
    bats: null,
    throws: null,
    mlbam_id: currentFangraphsValidResolvedMlbamId(row),
    minor_master_id: row.minor_master_id,
    fangraphs_path: row.fangraphs_path,
    known_at: row.known_at,
    has_statcast: false,
    has_traditional: numberOrNull(row.stats_pa) !== null || numberOrNull(row.stats_ip) !== null,
    has_complementary_rows: true,
    cohort_mismatch: false,
    source_variants: ['fangraphs-current-scouting'],
    organization_conflict: false,
    ps_score: null,
    ps_percentile: null,
    pa: row.stats_pa,
    ip: row.stats_ip,
    pitches: null,
    ba: null,
    obp: null,
    slg: null,
    iso: null,
    woba: null,
    xwoba: null,
    ev: null,
    ev90: null,
    max_ev: null,
    hard_hit_rate: null,
    barrel_rate: null,
    chase_rate: null,
    whiff_rate: null,
    zone_contact_rate: null,
    swinging_strike_rate: null,
    strikeout_rate: null,
    walk_rate: null,
    k_minus_bb_rate: null,
    velocity: null,
    max_velocity: null,
    spin_rate: null,
    woba_percentile: null,
    xwoba_percentile: null,
    ev_percentile: null,
    ev90_percentile: null,
    max_ev_percentile: null,
    hard_hit_percentile: null,
    barrel_percentile: null,
    chase_percentile: null,
    whiff_percentile: null,
    zone_contact_percentile: null,
    swinging_strike_percentile: null,
    strikeout_percentile: null,
    walk_percentile: null,
    k_minus_bb_percentile: null,
    velocity_percentile: null,
    age_percentile: null,
  }
}

export function prospectSavantCandidateProfileIds(
  candidates: UnifiedBoardCandidate[],
): string[] {
  return candidates
    .filter((candidate) => candidate.minorProfileSource === 'prospectSavant')
    .map((candidate) => candidate.minorProfileId)
    .filter((value): value is string => value !== null)
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
  const identityMatches = matchesIdentityQuery(candidate, query)
  const stageMatches = query.stage === 'All' ||
    (query.stage === 'Minors'
      ? candidate.source === 'minor' && candidate.stage === 'pre_debut'
      : query.stage === 'RC'
        ? candidate.stage === 'recent_callup'
        : candidate.stage !== 'recent_callup' && candidatePlayerMapRoute(candidate) === 'mlb')
  const typeMatches = query.playerType === 'All' || candidate.playerType === query.playerType
  const levelMatches = query.level === 'All' || candidate.level === query.level
  const teamNeedle = query.team?.toLocaleLowerCase('en-US') ?? null
  const teamMatches = omittedFacet === 'team' || teamNeedle === null || [
    candidate.organizationCode,
    candidate.organization,
  ].some((value) => value?.trim().toLocaleLowerCase('en-US') === teamNeedle)
  const positionMatches = omittedFacet === 'position' || query.position === null ||
    playerPositionTokens(candidate.position).includes(query.position)
  return identityMatches && stageMatches && typeMatches && levelMatches && teamMatches && positionMatches
}

export function matchesIdentityQuery(
  candidate: UnifiedBoardCandidate,
  query: Pick<PlayerQuery, 'q' | 'ids'>,
): boolean {
  const canonicalRole = candidate.playerType === 'Pitcher' ? 'pitcher' : 'hitter'
  const identityAliases = new Set([
    candidate.id,
    ...(candidate.mlbamId === null
      ? []
      : [`mlbam:${candidate.mlbamId}:${canonicalRole}`]),
  ])
  const idMatches = query.ids.length === 0 ||
    query.ids.some((id) => identityAliases.has(id))
  const needle = normalizeSearchText(query.q)
  const compactNeedle = needle.replaceAll(' ', '')
  const textMatches = needle.length === 0 || [
    candidate.name,
    candidate.organization,
    candidate.organizationCode,
    candidate.position,
    candidate.playerType,
    candidate.level,
  ].some((value) => {
    if (!value) return false
    const normalized = normalizeSearchText(value)
    return normalized.includes(needle) || normalized.replaceAll(' ', '').includes(compactNeedle)
  })
  return idMatches && textMatches
}

export function searchRecovery(
  universe: UnifiedBoardCandidate[],
  filtered: UnifiedBoardCandidate[],
  query: PlayerQuery,
) {
  if (!query.q && query.ids.length === 0) return undefined
  const visible = new Set(filtered.map(candidateKey))
  const outsideFilterMatches = universe
    .filter((candidate) => matchesIdentityQuery(candidate, query) && !visible.has(candidateKey(candidate)))
    .slice(0, 5)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      stage: candidate.stage,
      playerType: candidate.playerType,
      organization: candidate.organization,
      organizationCode: candidate.organizationCode,
      position: candidate.position,
    }))
  return { query: query.q, outsideFilterMatches }
}

export function playerHandlingAudit(candidates: UnifiedBoardCandidate[]) {
  const byCode: Partial<Record<PlayerHandlingCode, number>> = {}
  let specialHandlingPlayers = 0
  let withheldForecasts = 0
  let unclassifiedWithheld = 0

  for (const candidate of candidates) {
    const handling = classifyPlayerHandling({
      playerType: candidate.playerType,
      stage: candidate.stage,
      careerForecast: candidate.careerForecast,
      recentCallup: candidate.stage === 'recent_callup'
        ? { prospectPrior: candidate.recentCallupPrior }
        : null,
      externalIds: { mlbam: candidate.mlbamId },
    })
    if (candidate.careerForecast?.publicationState === 'withheld') withheldForecasts += 1
    if (handling.status === 'special') specialHandlingPlayers += 1
    if (handling.unclassifiedWithheld) unclassifiedWithheld += 1
    for (const note of handling.notes) byCode[note.code] = (byCode[note.code] ?? 0) + 1
  }

  return {
    version: PLAYER_HANDLING_VERSION,
    activePlayers: candidates.length,
    specialHandlingPlayers,
    withheldForecasts,
    unclassifiedWithheld,
    byCode,
  }
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
    if (!existing) {
      teamOptions.set(key, { ...facet, count: 1 })
      continue
    }

    const label = existing.label === existing.value && facet.label !== facet.value
      ? facet.label
      : existing.label
    teamOptions.set(key, { ...existing, label, count: existing.count + 1 })
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

export function scoredMlbUniverse(candidates: UnifiedBoardCandidate[]): number {
  return candidates.filter((candidate) => (
    candidate.source === 'mlb' &&
    candidate.careerForecast?.rank !== null &&
    candidate.careerForecast?.rank !== undefined
  )).length
}

export function stageRelevantDataAsOf(
  stage: PlayerStage,
  minorDataAsOf: string | null,
  currentMlbDataAsOf: string | null,
): string | null {
  if (stage === 'Minors') return minorDataAsOf
  if (stage === 'RC' || stage === 'MLB') return currentMlbDataAsOf

  const available = [minorDataAsOf, currentMlbDataAsOf].filter(
    (value): value is string => value !== null && Number.isFinite(Date.parse(value)),
  )
  if (available.length !== 2) return null
  return new Date(Math.min(...available.map((value) => Date.parse(value)))).toISOString()
}

function pageDetails(total: number, query: PlayerQuery) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  }
}

function hasMappedOutcome(candidate: UnifiedBoardCandidate): boolean {
  return candidateCareerIndex(candidate) !== null
}

export function playerMapResponseMeta(
  candidates: UnifiedBoardCandidate[],
  query?: Pick<PlayerQuery, 'stage' | 'sort' | 'view'>,
) {
  const includeProspectScoreContract = query?.view === 'map' && (
    query.stage === 'Minors' || query.stage === 'All'
  )
  return {
    playerMapVersion: PLAYER_MAP_VERSION,
    playerMapCoverage: candidates.length,
    matchingPlayerCount: candidates.length,
    matchingMappedCount: candidates.filter(hasMappedOutcome).length,
    marketIndependent: true as const,
    marketInputsIncluded: false as const,
    primaryScoreSemantics: 'fixed_career_value_index' as const,
    scoreSemantics: 'stage_specific_ordinal_not_market_value' as const,
    legacyScoreSemantics: 'stage_specific_ordinal_not_market_value' as const,
    scoreSemanticsDeprecated: true as const,
    rankingContract: {
      version: rankingContractVersion,
      scope: 'cross_route_numeric_sort' as const,
      productPrimary: false as const,
      primaryMetric: 'careerIndex' as const,
      primarySort: 'careerIndex' as const,
      primaryComparableAcrossRoutes: true as const,
      stageStandingMetric: 'stageStanding' as const,
      stageStandingComparableWithinStageOnly: true as const,
      stageStandingIsFilteredResultOrdinal: false as const,
      legacyMetric: 'oracleScore' as const,
      legacyDeprecated: true as const,
    },
    decisionHierarchy: {
      version: decisionHierarchyVersion,
      displayOrder: ['backstopRank', 'careerOutlook', 'currentResults'] as const,
      nullMeans: 'unavailable_not_zero' as const,
      backstopRank: {
        label: 'Backstop Rank' as const,
        semantics: 'exact_route_specific_ordinal' as const,
        lowerIsBetter: true as const,
        comparableAcrossRoutes: false as const,
        routes: {
          milb: {
            sourceMetric: 'prospectScore' as const,
            fullRankField: 'playerMap.scores.outcome.rank' as const,
            compactRankField: 'assessment.scores.outcome.rank' as const,
            fullUniverseField: 'playerMap.scores.outcome.universe' as const,
            compactUniverseField: 'assessment.scores.outcome.universe' as const,
          },
          rookie: {
            sourceMetric: 'frozen_pre_debut_impact_rank' as const,
            fullRankField: 'playerMap.stageStanding.rank' as const,
            compactRankField: 'assessment.stageStanding.rank' as const,
            fullUniverseField: 'playerMap.stageStanding.universe' as const,
            compactUniverseField: 'assessment.stageStanding.universe' as const,
          },
          mlb: {
            sourceMetric: 'career_outlook_stage_standing' as const,
            fullRankField: 'playerMap.stageStanding.rank' as const,
            compactRankField: 'assessment.stageStanding.rank' as const,
            fullUniverseField: 'playerMap.stageStanding.universe' as const,
            compactUniverseField: 'assessment.stageStanding.universe' as const,
          },
        },
      },
      careerOutlook: {
        label: 'Career Outlook' as const,
        sourceMetric: 'careerIndex' as const,
        fullValueField: 'playerMap.careerIndex.value' as const,
        compactValueField: 'assessment.careerIndex.value' as const,
        scale: 'fixed_career_value_0_100' as const,
        higherIsBetter: true as const,
        relative: false as const,
        calibratedProbability: false as const,
        comparableAcrossRoutes: true as const,
      },
      currentResults: {
        label: 'Current Results' as const,
        semantics: 'observed_current_season_evidence' as const,
        blendedIntoBackstopRank: false as const,
        fullMinorField: 'currentMinorStats' as const,
        compactMinorField: 'currentEvidence.minorStats' as const,
        fullMlbMetricsField: 'metrics' as const,
        compactMlbMetricsField: null,
        compactMlbAvailability: 'not_normalized_in_v4' as const,
      },
    },
    ...(includeProspectScoreContract ? {
      prospectScoreContract: {
        version: 'prospect-score/v2' as const,
        metric: 'prospectScore' as const,
        route: 'milb' as const,
        sort: 'prospectScore' as const,
        valueField: 'playerMap.scores.outcome.value' as const,
        compactValueField: 'assessment.scores.outcome.value' as const,
        rankField: 'playerMap.scores.outcome.rank' as const,
        compactRankField: 'assessment.scores.outcome.rank' as const,
        universeField: 'playerMap.scores.outcome.universe' as const,
        compactUniverseField: 'assessment.scores.outcome.universe' as const,
        targetField: 'playerMap.scores.outcome.target' as const,
        compactTargetField: 'assessment.scores.outcome.target' as const,
        statusField: 'playerMap.scores.outcome.status' as const,
        compactStatusField: 'assessment.scores.outcome.status' as const,
        asOfField: 'playerMap.scores.outcome.asOf' as const,
        compactAsOfField: 'assessment.scores.outcome.asOf' as const,
        scale: 'ordinal_percentile' as const,
        target: 'mlb_war_next_5_ge_5' as const,
        targetLabel: 'At least 5 total MLB WAR during 2026-2030' as const,
        windowStartSeason: 2026 as const,
        windowEndSeason: 2030 as const,
        featureCutoffAsOf: researchMilbImpactSummary.frozenAsOf,
        rankPercentileFormula: '100 * (universeRows - rank) / (universeRows - 1)' as const,
        activation: 'explicit_sort_opt_in' as const,
        legacyDefaultSort: 'careerIndex' as const,
        activationDeprecated: true as const,
        defaultStage: 'Minors' as const,
        defaultSort: 'prospectScore' as const,
        higherIsBetter: true as const,
        comparableWithinFrozenProspectUniverseOnly: true as const,
        comparableAcrossRoutes: false as const,
        calibratedProbability: false as const,
        currentSeasonEvidenceBlended: false as const,
        supportedSampleModel: 'regularized_logistic' as const,
        thinSampleModel: 'age_level_role_performance_prior' as const,
        thinSamplePolicy: 'hierarchical_prior_rank_when_frozen_workload_is_below_minimum' as const,
        thinSampleMappingStatus: 'insufficient_sample' as const,
        careerRunwayGuardrailMetric: 'careerIndex' as const,
        status: 'research_only' as const,
      },
    } : {}),
  }
}

export function snapshotId(parts: {
  minorDataAsOf: string | null
  currentMlbDataAsOf: string | null
  forecastDataVersion: string | null
  candidates: UnifiedBoardCandidate[]
}): string {
  const candidateManifest = parts.candidates
    .toSorted((left, right) => (
      left.id.localeCompare(right.id) ||
      candidatePlayerMapRoute(left).localeCompare(candidatePlayerMapRoute(right))
    ))
    .map((candidate) => {
      const outcome = candidateOutcomeForecast(candidate)
      const careerWar = candidateCareerWar(candidate)
      return [
        candidate.id,
        candidatePlayerMapRoute(candidate),
        candidate.name,
        candidate.playerType,
        candidate.stage,
        candidate.age,
        candidate.level,
        candidate.organizationCode,
        candidate.position,
        candidate.rosterStatus?.code ?? null,
        candidate.rosterStatus?.description ?? null,
        candidate.rosterStatus?.asOf ?? null,
        candidate.mlbamId,
        candidateCareerIndex(candidate),
        candidateOutcomeRank(candidate),
        outcome?.publicationState ?? null,
        outcome?.hofCaliberProbability ?? null,
        careerWar?.p50 ?? null,
        careerWar?.p75 ?? null,
        careerWar?.p90 ?? null,
        candidate.arrivalProbability36,
        candidate.milbAlphaSignal?.rank ?? null,
        candidateProspectScoreRank(candidate),
        candidate.servedProspectRank?.rankPercentile ?? null,
        candidate.servedProspectRank?.modelVersion ?? null,
        candidate.servedProspectRank?.evidenceTier ?? null,
        candidate.servedProspectRank?.asOf ?? null,
        candidate.careerForecast?.careerChapter?.exceptionalTrajectory?.probability ?? null,
        Object.entries(outcome?.lineage ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      ]
    })
  const digest = createHash('sha256').update(JSON.stringify({
    version: rankingSnapshotVersion,
    feedSchemaVersion: playerMapFeedSchemaVersion,
    rankingContractVersion,
    decisionHierarchyVersion,
    playerMapVersion: PLAYER_MAP_VERSION,
    careerIndexVersion: CAREER_INDEX_VERSION,
    minorDataAsOf: parts.minorDataAsOf,
    currentMlbDataAsOf: parts.currentMlbDataAsOf,
    forecastDataVersion: parts.forecastDataVersion,
    candidates: candidateManifest,
  })).digest('hex')
  return `${rankingSnapshotVersion}:${digest}`
}

export function currentResultsSnapshotDigest(
  minorRows: CurrentMinorStatsRow[],
  mlbRows: CurrentMlbValueRow[],
): string {
  const minor = minorRows
    .map((row) => [
      databaseIdentifier(row.mlbam_id),
      row.player_type,
      numberOrNull(row.season),
      row.current_level,
      row.highest_observed_level,
      stringArray(row.levels_observed),
      isoDate(row.known_at),
      numberOrNull(row.pa),
      numberOrNull(row.ba),
      numberOrNull(row.obp),
      numberOrNull(row.slg),
      numberOrNull(row.ops),
      numberOrNull(row.home_runs),
      numberOrNull(row.walks),
      numberOrNull(row.strikeouts),
      numberOrNull(row.stolen_bases),
      numberOrNull(row.ip),
      numberOrNull(row.outs),
      numberOrNull(row.era),
      numberOrNull(row.whip),
      numberOrNull(row.pitching_strikeout_rate),
      numberOrNull(row.pitching_walk_rate),
      numberOrNull(row.k_minus_bb_rate),
      numberOrNull(row.pitching_strikeouts),
      numberOrNull(row.walks_allowed),
    ])
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const mlb = mlbRows
    .map((row) => [
      row.bbref_id,
      databaseIdentifier(row.mlbam_id ?? null),
      numberOrNull(row.season),
      row.observed_role,
      isoDate(row.known_at),
      numberOrNull(row.b_pa),
      numberOrNull(row.b_war),
      numberOrNull(row.p_ip_outs),
      numberOrNull(row.p_games),
      numberOrNull(row.p_games_started),
      numberOrNull(row.p_war),
      numberOrNull(row.total_war),
      numberOrNull(row.current_war_percentile),
    ])
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const digest = createHash('sha256')
    .update(JSON.stringify({ minor, mlb }))
    .digest('hex')
  return `sha256:${digest}`
}

function responseItems(
  records: MappedPlayerRecord[],
  view: PlayerView,
): MappedPlayerRecord[] | PlayerMapFeedItem[] | PlayerSignalsItem[] {
  if (view === 'map') return records.map(playerMapFeedItem)
  if (view === 'signals') return records.map((record) => playerSignalsItem(record))
  return records
}

function degradedStaticResponse(
  request: IncomingMessage,
  response: ServerResponse,
  query: PlayerQuery,
  preview: CareerOraclePreview,
  reason: string,
): void {
  const universe = assignStageRanks(mlbCandidates(preview))
  const recentCallups = universe.filter((candidate) => candidate.stage === 'recent_callup').length
  const candidates = sortBoardCandidates(
    universe.filter((candidate) => matchesQuery(candidate, query)),
    query,
  )
  const offset = (query.page - 1) * query.limit
  const page = candidates.slice(offset, offset + query.limit)
  const context = {
    mlbUniverse: scoredMlbUniverse(universe),
    minorUniverse: 0,
  }
  const records = page.map((candidate) => previewPlayerRecord(candidate, preview, context))
  const degradedRankingSnapshot = snapshotId({
    minorDataAsOf: null,
    currentMlbDataAsOf: preview.asOf,
    forecastDataVersion: preview.dataVersion,
    candidates: universe,
  })
  if (query.view === 'signals') {
    const signalsSnapshot = playerSignalsSnapshotId({
      rankingSnapshotId: degradedRankingSnapshot,
      minorDataAsOf: null,
      currentMlbDataAsOf: null,
      forecastDataVersion: preview.dataVersion,
      currentResultsDigest: null,
      freshnessStatus: 'degraded',
    })
    response.setHeader('X-Snapshot-Id', signalsSnapshot)
    sendJson(request, response, 200, playerSignalsResponse({
      records,
      snapshotId: signalsSnapshot,
      dataAsOf: preview.asOf,
      freshness: {
        status: 'degraded',
        reasonCodes: ['live_player_database_unavailable'],
        statsChangedAt: null,
        lastCheckedAt: null,
        nextDueAt: null,
        cronObserved: false,
      },
      page: pageDetails(candidates.length, query),
      prospectCoverage: null,
    }), publicCache)
    return
  }
  sendJson(request, response, 200, {
    schemaVersion: query.view === 'map' ? playerMapFeedSchemaVersion : 'players.v1',
    items: responseItems(records, query.view),
    page: pageDetails(candidates.length, query),
    meta: {
      source: 'Baseball Oracle',
      dataset: 'Career Oracle MLB research preview',
      season: null,
      dataAsOf: null,
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
      stageCoverage: { minors: 0, recentCallups, mlb: universe.length - recentCallups },
      degraded: true,
      degradedReason: reason,
      rankScope: 'stage_specific',
      stageRankScope: 'declared_model_cohort_not_filtered_result',
      stageRankAvailability: { mlb: true, minors: false, recentCallups: recentCallups > 0 },
      snapshotId: degradedRankingSnapshot,
      snapshotScope: 'ranking_and_census' as const,
      ...playerMapResponseMeta(candidates, query),
      ordering: responseOrdering(query),
      facets: buildPlayerFacets(universe, query),
      searchRecovery: searchRecovery(universe, candidates, query),
      handlingAudit: playerHandlingAudit(universe),
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
    const staticIdentityCrosswalk = requireMlbIdentityCrosswalk()
    const chadwickKeyMlbamLookup = requireChadwickKeyMlbamLookup()
    const identityFreshness = assessMlbIdentityCrosswalkFreshness(
      staticIdentityCrosswalk.summary.asOf,
    )
    const [
      candidateResult,
      currentMlbResult,
      currentRefreshResult,
      identityOverlayResult,
      currentMinorUniverseResult,
      currentMinorRosterUniverseResult,
      currentFangraphsUniverseResult,
      currentMinorSourceResult,
      currentMinorRosterSourceResult,
      currentScoutingSourceResult,
    ] = await Promise.all([
      sql`
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
      `,
      sql`
        SELECT
          bbref_id,
          mlbam_id,
          player_name,
          season,
          observed_role,
          team,
          position,
          age,
          b_pa,
          b_war,
          p_ip,
          p_ip_outs,
          p_games,
          p_games_started,
          p_war,
          total_war,
          current_war_percentile,
          known_at::text AS known_at
        FROM app.current_mlb_value_snapshot
      `,
      sql`
        SELECT
          job_key,
          trigger_kind,
          status,
          season,
          started_at::text AS started_at,
          finished_at::text AS finished_at,
          result
        FROM ops.refresh_run
        WHERE job_key = 'current-baseball-source-refresh-v1'
        ORDER BY started_at DESC, id DESC
        LIMIT 200
      `,
      sql`
        SELECT
          bbref_id,
          chadwick_key,
          mlbam_id,
          first_mlb_season,
          created_at::text AS first_observed_at,
          updated_at::text AS last_observed_at
        FROM core.mlb_exact_identity_overlay
        ORDER BY bbref_id
      `,
      sql`
        SELECT
          profile_id,
          mlbam_id,
          player_type,
          display_name,
          age,
          active,
          position,
          bats,
          throws,
          organization_mlbam_id,
          organization_name,
          current_team_name,
          coalesce(current_level_season, highest_observed_level_season) AS season,
          current_level,
          highest_observed_level,
          levels_observed,
          known_at::text AS known_at,
          pa,
          ba,
          obp,
          slg,
          ops,
          home_runs,
          walks,
          strikeouts,
          stolen_bases,
          ip,
          outs,
          pitches,
          era,
          whip,
          pitching_strikeout_rate,
          pitching_walk_rate,
          k_minus_bb_rate,
          pitching_strikeouts,
          walks_allowed
        FROM app.current_milb_traditional_snapshot
        WHERE active IS DISTINCT FROM false
          AND display_name IS NOT NULL
          AND btrim(display_name) <> ''
      `,
      sql`
        SELECT
          profile_id,
          mlbam_id,
          player_type,
          display_name,
          age,
          active,
          mlb_debut_date::text AS mlb_debut_date,
          roster_status_code,
          roster_status_description,
          position,
          bats,
          throws,
          organization_mlbam_id,
          organization_name,
          current_team_mlbam_id,
          current_team_name,
          current_level,
          sport_id,
          season,
          known_at::text AS known_at
        FROM app.current_milb_roster_snapshot
        WHERE display_name IS NOT NULL
          AND btrim(display_name) <> ''
      `,
      sql`
        SELECT
          served_resolved_mlbam_id AS mlbam_id,
          mlbam_id AS current_mlbam_id,
          fangraphs_id,
          minor_master_id,
          source_role,
          player_name,
          organization_code,
          position,
          coalesce(age, served_historical_stats_age) AS age,
          report_season,
          coalesce(stats_season, served_historical_stats_season) AS stats_season,
          coalesce(stats_level, served_historical_stats_level) AS stats_level,
          coalesce(stats_pa, served_historical_stats_pa) AS stats_pa,
          coalesce(stats_ip, served_historical_stats_ip) AS stats_ip,
          coalesce(fangraphs_path, historical_fangraphs_path) AS fangraphs_path,
          known_at::text AS known_at,
          served_mlbam_resolution_status AS mlbam_resolution_status,
          served_mlbam_resolution_conflict AS mlbam_resolution_conflict,
          current_mlbam_candidate_count,
          current_candidate_mlbam_id,
          served_historical_mlbam_candidate_count
            AS historical_mlbam_candidate_count,
          served_historical_candidate_mlbam_id
            AS historical_candidate_mlbam_id,
          served_candidate_mlbam_person_tuples
            AS candidate_mlbam_person_tuples,
          served_historical_identity_observations
            AS historical_identity_observations,
          served_historical_identity_known_at::text AS identity_known_at
        FROM app.fangraphs_current_candidate_bridge_overlay
        ORDER BY served_resolved_mlbam_id NULLS LAST, source_role, fangraphs_id
      `,
      sql`
        SELECT
          count(*) AS rows,
          max(known_at)::text AS known_at
        FROM app.current_milb_traditional_snapshot
      `,
      sql`
        SELECT
          count(*) AS rows,
          max(known_at)::text AS known_at
        FROM app.current_milb_roster_snapshot
      `,
      sql`
        SELECT
          count(*) AS rows,
          max(known_at)::text AS known_at
        FROM app.fangraphs_current_candidate_bridge_overlay
      `,
    ])
    const minorRoleRows = candidateResult as unknown as MinorCandidateRow[]
    const currentMlbRows = currentMlbResult as unknown as CurrentMlbValueRow[]
    const currentRefreshRows = currentRefreshResult as unknown as CurrentRefreshRow[]
    const identityOverlayRows = identityOverlayResult as unknown as MlbIdentityOverlayRow[]
    const currentMinorProfileRows =
      currentMinorUniverseResult as unknown as CurrentMinorProfileRow[]
    const currentMinorRosterRows =
      currentMinorRosterUniverseResult as unknown as CurrentMinorRosterRow[]
    const currentFangraphsCandidateRows =
      currentFangraphsUniverseResult as unknown as CurrentFangraphsCandidateRow[]
    const currentFangraphsIdentityAudit = currentFangraphsResolutionAudit(
      currentFangraphsCandidateRows,
    )
    const currentMinorSource = (currentMinorSourceResult as unknown as CurrentSourceSnapshotRow[])[0] ?? null
    const currentMinorRosterSource =
      (currentMinorRosterSourceResult as unknown as CurrentSourceSnapshotRow[])[0] ?? null
    const currentScoutingSource = (currentScoutingSourceResult as unknown as CurrentSourceSnapshotRow[])[0] ?? null
    const composedIdentity = composeMlbIdentityCrosswalk(
      staticIdentityCrosswalk,
      identityOverlayRows,
      chadwickKeyMlbamLookup,
    )
    const identityCrosswalk = composedIdentity.crosswalk
    const currentIdentityConflicts = currentMlbRows.filter((row) => {
      const rowMlbamId = databaseIdentifier(row.mlbam_id ?? null)
      const resolved = identityCrosswalk.byBbref(row.bbref_id)
      return rowMlbamId !== null && (
        resolved === null || rowMlbamId !== String(resolved.mlbam)
      )
    })
    const unmatchedCurrentBbrefIds = currentMlbRows
      .filter((row) => identityCrosswalk.byBbref(row.bbref_id) === null)
      .map((row) => row.bbref_id)
    const currentMlbDataAsOf = latestIso(currentMlbRows.map((row) => isoDate(row.known_at)))
    const authoritativeMinorIdentityRoles = authoritativeCurrentMinorIdentityRoles(
      currentMinorProfileRows,
      currentMinorRosterRows,
    )
    const minorBuild = minorCandidates(
      minorRoleRows,
      careerPreview,
      identityCrosswalk,
      authoritativeMinorIdentityRoles,
    )
    const currentFangraphsBuild = augmentMinorCandidatesWithCurrentFangraphs(
      minorBuild.items,
      currentFangraphsCandidateRows,
      careerPreview,
      identityCrosswalk,
    )
    const currentMinorBuild = augmentMinorCandidatesWithCurrentProfiles(
      currentFangraphsBuild.items,
      currentMinorProfileRows,
      careerPreview,
      identityCrosswalk,
    )
    const currentMinorRosterBuild = augmentMinorCandidatesWithCurrentRoster(
      currentMinorBuild.items,
      currentMinorRosterRows,
      careerPreview,
      identityCrosswalk,
    )
    const minorDedupe = dedupeMinorCandidates(currentMinorRosterBuild.items)
    const servedMinorCandidates = scoreCurrentProspectUniverse(
      minorDedupe.items,
      currentMinorProfileRows,
    )
    const currentOnlyMlb = currentOnlyMlbCandidates(
      currentMlbRows,
      careerPreview,
      identityCrosswalk,
    )
    const mlb = [
      ...mlbCandidates(careerPreview, identityCrosswalk, currentMlbRows),
      ...currentOnlyMlb,
    ]
    const recentCallupCount = mlb.filter((candidate) => candidate.stage === 'recent_callup').length
    const merged = mergeCurrentUniverse(mlb, servedMinorCandidates)
    const { canonicalMinors, crossStageDuplicatesRemoved } = merged
    const currentUniverse = merged.items
    const servedProspectUniverse = canonicalMinors.filter(
      (candidate) => candidate.stage === 'pre_debut' && candidate.servedProspectRank != null,
    ).length
    const facets = buildPlayerFacets(currentUniverse, query)
    const filtered = sortBoardCandidates(
      currentUniverse.filter((candidate) => matchesQuery(candidate, query)),
      query,
    )
    const pageCandidates = filtered.slice(offset, offset + query.limit)
    const playerMapContext = {
      mlbUniverse: scoredMlbUniverse(mlb),
      minorUniverse: frozenProspectRankUniverse(careerPreview),
    }
    const prospectSavantPageIds = prospectSavantCandidateProfileIds(pageCandidates)
    const minorPageMlbamIds = [...new Set(pageCandidates
      .filter((candidate) => candidate.source === 'minor')
      .map((candidate) => candidate.mlbamId)
      .filter((value): value is string => value !== null && /^\d+$/u.test(value)))]
    const [rowResult, currentScoutingResult] = await Promise.all([
      prospectSavantPageIds.length === 0 ? [] : sql`
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
        WHERE profile_id = ANY(${prospectSavantPageIds}::text[])
      `,
      minorPageMlbamIds.length === 0 ? [] : sql`
        SELECT
          served_resolved_mlbam_id AS mlbam_id,
          source_role,
          report_season,
          org_rank,
          overall_rank,
          future_value,
          eta,
          present_hit,
          future_hit,
          present_game_power,
          future_game_power,
          present_raw_power,
          future_raw_power,
          present_speed,
          future_speed,
          present_fielding,
          future_fielding,
          present_arm,
          future_arm,
          present_fastball,
          future_fastball,
          present_slider,
          future_slider,
          present_curveball,
          future_curveball,
          present_changeup,
          future_changeup,
          present_splitter,
          future_splitter,
          present_cutter,
          future_cutter,
          present_command,
          future_command,
          bat_control,
          pitch_selection,
          known_at::text AS known_at
        FROM app.fangraphs_current_candidate_bridge_overlay
        WHERE served_resolved_mlbam_id = ANY(${minorPageMlbamIds}::bigint[])
      `,
    ])
    const minorRowsById = new Map(
      (rowResult as unknown as PlayerRow[]).map((row) => [row.profile_id, row]),
    )
    const currentMinorProfilesById = new Map(
      currentMinorProfileRows.map((row) => [row.profile_id, row]),
    )
    const currentMinorRosterProfilesById = new Map(
      currentMinorRosterRows.map((row) => [row.profile_id, row]),
    )
    const currentFangraphsProfilesById = new Map(
      currentFangraphsCandidateRows.flatMap((row) => {
        const profileId = currentFangraphsProfileId(row)
        return profileId === null ? [] : [[profileId, row] as const]
      }),
    )
    const validCurrentFangraphsIdentityKeys = new Set(
      currentFangraphsCandidateRows.flatMap((row) => {
        const mlbamId = currentFangraphsValidResolvedMlbamId(row)
        return mlbamId === null ? [] : [`${mlbamId}:${row.source_role}`]
      }),
    )
    const currentMinorStatsByIdentity = new Map(
      currentMinorProfileRows.map((row) => [
        `${databaseIdentifier(row.mlbam_id)}:${row.player_type}`,
        row,
      ]),
    )
    const currentScoutingByIdentity = new Map(
      (currentScoutingResult as unknown as CurrentFangraphsScoutingRow[]).flatMap((row) => {
        const mlbamId = databaseIdentifier(row.mlbam_id)
        const key = mlbamId === null ? null : `${mlbamId}:${row.source_role}`
        return key !== null && validCurrentFangraphsIdentityKeys.has(key)
          ? [[key, row] as const]
          : []
      }),
    )
    if (minorRowsById.size !== prospectSavantPageIds.length) {
      throw new Error('Selected minor-league profiles changed during the directory request')
    }
    const items = pageCandidates.map((candidate) => {
      if (candidate.source === 'mlb') {
        if (candidate.previewPlayer === null) {
          return currentOnlyMlbPlayerRecord(candidate, playerMapContext)
        }
        return previewPlayerRecord(candidate, careerPreview!, playerMapContext)
      }
      const officialProfile = candidate.minorProfileSource === 'mlbStatsApi'
        ? currentMinorProfilesById.get(candidate.minorProfileId!) ?? null
        : null
      const rosterProfile = candidate.minorProfileSource === 'mlbStatsApiRoster'
        ? currentMinorRosterProfilesById.get(candidate.minorProfileId!) ?? null
        : null
      const fangraphsProfile = candidate.minorProfileSource === 'fangraphs'
        ? currentFangraphsProfilesById.get(candidate.minorProfileId!) ?? null
        : null
      const minorRow = officialProfile
        ? currentMinorProfilePlayerRow(officialProfile)
        : rosterProfile
          ? currentMinorRosterPlayerRow(rosterProfile)
          : fangraphsProfile
            ? currentFangraphsProfilePlayerRow(fangraphsProfile)
            : minorRowsById.get(candidate.minorProfileId!)
      if (!minorRow) {
        throw new Error('Selected minor-league profile changed during the directory request')
      }
      const evidenceKey = `${candidate.mlbamId}:${minorRow.player_type}`
      return playerRecord(
        minorRow,
        candidate.careerForecast,
        candidate.milbAlphaSignal,
        candidate.milbImpactRanking,
        playerMapContext,
        {
          stage: candidate.stage as 'pre_debut' | 'post_debut_minors',
          mlbamId: candidate.mlbamId,
          playerType: candidate.playerType,
          position: candidate.position,
          age: candidate.age,
          level: candidate.level,
          organization: candidate.organization,
          organizationCode: candidate.organizationCode,
          rosterStatus: candidate.rosterStatus ?? null,
          servedProspectRank: candidate.servedProspectRank ?? null,
          profileSource: officialProfile
            ? 'MLB StatsAPI'
            : rosterProfile
              ? 'MLB StatsAPI Roster'
            : fangraphsProfile
              ? 'FanGraphs'
              : 'Prospect Savant',
          minorRoleWorkload: candidate.minorRoleWorkload,
          currentMinorStats: currentMinorStatsByIdentity.get(evidenceKey) ?? null,
          currentProspectScouting: currentScoutingByIdentity.get(evidenceKey) ?? null,
        },
      )
    })
    const prospectSavantDataAsOf = latestIso(minorRoleRows.map((row) => isoDate(row.known_at)))
    const currentMinorStatsAsOf = isoDate(currentMinorSource?.known_at ?? null)
    const currentMinorRosterAsOf = isoDate(currentMinorRosterSource?.known_at ?? null)
    const currentScoutingAsOf = isoDate(currentScoutingSource?.known_at ?? null)
    const minorDataAsOf = latestIso([
      prospectSavantDataAsOf,
      currentMinorStatsAsOf,
      currentMinorRosterAsOf,
      currentScoutingAsOf,
    ])
    const prospectCoverage = buildProspectCoverageSummary({
      canonicalMinors,
      rosterRows: currentMinorRosterRows,
      currentStatsRows: currentMinorProfileRows,
      identityCrosswalk,
      censusAsOf: currentMinorRosterAsOf,
    })
    const minorSeason = Math.max(
      ...minorRoleRows.map((row) => numberOrNull(row.season) ?? Number.NEGATIVE_INFINITY),
      ...currentMinorProfileRows.map(
        (row) => numberOrNull(row.season) ?? Number.NEGATIVE_INFINITY,
      ),
      ...currentMinorRosterRows.map(
        (row) => numberOrNull(row.season) ?? Number.NEGATIVE_INFINITY,
      ),
      ...currentFangraphsCandidateRows.map(
        (row) => numberOrNull(row.report_season) ?? Number.NEGATIVE_INFINITY,
      ),
    )
    const freshness = assessCurrentDataFreshness({
      now: new Date(),
      cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      runs: currentRefreshRows.map(currentRefreshRun),
      scheduleMinutesUtc: CURRENT_REFRESH_DAILY_MINUTES_UTC,
      stuckAfterMinutes: 6,
      sources: [
        {
          key: 'prospectSavant',
          required: true,
          statsChangedAt: prospectSavantDataAsOf,
          coverageComplete: minorRoleRows.length > 0,
        },
        {
          key: 'mlbStatsApi',
          required: true,
          statsChangedAt: currentMinorStatsAsOf,
          coverageComplete: (numberOrNull(currentMinorSource?.rows ?? null) ?? 0) > 0,
        },
        {
          key: 'mlbRoster',
          required: true,
          statsChangedAt: currentMinorRosterAsOf,
          coverageComplete: (numberOrNull(currentMinorRosterSource?.rows ?? null) ?? 0) > 0,
          initialSourceProofAt:
            (numberOrNull(currentMinorRosterSource?.rows ?? null) ?? 0) > 0
              ? currentMinorRosterAsOf
              : null,
        },
        {
          key: 'baseballReference',
          required: true,
          statsChangedAt: currentMlbDataAsOf,
          coverageComplete: currentMlbRows.length > 0,
        },
        {
          key: 'fangraphs',
          required: true,
          statsChangedAt: currentScoutingAsOf,
          coverageComplete: (numberOrNull(currentScoutingSource?.rows ?? null) ?? 0) > 0,
        },
      ],
    })
    const identityReasonCodes = [
      identityFreshness.status === 'invalid' ? 'identity_crosswalk_invalid' : null,
      composedIdentity.overlay.conflicts.length > 0 ? 'identity_overlay_conflict' : null,
      currentIdentityConflicts.length > 0 ? 'identity_current_mlb_conflict' : null,
      unmatchedCurrentBbrefIds.length > 0 ? 'identity_current_mlb_unmatched' : null,
      currentFangraphsIdentityAudit.invalidResolutionRows > 0
        ? 'fangraphs_identity_resolution_invalid'
        : null,
      prospectCoverage.census.status === 'incomplete'
        ? 'prospect_roster_census_incomplete'
        : prospectCoverage.census.status === 'unavailable'
          ? 'prospect_roster_census_unavailable'
          : null,
    ].filter((reason): reason is string => reason !== null)
    const currentDataStatus = identityReasonCodes.length === 0
      ? freshness.status
      : freshness.status === 'stale'
        ? 'stale'
        : 'degraded'
    const currentDataReasonCodes = [...new Set([
      ...freshness.reasonCodes,
      ...identityReasonCodes,
    ])]
    const responsePage = pageDetails(filtered.length, query)
    const responseDataAsOf = stageRelevantDataAsOf(
      query.stage,
      minorDataAsOf,
      currentMlbDataAsOf,
    )
    const responseFreshness = {
      status: currentDataStatus,
      reasonCodes: currentDataReasonCodes,
      statsChangedAt: freshness.statsChangedAt,
      lastCheckedAt: freshness.lastCheckedAt,
      nextDueAt: freshness.nextDueAt,
      cronObserved: freshness.cronProof.observed,
    }
    const rankingSnapshot = snapshotId({
      minorDataAsOf,
      currentMlbDataAsOf,
      forecastDataVersion: careerPreview?.dataVersion ?? null,
      candidates: currentUniverse,
    })
    const currentResultsDigest = currentResultsSnapshotDigest(
      currentMinorProfileRows,
      currentMlbRows,
    )

    if (query.view === 'signals') {
      const signalsSnapshot = playerSignalsSnapshotId({
        rankingSnapshotId: rankingSnapshot,
        minorDataAsOf,
        currentMlbDataAsOf,
        forecastDataVersion: careerPreview?.dataVersion ?? null,
        currentResultsDigest,
        freshnessStatus: responseFreshness.status,
      })
      response.setHeader('X-Snapshot-Id', signalsSnapshot)
      sendJson(
        request,
        response,
        200,
        playerSignalsResponse({
          records: items,
          snapshotId: signalsSnapshot,
          dataAsOf: responseDataAsOf,
          freshness: responseFreshness,
          page: responsePage,
          prospectCoverage,
        }),
        publicCache,
      )
      return
    }

    sendJson(
      request,
      response,
      200,
      {
        schemaVersion: query.view === 'map' ? playerMapFeedSchemaVersion : 'players.v1',
        items: responseItems(items, query.view),
        page: responsePage,
        meta: {
          source: careerPreview
            ? 'Baseball Oracle + MLB StatsAPI rosters and stats + FanGraphs + Baseball-Reference + Prospect Savant'
            : 'MLB StatsAPI rosters and stats + FanGraphs + Baseball-Reference + Prospect Savant',
          dataset: careerPreview
            ? 'Current Career Oracle universe'
            : 'Current MLB value and Minor League Leaders',
          season: Number.isFinite(minorSeason) ? minorSeason : null,
          dataAsOf: responseDataAsOf,
          currentDataFreshness: responseFreshness,
          coverage: 'Official affiliated MiLB full-roster census, current MLB evidence, all-level MiLB season totals, current FanGraphs scouting, advanced minor-league tracking, and the completed-season career model census',
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
            (candidate) => candidate.source === 'minor' &&
              candidate.servedProspectRank != null,
          ).length,
          milbImpactAlphaEligible: currentUniverse.filter(
            (candidate) => candidate.source === 'minor' &&
              candidate.milbAlphaSignal?.eligible === true &&
              (candidate.servedProspectRank?.rankPercentile ?? -1) >= 90,
          ).length,
          milbImpactRankingVersion: researchMilbImpactSummary.modelVersion,
          milbImpactRankingUniverse: servedProspectUniverse,
          minorTraitEvidenceVersion: 'minor-trait-evidence-v1',
          researchAsOf: careerPreview?.asOf ?? researchPreviewSummary.asOf,
          releaseEligible: careerPreview?.releaseEligible ?? false,
          targetVersion: careerPreview?.targetVersion ?? null,
          stageCoverage: {
            minors: canonicalMinors.filter((candidate) => candidate.stage === 'pre_debut').length,
            experiencedMinors: canonicalMinors.filter(
              (candidate) => candidate.stage === 'post_debut_minors',
            ).length,
            recentCallups: recentCallupCount,
            mlb: mlb.length - recentCallupCount,
          },
          prospectCoverage,
          rankScope: 'stage_specific',
          stageRankScope: 'declared_model_cohort_not_filtered_result',
          stageRankAvailability: {
            mlb: careerPreview !== null,
            minors: careerPreview !== null,
            recentCallups: recentCallupCount > 0,
          },
          snapshotId: rankingSnapshot,
          snapshotScope: 'ranking_and_census' as const,
          ...playerMapResponseMeta(filtered, query),
          ordering: responseOrdering(query),
          facets,
          searchRecovery: searchRecovery(currentUniverse, filtered, query),
          handlingAudit: playerHandlingAudit(currentUniverse),
          identity: {
            minorRoleRows: minorDedupe.inputRoleRows,
            canonicalMinorPlayers: canonicalMinors.length,
            duplicateMinorRoleRowsRemoved: minorDedupe.duplicateRoleRowsRemoved,
            minorTwoWayPlayers: minorDedupe.twoWayPlayers,
            crossStageDuplicatesRemoved,
            minorPlayersMissingMlbam: minorDedupe.missingMlbam,
            mlbPlayersMissingMlbam: mlb.filter((candidate) => candidate.mlbamId === null).length,
            currentMlbProfilesOutsideModelCensus: currentOnlyMlb.length,
            experiencedMinorRowsExcludedFromRankings:
              minorBuild.experiencedRowsExcludedFromProspectRankings,
            currentSeasonDebutMinorRowsIdentified:
              minorBuild.currentSeasonDebutRowsIdentified,
            minorIdsRecoveredFromExactCrosswalk:
              minorBuild.idsRecoveredFromExactCrosswalk,
            minorIdsRecoveredFromAuthoritativeCurrentSources:
              minorBuild.idsRecoveredFromAuthoritativeCurrentSources,
            currentRosterPlayers: currentMinorRosterRows.length,
            rosterOnlyPlayersAdded: currentMinorRosterBuild.rosterOnlyPlayers,
            identityPolicy:
              'exact_mlbam_bbref_plus_durable_chadwick_overlay_no_name_matching',
            identityCrosswalkAsOf: identityCrosswalk.summary.asOf,
            identityCrosswalkRecords: identityCrosswalk.summary.recordCount,
            identityCrosswalkStatus: identityFreshness.status,
            identityCrosswalkAgeHours: identityFreshness.ageHours,
            identityCrosswalkMaxAgeHours: identityFreshness.maxAgeHours,
            identityOverlayRecords: composedIdentity.overlay.acceptedRecords,
            identityOverlayConflicts: composedIdentity.overlay.conflicts.length,
            identityOverlayNewestObservedAt: composedIdentity.overlay.newestObservedAt,
            currentMlbRows: currentMlbRows.length,
            unmatchedCurrentBbrefIds: unmatchedCurrentBbrefIds.length,
            conflictingCurrentMlbIds: currentIdentityConflicts.length,
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
