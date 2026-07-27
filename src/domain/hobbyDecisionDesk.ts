import type {
  HobbyMasterFeedItem,
} from './hobbyMasterRanking.js'
import {
  buildHobbyExitWindowSignal,
} from './hobbyLiquidationSignal.js'
import type {
  ItFactorEntry,
} from './itFactor.js'

export const HOBBY_DECISION_DESK_SCHEMA_VERSION =
  'backstop-hobby-decision-desk.v1' as const

export const HOBBY_DECISION_QUEUE_IDS = [
  'durable_franchise',
  'narrative_momentum',
  'narrative_runway',
  'narrative_pressure',
  'story_before_scale',
] as const

export type HobbyDecisionQueueId =
  (typeof HOBBY_DECISION_QUEUE_IDS)[number]

export interface HobbyDecisionDeskItem {
  id: string
  playerName: string
  sport: ItFactorEntry['sport']
  teamName: string
  position: string
  href: string
  it: {
    tier: ItFactorEntry['tier']
    score: number
    trajectory: ItFactorEntry['trajectory']
    marketEvidence: ItFactorEntry['market']['evidence']
  }
  nativeSignal: {
    label: string
    value: string
    detail: string
    score: number
  }
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
  buildItems: readonly HobbyMasterFeedItem[]
  breakoutItems: readonly HobbyMasterFeedItem[]
  exitItems: readonly HobbyMasterFeedItem[]
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
): Omit<HobbyDecisionDeskItem, 'nativeSignal'> {
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

function nativeMarketDetail(item: HobbyMasterFeedItem): string {
  const signal = item.assessment.marketSignal
  return (
    `$${Math.round(signal.latestTwelveMonthSalesUsd).toLocaleString('en-US')}` +
    ' TTM completed sales'
  )
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

  const durableFranchise = input.buildItems
    .filter((item) => item.assessment.buildQualification.eligible)
    .flatMap((item): HobbyDecisionDeskItem[] => {
      const entry = itBySourceKey.get(item.subject.id)
      if (!entry || !isHighConvictionIt(entry)) return []
      return [{
        ...baseItem(entry, 'market'),
        nativeSignal: {
          label: 'Build Board',
          value: item.masterRank === null ? 'Build' : `Build #${item.masterRank}`,
          detail: nativeMarketDetail(item),
          score: item.masterRank ?? Number.MAX_SAFE_INTEGER,
        },
      }]
    })
    .toSorted((left, right) => (
      left.nativeSignal.score - right.nativeSignal.score ||
      right.it.score - left.it.score ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const narrativeMomentum = input.breakoutItems
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
      }]
    })
    .toSorted((left, right) => (
      left.nativeSignal.score - right.nativeSignal.score ||
      right.it.score - left.it.score ||
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
      }]
    })
    .toSorted((left, right) => (
      left.nativeSignal.score - right.nativeSignal.score ||
      right.it.score - left.it.score ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const narrativePressure = input.exitItems
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
      }]
    })
    .toSorted((left, right) => (
      right.nativeSignal.score - left.nativeSignal.score ||
      right.it.score - left.it.score ||
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
    }))
    .toSorted((left, right) => (
      right.nativeSignal.score - left.nativeSignal.score ||
      left.playerName.localeCompare(right.playerName, 'en-US')
    ))

  const queues: HobbyDecisionQueue[] = [
    {
      id: 'durable_franchise',
      title: 'Durable franchise',
      eyebrow: 'MARKET + NARRATIVE',
      rule: 'Build-qualified and High/Icon IT',
      interpretation:
        'The absolute demand standard and durable hobby belief agree.',
      sourceBoardLabel: 'Open Build Board',
      sourceBoardHref: '/hobby?lens=market',
      items: durableFranchise,
    },
    {
      id: 'narrative_momentum',
      title: 'Narrative with momentum',
      eyebrow: 'MOMENTUM + NARRATIVE',
      rule: 'Breakout Radar and High/Icon IT',
      interpretation:
        'Completed-sales acceleration is confirming an already powerful story.',
      sourceBoardLabel: 'Open Breakout Radar',
      sourceBoardHref: '/hobby?lens=market&screen=breakout',
      items: narrativeMomentum,
    },
    {
      id: 'narrative_runway',
      title: 'Narrative runway',
      eyebrow: 'PATH + NARRATIVE',
      rule: 'IT-flagged and On Deck/Approaching',
      interpretation:
        'The player path is moving toward the same Build standard the story anticipates.',
      sourceBoardLabel: 'Open Graduation Board',
      sourceBoardHref: '/hobby?lens=players',
      items: narrativeRunway,
    },
    {
      id: 'narrative_pressure',
      title: 'Narrative under pressure',
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
      id: 'story_before_scale',
      title: 'Early narrative',
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
  return {
    queues,
    uniqueSubjectCount: uniqueSubjects.size,
    intersectionCount: queues.reduce(
      (total, queue) => total + queue.items.length,
      0,
    ),
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
  return (
    candidate.schemaVersion === HOBBY_DECISION_DESK_SCHEMA_VERSION &&
    typeof candidate.snapshot?.generatedAt === 'string' &&
    typeof candidate.snapshot.marketDataThrough === 'string' &&
    typeof candidate.snapshot.marketRowsSha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(candidate.snapshot.marketRowsSha256) &&
    typeof candidate.snapshot.itReviewedAsOf === 'string' &&
    typeof candidate.snapshot.itNextReviewBy === 'string' &&
    typeof candidate.snapshot.pathDataThrough === 'string' &&
    Array.isArray(candidate.coverage?.marketSports) &&
    candidate.coverage.marketSports.join('|') ===
      'baseball|football|basketball|hockey' &&
    Array.isArray(candidate.coverage.pathSports) &&
    candidate.coverage.pathSports.join('|') === 'football|basketball' &&
    Array.isArray(candidate.coverage.limitations) &&
    desk.queues.every((queue, index) => (
      queue.id === HOBBY_DECISION_QUEUE_IDS[index] &&
      Array.isArray(queue.items) &&
      queue.items.every((item) => (
        typeof item.id === 'string' &&
        typeof item.playerName === 'string' &&
        typeof item.href === 'string' &&
        item.href.startsWith('/hobby?')
      ))
    ))
  )
}
