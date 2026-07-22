import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { z } from 'zod'
import { directDatabaseUrl } from '../../db/client.js'
import { persistRawLanding, type RawLandingRecord } from './raw-landing.js'
import {
  currentRefreshDatabaseOptions,
  fetchWithRetry,
  idempotencyKey,
  normalizeRequestUrl,
  requestFingerprint,
  safeResponseHeaders,
  sanitizedRequest,
  schemaFingerprint,
  sha256,
  stableStringify,
  type SourceRecord,
} from './shared.js'

const positiveIntegerSchema = z.number().int().positive()
const nonemptyStringSchema = z.string().trim().min(1)

const positionSchema = z
  .object({
    abbreviation: nonemptyStringSchema,
    name: nonemptyStringSchema.optional(),
    type: nonemptyStringSchema.optional(),
  })
  .passthrough()

const milbTeamSchema = z
  .object({
    id: positiveIntegerSchema,
    name: nonemptyStringSchema,
    active: z.boolean().optional(),
    parentOrgId: positiveIntegerSchema,
    parentOrgName: nonemptyStringSchema,
    sport: z.object({ id: positiveIntegerSchema }).passthrough(),
  })
  .passthrough()

const rosterEntrySchema = z
  .object({
    person: z
      .object({
        id: positiveIntegerSchema,
        fullName: nonemptyStringSchema,
        active: z.boolean(),
        currentAge: z.number().int().nonnegative().optional(),
        mlbDebutDate: z.string().optional(),
        primaryPosition: positionSchema,
        batSide: z.object({ code: nonemptyStringSchema }).passthrough().optional(),
        pitchHand: z.object({ code: nonemptyStringSchema }).passthrough().optional(),
      })
      .passthrough(),
    position: positionSchema,
    status: z
      .object({
        code: nonemptyStringSchema,
        description: nonemptyStringSchema,
      })
      .passthrough(),
    parentTeamId: positiveIntegerSchema.optional(),
  })
  .passthrough()

const teamsEnvelopeSchema = z
  .object({
    teams: z.array(milbTeamSchema),
  })
  .passthrough()

const rosterEnvelopeSchema = z
  .object({
    rosterType: z.literal('fullRoster'),
    teamId: positiveIntegerSchema,
    roster: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough()

export const MLB_STATSAPI_MILB_ROSTER_PARSER_VERSION =
  'mlb-statsapi-milb-roster-census-v1'
export const MLB_STATSAPI_MILB_ROSTER_DATASET_KEY = 'current-milb-rosters'
export const MLB_STATSAPI_MILB_ROSTER_DEFAULT_BASE =
  'https://statsapi.mlb.com/api/v1/'
export const MLB_STATSAPI_MILB_ROSTER_SPORT_IDS = [11, 12, 13, 14, 16] as const
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_TEAMS = 180
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS = 30
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_ROWS = 12_500
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_AFFILIATE_ROWS = 6_000
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_PARENT_ROWS = 6_500
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS = 7_000
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_TEAM_ROWS = 10
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_PARENT_TEAM_ROWS = 100
export const MLB_STATSAPI_MILB_ROSTER_MINIMUM_PREVIOUS_RETENTION = 0.8
export const MLB_STATSAPI_MILB_ROSTER_MAXIMUM_QUARANTINE_RATE = 0.005
export const MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_TARGET_ROWS = 2_000
export const MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_BIND_PARAMETERS_PER_ROW = 7
export const MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_BIND_PARAMETER_BUDGET = 60_000
export const MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_PAYLOAD_BUDGET_BYTES = 32 * 1024 * 1024
export const MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_ROW_OVERHEAD_BYTES = 2_048

const minimumTeamsBySport = new Map<number, number>([
  [11, 25],
  [12, 25],
  [13, 25],
  [14, 25],
  [16, 50],
])

export type MlbStatsApiMilbRosterTeam = z.infer<typeof milbTeamSchema>
export type MlbStatsApiMilbRosterEntry = z.infer<typeof rosterEntrySchema>

export interface ParsedMlbStatsApiMilbTeamsEnvelope {
  teams: MlbStatsApiMilbRosterTeam[]
  teamsBySport: Record<string, number>
  organizations: number
}

export interface ParsedMlbStatsApiMilbRosterEnvelope {
  team: MlbStatsApiMilbRosterTeam
  roster: MlbStatsApiMilbRosterEntry[]
  reportedRows: number
  quarantinedRows: number
}

export interface MlbStatsApiMilbRosterPriorCardinality {
  teams: number
  rosterRows: number
  uniquePlayers: number
}

export interface MlbStatsApiMilbRosterCensusQuality {
  teams: number
  teamsBySport: Record<string, number>
  organizations: number
  parentRosters: number
  affiliateRosterRows: number
  parentRosterRows: number
  rosterRows: number
  uniquePlayers: number
  affiliateOnlyPlayers: number
  parentOnlyPlayers: number
  duplicateMembershipPlayers: number
  hitters: number
  pitchers: number
  minimumTeamRows: number
  minimumParentTeamRows: number
  quarantinedRows: number
  quarantineRate: number
  priorCardinality: MlbStatsApiMilbRosterPriorCardinality | null
  minimumPreviousRetention: number
}

export interface CapturedMlbStatsApiResponse {
  url: string
  statusCode: number
  mediaType: string
  contentEncoding: string | null
  etag: string | null
  lastModified: string | null
  headers: Record<string, string>
  bodyText: string
  bodySha256: string
  byteLength: number
}

export interface MlbStatsApiMilbRosterResponse {
  team: MlbStatsApiMilbRosterTeam
  membershipKind: 'affiliate' | 'parent_census'
  response: CapturedMlbStatsApiResponse
  roster: MlbStatsApiMilbRosterEntry[]
  reportedRows: number
  quarantinedRows: number
}

export interface FetchedMlbStatsApiMilbRosterCensus {
  season: number
  teamIndex: CapturedMlbStatsApiResponse
  teams: MlbStatsApiMilbRosterTeam[]
  rosterResponses: MlbStatsApiMilbRosterResponse[]
  quality: MlbStatsApiMilbRosterCensusQuality
}

export interface IngestMlbStatsApiMilbRosterResult {
  status: 'duplicate' | 'in_progress' | 'stored'
  responseHash: string
  teams: number
  rosterRows: number
  uniquePlayers: number
  season: number
}

export interface IngestMlbStatsApiMilbRosterOptions {
  apiBase?: string
  concurrency?: number
  priorCardinality?: MlbStatsApiMilbRosterPriorCardinality | null
  signal?: AbortSignal
}

export interface MlbStatsApiMilbRosterRawBatchPolicy {
  batchSize: number
  bindParameters: number
  bindParameterBudget: number
  estimatedMaximumRowBytes: number
  estimatedBatchPayloadBytes: number
  payloadBudgetBytes: number
  targetRows: number
}

const mlbStatsApiSyntheticRosterName = /^(?:Batter|Pitcher)\s+(?:One|Two)$/iu

export function isMlbStatsApiSyntheticRosterEntry(
  entry: Pick<MlbStatsApiMilbRosterEntry, 'person'>,
): boolean {
  return mlbStatsApiSyntheticRosterName.test(entry.person.fullName.trim())
}

export function mlbStatsApiMilbRosterRawBatchPolicyForMaxRecordBytes(
  maximumRecordBytes: number,
): MlbStatsApiMilbRosterRawBatchPolicy {
  if (!Number.isInteger(maximumRecordBytes) || maximumRecordBytes < 0) {
    throw new Error('MiLB roster raw-record byte size must be a non-negative integer')
  }
  const estimatedMaximumRowBytes =
    maximumRecordBytes + MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_ROW_OVERHEAD_BYTES
  if (estimatedMaximumRowBytes > MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_PAYLOAD_BUDGET_BYTES) {
    throw new Error(
      `A MiLB roster raw record requires an estimated ${estimatedMaximumRowBytes} bytes; ` +
        `the per-statement safety budget is ` +
        `${MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_PAYLOAD_BUDGET_BYTES}`,
    )
  }
  const bindRowLimit = Math.floor(
    MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_BIND_PARAMETER_BUDGET /
      MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_BIND_PARAMETERS_PER_ROW,
  )
  const payloadRowLimit = Math.max(
    1,
    Math.floor(
      MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_PAYLOAD_BUDGET_BYTES /
        estimatedMaximumRowBytes,
    ),
  )
  const batchSize = Math.min(
    MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_TARGET_ROWS,
    bindRowLimit,
    payloadRowLimit,
  )
  return {
    batchSize,
    bindParameters:
      batchSize * MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_BIND_PARAMETERS_PER_ROW,
    bindParameterBudget: MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_BIND_PARAMETER_BUDGET,
    estimatedMaximumRowBytes,
    estimatedBatchPayloadBytes: batchSize * estimatedMaximumRowBytes,
    payloadBudgetBytes: MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_PAYLOAD_BUDGET_BYTES,
    targetRows: MLB_STATSAPI_MILB_ROSTER_RAW_BATCH_TARGET_ROWS,
  }
}

export function mlbStatsApiMilbRosterRawBatchPolicy(
  records: readonly Pick<RawLandingRecord, 'record'>[],
): MlbStatsApiMilbRosterRawBatchPolicy {
  let maximumRecordBytes = 0
  for (const { record } of records) {
    maximumRecordBytes = Math.max(
      maximumRecordBytes,
      Buffer.byteLength(stableStringify(record), 'utf8'),
    )
  }
  return mlbStatsApiMilbRosterRawBatchPolicyForMaxRecordBytes(maximumRecordBytes)
}

function validateSeason(season: number): number {
  if (!Number.isInteger(season) || season < 1871 || season > 2200) {
    throw new Error('MLB StatsAPI MiLB roster season must be a plausible integer year')
  }
  return season
}

export function buildMlbStatsApiMilbTeamsUrl(
  season: number,
  apiBase = MLB_STATSAPI_MILB_ROSTER_DEFAULT_BASE,
): string {
  const url = new URL('teams', apiBase.endsWith('/') ? apiBase : `${apiBase}/`)
  url.searchParams.set('sportIds', MLB_STATSAPI_MILB_ROSTER_SPORT_IDS.join(','))
  url.searchParams.set('season', String(validateSeason(season)))
  url.searchParams.set('hydrate', 'division,league,parentOrg')
  return normalizeRequestUrl(url.toString())
}

export function buildMlbStatsApiMilbRosterUrl(
  teamId: number,
  season: number,
  apiBase = MLB_STATSAPI_MILB_ROSTER_DEFAULT_BASE,
): string {
  if (!Number.isInteger(teamId) || teamId <= 0) {
    throw new Error('MLB StatsAPI MiLB roster team ID must be a positive integer')
  }
  const url = new URL(
    `teams/${teamId}/roster`,
    apiBase.endsWith('/') ? apiBase : `${apiBase}/`,
  )
  url.searchParams.set('rosterType', 'fullRoster')
  url.searchParams.set('season', String(validateSeason(season)))
  url.searchParams.set(
    'hydrate',
    'person(primaryPosition,batSide,pitchHand,currentTeam)',
  )
  return normalizeRequestUrl(url.toString())
}

export function parseMlbStatsApiMilbTeamsEnvelope(
  body: string,
): ParsedMlbStatsApiMilbTeamsEnvelope {
  const { teams } = teamsEnvelopeSchema.parse(JSON.parse(body))
  const teamIds = teams.map((team) => team.id)
  if (new Set(teamIds).size !== teams.length) {
    throw new Error('MLB StatsAPI MiLB team census contains duplicate team IDs')
  }

  const supportedSports = new Set<number>(MLB_STATSAPI_MILB_ROSTER_SPORT_IDS)
  const unexpectedSports = teams.filter((team) => !supportedSports.has(team.sport.id))
  if (unexpectedSports.length > 0) {
    throw new Error(
      `MLB StatsAPI MiLB team census contains ${unexpectedSports.length} unsupported sport row(s)`,
    )
  }

  const teamsBySport = Object.fromEntries(
    MLB_STATSAPI_MILB_ROSTER_SPORT_IDS.map((sportId) => [
      String(sportId),
      teams.filter((team) => team.sport.id === sportId).length,
    ]),
  )
  return {
    teams,
    teamsBySport,
    organizations: new Set(teams.map((team) => team.parentOrgId)).size,
  }
}

export function parseMlbStatsApiMilbRosterEnvelope(
  body: string,
  team: MlbStatsApiMilbRosterTeam,
): ParsedMlbStatsApiMilbRosterEnvelope {
  const envelope = rosterEnvelopeSchema.parse(JSON.parse(body))
  if (envelope.teamId !== team.id) {
    throw new Error(
      `MLB StatsAPI full roster for team ${team.id} identified itself as team ${envelope.teamId}`,
    )
  }

  const seenPlayerIds = new Set<number>()
  const roster: MlbStatsApiMilbRosterEntry[] = []
  let quarantinedRows = 0
  for (const sourceEntry of envelope.roster) {
    const parsed = rosterEntrySchema.safeParse(sourceEntry)
    if (!parsed.success) {
      quarantinedRows += 1
      continue
    }
    const entry = parsed.data
    if (
      isMlbStatsApiSyntheticRosterEntry(entry) ||
      seenPlayerIds.has(entry.person.id) ||
      (entry.parentTeamId !== undefined && entry.parentTeamId !== team.parentOrgId)
    ) {
      quarantinedRows += 1
      continue
    }
    seenPlayerIds.add(entry.person.id)
    roster.push(entry)
  }
  return {
    team,
    roster,
    reportedRows: envelope.roster.length,
    quarantinedRows,
  }
}

export function mlbStatsApiMilbRosterPlayerType(
  entry: MlbStatsApiMilbRosterEntry,
): 'Hitter' | 'Pitcher' {
  const primary = entry.person.primaryPosition
  if (
    primary.type?.toLowerCase() === 'pitcher' ||
    (primary.type === undefined && primary.abbreviation.toUpperCase() === 'P')
  ) {
    return 'Pitcher'
  }
  return 'Hitter'
}

function hydratedCurrentTeamRecord(
  entry: MlbStatsApiMilbRosterEntry,
): Record<string, unknown> | null {
  const currentTeam = entry.person.currentTeam
  return currentTeam !== null &&
    typeof currentTeam === 'object' &&
    !Array.isArray(currentTeam)
    ? currentTeam as Record<string, unknown>
    : null
}

export function hydratedRosterOrganizationId(
  entry: MlbStatsApiMilbRosterEntry,
  affiliateTeamsById: ReadonlyMap<number, MlbStatsApiMilbRosterTeam>,
  organizationIds: ReadonlySet<number>,
): number | null {
  const currentTeam = hydratedCurrentTeamRecord(entry)
  if (!currentTeam) return null
  if (
    typeof currentTeam.parentOrgId === 'number' &&
    Number.isInteger(currentTeam.parentOrgId) &&
    currentTeam.parentOrgId > 0
  ) {
    return currentTeam.parentOrgId
  }
  if (
    typeof currentTeam.id !== 'number' ||
    !Number.isInteger(currentTeam.id) ||
    currentTeam.id <= 0
  ) {
    return null
  }
  const affiliate = affiliateTeamsById.get(currentTeam.id)
  if (affiliate) return affiliate.parentOrgId
  return organizationIds.has(currentTeam.id) ? currentTeam.id : null
}

export function quarantineStaleOrganizationMemberships(
  response: MlbStatsApiMilbRosterResponse,
  affiliateTeamsById: ReadonlyMap<number, MlbStatsApiMilbRosterTeam>,
  organizationIds: ReadonlySet<number>,
): MlbStatsApiMilbRosterResponse {
  const roster = response.roster.filter((entry) => {
    const hydratedOrganizationId = hydratedRosterOrganizationId(
      entry,
      affiliateTeamsById,
      organizationIds,
    )
    return hydratedOrganizationId === null ||
      hydratedOrganizationId === response.team.parentOrgId
  })
  return {
    ...response,
    roster,
    quarantinedRows: response.quarantinedRows + response.roster.length - roster.length,
  }
}

function assertNonnegativeCardinality(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

export function assertMlbStatsApiMilbRosterCensus(
  teamEnvelope: ParsedMlbStatsApiMilbTeamsEnvelope,
  rosterResponses: readonly Pick<
    MlbStatsApiMilbRosterResponse,
    'team' | 'membershipKind' | 'roster' | 'reportedRows' | 'quarantinedRows'
  >[],
  priorCardinality: MlbStatsApiMilbRosterPriorCardinality | null = null,
): MlbStatsApiMilbRosterCensusQuality {
  if (teamEnvelope.teams.length < MLB_STATSAPI_MILB_ROSTER_MINIMUM_TEAMS) {
    throw new Error(
      `MLB StatsAPI MiLB roster census returned ${teamEnvelope.teams.length} teams; ` +
        `expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_TEAMS}`,
    )
  }
  if (teamEnvelope.organizations < MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS) {
    throw new Error(
      `MLB StatsAPI MiLB roster census covers ${teamEnvelope.organizations} organizations; ` +
        `expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS}`,
    )
  }
  for (const [sportId, minimum] of minimumTeamsBySport) {
    const observed = teamEnvelope.teamsBySport[String(sportId)] ?? 0
    if (observed < minimum) {
      throw new Error(
        `MLB StatsAPI MiLB sport ${sportId} returned ${observed} teams; expected at least ${minimum}`,
      )
    }
  }

  const affiliateResponses = rosterResponses.filter(
    (response) => response.membershipKind === 'affiliate',
  )
  const parentResponses = rosterResponses.filter(
    (response) => response.membershipKind === 'parent_census',
  )
  const expectedTeamIds = new Set(teamEnvelope.teams.map((team) => team.id))
  const observedTeamIds = affiliateResponses.map((response) => response.team.id)
  const uniqueObservedTeamIds = new Set(observedTeamIds)
  if (
    observedTeamIds.length !== expectedTeamIds.size ||
    uniqueObservedTeamIds.size !== expectedTeamIds.size ||
    [...expectedTeamIds].some((teamId) => !uniqueObservedTeamIds.has(teamId))
  ) {
    throw new Error(
      `MLB StatsAPI MiLB roster census fetched ${uniqueObservedTeamIds.size} unique team rosters ` +
        `for ${expectedTeamIds.size} indexed teams`,
    )
  }

  const expectedOrganizationIds = new Set(
    teamEnvelope.teams.map((team) => team.parentOrgId),
  )
  const observedParentIds = parentResponses.map((response) => response.team.id)
  const uniqueObservedParentIds = new Set(observedParentIds)
  if (
    observedParentIds.length !== expectedOrganizationIds.size ||
    uniqueObservedParentIds.size !== expectedOrganizationIds.size ||
    [...expectedOrganizationIds].some((teamId) => !uniqueObservedParentIds.has(teamId))
  ) {
    throw new Error(
      `MLB StatsAPI MiLB roster census fetched ${uniqueObservedParentIds.size} unique parent ` +
        `organization rosters for ${expectedOrganizationIds.size} discovered organizations`,
    )
  }

  const minimumTeamRows = Math.min(
    ...affiliateResponses.map((response) => response.roster.length),
  )
  if (minimumTeamRows < MLB_STATSAPI_MILB_ROSTER_MINIMUM_TEAM_ROWS) {
    const shortTeam = affiliateResponses.find(
      (response) => response.roster.length === minimumTeamRows,
    )
    throw new Error(
      `MLB StatsAPI full roster for team ${shortTeam?.team.id ?? 'unknown'} returned ` +
        `${minimumTeamRows} players; expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_TEAM_ROWS}`,
    )
  }

  const minimumParentTeamRows = Math.min(
    ...parentResponses.map((response) => response.roster.length),
  )
  if (minimumParentTeamRows < MLB_STATSAPI_MILB_ROSTER_MINIMUM_PARENT_TEAM_ROWS) {
    const shortParent = parentResponses.find(
      (response) => response.roster.length === minimumParentTeamRows,
    )
    throw new Error(
      `MLB StatsAPI full parent roster for organization ` +
        `${shortParent?.team.id ?? 'unknown'} returned ${minimumParentTeamRows} players; ` +
        `expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_PARENT_TEAM_ROWS}`,
    )
  }

  const affiliateEntries = affiliateResponses.flatMap((response) => response.roster)
  const parentEntries = parentResponses.flatMap((response) => response.roster)
  const entries = [...affiliateEntries, ...parentEntries]
  if (affiliateEntries.length < MLB_STATSAPI_MILB_ROSTER_MINIMUM_AFFILIATE_ROWS) {
    throw new Error(
      `MLB StatsAPI MiLB affiliate rosters returned ${affiliateEntries.length} memberships; ` +
        `expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_AFFILIATE_ROWS}`,
    )
  }
  if (parentEntries.length < MLB_STATSAPI_MILB_ROSTER_MINIMUM_PARENT_ROWS) {
    throw new Error(
      `MLB StatsAPI parent rosters returned ${parentEntries.length} memberships; ` +
        `expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_PARENT_ROWS}`,
    )
  }
  const playerIds = entries.map((entry) => entry.person.id)
  const uniquePlayers = new Set(playerIds).size
  const rosterRows = entries.length
  if (rosterRows < MLB_STATSAPI_MILB_ROSTER_MINIMUM_ROWS) {
    throw new Error(
      `MLB StatsAPI MiLB roster census returned ${rosterRows} memberships; ` +
        `expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_ROWS}`,
    )
  }
  if (uniquePlayers < MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS) {
    throw new Error(
      `MLB StatsAPI MiLB roster census returned ${uniquePlayers} unique players; ` +
        `expected at least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS}`,
    )
  }

  const quarantinedRows = rosterResponses.reduce(
    (total, response) => total + response.quarantinedRows,
    0,
  )
  const reportedRows = rosterResponses.reduce(
    (total, response) => total + response.reportedRows,
    0,
  )
  const quarantineRate = quarantinedRows / Math.max(reportedRows, 1)
  if (quarantineRate > MLB_STATSAPI_MILB_ROSTER_MAXIMUM_QUARANTINE_RATE) {
    throw new Error(
      `MLB StatsAPI MiLB roster census quarantined ${quarantinedRows} of ` +
        `${reportedRows} source rows (${(quarantineRate * 100).toFixed(2)}%); ` +
        `maximum allowed is ${(MLB_STATSAPI_MILB_ROSTER_MAXIMUM_QUARANTINE_RATE * 100).toFixed(2)}%`,
    )
  }

  if (priorCardinality) {
    assertNonnegativeCardinality(priorCardinality.teams, 'Prior team count')
    assertNonnegativeCardinality(priorCardinality.rosterRows, 'Prior roster-row count')
    assertNonnegativeCardinality(priorCardinality.uniquePlayers, 'Prior unique-player count')
    const observed = {
      teams: teamEnvelope.teams.length,
      rosterRows,
      uniquePlayers,
    }
    for (const key of ['teams', 'rosterRows', 'uniquePlayers'] as const) {
      const minimum = Math.ceil(
        priorCardinality[key] * MLB_STATSAPI_MILB_ROSTER_MINIMUM_PREVIOUS_RETENTION,
      )
      if (observed[key] < minimum) {
        throw new Error(
          `MLB StatsAPI MiLB roster census retained ${observed[key]} ${key}; ` +
            `expected at least ${minimum} after ${priorCardinality[key]} previously`,
        )
      }
    }
  }

  const membershipCounts = new Map<number, number>()
  let hitters = 0
  let pitchers = 0
  for (const entry of entries) {
    membershipCounts.set(entry.person.id, (membershipCounts.get(entry.person.id) ?? 0) + 1)
    if (mlbStatsApiMilbRosterPlayerType(entry) === 'Pitcher') pitchers += 1
    else hitters += 1
  }
  if (hitters === 0 || pitchers === 0) {
    throw new Error('MLB StatsAPI MiLB roster census did not contain both player roles')
  }

  const affiliatePlayerIds = new Set(affiliateEntries.map((entry) => entry.person.id))
  const parentPlayerIds = new Set(parentEntries.map((entry) => entry.person.id))

  return {
    teams: teamEnvelope.teams.length,
    teamsBySport: teamEnvelope.teamsBySport,
    organizations: teamEnvelope.organizations,
    parentRosters: parentResponses.length,
    affiliateRosterRows: affiliateEntries.length,
    parentRosterRows: parentEntries.length,
    rosterRows,
    uniquePlayers,
    affiliateOnlyPlayers: [...affiliatePlayerIds].filter((id) => !parentPlayerIds.has(id)).length,
    parentOnlyPlayers: [...parentPlayerIds].filter((id) => !affiliatePlayerIds.has(id)).length,
    duplicateMembershipPlayers: [...membershipCounts.values()].filter((count) => count > 1).length,
    hitters,
    pitchers,
    minimumTeamRows,
    minimumParentTeamRows,
    quarantinedRows,
    quarantineRate,
    priorCardinality,
    minimumPreviousRetention: MLB_STATSAPI_MILB_ROSTER_MINIMUM_PREVIOUS_RETENTION,
  }
}

export async function mapWithBoundedConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error('MLB StatsAPI MiLB roster concurrency must be an integer from 1 through 20')
  }
  const results = new Array<Output>(values.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  )
  return results
}

async function captureMlbStatsApiResponse(
  url: string,
  signal?: AbortSignal,
): Promise<CapturedMlbStatsApiResponse> {
  const response = await fetchWithRetry(url, {
    sourceName: 'MLB StatsAPI',
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'BaseballOracleResearch/0.1 (+https://github.com/RobCase29/baseball-oracle)',
    },
    timeoutMs: 60_000,
  })
  const bodyText = await response.text()
  signal?.throwIfAborted()
  return {
    url,
    statusCode: response.status,
    mediaType: response.headers.get('content-type') ?? 'application/json',
    contentEncoding: response.headers.get('content-encoding'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    headers: safeResponseHeaders(response),
    bodyText,
    bodySha256: sha256(bodyText),
    byteLength: Buffer.byteLength(bodyText, 'utf8'),
  }
}

export async function fetchMlbStatsApiMilbRosterCensus(
  season: number,
  options: IngestMlbStatsApiMilbRosterOptions = {},
): Promise<FetchedMlbStatsApiMilbRosterCensus> {
  options.signal?.throwIfAborted()
  const validatedSeason = validateSeason(season)
  const apiBase = options.apiBase ?? process.env.MLB_STATSAPI_BASE ??
    MLB_STATSAPI_MILB_ROSTER_DEFAULT_BASE
  const teamIndex = await captureMlbStatsApiResponse(
    buildMlbStatsApiMilbTeamsUrl(validatedSeason, apiBase),
    options.signal,
  )
  const parsedTeams = parseMlbStatsApiMilbTeamsEnvelope(teamIndex.bodyText)
  const affiliateTeamsById = new Map(
    parsedTeams.teams.map((team) => [team.id, team]),
  )
  const affiliateResponses = await mapWithBoundedConcurrency(
    [...parsedTeams.teams].sort((left, right) => left.id - right.id),
    options.concurrency ?? 8,
    async (team) => {
      options.signal?.throwIfAborted()
      const response = await captureMlbStatsApiResponse(
        buildMlbStatsApiMilbRosterUrl(team.id, validatedSeason, apiBase),
        options.signal,
      )
      const parsed = parseMlbStatsApiMilbRosterEnvelope(response.bodyText, team)
      return {
        team,
        membershipKind: 'affiliate' as const,
        response,
        roster: parsed.roster,
        reportedRows: parsed.reportedRows,
        quarantinedRows: parsed.quarantinedRows,
      }
    },
  )
  const organizations = [...new Map(
    parsedTeams.teams.map((team) => [
      team.parentOrgId,
      { id: team.parentOrgId, name: team.parentOrgName },
    ]),
  ).values()].sort((left, right) => left.id - right.id)
  const organizationIds = new Set(organizations.map((organization) => organization.id))
  const parentResponses = await mapWithBoundedConcurrency(
    organizations,
    options.concurrency ?? 8,
    async (organization) => {
      options.signal?.throwIfAborted()
      const team = milbTeamSchema.parse({
        id: organization.id,
        name: organization.name,
        active: true,
        parentOrgId: organization.id,
        parentOrgName: organization.name,
        sport: { id: 1, name: 'Major League Baseball' },
      })
      const response = await captureMlbStatsApiResponse(
        buildMlbStatsApiMilbRosterUrl(team.id, validatedSeason, apiBase),
        options.signal,
      )
      const parsed = parseMlbStatsApiMilbRosterEnvelope(response.bodyText, team)
      return {
        team,
        membershipKind: 'parent_census' as const,
        response,
        roster: parsed.roster,
        reportedRows: parsed.reportedRows,
        quarantinedRows: parsed.quarantinedRows,
      }
    },
  )
  const rosterResponses = [...affiliateResponses, ...parentResponses].map((response) =>
    quarantineStaleOrganizationMemberships(
      response,
      affiliateTeamsById,
      organizationIds,
    ),
  )
  const quality = assertMlbStatsApiMilbRosterCensus(
    parsedTeams,
    rosterResponses,
    options.priorCardinality ?? null,
  )
  return {
    season: validatedSeason,
    teamIndex,
    teams: parsedTeams.teams,
    rosterResponses,
    quality,
  }
}

export function composeMlbStatsApiMilbRosterBundle(
  census: FetchedMlbStatsApiMilbRosterCensus,
): { bodyText: string; responseHash: string; records: RawLandingRecord[] } {
  const bodyText = stableStringify({
    parserVersion: MLB_STATSAPI_MILB_ROSTER_PARSER_VERSION,
    season: census.season,
    sportIds: MLB_STATSAPI_MILB_ROSTER_SPORT_IDS,
    teamIndex: census.teamIndex,
    rosterResponses: census.rosterResponses.map(({ team, membershipKind, response }) => ({
      teamId: team.id,
      membershipKind,
      response,
    })),
  })
  const affiliateTeamsById = new Map(census.teams.map((team) => [team.id, team]))
  const records = census.rosterResponses.flatMap(({
    team,
    membershipKind,
    response,
    roster,
  }) =>
    roster.map((rosterEntry): RawLandingRecord => {
      const currentTeam = hydratedCurrentTeamRecord(rosterEntry)
      const hydratedCurrentTeamId =
        currentTeam !== null && typeof currentTeam.id === 'number'
          ? currentTeam.id
          : null
      const assignmentTeam = membershipKind === 'affiliate'
        ? team
        : hydratedCurrentTeamId === null
          ? null
          : affiliateTeamsById.get(hydratedCurrentTeamId) ?? null
      const record: SourceRecord = {
        season: census.season,
        rosterType: 'fullRoster',
        membershipKind,
        team,
        organization: {
          id: team.parentOrgId,
          name: team.parentOrgName,
        },
        assignmentTeam,
        rosterEntry,
        sourceEvidence: {
          teamIndexSha256: census.teamIndex.bodySha256,
          rosterResponseSha256: response.bodySha256,
        },
      }
      return {
        record,
        recordType: 'milb_roster_member',
        sourceRecordKey:
          `mlbam:${rosterEntry.person.id}|membership:${membershipKind}|` +
            `team:${team.id}|season:${census.season}`,
        recordSha256: sha256(stableStringify(record)),
      }
    }),
  )
  return { bodyText, responseHash: sha256(bodyText), records }
}

async function previousMlbRosterCardinality(
  sql: ReturnType<typeof postgres>,
): Promise<MlbStatsApiMilbRosterPriorCardinality | null> {
  const [previous] = await sql<{
    teams: number
    roster_rows: number
    unique_players: number
  }[]>`
    SELECT
      (run.counts->>'teams')::integer AS teams,
      (run.counts->>'rosterRows')::integer AS roster_rows,
      (run.counts->>'uniquePlayers')::integer AS unique_players
    FROM raw.ingestion_run AS run
    JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
    JOIN catalog.source AS source ON source.id = dataset.source_id
    WHERE source.slug = 'mlb-statsapi'
      AND dataset.dataset_key = ${MLB_STATSAPI_MILB_ROSTER_DATASET_KEY}
      AND run.status = 'succeeded'
      AND run.parser_version = ${MLB_STATSAPI_MILB_ROSTER_PARSER_VERSION}
      AND run.counts->>'teams' ~ '^\\d+$'
      AND run.counts->>'rosterRows' ~ '^\\d+$'
      AND run.counts->>'uniquePlayers' ~ '^\\d+$'
    ORDER BY run.finished_at DESC NULLS LAST, run.started_at DESC
    LIMIT 1
  `
  return previous
    ? {
        teams: previous.teams,
        rosterRows: previous.roster_rows,
        uniquePlayers: previous.unique_players,
      }
    : null
}

export async function ingestMlbStatsApiMilbRosterCensus(
  season: number,
  options: IngestMlbStatsApiMilbRosterOptions = {},
): Promise<IngestMlbStatsApiMilbRosterResult> {
  options.signal?.throwIfAborted()
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(120_000))
  try {
    const priorCardinality = options.priorCardinality === undefined
      ? await previousMlbRosterCardinality(sql)
      : options.priorCardinality
    const census = await fetchMlbStatsApiMilbRosterCensus(season, {
      ...options,
      priorCardinality,
    })
    const fetchedAt = new Date()
    const bundle = composeMlbStatsApiMilbRosterBundle(census)
    const rawLandingBatchPolicy = mlbStatsApiMilbRosterRawBatchPolicy(bundle.records)
    const landing = await persistRawLanding(sql, {
      signal: options.signal,
      sourceSlug: 'mlb-statsapi',
      datasetKey: MLB_STATSAPI_MILB_ROSTER_DATASET_KEY,
      idempotencyKey: idempotencyKey(census.teamIndex.url, bundle.responseHash),
      mode: 'snapshot',
      requestedAsOf: fetchedAt,
      parserVersion: MLB_STATSAPI_MILB_ROSTER_PARSER_VERSION,
      parameters: {
        request: sanitizedRequest(census.teamIndex.url),
        season: census.season,
        sportIds: MLB_STATSAPI_MILB_ROSTER_SPORT_IDS,
        rosterType: 'fullRoster',
        hydration: 'person(primaryPosition,batSide,pitchHand,currentTeam)',
        identityPolicy: 'exact_mlbam_only',
        rolePolicy: 'primary_pitcher_else_hitter_including_two_way',
        atomicBundle: true,
        rawLandingBatchPolicy,
        sourceResponses: 1 + census.rosterResponses.length,
        semanticQuality: census.quality,
      },
      counts: {
        ...census.quality,
        rows: census.quality.rosterRows,
        rawLandingBatchPolicy,
        schema: schemaFingerprint(bundle.records.map((record) => record.record)),
        sourceResponses: 1 + census.rosterResponses.length,
      },
      fetchedAt,
      request: {
        sanitized: sanitizedRequest(census.teamIndex.url),
        fingerprint: requestFingerprint(census.teamIndex.url),
      },
      response: {
        sha256: bundle.responseHash,
        byteLength: Buffer.byteLength(bundle.bodyText, 'utf8'),
        mediaType: 'application/vnd.baseball-oracle.milb-roster-bundle+json',
        contentEncoding: null,
        statusCode: 200,
        etag: null,
        lastModified: null,
        headers: {
          'content-type': 'application/vnd.baseball-oracle.milb-roster-bundle+json',
          'x-source-response-count': String(1 + census.rosterResponses.length),
        },
        bodyText: bundle.bodyText,
      },
      records: bundle.records,
      batchSize: rawLandingBatchPolicy.batchSize,
    })
    options.signal?.throwIfAborted()
    return {
      status: landing.status,
      responseHash: bundle.responseHash,
      teams: census.quality.teams,
      rosterRows: census.quality.rosterRows,
      uniquePlayers: census.quality.uniquePlayers,
      season: census.season,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  const seasonArgument = process.argv.find((argument) => argument.startsWith('--season='))
  const season = Number(seasonArgument?.slice('--season='.length))
  if (!seasonArgument || !Number.isInteger(season)) {
    process.stderr.write('Usage: mlb-statsapi-milb-roster.ts --season=YYYY\n')
    process.exitCode = 1
  } else {
    ingestMlbStatsApiMilbRosterCensus(season)
      .then(async (result) => {
        const { refreshCurrentMilbRosterSnapshot } = await import('./player-directory.js')
        await refreshCurrentMilbRosterSnapshot()
        process.stdout.write(`${JSON.stringify(result)}\n`)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown roster census error'
        process.stderr.write(`${message}\n`)
        process.exitCode = 1
      })
  }
}
