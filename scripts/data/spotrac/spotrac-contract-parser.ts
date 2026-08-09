import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document } }
}

export const SPOTRAC_CONTRACT_PARSER_VERSION =
  'spotrac-player-contract-html/v1' as const

export const SPOTRAC_PLAYER_URL_PATTERN =
  /^\/(mlb|nfl|nba|nhl)\/player\/_\/id\/([1-9]\d*)(?:\/[^/?#]+)*(?:\/)?$/u

export type SpotracLeagueSlug = 'mlb' | 'nfl' | 'nba' | 'nhl'
export type SpotracLeague = 'MLB' | 'NFL' | 'NBA' | 'NHL'
export type SpotracContractKind =
  | 'extension'
  | 'free_agent'
  | 'rookie'
  | 'pre_arbitration'
  | 'arbitration'
  | 'renegotiation'
  | 'other'
export type SpotracOptionType =
  | 'club'
  | 'player'
  | 'mutual'
  | 'vesting'
  | 'opt_out'
export type SpotracFreeAgencyType =
  | 'UFA'
  | 'RFA'
  | 'ERFA'
  | 'OTHER'
export type SpotracNextDecisionKind =
  | 'club_option'
  | 'player_option'
  | 'mutual_option'
  | 'vesting_option'
  | 'opt_out'
  | 'unrestricted_free_agency'
  | 'restricted_free_agency'
  | 'exclusive_rights_free_agency'
  | 'unknown'

export interface SpotracPlayerContractParseInput {
  html: string
  sourceUrl: string
  /**
   * The year Spotrac uses to label the active league season. For example,
   * MLB/NFL 2026 use 2026, while the 2025-26 NBA/NHL season uses 2025.
   */
  currentLeagueSeasonYear: number
}

export interface SpotracParsedOption {
  year: number
  type: SpotracOptionType
  sourceText: string
  pendingRelativeToCurrentSeason: boolean
}

export interface SpotracParsedContract {
  parserVersion: typeof SPOTRAC_CONTRACT_PARSER_VERSION
  source: {
    url: string
    leagueSlug: SpotracLeagueSlug
    playerId: string
  }
  league: SpotracLeague
  player: {
    id: string
    name: string
  }
  team: {
    name: string
    sourceSlug: string | null
    sourceCode: string | null
  }
  contract: {
    current: true
    heading: string
    kind: SpotracContractKind
    kindLabel: string
    startYear: number
    throughYear: number
    reportedYears: number
    options: SpotracParsedOption[]
  }
  freeAgency: {
    year: number
    type: SpotracFreeAgencyType
    sourceText: string
  }
  nextDecision: {
    kind: SpotracNextDecisionKind
    year: number
    label: string
  }
}

export class SpotracContractParseError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SpotracContractParseError'
    this.code = code
  }
}

interface ParsedSourceUrl {
  canonicalUrl: string
  leagueSlug: SpotracLeagueSlug
  league: SpotracLeague
  playerId: string
}

interface ContractHeading {
  element: Element
  text: string
  startYear: number
  throughYear: number
  kindLabel: string
  current: boolean
}

const leagueBySlug: Record<SpotracLeagueSlug, SpotracLeague> = {
  mlb: 'MLB',
  nfl: 'NFL',
  nba: 'NBA',
  nhl: 'NHL',
}

function compactText(value: string | null | undefined): string {
  return (value ?? '').replaceAll(/\s+/gu, ' ').trim()
}

function parseSourceUrl(value: string): ParsedSourceUrl {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SpotracContractParseError(
      'invalid_source_url',
      'Spotrac source URL is invalid.',
    )
  }
  const hostname = url.hostname.toLocaleLowerCase('en-US')
  if (url.protocol !== 'https:' || (
    hostname !== 'spotrac.com' &&
    hostname !== 'www.spotrac.com'
  )) {
    throw new SpotracContractParseError(
      'unsupported_source_url',
      'Spotrac source URL must use HTTPS on spotrac.com.',
    )
  }
  const match = SPOTRAC_PLAYER_URL_PATTERN.exec(url.pathname)
  if (!match) {
    throw new SpotracContractParseError(
      'unsupported_source_url',
      'Spotrac source URL is not a supported player page.',
    )
  }
  const leagueSlug = match[1] as SpotracLeagueSlug
  url.protocol = 'https:'
  url.hostname = 'www.spotrac.com'
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return {
    canonicalUrl: url.toString(),
    leagueSlug,
    league: leagueBySlug[leagueSlug],
    playerId: match[2]!,
  }
}

export function parseSpotracPlayerSourceUrl(
  value: string,
): Readonly<ParsedSourceUrl> {
  return parseSourceUrl(value)
}

function assertUsableHtml(html: string): void {
  if (html.length < 200 || html.length > 8 * 1024 * 1024) {
    throw new SpotracContractParseError(
      'invalid_response_size',
      'Spotrac response size is outside the supported parser contract.',
    )
  }
  const lower = html.toLocaleLowerCase('en-US')
  const blockedMarkers = [
    '403 error',
    'request blocked',
    'update your browser — spotrac',
    "your browser isn't supported",
    'captcha',
  ]
  if (blockedMarkers.some((marker) => lower.includes(marker))) {
    throw new SpotracContractParseError(
      'blocked_response',
      'Spotrac returned a block or unsupported-browser page.',
    )
  }
}

function playerNameFrom(document: Document): string {
  const explicit = document.querySelector<HTMLElement>(
    '[data-spotrac-player-name]',
  )?.dataset.spotracPlayerName
  if (compactText(explicit)) return compactText(explicit)

  const heading = compactText(document.querySelector('h1')?.textContent)
  if (heading) return heading.replace(/^Image\s+/iu, '').trim()

  const title = compactText(document.title)
  const fromTitle = title.split(/\s+\|\s+/u)[0]
  if (fromTitle && !/^spotrac$/iu.test(fromTitle)) return fromTitle
  throw new SpotracContractParseError(
    'missing_player_name',
    'Spotrac player name could not be located.',
  )
}

function headingDetails(element: Element): ContractHeading | null {
  const visibleText = compactText(element.textContent)
    .replace(/^Image:\s*/iu, '')
  const imageAlt = compactText(
    element.querySelector<HTMLImageElement>('img[alt]')?.alt,
  )
  const explicit = element.hasAttribute('data-spotrac-contract-heading')
  if (
    !explicit &&
    !/Team signed with/iu.test(visibleText) &&
    !/Team signed with/iu.test(imageAlt)
  ) {
    return null
  }
  const text = /Team signed with/iu.test(visibleText)
    ? visibleText
    : `Team signed with ${visibleText}`
  const years = /\b((?:19|20|21)\d{2})(?:\s*-\s*((?:19|20|21)\d{2}))?\b/u
    .exec(text)
  if (!years) return null
  const startYear = Number(years[1])
  const throughYear = Number(years[2] ?? years[1])
  const remainder = text
    .slice((years.index ?? 0) + years[0].length)
    .replace(/\((?:CURRENT|UPCOMING EXTENSION)\)/giu, '')
    .trim()
  return {
    element,
    text,
    startYear,
    throughYear,
    kindLabel: remainder || 'Other',
    current: /\(CURRENT\)/iu.test(text),
  }
}

function currentContractHeading(document: Document): ContractHeading {
  const candidates = [...document.querySelectorAll(
    'h2, h3, h4, [data-spotrac-contract-heading]',
  )]
    .map(headingDetails)
    .filter((value): value is ContractHeading => value !== null)
  if (candidates.length === 0) {
    throw new SpotracContractParseError(
      'missing_current_contract',
      'No Spotrac contract heading was found.',
    )
  }
  if (candidates.length === 1) return candidates[0]!

  const explicitlyCurrent = candidates.filter(
    (candidate) => candidate.current,
  )
  if (explicitlyCurrent.length === 1) return explicitlyCurrent[0]!

  throw new SpotracContractParseError(
    'ambiguous_current_contract',
    explicitlyCurrent.length === 0
      ? 'Multiple Spotrac contract headings were found without one explicit current marker.'
      : 'Multiple Spotrac contract headings claim to be current.',
  )
}

function relevantHeadingCount(element: Element): number {
  return [...element.querySelectorAll(
    'h2, h3, h4, [data-spotrac-contract-heading]',
  )].filter((heading) => headingDetails(heading) !== null).length
}

function contractContainer(
  document: Document,
  heading: ContractHeading,
): Element {
  let cursor: Element | null = heading.element
  let fallback: Element | null = null
  while (cursor && cursor !== document.body) {
    const text = compactText(cursor.textContent)
    if (/Contract Terms:/iu.test(text) && /Free Agent:/iu.test(text)) {
      fallback = cursor
      if (relevantHeadingCount(cursor) === 1) return cursor
    }
    cursor = cursor.parentElement
  }
  return fallback ?? document.body
}

function labelValue(container: Element, label: string): string | null {
  const normalizedLabel = label.replace(/:$/u, '').toLocaleLowerCase('en-US')
  const candidates = [...container.querySelectorAll(
    'dt, th, strong, b, span, div, p',
  )]
  for (const candidate of candidates) {
    const text = compactText(candidate.textContent)
      .replace(/:$/u, '')
      .toLocaleLowerCase('en-US')
    if (text !== normalizedLabel) continue
    const sibling = candidate.nextElementSibling
    const siblingText = compactText(sibling?.textContent)
    if (siblingText) return siblingText
    const parentChildren = candidate.parentElement
      ? [...candidate.parentElement.children]
      : []
    const index = parentChildren.indexOf(candidate)
    const nextText = compactText(parentChildren[index + 1]?.textContent)
    if (nextText) return nextText
  }
  const text = compactText(container.textContent)
  if (normalizedLabel === 'contract terms') {
    return /Contract Terms:\s*(\d+\s*yr\(s\)\s*\/\s*[^ ]+)/iu
      .exec(text)?.[1] ?? null
  }
  if (normalizedLabel === 'free agent') {
    return /Free Agent:\s*((?:19|20|21)\d{2}\s*\/\s*[A-Z]+)/u
      .exec(text)?.[1] ?? null
  }
  return null
}

function contractKind(label: string): SpotracContractKind {
  const normalized = label.toLocaleLowerCase('en-US')
  if (normalized.includes('renegotiation')) return 'renegotiation'
  if (normalized.includes('extension')) return 'extension'
  if (normalized.includes('free agent')) return 'free_agent'
  if (normalized.includes('rookie')) return 'rookie'
  if (normalized.includes('pre-arbitration')) return 'pre_arbitration'
  if (normalized.includes('arbitration')) return 'arbitration'
  return 'other'
}

function teamFrom(
  document: Document,
  heading: ContractHeading,
  leagueSlug: SpotracLeagueSlug,
  playerName: string,
): SpotracParsedContract['team'] {
  const explicit = document.querySelector<HTMLElement>('[data-spotrac-team]')
  if (explicit) {
    const name = compactText(explicit.dataset.spotracTeam) ||
      compactText(explicit.textContent)
    if (name) {
      return {
        name,
        sourceSlug: compactText(explicit.dataset.spotracTeamSlug) || null,
        sourceCode: compactText(explicit.dataset.spotracTeamCode) || null,
      }
    }
  }

  for (
    const script of document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    )
  ) {
    let parsed: unknown
    try {
      parsed = JSON.parse(script.textContent ?? '')
    } catch {
      continue
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    for (const candidate of candidates) {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        !('@type' in candidate) ||
        candidate['@type'] !== 'Person' ||
        !('memberOf' in candidate) ||
        !candidate.memberOf ||
        typeof candidate.memberOf !== 'object' ||
        !('name' in candidate.memberOf) ||
        typeof candidate.memberOf.name !== 'string'
      ) {
        continue
      }
      const description = (
        'description' in candidate &&
        typeof candidate.description === 'string'
      )
        ? candidate.description
        : ''
      return {
        name: compactText(candidate.memberOf.name),
        sourceSlug: null,
        sourceCode:
          /\(([A-Z0-9]{2,4})\)\s*$/u.exec(description)?.[1] ?? null,
      }
    }
  }

  const h1 = document.querySelector('h1')
  let playerRegion: Element | null = h1
  while (
    playerRegion?.parentElement &&
    playerRegion.parentElement !== document.body
  ) {
    const parentText = compactText(playerRegion.parentElement.textContent)
    if (
      parentText.includes(playerName) &&
      /Age:/u.test(parentText) &&
      !/Contract Terms:/u.test(parentText)
    ) {
      playerRegion = playerRegion.parentElement
      break
    }
    playerRegion = playerRegion.parentElement
  }
  const regions = [playerRegion, heading.element.parentElement, document.body]
    .filter((value): value is Element => value !== null)
  for (const region of regions) {
    const anchors = [...region.querySelectorAll<HTMLAnchorElement>('a[href]')]
    for (const anchor of anchors) {
      const text = compactText(anchor.textContent)
      if (!text || text === playerName || /Team signed with/iu.test(text)) {
        continue
      }
      let href: URL
      try {
        href = new URL(anchor.href, 'https://www.spotrac.com')
      } catch {
        continue
      }
      const parts = href.pathname.split('/').filter(Boolean)
      if (
        parts[0]?.toLocaleLowerCase('en-US') !== leagueSlug ||
        parts[1] === 'player'
      ) {
        continue
      }
      return {
        name: text,
        sourceSlug: parts[1] ?? null,
        sourceCode:
          compactText(anchor.dataset.teamCode) ||
          compactText(anchor.getAttribute('data-abbr')) ||
          null,
      }
    }
  }

  const bodyText = compactText(document.body.textContent)
  const escapedName = playerName.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(
    `${escapedName}\\s+([A-Z][A-Za-z .'-]+?),\\s+[^,]+?\\s+Age:`,
    'u',
  ).exec(bodyText)
  if (match?.[1]) {
    return {
      name: compactText(match[1]),
      sourceSlug: null,
      sourceCode: null,
    }
  }
  throw new SpotracContractParseError(
    'missing_current_team',
    'Spotrac current team could not be located.',
  )
}

function parseOptions(
  container: Element,
  currentLeagueSeasonYear: number,
): SpotracParsedOption[] {
  const text = compactText(container.textContent)
  const results: SpotracParsedOption[] = []
  const patterns: Array<{
    expression: RegExp
    type: SpotracOptionType
  }> = [
    {
      expression: /\b((?:19|20|21)\d{2})\s+(?:Club|Team)\s+Option\b/giu,
      type: 'club',
    },
    {
      expression: /\b((?:19|20|21)\d{2})\s+Player\s+Option\b/giu,
      type: 'player',
    },
    {
      expression: /\b((?:19|20|21)\d{2})\s+Mutual\s+Option\b/giu,
      type: 'mutual',
    },
    {
      expression: /\b((?:19|20|21)\d{2})\s+(?:Conditional\s+)?Vesting\s+Option\b/giu,
      type: 'vesting',
    },
    {
      expression: /\b((?:19|20|21)\d{2})\s+(?:Conditional\s+)?Opt[- ]?Out\b/giu,
      type: 'opt_out',
    },
  ]
  for (const { expression, type } of patterns) {
    for (const match of text.matchAll(expression)) {
      const year = Number(match[1])
      results.push({
        year,
        type,
        sourceText: compactText(match[0]),
        pendingRelativeToCurrentSeason: year > currentLeagueSeasonYear,
      })
    }
  }
  const unique = new Map<string, SpotracParsedOption>()
  for (const option of results) {
    unique.set(`${option.year}|${option.type}`, option)
  }
  return [...unique.values()].toSorted((left, right) => (
    left.year - right.year || left.type.localeCompare(right.type, 'en-US')
  ))
}

function freeAgencyType(value: string): SpotracFreeAgencyType {
  const normalized = value.trim().toLocaleUpperCase('en-US')
  if (normalized === 'UFA') return 'UFA'
  if (normalized === 'RFA') return 'RFA'
  if (normalized === 'ERFA') return 'ERFA'
  return 'OTHER'
}

function nextDecisionFor(
  options: readonly SpotracParsedOption[],
  freeAgency: SpotracParsedContract['freeAgency'],
): SpotracParsedContract['nextDecision'] {
  const pendingOption = options.find(
    (option) => option.pendingRelativeToCurrentSeason,
  )
  if (pendingOption) {
    const kindByType: Record<SpotracOptionType, SpotracNextDecisionKind> = {
      club: 'club_option',
      player: 'player_option',
      mutual: 'mutual_option',
      vesting: 'vesting_option',
      opt_out: 'opt_out',
    }
    const labelByType: Record<SpotracOptionType, string> = {
      club: 'Club option',
      player: 'Player option',
      mutual: 'Mutual option',
      vesting: 'Vesting option',
      opt_out: 'Opt-out',
    }
    return {
      kind: kindByType[pendingOption.type],
      year: pendingOption.year,
      label: `${labelByType[pendingOption.type]} for ${pendingOption.year}`,
    }
  }
  const kindByType: Record<SpotracFreeAgencyType, SpotracNextDecisionKind> = {
    UFA: 'unrestricted_free_agency',
    RFA: 'restricted_free_agency',
    ERFA: 'exclusive_rights_free_agency',
    OTHER: 'unknown',
  }
  return {
    kind: kindByType[freeAgency.type],
    year: freeAgency.year,
    label:
      freeAgency.type === 'OTHER'
        ? `Free-agent status in ${freeAgency.year}`
        : `${freeAgency.type} in ${freeAgency.year}`,
  }
}

export function parseSpotracPlayerContract(
  input: SpotracPlayerContractParseInput,
): SpotracParsedContract {
  assertUsableHtml(input.html)
  if (
    !Number.isSafeInteger(input.currentLeagueSeasonYear) ||
    input.currentLeagueSeasonYear < 1900 ||
    input.currentLeagueSeasonYear > 2200
  ) {
    throw new SpotracContractParseError(
      'invalid_current_season',
      'Current league season year is invalid.',
    )
  }
  const source = parseSourceUrl(input.sourceUrl)
  const document = new JSDOM(input.html).window.document
  const playerName = playerNameFrom(document)
  const heading = currentContractHeading(document)
  const container = contractContainer(document, heading)
  const team = teamFrom(
    document,
    heading,
    source.leagueSlug,
    playerName,
  )
  const terms = labelValue(container, 'Contract Terms:')
  const reportedYears = Number(
    /(\d+)\s*yr\(s\)/iu.exec(terms ?? '')?.[1],
  )
  if (!Number.isSafeInteger(reportedYears) || reportedYears < 1) {
    throw new SpotracContractParseError(
      'invalid_contract_terms',
      'Spotrac current contract term could not be parsed.',
    )
  }
  if (
    heading.startYear > heading.throughYear ||
    reportedYears > heading.throughYear - heading.startYear + 1
  ) {
    throw new SpotracContractParseError(
      'invalid_contract_chronology',
      'Spotrac current contract years do not reconcile.',
    )
  }
  const freeAgentText = labelValue(container, 'Free Agent:')
  const freeAgentMatch =
    /\b((?:19|20|21)\d{2})\s*\/\s*([A-Z]+)\b/u.exec(
      freeAgentText ?? '',
    )
  if (!freeAgentMatch) {
    throw new SpotracContractParseError(
      'invalid_free_agency',
      'Spotrac free-agent term could not be parsed.',
    )
  }
  const freeAgency = {
    year: Number(freeAgentMatch[1]),
    type: freeAgencyType(freeAgentMatch[2]!),
    sourceText: compactText(freeAgentMatch[0]),
  } satisfies SpotracParsedContract['freeAgency']
  if (freeAgency.year < heading.throughYear) {
    throw new SpotracContractParseError(
      'invalid_contract_chronology',
      'Spotrac free-agent year predates the contract term.',
    )
  }
  const options = parseOptions(container, input.currentLeagueSeasonYear)
  return {
    parserVersion: SPOTRAC_CONTRACT_PARSER_VERSION,
    source: {
      url: source.canonicalUrl,
      leagueSlug: source.leagueSlug,
      playerId: source.playerId,
    },
    league: source.league,
    player: {
      id: source.playerId,
      name: playerName,
    },
    team,
    contract: {
      current: true,
      heading: heading.text,
      kind: contractKind(heading.kindLabel),
      kindLabel: heading.kindLabel,
      startYear: heading.startYear,
      throughYear: heading.throughYear,
      reportedYears,
      options,
    },
    freeAgency,
    nextDecision: nextDecisionFor(options, freeAgency),
  }
}
