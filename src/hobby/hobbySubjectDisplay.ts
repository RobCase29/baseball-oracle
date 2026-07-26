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
