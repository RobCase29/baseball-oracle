export const PLAYER_MOBILITY_SCHEMA_VERSION =
  'hobby-player-mobility.v1' as const

export const PLAYER_MOBILITY_WINDOWS = [
  'open_now',
  'after_current_season',
  'within_two_seasons',
  'three_plus_seasons',
  'unavailable',
] as const

export const PLAYER_MOBILITY_AVAILABILITIES = [
  'observed',
  'unavailable',
  'withheld_identity',
  'not_applicable',
] as const

export type PlayerMobilityAvailability =
  (typeof PLAYER_MOBILITY_AVAILABILITIES)[number]
export type PlayerMobilityWindow =
  (typeof PLAYER_MOBILITY_WINDOWS)[number]
export type PlayerMobilityLeague = 'MLB' | 'NFL' | 'NBA' | 'NHL'

const PLAYER_MOBILITY_TERM_STATUSES = [
  'under_contract',
  'team_control',
  'restricted_free_agent',
  'unrestricted_free_agent',
  'unsigned',
  'unknown',
] as const

const PLAYER_MOBILITY_TERM_KINDS = [
  'standard',
  'extension',
  'rookie_scale',
  'entry_level',
  'pre_arbitration',
  'arbitration',
  'franchise_tag',
  'two_way',
  'other',
] as const

const PLAYER_MOBILITY_OPTION_TYPES = [
  'club',
  'player',
  'mutual',
  'vesting',
  'opt_out',
] as const

const PLAYER_MOBILITY_DECISION_KINDS = [
  'unrestricted_free_agency',
  'restricted_free_agency',
  'club_option',
  'player_option',
  'mutual_option',
  'vesting_option',
  'opt_out',
  'non_guarantee',
  'arbitration',
  'extension_eligibility',
  'unknown',
] as const

const PLAYER_MOBILITY_CHANGE_KINDS = [
  'trade',
  'free_agent_signing',
  'waiver',
  'other',
] as const

const PLAYER_MOBILITY_IDENTITY_STATUSES = [
  'verified_external_id',
  'reviewed_bridge',
  'unique_source_name_bridge',
  'withheld',
  'not_applicable',
] as const

type PlayerMobilityTermStatus =
  (typeof PLAYER_MOBILITY_TERM_STATUSES)[number]
type PlayerMobilityTermKind =
  (typeof PLAYER_MOBILITY_TERM_KINDS)[number]
type PlayerMobilityOptionType =
  (typeof PLAYER_MOBILITY_OPTION_TYPES)[number]
type PlayerMobilityDecisionKind =
  (typeof PLAYER_MOBILITY_DECISION_KINDS)[number]

export interface MobilitySeasonReference {
  seasonEndYear: number
  label: string
}

export interface PlayerMobilityTerm {
  status: PlayerMobilityTermStatus
  kind: PlayerMobilityTermKind
  currentSeasonEndYear: number
  currentSeasonLabel: string
  reportedThrough: MobilitySeasonReference | null
  guaranteedThrough: MobilitySeasonReference | null
  maximumTeamControlThrough: MobilitySeasonReference | null
  remainingSeasonsIncludingCurrent: number | null
  options: Array<{
    season: MobilitySeasonReference
    type: PlayerMobilityOptionType
    status: 'pending'
  }>
}

export interface PlayerMobilityContext {
  availability: PlayerMobilityAvailability
  asOf: string | null
  league: PlayerMobilityLeague | null
  currentTeam: {
    code: string
    name: string
  } | null
  teamTenureStart: string | null
  term: PlayerMobilityTerm | null
  nextDecision: {
    kind: PlayerMobilityDecisionKind
    season: MobilitySeasonReference | null
    label: string
  } | null
  mobilityWindow: PlayerMobilityWindow
  reasonCodes: string[]
  lastTeamChange: {
    effectiveAt: string
    kind: 'trade' | 'free_agent_signing' | 'waiver' | 'other'
    fromTeam: {
      code: string
      name: string
    } | null
    toTeam: {
      code: string
      name: string
    }
  } | null
  provenance: {
    sourceId: string | null
    sourcePlayerId: string | null
    sourceUrl: string | null
    accessedAt: string | null
    identityStatus:
      | 'verified_external_id'
      | 'reviewed_bridge'
      | 'unique_source_name_bridge'
      | 'withheld'
      | 'not_applicable'
  }
  semantics: {
    contextOnly: true
    directionalClaim: false
    interpretation: 'opportunity_or_disruption'
  }
}

export interface PlayerMobilitySource {
  id: string
  label: string
  publisher: string
  url: string
  publishedAt: string | null
  accessedAt: string
  kind: 'official' | 'licensed' | 'authorized'
}

export interface PlayerMobilityArtifactRow extends PlayerMobilityContext {
  availability: 'observed'
  gemRateSourceKey: string
  playerName: string
  sourceIds: string[]
}

export interface PlayerMobilityArtifact {
  schemaVersion: typeof PLAYER_MOBILITY_SCHEMA_VERSION
  generatedAt: string
  dataThrough: string
  coverage: {
    observedRows: number
    byLeague: Record<PlayerMobilityLeague, number>
    identityMatching?: {
      sourceContractRows: number
      observedRows: number
      uniqueNormalizedNameMatches: number
      uniqueCompactNameMatches: number
      existingReviewedSupplementMatches?: number
      verifiedCurrentIdentityMatches?: number
      reviewedCurrentIdentityMatches?: number
      reviewedNameTeamMatches?: number
      blockedIdentitySourceRows?: number
      identityEvidenceWithheldSourceRows?: number
      unmatchedSourceRows: number
      ambiguousSourceRows: number
      structurallyWithheldSourceRows: number
      staleTermSourceRows: number
    }
    teamPages?: Array<{
      league: PlayerMobilityLeague
      teamCode: string
      sourceUrl: string
      parsedRows: number
      withheldRows: number
      totalRows: number
    }>
    limitations: string[]
  }
  sourceChain?: {
    normalizerVersion: string
    parserVersion: string
    permissionEvidence: {
      path: string
      sha256: string
    }
    robotsPolicy: {
      url: string
      sha256: string
    }
    run: {
      id: string
      manifestPath: string
      manifestSha256: string
    }
    pages: {
      count: number
      setSha256: string
      items: Array<{
        sourceUrl: string
        contentSha256: string
      }>
    }
  }
  sources: PlayerMobilitySource[]
  rows: PlayerMobilityArtifactRow[]
  contentSha256: string
}

export function playerMobilityArtifactContentValue(
  artifact: Pick<
    PlayerMobilityArtifact,
    'dataThrough' | 'coverage' | 'sourceChain' | 'sources' | 'rows'
  >,
): string {
  // Preserve validation of the initial v1 artifact while the source-chain
  // extension rolls forward. Every newly generated Spotrac artifact carries
  // sourceChain and therefore uses the complete, lineage-aware payload.
  if (artifact.sourceChain === undefined) {
    return JSON.stringify({
      sources: artifact.sources,
      rows: artifact.rows,
    })
  }
  return JSON.stringify({
    dataThrough: artifact.dataThrough,
    coverage: artifact.coverage,
    sourceChain: artifact.sourceChain,
    sources: artifact.sources,
    rows: artifact.rows,
  })
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value)
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(input)
  padded[input.length] = 0x80
  const bitLength = input.length * 8
  const paddedView = new DataView(padded.buffer)
  paddedView.setUint32(
    paddedLength - 8,
    Math.floor(bitLength / 0x1_0000_0000),
  )
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0)

  const state = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4)
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!
      const previous2 = words[index - 2]!
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3)
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10)
      words[index] = (
        words[index - 16]! +
        sigma0 +
        words[index - 7]! +
        sigma1
      ) >>> 0
    }

    let a = state[0]!
    let b = state[1]!
    let c = state[2]!
    let d = state[3]!
    let e = state[4]!
    let f = state[5]!
    let g = state[6]!
    let h = state[7]!
    for (let index = 0; index < 64; index += 1) {
      const sum1 =
        rotateRight(e, 6) ^
        rotateRight(e, 11) ^
        rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 = (
        h +
        sum1 +
        choice +
        SHA256_ROUND_CONSTANTS[index]! +
        words[index]!
      ) >>> 0
      const sum0 =
        rotateRight(a, 2) ^
        rotateRight(a, 13) ^
        rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    state[0] = (state[0]! + a) >>> 0
    state[1] = (state[1]! + b) >>> 0
    state[2] = (state[2]! + c) >>> 0
    state[3] = (state[3]! + d) >>> 0
    state[4] = (state[4]! + e) >>> 0
    state[5] = (state[5]! + f) >>> 0
    state[6] = (state[6]! + g) >>> 0
    state[7] = (state[7]! + h) >>> 0
  }
  return [...state]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('')
}

export function playerMobilityPageSetValue(
  items: readonly {
    sourceUrl: string
    contentSha256: string
  }[],
): string {
  return JSON.stringify(items)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value))
  )
}

function isNullableIsoDate(value: unknown): value is string | null {
  return value === null || isIsoDate(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isSeasonReference(
  value: unknown,
): value is MobilitySeasonReference {
  if (!isRecord(value)) return false
  return (
    Number.isSafeInteger(value.seasonEndYear) &&
    (value.seasonEndYear as number) >= 1900 &&
    (value.seasonEndYear as number) <= 2200 &&
    typeof value.label === 'string' &&
    value.label.trim().length > 0
  )
}

export function mobilityWindowFor(
  currentSeasonEndYear: number,
  nextDecisionSeasonEndYear: number | null,
  status: PlayerMobilityTerm['status'],
  remainingSeasonsIncludingCurrent?: number | null,
): PlayerMobilityWindow {
  if (
    status === 'restricted_free_agent' ||
    status === 'unrestricted_free_agent' ||
    status === 'unsigned'
  ) {
    return 'open_now'
  }
  if (
    !Number.isSafeInteger(currentSeasonEndYear) ||
    nextDecisionSeasonEndYear === null ||
    !Number.isSafeInteger(nextDecisionSeasonEndYear)
  ) {
    return 'unavailable'
  }
  if (
    remainingSeasonsIncludingCurrent !== undefined &&
    remainingSeasonsIncludingCurrent !== null &&
    Number.isSafeInteger(remainingSeasonsIncludingCurrent)
  ) {
    if (remainingSeasonsIncludingCurrent <= 1) {
      return 'after_current_season'
    }
    if (remainingSeasonsIncludingCurrent === 2) {
      return 'within_two_seasons'
    }
    return 'three_plus_seasons'
  }
  const seasonsUntilDecision =
    nextDecisionSeasonEndYear - currentSeasonEndYear
  if (seasonsUntilDecision <= 1) return 'after_current_season'
  if (seasonsUntilDecision === 2) return 'within_two_seasons'
  return 'three_plus_seasons'
}

export function unavailablePlayerMobilityContext(
  availability: Exclude<PlayerMobilityAvailability, 'observed'>,
  reasonCode: string,
): PlayerMobilityContext {
  return {
    availability,
    asOf: null,
    league: null,
    currentTeam: null,
    teamTenureStart: null,
    term: null,
    nextDecision: null,
    mobilityWindow: 'unavailable',
    reasonCodes: [reasonCode],
    lastTeamChange: null,
    provenance: {
      sourceId: null,
      sourcePlayerId: null,
      sourceUrl: null,
      accessedAt: null,
      identityStatus:
        availability === 'not_applicable'
          ? 'not_applicable'
          : 'withheld',
    },
    semantics: {
      contextOnly: true,
      directionalClaim: false,
      interpretation: 'opportunity_or_disruption',
    },
  }
}

function isObservedMobilityRow(
  value: unknown,
  sourceIds: ReadonlySet<string>,
  lineageAwareTermWindows: boolean,
): value is PlayerMobilityArtifactRow {
  if (
    !isRecord(value) ||
    value.availability !== 'observed' ||
    typeof value.gemRateSourceKey !== 'string' ||
    !value.gemRateSourceKey.startsWith('athlete|') ||
    typeof value.playerName !== 'string' ||
    value.playerName.trim().length === 0 ||
    !isIsoDate(value.asOf) ||
    (
      value.league !== 'MLB' &&
      value.league !== 'NFL' &&
      value.league !== 'NBA' &&
      value.league !== 'NHL'
    ) ||
    !isRecord(value.term) ||
    (
      value.nextDecision !== null &&
      !isRecord(value.nextDecision)
    ) ||
    !PLAYER_MOBILITY_WINDOWS.includes(
      value.mobilityWindow as PlayerMobilityWindow,
    ) ||
    !Array.isArray(value.reasonCodes) ||
    !value.reasonCodes.every(isNonEmptyString) ||
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length === 0 ||
    !value.sourceIds.every((sourceId) => (
      typeof sourceId === 'string' && sourceIds.has(sourceId)
    )) ||
    !isRecord(value.provenance) ||
    (
      value.provenance.identityStatus !== 'verified_external_id' &&
      value.provenance.identityStatus !== 'reviewed_bridge' &&
      value.provenance.identityStatus !== 'unique_source_name_bridge'
    ) ||
    !isRecord(value.semantics) ||
    value.semantics.contextOnly !== true ||
    value.semantics.directionalClaim !== false ||
    value.semantics.interpretation !== 'opportunity_or_disruption'
  ) {
    return false
  }
  const term = value.term
  if (
    !isStringEnum(term.status, PLAYER_MOBILITY_TERM_STATUSES) ||
    !isStringEnum(term.kind, PLAYER_MOBILITY_TERM_KINDS) ||
    !Number.isSafeInteger(term.currentSeasonEndYear) ||
    (term.currentSeasonEndYear as number) < 1900 ||
    (term.currentSeasonEndYear as number) > 2200 ||
    !isNonEmptyString(term.currentSeasonLabel) ||
    !Array.isArray(term.options) ||
    (
      term.reportedThrough !== null &&
      !isSeasonReference(term.reportedThrough)
    ) ||
    (
      term.guaranteedThrough !== null &&
      !isSeasonReference(term.guaranteedThrough)
    ) ||
    (
      term.maximumTeamControlThrough !== null &&
      !isSeasonReference(term.maximumTeamControlThrough)
    ) ||
    (
      term.remainingSeasonsIncludingCurrent !== null &&
      (
        !Number.isSafeInteger(term.remainingSeasonsIncludingCurrent) ||
        (term.remainingSeasonsIncludingCurrent as number) < 0
      )
    ) ||
    !term.options.every((option) => (
      isRecord(option) &&
      isSeasonReference(option.season) &&
      isStringEnum(option.type, PLAYER_MOBILITY_OPTION_TYPES) &&
      option.status === 'pending'
    ))
  ) {
    return false
  }
  const currentSeasonEndYear = term.currentSeasonEndYear as number
  const reportedThrough = isSeasonReference(term.reportedThrough)
    ? term.reportedThrough
    : null
  const guaranteedThrough = isSeasonReference(term.guaranteedThrough)
    ? term.guaranteedThrough
    : null
  const maximumTeamControlThrough = isSeasonReference(
    term.maximumTeamControlThrough,
  )
    ? term.maximumTeamControlThrough
    : null
  const isCurrentTerm = (
    term.status === 'under_contract' ||
    term.status === 'team_control'
  )
  const isOpenStatus = (
    term.status === 'restricted_free_agent' ||
    term.status === 'unrestricted_free_agent' ||
    term.status === 'unsigned'
  )
  if (
    (
      value.currentTeam !== null &&
      (
        !isRecord(value.currentTeam) ||
        !isNonEmptyString(value.currentTeam.code) ||
        !isNonEmptyString(value.currentTeam.name)
      )
    ) ||
    (value.currentTeam === null && !isOpenStatus) ||
    !isNullableIsoDate(value.teamTenureStart) ||
    (
      value.teamTenureStart !== null &&
      Date.parse(value.teamTenureStart) > Date.parse(value.asOf as string)
    ) ||
    (
      isCurrentTerm &&
      reportedThrough === null &&
      maximumTeamControlThrough === null
    ) ||
    (
      isCurrentTerm &&
      reportedThrough !== null &&
      reportedThrough.seasonEndYear < currentSeasonEndYear
    ) ||
    (
      isCurrentTerm &&
      guaranteedThrough !== null &&
      guaranteedThrough.seasonEndYear < currentSeasonEndYear
    ) ||
    (
      isCurrentTerm &&
      maximumTeamControlThrough !== null &&
      maximumTeamControlThrough.seasonEndYear < currentSeasonEndYear
    ) ||
    (
      reportedThrough !== null &&
      guaranteedThrough !== null &&
      guaranteedThrough.seasonEndYear > reportedThrough.seasonEndYear
    ) ||
    (
      maximumTeamControlThrough !== null &&
      guaranteedThrough !== null &&
      guaranteedThrough.seasonEndYear >
        maximumTeamControlThrough.seasonEndYear
    )
  ) {
    return false
  }
  const optionKeys = new Set<string>()
  for (const option of term.options) {
    if (!isRecord(option) || !isSeasonReference(option.season)) return false
    const optionYear = option.season.seasonEndYear
    const optionKey = `${option.type}:${optionYear}`
    if (
      optionYear < currentSeasonEndYear ||
      (
        reportedThrough !== null &&
        optionYear > reportedThrough.seasonEndYear
      ) ||
      optionKeys.has(optionKey)
    ) {
      return false
    }
    optionKeys.add(optionKey)
  }
  const nextDecision = value.nextDecision
  if (
    (
      nextDecision === null &&
      !isOpenStatus &&
      value.mobilityWindow !== 'unavailable'
    ) ||
    (
      nextDecision !== null &&
      (
        !isStringEnum(
          nextDecision.kind,
          PLAYER_MOBILITY_DECISION_KINDS,
        ) ||
        !isNonEmptyString(nextDecision.label) ||
        (
          nextDecision.season !== null &&
          !isSeasonReference(nextDecision.season)
        )
      )
    )
  ) {
    return false
  }
  const nextDecisionSeason = nextDecision !== null &&
    isSeasonReference(nextDecision.season)
    ? nextDecision.season
    : null
  if (
    nextDecisionSeason !== null &&
    nextDecisionSeason.seasonEndYear < currentSeasonEndYear
  ) {
    return false
  }
  const optionTypeByDecision = {
    club_option: 'club',
    player_option: 'player',
    mutual_option: 'mutual',
    vesting_option: 'vesting',
    opt_out: 'opt_out',
  } as const
  if (
    nextDecision !== null &&
    typeof nextDecision.kind === 'string' &&
    nextDecision.kind in optionTypeByDecision
  ) {
    if (
      nextDecisionSeason === null ||
      !optionKeys.has(
        `${
          optionTypeByDecision[
            nextDecision.kind as keyof typeof optionTypeByDecision
          ]
        }:${nextDecisionSeason.seasonEndYear}`,
      )
    ) {
      return false
    }
  }
  if (
    nextDecision !== null &&
    (
      nextDecision.kind === 'unrestricted_free_agency' ||
      nextDecision.kind === 'restricted_free_agency'
    ) &&
    reportedThrough !== null &&
    nextDecisionSeason !== null &&
    (
      nextDecisionSeason.seasonEndYear <
        reportedThrough.seasonEndYear ||
      nextDecisionSeason.seasonEndYear >
        reportedThrough.seasonEndYear + 1
    )
  ) {
    return false
  }
  if (
    value.lastTeamChange !== null &&
    (
      !isRecord(value.lastTeamChange) ||
      !isIsoDate(value.lastTeamChange.effectiveAt) ||
      !isStringEnum(
        value.lastTeamChange.kind,
        PLAYER_MOBILITY_CHANGE_KINDS,
      ) ||
      (
        value.lastTeamChange.fromTeam !== null &&
        (
          !isRecord(value.lastTeamChange.fromTeam) ||
          !isNonEmptyString(value.lastTeamChange.fromTeam.code) ||
          !isNonEmptyString(value.lastTeamChange.fromTeam.name)
        )
      ) ||
      !isRecord(value.lastTeamChange.toTeam) ||
      !isNonEmptyString(value.lastTeamChange.toTeam.code) ||
      !isNonEmptyString(value.lastTeamChange.toTeam.name) ||
      Date.parse(value.lastTeamChange.effectiveAt as string) >
        Date.parse(value.asOf as string)
    )
  ) {
    return false
  }
  const provenance = value.provenance
  if (
    !isStringEnum(
      provenance.identityStatus,
      PLAYER_MOBILITY_IDENTITY_STATUSES,
    ) ||
    !isNonEmptyString(provenance.sourceId) ||
    !isNonEmptyString(provenance.sourcePlayerId) ||
    (
      !isNonEmptyString(provenance.sourceUrl) ||
      !provenance.sourceUrl.startsWith('https://')
    ) ||
    !isIsoDate(provenance.accessedAt)
  ) {
    return false
  }
  const expectedWindow = mobilityWindowFor(
    currentSeasonEndYear,
    nextDecisionSeason?.seasonEndYear ?? null,
    term.status,
    lineageAwareTermWindows &&
      nextDecision?.kind === 'unknown' &&
      typeof term.remainingSeasonsIncludingCurrent === 'number'
      ? term.remainingSeasonsIncludingCurrent
      : undefined,
  )
  return value.mobilityWindow === expectedWindow
}

export function isPlayerMobilityArtifact(
  value: unknown,
): value is PlayerMobilityArtifact {
  if (
    !isRecord(value) ||
    value.schemaVersion !== PLAYER_MOBILITY_SCHEMA_VERSION ||
    !isIsoDate(value.generatedAt) ||
    !isIsoDate(value.dataThrough) ||
    !isRecord(value.coverage) ||
    !isRecord(value.coverage.byLeague) ||
    !Array.isArray(value.coverage.limitations) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.rows) ||
    typeof value.contentSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.contentSha256)
  ) {
    return false
  }
  const identityMatching = value.coverage.identityMatching
  if (identityMatching !== undefined) {
    if (!isRecord(identityMatching)) return false
    const counts = [
      identityMatching.sourceContractRows,
      identityMatching.observedRows,
      identityMatching.uniqueNormalizedNameMatches,
      identityMatching.uniqueCompactNameMatches,
      identityMatching.unmatchedSourceRows,
      identityMatching.ambiguousSourceRows,
      identityMatching.structurallyWithheldSourceRows,
      identityMatching.staleTermSourceRows,
    ]
    if (!counts.every((count) => (
      Number.isSafeInteger(count) && (count as number) >= 0
    ))) {
      return false
    }
    const [
      sourceContractRows,
      observedRows,
      uniqueNormalizedNameMatches,
      uniqueCompactNameMatches,
      unmatchedSourceRows,
      ambiguousSourceRows,
      structurallyWithheldSourceRows,
      staleTermSourceRows,
    ] = counts as number[]
    const identityTierCounts = [
      identityMatching.existingReviewedSupplementMatches,
      identityMatching.verifiedCurrentIdentityMatches,
      identityMatching.reviewedCurrentIdentityMatches,
      identityMatching.reviewedNameTeamMatches,
    ]
    const hasAnyIdentityTierCount = identityTierCounts.some(
      (count) => count !== undefined,
    )
    if (
      hasAnyIdentityTierCount &&
      (
        !identityTierCounts.every((count) => (
          Number.isSafeInteger(count) && (count as number) >= 0
        )) ||
        (identityTierCounts as number[]).reduce(
          (sum, count) => sum + count,
          0,
        ) !== observedRows
      )
    ) {
      return false
    }
    for (const withheldCount of [
      identityMatching.blockedIdentitySourceRows,
      identityMatching.identityEvidenceWithheldSourceRows,
    ]) {
      if (
        withheldCount !== undefined &&
        (
          !Number.isSafeInteger(withheldCount) ||
          (withheldCount as number) < 0 ||
          (withheldCount as number) > unmatchedSourceRows
        )
      ) {
        return false
      }
    }
    if (
      (
        (identityMatching.blockedIdentitySourceRows as number | undefined) ??
          0
      ) +
      (
        (
          identityMatching.identityEvidenceWithheldSourceRows as
            number | undefined
        ) ?? 0
      ) >
      unmatchedSourceRows
    ) {
      return false
    }
    if (
      observedRows !== value.coverage.observedRows ||
      uniqueNormalizedNameMatches + uniqueCompactNameMatches !==
        observedRows ||
      observedRows + unmatchedSourceRows !== sourceContractRows ||
      ambiguousSourceRows > unmatchedSourceRows ||
      structurallyWithheldSourceRows > unmatchedSourceRows ||
      staleTermSourceRows > unmatchedSourceRows
    ) {
      return false
    }
  }
  const teamPages = value.coverage.teamPages
  if (teamPages !== undefined) {
    if (!Array.isArray(teamPages)) return false
    const pageKeys = new Set<string>()
    let totalTeamPageRows = 0
    for (const page of teamPages) {
      if (
        !isRecord(page) ||
        (
          page.league !== 'MLB' &&
          page.league !== 'NFL' &&
          page.league !== 'NBA' &&
          page.league !== 'NHL'
        ) ||
        !isNonEmptyString(page.teamCode) ||
        !isNonEmptyString(page.sourceUrl) ||
        !page.sourceUrl.startsWith('https://') ||
        !Number.isSafeInteger(page.parsedRows) ||
        (page.parsedRows as number) < 0 ||
        !Number.isSafeInteger(page.withheldRows) ||
        (page.withheldRows as number) < 0 ||
        !Number.isSafeInteger(page.totalRows) ||
        (page.totalRows as number) < 0 ||
        (page.parsedRows as number) + (page.withheldRows as number) !==
          page.totalRows
      ) {
        return false
      }
      const pageKey = `${page.league}|${page.teamCode}`
      if (pageKeys.has(pageKey)) return false
      pageKeys.add(pageKey)
      totalTeamPageRows += page.totalRows as number
    }
    if (
      isRecord(identityMatching) &&
      totalTeamPageRows !== identityMatching.sourceContractRows
    ) {
      return false
    }
  }
  const sourceChain = value.sourceChain
  if (sourceChain !== undefined) {
    if (
      !isRecord(sourceChain) ||
      !isNonEmptyString(sourceChain.normalizerVersion) ||
      !isNonEmptyString(sourceChain.parserVersion) ||
      !isRecord(sourceChain.permissionEvidence) ||
      !isNonEmptyString(sourceChain.permissionEvidence.path) ||
      !isNonEmptyString(sourceChain.permissionEvidence.sha256) ||
      !/^[a-f0-9]{64}$/u.test(sourceChain.permissionEvidence.sha256) ||
      !isRecord(sourceChain.robotsPolicy) ||
      !isNonEmptyString(sourceChain.robotsPolicy.url) ||
      !sourceChain.robotsPolicy.url.startsWith('https://') ||
      !isNonEmptyString(sourceChain.robotsPolicy.sha256) ||
      !/^[a-f0-9]{64}$/u.test(sourceChain.robotsPolicy.sha256) ||
      !isRecord(sourceChain.run) ||
      !isNonEmptyString(sourceChain.run.id) ||
      !isNonEmptyString(sourceChain.run.manifestPath) ||
      !isNonEmptyString(sourceChain.run.manifestSha256) ||
      !/^[a-f0-9]{64}$/u.test(sourceChain.run.manifestSha256) ||
      !isRecord(sourceChain.pages) ||
      !Number.isSafeInteger(sourceChain.pages.count) ||
      (sourceChain.pages.count as number) < 1 ||
      !isNonEmptyString(sourceChain.pages.setSha256) ||
      !/^[a-f0-9]{64}$/u.test(sourceChain.pages.setSha256) ||
      !Array.isArray(sourceChain.pages.items) ||
      sourceChain.pages.items.length !== sourceChain.pages.count ||
      (
        Array.isArray(teamPages) &&
        sourceChain.pages.count !== teamPages.length
      )
    ) {
      return false
    }
    let previousSourceUrl = ''
    const sourceUrls = new Set<string>()
    const validatedPageItems: Array<{
      sourceUrl: string
      contentSha256: string
    }> = []
    for (const item of sourceChain.pages.items) {
      if (
        !isRecord(item) ||
        !isNonEmptyString(item.sourceUrl) ||
        !item.sourceUrl.startsWith('https://') ||
        !isNonEmptyString(item.contentSha256) ||
        !/^[a-f0-9]{64}$/u.test(item.contentSha256) ||
        sourceUrls.has(item.sourceUrl) ||
        (
          previousSourceUrl &&
          previousSourceUrl.localeCompare(item.sourceUrl, 'en-US') >= 0
        )
      ) {
        return false
      }
      sourceUrls.add(item.sourceUrl)
      previousSourceUrl = item.sourceUrl
      validatedPageItems.push({
        sourceUrl: item.sourceUrl,
        contentSha256: item.contentSha256,
      })
    }
    if (
      sha256Hex(playerMobilityPageSetValue(validatedPageItems)) !==
        sourceChain.pages.setSha256
    ) {
      return false
    }
    if (Array.isArray(teamPages)) {
      const teamPageUrls = new Set(
        teamPages.map((page) => page.sourceUrl),
      )
      if (
        teamPageUrls.size !== sourceUrls.size ||
        [...teamPageUrls].some((sourceUrl) => !sourceUrls.has(sourceUrl))
      ) {
        return false
      }
    }
  }
  const sourceIds = new Set<string>()
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      typeof source.id !== 'string' ||
      !source.id ||
      sourceIds.has(source.id) ||
      typeof source.label !== 'string' ||
      typeof source.publisher !== 'string' ||
      typeof source.url !== 'string' ||
      !source.url.startsWith('https://') ||
      (
        source.publishedAt !== null &&
        !isIsoDate(source.publishedAt)
      ) ||
      !isIsoDate(source.accessedAt) ||
      (
        source.kind !== 'official' &&
        source.kind !== 'licensed' &&
        source.kind !== 'authorized'
      )
    ) {
      return false
    }
    sourceIds.add(source.id)
  }
  if (
    sourceIds.has('spotrac-team-contract-lists') &&
    sourceChain === undefined
  ) {
    return false
  }
  const sourceKeys = new Set<string>()
  for (const row of value.rows) {
    if (
      !isObservedMobilityRow(
        row,
        sourceIds,
        sourceChain !== undefined,
      ) ||
      sourceKeys.has(row.gemRateSourceKey)
    ) {
      return false
    }
    sourceKeys.add(row.gemRateSourceKey)
  }
  const byLeague = {
    MLB: value.rows.filter((row) => row.league === 'MLB').length,
    NFL: value.rows.filter((row) => row.league === 'NFL').length,
    NBA: value.rows.filter((row) => row.league === 'NBA').length,
    NHL: value.rows.filter((row) => row.league === 'NHL').length,
  }
  return (
    value.coverage.observedRows === value.rows.length &&
    value.coverage.byLeague.MLB === byLeague.MLB &&
    value.coverage.byLeague.NFL === byLeague.NFL &&
    value.coverage.byLeague.NBA === byLeague.NBA &&
    value.coverage.byLeague.NHL === byLeague.NHL
  )
}

export function findPlayerMobilityContext(
  rows: readonly PlayerMobilityArtifactRow[],
  gemRateSourceKey: string | null | undefined,
): PlayerMobilityArtifactRow | null {
  if (!gemRateSourceKey) return null
  return rows.find((row) => (
    row.gemRateSourceKey === gemRateSourceKey
  )) ?? null
}
