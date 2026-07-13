import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import {
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

export const SOURCE_SLUG = 'baseball-reference-mlb-war'
export const PARSER_VERSION = 'baseball-reference-mlb-war/v2'
export const STATE_SCHEMA_VERSION = 'baseball-reference-mlb-war-state/v1'
export const REQUEST_SCHEMA_VERSION = 'baseball-reference-mlb-war-request/v1'
export const DATASET_SCHEMA_VERSION = 'baseball-reference-mlb-war-dataset/v1'
export const REFERENCE_LOCK_SCHEMA_VERSION =
  'baseball-reference-mlb-war-reference-lock/v1'
export const PROTOCOL_LOCK_PATH =
  'data/reference-locks/baseball-reference-mlb-war-protocol-v2.json'
export const PERMISSION_EVIDENCE_PATH =
  'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md'
export const USER_AGENT =
  'BaseballOracleResearch/0.2 (+https://github.com/RobCase29/baseball-oracle; authorized research acquisition)'
export const CRAWL_DELAY_MS = 3_200
export const MAX_ATTEMPTS = 3
export const MAX_PAGES_PER_RUN = 50
export const DEFAULT_MAX_PAGES = 4
export const EARLIEST_SEASON = 1871
export const LATEST_COMPLETE_SEASON = 2025
export const LATEST_ALLOWED_SEASON = 2026

const BASE_URL = 'https://www.baseball-reference.com'
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const JAWS_POSITIONS = [
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
  'P',
  'RP',
] as const

type ValueSide = 'batting' | 'pitching'
type PageKind =
  | 'season-batting'
  | 'season-pitching'
  | 'hof-batting'
  | 'hof-pitching'
  | 'jaws-standard'

interface ProtocolLock {
  schemaVersion: 'baseball-reference-mlb-war-protocol/v1'
  source: typeof SOURCE_SLUG
  parserVersion: typeof PARSER_VERSION
  permissionEvidence: { path: string; sha256: string }
  coverage: {
    earliestSeason: number
    latestCompleteSeason: number
    latestAllowedSeason: number
  }
  transport: {
    crawlDelayMs: number
    maxAttempts: number
    oneWorker: true
    acceptEncoding: 'identity'
  }
}

interface EvidenceDigest {
  path: string
  sha256: string
}

interface AcquisitionUnit {
  id: string
  kind: PageKind
  url: string
  season: number | null
  position: (typeof JAWS_POSITIONS)[number] | null
}

interface UnitState extends AcquisitionUnit {
  status: 'pending' | 'succeeded' | 'failed'
  liveAttempts: number
  lastError: string | null
  requestFingerprint: string
}

interface AcquisitionState {
  schemaVersion: typeof STATE_SCHEMA_VERSION
  source: typeof SOURCE_SLUG
  createdAt: string
  updatedAt: string
  units: UnitState[]
}

interface RequestReceipt {
  schemaVersion: typeof REQUEST_SCHEMA_VERSION
  source: typeof SOURCE_SLUG
  unitId: string
  kind: PageKind
  season: number | null
  position: string | null
  requestFingerprint: string
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
  retrievedAt: string
  attemptCount: number
  byteLength: number
  sha256: string
  mediaType: string
  payloadPath: string
  parserVersionAtAcquisition: string
  permissionEvidence: EvidenceDigest
  protocolLock: EvidenceDigest
}

interface CacheResult {
  receipt: RequestReceipt
  body: Uint8Array
  cacheStatus: 'downloaded' | 'verified'
  liveAttempts: number
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

export interface ValueSeasonRow {
  bbref_id: string
  player_name: string
  season: number
  age: number | null
  team: string | null
  position: string | null
  side: ValueSide
  b_pa: number | null
  b_runs_batting: number | null
  b_runs_baserunning: number | null
  b_runs_double_plays: number | null
  b_runs_fielding: number | null
  b_runs_position: number | null
  b_raa: number | null
  b_waa: number | null
  b_runs_replacement: number | null
  b_rar: number | null
  b_war: number | null
  b_war_off: number | null
  b_war_def: number | null
  p_ip: string | null
  p_ip_outs: number | null
  p_ip_decimal: number | null
  p_games: number | null
  p_games_started: number | null
  p_runs_allowed: number | null
  p_raa: number | null
  p_waa: number | null
  p_waa_adjustment: number | null
  p_rar: number | null
  p_war: number | null
}

export interface PlayerSeasonRow {
  bbref_id: string
  player_name: string
  season: number
  season_state: 'complete' | 'in_season'
  known_at: string
  age: number | null
  team: string | null
  batting_team: string | null
  pitching_team: string | null
  position: string | null
  role: 'hitter' | 'pitcher' | 'two_way'
  b_pa: number | null
  b_runs_batting: number | null
  b_runs_baserunning: number | null
  b_runs_double_plays: number | null
  b_runs_fielding: number | null
  b_runs_position: number | null
  b_raa: number | null
  b_waa: number | null
  b_runs_replacement: number | null
  b_rar: number | null
  b_war: number | null
  b_war_off: number | null
  b_war_def: number | null
  p_ip: string | null
  p_ip_outs: number | null
  p_ip_decimal: number | null
  p_games: number | null
  p_games_started: number | null
  p_runs_allowed: number | null
  p_raa: number | null
  p_waa: number | null
  p_waa_adjustment: number | null
  p_rar: number | null
  p_war: number | null
  total_war: number
}

interface HallOfFameSideRow {
  bbref_id: string
  player_name: string
  year_inducted: number
  career_start_year: number
  career_end_year: number
  side: ValueSide
  career_war: number
  career_pa: number | null
  career_ip: string | null
  career_ip_outs: number | null
  career_ip_decimal: number | null
}

export interface HallOfFameInducteeRow {
  bbref_id: string
  player_name: string
  year_inducted: number
  career_start_year: number
  career_end_year: number
  position_player: boolean
  pitcher: boolean
  career_b_war: number | null
  career_p_war: number | null
  career_pa: number | null
  career_ip: string | null
  career_ip_outs: number | null
  career_ip_decimal: number | null
}

export interface JawsStandardRow {
  position: (typeof JAWS_POSITIONS)[number]
  label: string
  hof_player_count: number
  career_war_standard: number
  peak_seven_war_standard: number
  jaws_standard: number
  specialized_jaws_standard: number | null
  specialized_metric: 'S_JAWS' | 'R_JAWS' | null
}

interface ParsedArtifact {
  schemaVersion: 'baseball-reference-mlb-war-page/v1'
  parserVersion: typeof PARSER_VERSION
  unit: AcquisitionUnit
  sourceRequestSha256: string
  sourceRetrievedAt: string
  rows: ValueSeasonRow[] | HallOfFameSideRow[] | JawsStandardRow[]
}

export interface BackfillOptions {
  rootDir: string
  startSeason: number
  endSeason: number
  maxPages: number
  execute: boolean
  fetchImpl?: typeof fetch
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  log?: (message: string) => void
}

export interface BackfillResult {
  status: 'dry-run' | 'partial' | 'complete'
  plannedUnits: number
  completedUnits: number
  attemptedPages: number
  liveRequests: number
  outputDirectory: string
  datasetManifestPath: string | null
  referenceLockPath: string | null
}

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
    /^\/leagues\/majors\/\d{4}-value-(batting|pitching)\.shtml$/.test(
      url.pathname,
    ) ||
    url.pathname === '/awards/hof_batting.shtml' ||
    url.pathname === '/awards/hof_pitching.shtml' ||
    /^\/leaders\/jaws_(C|1B|2B|3B|SS|LF|CF|RF|P|RP)\.shtml$/.test(
      url.pathname,
    )
  if (!allowed || url.search || url.hash) {
    throw new Error(`Refusing unregistered Baseball-Reference endpoint: ${url.toString()}`)
  }
  return url.toString()
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

function seasonUrl(season: number, side: ValueSide): string {
  return canonicalUrl(
    `${BASE_URL}/leagues/majors/${season}-value-${side}.shtml`,
  )
}

function hofUrl(side: ValueSide): string {
  return canonicalUrl(`${BASE_URL}/awards/hof_${side}.shtml`)
}

function jawsUrl(position: (typeof JAWS_POSITIONS)[number]): string {
  return canonicalUrl(`${BASE_URL}/leaders/jaws_${position}.shtml`)
}

function plannedUnits(startSeason: number, endSeason: number): AcquisitionUnit[] {
  const seasonUnits = (season: number): AcquisitionUnit[] =>
    (['batting', 'pitching'] as const).map((side) => ({
      id: `season-${season}-${side}`,
      kind: `season-${side}`,
      url: seasonUrl(season, side),
      season,
      position: null,
    }))
  const units: AcquisitionUnit[] = seasonUnits(endSeason)
  for (const side of ['batting', 'pitching'] as const) {
    units.push({
      id: `hof-${side}`,
      kind: `hof-${side}`,
      url: hofUrl(side),
      season: null,
      position: null,
    })
  }
  for (const position of JAWS_POSITIONS) {
    units.push({
      id: `jaws-${position}`,
      kind: 'jaws-standard',
      url: jawsUrl(position),
      season: null,
      position,
    })
  }
  for (let season = endSeason - 1; season >= startSeason; season -= 1) {
    units.push(...seasonUnits(season))
  }
  return units
}

function htmlDocuments(html: string): Document[] {
  const main = new JSDOM(html).window.document
  const documents = [main]
  const walker = main.createTreeWalker(main, 128)
  let node = walker.nextNode()
  while (node) {
    const value = node.nodeValue ?? ''
    if (value.includes('<table')) {
      documents.push(new JSDOM(value).window.document)
    }
    node = walker.nextNode()
  }
  return documents
}

function findTable(documents: Document[], id: string): HTMLTableElement | null {
  for (const document of documents) {
    const element = document.getElementById(id)
    if (element?.tagName === 'TABLE') return element as HTMLTableElement
  }
  return null
}

function numericCell(
  row: Element,
  stat: string,
  options: { displayOnly?: boolean; required?: boolean } = {},
): number | null {
  const cell = row.querySelector<HTMLElement>(`[data-stat="${stat}"]`)
  if (!cell) {
    if (options.required) {
      throw new StructuralValidationError(`Required data-stat ${stat} is missing`)
    }
    return null
  }
  const displayed = normalizeText(cell.textContent).replaceAll(',', '')
  const candidate = options.displayOnly
    ? displayed
    : normalizeText(cell.getAttribute('csk')).replaceAll(',', '') || displayed
  if (!candidate) return null
  const value = Number(candidate)
  if (!Number.isFinite(value)) {
    throw new StructuralValidationError(
      `data-stat ${stat} has a non-numeric value: ${candidate}`,
    )
  }
  return value
}

function inningsCell(
  row: Element,
  stat: string,
  options: { required?: boolean } = {},
): { display: string | null; outs: number | null; decimal: number | null } {
  const cell = row.querySelector<HTMLElement>(`[data-stat="${stat}"]`)
  if (!cell) {
    if (options.required) {
      throw new StructuralValidationError(`Required data-stat ${stat} is missing`)
    }
    return { display: null, outs: null, decimal: null }
  }
  const display = normalizeText(cell.textContent).replaceAll(',', '')
  if (!display) return { display: null, outs: null, decimal: null }
  const match = /^(\d+)(?:\.([012]))?$/.exec(display)
  if (!match) {
    throw new StructuralValidationError(
      `data-stat ${stat} has invalid baseball innings notation: ${display}`,
    )
  }
  const outs = Number(match[1]) * 3 + Number(match[2] ?? 0)
  const csk = normalizeText(cell.getAttribute('csk')).replaceAll(',', '')
  if (csk && (!/^\d+$/.test(csk) || Number(csk) !== outs)) {
    throw new StructuralValidationError(
      `data-stat ${stat} display ${display} conflicts with outs csk ${csk}`,
    )
  }
  return { display, outs, decimal: outs / 3 }
}

function textCell(row: Element, stat: string): string | null {
  return normalizeText(
    row.querySelector<HTMLElement>(`[data-stat="${stat}"]`)?.textContent,
  ) || null
}

function playerIdentity(cell: Element, context: string): { id: string; name: string } {
  const id = normalizeText(cell.getAttribute('data-append-csv'))
  if (!/^[a-z0-9][a-z0-9_.'-]{2,9}\d{2}$/.test(id) || id.includes('..')) {
    throw new StructuralValidationError(
      `${context} has an invalid Baseball-Reference player ID: ${id || 'missing'}`,
    )
  }
  const link = cell.querySelector<HTMLAnchorElement>('a[href]')
  if (!link) {
    throw new StructuralValidationError(`${context} has no player link`)
  }
  const href = new URL(link.getAttribute('href') ?? '', BASE_URL)
  const expectedPath = `/players/${id[0]}/${id}.shtml`
  if (href.hostname !== 'www.baseball-reference.com' || href.pathname !== expectedPath) {
    throw new StructuralValidationError(
      `${context} player link conflicts with data-append-csv`,
    )
  }
  const name = normalizeText(link.textContent)
  if (!name) throw new StructuralValidationError(`${context} has no player name`)
  return { id, name }
}

export function parseValueSeasonPage(
  html: string,
  season: number,
  side: ValueSide,
): ValueSeasonRow[] {
  const tableId = `players_value_${side}`
  const table = findTable(htmlDocuments(html), tableId)
  if (!table) {
    throw new StructuralValidationError(
      `Season ${season} ${side} page is missing table#${tableId}`,
    )
  }
  const rows: ValueSeasonRow[] = []
  const seen = new Set<string>()
  for (const [index, row] of [
    ...table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ].entries()) {
    if (
      row.classList.contains('partial_table') ||
      row.classList.contains('norank') ||
      row.classList.contains('thead') ||
      row.classList.contains('spacer')
    ) {
      continue
    }
    const playerCell = row.querySelector<HTMLElement>('[data-stat="name_display"]')
    if (!playerCell) {
      if (row.querySelectorAll('th,td').length === 0) continue
      throw new StructuralValidationError(
        `table#${tableId} row ${index + 1} has no player cell`,
      )
    }
    const player = playerIdentity(playerCell, `table#${tableId} row ${index + 1}`)
    if (seen.has(player.id)) {
      throw new StructuralValidationError(
        `Season ${season} ${side} contains duplicate total row for ${player.id}`,
      )
    }
    seen.add(player.id)
    const common = {
      bbref_id: player.id,
      player_name: player.name,
      season,
      age: numericCell(row, 'age', { displayOnly: true }),
      team: textCell(row, 'team_name_abbr'),
      position: side === 'batting' ? textCell(row, 'pos') : null,
      side,
    }
    const innings =
      side === 'pitching'
        ? inningsCell(row, 'p_ip', { required: true })
        : { display: null, outs: null, decimal: null }
    rows.push({
      ...common,
      b_pa: side === 'batting' ? numericCell(row, 'b_pa') : null,
      b_runs_batting:
        side === 'batting' ? numericCell(row, 'b_runs_batting') : null,
      b_runs_baserunning:
        side === 'batting' ? numericCell(row, 'b_runs_baserunning') : null,
      b_runs_double_plays:
        side === 'batting' ? numericCell(row, 'b_runs_double_plays') : null,
      b_runs_fielding:
        side === 'batting' ? numericCell(row, 'b_runs_fielding') : null,
      b_runs_position:
        side === 'batting' ? numericCell(row, 'b_runs_position') : null,
      b_raa: side === 'batting' ? numericCell(row, 'b_raa') : null,
      b_waa: side === 'batting' ? numericCell(row, 'b_waa') : null,
      b_runs_replacement:
        side === 'batting' ? numericCell(row, 'b_runs_replacement') : null,
      b_rar: side === 'batting' ? numericCell(row, 'b_rar') : null,
      b_war: side === 'batting' ? numericCell(row, 'b_war', { required: true }) : null,
      b_war_off: side === 'batting' ? numericCell(row, 'b_war_off') : null,
      b_war_def: side === 'batting' ? numericCell(row, 'b_war_def') : null,
      p_ip: innings.display,
      p_ip_outs: innings.outs,
      p_ip_decimal: innings.decimal,
      p_games: side === 'pitching' ? numericCell(row, 'p_g') : null,
      p_games_started: side === 'pitching' ? numericCell(row, 'p_gs') : null,
      p_runs_allowed: side === 'pitching' ? numericCell(row, 'p_r') : null,
      p_raa: side === 'pitching' ? numericCell(row, 'p_raa') : null,
      p_waa: side === 'pitching' ? numericCell(row, 'p_waa') : null,
      p_waa_adjustment:
        side === 'pitching' ? numericCell(row, 'p_waa_adj') : null,
      p_rar: side === 'pitching' ? numericCell(row, 'p_rar') : null,
      p_war:
        side === 'pitching' ? numericCell(row, 'p_war', { required: true }) : null,
    })
  }
  if (rows.length === 0) {
    throw new StructuralValidationError(
      `Season ${season} ${side} table contains zero accepted total player rows`,
    )
  }
  return rows.sort((left, right) => left.bbref_id.localeCompare(right.bbref_id))
}

export function parseHallOfFamePage(
  html: string,
  side: ValueSide,
): HallOfFameSideRow[] {
  const tableId = `hof_${side}`
  const table = findTable(htmlDocuments(html), tableId)
  if (!table) {
    throw new StructuralValidationError(`HOF page is missing table#${tableId}`)
  }
  const rows: HallOfFameSideRow[] = []
  const seen = new Set<string>()
  for (const [index, row] of [
    ...table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ].entries()) {
    if (row.classList.contains('thead')) continue
    if (side === 'batting' && row.classList.contains('non_batter')) continue
    if (side === 'pitching' && !row.classList.contains('pitcher')) continue
    const cell = row.querySelector<HTMLElement>('[data-stat="player"]')
    if (!cell) continue
    if (
      side === 'batting' &&
      !normalizeText(cell.getAttribute('data-append-csv')) &&
      normalizeText(cell.textContent) === 'Average Batting HOFer'
    ) {
      continue
    }
    const player = playerIdentity(cell, `table#${tableId} row ${index + 1}`)
    if (seen.has(player.id)) {
      throw new StructuralValidationError(
        `HOF ${side} register contains duplicate player ${player.id}`,
      )
    }
    seen.add(player.id)
    const careerInnings =
      side === 'pitching'
        ? inningsCell(row, 'IP')
        : { display: null, outs: null, decimal: null }
    rows.push({
      bbref_id: player.id,
      player_name: player.name,
      year_inducted: numericCell(row, 'year_induction', {
        displayOnly: true,
        required: true,
      }) as number,
      career_start_year: numericCell(row, 'year_min', {
        displayOnly: true,
        required: true,
      }) as number,
      career_end_year: numericCell(row, 'year_max', {
        displayOnly: true,
        required: true,
      }) as number,
      side,
      career_war: numericCell(
        row,
        side === 'batting' ? 'WAR_bat' : 'WAR_pitch',
        { displayOnly: true, required: true },
      ) as number,
      career_pa:
        side === 'batting'
          ? numericCell(row, 'PA', { displayOnly: true })
          : null,
      career_ip: careerInnings.display,
      career_ip_outs: careerInnings.outs,
      career_ip_decimal: careerInnings.decimal,
    })
  }
  if (rows.length === 0) {
    throw new StructuralValidationError(`HOF ${side} register has zero accepted players`)
  }
  return rows.sort((left, right) => left.bbref_id.localeCompare(right.bbref_id))
}

function firstNumericAlias(row: Element, aliases: string[]): number | null {
  for (const alias of aliases) {
    if (row.querySelector(`[data-stat="${alias}"]`)) {
      return numericCell(row, alias, { displayOnly: true })
    }
  }
  return null
}

export function parseJawsStandardPage(
  html: string,
  position: (typeof JAWS_POSITIONS)[number],
): JawsStandardRow[] {
  const table = findTable(htmlDocuments(html), 'jaws')
  if (!table) {
    throw new StructuralValidationError(
      `JAWS ${position} page is missing table#jaws`,
    )
  }
  const candidates = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr.norank')]
    .map((row) => ({ row, label: textCell(row, 'player') ?? textCell(row, 'name_display') }))
    .filter(
      (candidate): candidate is { row: HTMLTableRowElement; label: string } =>
        candidate.label?.startsWith('Avg of ') === true &&
        candidate.label.includes(' HOFers at this position'),
    )
  if (candidates.length !== 1) {
    throw new StructuralValidationError(
      `JAWS ${position} page exposes ${candidates.length} exact HOF-average rows; expected 1`,
    )
  }
  const { row, label } = candidates[0]
  const match = /^Avg of (\d+) HOFers at this position/.exec(label)
  if (!match) throw new StructuralValidationError(`JAWS ${position} HOF count is missing`)
  const careerWar = firstNumericAlias(row, ['WAR_career', 'WAR'])
  const peakWar = firstNumericAlias(row, ['WAR_peak7', 'WAR7'])
  const jaws = firstNumericAlias(row, ['JAWS'])
  if (careerWar === null || peakWar === null || jaws === null) {
    throw new StructuralValidationError(
      `JAWS ${position} HOF-average row is missing WAR_career, WAR_peak7, or JAWS`,
    )
  }
  const specializedMetric =
    position === 'P' ? 'S_JAWS' : position === 'RP' ? 'R_JAWS' : null
  return [
    {
      position,
      label,
      hof_player_count: Number(match[1]),
      career_war_standard: careerWar,
      peak_seven_war_standard: peakWar,
      jaws_standard: jaws,
      specialized_jaws_standard: specializedMetric
        ? firstNumericAlias(row, [specializedMetric])
        : null,
      specialized_metric: specializedMetric,
    },
  ]
}

function parseUnit(html: string, unit: AcquisitionUnit): ParsedArtifact['rows'] {
  if (unit.kind === 'season-batting' || unit.kind === 'season-pitching') {
    if (unit.season === null) throw new Error(`${unit.id} has no season`)
    return parseValueSeasonPage(
      html,
      unit.season,
      unit.kind === 'season-batting' ? 'batting' : 'pitching',
    )
  }
  if (unit.kind === 'hof-batting' || unit.kind === 'hof-pitching') {
    return parseHallOfFamePage(
      html,
      unit.kind === 'hof-batting' ? 'batting' : 'pitching',
    )
  }
  if (!unit.position) throw new Error(`${unit.id} has no JAWS position`)
  return parseJawsStandardPage(html, unit.position)
}

export function inferSeasonRole(input: {
  battingPa: number | null
  pitchingIp: number | null
  battingPosition: string | null
  hasBattingRow: boolean
  hasPitchingRow: boolean
}): 'hitter' | 'pitcher' | 'two_way' {
  if (!input.hasPitchingRow) return 'hitter'
  if (!input.hasBattingRow) return 'pitcher'
  const positionTokens = (input.battingPosition ?? '')
    .replaceAll('*', '')
    .replaceAll('#', '')
    .split(/[/,\s]+/)
    .filter(Boolean)
  const hasNonPitcherPosition = positionTokens.some(
    (token) => token !== '1' && token !== 'P',
  )
  const battingPa = input.battingPa ?? 0
  const pitchingIp = input.pitchingIp ?? 0
  const battingWorkload = battingPa / 600
  const pitchingWorkload = pitchingIp / 180
  const largerWorkload = Math.max(battingWorkload, pitchingWorkload)
  const workloadRatio = largerWorkload > 0
    ? Math.min(battingWorkload, pitchingWorkload) / largerWorkload
    : 0
  if (
    battingPa >= 60 &&
    pitchingIp >= 20 &&
    workloadRatio >= 0.25
  ) {
    return 'two_way'
  }
  return hasNonPitcherPosition && battingWorkload >= pitchingWorkload
    ? 'hitter'
    : 'pitcher'
}

function mergePlayerSeasons(
  artifacts: ParsedArtifact[],
): PlayerSeasonRow[] {
  const groups = new Map<
    string,
    { batting?: ValueSeasonRow; pitching?: ValueSeasonRow; knownAt: string[] }
  >()
  for (const artifact of artifacts) {
    if (!artifact.unit.kind.startsWith('season-')) continue
    for (const row of artifact.rows as ValueSeasonRow[]) {
      const key = `${row.season}\0${row.bbref_id}`
      const group = groups.get(key) ?? { knownAt: [] }
      if (row.side === 'batting') group.batting = row
      else group.pitching = row
      group.knownAt.push(artifact.sourceRetrievedAt)
      groups.set(key, group)
    }
  }
  const merged: PlayerSeasonRow[] = []
  for (const group of groups.values()) {
    const batting = group.batting
    const pitching = group.pitching
    const primary = batting ?? pitching
    if (!primary) continue
    if (batting && pitching && batting.player_name !== pitching.player_name) {
      throw new StructuralValidationError(
        `Player name conflict for ${primary.bbref_id} in ${primary.season}`,
      )
    }
    if (
      batting?.age !== null &&
      batting?.age !== undefined &&
      pitching?.age !== null &&
      pitching?.age !== undefined &&
      batting.age !== pitching.age
    ) {
      throw new StructuralValidationError(
        `Player age conflict for ${primary.bbref_id} in ${primary.season}`,
      )
    }
    const teams = [...new Set([batting?.team, pitching?.team].filter(Boolean))]
    const position = batting?.position ?? null
    const role = inferSeasonRole({
      battingPa: batting?.b_pa ?? null,
      pitchingIp: pitching?.p_ip_decimal ?? null,
      battingPosition: position,
      hasBattingRow: Boolean(batting),
      hasPitchingRow: Boolean(pitching),
    })
    merged.push({
      bbref_id: primary.bbref_id,
      player_name: primary.player_name,
      season: primary.season,
      season_state:
        primary.season <= LATEST_COMPLETE_SEASON ? 'complete' : 'in_season',
      known_at: [...group.knownAt].sort().at(-1) as string,
      age: batting?.age ?? pitching?.age ?? null,
      team: teams.join(' | ') || null,
      batting_team: batting?.team ?? null,
      pitching_team: pitching?.team ?? null,
      position,
      role,
      b_pa: batting?.b_pa ?? null,
      b_runs_batting: batting?.b_runs_batting ?? null,
      b_runs_baserunning: batting?.b_runs_baserunning ?? null,
      b_runs_double_plays: batting?.b_runs_double_plays ?? null,
      b_runs_fielding: batting?.b_runs_fielding ?? null,
      b_runs_position: batting?.b_runs_position ?? null,
      b_raa: batting?.b_raa ?? null,
      b_waa: batting?.b_waa ?? null,
      b_runs_replacement: batting?.b_runs_replacement ?? null,
      b_rar: batting?.b_rar ?? null,
      b_war: batting?.b_war ?? null,
      b_war_off: batting?.b_war_off ?? null,
      b_war_def: batting?.b_war_def ?? null,
      p_ip: pitching?.p_ip ?? null,
      p_ip_outs: pitching?.p_ip_outs ?? null,
      p_ip_decimal: pitching?.p_ip_decimal ?? null,
      p_games: pitching?.p_games ?? null,
      p_games_started: pitching?.p_games_started ?? null,
      p_runs_allowed: pitching?.p_runs_allowed ?? null,
      p_raa: pitching?.p_raa ?? null,
      p_waa: pitching?.p_waa ?? null,
      p_waa_adjustment: pitching?.p_waa_adjustment ?? null,
      p_rar: pitching?.p_rar ?? null,
      p_war: pitching?.p_war ?? null,
      total_war: (batting?.b_war ?? 0) + (pitching?.p_war ?? 0),
    })
  }
  return merged.sort(
    (left, right) =>
      left.season - right.season || left.bbref_id.localeCompare(right.bbref_id),
  )
}

function mergeHallOfFame(artifacts: ParsedArtifact[]): HallOfFameInducteeRow[] {
  const groups = new Map<
    string,
    { batting?: HallOfFameSideRow; pitching?: HallOfFameSideRow }
  >()
  for (const artifact of artifacts) {
    if (!artifact.unit.kind.startsWith('hof-')) continue
    for (const row of artifact.rows as HallOfFameSideRow[]) {
      const group = groups.get(row.bbref_id) ?? {}
      if (row.side === 'batting') group.batting = row
      else group.pitching = row
      groups.set(row.bbref_id, group)
    }
  }
  const result: HallOfFameInducteeRow[] = []
  for (const [id, group] of groups) {
    const primary = group.batting ?? group.pitching
    if (!primary) continue
    if (
      group.batting &&
      group.pitching &&
      (group.batting.player_name !== group.pitching.player_name ||
        group.batting.year_inducted !== group.pitching.year_inducted)
    ) {
      throw new StructuralValidationError(`HOF register conflict for ${id}`)
    }
    result.push({
      bbref_id: id,
      player_name: primary.player_name,
      year_inducted: primary.year_inducted,
      career_start_year: primary.career_start_year,
      career_end_year: primary.career_end_year,
      position_player: Boolean(group.batting),
      pitcher: Boolean(group.pitching),
      career_b_war: group.batting?.career_war ?? null,
      career_p_war: group.pitching?.career_war ?? null,
      career_pa: group.batting?.career_pa ?? null,
      career_ip: group.pitching?.career_ip ?? null,
      career_ip_outs: group.pitching?.career_ip_outs ?? null,
      career_ip_decimal: group.pitching?.career_ip_decimal ?? null,
    })
  }
  return result.sort((left, right) => left.bbref_id.localeCompare(right.bbref_id))
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  return `${[
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')),
  ].join('\n')}\n`
}

async function readProtocol(rootDir: string): Promise<{
  value: ProtocolLock
  evidence: EvidenceDigest
  permission: EvidenceDigest
}> {
  const protocolPath = path.join(rootDir, PROTOCOL_LOCK_PATH)
  const body = await readFile(protocolPath)
  const value = JSON.parse(body.toString('utf8')) as ProtocolLock
  if (
    value.schemaVersion !== 'baseball-reference-mlb-war-protocol/v1' ||
    value.source !== SOURCE_SLUG ||
    value.parserVersion !== PARSER_VERSION
  ) {
    throw new Error(`Incompatible MLB WAR protocol lock at ${PROTOCOL_LOCK_PATH}`)
  }
  if (
    value.transport.crawlDelayMs < CRAWL_DELAY_MS ||
    value.transport.oneWorker !== true ||
    value.transport.acceptEncoding !== 'identity'
  ) {
    throw new Error('MLB WAR protocol weakens the required acquisition controls')
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
    permission: {
      path: value.permissionEvidence.path,
      sha256: permissionSha,
    },
  }
}

function cacheDirectory(rootDir: string, unit: AcquisitionUnit): string {
  return path.join(
    rootDir,
    'data/raw/baseball-reference-mlb-war/requests',
    requestFingerprint(unit.url),
  )
}

function parsedArtifactPath(rootDir: string, unit: AcquisitionUnit): string {
  return path.join(
    rootDir,
    'data/processed/baseball-reference-mlb-war/pages',
    `${unit.id}.json`,
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
    const payloadExists = await readFile(payloadPath).then(() => true, () => false)
    const manifestExists = await readFile(manifestPath).then(() => true, () => false)
    if (payloadExists || manifestExists) {
      throw new Error(`Partial immutable cache for ${unit.id}; quarantine it manually`)
    }
    return null
  }
  const receipt = JSON.parse(manifestBody) as RequestReceipt
  const expectedFingerprint = requestFingerprint(unit.url)
  if (
    receipt.schemaVersion !== REQUEST_SCHEMA_VERSION ||
    receipt.source !== SOURCE_SLUG ||
    receipt.unitId !== unit.id ||
    receipt.requestFingerprint !== expectedFingerprint ||
    receipt.request.url !== unit.url ||
    receipt.byteLength !== payload.byteLength ||
    receipt.sha256 !== digest(payload) ||
    receipt.permissionEvidence.sha256 !== context.permissionEvidence.sha256 ||
    receipt.protocolLock.sha256 !== context.protocolLock.sha256
  ) {
    throw new Error(`Immutable cache verification failed for ${unit.id}`)
  }
  if (validateStructure) {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(payload)
    parseUnit(html, unit)
  }
  return { receipt, body: payload, cacheStatus: 'verified', liveAttempts: 0 }
}

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries([...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b)))
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
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await throttle(context)
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
        parseUnit(html, unit)
        const retrievedAt = context.now().toISOString()
        const fingerprint = requestFingerprint(unit.url)
        const directory = cacheDirectory(context.rootDir, unit)
        const payloadPath = path.join(directory, 'payload.html')
        const receipt: RequestReceipt = {
          schemaVersion: REQUEST_SCHEMA_VERSION,
          source: SOURCE_SLUG,
          unitId: unit.id,
          kind: unit.kind,
          season: unit.season,
          position: unit.position,
          requestFingerprint: fingerprint,
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
          retrievedAt,
          attemptCount: attempt,
          byteLength: body.byteLength,
          sha256: digest(body),
          mediaType: mediaType || 'text/html',
          payloadPath: path.relative(context.rootDir, payloadPath),
          parserVersionAtAcquisition: PARSER_VERSION,
          permissionEvidence: context.permissionEvidence,
          protocolLock: context.protocolLock,
        }
        await mkdir(directory, { recursive: true })
        const temporaryDirectory = path.join(directory, `.landing-${randomUUID()}`)
        await mkdir(temporaryDirectory)
        try {
          await Promise.all([
            writeFile(path.join(temporaryDirectory, 'payload.html'), body),
            writeFile(
              path.join(temporaryDirectory, 'manifest.json'),
              stableJson(receipt),
            ),
          ])
          await rename(path.join(temporaryDirectory, 'payload.html'), payloadPath)
          await rename(
            path.join(temporaryDirectory, 'manifest.json'),
            path.join(directory, 'manifest.json'),
          )
        } finally {
          await rm(temporaryDirectory, { recursive: true, force: true })
        }
        return {
          receipt,
          body,
          cacheStatus: 'downloaded',
          liveAttempts: attempt,
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

async function readState(
  rootDir: string,
  units: AcquisitionUnit[],
  now: Date,
): Promise<AcquisitionState> {
  const statePath = path.join(rootDir, 'data/raw/baseball-reference-mlb-war/state.json')
  let state: AcquisitionState
  try {
    state = JSON.parse(await readFile(statePath, 'utf8')) as AcquisitionState
    if (state.schemaVersion !== STATE_SCHEMA_VERSION || state.source !== SOURCE_SLUG) {
      throw new Error(`Incompatible MLB WAR state at ${statePath}`)
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    state = {
      schemaVersion: STATE_SCHEMA_VERSION,
      source: SOURCE_SLUG,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      units: [],
    }
  }
  const existing = new Map(state.units.map((unit) => [unit.id, unit]))
  const merged: UnitState[] = []
  for (const unit of units) {
    const prior = existing.get(unit.id)
    if (prior && (prior.url !== unit.url || prior.kind !== unit.kind)) {
      throw new Error(`Acquisition unit definition changed for ${unit.id}`)
    }
    if (prior) {
      merged.push(prior)
    } else {
      merged.push({
        ...unit,
        status: 'pending',
        liveAttempts: 0,
        lastError: null,
        requestFingerprint: requestFingerprint(unit.url),
      })
    }
  }
  const plannedIds = new Set(units.map((unit) => unit.id))
  state.units = [
    ...merged,
    ...state.units
      .filter((unit) => !plannedIds.has(unit.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
  ]
  return state
}

async function writeState(rootDir: string, state: AcquisitionState): Promise<void> {
  await writeAtomic(
    path.join(rootDir, 'data/raw/baseball-reference-mlb-war/state.json'),
    stableJson(state),
  )
}

async function ensureParsedArtifact(
  rootDir: string,
  unit: AcquisitionUnit,
  cache: CacheResult,
): Promise<ParsedArtifact> {
  const filePath = parsedArtifactPath(rootDir, unit)
  try {
    const existing = JSON.parse(await readFile(filePath, 'utf8')) as ParsedArtifact
    if (
      existing.schemaVersion === 'baseball-reference-mlb-war-page/v1' &&
      existing.parserVersion === PARSER_VERSION &&
      existing.sourceRequestSha256 === cache.receipt.sha256 &&
      existing.unit.id === unit.id
    ) {
      return existing
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const html = new TextDecoder('utf-8', { fatal: true }).decode(cache.body)
  const artifact: ParsedArtifact = {
    schemaVersion: 'baseball-reference-mlb-war-page/v1',
    parserVersion: PARSER_VERSION,
    unit,
    sourceRequestSha256: cache.receipt.sha256,
    sourceRetrievedAt: cache.receipt.retrievedAt,
    rows: parseUnit(html, unit),
  }
  await writeAtomic(filePath, stableJson(artifact))
  return artifact
}

async function materialize(
  rootDir: string,
  state: AcquisitionState,
  context: FetchContext,
): Promise<{ manifestPath: string; referenceLockPath: string | null }> {
  const succeeded = state.units.filter((unit) => unit.status === 'succeeded')
  const artifacts: ParsedArtifact[] = []
  const requests: RequestReceipt[] = []
  for (const unit of succeeded) {
    const cache = await verifiedCache(context, unit, false)
    if (!cache) throw new Error(`Succeeded unit ${unit.id} has no immutable cache`)
    artifacts.push(await ensureParsedArtifact(rootDir, unit, cache))
    requests.push(cache.receipt)
  }
  const playerSeasons = mergePlayerSeasons(artifacts)
  const hofInductees = mergeHallOfFame(artifacts)
  const jawsStandards = artifacts
    .filter((artifact) => artifact.unit.kind === 'jaws-standard')
    .flatMap((artifact) => artifact.rows as JawsStandardRow[])
    .sort((left, right) =>
      JAWS_POSITIONS.indexOf(left.position) - JAWS_POSITIONS.indexOf(right.position),
    )
  const outputDirectory = path.join(
    rootDir,
    'data/processed/baseball-reference-mlb-war',
  )
  const outputs: Array<{
    name: string
    path: string
    body: string
    mediaType: string
    rowCount: number
  }> = []
  const addJsonAndCsv = (
    stem: string,
    rows: Array<Record<string, unknown>>,
    columns: string[],
  ) => {
    outputs.push({
      name: `${stem}.json`,
      path: path.join(outputDirectory, `${stem}.json`),
      body: stableJson(rows),
      mediaType: 'application/json',
      rowCount: rows.length,
    })
    outputs.push({
      name: `${stem}.csv`,
      path: path.join(outputDirectory, `${stem}.csv`),
      body: toCsv(rows, columns),
      mediaType: 'text/csv',
      rowCount: rows.length,
    })
  }
  addJsonAndCsv(
    'player_seasons',
    playerSeasons as unknown as Array<Record<string, unknown>>,
    Object.keys(playerSeasons[0] ?? {
      bbref_id: '', player_name: '', season: '', season_state: '', known_at: '',
    }),
  )
  addJsonAndCsv(
    'hof_inductees',
    hofInductees as unknown as Array<Record<string, unknown>>,
    Object.keys(hofInductees[0] ?? {
      bbref_id: '', player_name: '', year_inducted: '',
    }),
  )
  addJsonAndCsv(
    'jaws_standards',
    jawsStandards as unknown as Array<Record<string, unknown>>,
    Object.keys(jawsStandards[0] ?? {
      position: '', label: '', hof_player_count: '', career_war_standard: '',
      peak_seven_war_standard: '', jaws_standard: '', specialized_jaws_standard: '',
      specialized_metric: '',
    }),
  )
  await Promise.all(outputs.map((output) => writeAtomic(output.path, output.body)))
  const seasonUnits = state.units.filter((unit) => unit.season !== null)
  const seasons = [...new Set(seasonUnits.map((unit) => unit.season as number))].sort(
    (a, b) => a - b,
  )
  const complete = state.units.length > 0 && state.units.every((unit) => unit.status === 'succeeded')
  const outputRecords = outputs.map((output) => ({
    path: path.relative(rootDir, output.path),
    mediaType: output.mediaType,
    rowCount: output.rowCount,
    byteLength: Buffer.byteLength(output.body),
    sha256: digest(output.body),
  }))
  const manifest = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    source: SOURCE_SLUG,
    parserVersion: PARSER_VERSION,
    generatedAt: context.now().toISOString(),
    permissionEvidence: context.permissionEvidence,
    protocolLock: context.protocolLock,
    sourceLockIsolation: {
      globalSourceLock: 'data/source-lock.json',
      includedInGlobalSourceLock: false,
    },
    coverage: {
      startSeason: seasons[0] ?? null,
      endSeason: seasons.at(-1) ?? null,
      latestCompleteSeason: LATEST_COMPLETE_SEASON,
      mutableSeasons: seasons.filter((season) => season > LATEST_COMPLETE_SEASON),
      plannedUnits: state.units.length,
      completedUnits: succeeded.length,
      failedUnits: state.units.filter((unit) => unit.status === 'failed').length,
      complete,
    },
    semantics: {
      oneRowPerPlayerSeason: true,
      partialTeamRowsExcluded: true,
      hallOfFameRows: 'actual position-player and pitcher rows only',
      trainingDefaultEndSeason: LATEST_COMPLETE_SEASON,
      inSeasonRows: 'mutable scoring-only snapshots identified by season_state and known_at',
    },
    inputs: requests
      .sort((left, right) => left.unitId.localeCompare(right.unitId))
      .map((request) => ({
        unitId: request.unitId,
        url: request.request.url,
        retrievedAt: request.retrievedAt,
        byteLength: request.byteLength,
        sha256: request.sha256,
        requestManifestPath: path.join(
          path.dirname(request.payloadPath),
          'manifest.json',
        ),
      })),
    outputs: outputRecords,
  }
  const manifestPath = path.join(outputDirectory, 'manifest.json')
  const manifestBody = stableJson(manifest)
  await writeAtomic(manifestPath, manifestBody)
  let referenceLockPath: string | null = null
  if (complete) {
    const referenceLock = {
      schemaVersion: REFERENCE_LOCK_SCHEMA_VERSION,
      source: SOURCE_SLUG,
      createdAt: context.now().toISOString(),
      permissionEvidence: context.permissionEvidence,
      protocolLock: context.protocolLock,
      sourceLockIsolation: {
        globalSourceLock: 'data/source-lock.json',
        globalSourceLockModified: false,
      },
      coverage: manifest.coverage,
      datasetManifest: {
        path: path.relative(rootDir, manifestPath),
        byteLength: Buffer.byteLength(manifestBody),
        sha256: digest(manifestBody),
      },
      inputs: manifest.inputs,
      outputs: outputRecords,
    }
    referenceLockPath = path.join(
      rootDir,
      'data/reference-locks/baseball-reference-mlb-war.json',
    )
    await writeAtomic(referenceLockPath, stableJson(referenceLock))
  }
  return {
    manifestPath: path.relative(rootDir, manifestPath),
    referenceLockPath: referenceLockPath
      ? path.relative(rootDir, referenceLockPath)
      : null,
  }
}

export type ReleaseAcquisitionLock = () => Promise<void>

export async function acquireAcquisitionLock(rootDir: string): Promise<ReleaseAcquisitionLock> {
  const lockPath = path.join(
    rootDir,
    'data/raw/baseball-reference-mlb-war/.acquisition.lock',
  )
  await mkdir(path.dirname(lockPath), { recursive: true })
  let handle
  try {
    handle = await open(lockPath, 'wx')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Another Baseball-Reference MLB WAR acquisition is running')
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
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const log = options.log ?? console.log
  const protocol = await readProtocol(options.rootDir)
  if (
    options.startSeason < protocol.value.coverage.earliestSeason ||
    options.endSeason > protocol.value.coverage.latestAllowedSeason ||
    options.startSeason > options.endSeason
  ) {
    throw new Error(
      `Season range must be ${protocol.value.coverage.earliestSeason}-${protocol.value.coverage.latestAllowedSeason}`,
    )
  }
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > MAX_PAGES_PER_RUN) {
    throw new Error(`max-pages must be an integer from 1 to ${MAX_PAGES_PER_RUN}`)
  }
  const plan = plannedUnits(options.startSeason, options.endSeason)
  const outputDirectory = path.join(
    options.rootDir,
    'data/processed/baseball-reference-mlb-war',
  )
  if (!options.execute) {
    log(
      `Dry run: ${plan.length} pages (${options.startSeason}-${options.endSeason}, including HOF and JAWS); execute will fetch at most ${options.maxPages} uncached pages.`,
    )
    return {
      status: 'dry-run',
      plannedUnits: plan.length,
      completedUnits: 0,
      attemptedPages: 0,
      liveRequests: 0,
      outputDirectory,
      datasetManifestPath: null,
      referenceLockPath: null,
    }
  }
  const release = await acquireAcquisitionLock(options.rootDir)
  try {
    const state = await readState(options.rootDir, plan, now())
    const planIds = new Set(plan.map((unit) => unit.id))
    const context: FetchContext = {
      rootDir: options.rootDir,
      permissionEvidence: protocol.permission,
      protocolLock: protocol.evidence,
      fetchImpl: options.fetchImpl ?? fetch,
      now,
      sleep,
      lastLiveRequestMs: null,
    }
    let attemptedPages = 0
    let liveRequests = 0
    for (const unit of state.units.filter((candidate) => planIds.has(candidate.id))) {
      if (unit.status === 'succeeded') continue
      const cached = await verifiedCache(context, unit)
      if (cached) {
        unit.status = 'succeeded'
        unit.lastError = null
        state.updatedAt = now().toISOString()
        await ensureParsedArtifact(options.rootDir, unit, cached)
        await writeState(options.rootDir, state)
        continue
      }
      if (attemptedPages >= options.maxPages) break
      attemptedPages += 1
      try {
        const result = await fetchAndCache(context, unit)
        liveRequests += result.liveAttempts
        unit.status = 'succeeded'
        unit.liveAttempts += result.liveAttempts
        unit.lastError = null
        await ensureParsedArtifact(options.rootDir, unit, result)
      } catch (error) {
        unit.status = 'failed'
        unit.liveAttempts += MAX_ATTEMPTS
        unit.lastError = error instanceof Error ? error.message : String(error)
        state.updatedAt = now().toISOString()
        await writeState(options.rootDir, state)
        throw error
      }
      state.updatedAt = now().toISOString()
      await writeState(options.rootDir, state)
    }
    const materialized = await materialize(options.rootDir, state, context)
    const completedUnits = state.units.filter((unit) => unit.status === 'succeeded').length
    const complete = state.units.every((unit) => unit.status === 'succeeded')
    return {
      status: complete ? 'complete' : 'partial',
      plannedUnits: state.units.length,
      completedUnits,
      attemptedPages,
      liveRequests,
      outputDirectory,
      datasetManifestPath: materialized.manifestPath,
      referenceLockPath: materialized.referenceLockPath,
    }
  } finally {
    await release()
  }
}

export function parseCliArguments(args: string[]): {
  startSeason: number
  endSeason: number
  maxPages: number
  execute: boolean
} {
  const values: Record<string, string> = {}
  let execute = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--execute') {
      execute = true
      continue
    }
    const match = /^--(start-season|end-season|max-pages)(?:=(.*))?$/.exec(argument)
    if (!match) throw new Error(`Unknown argument: ${argument}`)
    const value = match[2] ?? args[++index]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${match[1]}`)
    }
    values[match[1]] = value
  }
  const integer = (name: string, fallback: number): number => {
    const raw = values[name]
    if (raw === undefined) return fallback
    if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be an integer`)
    return Number(raw)
  }
  const startSeason = integer('start-season', LATEST_COMPLETE_SEASON)
  const endSeason = integer('end-season', startSeason)
  const maxPages = integer('max-pages', DEFAULT_MAX_PAGES)
  if (
    startSeason < EARLIEST_SEASON ||
    endSeason > LATEST_ALLOWED_SEASON ||
    startSeason > endSeason
  ) {
    throw new Error(
      `Season range must be ${EARLIEST_SEASON}-${LATEST_ALLOWED_SEASON}`,
    )
  }
  if (maxPages < 1 || maxPages > MAX_PAGES_PER_RUN) {
    throw new Error(`--max-pages must be an integer from 1 to ${MAX_PAGES_PER_RUN}`)
  }
  return { startSeason, endSeason, maxPages, execute }
}

async function main(): Promise<void> {
  const cli = parseCliArguments(process.argv.slice(2))
  const result = await runBackfill({
    rootDir: process.cwd(),
    ...cli,
  })
  console.log(JSON.stringify(result, null, 2))
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
