import { neon } from '@neondatabase/serverless'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  researchArrivalEstimate,
  researchArrivalProbability,
  researchPreviewSummary,
} from './_research-arrival.js'

const playerTypes = ['All', 'Hitter', 'Pitcher'] as const
const playerLevels = ['All', 'Rk', 'A', 'A+', 'AA', 'AAA'] as const
const playerSorts = ['arrival36', 'psScore', 'psPercentile', 'age', 'name'] as const
const queryParameterNames = new Set([
  'q',
  'playerType',
  'level',
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
  playerType: z.enum(playerTypes).default('All'),
  level: z.enum(playerLevels).default('All'),
  sort: z.enum(playerSorts).default('psScore'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

type PlayerType = (typeof playerTypes)[number]
type PlayerLevel = (typeof playerLevels)[number]
type PlayerSort = (typeof playerSorts)[number]

interface PlayerQuery {
  q: string
  playerType: PlayerType
  level: PlayerLevel
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

interface CountRow {
  total: string
  data_as_of: string | null
  season: DatabaseNumber
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
  return values[0]
}

function parseQuery(request: IncomingMessage): PlayerQuery | null {
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
      playerType: readSingleParameter(url.searchParams, 'playerType'),
      level: readSingleParameter(url.searchParams, 'level'),
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&')
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

function observedMetrics(row: PlayerRow): ObservedMetric[] {
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
        metric('batting-average', 'Batting average', formatDecimal(row.ba)),
        metric('on-base-percentage', 'On-base percentage', formatDecimal(row.obp)),
        metric('slugging', 'Slugging', formatDecimal(row.slg)),
        metric('isolated-power', 'Isolated power', formatDecimal(row.iso)),
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

function playerRecord(row: PlayerRow) {
  const bats = row.bats && row.bats !== '0' ? row.bats : null
  const throws = row.throws && row.throws !== '0' ? row.throws : null
  const batsThrows = bats && throws ? `${bats}/${throws}` : bats ?? throws

  return {
    id: row.profile_id,
    name: row.display_name,
    initials: initials(row.display_name),
    organization: row.organization_name ?? row.organization_code,
    organizationCode: row.organization_code,
    position: row.position,
    playerType: row.player_type,
    age: roundedNumber(row.age, 0),
    level: row.level,
    batsThrows,
    psScore: roundedNumber(row.ps_score, 2),
    psPercentile: percentileOrNull(row.ps_percentile),
    agePercentile: percentileOrNull(row.age_percentile),
    opportunity: opportunity(row),
    metrics: observedMetrics(row),
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
    forecast: null,
  }
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

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!databaseUrl) {
    sendJson(request, response, 503, { error: 'Player data is not configured' })
    return
  }

  const searchPattern = `%${escapeLike(query.q)}%`
  const offset = (query.page - 1) * query.limit
  const rowOffset = query.sort === 'arrival36' ? 0 : offset

  try {
    const sql = neon(databaseUrl)
    let researchPageIds: string[] = []
    let researchMatched = 0

    if (query.sort === 'arrival36') {
      const candidates = await sql`
        SELECT profile_id, mlbam_id, player_type
        FROM app.player_directory_snapshot
        WHERE (
          ${query.q} = ''
          OR display_name ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(organization_code, '') ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(organization_name, '') ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(position, '') ILIKE ${searchPattern} ESCAPE '\\'
        )
          AND (${query.playerType} = 'All' OR player_type = ${query.playerType})
          AND (${query.level} = 'All' OR level = ${query.level})
      ` as unknown as Array<Pick<PlayerRow, 'profile_id' | 'mlbam_id' | 'player_type'>>

      const ranked = candidates
        .map((candidate) => ({
          ...candidate,
          probability: researchArrivalProbability(
            candidate.mlbam_id,
            candidate.player_type,
            36,
          ),
        }))
        .toSorted((left, right) => {
          if (left.probability === null && right.probability === null) {
            return left.profile_id.localeCompare(right.profile_id)
          }
          if (left.probability === null) return 1
          if (right.probability === null) return -1
          return right.probability - left.probability || left.profile_id.localeCompare(right.profile_id)
        })
      researchMatched = ranked.filter((candidate) => candidate.probability !== null).length
      researchPageIds = ranked.slice(offset, offset + query.limit).map((candidate) => candidate.profile_id)
    }

    const [rowResult, countResult] = await Promise.all([
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
        WHERE (
          ${query.q} = ''
          OR display_name ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(organization_code, '') ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(organization_name, '') ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(position, '') ILIKE ${searchPattern} ESCAPE '\\'
        )
          AND (${query.playerType} = 'All' OR player_type = ${query.playerType})
          AND (${query.level} = 'All' OR level = ${query.level})
          AND (${query.sort} <> 'arrival36' OR profile_id = ANY(${researchPageIds}::text[]))
        ORDER BY
          CASE WHEN ${query.sort} = 'psScore' THEN ps_score END DESC NULLS LAST,
          CASE WHEN ${query.sort} = 'psPercentile' THEN ps_percentile END DESC NULLS LAST,
          CASE WHEN ${query.sort} = 'age' THEN age END ASC NULLS LAST,
          CASE WHEN ${query.sort} = 'name' THEN display_name END ASC NULLS LAST,
          display_name ASC,
          profile_id ASC
        LIMIT ${query.limit}
        OFFSET ${rowOffset}
      `,
      sql`
        SELECT
          count(*)::text AS total,
          max(known_at)::text AS data_as_of,
          max(season) AS season
        FROM app.player_directory_snapshot
        WHERE (
          ${query.q} = ''
          OR display_name ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(organization_code, '') ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(organization_name, '') ILIKE ${searchPattern} ESCAPE '\\'
          OR coalesce(position, '') ILIKE ${searchPattern} ESCAPE '\\'
        )
          AND (${query.playerType} = 'All' OR player_type = ${query.playerType})
          AND (${query.level} = 'All' OR level = ${query.level})
      `,
    ])

    let rows = rowResult as unknown as PlayerRow[]
    if (query.sort === 'arrival36') {
      const order = new Map(researchPageIds.map((profileId, index) => [profileId, index]))
      rows = rows.toSorted(
        (left, right) =>
          (order.get(left.profile_id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.profile_id) ?? Number.MAX_SAFE_INTEGER),
      )
    }
    const [count] = countResult as unknown as CountRow[]
    const parsedTotal = Number(count?.total ?? 0)
    const total = Number.isSafeInteger(parsedTotal) && parsedTotal >= 0 ? parsedTotal : 0
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit)

    sendJson(
      request,
      response,
      200,
      {
        schemaVersion: 'players.v1',
        items: rows.map(playerRecord),
        page: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
        },
        meta: {
          source: 'Prospect Savant',
          dataset: 'Minor League Leaders',
          season: roundedNumber(count?.season ?? null, 0),
          dataAsOf: isoDate(count?.data_as_of ?? null),
          coverage: 'Current-season player-role profiles at each player\'s highest observed level',
          forecastStatus: 'research_only',
          researchCoverage: query.sort === 'arrival36' ? researchMatched : null,
          researchAsOf: researchPreviewSummary.asOf,
          releaseEligible: false,
        },
      },
      publicCache,
    )
  } catch (error) {
    console.error('Player directory query failed', error)
    sendJson(request, response, 503, { error: 'Player data is temporarily unavailable' })
  }
}
