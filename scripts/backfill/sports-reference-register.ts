import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document } }
}

export const SOURCE_SLUG = 'baseball-reference-register'
export const PARSER_VERSION = 'baseball-reference-register/v4'
export const STATE_SCHEMA_VERSION = 'baseball-reference-register-state/v1'
export const REQUEST_SCHEMA_VERSION = 'baseball-reference-register-request/v1'
export const RUN_SCHEMA_VERSION = 'baseball-reference-register-run/v1'
export const USER_AGENT =
  'BaseballOracleResearch/0.1 (+https://github.com/RobCase29/baseball-oracle; authorized research backfill)'
export const CRAWL_DELAY_MS = 3_200
export const DEFAULT_SEASON = 2017
export const DEFAULT_MAX_TEAMS = 1
export const MAX_TEAMS_PER_RUN = 250
export const MAX_ATTEMPTS = 3
export const MAX_RETRY_AFTER_MS = 5 * 60_000

const BASE_URL = 'https://www.baseball-reference.com'
const TEAM_ID_PATTERN = /^[0-9a-f]{8}$/
const PLAYER_ID_PATTERN = /^[a-z0-9-]{11,12}$/
const STRUCTURAL_2020_REASON =
  'The affiliated Minor League Baseball season was canceled; zero team-season pages are expected.'

type TableRow = Record<string, string | null>

export interface TeamDiscovery {
  teamId: string
  url: string
  teamName: string
  organization: string
  organizationId: string | null
  level: string
  leagueAbbreviation: string | null
  organizations: Array<{ name: string; id: string | null }>
}

export interface AffiliateDiscovery {
  season: number
  teams: TeamDiscovery[]
  declaredTeamCount: number
  affiliateSlotCount: number
}

export interface ParsedTeamPage {
  team: TeamDiscovery & {
    season: number
    classification: string
    league: string
  }
  roster: TableRow[]
  batting: TableRow[]
  pitching: TableRow[]
  fielding: TableRow[]
}

export interface PlayerTeamSeasonRow extends TableRow {
  source_id_namespace: 'bbref_minors'
  source_player_id: string
  season: string
  team_id: string
  team_name: string
  organization: string
  level: string
  league: string
  player_name: string
  roster_status: 'season_participant'
  role: 'hitter' | 'pitcher' | 'two_way'
  role_inference: string
  position: string
}

interface PermissionEvidence {
  path: string
  sha256: string
}

interface RequestReceipt {
  schemaVersion: typeof REQUEST_SCHEMA_VERSION
  source: typeof SOURCE_SLUG
  requestFingerprint: string
  request: {
    method: 'GET'
    url: string
    userAgent: string
    acceptEncoding: 'identity'
  }
  response: {
    status: number
    finalUrl: string
    headers: Record<string, string>
  }
  retrievedAt: string
  attemptCount: number
  byteLength: number
  sha256: string
  mediaType: string
  payloadPath: string
  parserVersion: typeof PARSER_VERSION
  permissionEvidence: PermissionEvidence
}

interface TeamUnitState extends TeamDiscovery {
  status: 'pending' | 'succeeded' | 'failed'
  attempts: number
  requestFingerprint: string
  lastError: string | null
}

interface BackfillState {
  schemaVersion: typeof STATE_SCHEMA_VERSION
  source: typeof SOURCE_SLUG
  season: number
  createdAt: string
  updatedAt: string
  structuralZeroSeason: boolean
  structuralReason: string | null
  declaredTeamCount: number | null
  affiliateSlotCount: number | null
  discovery: {
    url: string
    status: 'pending' | 'succeeded' | 'failed' | 'structural'
    attempts: number
    requestFingerprint: string
    lastError: string | null
  }
  teams: TeamUnitState[]
}

interface CacheResult {
  receipt: RequestReceipt
  body: Uint8Array
  cacheStatus: 'downloaded' | 'verified'
  liveAttempts: number
}

interface FetchContext {
  rootDir: string
  permissionEvidence: PermissionEvidence
  fetchImpl: typeof fetch
  now: () => Date
  sleep: (milliseconds: number) => Promise<void>
  onLiveAttempt?: (at: string) => Promise<void> | void
  lastLiveRequestMs: number | null
}

interface RunOptions {
  rootDir: string
  season: number
  maxTeams: number
  execute: boolean
  fetchImpl?: typeof fetch
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  log?: (message: string) => void
}

export type ReleaseAcquisitionLock = () => Promise<void>

export interface BackfillRunResult {
  season: number
  status: 'dry-run' | 'partial' | 'complete' | 'structural-zero-season'
  discoveredTeams: number
  completedTeams: number
  attemptedTeams: number
  outputDirectory: string
  runManifestPath: string | null
}

class StopAndResumeError extends Error {}

export class StructuralValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructuralValidationError'
  }
}

function sha256(body: Uint8Array | string): string {
  return createHash('sha256').update(body).digest('hex')
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function asUrl(url: string): URL {
  const parsed = new URL(url, BASE_URL)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.baseball-reference.com') {
    throw new Error(`Refusing URL outside Baseball-Reference: ${parsed.toString()}`)
  }
  if (!parsed.pathname.startsWith('/register/')) {
    throw new Error(`Refusing URL outside the Baseball-Reference Register: ${parsed.toString()}`)
  }
  return parsed
}

export function retryAfterMilliseconds(
  value: string | null,
  now: Date,
): number {
  if (!value) return 0
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000)
  }
  const retryAt = Date.parse(value)
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now.getTime()) : 0
}

function affiliateUrl(season: number): string {
  return `${BASE_URL}/register/affiliate.cgi?year=${season}`
}

function teamUrl(teamId: string): string {
  if (!TEAM_ID_PATTERN.test(teamId)) throw new Error(`Invalid Register team ID: ${teamId}`)
  return `${BASE_URL}/register/team.cgi?id=${teamId}`
}

export function requestFingerprint(url: string): string {
  const canonicalUrl = asUrl(url).toString()
  return sha256(
    JSON.stringify({
      method: 'GET',
      url: canonicalUrl,
      userAgent: USER_AGENT,
      acceptEncoding: 'identity',
    }),
  )
}

function htmlDocuments(html: string): Document[] {
  const main = new JSDOM(html).window.document
  const documents = [main]
  const walker = main.createTreeWalker(main, 128)
  let node = walker.nextNode()
  while (node) {
    const value = node.nodeValue ?? ''
    if (value.includes('<table')) documents.push(new JSDOM(value).window.document)
    node = walker.nextNode()
  }
  return documents
}

function findTable(documents: Document[], id: string): HTMLTableElement | null {
  for (const document of documents) {
    const candidate = document.getElementById(id)
    const table = candidate?.tagName === 'TABLE' ? (candidate as HTMLTableElement) : null
    if (table) return table
  }
  return null
}

function allTables(documents: Document[], selector: string): HTMLTableElement[] {
  const result: HTMLTableElement[] = []
  for (const document of documents) {
    result.push(...document.querySelectorAll<HTMLTableElement>(selector))
  }
  return result
}

function playerIdentityCandidate(value: string, label: string): string {
  const parsed = new URL(value, BASE_URL)
  if (!parsed.pathname.endsWith('/player.fcgi')) {
    throw new StructuralValidationError(`${label} has an unexpected player URL: ${value}`)
  }
  const candidate = parsed.searchParams.get('id') ?? ''
  if (!PLAYER_ID_PATTERN.test(candidate)) {
    throw new StructuralValidationError(`${label} has an invalid Register player ID: ${candidate || 'missing'}`)
  }
  return candidate
}

function playerIdFromCell(cell: Element, label: string): string | null {
  const candidates: string[] = []
  const appended = normalizeText(cell.getAttribute('data-append-csv'))
  if (appended) candidates.push(playerIdentityCandidate(appended, `${label} data-append-csv`))
  for (const [index, link] of [
    ...cell.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ].entries()) {
    candidates.push(
      playerIdentityCandidate(link.getAttribute('href') ?? '', `${label} link ${index + 1}`),
    )
  }
  const unique = [...new Set(candidates)]
  if (unique.length > 1) {
    throw new StructuralValidationError(`${label} contains conflicting Register player IDs`)
  }
  return unique[0] ?? null
}

function cellValue(cell: Element, dataStat: string): string | null {
  if (dataStat === 'player') {
    return normalizeText(cell.querySelector('a')?.textContent ?? cell.textContent) || null
  }
  if (['age', 'height', 'date_of_birth'].includes(dataStat)) {
    const sortable = normalizeText(cell.getAttribute('csk'))
    if (sortable) return sortable
  }
  return normalizeText(cell.textContent) || null
}

function parseTable(table: HTMLTableElement, extra: TableRow = {}): TableRow[] {
  const rows: TableRow[] = []
  for (const [index, tr] of [
    ...table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ].entries()) {
    if (tr.classList.contains('thead')) continue
    const cells = tr.querySelectorAll<HTMLElement>('th,td')
    if (cells.length === 0) continue
    const label = `table#${table.id || 'unknown'} row ${index + 1}`
    const playerCell = tr.querySelector<HTMLElement>('[data-stat="player"]')
    if (!playerCell) {
      throw new StructuralValidationError(`${label} is a non-header data row without a player cell`)
    }
    const sourcePlayerId = playerIdFromCell(playerCell, label)
    if (!sourcePlayerId) {
      throw new StructuralValidationError(`${label} has no accepted Register player ID`)
    }
    const row: TableRow = {
      ...extra,
      source_id_namespace: 'bbref_minors',
      source_player_id: sourcePlayerId,
      player_name: cellValue(playerCell, 'player'),
    }
    for (const cell of tr.querySelectorAll<HTMLElement>('th[data-stat],td[data-stat]')) {
      const dataStat = cell.getAttribute('data-stat')
      if (!dataStat || dataStat === 'player') continue
      row[dataStat] = cellValue(cell, dataStat)
    }
    rows.push(row)
  }
  return rows
}

function labeledMeta(document: Document, label: string): string {
  for (const paragraph of document.querySelectorAll('#meta p')) {
    const strong = paragraph.querySelector('strong')
    if (normalizeText(strong?.textContent).replace(/:$/, '') !== label) continue
    const clone = paragraph.cloneNode(true) as HTMLElement
    clone.querySelector('strong')?.remove()
    return normalizeText(clone.textContent).replace(/^:/, '').trim()
  }
  return ''
}

export function parseAffiliatePage(html: string, season: number): AffiliateDiscovery {
  if (season === 2020) {
    return { season, teams: [], declaredTeamCount: 0, affiliateSlotCount: 0 }
  }
  const documents = htmlDocuments(html)
  const table = findTable(documents, 'affiliates')
  if (!table) throw new Error(`Affiliate page for ${season} is missing table#affiliates`)
  const teams = new Map<string, TeamDiscovery>()
  const relationships = new Set<string>()
  let declaredAffiliateSlots = 0

  for (const [rowIndex, row] of [
    ...table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ].entries()) {
    if (row.classList.contains('thead')) continue
    const organizationCell = row.querySelector<HTMLElement>('[data-stat="franch_name"]')
    const organizationLink = organizationCell?.querySelector<HTMLAnchorElement>('a')
    const organization = normalizeText(organizationCell?.textContent)
    if (!organizationCell || !organization) {
      throw new StructuralValidationError(
        `Affiliate table row ${rowIndex + 1} has no organization`,
      )
    }
    const organizationId = organizationLink
      ? new URL(organizationLink.href, BASE_URL).searchParams.get('id')
      : null
    const declaredText = normalizeText(row.querySelector('[data-stat="teams"]')?.textContent)
    if (!/^\d+$/.test(declaredText)) {
      throw new StructuralValidationError(
        `Affiliate table row ${rowIndex + 1} has an invalid team count: ${declaredText || 'missing'}`,
      )
    }
    const declared = Number(declaredText)
    declaredAffiliateSlots += declared
    const teamLinks = [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
      (link) => link !== organizationLink,
    )
    if (teamLinks.length !== declared) {
      throw new StructuralValidationError(
        `Affiliate table row ${rowIndex + 1} declares ${declared} teams but contains ${teamLinks.length} team links`,
      )
    }

    for (const [linkIndex, link] of teamLinks.entries()) {
      const rawHref = link.getAttribute('href') ?? ''
      const parsed = new URL(rawHref, BASE_URL)
      const teamId = parsed.searchParams.get('id') ?? ''
      if (parsed.pathname !== '/register/team.cgi' || !TEAM_ID_PATTERN.test(teamId)) {
        throw new StructuralValidationError(
          `Affiliate table row ${rowIndex + 1} team link ${linkIndex + 1} has an invalid Register team ID or URL: ${rawHref || 'missing'}`,
        )
      }
      const cell = link.closest<HTMLElement>('td[data-stat]')
      if (!cell || cell.getAttribute('data-stat') === 'teams') {
        throw new StructuralValidationError(
          `Affiliate table row ${rowIndex + 1} team link ${linkIndex + 1} is outside a team-level cell`,
        )
      }
      const tip = normalizeText(link.getAttribute('data-tip'))
      const tipParts = tip.split(',').map((part) => part.trim()).filter(Boolean)
      const relationshipKey = `${teamId}\0${organizationId ?? `name:${organization}`}`
      if (relationships.has(relationshipKey)) {
        throw new StructuralValidationError(
          `Affiliate table row ${rowIndex + 1} duplicates the ${teamId} organization relationship`,
        )
      }
      relationships.add(relationshipKey)
      const existing = teams.get(teamId)
      const organizations = [
        ...(existing?.organizations ?? []),
        { name: organization, id: organizationId },
      ].filter(
        (candidate, index, values) =>
          values.findIndex(
            (value) => value.name === candidate.name && value.id === candidate.id,
          ) === index,
      )
      const organizationNames = organizations.map((value) => value.name).sort()
      const organizationIds = organizations
        .map((value) => value.id)
        .filter((value): value is string => value !== null)
        .sort()
      teams.set(teamId, {
        teamId,
        url: teamUrl(teamId),
        teamName:
          existing?.teamName || tipParts[0] || normalizeText(link.textContent),
        organization: organizationNames.join(' | '),
        organizationId: organizationIds.join(' | ') || null,
        level: existing?.level || normalizeText(cell?.getAttribute('data-stat')),
        leagueAbbreviation:
          existing?.leagueAbbreviation ??
          (tipParts.length > 1 ? tipParts.at(-1) ?? null : null),
        organizations,
      })
    }
  }

  const sorted = [...teams.values()].sort((left, right) => left.teamId.localeCompare(right.teamId))
  if (sorted.length === 0) throw new Error(`Affiliate page for ${season} exposed zero team links`)
  const parsedRelationshipCount = sorted.reduce(
    (sum, team) => sum + team.organizations.length,
    0,
  )
  if (
    relationships.size !== declaredAffiliateSlots ||
    parsedRelationshipCount !== declaredAffiliateSlots
  ) {
    throw new StructuralValidationError(
      `Affiliate page for ${season} declares ${declaredAffiliateSlots} affiliate slots but parsed ${relationships.size} team-organization relationships`,
    )
  }
  return {
    season,
    teams: sorted,
    declaredTeamCount: sorted.length,
    affiliateSlotCount: parsedRelationshipCount,
  }
}

export function parseTeamPage(
  html: string,
  discovery: TeamDiscovery,
  expectedSeason: number,
): ParsedTeamPage {
  const documents = htmlDocuments(html)
  const main = documents[0]
  const headings = [...main.querySelectorAll('#meta h1 span')].map((span) => normalizeText(span.textContent))
  const season = Number(headings.find((value) => /^\d{4}$/.test(value)))
  if (season !== expectedSeason) {
    throw new Error(
      `Team ${discovery.teamId} returned season ${Number.isFinite(season) ? season : 'unknown'}; expected ${expectedSeason}`,
    )
  }
  const teamName = headings.find((value) => value && !/^\d{4}$/.test(value)) ?? discovery.teamName
  const classification = labeledMeta(main, 'Classification') || discovery.level
  const league = labeledMeta(main, 'League')
  const affiliation = labeledMeta(main, 'Affiliation')
  const team = {
    ...discovery,
    season,
    teamName,
    organization: affiliation.replace(/\s+\([A-Z]+\).*$/, '') || discovery.organization,
    classification,
    league,
  }
  const base = {
    season: String(season),
    team_id: discovery.teamId,
    team_name: teamName,
    organization: team.organization,
    level: classification,
    league,
  }
  const rosterTable = findTable(documents, 'standard_roster')
  const battingTable = findTable(documents, 'team_batting')
  const pitchingTable = findTable(documents, 'team_pitching')
  if (!rosterTable || !battingTable || !pitchingTable) {
    const missing = [
      !rosterTable && 'standard_roster',
      !battingTable && 'team_batting',
      !pitchingTable && 'team_pitching',
    ].filter(Boolean)
    throw new Error(`Team ${discovery.teamId} is missing required tables: ${missing.join(', ')}`)
  }
  const fielding = allTables(documents, 'table[id^="team_fielding_"]').flatMap((table) =>
    parseTable(table, {
      ...base,
      position: table.id.replace('team_fielding_', ''),
    }),
  )
  return {
    team,
    roster: parseTable(rosterTable, base),
    batting: parseTable(battingTable, base),
    pitching: parseTable(pitchingTable, base),
    fielding,
  }
}

function assertExpectedHtmlStructure(
  html: string,
  url: string,
  season: number,
): void {
  const endpoint = asUrl(url)
  if (
    endpoint.pathname === '/register/affiliate.cgi' &&
    endpoint.searchParams.get('year') === String(season)
  ) {
    parseAffiliatePage(html, season)
    return
  }
  if (endpoint.pathname === '/register/team.cgi') {
    const teamId = endpoint.searchParams.get('id')?.toLowerCase() ?? ''
    if (TEAM_ID_PATTERN.test(teamId)) {
      parseTeamPage(
        html,
        {
          teamId,
          url: endpoint.toString(),
          teamName: '',
          organization: '',
          organizationId: null,
          level: '',
          leagueAbbreviation: null,
          organizations: [],
        },
        season,
      )
      return
    }
  }
  throw new Error(`Response does not match an expected Register endpoint: ${url}`)
}

function numberValue(row: TableRow | undefined, key: string): number {
  const value = Number(row?.[key])
  return Number.isFinite(value) ? value : 0
}

function chooseLargest(rows: TableRow[], key: string): TableRow | undefined {
  return [...rows].sort((left, right) => numberValue(right, key) - numberValue(left, key))[0]
}

function prefixValues(target: TableRow, prefix: string, source: TableRow | undefined): void {
  if (!source) return
  const omitted = new Set([
    'source_id_namespace',
    'source_player_id',
    'player_name',
    'season',
    'team_id',
    'team_name',
    'organization',
    'level',
    'league',
  ])
  for (const [key, value] of Object.entries(source)) {
    if (!omitted.has(key)) target[`${prefix}_${key}`] = value
  }
}

export function normalizePlayerTeamSeasons(page: ParsedTeamPage): PlayerTeamSeasonRow[] {
  const groups = new Map<
    string,
    { roster: TableRow[]; batting: TableRow[]; pitching: TableRow[]; fielding: TableRow[] }
  >()
  const add = (kind: 'roster' | 'batting' | 'pitching' | 'fielding', row: TableRow) => {
    const playerId = row.source_player_id
    if (!playerId) return
    const group = groups.get(playerId) ?? { roster: [], batting: [], pitching: [], fielding: [] }
    group[kind].push(row)
    groups.set(playerId, group)
  }
  for (const row of page.roster) add('roster', row)
  for (const row of page.batting) add('batting', row)
  for (const row of page.pitching) add('pitching', row)
  for (const row of page.fielding) add('fielding', row)

  const rows: PlayerTeamSeasonRow[] = []
  for (const [playerId, group] of groups) {
    const roster = chooseLargest(group.roster, 'dateLast') ?? group.roster[0]
    const batting = chooseLargest(group.batting, 'PA')
    const pitching = chooseLargest(group.pitching, 'IP')
    const primaryFielding = chooseLargest(group.fielding, 'Inn_def') ?? chooseLargest(group.fielding, 'G')
    const battingPa = numberValue(batting, 'PA')
    const pitchingIp = numberValue(pitching, 'IP')
    const primaryPosition = primaryFielding?.position ?? (pitchingIp > 0 ? 'P' : 'UNK')
    let role: PlayerTeamSeasonRow['role'] = 'hitter'
    let roleInference = 'batting_or_non_pitcher_evidence'
    if (battingPa >= 25 && pitchingIp >= 10) {
      role = 'two_way'
      roleInference = 'material_batting_and_pitching_opportunity'
    } else if (pitchingIp > 0 || primaryPosition === 'P') {
      role = 'pitcher'
      roleInference = 'pitching_or_primary_position_evidence'
    } else if (!batting && !primaryFielding) {
      roleInference = 'default_hitter_no_stat_evidence'
    }
    const base = roster ?? batting ?? pitching ?? primaryFielding
    const row: PlayerTeamSeasonRow = {
      source_id_namespace: 'bbref_minors',
      source_player_id: playerId,
      season: String(page.team.season),
      team_id: page.team.teamId,
      team_name: page.team.teamName,
      organization: page.team.organization,
      level: page.team.classification,
      league: page.team.league,
      player_name: base?.player_name ?? playerId,
      roster_status: 'season_participant',
      role,
      role_inference: roleInference,
      position: primaryPosition,
      birth_date: roster?.date_of_birth ?? null,
      bats: roster?.bats ?? null,
      throws: roster?.throws ?? null,
      height_inches: roster?.height ?? null,
      weight_pounds: roster?.weight ?? null,
      first_observed_on_team: group.roster.map((item) => item.dateFirst).filter(Boolean).sort()[0] ?? null,
      last_observed_on_team: group.roster.map((item) => item.dateLast).filter(Boolean).sort().at(-1) ?? null,
    }
    prefixValues(row, 'batting', batting)
    prefixValues(row, 'pitching', pitching)
    prefixValues(row, 'fielding', primaryFielding)
    rows.push(row)
  }
  return rows.sort((left, right) =>
    `${left.team_id}:${left.source_player_id}`.localeCompare(`${right.team_id}:${right.source_player_id}`),
  )
}

function csvValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function rowsToCsv(rows: TableRow[], preferredColumns: string[] = []): string {
  const all = new Set(rows.flatMap((row) => Object.keys(row)))
  const columns = [
    ...preferredColumns,
    ...[...all].filter((column) => !preferredColumns.includes(column)).sort(),
  ]
  if (columns.length === 0) return ''
  return `${columns.join(',')}\n${rows
    .map((row) => columns.map((column) => csvValue(row[column])).join(','))
    .join('\n')}\n`
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function atomicWrite(filePath: string, body: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.part`
  await writeFile(temporary, body)
  await rename(temporary, filePath)
}

function acquisitionLockPath(rootDir: string): string {
  return path.join(rootDir, 'data/raw', SOURCE_SLUG, '.acquisition.lock')
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    )
  }
}

export async function acquireAcquisitionLock(
  rootDir: string,
  now: () => Date = () => new Date(),
): Promise<ReleaseAcquisitionLock> {
  const filePath = acquisitionLockPath(rootDir)
  await mkdir(path.dirname(filePath), { recursive: true })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(filePath, 'wx', 0o600)
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, acquiredAt: now().toISOString() })}\n`,
      )
      await handle.sync()
      let released = false
      return async () => {
        if (released) return
        released = true
        await handle.close()
        await rm(filePath, { force: true })
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }
      let owner: { pid?: unknown; acquiredAt?: unknown } = {}
      try {
        owner = JSON.parse(await readFile(filePath, 'utf8')) as typeof owner
      } catch {
        throw new Error(`Another Baseball-Reference acquisition owns ${filePath}`)
      }
      const pid = Number(owner.pid)
      if (Number.isInteger(pid) && pid > 0 && processIsAlive(pid)) {
        throw new Error(
          `Another Baseball-Reference acquisition is running with PID ${pid}`,
        )
      }
      await rm(filePath, { force: true })
    }
  }
  throw new Error('Could not acquire the Baseball-Reference acquisition lock')
}

async function readPermissionEvidence(rootDir: string): Promise<PermissionEvidence> {
  const evidencePath = path.join(rootDir, 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md')
  const body = await readFile(evidencePath)
  return { path: path.relative(rootDir, evidencePath), sha256: sha256(body) }
}

function rawRequestDirectory(rootDir: string, season: number, fingerprint: string): string {
  return path.join(rootDir, 'data/raw', SOURCE_SLUG, String(season), 'requests', fingerprint)
}

async function readCachedRequest(
  rootDir: string,
  season: number,
  fingerprint: string,
): Promise<CacheResult | null> {
  const directory = rawRequestDirectory(rootDir, season, fingerprint)
  const manifestPath = path.join(directory, 'manifest.json')
  const payloadPath = path.join(directory, 'payload.html')
  if (!(await exists(directory))) return null
  if (!(await exists(manifestPath)) || !(await exists(payloadPath))) {
    throw new Error(`Incomplete immutable request cache: ${path.relative(rootDir, directory)}`)
  }
  const receipt = JSON.parse(await readFile(manifestPath, 'utf8')) as RequestReceipt
  const body = new Uint8Array(await readFile(payloadPath))
  const expectedPayloadPath = path.relative(rootDir, payloadPath)
  const cachedRequestUrl = asUrl(receipt.request?.url ?? '').toString()
  const cachedFinalUrl = asUrl(receipt.response?.finalUrl ?? '').toString()
  const cachedEncoding = receipt.response?.headers?.['content-encoding']?.toLowerCase()
  if (
    receipt.schemaVersion !== REQUEST_SCHEMA_VERSION ||
    receipt.source !== SOURCE_SLUG ||
    receipt.requestFingerprint !== fingerprint ||
    requestFingerprint(cachedRequestUrl) !== fingerprint ||
    cachedFinalUrl !== cachedRequestUrl ||
    receipt.response?.status !== 200 ||
    (cachedEncoding !== undefined && cachedEncoding !== 'identity') ||
    !receipt.mediaType?.includes('html') ||
    receipt.payloadPath !== expectedPayloadPath ||
    receipt.byteLength !== body.byteLength ||
    receipt.sha256 !== sha256(body)
  ) {
    throw new Error(`Immutable request cache failed verification: ${receipt.payloadPath}`)
  }
  assertExpectedHtmlStructure(Buffer.from(body).toString('utf8'), cachedRequestUrl, season)
  return { receipt, body, cacheStatus: 'verified', liveAttempts: 0 }
}

function selectedHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of [
    'content-type',
    'content-length',
    'content-encoding',
    'etag',
    'last-modified',
  ]) {
    const value = headers.get(name)
    if (value) result[name] = value
  }
  return result
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

async function waitForCrawlSlot(context: FetchContext): Promise<void> {
  const now = context.now().getTime()
  if (context.lastLiveRequestMs !== null) {
    const remaining = CRAWL_DELAY_MS - (now - context.lastLiveRequestMs)
    if (remaining > 0) await context.sleep(remaining)
  }
  context.lastLiveRequestMs = context.now().getTime()
  await context.onLiveAttempt?.(new Date(context.lastLiveRequestMs).toISOString())
}

async function fetchAndCache(
  context: FetchContext,
  season: number,
  url: string,
): Promise<CacheResult> {
  const canonicalUrl = asUrl(url).toString()
  const fingerprint = requestFingerprint(canonicalUrl)
  const cached = await readCachedRequest(context.rootDir, season, fingerprint)
  if (cached) return cached
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let retryDelayMs = 0
    await waitForCrawlSlot(context)
    try {
      const response = await context.fetchImpl(canonicalUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'identity',
          'user-agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(120_000),
      })
      const body = new Uint8Array(await response.arrayBuffer())
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${canonicalUrl}`)
        if (!retryableStatus(response.status)) throw error
        retryDelayMs = retryAfterMilliseconds(
          response.headers.get('retry-after'),
          context.now(),
        )
        if (retryDelayMs > MAX_RETRY_AFTER_MS) {
          throw new StopAndResumeError(
            `Server requested a ${retryDelayMs}ms retry delay; stop and resume later`,
          )
        }
        lastError = error
      } else {
        if (body.byteLength === 0) throw new Error(`Empty response for ${canonicalUrl}`)
        const finalUrl = response.url || canonicalUrl
        if (asUrl(finalUrl).toString() !== canonicalUrl) {
          throw new Error(
            `Response endpoint changed from ${canonicalUrl} to ${finalUrl}`,
          )
        }
        const mediaType = response.headers.get('content-type')?.split(';')[0] ?? 'text/html'
        if (!mediaType.includes('html')) {
          throw new Error(`Unexpected content type ${mediaType} for ${canonicalUrl}`)
        }
        const contentEncoding = response.headers.get('content-encoding')?.toLowerCase()
        if (contentEncoding && contentEncoding !== 'identity') {
          throw new Error(
            `Unexpected content encoding ${contentEncoding} for ${canonicalUrl}`,
          )
        }
        assertExpectedHtmlStructure(
          Buffer.from(body).toString('utf8'),
          canonicalUrl,
          season,
        )
        const receipt: RequestReceipt = {
          schemaVersion: REQUEST_SCHEMA_VERSION,
          source: SOURCE_SLUG,
          requestFingerprint: fingerprint,
          request: {
            method: 'GET',
            url: canonicalUrl,
            userAgent: USER_AGENT,
            acceptEncoding: 'identity',
          },
          response: {
            status: response.status,
            finalUrl,
            headers: selectedHeaders(response.headers),
          },
          retrievedAt: context.now().toISOString(),
          attemptCount: attempt,
          byteLength: body.byteLength,
          sha256: sha256(body),
          mediaType,
          payloadPath: path.relative(
            context.rootDir,
            path.join(rawRequestDirectory(context.rootDir, season, fingerprint), 'payload.html'),
          ),
          parserVersion: PARSER_VERSION,
          permissionEvidence: context.permissionEvidence,
        }
        const destination = rawRequestDirectory(context.rootDir, season, fingerprint)
        await mkdir(path.dirname(destination), { recursive: true })
        const temporary = `${destination}.${process.pid}.${randomUUID()}.part`
        await mkdir(temporary, { recursive: false })
        await writeFile(path.join(temporary, 'payload.html'), body)
        await writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(receipt, null, 2)}\n`)
        try {
          await rename(temporary, destination)
        } catch (error) {
          await rm(temporary, { recursive: true, force: true })
          const raced = await readCachedRequest(context.rootDir, season, fingerprint)
          if (raced) return raced
          throw error
        }
        return { receipt, body, cacheStatus: 'downloaded', liveAttempts: attempt }
      }
    } catch (error) {
      if (error instanceof StopAndResumeError) throw error
      if (error instanceof StructuralValidationError) throw error
      lastError = error instanceof Error ? error : new Error(String(error))
      if (lastError.message.startsWith('HTTP ') && !/HTTP (408|425|429|5\d\d)/.test(lastError.message)) {
        throw lastError
      }
    }
    if (attempt < MAX_ATTEMPTS) {
      await context.sleep(
        Math.max(CRAWL_DELAY_MS * 2 ** (attempt - 1), retryDelayMs),
      )
    }
  }
  throw lastError ?? new Error(`Request failed for ${canonicalUrl}`)
}

function initialState(season: number, now: string): BackfillState {
  const url = affiliateUrl(season)
  const structural = season === 2020
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    source: SOURCE_SLUG,
    season,
    createdAt: now,
    updatedAt: now,
    structuralZeroSeason: structural,
    structuralReason: structural ? STRUCTURAL_2020_REASON : null,
    declaredTeamCount: structural ? 0 : null,
    affiliateSlotCount: structural ? 0 : null,
    discovery: {
      url,
      status: structural ? 'structural' : 'pending',
      attempts: 0,
      requestFingerprint: requestFingerprint(url),
      lastError: null,
    },
    teams: [],
  }
}

function statePath(rootDir: string, season: number): string {
  return path.join(rootDir, 'data/raw', SOURCE_SLUG, String(season), 'state.json')
}

async function readState(rootDir: string, season: number, now: string): Promise<BackfillState> {
  const filePath = statePath(rootDir, season)
  if (!(await exists(filePath))) return initialState(season, now)
  const state = JSON.parse(await readFile(filePath, 'utf8')) as BackfillState
  if (state.schemaVersion !== STATE_SCHEMA_VERSION || state.season !== season) {
    throw new Error(`Incompatible resume state: ${path.relative(rootDir, filePath)}`)
  }
  if (
    state.discovery.status === 'succeeded' &&
    state.teams.some((team) => !team.organizations?.length)
  ) {
    const cached = await readCachedRequest(
      rootDir,
      season,
      state.discovery.requestFingerprint,
    )
    if (!cached) throw new Error('Succeeded discovery has no immutable payload')
    const discovered = parseAffiliatePage(
      Buffer.from(cached.body).toString('utf8'),
      season,
    )
    const priorById = new Map(state.teams.map((team) => [team.teamId, team]))
    if (
      discovered.teams.length !== state.teams.length ||
      discovered.teams.some((team) => !priorById.has(team.teamId))
    ) {
      throw new Error('Current discovery payload differs from the resume team set')
    }
    state.teams = discovered.teams.map((team) => {
      const prior = priorById.get(team.teamId)
      if (!prior) throw new Error(`Missing prior state for team ${team.teamId}`)
      return {
        ...team,
        status: prior.status,
        attempts: prior.attempts,
        requestFingerprint: prior.requestFingerprint,
        lastError: prior.lastError,
      }
    })
    state.declaredTeamCount = discovered.declaredTeamCount
    state.affiliateSlotCount = discovered.affiliateSlotCount
    await writeState(rootDir, state, now)
  }
  return state
}

async function writeState(rootDir: string, state: BackfillState, now: string): Promise<void> {
  state.updatedAt = now
  await atomicWrite(statePath(rootDir, state.season), `${JSON.stringify(state, null, 2)}\n`)
}

function outputRoot(rootDir: string, season: number): string {
  return path.join(rootDir, 'data/processed', SOURCE_SLUG, String(season))
}

const BASE_COLUMNS = [
  'source_id_namespace',
  'source_player_id',
  'season',
  'team_id',
  'team_name',
  'organization',
  'level',
  'league',
  'player_name',
]

function teamOrganizations(
  team: TeamDiscovery,
): Array<{ name: string; id: string | null }> {
  return team.organizations?.length
    ? team.organizations
    : [{ name: team.organization, id: team.organizationId }]
}

async function writeNormalizedOutputs(
  rootDir: string,
  state: BackfillState,
): Promise<Array<{ path: string; rows: number; bytes: number; sha256: string }>> {
  const pages: ParsedTeamPage[] = []
  for (const team of state.teams.filter((unit) => unit.status === 'succeeded')) {
    const cached = await readCachedRequest(rootDir, state.season, team.requestFingerprint)
    if (!cached) throw new Error(`Succeeded team ${team.teamId} has no immutable payload`)
    pages.push(parseTeamPage(Buffer.from(cached.body).toString('utf8'), team, state.season))
  }
  const collections: Record<string, TableRow[]> = {
    teams: pages.map((page) => ({
      season: String(page.team.season),
      team_id: page.team.teamId,
      team_name: page.team.teamName,
      organization: page.team.organization,
      organization_id: page.team.organizationId,
      level: page.team.classification,
      league: page.team.league,
      league_abbreviation: page.team.leagueAbbreviation,
      source_url: page.team.url,
    })),
    team_organizations: pages.flatMap((page) =>
      teamOrganizations(page.team).map((organization) => ({
        season: String(page.team.season),
        team_id: page.team.teamId,
        team_name: page.team.teamName,
        organization: organization.name,
        organization_id: organization.id,
      })),
    ),
    roster: pages.flatMap((page) => page.roster),
    batting: pages.flatMap((page) => page.batting),
    pitching: pages.flatMap((page) => page.pitching),
    fielding: pages.flatMap((page) => page.fielding),
    player_team_seasons: pages.flatMap(normalizePlayerTeamSeasons),
  }
  const directory = outputRoot(rootDir, state.season)
  const outputs: Array<{ path: string; rows: number; bytes: number; sha256: string }> = []
  for (const [name, rows] of Object.entries(collections)) {
    const json = `${JSON.stringify(rows, null, 2)}\n`
    const csv = rowsToCsv(rows, name === 'player_team_seasons' ? [...BASE_COLUMNS, 'roster_status', 'role', 'role_inference', 'position'] : BASE_COLUMNS)
    for (const [extension, body] of [
      ['json', json],
      ['csv', csv],
    ] as const) {
      const filePath = path.join(directory, `${name}.${extension}`)
      await atomicWrite(filePath, body)
      const bytes = Buffer.byteLength(body)
      outputs.push({
        path: path.relative(rootDir, filePath),
        rows: rows.length,
        bytes,
        sha256: sha256(body),
      })
    }
  }
  const quality = {
    schemaVersion: 'baseball-reference-register-quality/v1',
    season: state.season,
    structuralZeroSeason: state.structuralZeroSeason,
    structuralReason: state.structuralReason,
    declaredTeamCount: state.declaredTeamCount,
    affiliateSlotCount: state.affiliateSlotCount,
    sharedAffiliateTeamCount: state.teams.filter(
      (team) => teamOrganizations(team).length > 1,
    ).length,
    observedTeamCount: state.teams.filter((team) => team.status === 'succeeded').length,
    complete:
      state.structuralZeroSeason ||
      (state.declaredTeamCount !== null &&
        state.teams.length === state.declaredTeamCount &&
        state.teams.every((team) => team.status === 'succeeded')),
    censusAttested: false,
    censusAttestationReason:
      'Complete team pages establish a season-appearance population, not a contracted roster census; zero-appearance players may be absent.',
  }
  const qualityBody = `${JSON.stringify(quality, null, 2)}\n`
  const qualityPath = path.join(directory, 'quality.json')
  await atomicWrite(qualityPath, qualityBody)
  outputs.push({
    path: path.relative(rootDir, qualityPath),
    rows: 1,
    bytes: Buffer.byteLength(qualityBody),
    sha256: sha256(qualityBody),
  })
  return outputs
}

async function collectVerifiedInputReceipts(
  rootDir: string,
  state: BackfillState,
  permissionEvidence: PermissionEvidence,
): Promise<RequestReceipt[]> {
  if (state.structuralZeroSeason) return []
  const fingerprints = [
    ...(state.discovery.status === 'succeeded'
      ? [state.discovery.requestFingerprint]
      : []),
    ...state.teams
      .filter((team) => team.status === 'succeeded')
      .map((team) => team.requestFingerprint),
  ]
  const receipts: RequestReceipt[] = []
  for (const fingerprint of [...new Set(fingerprints)].sort()) {
    const cached = await readCachedRequest(rootDir, state.season, fingerprint)
    if (!cached) throw new Error(`Manifest input ${fingerprint} has no immutable payload`)
    if (
      cached.receipt.permissionEvidence.path !== permissionEvidence.path ||
      cached.receipt.permissionEvidence.sha256 !== permissionEvidence.sha256
    ) {
      throw new Error(
        `Manifest input ${fingerprint} does not match current permission evidence`,
      )
    }
    receipts.push(cached.receipt)
  }
  return receipts.sort((left, right) =>
    left.request.url.localeCompare(right.request.url),
  )
}

async function writeRunManifest(
  rootDir: string,
  state: BackfillState,
  startedAt: string,
  finishedAt: string,
  maxTeams: number,
  liveRequested: RequestReceipt[],
  outputs: Array<{ path: string; rows: number; bytes: number; sha256: string }>,
  error: string | null,
  permissionEvidence: PermissionEvidence,
): Promise<string> {
  const inputs = await collectVerifiedInputReceipts(
    rootDir,
    state,
    permissionEvidence,
  )
  const complete =
    state.structuralZeroSeason ||
    (state.declaredTeamCount !== null && state.teams.every((team) => team.status === 'succeeded'))
  const runId = `${startedAt.replaceAll(/[:.]/g, '')}-${process.pid}-${randomUUID().slice(0, 8)}`
  const filePath = path.join(
    rootDir,
    'data/manifests/runs',
    `${runId}-${SOURCE_SLUG}-${state.season}.json`,
  )
  const manifest = {
    schemaVersion: RUN_SCHEMA_VERSION,
    source: SOURCE_SLUG,
    season: state.season,
    startedAt,
    finishedAt,
    status: error ? 'failed' : complete ? 'complete' : 'partial',
    error,
    oneWorker: true,
    crawlDelayMs: CRAWL_DELAY_MS,
    maxTeams,
    parserVersion: PARSER_VERSION,
    permissionEvidence,
    resumeStatePath: path.relative(rootDir, statePath(rootDir, state.season)),
    coverage: {
      structuralZeroSeason: state.structuralZeroSeason,
      structuralReason: state.structuralReason,
      declaredTeams: state.declaredTeamCount,
      affiliateSlots: state.affiliateSlotCount,
      discoveredTeams: state.teams.length,
      completedTeams: state.teams.filter((team) => team.status === 'succeeded').length,
      failedTeams: state.teams.filter((team) => team.status === 'failed').length,
    },
    inputCount: inputs.length,
    liveRequestCount: liveRequested.length,
    requests: inputs.map((receipt) => ({
      requestFingerprint: receipt.requestFingerprint,
      url: receipt.request.url,
      payloadPath: receipt.payloadPath,
      sha256: receipt.sha256,
      byteLength: receipt.byteLength,
      retrievedAt: receipt.retrievedAt,
      attemptCount: receipt.attemptCount,
    })),
    outputs,
  }
  await atomicWrite(filePath, `${JSON.stringify(manifest, null, 2)}\n`)
  return filePath
}

async function runBackfillUnlocked(options: RunOptions): Promise<BackfillRunResult> {
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const log = options.log ?? ((message) => process.stdout.write(`${message}\n`))
  const startedAt = now().toISOString()
  const permissionEvidence = await readPermissionEvidence(options.rootDir)
  const state = await readState(options.rootDir, options.season, startedAt)
  const outputDirectory = path.relative(options.rootDir, outputRoot(options.rootDir, options.season))
  if (!options.execute) {
    const pending = state.teams.filter((team) => team.status !== 'succeeded').length
    log(
      `Dry run: season=${options.season}, maxTeams=${options.maxTeams}, discovered=${state.teams.length}, pending=${pending}. Add --execute to fetch.`,
    )
    return {
      season: options.season,
      status: 'dry-run',
      discoveredTeams: state.teams.length,
      completedTeams: state.teams.filter((team) => team.status === 'succeeded').length,
      attemptedTeams: 0,
      outputDirectory,
      runManifestPath: null,
    }
  }

  const context: FetchContext = {
    rootDir: options.rootDir,
    permissionEvidence,
    fetchImpl: options.fetchImpl ?? fetch,
    now,
    sleep,
    lastLiveRequestMs: null,
  }
  const requested: RequestReceipt[] = []
  let attemptedTeams = 0
  let outputs: Array<{ path: string; rows: number; bytes: number; sha256: string }> = []
  let failure: Error | null = null

  try {
    if (!state.structuralZeroSeason && state.discovery.status !== 'succeeded') {
      try {
        const result = await fetchAndCache(context, state.season, state.discovery.url)
        requested.push(result.receipt)
        const discovered = parseAffiliatePage(Buffer.from(result.body).toString('utf8'), state.season)
        state.declaredTeamCount = discovered.declaredTeamCount
        state.affiliateSlotCount = discovered.affiliateSlotCount
        state.teams = discovered.teams.map((team) => ({
          ...team,
          status: 'pending',
          attempts: 0,
          requestFingerprint: requestFingerprint(team.url),
          lastError: null,
        }))
        state.discovery.status = 'succeeded'
        state.discovery.attempts += result.liveAttempts
        state.discovery.lastError = null
        await writeState(options.rootDir, state, now().toISOString())
        log(`Discovered ${state.teams.length} affiliated teams for ${state.season}.`)
      } catch (error) {
        state.discovery.status = 'failed'
        state.discovery.lastError = error instanceof Error ? error.message : String(error)
        await writeState(options.rootDir, state, now().toISOString())
        throw error
      }
    }

    const pending = state.teams
      .filter((team) => team.status !== 'succeeded')
      .sort((left, right) => left.teamId.localeCompare(right.teamId))
      .slice(0, options.maxTeams)
    for (const team of pending) {
      attemptedTeams += 1
      try {
        log(`Fetching ${team.teamId} ${team.teamName} ...`)
        const result = await fetchAndCache(context, state.season, team.url)
        requested.push(result.receipt)
        parseTeamPage(Buffer.from(result.body).toString('utf8'), team, state.season)
        team.status = 'succeeded'
        team.attempts += result.liveAttempts
        team.lastError = null
        await writeState(options.rootDir, state, now().toISOString())
      } catch (error) {
        team.status = 'failed'
        team.attempts += 1
        team.lastError = error instanceof Error ? error.message : String(error)
        await writeState(options.rootDir, state, now().toISOString())
        throw error
      }
    }
    outputs = await writeNormalizedOutputs(options.rootDir, state)
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  }

  const finishedAt = now().toISOString()
  const runManifest = await writeRunManifest(
    options.rootDir,
    state,
    startedAt,
    finishedAt,
    options.maxTeams,
    requested,
    outputs,
    failure?.message ?? null,
    permissionEvidence,
  )
  if (failure) throw failure
  const completedTeams = state.teams.filter((team) => team.status === 'succeeded').length
  const complete =
    state.structuralZeroSeason ||
    (state.declaredTeamCount !== null && completedTeams === state.declaredTeamCount)
  log(
    `${complete ? 'Complete' : 'Checkpointed'}: ${completedTeams}/${state.declaredTeamCount ?? state.teams.length} teams; outputs ${outputDirectory}.`,
  )
  return {
    season: state.season,
    status: state.structuralZeroSeason ? 'structural-zero-season' : complete ? 'complete' : 'partial',
    discoveredTeams: state.teams.length,
    completedTeams,
    attemptedTeams,
    outputDirectory,
    runManifestPath: path.relative(options.rootDir, runManifest),
  }
}

export async function runBackfill(options: RunOptions): Promise<BackfillRunResult> {
  if (!options.execute) return runBackfillUnlocked(options)
  const release = await acquireAcquisitionLock(options.rootDir, options.now)
  try {
    return await runBackfillUnlocked(options)
  } finally {
    await release()
  }
}

export function parseCliArguments(argv = process.argv.slice(2)): {
  season: number
  maxTeams: number
  execute: boolean
} {
  const read = (name: string) => {
    const prefix = `--${name}=`
    return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
  }
  const season = Number(read('season') ?? DEFAULT_SEASON)
  const maxTeams = Number(read('max-teams') ?? DEFAULT_MAX_TEAMS)
  if (!Number.isInteger(season) || season < 1901 || season > new Date().getUTCFullYear()) {
    throw new Error('--season must be a four-digit season from 1901 through the current year')
  }
  if (!Number.isInteger(maxTeams) || maxTeams < 1 || maxTeams > MAX_TEAMS_PER_RUN) {
    throw new Error(`--max-teams must be an integer from 1 through ${MAX_TEAMS_PER_RUN}`)
  }
  return { season, maxTeams, execute: argv.includes('--execute') }
}

async function main(): Promise<void> {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const rootDir = path.resolve(scriptDirectory, '../..')
  const cli = parseCliArguments()
  await runBackfill({ rootDir, ...cli })
}

const directInvocation =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (directInvocation) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
