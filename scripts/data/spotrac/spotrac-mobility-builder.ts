import { createHash } from 'node:crypto'
import type {
  PlayerMobilityArtifact,
  PlayerMobilityArtifactRow,
  PlayerMobilityLeague,
  PlayerMobilitySource,
} from '../../../src/domain/playerMobilityContext.js'
import {
  mobilityWindowFor,
  playerMobilityArtifactContentValue,
  playerMobilityPageSetValue,
} from '../../../src/domain/playerMobilityContext.js'
import {
  normalizeSubjectSearchText,
} from '../../../src/domain/subjectSearch.js'
import {
  IT_FACTOR_EXPECTED_TEAMS,
  type ItFactorTeam,
} from '../it-factor/teams.js'
import type {
  SpotracContractListLeagueSlug,
  SpotracParsedContractList,
} from './spotrac-contract-list-parser.js'
import {
  SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
} from './spotrac-contract-list-parser.js'

export const SPOTRAC_MOBILITY_BUILDER_VERSION =
  'spotrac-team-runway-normalizer/v1' as const

type SupportedDomain = 'baseball' | 'football' | 'basketball' | 'hockey'

interface LeagueConfiguration {
  leagueSlug: SpotracContractListLeagueSlug
  league: PlayerMobilityLeague
  domain: SupportedDomain
}

export interface SpotracAcquisitionUnit extends LeagueConfiguration {
  sourceTeamSlug: string
  sourceTeamCode: string
  canonicalTeam: ItFactorTeam
  url: string
}

export interface HobbyIdentityRow {
  sourceKey: string
  subjectName: string
  subjectType: string
  domain: string
}

export interface HobbyMobilityIdentityEvidence {
  gemRateSourceKey: string
  evidenceSourceId: string
  identityStatus:
    | 'verified_player_bridge'
    | 'reviewed_player_bridge'
    | 'reviewed_name_team'
  teamCode: string | null
}

export interface SpotracSourceChainInput {
  permissionEvidence: {
    path: string
    sha256: string
  }
  robotsPolicy: {
    url: string
    sha256: string
  }
  runId: string
  runManifestPath: string
  runManifestSha256: string
  pages: Array<{
    sourceUrl: string
    contentSha256: string
  }>
}

export interface SpotracTeamPageCoverage {
  league: PlayerMobilityLeague
  teamCode: string
  sourceUrl: string
  parsedRows: number
  withheldRows: number
  totalRows: number
}

export interface SpotracMobilityMatchCoverage {
  sourceContractRows: number
  observedRows: number
  uniqueNormalizedNameMatches: number
  uniqueCompactNameMatches: number
  existingReviewedSupplementMatches: number
  verifiedCurrentIdentityMatches: number
  reviewedCurrentIdentityMatches: number
  reviewedNameTeamMatches: number
  blockedIdentitySourceRows: number
  identityEvidenceWithheldSourceRows: number
  unmatchedSourceRows: number
  ambiguousSourceRows: number
  structurallyWithheldSourceRows: number
  staleTermSourceRows: number
}

export interface SpotracMobilityBuildResult {
  artifact: PlayerMobilityArtifact
  matching: SpotracMobilityMatchCoverage
}

const leagueConfigurations: readonly LeagueConfiguration[] = [
  {
    leagueSlug: 'mlb',
    league: 'MLB',
    domain: 'baseball',
  },
  {
    leagueSlug: 'nfl',
    league: 'NFL',
    domain: 'football',
  },
  {
    leagueSlug: 'nba',
    league: 'NBA',
    domain: 'basketball',
  },
  {
    leagueSlug: 'nhl',
    league: 'NHL',
    domain: 'hockey',
  },
]

const MINIMUM_TEAM_PAGE_ROWS: Readonly<Record<PlayerMobilityLeague, number>> = {
  MLB: 20,
  NFL: 60,
  NBA: 10,
  NHL: 15,
}

const MAXIMUM_TOTAL_COVERAGE_DECLINE = 0.15
const MAXIMUM_TEAM_COVERAGE_DECLINE = 0.25

const sourceTeamCodeOverrides: Partial<Record<
  PlayerMobilityLeague,
  Readonly<Record<string, string>>
>> = {
  MLB: { CWS: 'CHW' },
  NHL: { WSH: 'WAS' },
}

function sourceTeamCodeFor(
  league: PlayerMobilityLeague,
  canonicalCode: string,
): string {
  return sourceTeamCodeOverrides[league]?.[canonicalCode] ?? canonicalCode
}

export function spotracAcquisitionPlan(): SpotracAcquisitionUnit[] {
  return leagueConfigurations.flatMap((configuration) => (
    IT_FACTOR_EXPECTED_TEAMS[configuration.domain].map((canonicalTeam) => {
      const sourceTeamCode = sourceTeamCodeFor(
        configuration.league,
        canonicalTeam.code,
      )
      const sourceTeamSlug = sourceTeamCode.toLocaleLowerCase('en-US')
      return {
        ...configuration,
        sourceTeamSlug,
        sourceTeamCode,
        canonicalTeam,
        url:
          `https://www.spotrac.com/${configuration.leagueSlug}` +
          `/contracts/_/team/${sourceTeamSlug}`,
      }
    })
  ))
}

function compactIdentityName(value: string): string {
  return normalizeSubjectSearchText(value).replaceAll(' ', '')
}

function indexValues<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) {
    const bucketKey = key(value)
    const bucket = result.get(bucketKey)
    if (bucket) bucket.push(value)
    else result.set(bucketKey, [value])
  }
  return result
}

function contentHash(
  artifact: Pick<
    PlayerMobilityArtifact,
    'dataThrough' | 'coverage' | 'sourceChain' | 'sources' | 'rows'
  >,
): string {
  return createHash('sha256')
    .update(playerMobilityArtifactContentValue(artifact))
    .digest('hex')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value)
}

function dateParts(value: string): {
  year: number
  month: number
  day: number
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) throw new Error(`Invalid dataThrough date: ${value}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid dataThrough date: ${value}`)
  }
  return { year, month, day }
}

function currentLeagueSeason(
  league: PlayerMobilityLeague,
  dataThrough: string,
): {
  currentSourceSeasonYear: number
  currentSeasonEndYear: number
  currentSeasonLabel: string
} {
  const { year, month } = dateParts(dataThrough)
  if (league === 'MLB') {
    return {
      currentSourceSeasonYear: year,
      currentSeasonEndYear: year,
      currentSeasonLabel: String(year),
    }
  }
  if (league === 'NFL') {
    // January and February still belong to the season that began last year.
    const seasonYear = month <= 2 ? year - 1 : year
    return {
      currentSourceSeasonYear: seasonYear,
      currentSeasonEndYear: seasonYear,
      currentSeasonLabel: String(seasonYear),
    }
  }
  // NBA and NHL league years turn over in July. The source end-year column
  // stores the season's starting year, while the product stores its end year.
  const seasonStartYear = month >= 7 ? year : year - 1
  return {
    currentSourceSeasonYear: seasonStartYear,
    currentSeasonEndYear: seasonStartYear + 1,
    currentSeasonLabel:
      `${seasonStartYear}-${String(seasonStartYear + 1).slice(-2)}`,
  }
}

function sourceChainFor(
  sourceChain: SpotracSourceChainInput,
  expectedUrls: ReadonlySet<string>,
): NonNullable<PlayerMobilityArtifact['sourceChain']> {
  if (
    !sourceChain.runId.trim() ||
    !sourceChain.runManifestPath.trim() ||
    !isSha256(sourceChain.runManifestSha256) ||
    !sourceChain.permissionEvidence.path.trim() ||
    !isSha256(sourceChain.permissionEvidence.sha256) ||
    !sourceChain.robotsPolicy.url.startsWith('https://') ||
    !isSha256(sourceChain.robotsPolicy.sha256) ||
    sourceChain.pages.length !== expectedUrls.size ||
    new Set(sourceChain.pages.map((page) => page.sourceUrl)).size !==
      sourceChain.pages.length ||
    sourceChain.pages.some((page) => (
      !expectedUrls.has(page.sourceUrl) ||
      !isSha256(page.contentSha256)
    ))
  ) {
    throw new Error('Spotrac source-chain evidence is incomplete or invalid.')
  }
  const pageDigests = sourceChain.pages
    .map((page) => ({
      sourceUrl: page.sourceUrl,
      contentSha256: page.contentSha256,
    }))
    .toSorted((left, right) => (
      left.sourceUrl.localeCompare(right.sourceUrl, 'en-US')
    ))
  return {
    normalizerVersion: SPOTRAC_MOBILITY_BUILDER_VERSION,
    parserVersion: SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
    permissionEvidence: { ...sourceChain.permissionEvidence },
    robotsPolicy: { ...sourceChain.robotsPolicy },
    run: {
      id: sourceChain.runId,
      manifestPath: sourceChain.runManifestPath,
      manifestSha256: sourceChain.runManifestSha256,
    },
    pages: {
      count: pageDigests.length,
      setSha256: sha256(playerMobilityPageSetValue(pageDigests)),
      items: pageDigests,
    },
  }
}

function seasonReference(
  league: PlayerMobilityLeague,
  sourceEndYear: number,
): { seasonEndYear: number; label: string } {
  if (league === 'NBA' || league === 'NHL') {
    return {
      seasonEndYear: sourceEndYear + 1,
      label:
        `${sourceEndYear}-${String(sourceEndYear + 1).slice(-2)} season`,
    }
  }
  return {
    seasonEndYear: sourceEndYear,
    label: `${sourceEndYear} season`,
  }
}

function nextDecisionReference(
  league: PlayerMobilityLeague,
  through: { seasonEndYear: number; label: string },
): { seasonEndYear: number; label: string } {
  if (league === 'NBA' || league === 'NHL') {
    return {
      seasonEndYear: through.seasonEndYear,
      label: `${through.seasonEndYear} offseason`,
    }
  }
  return {
    seasonEndYear: through.seasonEndYear + 1,
    label: `${through.seasonEndYear + 1} offseason`,
  }
}

function matchingSupplement(
  existingBySourceKey: ReadonlyMap<string, PlayerMobilityArtifactRow>,
  independentSupplementSourceIds: ReadonlySet<string>,
  gemRateSourceKey: string,
  league: PlayerMobilityLeague,
  teamCode: string,
  throughYear: number,
): PlayerMobilityArtifactRow | null {
  const existing = existingBySourceKey.get(gemRateSourceKey)
  if (
    !existing ||
    existing.provenance.identityStatus === 'unique_source_name_bridge' ||
    !existing.sourceIds.some((id) => independentSupplementSourceIds.has(id)) ||
    existing.league !== league ||
    existing.currentTeam?.code !== teamCode ||
    existing.term?.reportedThrough?.seasonEndYear !== throughYear
  ) {
    return null
  }
  return existing
}

function isSpotracSnapshotSource(source: PlayerMobilitySource): boolean {
  return (
    source.id === 'spotrac-team-contract-lists' ||
    source.id.startsWith('spotrac-team-contract-lists-')
  )
}

type IdentityEvidenceTier =
  | 'existing_reviewed_supplement'
  | 'verified_current_identity'
  | 'reviewed_current_identity'
  | 'reviewed_name_team'

function identityEvidenceTier(
  evidence: readonly HobbyMobilityIdentityEvidence[],
  teamCode: string,
  hasReviewedSupplement: boolean,
): IdentityEvidenceTier | null {
  if (hasReviewedSupplement) return 'existing_reviewed_supplement'
  if (evidence.some((row) => (
    row.identityStatus === 'verified_player_bridge' &&
    row.teamCode === null
  ))) {
    return 'verified_current_identity'
  }
  if (evidence.some((row) => (
    row.identityStatus === 'reviewed_player_bridge' &&
    row.teamCode === null
  ))) {
    return 'reviewed_current_identity'
  }
  if (evidence.some((row) => (
    row.identityStatus === 'reviewed_name_team' &&
    row.teamCode === teamCode
  ))) {
    return 'reviewed_name_team'
  }
  return null
}

function validateIdentityEvidence(
  evidence: readonly HobbyMobilityIdentityEvidence[],
  hobbySourceKeys: ReadonlySet<string>,
): Map<string, HobbyMobilityIdentityEvidence[]> {
  const result = new Map<string, HobbyMobilityIdentityEvidence[]>()
  const uniqueEvidenceKeys = new Set<string>()
  for (const row of evidence) {
    if (
      !hobbySourceKeys.has(row.gemRateSourceKey) ||
      !row.evidenceSourceId.trim() ||
      (
        row.identityStatus !== 'verified_player_bridge' &&
        row.identityStatus !== 'reviewed_player_bridge' &&
        row.identityStatus !== 'reviewed_name_team'
      ) ||
      (
        row.identityStatus === 'reviewed_name_team'
          ? !row.teamCode?.trim()
          : row.teamCode !== null
      )
    ) {
      throw new Error('Invalid current-player identity evidence.')
    }
    const uniqueKey = [
      row.gemRateSourceKey,
      row.evidenceSourceId,
      row.identityStatus,
      row.teamCode ?? '',
    ].join('|')
    if (uniqueEvidenceKeys.has(uniqueKey)) {
      throw new Error(`Duplicate identity evidence: ${uniqueKey}`)
    }
    uniqueEvidenceKeys.add(uniqueKey)
    const bucket = result.get(row.gemRateSourceKey)
    if (bucket) bucket.push(row)
    else result.set(row.gemRateSourceKey, [row])
  }
  return result
}

function validateTeamPageCoverage(
  teamPages: readonly SpotracTeamPageCoverage[],
  existingArtifact: PlayerMobilityArtifact,
): void {
  for (const page of teamPages) {
    const minimum = MINIMUM_TEAM_PAGE_ROWS[page.league]
    if (
      page.totalRows < minimum ||
      page.parsedRows + page.withheldRows !== page.totalRows ||
      (
        page.totalRows > 0 &&
        page.withheldRows / page.totalRows > 0.25
      )
    ) {
      throw new Error(
        `Spotrac team page coverage is incomplete for ` +
        `${page.league} ${page.teamCode}: ${page.totalRows} rows.`,
      )
    }
  }

  const previousTotal =
    existingArtifact.coverage.identityMatching?.sourceContractRows
  const currentTotal = teamPages.reduce(
    (sum, page) => sum + page.totalRows,
    0,
  )
  if (
    previousTotal &&
    currentTotal <
      Math.floor(previousTotal * (1 - MAXIMUM_TOTAL_COVERAGE_DECLINE))
  ) {
    throw new Error(
      `Spotrac total coverage regressed materially from ` +
      `${previousTotal} to ${currentTotal} rows.`,
    )
  }

  const previousByPage = new Map(
    (existingArtifact.coverage.teamPages ?? []).map((page) => (
      [`${page.league}|${page.teamCode}`, page]
    )),
  )
  for (const page of teamPages) {
    const previous = previousByPage.get(`${page.league}|${page.teamCode}`)
    if (
      previous &&
      page.totalRows <
        Math.floor(
          previous.totalRows * (1 - MAXIMUM_TEAM_COVERAGE_DECLINE),
        )
    ) {
      throw new Error(
        `Spotrac team coverage regressed materially for ` +
        `${page.league} ${page.teamCode}: ` +
        `${previous.totalRows} to ${page.totalRows} rows.`,
      )
    }
  }
}

export function buildSpotracMobilityArtifact(input: {
  parsedLists: readonly SpotracParsedContractList[]
  hobbyRows: readonly HobbyIdentityRow[]
  identityEvidence: readonly HobbyMobilityIdentityEvidence[]
  blockedIdentityKeys: readonly string[]
  existingArtifact: PlayerMobilityArtifact
  sourceChain: SpotracSourceChainInput
  generatedAt: string
  dataThrough: string
  accessedAt: string
}): SpotracMobilityBuildResult {
  const plan = spotracAcquisitionPlan()
  const unitByUrl = new Map(plan.map((unit) => [unit.url, unit]))
  const expectedUrls = new Set(plan.map((unit) => unit.url))
  if (
    input.parsedLists.length !== plan.length ||
    new Set(input.parsedLists.map((list) => list.sourceUrl)).size !==
      input.parsedLists.length ||
    input.parsedLists.some((list) => (
      !expectedUrls.has(list.sourceUrl) ||
      list.parserVersion !== SPOTRAC_CONTRACT_LIST_PARSER_VERSION
    ))
  ) {
    throw new Error(
      `Spotrac build requires all ${plan.length} unique team contract lists.`,
    )
  }
  const sourceChain = sourceChainFor(input.sourceChain, expectedUrls)
  const teamPages: SpotracTeamPageCoverage[] = input.parsedLists.map((list) => ({
    league: list.league,
    teamCode: list.sourceTeamCode,
    sourceUrl: list.sourceUrl,
    parsedRows: list.rows.length,
    withheldRows: list.withheldRows.length,
    totalRows: list.rows.length + list.withheldRows.length,
  })).toSorted((left, right) => (
    left.sourceUrl.localeCompare(right.sourceUrl, 'en-US')
  ))
  validateTeamPageCoverage(teamPages, input.existingArtifact)

  const sourceRows: Array<{
    playerId: string
    playerName: string
    playerUrl: string
    league: PlayerMobilityLeague
    domain: SupportedDomain
    canonicalTeam: ItFactorTeam
    sourceStartYear: number
    sourceEndYear: number
  }> = []
  let structurallyWithheldSourceRows = 0
  let staleTermSourceRows = 0
  const sourcePlayerKeys = new Set<string>()
  for (const list of input.parsedLists) {
    const unit = unitByUrl.get(list.sourceUrl)
    if (
      !unit ||
      unit.league !== list.league ||
      unit.sourceTeamSlug !== list.sourceTeamSlug ||
      unit.sourceTeamCode !== list.sourceTeamCode
    ) {
      throw new Error(`Spotrac team identity drift at ${list.sourceUrl}.`)
    }
    structurallyWithheldSourceRows += list.withheldRows.length
    const currentSeason = currentLeagueSeason(list.league, input.dataThrough)
    for (const row of list.rows) {
      if (
        seasonReference(list.league, row.sourceEndYear).seasonEndYear <
          currentSeason.currentSeasonEndYear
      ) {
        staleTermSourceRows += 1
        continue
      }
      const sourcePlayerKey = `${list.league}|${row.playerId}`
      if (sourcePlayerKeys.has(sourcePlayerKey)) {
        throw new Error(
          `Spotrac player ${sourcePlayerKey} appears on multiple team pages.`,
        )
      }
      sourcePlayerKeys.add(sourcePlayerKey)
      sourceRows.push({
        playerId: row.playerId,
        playerName: row.playerName,
        playerUrl: row.playerUrl,
        league: list.league,
        domain: unit.domain,
        canonicalTeam: unit.canonicalTeam,
        sourceStartYear: row.sourceStartYear,
        sourceEndYear: row.sourceEndYear,
      })
    }
  }

  const hobbyRows = input.hobbyRows.filter((row) => (
    row.subjectType === 'athlete' &&
    (
      row.domain === 'baseball' ||
      row.domain === 'football' ||
      row.domain === 'basketball' ||
      row.domain === 'hockey'
    )
  ))
  const hobbySourceKeys = new Set(hobbyRows.map((row) => row.sourceKey))
  const blockedIdentityKeys = new Set(input.blockedIdentityKeys)
  if (
    blockedIdentityKeys.size !== input.blockedIdentityKeys.length ||
    [...blockedIdentityKeys].some((sourceKey) => (
      !sourceKey.startsWith('athlete|')
    ))
  ) {
    throw new Error('Blocked mobility identity keys are invalid.')
  }
  const evidenceByHobbyKey = validateIdentityEvidence(
    input.identityEvidence,
    hobbySourceKeys,
  )
  const existingBySourceKey = new Map(
    input.existingArtifact.rows.map((row) => [row.gemRateSourceKey, row]),
  )
  const independentSupplementSourceIds = new Set(
    input.existingArtifact.sources
      .filter((source) => !isSpotracSnapshotSource(source))
      .map((source) => source.id),
  )
  const hobbyExact = indexValues(
    hobbyRows,
    (row) => `${row.domain}|${normalizeSubjectSearchText(row.subjectName)}`,
  )
  const hobbyCompact = indexValues(
    hobbyRows,
    (row) => `${row.domain}|${compactIdentityName(row.subjectName)}`,
  )
  const sourceExact = indexValues(
    sourceRows,
    (row) => `${row.domain}|${normalizeSubjectSearchText(row.playerName)}`,
  )
  const sourceCompact = indexValues(
    sourceRows,
    (row) => `${row.domain}|${compactIdentityName(row.playerName)}`,
  )

  const matched: Array<{
    source: (typeof sourceRows)[number]
    hobby: HobbyIdentityRow
    method: 'unique_normalized_name' | 'unique_compact_name'
    identityTier: IdentityEvidenceTier
    supplement: PlayerMobilityArtifactRow | null
  }> = []
  let ambiguousSourceRows = 0
  let blockedIdentitySourceRows = 0
  let identityEvidenceWithheldSourceRows = 0
  for (const source of sourceRows) {
    const exactKey =
      `${source.domain}|${normalizeSubjectSearchText(source.playerName)}`
    const exactHobby = hobbyExact.get(exactKey) ?? []
    const exactSource = sourceExact.get(exactKey) ?? []
    let hobby: HobbyIdentityRow | null = null
    let method: 'unique_normalized_name' | 'unique_compact_name' | null = null
    if (exactHobby.length === 1 && exactSource.length === 1) {
      hobby = exactHobby[0]!
      method = 'unique_normalized_name'
    }
    let compactHobby: HobbyIdentityRow[] = []
    let compactSource: (typeof sourceRows) = []
    if (!hobby) {
      const compactKey =
        `${source.domain}|${compactIdentityName(source.playerName)}`
      compactHobby = hobbyCompact.get(compactKey) ?? []
      compactSource = sourceCompact.get(compactKey) ?? []
      if (compactHobby.length === 1 && compactSource.length === 1) {
        hobby = compactHobby[0]!
        method = 'unique_compact_name'
      }
    }
    if (
      !hobby &&
      (
        exactHobby.length > 1 ||
        exactSource.length > 1 ||
        compactHobby.length > 1 ||
        compactSource.length > 1
      )
    ) {
      ambiguousSourceRows += 1
    }
    if (!hobby || !method) continue
    if (blockedIdentityKeys.has(hobby.sourceKey)) {
      blockedIdentitySourceRows += 1
      continue
    }
    const through = seasonReference(source.league, source.sourceEndYear)
    const supplement = matchingSupplement(
      existingBySourceKey,
      independentSupplementSourceIds,
      hobby.sourceKey,
      source.league,
      source.canonicalTeam.code,
      through.seasonEndYear,
    )
    const identityTier = identityEvidenceTier(
      evidenceByHobbyKey.get(hobby.sourceKey) ?? [],
      source.canonicalTeam.code,
      Boolean(supplement),
    )
    if (!identityTier) {
      identityEvidenceWithheldSourceRows += 1
      continue
    }
    matched.push({
      source,
      hobby,
      method,
      identityTier,
      supplement,
    })
  }
  const matchesByHobbyKey = indexValues(matched, (value) => value.hobby.sourceKey)
  const uniqueMatches = matched.filter(
    (value) => matchesByHobbyKey.get(value.hobby.sourceKey)?.length === 1,
  )
  ambiguousSourceRows += matched.length - uniqueMatches.length

  const sourceId = 'spotrac-team-contract-lists'
  const spotracSource = {
    id: sourceId,
    label: 'Spotrac active team contracts',
    publisher: 'Spotrac',
    url: 'https://www.spotrac.com',
    publishedAt: null,
    accessedAt: input.accessedAt,
    kind: 'authorized',
  } satisfies PlayerMobilitySource
  const supplementalSourceIds = new Set<string>()
  const rows = uniqueMatches.map((match): PlayerMobilityArtifactRow => {
    const currentSeason = currentLeagueSeason(
      match.source.league,
      input.dataThrough,
    )
    const through = seasonReference(
      match.source.league,
      match.source.sourceEndYear,
    )
    const decisionSeason = nextDecisionReference(match.source.league, through)
    const supplement = match.supplement
    const termStatus = supplement?.term?.status ?? 'under_contract'
    const remainingSeasonsIncludingCurrent = Math.max(
      0,
      through.seasonEndYear - currentSeason.currentSeasonEndYear + 1,
    )
    const currentYearTeamListOnly =
      !supplement && remainingSeasonsIncludingCurrent <= 1
    const nextDecision = currentYearTeamListOnly
      ? null
      : supplement?.nextDecision ?? {
          kind: 'unknown' as const,
          season: decisionSeason,
          label: `Contract term concludes after the ${through.label}`,
        }
    const mobilityWindow = mobilityWindowFor(
      currentSeason.currentSeasonEndYear,
      nextDecision?.season?.seasonEndYear ?? null,
      termStatus,
      nextDecision?.kind === 'unknown'
        ? remainingSeasonsIncludingCurrent
        : undefined,
    )
    const supplementalIds = (supplement?.sourceIds ?? []).filter(
      (id) => independentSupplementSourceIds.has(id),
    )
    supplementalIds.forEach((id) => supplementalSourceIds.add(id))
    const lastTeamChange = supplement?.lastTeamChange ?? null
    const reasonCodes = [
      mobilityWindow === 'unavailable'
        ? 'reported_term_not_verified_mobility_decision'
        : mobilityWindow === 'three_plus_seasons'
          ? 'long_reported_contract_term'
          : 'reported_contract_decision_window',
      supplement
        ? 'supplemental_player_terms_reviewed'
        : 'team_list_term_only_detail_not_enriched',
      match.method,
      match.identityTier,
      'future_move_direction_depends_on_destination',
      ...(lastTeamChange
        ? ['historical_team_change_context_only']
        : []),
    ]
    return {
      gemRateSourceKey: match.hobby.sourceKey,
      playerName: match.hobby.subjectName,
      sourceIds: [sourceId, ...supplementalIds],
      availability: 'observed',
      asOf: input.dataThrough,
      league: match.source.league,
      currentTeam: match.source.canonicalTeam,
      teamTenureStart: supplement?.teamTenureStart ?? null,
      term: {
        status: termStatus,
        kind: supplement?.term?.kind ?? 'standard',
        currentSeasonEndYear: currentSeason.currentSeasonEndYear,
        currentSeasonLabel: currentSeason.currentSeasonLabel,
        reportedThrough: through,
        guaranteedThrough: supplement?.term?.guaranteedThrough ?? null,
        maximumTeamControlThrough:
          supplement?.term?.status === 'team_control'
            ? supplement.term.maximumTeamControlThrough
            : null,
        remainingSeasonsIncludingCurrent,
        options: supplement?.term?.options ?? [],
      },
      nextDecision,
      mobilityWindow,
      reasonCodes,
      lastTeamChange,
      provenance: {
        sourceId: 'spotrac',
        sourcePlayerId: match.source.playerId,
        sourceUrl: match.source.playerUrl,
        accessedAt: input.accessedAt,
        identityStatus: 'reviewed_bridge',
      },
      semantics: {
        contextOnly: true,
        directionalClaim: false,
        interpretation: 'opportunity_or_disruption',
      },
    }
  }).toSorted((left, right) => (
    left.gemRateSourceKey.localeCompare(right.gemRateSourceKey, 'en-US')
  ))

  const supplementalSources = input.existingArtifact.sources.filter(
    (source) => (
      source.id !== sourceId &&
      supplementalSourceIds.has(source.id)
    ),
  )
  const sources = [
    spotracSource,
    ...supplementalSources,
  ].toSorted((left, right) => left.id.localeCompare(right.id, 'en-US'))
  const matching: SpotracMobilityMatchCoverage = {
    sourceContractRows: teamPages.reduce(
      (sum, page) => sum + page.totalRows,
      0,
    ),
    observedRows: rows.length,
    uniqueNormalizedNameMatches: uniqueMatches.filter(
      (match) => match.method === 'unique_normalized_name',
    ).length,
    uniqueCompactNameMatches: uniqueMatches.filter(
      (match) => match.method === 'unique_compact_name',
    ).length,
    existingReviewedSupplementMatches: uniqueMatches.filter(
      (match) => match.identityTier === 'existing_reviewed_supplement',
    ).length,
    verifiedCurrentIdentityMatches: uniqueMatches.filter(
      (match) => match.identityTier === 'verified_current_identity',
    ).length,
    reviewedCurrentIdentityMatches: uniqueMatches.filter(
      (match) => match.identityTier === 'reviewed_current_identity',
    ).length,
    reviewedNameTeamMatches: uniqueMatches.filter(
      (match) => match.identityTier === 'reviewed_name_team',
    ).length,
    blockedIdentitySourceRows,
    identityEvidenceWithheldSourceRows,
    unmatchedSourceRows:
      teamPages.reduce((sum, page) => sum + page.totalRows, 0) -
      uniqueMatches.length,
    ambiguousSourceRows,
    structurallyWithheldSourceRows,
    staleTermSourceRows,
  }
  const byLeague: Record<PlayerMobilityLeague, number> = {
    MLB: rows.filter((row) => row.league === 'MLB').length,
    NFL: rows.filter((row) => row.league === 'NFL').length,
    NBA: rows.filter((row) => row.league === 'NBA').length,
    NHL: rows.filter((row) => row.league === 'NHL').length,
  }
  const artifactWithoutHash = {
    schemaVersion: 'hobby-player-mobility.v1' as const,
    generatedAt: input.generatedAt,
    dataThrough: input.dataThrough,
    coverage: {
      observedRows: rows.length,
      byLeague,
      identityMatching: matching,
      teamPages,
      limitations: [
        'Spotrac team lists provide reported contract term and current team; guarantees, options, and free-agent type require a reviewed player-page or official-source supplement.',
        `${matching.observedRows} of ${matching.sourceContractRows} source rows were linked through a unique same-sport name plus verified current-player, reviewed current-player, reviewed name-and-team, or existing reviewed supplement evidence; ${matching.blockedIdentitySourceRows} explicitly blocked aggregate identities and ${matching.identityEvidenceWithheldSourceRows} otherwise unique names lacking current-player evidence were withheld.`,
        `${matching.structurallyWithheldSourceRows} structurally invalid and ${matching.staleTermSourceRows} already-expired term rows plus ambiguous and unmatched names are withheld.`,
        'A team-list term ending in the current season is preserved as a factual salary-list term, but no near-term mobility decision or window is inferred without an enriched source.',
        'Contract term is neutral mobility context and never changes Build, Breakout, Graduation, IT, or Exit scores.',
      ],
    },
    sourceChain,
    sources,
    rows,
  }
  const artifact = {
    ...artifactWithoutHash,
    contentSha256: contentHash(artifactWithoutHash),
  }
  return { artifact, matching }
}
