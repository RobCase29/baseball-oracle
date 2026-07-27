import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document } }
}

export const SPOTRAC_CONTRACT_LIST_PARSER_VERSION =
  'spotrac-team-contract-list-html/v1' as const

export type SpotracContractListLeagueSlug = 'mlb' | 'nfl' | 'nba' | 'nhl'
export type SpotracContractListLeague = 'MLB' | 'NFL' | 'NBA' | 'NHL'

export interface SpotracContractListRow {
  playerId: string
  playerName: string
  playerUrl: string
  position: string
  sourceTeamCode: string
  sourceStartYear: number
  sourceEndYear: number
  reportedYears: number
}

export interface SpotracParsedContractList {
  parserVersion: typeof SPOTRAC_CONTRACT_LIST_PARSER_VERSION
  sourceUrl: string
  leagueSlug: SpotracContractListLeagueSlug
  league: SpotracContractListLeague
  sourceTeamSlug: string
  sourceTeamCode: string
  sourceTeamLabel: string
  rows: SpotracContractListRow[]
  withheldRows: Array<{
    playerId: string
    playerName: string
    reason: 'invalid_contract_chronology'
  }>
}

export class SpotracContractListParseError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SpotracContractListParseError'
    this.code = code
  }
}

const leagueBySlug: Record<
  SpotracContractListLeagueSlug,
  SpotracContractListLeague
> = {
  mlb: 'MLB',
  nfl: 'NFL',
  nba: 'NBA',
  nhl: 'NHL',
}

const teamPagePattern =
  /^\/(mlb|nfl|nba|nhl)\/contracts\/_\/team\/([a-z0-9]{2,4})\/?$/u
const playerPagePattern =
  /^\/(mlb|nfl|nba|nhl)\/player\/_\/id\/([1-9]\d*)(?:\/[^/?#]+)*\/?$/u

function compactText(value: string | null | undefined): string {
  return (value ?? '').replaceAll(/\s+/gu, ' ').trim()
}

function assertUsableHtml(html: string): void {
  if (html.length < 200 || html.length > 8 * 1024 * 1024) {
    throw new SpotracContractListParseError(
      'invalid_response_size',
      'Spotrac contract-list response size is outside the supported range.',
    )
  }
  const normalized = html.toLocaleLowerCase('en-US')
  if ([
    '403 error',
    'request blocked',
    'update your browser — spotrac',
    "your browser isn't supported",
    'captcha',
  ].some((marker) => normalized.includes(marker))) {
    throw new SpotracContractListParseError(
      'blocked_response',
      'Spotrac returned a block or unsupported-browser page.',
    )
  }
}

export function parseSpotracContractListSourceUrl(sourceUrl: string): {
  canonicalUrl: string
  leagueSlug: SpotracContractListLeagueSlug
  league: SpotracContractListLeague
  sourceTeamSlug: string
} {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    throw new SpotracContractListParseError(
      'invalid_source_url',
      'Spotrac contract-list source URL is invalid.',
    )
  }
  if (
    url.protocol !== 'https:' ||
    !['spotrac.com', 'www.spotrac.com'].includes(
      url.hostname.toLocaleLowerCase('en-US'),
    ) ||
    url.search ||
    url.hash
  ) {
    throw new SpotracContractListParseError(
      'unsupported_source_url',
      'Spotrac contract-list URL must be a query-free HTTPS team page.',
    )
  }
  const match = teamPagePattern.exec(url.pathname)
  if (!match) {
    throw new SpotracContractListParseError(
      'unsupported_source_url',
      'Spotrac contract-list URL is not a supported team page.',
    )
  }
  const leagueSlug = match[1] as SpotracContractListLeagueSlug
  const sourceTeamSlug = match[2]!
  return {
    canonicalUrl:
      `https://www.spotrac.com/${leagueSlug}/contracts/_/team/${sourceTeamSlug}`,
    leagueSlug,
    league: leagueBySlug[leagueSlug],
    sourceTeamSlug,
  }
}

function requiredInteger(
  element: Element,
  selector: string,
  field: string,
): number {
  const value = Number(compactText(element.querySelector(selector)?.textContent))
  if (!Number.isSafeInteger(value)) {
    throw new SpotracContractListParseError(
      'invalid_contract_row',
      `Spotrac ${field} is missing or invalid.`,
    )
  }
  return value
}

function canonicalPlayerUrl(
  href: string,
  expectedLeague: SpotracContractListLeagueSlug,
): { playerUrl: string; playerId: string } {
  const url = new URL(href, 'https://www.spotrac.com')
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.spotrac.com' ||
    url.search ||
    url.hash
  ) {
    throw new SpotracContractListParseError(
      'invalid_player_url',
      'Spotrac contract-list player URL is unsupported.',
    )
  }
  const match = playerPagePattern.exec(url.pathname)
  if (!match || match[1] !== expectedLeague) {
    throw new SpotracContractListParseError(
      'invalid_player_url',
      'Spotrac contract-list player URL does not match the team league.',
    )
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return {
    playerUrl: url.toString(),
    playerId: match[2]!,
  }
}

export function parseSpotracTeamContractList(
  html: string,
  sourceUrl: string,
): SpotracParsedContractList {
  assertUsableHtml(html)
  const source = parseSpotracContractListSourceUrl(sourceUrl)
  const document = new JSDOM(html).window.document
  const teamOption = [
    ...document.querySelectorAll<HTMLOptionElement>(
      'form#filter select[name="team"] option',
    ),
  ].find((option) => option.value === source.sourceTeamSlug)
  if (!teamOption) {
    throw new SpotracContractListParseError(
      'missing_team_filter',
      'Spotrac team filter does not contain the requested team.',
    )
  }
  const teamLabel = compactText(teamOption.textContent)
  const teamLabelMatch = /^([A-Z0-9]{2,4})\s+(.+)$/u.exec(teamLabel)
  if (!teamLabelMatch) {
    throw new SpotracContractListParseError(
      'invalid_team_filter',
      'Spotrac team filter label is invalid.',
    )
  }
  const requiredHeaders = new Set([
    'player_name',
    'position1_abbreviation',
    'team_abbreviation_current',
    'start_year',
    'end_year',
    'length',
  ])
  for (const header of document.querySelectorAll('#table thead th[id]')) {
    requiredHeaders.delete(header.id)
  }
  if (requiredHeaders.size > 0) {
    throw new SpotracContractListParseError(
      'unsupported_table_shape',
      `Spotrac contract list is missing: ${[...requiredHeaders].join(', ')}.`,
    )
  }

  const rowsByPlayerId = new Map<string, SpotracContractListRow>()
  const withheldRows: SpotracParsedContractList['withheldRows'] = []
  for (const row of document.querySelectorAll('#table tbody tr')) {
    const playerLink = row.querySelector<HTMLAnchorElement>('td:first-child a.link')
    const playerName = compactText(playerLink?.textContent)
    if (!playerLink || !playerName) {
      throw new SpotracContractListParseError(
        'invalid_contract_row',
        'Spotrac contract-list row is missing its player identity.',
      )
    }
    const player = canonicalPlayerUrl(playerLink.href, source.leagueSlug)
    const cells = row.querySelectorAll(':scope > td')
    const sourceTeamCode = compactText(
      cells[2]?.querySelector('span')?.textContent,
    ) || compactText(cells[2]?.textContent).split(' ')[0] || ''
    const sourceStartYear = requiredInteger(
      row,
      '.contract-start_year',
      'contract start year',
    )
    const sourceEndYear = requiredInteger(
      row,
      '.contract-end_year',
      'contract end year',
    )
    const reportedYears = requiredInteger(
      row,
      '.contract-length',
      'contract length',
    )
    if (
      sourceTeamCode !== teamLabelMatch[1] ||
      sourceStartYear < 1900 ||
      sourceEndYear > 2200 ||
      sourceStartYear > sourceEndYear ||
      reportedYears < 1 ||
      reportedYears > sourceEndYear - sourceStartYear + 1
    ) {
      withheldRows.push({
        playerId: player.playerId,
        playerName,
        reason: 'invalid_contract_chronology',
      })
      continue
    }
    const parsedRow: SpotracContractListRow = {
      playerId: player.playerId,
      playerName,
      playerUrl: player.playerUrl,
      position: compactText(cells[1]?.textContent),
      sourceTeamCode,
      sourceStartYear,
      sourceEndYear,
      reportedYears,
    }
    const existing = rowsByPlayerId.get(player.playerId)
    if (
      existing &&
      (
        existing.playerName !== parsedRow.playerName ||
        existing.sourceTeamCode !== parsedRow.sourceTeamCode
      )
    ) {
      throw new SpotracContractListParseError(
        'conflicting_player_rows',
        `Spotrac contract rows conflict for player ${player.playerId}.`,
      )
    }
    if (
      !existing ||
      parsedRow.sourceEndYear > existing.sourceEndYear ||
      (
        parsedRow.sourceEndYear === existing.sourceEndYear &&
        parsedRow.sourceStartYear > existing.sourceStartYear
      )
    ) {
      rowsByPlayerId.set(player.playerId, parsedRow)
    }
  }
  const rows = [...rowsByPlayerId.values()]
  if (rows.length === 0) {
    throw new SpotracContractListParseError(
      'empty_contract_list',
      'Spotrac team contract list contained no player rows.',
    )
  }
  return {
    parserVersion: SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
    sourceUrl: source.canonicalUrl,
    leagueSlug: source.leagueSlug,
    league: source.league,
    sourceTeamSlug: source.sourceTeamSlug,
    sourceTeamCode: teamLabelMatch[1],
    sourceTeamLabel: teamLabelMatch[2],
    rows,
    withheldRows,
  }
}
