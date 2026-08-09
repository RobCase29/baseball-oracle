interface SubjectContextLike {
  age: number | null
  ageAsOf: string | null
  introducedYear: number | null
  approximateYearsSinceIntroduction: number | null
  introducedGeneration: number | null
  nationalDexNumber: number | null
  sourceId: string | null
  evidence: string
}

interface SubjectWithContext {
  type: string
  context?: SubjectContextLike | null
  mobility?: MobilityContextLike | null
}

interface MobilityContextLike {
  availability: 'observed' | 'unavailable' | 'withheld_identity' | 'not_applicable'
  asOf: string | null
  league: 'MLB' | 'NFL' | 'NBA' | 'NHL' | null
  currentTeam: {
    code: string
    name: string
  } | null
  teamTenureStart: string | null
  term: {
    status:
      | 'under_contract'
      | 'team_control'
      | 'restricted_free_agent'
      | 'unrestricted_free_agent'
      | 'unsigned'
      | 'unknown'
    kind: string
    currentSeasonLabel: string
    reportedThrough: {
      seasonEndYear: number
      label: string
    } | null
    guaranteedThrough: {
      seasonEndYear: number
      label: string
    } | null
    maximumTeamControlThrough: {
      seasonEndYear: number
      label: string
    } | null
    remainingSeasonsIncludingCurrent: number | null
    options: Array<{
      season: {
        seasonEndYear: number
        label: string
      }
      type: 'club' | 'player' | 'mutual' | 'vesting' | 'opt_out'
      status: 'pending'
    }>
  } | null
  nextDecision: {
    kind:
      | 'unrestricted_free_agency'
      | 'restricted_free_agency'
      | 'club_option'
      | 'player_option'
      | 'mutual_option'
      | 'vesting_option'
      | 'opt_out'
      | 'non_guarantee'
      | 'arbitration'
      | 'extension_eligibility'
      | 'unknown'
    label: string
    season: {
      seasonEndYear: number
      label: string
    } | null
  } | null
  mobilityWindow:
    | 'open_now'
    | 'after_current_season'
    | 'within_two_seasons'
    | 'three_plus_seasons'
    | 'unavailable'
  lastTeamChange: {
    effectiveAt: string
    kind: string
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
    sourceUrl: string | null
    accessedAt: string | null
  }
}

interface SalesTrendLike {
  available: boolean
  state: string
  label: string
  direction: 'up' | 'flat' | 'down' | 'mixed' | 'unavailable'
  sixMonthChangePct: number | null
  recentThreeMonthChangePct: number | null
  domainMedianSixMonthChangePct: number | null
  relativeToDomain: 'ahead' | 'inline' | 'lagging' | 'unavailable'
  evidence: 'confirmed' | 'mixed_window' | 'thin_base' | 'withheld'
  reasonCodes: string[]
}

interface AssessmentWithSalesTrend {
  salesTrend?: SalesTrendLike | null
}

export interface SubjectContextDisplay {
  primary: string
  compact: string
  secondary: string
  detail: string
}

export interface SalesTrendDisplay {
  primary: string
  compact: string
  secondary: string
  detail: string
  sixMonth: string
  recentThreeMonth: string
  direction: SalesTrendLike['direction']
  evidence: string
  available: boolean
}

export interface MobilityContextDisplay {
  primary: string
  compact: string
  secondary: string
  detail: string
  guaranteeLabel: string | null
  decisionLabel: string | null
  decisionCompact: string | null
  decisionActor: string | null
  optionLabels: string[]
  band:
    | 'long_runway'
    | 'decision_window'
    | 'open_market'
    | 'neutral_term'
    | 'unavailable'
  observed: boolean
  sourceUrl: string | null
  sourceLabel: string | null
  sourceAsOf: string | null
  accentDecision: boolean
}

const generationLabels: Record<number, string> = {
  1: 'Gen I',
  2: 'Gen II',
  3: 'Gen III',
  4: 'Gen IV',
  5: 'Gen V',
  6: 'Gen VI',
  7: 'Gen VII',
  8: 'Gen VIII',
  9: 'Gen IX',
}

function readableDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00.000Z`
      : value,
  )
  if (!Number.isFinite(date.valueOf())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function readableFullDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00.000Z`
      : value,
  )
  if (!Number.isFinite(date.valueOf())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function seasonDisplay(
  season: { seasonEndYear: number; label: string },
): string {
  return season.label.replace(/\s+season$/iu, '')
}

function ageLabel(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function sourceLabel(sourceId: string | null): string {
  if (!sourceId) return 'source-linked identity'
  const normalized = sourceId.toLocaleLowerCase()
  if (normalized.includes('backstop_player')) return 'Backstop player bridge'
  if (normalized.includes('career')) return 'Career Oracle'
  if (normalized.includes('keeptradecut')) return 'KeepTradeCut'
  if (normalized.includes('hashtag')) return 'Hashtag Basketball'
  if (normalized.includes('pokeapi')) return 'PokéAPI species data'
  return 'source-linked identity'
}

function trendPercent(
  value: number | null,
  nullLabel = '—',
): string {
  if (value === null || !Number.isFinite(value)) return nullLabel
  const prefix = value > 0 ? '+' : ''
  const digits = Math.abs(value) >= 100 ? 0 : 1
  return `${prefix}${value.toFixed(digits)}%`
}

function relativeLabel(
  relative: SalesTrendLike['relativeToDomain'],
): string | null {
  if (relative === 'ahead') return 'ahead of cohort'
  if (relative === 'inline') return 'in line with cohort'
  if (relative === 'lagging') return 'lagging cohort'
  return null
}

function evidenceLabel(evidence: SalesTrendLike['evidence']): string {
  if (evidence === 'confirmed') return 'both windows confirm the direction'
  if (evidence === 'mixed_window') return 'short and medium windows disagree'
  if (evidence === 'thin_base') return 'thin comparison base'
  return 'comparison withheld'
}

function mobilitySourceLabel(
  sourceId: string | null,
  league: MobilityContextLike['league'],
): string {
  const normalized = sourceId?.toLocaleLowerCase('en-US') ?? ''
  if (normalized.includes('spotrac')) return 'Spotrac'
  if (normalized.includes('mlb')) return 'MLB.com'
  if (normalized.includes('nfl')) return 'NFL'
  if (normalized.includes('nba')) return 'NBA'
  if (normalized.includes('nhl')) return 'NHL'
  return league ? `${league} contract source` : 'Contract source'
}

function optionLabel(
  option: NonNullable<MobilityContextLike['term']>['options'][number],
): string {
  const label = option.type === 'club'
    ? 'Club option'
    : option.type === 'player'
      ? 'Player option'
      : option.type === 'mutual'
        ? 'Mutual option'
        : option.type === 'vesting'
          ? 'Vesting option'
          : 'Opt-out'
  return `${label} ${seasonDisplay(option.season)}`
}

function decisionActor(
  kind: NonNullable<MobilityContextLike['nextDecision']>['kind'],
): string {
  if (
    kind === 'club_option' ||
    kind === 'non_guarantee'
  ) {
    return 'Team-controlled'
  }
  if (
    kind === 'player_option' ||
    kind === 'opt_out'
  ) {
    return 'Player-controlled'
  }
  if (kind === 'mutual_option') return 'Mutual decision'
  if (kind === 'vesting_option') return 'Vesting condition'
  if (
    kind === 'unrestricted_free_agency' ||
    kind === 'restricted_free_agency'
  ) {
    return 'Free agency'
  }
  if (kind === 'arbitration') return 'Salary process'
  if (kind === 'extension_eligibility') return 'Extension opportunity'
  return 'Decision actor unknown'
}

function decisionCompactLabel(
  mobility: MobilityContextLike,
): string | null {
  const status = mobility.term?.status
  if (status === 'unrestricted_free_agent') return 'UFA now'
  if (status === 'restricted_free_agent') return 'RFA now'
  if (status === 'unsigned') return 'Unsigned'
  if (
    mobility.mobilityWindow === 'three_plus_seasons' ||
    mobility.mobilityWindow === 'unavailable' ||
    !mobility.nextDecision
  ) {
    return null
  }
  const decisionSeason = mobility.nextDecision.season
  const suffix = decisionSeason
    ? ` ${seasonDisplay(decisionSeason)}`
    : ''
  switch (mobility.nextDecision.kind) {
    case 'club_option':
      return `Club option${suffix}`
    case 'player_option':
      return `Player option${suffix}`
    case 'mutual_option':
      return `Mutual option${suffix}`
    case 'vesting_option':
      return `Vesting option${suffix}`
    case 'opt_out':
      return `Opt-out${suffix}`
    case 'non_guarantee':
      return `Team decision${suffix}`
    case 'unrestricted_free_agency':
      return `UFA${suffix}`
    case 'restricted_free_agency':
      return `RFA${suffix}`
    case 'arbitration':
      return `Arbitration${suffix}`
    case 'extension_eligibility':
      return `Extension eligible${suffix}`
    case 'unknown':
      return `Decision${suffix}`
  }
}

export function subjectContextDisplay(
  subject: SubjectWithContext,
): SubjectContextDisplay {
  const context = subject.context

  if (subject.type === 'pokemon_character') {
    if (!context?.introducedYear) {
      return {
        primary: 'Origin unavailable',
        compact: 'origin —',
        secondary: 'Approximate debut not linked',
        detail:
          'A reliable generation debut could not be linked. No card-release year is inferred.',
      }
    }

    const generation = context.introducedGeneration
      ? generationLabels[context.introducedGeneration] ??
        `Generation ${context.introducedGeneration}`
      : null
    const years = context.approximateYearsSinceIntroduction
    const secondaryParts = [
      generation,
      years === null ? null : `~${ageLabel(years)} years`,
      context.nationalDexNumber === null
        ? null
        : `Dex #${context.nationalDexNumber}`,
    ].filter((value): value is string => Boolean(value))

    return {
      primary: `Introduced ${context.introducedYear}`,
      compact: `${context.introducedYear} debut`,
      secondary: secondaryParts.join(' · ') || 'Approximate franchise debut',
      detail:
        `${generation ? `${generation} ` : ''}franchise debut, approximately ` +
        `${years === null ? 'an unknown number of' : ageLabel(years)} years before this snapshot. ` +
        `This is an approximate character-introduction year from ${sourceLabel(context.sourceId)}, not the release year of a specific TCG card.`,
    }
  }

  if (context?.age === null || context?.age === undefined) {
    return {
      primary: 'Age unavailable',
      compact: 'age —',
      secondary: 'No trusted identity bridge',
      detail:
        'Player age is withheld because a trusted source identity could not be linked.',
    }
  }

  const asOf = readableDate(context.ageAsOf)
  return {
    primary: `Age ${ageLabel(context.age)}`,
    compact: `Age ${ageLabel(context.age)}`,
    secondary: asOf ? `as of ${asOf}` : 'Source-linked player age',
    detail:
      `Player age ${ageLabel(context.age)}${asOf ? ` as of ${asOf}` : ''}, linked through ${sourceLabel(context.sourceId)}. ` +
      'Age is context only and does not add to the Binder Index.',
  }
}

export function mobilityContextDisplay(
  subject: SubjectWithContext,
): MobilityContextDisplay {
  const mobility = subject.mobility
  if (!mobility || mobility.availability !== 'observed') {
    if (
      subject.type === 'pokemon_character' ||
      mobility?.availability === 'not_applicable'
    ) {
      return {
        primary: 'Team runway not applicable',
        compact: 'Runway n/a',
        secondary: 'Non-athlete subject',
        detail:
          'Team continuity and contract decisions do not apply to this subject.',
        band: 'unavailable',
        observed: false,
        sourceUrl: null,
        sourceLabel: null,
        sourceAsOf: null,
        guaranteeLabel: null,
        decisionLabel: null,
        decisionCompact: null,
        decisionActor: null,
        optionLabels: [],
        accentDecision: false,
      }
    }
    if (mobility?.availability === 'withheld_identity') {
      return {
        primary: 'Team runway withheld',
        compact: 'Runway withheld',
        secondary: 'Identity bridge unresolved',
        detail:
          'Contract context is withheld because the market identity is ambiguous. It is not treated as free agency or zero years remaining.',
        band: 'unavailable',
        observed: false,
        sourceUrl: null,
        sourceLabel: null,
        sourceAsOf: null,
        guaranteeLabel: null,
        decisionLabel: null,
        decisionCompact: null,
        decisionActor: null,
        optionLabels: [],
        accentDecision: false,
      }
    }
    return {
      primary: 'Team runway unavailable',
      compact: 'Runway —',
      secondary: 'No verified contract record linked',
      detail:
        'No verified, identity-reviewed contract record is linked. Missing data is not treated as free agency or mobility risk.',
      band: 'unavailable',
      observed: false,
      sourceUrl: null,
      sourceLabel: null,
      sourceAsOf: null,
      guaranteeLabel: null,
      decisionLabel: null,
      decisionCompact: null,
      decisionActor: null,
      optionLabels: [],
      accentDecision: false,
    }
  }

  const status = mobility.term?.status
  const isOpenStatus = (
    status === 'unrestricted_free_agent' ||
    status === 'restricted_free_agent' ||
    status === 'unsigned'
  )
  const hasVerifiedDecision = Boolean(
    mobility.nextDecision &&
    mobility.nextDecision.kind !== 'unknown',
  )
  const decisionNotVerified = (
    !isOpenStatus &&
    !hasVerifiedDecision
  )
  const teamControlThrough = status === 'team_control'
    ? (
        mobility.term?.maximumTeamControlThrough ??
        mobility.term?.reportedThrough
      )
    : null
  const contractThrough = status === 'team_control'
    ? null
    : mobility.term?.reportedThrough
  const windowLabel =
    decisionNotVerified
      ? 'Decision not verified'
      : mobility.mobilityWindow === 'three_plus_seasons'
      ? 'Long runway'
      : mobility.mobilityWindow === 'open_now'
        ? 'Open market'
        : mobility.mobilityWindow === 'after_current_season'
          ? 'Decision after current season'
          : 'Decision within two seasons'
  const band: MobilityContextDisplay['band'] =
    decisionNotVerified
      ? 'neutral_term'
      : mobility.mobilityWindow === 'three_plus_seasons'
      ? 'long_runway'
      : mobility.mobilityWindow === 'open_now'
        ? 'open_market'
        : 'decision_window'
  const primary = status === 'unrestricted_free_agent'
    ? 'Unrestricted free agent'
    : status === 'restricted_free_agent'
      ? 'Restricted free agent'
      : status === 'unsigned'
        ? 'Unsigned'
        : teamControlThrough
          ? `Team control through ${seasonDisplay(teamControlThrough)}`
          : contractThrough
            ? `Contract term through ${seasonDisplay(contractThrough)}`
            : mobility.nextDecision?.label ?? 'Contract terms observed'
  const guaranteeLabel = mobility.term?.guaranteedThrough
    ? `Guaranteed through ${seasonDisplay(
        mobility.term.guaranteedThrough,
      )}`
    : null
  const optionLabels = mobility.term?.options.map(optionLabel) ?? []
  const decisionLabel = hasVerifiedDecision
    ? mobility.nextDecision?.label ?? null
    : decisionNotVerified
      ? 'Decision not verified'
      : null
  const nextDecisionActor = hasVerifiedDecision && mobility.nextDecision
    ? decisionActor(mobility.nextDecision.kind)
    : null
  const decisionCompact = hasVerifiedDecision || isOpenStatus
    ? decisionCompactLabel(mobility)
    : null
  const remaining = mobility.term?.remainingSeasonsIncludingCurrent
  const remainingLabel = remaining === null || remaining === undefined
    ? null
    : `${remaining} season${remaining === 1 ? '' : 's'} incl. ${
        mobility.term?.currentSeasonLabel ?? 'current'
      }`
  const secondary = [
    mobility.currentTeam?.code,
    windowLabel,
    remainingLabel,
  ].filter((value): value is string => Boolean(value)).join(' · ')
  const tenureStart = readableDate(mobility.teamTenureStart)
  const lastMove = mobility.lastTeamChange
    ? (
        `${mobility.lastTeamChange.fromTeam?.code ?? 'Prior team'} → ` +
        `${mobility.lastTeamChange.toTeam.code} in ${
          readableDate(mobility.lastTeamChange.effectiveAt) ?? 'an observed move'
        }`
      )
    : null
  const decision = hasVerifiedDecision
    ? mobility.nextDecision?.label ?? null
    : null
  const detail = [
    `${primary}${mobility.currentTeam ? ` with ${mobility.currentTeam.name}` : ''}.`,
    tenureStart ? `Current-team tenure began ${tenureStart}.` : null,
    decision
      ? `Next known decision: ${decision}${
          nextDecisionActor ? ` (${nextDecisionActor.toLocaleLowerCase('en-US')})` : ''
        }.`
      : null,
    decisionNotVerified
      ? 'No specific option, out, or free-agency decision is verified from the available contract detail.'
      : null,
    lastMove ? `Last team change: ${lastMove}.` : null,
    decisionNotVerified
      ? 'The reported contract term does not by itself establish free agency, relocation, or a team change.'
      : 'This is neutral mobility context: a move can disrupt continuity or expand collector reach depending on the destination.',
    mobility.lastTeamChange
      ? 'The app does not claim the historical move caused the current demand pattern.'
      : null,
  ].filter((value): value is string => Boolean(value)).join(' ')
  const compact = status === 'unrestricted_free_agent'
    ? 'UFA · open market'
    : status === 'restricted_free_agent'
      ? 'RFA · restricted market'
      : status === 'unsigned'
        ? 'Unsigned'
        : `${mobility.currentTeam?.code ?? 'Team'} · ${
            teamControlThrough
              ? `control ${seasonDisplay(teamControlThrough)}`
              : contractThrough
                ? `term ${seasonDisplay(contractThrough)}`
                : windowLabel
          }`
  const sourceAsOf = readableFullDate(
    mobility.asOf ?? mobility.provenance.accessedAt,
  )
  const decisionIsMobilityRelevant = (
    hasVerifiedDecision &&
    mobility.nextDecision?.kind !== 'arbitration' &&
    mobility.nextDecision?.kind !== 'extension_eligibility'
  )

  return {
    primary,
    compact,
    secondary,
    detail,
    guaranteeLabel,
    decisionLabel,
    decisionCompact,
    decisionActor: nextDecisionActor,
    optionLabels,
    band,
    observed: true,
    sourceUrl: mobility.provenance.sourceUrl,
    sourceLabel: mobilitySourceLabel(
      mobility.provenance.sourceId,
      mobility.league,
    ),
    sourceAsOf,
    accentDecision:
      band === 'open_market' ||
      (
        band === 'decision_window' &&
        decisionIsMobilityRelevant
      ),
  }
}

export function salesTrendDisplay(
  assessment: AssessmentWithSalesTrend,
): SalesTrendDisplay {
  const trend = assessment.salesTrend
  if (!trend) {
    return {
      primary: 'Trend unavailable',
      compact: 'Trend —',
      secondary: 'Comparison not available',
      detail:
        'A like-for-like sales-dollar trend is not available for this subject.',
      sixMonth: '—',
      recentThreeMonth: '—',
      direction: 'unavailable',
      evidence: 'comparison withheld',
      available: false,
    }
  }

  const label = trend.label.trim() || 'Trend unavailable'
  if (!trend.available) {
    return {
      primary: label,
      compact: label,
      secondary: 'Comparison withheld · refresh required',
      detail:
        'Sales-direction labeling is withheld until the market snapshot is current. This is demand direction, not card-price appreciation.',
      sixMonth: '—',
      recentThreeMonth: '—',
      direction: trend.direction,
      evidence: evidenceLabel(trend.evidence),
      available: false,
    }
  }

  const sixMonth = trendPercent(
    trend.sixMonthChangePct,
    trend.sixMonthChangePct === null ? 'new base' : '—',
  )
  const recentThreeMonth = trendPercent(
    trend.recentThreeMonthChangePct,
    trend.recentThreeMonthChangePct === null ? 'new base' : '—',
  )
  const relative = relativeLabel(trend.relativeToDomain)
  const percentSuffix = sixMonth === '—' ? '' : ` ${sixMonth}`
  const evidence = evidenceLabel(trend.evidence)
  const secondaryParts = [
    `6M ${sixMonth}`,
    `recent 3M ${recentThreeMonth}`,
    relative,
  ].filter((value): value is string => Boolean(value))

  return {
    primary: label,
    compact: `${label}${percentSuffix}`,
    secondary: secondaryParts.join(' · '),
    detail:
      `Completed eBay singles sales dollars are ${sixMonth} versus the prior-year six-month window and ` +
      `${recentThreeMonth} in the latest three-month comparison${relative ? `, ${relative}` : ''}. ` +
      `${evidence.charAt(0).toLocaleUpperCase()}${evidence.slice(1)}. This is demand direction, not card-price appreciation.`,
    sixMonth,
    recentThreeMonth,
    direction: trend.direction,
    evidence,
    available: trend.available,
  }
}
