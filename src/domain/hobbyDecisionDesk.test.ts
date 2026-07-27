import { describe, expect, it } from 'vitest'
import type {
  BinderGraduationV2Item,
} from './binderGraduationIndexV2'
import {
  buildHobbyDecisionDesk,
} from './hobbyDecisionDesk'
import type {
  HobbyMasterFeedItem,
} from './hobbyMasterRanking'
import type {
  ItFactorEntry,
} from './itFactor'

function itEntry(input: {
  id: string
  name: string
  sourceKey: string | null
  identityStatus?: ItFactorEntry['market']['identityStatus']
  tier?: ItFactorEntry['tier']
  score?: number
  evidence?: ItFactorEntry['market']['evidence']
}): ItFactorEntry {
  return {
    id: input.id,
    player: {
      name: input.name,
      normalizedName: input.name.toLocaleLowerCase('en-US'),
      position: 'SS',
      status: 'young_star',
    },
    sport: 'baseball',
    league: 'MLB',
    team: { code: 'TST', name: 'Test Club' },
    score: input.score ?? 90,
    tier: input.tier ?? 'high',
    confidence: 90,
    trajectory: 'rising',
    rationale:
      'A substantive test rationale that is intentionally long enough to be useful.',
    signals: ['pedigree', 'tools'],
    recheckTriggers: ['Next material milestone.'],
    sourceIds: ['test'],
    market: {
      evidence: input.evidence ?? 'confirmed',
      sourceKey: input.sourceKey,
      sourceName: input.sourceKey === null ? null : input.name,
      identityStatus:
        input.identityStatus ??
        (input.sourceKey === null ? 'not_found' : 'exact'),
      trailingTwelveMonthSalesUsd: 1_000_000,
      recentSixMonthSalesUsd: 600_000,
      priorSixMonthSalesUsd: 400_000,
      sportRank: 10,
      sportPercentile: 90,
    },
    lastReviewedAt: '2026-07-26',
  }
}

function marketItem(input: {
  sourceKey: string
  name: string
  rank: number
  build?: boolean
  breakoutRank?: number
  exitEligible?: boolean
}): HobbyMasterFeedItem {
  const decline = input.exitEligible ? Math.log(0.7) : Math.log(1.1)
  return {
    subject: {
      id: input.sourceKey,
      name: input.name,
    },
    masterRank: input.rank,
    assessment: {
      posture: input.build ? 'build_candidate' : 'watch',
      buildQualification: {
        eligible: input.build ?? false,
        passed: input.build ? 9 : 5,
        required: 9,
        checks: {
          comparisonEligible: true,
          sourceCurrent: true,
          completeEighteenMonthHistory: true,
        },
      },
      marketSignal: {
        score: 80,
        latestTwelveMonthSalesUsd: 2_000_000,
        annualizedCurrentSixMonthSalesUsd: 1_000_000,
        globalObservedPercentile: 95,
        downsideProtectionScore: 70,
        components: {
          currentRunRateMagnitude: 80,
          trailingTwelveMonthMagnitude: 80,
          persistence: 90,
          shockResistance: 90,
        },
        diagnostics: {
          yearOverYearSixMonthLogGrowth: decline,
          recentThreeMonthYearOverYearLogGrowth: decline,
        },
      },
      breakoutSignal: input.breakoutRank === undefined
        ? undefined
        : {
            surfaced: true,
            rank: input.breakoutRank,
            score: 75,
            sixMonthDemandAddedUsd: 500_000,
          },
    },
  } as unknown as HobbyMasterFeedItem
}

function graduationItem(
  sourceKey: string,
  name: string,
  rank: number,
): BinderGraduationV2Item {
  return {
    player: { name },
    identity: { gemRateSourceKey: sourceKey },
    graduation: {
      band: 'on_deck',
      globalRank: rank,
      index: 82,
      primaryBlocker: 'persistence',
    },
  } as unknown as BinderGraduationV2Item
}

describe('Hobby Decision Desk', () => {
  it('qualifies intersections only through reviewed market source keys', () => {
    const exact = itEntry({
      id: 'exact',
      name: 'Exact Match',
      sourceKey: 'athlete|baseball|Exact Match',
    })
    const ambiguous = itEntry({
      id: 'ambiguous',
      name: 'Ambiguous Match',
      sourceKey: null,
      identityStatus: 'ambiguous',
    })
    const desk = buildHobbyDecisionDesk({
      itEntries: [exact, ambiguous],
      buildItems: [
        marketItem({
          sourceKey: 'athlete|baseball|Exact Match',
          name: 'Exact Match',
          rank: 2,
          build: true,
        }),
        marketItem({
          sourceKey: 'athlete|baseball|Ambiguous Match',
          name: 'Ambiguous Match',
          rank: 1,
          build: true,
        }),
      ],
      breakoutItems: [],
      exitItems: [],
      graduationItems: [],
    })

    expect(
      desk.queues.find((queue) => queue.id === 'durable_franchise')?.items,
    ).toHaveLength(1)
    expect(desk.queues[0]?.items[0]?.playerName).toBe('Exact Match')
  })

  it('retains each native model order instead of blending scores', () => {
    const first = itEntry({
      id: 'first',
      name: 'Native First',
      sourceKey: 'athlete|baseball|Native First',
      score: 84,
    })
    const second = itEntry({
      id: 'second',
      name: 'IT First',
      sourceKey: 'athlete|baseball|IT First',
      score: 99,
      tier: 'icon',
    })
    const desk = buildHobbyDecisionDesk({
      itEntries: [first, second],
      buildItems: [],
      breakoutItems: [
        marketItem({
          sourceKey: first.market.sourceKey!,
          name: first.player.name,
          rank: 200,
          breakoutRank: 1,
        }),
        marketItem({
          sourceKey: second.market.sourceKey!,
          name: second.player.name,
          rank: 100,
          breakoutRank: 2,
        }),
      ],
      exitItems: [],
      graduationItems: [],
    })
    const queue = desk.queues.find(
      (candidate) => candidate.id === 'narrative_momentum',
    )

    expect(queue?.items.map((item) => item.playerName)).toEqual([
      'Native First',
      'IT First',
    ])
  })

  it('keeps path and early-narrative findings explicit', () => {
    const path = itEntry({
      id: 'path',
      name: 'Path Player',
      sourceKey: 'athlete|baseball|Path Player',
      tier: 'emerging',
      score: 80,
    })
    const early = itEntry({
      id: 'early',
      name: 'Early Narrative',
      sourceKey: 'athlete|baseball|Early Narrative',
      tier: 'emerging',
      score: 80,
      evidence: 'forming',
    })
    const desk = buildHobbyDecisionDesk({
      itEntries: [path, early],
      buildItems: [],
      breakoutItems: [],
      exitItems: [],
      graduationItems: [
        graduationItem(
          path.market.sourceKey!,
          path.player.name,
          3,
        ),
      ],
    })

    expect(
      desk.queues.find((queue) => queue.id === 'narrative_runway')
        ?.items[0]?.playerName,
    ).toBe('Path Player')
    expect(
      desk.queues.find((queue) => queue.id === 'story_before_scale')
        ?.items[0]?.nativeSignal.detail,
    ).toBe('Rising narrative is ahead of confirmed demand scale')
  })
})
