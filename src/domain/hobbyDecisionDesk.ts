import type {
  HobbyMasterFeedItem,
} from './hobbyMasterRanking.js'
import {
  midrankPercentiles,
} from './hobbyMasterRanking.js'
import {
  buildHobbyCompoundingSignal,
  HOBBY_COMPOUNDING_MODEL_VERSION,
  type HobbyCompoundingSignal,
} from './hobbyCompoundingSignal.js'
import {
  buildHobbyExitWindowSignal,
} from './hobbyLiquidationSignal.js'
import type {
  ItFactorEntry,
} from './itFactor.js'

export const HOBBY_DECISION_DESK_SCHEMA_VERSION =
  'backstop-hobby-decision-desk.v2' as const

export const HOBBY_DECISION_QUEUE_IDS = [
  'compounding_now',
  'narrative_momentum',
  'noise_check',
  'narrative_pressure',
  'narrative_runway',
  'story_before_scale',
] as const

export type HobbyDecisionQueueId =
  (typeof HOBBY_DECISION_QUEUE_IDS)[number]

export interface HobbyDecisionDeskItem {
  id: string
  playerName: string
  sport: HobbyMasterFeedItem['subject']['domain']
  teamName: string
  position: string
  href: string
  it: {
    tier: ItFactorEntry['tier']
    score: number
    trajectory: ItFactorEntry['trajectory']
    marketEvidence: ItFactorEntry['market']['evidence']
  } | null
  nativeSignal: {
    label: string
    value: string
    detail: string
    score: number
  }
  evidence: string[]
}

export interface HobbyDecisionQueue {
  id: HobbyDecisionQueueId
  title: string
  eyebrow: string
  rule: string
  interpretation: string
  sourceBoardLabel: string
  sourceBoardHref: string
  items: HobbyDecisionDeskItem[]
}

export interface HobbyDecisionDesk {
  queues: HobbyDecisionQueue[]
  uniqueSubjectCount: number
  intersectionCount: number
  powerLaw: {
    modelVersion: typeof HOBBY_COMPOUNDING_MODEL_VERSION
    observedUniverseCount: number
    observedTtmDemandUsd: number
    topOnePercent: {
      subjectCount: number
      demandSharePct: number
    }
    topTenPercent: {
      subjectCount: number
      demandSharePct: number
    }
    priorTail: {
      subjectCount: number
      retainedCount: number
      retentionPct: number
    }
    confirmedTailEntrantCount: number
    descriptiveOnly: true
    interpretation:
      'observed_universe_concentration_not_fitted_power_law_or_future_return'
  }
}

export interface HobbyDecisionMarketRow {
  sourceKey: string
  monthlySalesUsd: readonly number[]
}

export interface HobbyDecisionGraduationItem {
  player: {
    name: string
  }
  graduation: {
    band: string
    globalRank: number | null
    index: number | null
    primaryBlocker: string
  }
  identity: {
    gemRateSourceKey: string
  }
}

export interface HobbyDecisionDeskInput {
  itEntries: readonly ItFactorEntry[]
  marketItems: readonly HobbyMasterFeedItem[]
  marketRows: readonly HobbyDecisionMarketRow[]
  graduationItems: readonly HobbyDecisionGraduationItem[]
}

export interface HobbyDecisionDeskArtifact {
  schemaVersion: typeof HOBBY_DECISION_DESK_SCHEMA_VERSION
  snapshot: {
    generatedAt: string
    marketDataThrough: string
    marketRowsSha256: string
    itReviewedAsOf: string
    itNextReviewBy: string
    pathDataThrough: string
    compoundingModelVersion: typeof HOBBY_COMPOUNDING_MODEL_VERSION
  }
  coverage: {
    marketSports: readonly ['baseball', 'football', 'basketball', 'hockey']
    pathSports: readonly ['football', 'basketball']
    limitations: string[]
  }
  desk: HobbyDecisionDesk
}

function isHighConvictionIt(entry: ItFactorEntry): boolean {
  return entry.tier === 'icon' || entry.tier === 'high'
}

function boardSearchHref(
  lens: 'market' | 'players' | 'it',
  playerName: string,
): string {
  const parameters = new URLSearchParams({
    lens,
    q: playerName,
  })
  return `/hobby?${parameters.toString()}`
}

function baseItem(
  entry: ItFactorEntry,
  lens: 'market' | 'players' | 'it',
): Omit<HobbyDecisionDeskItem, 'nativeSignal' | 'evidence'> {
  return {
    id: entry.id,
    playerName: entry.player.name,
    sport: entry.sport,
    teamName: entry.team.name,
    position: entry.player.position,
    href: boardSearchHref(lens, entry.player.name),
    it: {
      tier: entry.tier,
      score: entry.score,
      trajectory: entry.trajectory,
      marketEvidence: entry.market.evidence,
    },
  }
}

function marketBaseItem(
  item: HobbyMasterFeedItem,
  entry: ItFactorEntry | undefined,
): Omit<HobbyDecisionDeskItem, 'nativeSignal' | 'evidence'> {
  if (entry) return baseItem(entry, 'market')
  return {
    id: item.subject.id,
    playerName: item.subject.name,
    sport: item.subject.domain,
    teamName: 'Observed market',
    position: item.subject.type === 'pokemon_character'
      ? 'Character'
      : 'Subject',
    href: boardSearchHref('market', item.subject.name),
    it: null,
  }
}

function nativeMarketDetail(item: HobbyMasterFeedItem): string {
  const signal = item.assessment.marketSignal
  return (
    `$${Math.round(signal.latestTwelveMonthSalesUsd).toLocaleString('en-US')}` +
    ' TTM completed sales'
  )
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function rounded(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function multiple(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 1 : current
  return current / prior
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function geometricMedian(values: readonly number[]): number | null {
  const logs = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .map(Math.log)
  const middle = median(logs)
  return middle === null ? null : Math.exp(middle)
}

function dollars(value: number): string {
  return `$${Math.round(Math.abs(value)).toLocaleString('en-US')}`
}

function buildCompoundingSignals(
  input: HobbyDecisionDeskInput,
): Map<string, HobbyCompoundingSignal> {
  const itemBySourceKey = new Map(
    input.marketItems.map((item) => [item.subject.id, item]),
  )
  const eligibleSourceKeys = new Set(
    input.marketItems
      .filter((item) => (
        item.assessment.buildQualification.checks.comparisonEligible
      ))
      .map((item) => item.subject.id),
  )
  const eligibleRows = input.marketRows.filter((row) => (
    eligibleSourceKeys.has(row.sourceKey) &&
    row.monthlySalesUsd.length === 18
  ))
  const domainBySourceKey = new Map(
    input.marketItems.map((item) => [
      item.subject.id,
      item.subject.domain,
    ]),
  )
  const domainMultiples = new Map<
    HobbyMasterFeedItem['subject']['domain'],
    number[]
  >()
  for (const row of eligibleRows) {
    const domain = domainBySourceKey.get(row.sourceKey)
    if (!domain) continue
    const middleSix = sum(row.monthlySalesUsd.slice(6, 12))
    const currentSix = sum(row.monthlySalesUsd.slice(12, 18))
    if (middleSix < 50_000 || currentSix < 50_000) continue
    const values = domainMultiples.get(domain) ?? []
    values.push(multiple(currentSix, middleSix))
    domainMultiples.set(domain, values)
  }
  const domainBaseline = new Map(
    [...domainMultiples].map(([domain, values]) => [
      domain,
      geometricMedian(values) ?? 1,
    ]),
  )
  const priorPercentileBySourceKey = midrankPercentiles(
    eligibleRows,
    (row) => sum(row.monthlySalesUsd.slice(6, 12)),
    (row) => row.sourceKey,
  )
  const currentPercentileBySourceKey = midrankPercentiles(
    eligibleRows,
    (row) => sum(row.monthlySalesUsd.slice(-6)),
    (row) => row.sourceKey,
  )
  return new Map(input.marketRows.flatMap((row) => {
    const item = itemBySourceKey.get(row.sourceKey)
    if (!item || row.monthlySalesUsd.length !== 18) return []
    const breakout = item.assessment.breakoutSignal ?? null
    const middleSix = sum(row.monthlySalesUsd.slice(6, 12))
    const currentSix = sum(row.monthlySalesUsd.slice(12, 18))
    const baseline = domainBaseline.get(item.subject.domain) ?? 0
    return [[
      row.sourceKey,
      buildHobbyCompoundingSignal({
        monthlySalesUsd: row.monthlySalesUsd,
        priorSixMonthGlobalPercentile:
          priorPercentileBySourceKey.get(row.sourceKey) ?? 0,
        currentSixMonthGlobalPercentile:
          currentPercentileBySourceKey.get(row.sourceKey) ?? 0,
        domainRelativeSixMonthMultiple: baseline <= 0
          ? 0
          : multiple(currentSix, middleSix) / baseline,
        comparisonEligible:
          item.assessment.buildQualification.checks.comparisonEligible,
        sourceCurrent:
          item.assessment.buildQualification.checks.sourceCurrent,
        completeEighteenMonthHistory:
          item.assessment.buildQualification.checks
            .completeEighteenMonthHistory,
        breakoutSignal: breakout,
      }),
    ] as const]
  }))
}

function demandShare(
  items: readonly HobbyMasterFeedItem[],
  fraction: number,
): { subjectCount: number; demandSharePct: number } {
  const sortedDemand = items
    .map((item) => item.assessment.marketSignal.latestTwelveMonthSalesUsd)
    .toSorted((left, right) => right - left)
  const total = sum(sortedDemand)
  const subjectCount = sortedDemand.length === 0
    ? 0
    : Math.max(1, Math.ceil(sortedDemand.length * fraction))
  return {
    subjectCount,
    demandSharePct: total <= 0
      ? 0
      : rounded(100 * sum(sortedDemand.slice(0, subjectCount)) / total),
  }
}

export function buildHobbyDecisionDesk(
  input: HobbyDecisionDeskInput,
): HobbyDecisionDesk {
  const itBySourceKey = new Map(
    input.itEntries.flatMap((entry) => (
      entry.market.sourceKey !== null &&
      (
        entry.market.identityStatus === 'exact' ||
        entry.market.identityStatus === 'normalized'
      )
        ? [[entry.market.sourceKey, entry] as const]
        : []
    )),
  )
  const compoundingBySourceKey = buildCompoundingSignals(input)

  const compoundingNow = input.marketItems
    .flatMap((item): HobbyDecisionDeskItem[] => {
      const entry = itBySourceKey.get(item.subject.id)
      const compounding = compoundingBySourceKey.get(item.subject.id)
      if (
        !entry ||
        !isHighConvictionIt(entry) ||
        compounding?.state !== 'tail_compounder'
      ) {
        return []
      }
      return [{
        ...baseItem(entry, 'market'),
        nativeSignal: {
          label: 'Observed compounding',
          value: `+${dollars(compounding.sixMonthDemandAddedUsd)} / 6M`,
          detail:
            `${compounding.sixMonthMultiple.toFixed(2)}× demand · ` +
            `${compounding.domainRelativeSixMonthMultiple.toFixed(2)}× ` +
            'category pace',
          score: compounding.sixMonthDemandAddedUsd,
        },
        evidence: [
          `P${compounding.currentSixMonthGlobalPercentile.toFixed(1)} demand tail`,
          `${compounding.confirmingMonths}/6 months confirmed`,
          `${compounding.currentSixMonthEffectiveMonths.toFixed(1)} effective months`,
        ],
      }]
    })
    .toSorted((left, right) => (
      right.nativeSignal.score - left.nativeSignal.score ||
      (right.it?.score ?? 0) - (left.it?.score ?? 0) ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const narrativeMomentum = input.marketItems
    .filter((item) => item.assessment.breakoutSignal?.surfaced)
    .flatMap((item): HobbyDecisionDeskItem[] => {
      const entry = itBySourceKey.get(item.subject.id)
      const breakout = item.assessment.breakoutSignal
      if (!entry || !isHighConvictionIt(entry) || !breakout) return []
      return [{
        ...baseItem(entry, 'market'),
        nativeSignal: {
          label: 'Breakout Radar',
          value: breakout.rank === null
            ? `Breakout ${breakout.score.toFixed(1)}`
            : `Breakout #${breakout.rank}`,
          detail:
            `+$${Math.round(
              breakout.sixMonthDemandAddedUsd,
            ).toLocaleString('en-US')} six-month demand`,
          score: breakout.rank ?? Number.MAX_SAFE_INTEGER,
        },
        evidence: [
          `${breakout.confirmingMonths}/6 months confirmed`,
          `${breakout.relativeSixMonthMultiple.toFixed(2)}× category pace`,
          `${breakout.currentSixMonthEffectiveMonths.toFixed(1)} effective months`,
        ],
      }]
    })
    .toSorted((left, right) => (
      left.nativeSignal.score - right.nativeSignal.score ||
      (right.it?.score ?? 0) - (left.it?.score ?? 0) ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const noiseCheck = input.marketItems
    .flatMap((item): HobbyDecisionDeskItem[] => {
      const compounding = compoundingBySourceKey.get(item.subject.id)
      if (compounding?.state !== 'tail_concentration') return []
      const entry = itBySourceKey.get(item.subject.id)
      return [{
        ...marketBaseItem(item, entry),
        nativeSignal: {
          label: 'Breadth not confirmed',
          value:
            `P${compounding.currentSixMonthGlobalPercentile.toFixed(1)} tail`,
          detail:
            `${(compounding.currentSixMonthPeakShare * 100).toFixed(0)}% ` +
            'peak-month share · repeatability not yet confirmed',
          score: compounding.currentSixMonthPeakShare,
        },
        evidence: [
          `${compounding.confirmingMonths}/6 months confirmed`,
          `${compounding.currentSixMonthEffectiveMonths.toFixed(1)} effective months`,
          `${compounding.currentThreeMonthEffectiveMonths.toFixed(1)} effective recent months`,
        ],
      }]
    })
    .toSorted((left, right) => (
      right.nativeSignal.score - left.nativeSignal.score ||
      (right.it?.score ?? 0) - (left.it?.score ?? 0) ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const narrativeRunway = input.graduationItems
    .filter((item) => (
      item.graduation.band === 'on_deck' ||
      item.graduation.band === 'approaching'
    ))
    .flatMap((item): HobbyDecisionDeskItem[] => {
      const entry = itBySourceKey.get(item.identity.gemRateSourceKey)
      if (!entry) return []
      const band = item.graduation.band === 'on_deck'
        ? 'On Deck'
        : 'Approaching'
      return [{
        ...baseItem(entry, 'players'),
        nativeSignal: {
          label: 'Graduation Board',
          value: item.graduation.globalRank === null
            ? band
            : `${band} #${item.graduation.globalRank}`,
          detail:
            `${item.graduation.index?.toFixed(1) ?? '—'} readiness · ` +
            `${item.graduation.primaryBlocker.replaceAll('_', ' ')} next`,
          score:
            item.graduation.globalRank ?? Number.MAX_SAFE_INTEGER,
        },
        evidence: [
          `${band} path`,
          `${item.graduation.index?.toFixed(1) ?? '—'} readiness`,
          `${item.graduation.primaryBlocker.replaceAll('_', ' ')} next`,
        ],
      }]
    })
    .toSorted((left, right) => (
      left.nativeSignal.score - right.nativeSignal.score ||
      (right.it?.score ?? 0) - (left.it?.score ?? 0) ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const narrativePressure = input.marketItems
    .flatMap((item): HobbyDecisionDeskItem[] => {
      const entry = itBySourceKey.get(item.subject.id)
      if (!entry || !isHighConvictionIt(entry)) return []
      const exit = buildHobbyExitWindowSignal(item)
      if (!exit.eligible) return []
      return [{
        ...baseItem(entry, 'market'),
        nativeSignal: {
          label: 'Exit Window',
          value: `Pressure ${exit.score.toFixed(1)}`,
          detail:
            `${Math.abs(exit.sixMonthChange * 100).toFixed(0)}% ` +
            'six-month decline · subject-level signal',
          score: exit.score,
        },
        evidence: [
          `${Math.abs(exit.sixMonthChange * 100).toFixed(0)}% six-month decline`,
          nativeMarketDetail(item),
          compoundingBySourceKey.get(item.subject.id)?.state === 'tail_pressure'
            ? 'Lost observed tail position'
            : 'Exit pressure confirmed',
        ],
      }]
    })
    .toSorted((left, right) => (
      right.nativeSignal.score - left.nativeSignal.score ||
      (right.it?.score ?? 0) - (left.it?.score ?? 0) ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const storyBeforeScale = input.itEntries
    .filter((entry) => (
      entry.trajectory === 'rising' &&
      (
        entry.market.evidence === 'forming' ||
        entry.market.evidence === 'thin'
      )
    ))
    .map((entry): HobbyDecisionDeskItem => ({
      ...baseItem(entry, 'it'),
      nativeSignal: {
        label: 'Market evidence',
        value: entry.market.evidence[0]!.toLocaleUpperCase('en-US') +
          entry.market.evidence.slice(1),
        detail: 'Rising narrative is ahead of confirmed demand scale',
        score: entry.score,
      },
      evidence: [
        `${entry.trajectory} IT trajectory`,
        `${entry.market.evidence} market evidence`,
        'Demand scale not yet confirmed',
      ],
    }))
    .toSorted((left, right) => (
      right.nativeSignal.score - left.nativeSignal.score ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const queues: HobbyDecisionQueue[] = [
    {
      id: 'compounding_now',
      title: 'Compounding now',
      eyebrow: 'SCALE + REPEATABILITY + NARRATIVE',
      rule: 'Retained P99 tail + dollar/share growth + breadth + High/Icon IT',
      interpretation:
        'Large observed demand is growing across repeated windows, gaining versus its category, and confirming broadly by month.',
      sourceBoardLabel: 'Open Build Board',
      sourceBoardHref: '/hobby?lens=market',
      items: compoundingNow,
    },
    {
      id: 'narrative_momentum',
      title: 'Inflecting',
      eyebrow: 'MOMENTUM + NARRATIVE',
      rule: 'Breakout Radar and High/Icon IT',
      interpretation:
        'Completed-sales acceleration is confirming an already powerful story.',
      sourceBoardLabel: 'Open Breakout Radar',
      sourceBoardHref: '/hobby?lens=market&screen=breakout',
      items: narrativeMomentum,
    },
    {
      id: 'noise_check',
      title: 'Scale without breadth',
      eyebrow: 'NOISE CHECK',
      rule: 'P99 retained/entrant demand with failed monthly breadth gates',
      interpretation:
        'The scale is real, but too much of it sits in too few months to call the pattern repeatable yet.',
      sourceBoardLabel: 'Inspect market evidence',
      sourceBoardHref: '/hobby?lens=market&posture=all',
      items: noiseCheck,
    },
    {
      id: 'narrative_pressure',
      title: 'At risk',
      eyebrow: 'RISK + NARRATIVE',
      rule: 'Exit-eligible and High/Icon IT',
      interpretation:
        'Strong hobby belief remains, but completed-sales demand is deteriorating.',
      sourceBoardLabel: 'Open Exit view',
      sourceBoardHref:
        '/hobby?lens=market&posture=all&sort=exit_window&direction=desc',
      items: narrativePressure,
    },
    {
      id: 'narrative_runway',
      title: 'Path catching the story',
      eyebrow: 'PATH + NARRATIVE',
      rule: 'IT-flagged and On Deck/Approaching',
      interpretation:
        'The player path is moving toward the same Build standard the story anticipates.',
      sourceBoardLabel: 'Open Graduation Board',
      sourceBoardHref: '/hobby?lens=players',
      items: narrativeRunway,
    },
    {
      id: 'story_before_scale',
      title: 'Story before scale',
      eyebrow: 'NARRATIVE LEAD',
      rule: 'Rising IT with forming/thin market evidence',
      interpretation:
        'The story is strengthening while measurable demand is still forming.',
      sourceBoardLabel: 'Open IT Board',
      sourceBoardHref: '/hobby?lens=it',
      items: storyBeforeScale,
    },
  ]
  const uniqueSubjects = new Set(
    queues.flatMap((queue) => queue.items.map((item) => item.id)),
  )
  const observedItems = input.marketItems.filter((item) => (
    item.assessment.buildQualification.checks.comparisonEligible
  ))
  const observedTtmDemandUsd = sum(observedItems.map(
    (item) => item.assessment.marketSignal.latestTwelveMonthSalesUsd,
  ))
  const signals = [...compoundingBySourceKey.values()]
  const priorTailSignals = signals.filter((signal) => (
    signal.state !== 'withheld' &&
    signal.priorSixMonthGlobalPercentile >= 99
  ))
  const retainedTailSignals = priorTailSignals.filter((signal) => (
    signal.currentSixMonthGlobalPercentile >= 99
  ))
  return {
    queues,
    uniqueSubjectCount: uniqueSubjects.size,
    intersectionCount: queues.reduce(
      (total, queue) => total + queue.items.length,
      0,
    ),
    powerLaw: {
      modelVersion: HOBBY_COMPOUNDING_MODEL_VERSION,
      observedUniverseCount: observedItems.length,
      observedTtmDemandUsd,
      topOnePercent: demandShare(observedItems, 0.01),
      topTenPercent: demandShare(observedItems, 0.1),
      priorTail: {
        subjectCount: priorTailSignals.length,
        retainedCount: retainedTailSignals.length,
        retentionPct: priorTailSignals.length === 0
          ? 0
          : rounded(
              100 * retainedTailSignals.length / priorTailSignals.length,
            ),
      },
      confirmedTailEntrantCount: signals.filter(
        (signal) => signal.state === 'tail_entrant',
      ).length,
      descriptiveOnly: true,
      interpretation:
        'observed_universe_concentration_not_fitted_power_law_or_future_return',
    },
  }
}

export function isHobbyDecisionDeskArtifact(
  value: unknown,
): value is HobbyDecisionDeskArtifact {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<HobbyDecisionDeskArtifact>
  const desk = candidate.desk
  if (
    !desk ||
    !Array.isArray(desk.queues) ||
    desk.queues.length !== HOBBY_DECISION_QUEUE_IDS.length
  ) {
    return false
  }
  const powerLaw = desk.powerLaw
  const validCount = (count: unknown): count is number => (
    Number.isSafeInteger(count) && Number(count) >= 0
  )
  const validFinite = (number: unknown): number is number => (
    typeof number === 'number' && Number.isFinite(number) && number >= 0
  )
  return (
    candidate.schemaVersion === HOBBY_DECISION_DESK_SCHEMA_VERSION &&
    typeof candidate.snapshot?.generatedAt === 'string' &&
    typeof candidate.snapshot.marketDataThrough === 'string' &&
    typeof candidate.snapshot.marketRowsSha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(candidate.snapshot.marketRowsSha256) &&
    typeof candidate.snapshot.itReviewedAsOf === 'string' &&
    typeof candidate.snapshot.itNextReviewBy === 'string' &&
    typeof candidate.snapshot.pathDataThrough === 'string' &&
    candidate.snapshot.compoundingModelVersion ===
      HOBBY_COMPOUNDING_MODEL_VERSION &&
    Array.isArray(candidate.coverage?.marketSports) &&
    candidate.coverage.marketSports.join('|') ===
      'baseball|football|basketball|hockey' &&
    Array.isArray(candidate.coverage.pathSports) &&
    candidate.coverage.pathSports.join('|') === 'football|basketball' &&
    Array.isArray(candidate.coverage.limitations) &&
    validCount(desk.uniqueSubjectCount) &&
    validCount(desk.intersectionCount) &&
    powerLaw?.modelVersion === HOBBY_COMPOUNDING_MODEL_VERSION &&
    validCount(powerLaw.observedUniverseCount) &&
    validFinite(powerLaw.observedTtmDemandUsd) &&
    validCount(powerLaw.topOnePercent?.subjectCount) &&
    validFinite(powerLaw.topOnePercent.demandSharePct) &&
    powerLaw.topOnePercent.demandSharePct <= 100 &&
    validCount(powerLaw.topTenPercent?.subjectCount) &&
    validFinite(powerLaw.topTenPercent.demandSharePct) &&
    powerLaw.topTenPercent.demandSharePct <= 100 &&
    validCount(powerLaw.priorTail?.subjectCount) &&
    validCount(powerLaw.priorTail.retainedCount) &&
    validFinite(powerLaw.priorTail.retentionPct) &&
    powerLaw.priorTail.retentionPct <= 100 &&
    validCount(powerLaw.confirmedTailEntrantCount) &&
    powerLaw.descriptiveOnly === true &&
    powerLaw.interpretation ===
      'observed_universe_concentration_not_fitted_power_law_or_future_return' &&
    desk.queues.every((queue, index) => (
      queue.id === HOBBY_DECISION_QUEUE_IDS[index] &&
      typeof queue.title === 'string' &&
      typeof queue.eyebrow === 'string' &&
      typeof queue.rule === 'string' &&
      typeof queue.interpretation === 'string' &&
      typeof queue.sourceBoardLabel === 'string' &&
      typeof queue.sourceBoardHref === 'string' &&
      queue.sourceBoardHref.startsWith('/hobby?') &&
      Array.isArray(queue.items) &&
      queue.items.every((item) => (
        typeof item.id === 'string' &&
        typeof item.playerName === 'string' &&
        typeof item.sport === 'string' &&
        typeof item.teamName === 'string' &&
        typeof item.position === 'string' &&
        typeof item.href === 'string' &&
        item.href.startsWith('/hobby?') &&
        (
          item.it === null ||
          (
            typeof item.it?.tier === 'string' &&
            validFinite(item.it.score) &&
            typeof item.it.trajectory === 'string' &&
            typeof item.it.marketEvidence === 'string'
          )
        ) &&
        typeof item.nativeSignal?.label === 'string' &&
        typeof item.nativeSignal.value === 'string' &&
        typeof item.nativeSignal.detail === 'string' &&
        validFinite(item.nativeSignal.score) &&
        Array.isArray(item.evidence) &&
        item.evidence.length <= 3 &&
        item.evidence.every((evidence) => typeof evidence === 'string')
      ))
    ))
  )
}
