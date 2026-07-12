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

export const SOURCE_SLUG = 'baseball-reference-rosters'
export const PARSER_VERSION = 'baseball-reference-rosters/v1'
export const STATE_SCHEMA_VERSION = 'baseball-reference-rosters-state/v1'
export const REQUEST_SCHEMA_VERSION = 'baseball-reference-rosters-request/v1'
export const DATASET_SCHEMA_VERSION = 'baseball-reference-rosters-dataset/v1'
export const REFERENCE_LOCK_SCHEMA_VERSION =
  'baseball-reference-rosters-reference-lock/v1'
export const PROTOCOL_LOCK_PATH =
  'data/reference-locks/baseball-reference-rosters-2026-protocol-v1.json'
export const PERMISSION_EVIDENCE_PATH =
  'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md'
export const USER_AGENT =
  'BaseballOracleResearch/0.2 (+https://github.com/RobCase29/baseball-oracle; authorized research acquisition)'
export const CRAWL_DELAY_MS = 3_200
export const MAX_ATTEMPTS = 3
export const SEASON = 2026
export const EXPECTED_TEAM_COUNT = 30
export const DEFAULT_MAX_PAGES = 31
export const MAX_PAGES_PER_RUN = 31

const BASE_URL = 'https://www.baseball-reference.com'
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const TEAM_ID_PATTERN = /^[A-Z0-9]{2,3}$/
const PLAYER_ID_PATTERN = /^[a-z0-9][a-z0-9.'.-]{2,9}\d{2}$/

type UnitKind = 'team-discovery' | 'team-roster'

interface ProtocolLock {
  schemaVersion: 'baseball-reference-rosters-protocol/v1'
  source: typeof SOURCE_SLUG
  parserVersion: typeof PARSER_VERSION
  permissionEvidence: { path: string; sha256: string }
  coverage: { season: typeof SEASON; expectedTeamCount: typeof EXPECTED_TEAM_COUNT }
  transport: {
    crawlDelayMs: number
    maxAttempts: number
    oneWorker: true
    acceptEncoding: 'identity'
  }
  resources: { teamDiscovery: string; teamRoster: string }
}

interface EvidenceDigest {
  path: string
  sha256: string
}

export interface TeamDiscovery {
  team_id: string
  team_name: string
  season: typeof SEASON
  team_url: string
  roster_url: string
}

interface AcquisitionUnit {
  id: string
  kind: UnitKind
  url: string
  team_id: string | null
  team_name: string | null
}

interface UnitState extends AcquisitionUnit {
  status: 'pending' | 'succeeded' | 'failed'
  live_attempts: number
  last_error: string | null
  request_fingerprint: string
}

interface AcquisitionState {
  schemaVersion: typeof STATE_SCHEMA_VERSION
  source: typeof SOURCE_SLUG
  season: typeof SEASON
  created_at: string
  updated_at: string
  discovery: UnitState
  teams: UnitState[]
}

interface RequestReceipt {
  schemaVersion: typeof REQUEST_SCHEMA_VERSION
  source: typeof SOURCE_SLUG
  unit_id: string
  kind: UnitKind
  team_id: string | null
  team_name: string | null
  request_fingerprint: string
  request: {
    method: 'GET'
    url: string
    userAgent: string
    acceptEncoding: 'identity'
  }
  response: {
    status: 200
    finalUrl: string
    headers: Record<string, string>
  }
  retrieved_at: string
  attempt_count: number
  byte_length: number
  sha256: string
  media_type: string
  payload_path: string
  parser_version_at_acquisition: string
  permission_evidence: EvidenceDigest
  protocol_lock: EvidenceDigest
}

interface CacheResult {
  receipt: RequestReceipt
  body: Uint8Array
  cache_status: 'downloaded' | 'verified'
  live_attempts: number
}

interface FetchContext {
  rootDir: string
  permissionEvidence: EvidenceDigest
  protocolLock: EvidenceDigest
  fetchImpl: typeof fetch
  now: () => Date
  sleep: (milliseconds: number) => Promise<void>
  lastLiveRequestMs: number | null
}

export interface ActiveRosterRow {
  source_player_key: string
  bbref_id: string | null
  mlbam_id: number | null
  player_name: string
  season: typeof SEASON
  team_id: string
  team_name: string
  position: string
  is_active: boolean
  is_dl: boolean
  is_active_source: string | null
  is_dl_source: string | null
  age: number | null
  bats: string | null
  throws: string | null
  known_at: string
}

export interface BackfillOptions {
  rootDir: string
  maxPages: number
  execute: boolean
  fetchImpl?: typeof fetch
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  log?: (message: string) => void
}

export interface BackfillResult {
  status: 'dry-run' | 'partial' | 'complete'
  plannedPages: number
  completedPages: number
  attemptedPages: number
  liveRequests: number
  teamCount: number
  rosterRows: number | null
  activeRows: number | null
  injuredListRows: number | null
  unmatchedWarIds: string[] | null
  mlbamOnlyIds: number[] | null
  outputPath: string | null
  manifestPath: string | null
  referenceLockPath: string | null
}

export type ReleaseAcquisitionLock = () => Promise<void>

export class StructuralValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructuralValidationError'
  }
}

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeAtomic(filePath: string, body: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, body)
  await rename(temporary, filePath)
}

function canonicalUrl(value: string): string {
  const url = new URL(value, BASE_URL)
  if (url.protocol !== 'https:' || url.hostname !== 'www.baseball-reference.com') {
    throw new Error(`Refusing URL outside Baseball-Reference: ${url.toString()}`)
  }
  const allowed =
    url.pathname === `/leagues/majors/${SEASON}.shtml` ||
    /^\/teams\/[A-Z0-9]{2,3}\/2026-roster\.shtml$/.test(url.pathname)
  if (!allowed || url.search || url.hash) {
    throw new Error(`Refusing unregistered Baseball-Reference endpoint: ${url.toString()}`)
  }
  return url.toString()
}

function discoveryUrl(): string {
  return canonicalUrl(`${BASE_URL}/leagues/majors/${SEASON}.shtml`)
}

function rosterUrl(teamId: string): string {
  if (!TEAM_ID_PATTERN.test(teamId)) throw new Error(`Invalid MLB team ID: ${teamId}`)
  return canonicalUrl(`${BASE_URL}/teams/${teamId}/${SEASON}-roster.shtml`)
}

export function requestFingerprint(url: string): string {
  return digest(
    JSON.stringify({
      method: 'GET',
      url: canonicalUrl(url),
      userAgent: USER_AGENT,
      acceptEncoding: 'identity',
    }),
  )
}

function discoveryUnit(): AcquisitionUnit {
  return {
    id: `league-${SEASON}-teams`,
    kind: 'team-discovery',
    url: discoveryUrl(),
    team_id: null,
    team_name: null,
  }
}

function rosterUnit(team: TeamDiscovery): AcquisitionUnit {
  return {
    id: `team-${team.team_id}-${SEASON}-roster`,
    kind: 'team-roster',
    url: team.roster_url,
    team_id: team.team_id,
    team_name: team.team_name,
  }
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
    const table = document.getElementById(id)
    if (table?.tagName === 'TABLE') return table as HTMLTableElement
  }
  return null
}

export function parseTeamDiscoveryPage(
  html: string,
  expectedTeamCount = EXPECTED_TEAM_COUNT,
): TeamDiscovery[] {
  const candidates = new Map<string, { name: string; url: string }>()
  for (const document of htmlDocuments(html)) {
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = new URL(anchor.getAttribute('href') ?? '', BASE_URL)
      if (href.hostname !== 'www.baseball-reference.com') continue
      const match = new RegExp(`^/teams/([A-Z0-9]{2,3})/${SEASON}\\.shtml$`).exec(
        href.pathname,
      )
      if (!match || href.search) continue
      const teamId = match[1]
      const name = normalizeText(anchor.textContent)
      if (!name) continue
      const prior = candidates.get(teamId)
      if (!prior || name.length > prior.name.length) {
        candidates.set(teamId, {
          name,
          url: `${BASE_URL}${href.pathname}`,
        })
      }
    }
  }
  if (candidates.size !== expectedTeamCount) {
    throw new StructuralValidationError(
      `League ${SEASON} page exposes ${candidates.size} unique team links; expected ${expectedTeamCount}`,
    )
  }
  return [...candidates]
    .map(([teamId, value]) => ({
      team_id: teamId,
      team_name: value.name,
      season: SEASON as typeof SEASON,
      team_url: value.url,
      roster_url: rosterUrl(teamId),
    }))
    .sort((left, right) => left.team_id.localeCompare(right.team_id))
}

function cell(row: Element, stat: string): HTMLElement | null {
  return row.querySelector<HTMLElement>(`[data-stat="${stat}"]`)
}

function sourceCell(row: Element, stat: string): string | null {
  const element = cell(row, stat)
  if (!element) {
    throw new StructuralValidationError(`Roster row is missing data-stat ${stat}`)
  }
  return normalizeText(element.textContent) || normalizeText(element.getAttribute('csk')) || null
}

function activeStatus(source: string | null, element: Element): boolean {
  const token = normalizeText(source).toLowerCase()
  if (!token || ['0', 'n', 'no', 'inactive', '--'].includes(token)) return false
  if (['1', 'y', 'yes', 'active', '*', '26-man'].includes(token)) return true
  if (element.classList.contains('iz')) return false
  throw new StructuralValidationError(`Unrecognized is_active value: ${source}`)
}

function injuredListStatus(source: string | null, element: Element): boolean {
  const token = normalizeText(source).toLowerCase()
  if (!token || ['0', 'n', 'no', 'none', '--'].includes(token)) return false
  if (element.classList.contains('iz')) return false
  if (
    ['1', 'y', 'yes', 'il', 'dl', '*'].includes(token) ||
    token.includes('day') ||
    token.includes('injured') ||
    token.includes('disabled')
  ) {
    return true
  }
  if (token.length > 64 || /[<>]/.test(token)) {
    throw new StructuralValidationError(`Invalid is_dl roster status: ${source}`)
  }
  return false
}

function ageCell(row: Element): number | null {
  const element = cell(row, 'age')
  if (!element) throw new StructuralValidationError('Roster row is missing data-stat age')
  const source = normalizeText(element.textContent).replaceAll(',', '') ||
    normalizeText(element.getAttribute('csk')).replaceAll(',', '')
  if (!source) return null
  const value = Number(source)
  if (!Number.isInteger(value) || value < 15 || value > 60) {
    throw new StructuralValidationError(`Roster row has invalid age: ${source}`)
  }
  return value
}

function playerIdentity(cellElement: Element, context: string): {
  sourceKey: string
  bbrefId: string | null
  mlbamId: number | null
  name: string
} {
  const sourceKey = normalizeText(cellElement.getAttribute('data-append-csv'))
  const isBbrefId = PLAYER_ID_PATTERN.test(sourceKey) && !sourceKey.includes('..')
  const redirect = /^redirect\.fcgi\?player=1&mlb_ID=(\d{4,9})$/.exec(sourceKey)
  if (!isBbrefId && !redirect) {
    throw new StructuralValidationError(
      `${context} has an invalid Baseball-Reference player key: ${sourceKey || 'missing'}`,
    )
  }
  const link = cellElement.querySelector<HTMLAnchorElement>('a[href]')
  if (!link) throw new StructuralValidationError(`${context} has no player link`)
  const href = new URL(link.getAttribute('href') ?? '', BASE_URL)
  const validLink = isBbrefId
    ? href.hostname === 'www.baseball-reference.com' &&
      href.pathname === `/players/${sourceKey[0]}/${sourceKey}.shtml`
    : href.hostname === 'www.baseball-reference.com' &&
      href.pathname === '/redirect.fcgi' &&
      href.searchParams.get('player') === '1' &&
      href.searchParams.get('mlb_ID') === redirect?.[1]
  if (!validLink) {
    throw new StructuralValidationError(
      `${context} player link conflicts with data-append-csv`,
    )
  }
  const name = normalizeText(link.textContent)
  if (!name) throw new StructuralValidationError(`${context} has no player name`)
  return {
    sourceKey,
    bbrefId: isBbrefId ? sourceKey : null,
    mlbamId: redirect ? Number(redirect[1]) : null,
    name,
  }
}

export function parseActiveRosterPage(
  html: string,
  team: TeamDiscovery,
  knownAt: string,
): ActiveRosterRow[] {
  if (!Number.isFinite(Date.parse(knownAt))) {
    throw new StructuralValidationError(`Invalid roster known_at: ${knownAt}`)
  }
  const table = findTable(htmlDocuments(html), 'the40man')
  if (!table) {
    throw new StructuralValidationError(
      `Team ${team.team_id} roster page is missing table#the40man`,
    )
  }
  const rows: ActiveRosterRow[] = []
  const seen = new Set<string>()
  for (const [index, row] of [
    ...table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ].entries()) {
    if (
      row.classList.contains('thead') ||
      row.classList.contains('spacer') ||
      row.classList.contains('norank')
    ) {
      continue
    }
    const identityCells = [...row.querySelectorAll<HTMLElement>('[data-append-csv]')]
    if (identityCells.length === 0) {
      if (row.querySelectorAll('th,td').length === 0) continue
      throw new StructuralValidationError(
        `table#the40man row ${index + 1} has no data-append-csv player cell`,
      )
    }
    if (identityCells.length !== 1) {
      throw new StructuralValidationError(
        `table#the40man row ${index + 1} has ${identityCells.length} player IDs`,
      )
    }
    const player = playerIdentity(
      identityCells[0],
      `table#the40man row ${index + 1}`,
    )
    if (seen.has(player.sourceKey)) {
      throw new StructuralValidationError(
        `Team ${team.team_id} roster contains duplicate player ${player.sourceKey}`,
      )
    }
    seen.add(player.sourceKey)
    const position = sourceCell(row, 'pos')
    if (!position) {
      throw new StructuralValidationError(
        `Team ${team.team_id} player ${player.sourceKey} has no position`,
      )
    }
    const activeElement = cell(row, 'is_active')
    const injuredElement = cell(row, 'is_dl')
    if (!activeElement || !injuredElement) {
      throw new StructuralValidationError(
        `Team ${team.team_id} player ${player.sourceKey} is missing status cells`,
      )
    }
    const activeSource = sourceCell(row, 'is_active')
    const injuredSource = sourceCell(row, 'is_dl')
    const isActive = activeStatus(activeSource, activeElement)
    const isDl = injuredListStatus(injuredSource, injuredElement)
    if (isActive && isDl) {
      throw new StructuralValidationError(
        `Team ${team.team_id} player ${player.sourceKey} is both active and on the injured list`,
      )
    }
    rows.push({
      source_player_key: player.sourceKey,
      bbref_id: player.bbrefId,
      mlbam_id: player.mlbamId,
      player_name: player.name,
      season: SEASON,
      team_id: team.team_id,
      team_name: team.team_name,
      position,
      is_active: isActive,
      is_dl: isDl,
      is_active_source: activeSource,
      is_dl_source: injuredSource,
      age: ageCell(row),
      bats: sourceCell(row, 'bats'),
      throws: sourceCell(row, 'throws'),
      known_at: knownAt,
    })
  }
  if (rows.length < 20 || rows.length > 70) {
    throw new StructuralValidationError(
      `Team ${team.team_id} roster has ${rows.length} accepted rows; expected 20-70`,
    )
  }
  return rows.sort((left, right) =>
    left.source_player_key.localeCompare(right.source_player_key),
  )
}

async function readProtocol(rootDir: string): Promise<{
  value: ProtocolLock
  evidence: EvidenceDigest
  permission: EvidenceDigest
}> {
  const body = await readFile(path.join(rootDir, PROTOCOL_LOCK_PATH))
  const value = JSON.parse(body.toString('utf8')) as ProtocolLock
  if (
    value.schemaVersion !== 'baseball-reference-rosters-protocol/v1' ||
    value.source !== SOURCE_SLUG ||
    value.parserVersion !== PARSER_VERSION ||
    value.coverage.season !== SEASON ||
    value.coverage.expectedTeamCount !== EXPECTED_TEAM_COUNT
  ) {
    throw new Error(`Incompatible roster protocol lock at ${PROTOCOL_LOCK_PATH}`)
  }
  if (
    value.transport.crawlDelayMs < CRAWL_DELAY_MS ||
    value.transport.maxAttempts > MAX_ATTEMPTS ||
    value.transport.oneWorker !== true ||
    value.transport.acceptEncoding !== 'identity' ||
    canonicalUrl(value.resources.teamDiscovery) !== discoveryUrl() ||
    value.resources.teamRoster !==
      `${BASE_URL}/teams/{team}/${SEASON}-roster.shtml#the40man`
  ) {
    throw new Error('Roster protocol weakens or changes the required acquisition controls')
  }
  const permissionPath = path.join(rootDir, value.permissionEvidence.path)
  const permissionBody = await readFile(permissionPath)
  const permissionSha = digest(permissionBody)
  if (permissionSha !== value.permissionEvidence.sha256) {
    throw new Error(
      `Permission evidence hash changed; review and repin ${PROTOCOL_LOCK_PATH}`,
    )
  }
  return {
    value,
    evidence: { path: PROTOCOL_LOCK_PATH, sha256: digest(body) },
    permission: { path: value.permissionEvidence.path, sha256: permissionSha },
  }
}

function cacheDirectory(rootDir: string, unit: AcquisitionUnit): string {
  return path.join(
    rootDir,
    'data/raw/baseball-reference-rosters/requests',
    requestFingerprint(unit.url),
  )
}

async function verifiedCache(
  context: FetchContext,
  unit: AcquisitionUnit,
  validateStructure = true,
): Promise<CacheResult | null> {
  const directory = cacheDirectory(context.rootDir, unit)
  const payloadPath = path.join(directory, 'payload.html')
  const manifestPath = path.join(directory, 'manifest.json')
  let payload: Uint8Array
  let manifestBody: string
  try {
    ;[payload, manifestBody] = await Promise.all([
      readFile(payloadPath),
      readFile(manifestPath, 'utf8'),
    ])
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    if (!missing) throw error
    const [payloadExists, manifestExists] = await Promise.all([
      access(payloadPath).then(() => true, () => false),
      access(manifestPath).then(() => true, () => false),
    ])
    if (payloadExists || manifestExists) {
      throw new Error(`Partial immutable cache for ${unit.id}; quarantine it manually`)
    }
    return null
  }
  const receipt = JSON.parse(manifestBody) as RequestReceipt
  if (
    receipt.schemaVersion !== REQUEST_SCHEMA_VERSION ||
    receipt.source !== SOURCE_SLUG ||
    receipt.unit_id !== unit.id ||
    receipt.kind !== unit.kind ||
    receipt.request_fingerprint !== requestFingerprint(unit.url) ||
    receipt.request.url !== unit.url ||
    receipt.byte_length !== payload.byteLength ||
    receipt.sha256 !== digest(payload) ||
    receipt.permission_evidence.sha256 !== context.permissionEvidence.sha256 ||
    receipt.protocol_lock.sha256 !== context.protocolLock.sha256
  ) {
    throw new Error(`Immutable cache verification failed for ${unit.id}`)
  }
  if (validateStructure) {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(payload)
    if (unit.kind === 'team-discovery') {
      parseTeamDiscoveryPage(html)
    } else {
      parseActiveRosterPage(html, teamFromUnit(unit), receipt.retrieved_at)
    }
  }
  return {
    receipt,
    body: payload,
    cache_status: 'verified',
    live_attempts: 0,
  }
}

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    [...response.headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
}

function retryAfterMilliseconds(value: string | null, now: Date): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now.getTime()) : 0
}

async function throttle(context: FetchContext): Promise<void> {
  if (context.lastLiveRequestMs !== null) {
    const elapsed = context.now().getTime() - context.lastLiveRequestMs
    if (elapsed < CRAWL_DELAY_MS) await context.sleep(CRAWL_DELAY_MS - elapsed)
  }
  context.lastLiveRequestMs = context.now().getTime()
}

async function fetchAndCache(
  context: FetchContext,
  unit: AcquisitionUnit,
): Promise<CacheResult> {
  const existing = await verifiedCache(context, unit)
  if (existing) return existing
  let lastError: unknown = new Error(`No attempt made for ${unit.id}`)
  let liveAttempts = 0
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await throttle(context)
    liveAttempts += 1
    let retryAfter = 0
    try {
      const response = await context.fetchImpl(unit.url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'identity',
        },
      })
      retryAfter = retryAfterMilliseconds(
        response.headers.get('retry-after'),
        context.now(),
      )
      if (response.status !== 200) {
        const error = new Error(`HTTP ${response.status} for ${unit.url}`)
        if (response.status !== 429 && response.status < 500) throw error
        lastError = error
      } else {
        const finalUrl = response.url ? canonicalUrl(response.url) : unit.url
        if (finalUrl !== unit.url) {
          throw new Error(`Unexpected redirect for ${unit.id}: ${finalUrl}`)
        }
        const encoding = normalizeText(response.headers.get('content-encoding')).toLowerCase()
        if (encoding && encoding !== 'identity') {
          throw new Error(`Unexpected content encoding ${encoding} for ${unit.id}`)
        }
        const mediaType = normalizeText(response.headers.get('content-type'))
        if (mediaType && !mediaType.toLowerCase().includes('text/html')) {
          throw new Error(`Unexpected content type ${mediaType} for ${unit.id}`)
        }
        const body = new Uint8Array(await response.arrayBuffer())
        if (body.byteLength === 0 || body.byteLength > MAX_RESPONSE_BYTES) {
          throw new StructuralValidationError(
            `Response for ${unit.id} has invalid byte length ${body.byteLength}`,
          )
        }
        const html = new TextDecoder('utf-8', { fatal: true }).decode(body)
        const retrievedAt = context.now().toISOString()
        if (unit.kind === 'team-discovery') {
          parseTeamDiscoveryPage(html)
        } else {
          parseActiveRosterPage(html, teamFromUnit(unit), retrievedAt)
        }
        const directory = cacheDirectory(context.rootDir, unit)
        const payloadPath = path.join(directory, 'payload.html')
        const receipt: RequestReceipt = {
          schemaVersion: REQUEST_SCHEMA_VERSION,
          source: SOURCE_SLUG,
          unit_id: unit.id,
          kind: unit.kind,
          team_id: unit.team_id,
          team_name: unit.team_name,
          request_fingerprint: requestFingerprint(unit.url),
          request: {
            method: 'GET',
            url: unit.url,
            userAgent: USER_AGENT,
            acceptEncoding: 'identity',
          },
          response: {
            status: 200,
            finalUrl,
            headers: responseHeaders(response),
          },
          retrieved_at: retrievedAt,
          attempt_count: attempt,
          byte_length: body.byteLength,
          sha256: digest(body),
          media_type: mediaType || 'text/html',
          payload_path: path.relative(context.rootDir, payloadPath),
          parser_version_at_acquisition: PARSER_VERSION,
          permission_evidence: context.permissionEvidence,
          protocol_lock: context.protocolLock,
        }
        await mkdir(directory, { recursive: true })
        const landing = path.join(directory, `.landing-${randomUUID()}`)
        await mkdir(landing)
        try {
          await Promise.all([
            writeFile(path.join(landing, 'payload.html'), body),
            writeFile(path.join(landing, 'manifest.json'), stableJson(receipt)),
          ])
          await rename(path.join(landing, 'payload.html'), payloadPath)
          await rename(
            path.join(landing, 'manifest.json'),
            path.join(directory, 'manifest.json'),
          )
        } finally {
          await rm(landing, { recursive: true, force: true })
        }
        return {
          receipt,
          body,
          cache_status: 'downloaded',
          live_attempts: liveAttempts,
        }
      }
    } catch (error) {
      lastError = error
      if (
        error instanceof Error &&
        (error.message.startsWith('HTTP 4') ||
          error.message.startsWith('Unexpected redirect') ||
          error.message.startsWith('Unexpected content encoding') ||
          error.message.startsWith('Unexpected content type')) &&
        !error.message.startsWith('HTTP 429')
      ) {
        throw error
      }
    }
    if (attempt < MAX_ATTEMPTS) {
      const exponential = Math.min(30_000, CRAWL_DELAY_MS * 2 ** (attempt - 1))
      await context.sleep(Math.max(exponential, retryAfter))
    }
  }
  throw lastError
}

function teamFromUnit(unit: AcquisitionUnit): TeamDiscovery {
  if (!unit.team_id || !unit.team_name || unit.kind !== 'team-roster') {
    throw new Error(`${unit.id} is not a complete roster unit`)
  }
  return {
    team_id: unit.team_id,
    team_name: unit.team_name,
    season: SEASON,
    team_url: `${BASE_URL}/teams/${unit.team_id}/${SEASON}.shtml`,
    roster_url: unit.url,
  }
}

function pendingUnit(unit: AcquisitionUnit): UnitState {
  return {
    ...unit,
    status: 'pending',
    live_attempts: 0,
    last_error: null,
    request_fingerprint: requestFingerprint(unit.url),
  }
}

function statePath(rootDir: string): string {
  return path.join(
    rootDir,
    `data/raw/baseball-reference-rosters/${SEASON}/state.json`,
  )
}

async function readState(rootDir: string, now: Date): Promise<AcquisitionState> {
  const filePath = statePath(rootDir)
  try {
    const state = JSON.parse(await readFile(filePath, 'utf8')) as AcquisitionState
    if (
      state.schemaVersion !== STATE_SCHEMA_VERSION ||
      state.source !== SOURCE_SLUG ||
      state.season !== SEASON ||
      state.discovery.id !== discoveryUnit().id ||
      state.discovery.url !== discoveryUnit().url
    ) {
      throw new Error(`Incompatible roster state at ${filePath}`)
    }
    return state
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      source: SOURCE_SLUG,
      season: SEASON,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      discovery: pendingUnit(discoveryUnit()),
      teams: [],
    }
  }
}

async function writeState(rootDir: string, state: AcquisitionState): Promise<void> {
  await writeAtomic(statePath(rootDir), stableJson(state))
}

function reconcileTeams(state: AcquisitionState, teams: TeamDiscovery[]): void {
  const prior = new Map(state.teams.map((unit) => [unit.team_id, unit]))
  const next: UnitState[] = []
  for (const team of teams) {
    const unit = rosterUnit(team)
    const existing = prior.get(team.team_id)
    if (
      existing &&
      (existing.id !== unit.id ||
        existing.url !== unit.url ||
        existing.team_name !== unit.team_name)
    ) {
      throw new Error(`Roster unit definition changed for ${team.team_id}`)
    }
    next.push(existing ?? pendingUnit(unit))
  }
  if (state.teams.some((unit) => !teams.some((team) => team.team_id === unit.team_id))) {
    throw new Error('Locked team discovery no longer reconciles with roster state')
  }
  state.teams = next.sort((left, right) =>
    (left.team_id ?? '').localeCompare(right.team_id ?? ''),
  )
}

async function warIdentityReconciliation(
  rootDir: string,
  rosterRows: ActiveRosterRow[],
): Promise<{
  available: boolean
  dataset_path: string
  dataset_sha256: string | null
  reference_player_count: number | null
  roster_player_count: number
  matched_roster_player_count: number | null
  unmatched_roster_player_ids: string[] | null
}> {
  const relativePath = 'data/processed/baseball-reference-mlb-war/player_seasons.json'
  const filePath = path.join(rootDir, relativePath)
  const rosterIds = [
    ...new Set(
      rosterRows
        .map((row) => row.bbref_id)
        .filter((value): value is string => value !== null),
    ),
  ].sort()
  try {
    const body = await readFile(filePath)
    const rows = JSON.parse(body.toString('utf8')) as Array<{ bbref_id?: unknown }>
    if (!Array.isArray(rows)) throw new Error(`${relativePath} is not an array`)
    const referenceIds = new Set(
      rows
        .map((row) => row.bbref_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    )
    const unmatched = rosterIds.filter((id) => !referenceIds.has(id))
    return {
      available: true,
      dataset_path: relativePath,
      dataset_sha256: digest(body),
      reference_player_count: referenceIds.size,
      roster_player_count: rosterIds.length,
      matched_roster_player_count: rosterIds.length - unmatched.length,
      unmatched_roster_player_ids: unmatched,
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    return {
      available: false,
      dataset_path: relativePath,
      dataset_sha256: null,
      reference_player_count: null,
      roster_player_count: rosterIds.length,
      matched_roster_player_count: null,
      unmatched_roster_player_ids: null,
    }
  }
}

async function materialize(
  rootDir: string,
  state: AcquisitionState,
  context: FetchContext,
): Promise<{
  rosterRows: ActiveRosterRow[]
  manifestPath: string
  outputPath: string
  referenceLockPath: string
  unmatchedWarIds: string[] | null
}> {
  if (
    state.discovery.status !== 'succeeded' ||
    state.teams.length !== EXPECTED_TEAM_COUNT ||
    state.teams.some((unit) => unit.status !== 'succeeded')
  ) {
    throw new Error('Cannot materialize an incomplete active-roster snapshot')
  }
  const units = [state.discovery, ...state.teams]
  const receipts: RequestReceipt[] = []
  const rosterRows: ActiveRosterRow[] = []
  for (const unit of units) {
    const cache = await verifiedCache(context, unit)
    if (!cache) throw new Error(`Succeeded unit ${unit.id} has no immutable cache`)
    receipts.push(cache.receipt)
    if (unit.kind === 'team-roster') {
      const html = new TextDecoder('utf-8', { fatal: true }).decode(cache.body)
      rosterRows.push(
        ...parseActiveRosterPage(
          html,
          teamFromUnit(unit),
          cache.receipt.retrieved_at,
        ),
      )
    }
  }
  rosterRows.sort((left, right) =>
    left.team_id.localeCompare(right.team_id) ||
    left.source_player_key.localeCompare(right.source_player_key),
  )
  const outputDirectory = path.join(
    rootDir,
    `data/processed/baseball-reference-rosters/${SEASON}`,
  )
  const outputPath = path.join(outputDirectory, 'active_roster.json')
  const outputBody = stableJson(rosterRows)
  await writeAtomic(outputPath, outputBody)
  const uniquePlayerKeys = new Set(rosterRows.map((row) => row.source_player_key))
  const multiTeamPlayers = [...uniquePlayerKeys]
    .filter(
      (sourceKey) =>
        new Set(
          rosterRows
            .filter((row) => row.source_player_key === sourceKey)
            .map((row) => row.team_id),
        ).size > 1,
    )
    .sort()
  const reconciliation = await warIdentityReconciliation(rootDir, rosterRows)
  const knownAtValues = rosterRows.map((row) => row.known_at).sort()
  const otherRosterStatusCounts = Object.fromEntries(
    [...new Set(
      rosterRows
        .filter((row) => !row.is_dl && row.is_dl_source)
        .map((row) => row.is_dl_source as string),
    )]
      .sort()
      .map((status) => [
        status,
        rosterRows.filter(
          (row) => !row.is_dl && row.is_dl_source === status,
        ).length,
      ]),
  )
  const outputRecord = {
    path: path.relative(rootDir, outputPath),
    media_type: 'application/json',
    row_count: rosterRows.length,
    byte_length: Buffer.byteLength(outputBody),
    sha256: digest(outputBody),
  }
  const inputs = receipts
    .sort((left, right) => left.unit_id.localeCompare(right.unit_id))
    .map((receipt) => ({
      unit_id: receipt.unit_id,
      kind: receipt.kind,
      team_id: receipt.team_id,
      url: receipt.request.url,
      retrieved_at: receipt.retrieved_at,
      byte_length: receipt.byte_length,
      sha256: receipt.sha256,
      request_manifest_path: path.join(
        path.dirname(receipt.payload_path),
        'manifest.json',
      ),
    }))
  const manifest = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    source: SOURCE_SLUG,
    parserVersion: PARSER_VERSION,
    generated_at: context.now().toISOString(),
    season: SEASON,
    permission_evidence: context.permissionEvidence,
    protocol_lock: context.protocolLock,
    source_lock_isolation: {
      global_source_lock: 'data/source-lock.json',
      included_in_global_source_lock: false,
    },
    coverage: {
      team_count: state.teams.length,
      expected_team_count: EXPECTED_TEAM_COUNT,
      roster_rows: rosterRows.length,
      unique_players: uniquePlayerKeys.size,
      active_rows: rosterRows.filter((row) => row.is_active).length,
      injured_list_rows: rosterRows.filter((row) => row.is_dl).length,
      other_40_man_rows: rosterRows.filter((row) => !row.is_active && !row.is_dl).length,
      other_roster_status_counts: otherRosterStatusCounts,
      multi_team_player_ids: multiTeamPlayers,
      known_at_first: knownAtValues[0] ?? null,
      known_at_last: knownAtValues.at(-1) ?? null,
      complete: true,
    },
    semantics: {
      row_grain: 'one Baseball-Reference #the40man player-team row',
      membership: '40-man roster snapshot, including active, injured-list, and other reserved-list statuses',
      active_universe: 'Rows where is_active is true at the team page known_at timestamp',
      snapshot_atomicity: 'Team pages are serialized but are not a provider-side atomic transaction',
      training_eligible: false,
      scoring_only: true,
      raw_redistribution: false,
    },
    identity_reconciliation: reconciliation,
    provisional_identities: {
      rows_without_bbref_id: rosterRows.filter((row) => row.bbref_id === null).length,
      mlbam_only_player_ids: [
        ...new Set(
          rosterRows
            .map((row) => row.mlbam_id)
            .filter((value): value is number => value !== null),
        ),
      ].sort((left, right) => left - right),
    },
    inputs,
    outputs: [outputRecord],
  }
  const manifestPath = path.join(outputDirectory, 'manifest.json')
  const manifestBody = stableJson(manifest)
  await writeAtomic(manifestPath, manifestBody)
  const referenceLock = {
    schemaVersion: REFERENCE_LOCK_SCHEMA_VERSION,
    source: SOURCE_SLUG,
    created_at: context.now().toISOString(),
    season: SEASON,
    permission_evidence: context.permissionEvidence,
    protocol_lock: context.protocolLock,
    source_lock_isolation: {
      global_source_lock: 'data/source-lock.json',
      global_source_lock_modified: false,
    },
    dataset_manifest: {
      path: path.relative(rootDir, manifestPath),
      byte_length: Buffer.byteLength(manifestBody),
      sha256: digest(manifestBody),
    },
    inputs,
    outputs: [outputRecord],
  }
  const referenceLockPath = path.join(
    rootDir,
    `data/reference-locks/baseball-reference-rosters-${SEASON}.json`,
  )
  await writeAtomic(referenceLockPath, stableJson(referenceLock))
  return {
    rosterRows,
    manifestPath: path.relative(rootDir, manifestPath),
    outputPath: path.relative(rootDir, outputPath),
    referenceLockPath: path.relative(rootDir, referenceLockPath),
    unmatchedWarIds: reconciliation.unmatched_roster_player_ids,
  }
}

export async function acquireAcquisitionLock(
  rootDir: string,
): Promise<ReleaseAcquisitionLock> {
  const competingLocks = [
    'data/raw/baseball-reference-mlb-war/.acquisition.lock',
    'data/raw/baseball-reference-register/.acquisition.lock',
  ]
  for (const relativePath of competingLocks) {
    if (await access(path.join(rootDir, relativePath)).then(() => true, () => false)) {
      throw new Error(
        `Another Baseball-Reference acquisition is running (${relativePath})`,
      )
    }
  }
  const lockPath = path.join(
    rootDir,
    'data/raw/baseball-reference-rosters/.acquisition.lock',
  )
  await mkdir(path.dirname(lockPath), { recursive: true })
  let handle
  try {
    handle = await open(lockPath, 'wx')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Another Baseball-Reference roster acquisition is running')
    }
    throw error
  }
  await handle.writeFile(`${process.pid}\n`)
  return async () => {
    await handle.close()
    await rm(lockPath, { force: true })
  }
}

export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
  if (
    !Number.isInteger(options.maxPages) ||
    options.maxPages < 1 ||
    options.maxPages > MAX_PAGES_PER_RUN
  ) {
    throw new Error(`max-pages must be an integer from 1 to ${MAX_PAGES_PER_RUN}`)
  }
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const log = options.log ?? console.log
  const protocol = await readProtocol(options.rootDir)
  if (!options.execute) {
    log(
      `Dry run: one locked ${SEASON} MLB team-discovery page plus ${EXPECTED_TEAM_COUNT} #the40man roster pages; execute will process at most ${options.maxPages} pages.`,
    )
    return {
      status: 'dry-run',
      plannedPages: EXPECTED_TEAM_COUNT + 1,
      completedPages: 0,
      attemptedPages: 0,
      liveRequests: 0,
      teamCount: 0,
      rosterRows: null,
      activeRows: null,
      injuredListRows: null,
      unmatchedWarIds: null,
      mlbamOnlyIds: null,
      outputPath: null,
      manifestPath: null,
      referenceLockPath: null,
    }
  }
  const release = await acquireAcquisitionLock(options.rootDir)
  try {
    const context: FetchContext = {
      rootDir: options.rootDir,
      permissionEvidence: protocol.permission,
      protocolLock: protocol.evidence,
      fetchImpl: options.fetchImpl ?? fetch,
      now,
      sleep,
      lastLiveRequestMs: null,
    }
    const state = await readState(options.rootDir, now())
    if (
      state.discovery.live_attempts > 0 ||
      state.teams.some((unit) => unit.live_attempts > 0)
    ) {
      const priorRequestTime = Date.parse(state.updated_at)
      if (Number.isFinite(priorRequestTime)) context.lastLiveRequestMs = priorRequestTime
    }
    let attemptedPages = 0
    let liveRequests = 0
    if (state.discovery.status !== 'succeeded' && attemptedPages < options.maxPages) {
      attemptedPages += 1
      try {
        const cache = await fetchAndCache(context, state.discovery)
        liveRequests += cache.live_attempts
        const html = new TextDecoder('utf-8', { fatal: true }).decode(cache.body)
        reconcileTeams(state, parseTeamDiscoveryPage(html))
        state.discovery.status = 'succeeded'
        state.discovery.live_attempts += cache.live_attempts
        state.discovery.last_error = null
      } catch (error) {
        state.discovery.status = 'failed'
        state.discovery.last_error = error instanceof Error ? error.message : String(error)
        state.updated_at = now().toISOString()
        await writeState(options.rootDir, state)
        throw error
      }
      state.updated_at = now().toISOString()
      await writeState(options.rootDir, state)
    }
    if (state.discovery.status === 'succeeded' && state.teams.length === 0) {
      const cache = await verifiedCache(context, state.discovery)
      if (!cache) throw new Error('Succeeded discovery has no immutable cache')
      const html = new TextDecoder('utf-8', { fatal: true }).decode(cache.body)
      reconcileTeams(state, parseTeamDiscoveryPage(html))
      state.updated_at = now().toISOString()
      await writeState(options.rootDir, state)
    }
    for (const unit of state.teams.filter((candidate) => candidate.status !== 'succeeded')) {
      if (attemptedPages >= options.maxPages) break
      attemptedPages += 1
      try {
        const cache = await fetchAndCache(context, unit)
        liveRequests += cache.live_attempts
        unit.status = 'succeeded'
        unit.live_attempts += cache.live_attempts
        unit.last_error = null
        log(`Captured ${unit.team_id} ${SEASON} 40-man roster.`)
      } catch (error) {
        unit.status = 'failed'
        unit.last_error = error instanceof Error ? error.message : String(error)
        log(`Roster ${unit.team_id} failed and remains resumable: ${unit.last_error}`)
      }
      state.updated_at = now().toISOString()
      await writeState(options.rootDir, state)
    }
    const completedPages =
      (state.discovery.status === 'succeeded' ? 1 : 0) +
      state.teams.filter((unit) => unit.status === 'succeeded').length
    const complete =
      state.discovery.status === 'succeeded' &&
      state.teams.length === EXPECTED_TEAM_COUNT &&
      state.teams.every((unit) => unit.status === 'succeeded')
    if (!complete) {
      return {
        status: 'partial',
        plannedPages: EXPECTED_TEAM_COUNT + 1,
        completedPages,
        attemptedPages,
        liveRequests,
        teamCount: state.teams.length,
        rosterRows: null,
        activeRows: null,
        injuredListRows: null,
        unmatchedWarIds: null,
        mlbamOnlyIds: null,
        outputPath: null,
        manifestPath: null,
        referenceLockPath: null,
      }
    }
    const materialized = await materialize(options.rootDir, state, context)
    const activeRows = materialized.rosterRows.filter((row) => row.is_active).length
    const injuredListRows = materialized.rosterRows.filter((row) => row.is_dl).length
    return {
      status: 'complete',
      plannedPages: EXPECTED_TEAM_COUNT + 1,
      completedPages,
      attemptedPages,
      liveRequests,
      teamCount: state.teams.length,
      rosterRows: materialized.rosterRows.length,
      activeRows,
      injuredListRows,
      unmatchedWarIds: materialized.unmatchedWarIds,
      mlbamOnlyIds: [
        ...new Set(
          materialized.rosterRows
            .map((row) => row.mlbam_id)
            .filter((value): value is number => value !== null),
        ),
      ].sort((left, right) => left - right),
      outputPath: materialized.outputPath,
      manifestPath: materialized.manifestPath,
      referenceLockPath: materialized.referenceLockPath,
    }
  } finally {
    await release()
  }
}

export function parseCliArguments(args: string[]): {
  execute: boolean
  maxPages: number
  rootDir: string
} {
  let execute = false
  let maxPages = DEFAULT_MAX_PAGES
  let rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
  for (const argument of args) {
    if (argument === '--execute') execute = true
    else if (argument.startsWith('--max-pages=')) {
      maxPages = Number(argument.slice('--max-pages='.length))
    } else if (argument.startsWith('--root=')) {
      rootDir = path.resolve(argument.slice('--root='.length))
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_PER_RUN) {
    throw new Error(`max-pages must be an integer from 1 to ${MAX_PAGES_PER_RUN}`)
  }
  return { execute, maxPages, rootDir }
}

async function main(): Promise<void> {
  const options = parseCliArguments(process.argv.slice(2))
  const result = await runBackfill(options)
  console.log(JSON.stringify(result, null, 2))
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
}
