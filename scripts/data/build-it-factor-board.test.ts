import { describe, expect, it } from 'vitest'
import marketSnapshotJson from '../../api/_data/gemrate-hobby-sales.json' with {
  type: 'json',
}
import boardJson from '../../src/data/it-factor-board.v1.json' with {
  type: 'json',
}
import badgeIndexJson from '../../src/data/it-factor-badges.v1.json' with {
  type: 'json',
}
import decisionDeskJson from '../../src/data/hobby-decision-desk.v1.json' with {
  type: 'json',
}
import {
  hobbyMasterCatalog,
} from '../../api/_hobby-master-ranking.js'
import {
  isHobbyDecisionDeskArtifact,
} from '../../src/domain/hobbyDecisionDesk.js'
import {
  IT_FACTOR_SPORTS,
  isItFactorBadgeIndex,
  isItFactorBoardResponse,
  type ItFactorBoardResponse,
} from '../../src/domain/itFactor.js'
import {
  buildItFactorBoard,
  type GemRateSnapshot,
} from './build-it-factor-board.js'
import { baseballItFactorCuration } from './it-factor/baseball.js'
import { basketballItFactorCuration } from './it-factor/basketball.js'
import { footballItFactorCuration } from './it-factor/football.js'
import { hockeyItFactorCuration } from './it-factor/hockey.js'
import { IT_FACTOR_EXPECTED_TEAMS } from './it-factor/teams.js'

function board(): ItFactorBoardResponse {
  if (!isItFactorBoardResponse(boardJson)) {
    throw new Error('Generated IT Factor artifact failed its runtime contract.')
  }
  return boardJson
}

describe('generated IT Factor board', () => {
  it('is current with the checked-in curations and market snapshot', () => {
    const rebuilt = buildItFactorBoard(
      [
        baseballItFactorCuration,
        footballItFactorCuration,
        basketballItFactorCuration,
        hockeyItFactorCuration,
      ],
      marketSnapshotJson as GemRateSnapshot,
    )
    expect(rebuilt).toEqual(boardJson)
    expect(isItFactorBadgeIndex(badgeIndexJson)).toBe(true)
    expect(badgeIndexJson.entries).toEqual(rebuilt.entries.map((entry) => ({
      id: entry.id,
      sport: entry.sport,
      player: {
        name: entry.player.name,
        normalizedName: entry.player.normalizedName,
      },
      score: entry.score,
      tier: entry.tier,
      confidence: entry.confidence,
    })))
  })

  it('rejects malformed licensed-market provenance before publishing', () => {
    const malformed = structuredClone(
      marketSnapshotJson,
    ) as GemRateSnapshot
    malformed.rowsSha256 = 'not-a-sha256'
    expect(() => buildItFactorBoard(
      [
        baseballItFactorCuration,
        footballItFactorCuration,
        basketballItFactorCuration,
        hockeyItFactorCuration,
      ],
      malformed,
    )).toThrow('GemRate snapshot metadata is invalid')
  })

  it('covers every MLB, NFL, NBA, and NHL team with one to three flags', () => {
    const snapshot = board()
    expect(snapshot.coverage.teamCount).toBe(124)
    expect(snapshot.coverage.entryCount).toBe(319)

    for (const sport of IT_FACTOR_SPORTS) {
      const entries = snapshot.entries.filter((entry) => (
        entry.sport === sport
      ))
      for (const team of IT_FACTOR_EXPECTED_TEAMS[sport]) {
        const teamEntries = entries.filter((entry) => (
          entry.team.code === team.code &&
          entry.team.name === team.name
        ))
        expect(
          teamEntries.length,
          `${sport}:${team.code} coverage`,
        ).toBeGreaterThanOrEqual(1)
        expect(
          teamEntries.length,
          `${sport}:${team.code} coverage`,
        ).toBeLessThanOrEqual(3)
      }
    }
  })

  it('keeps identities, sources, and review metadata unambiguous', () => {
    const snapshot = board()
    const playerKeys = snapshot.entries.map((entry) => (
      `${entry.sport}:${entry.player.normalizedName}`
    ))
    const sourceIds = snapshot.sources.map((source) => source.id)
    const sourceUrls = snapshot.sources.map((source) => source.url)

    expect(new Set(playerKeys).size).toBe(playerKeys.length)
    expect(new Set(sourceIds).size).toBe(sourceIds.length)
    expect(new Set(sourceUrls).size).toBe(sourceUrls.length)
    expect(snapshot.entries.every((entry) => (
      entry.market.identityStatus !== 'ambiguous' &&
      (
        entry.market.identityStatus === 'not_found'
          ? entry.market.sourceKey === null
          : entry.market.sourceKey !== null
      ) &&
      entry.recheckTriggers.length >= 1 &&
      entry.sourceIds.includes('gemrate-hobby-2026-06')
    ))).toBe(true)
  })

  it('joins every observed IT identity to the Master market universe', () => {
    const snapshot = board()
    const masterIds = new Set(
      hobbyMasterCatalog.items.map((item) => item.subject.id),
    )
    const observed = snapshot.entries.filter((entry) => (
      entry.market.sourceKey !== null
    ))

    expect(observed).toHaveLength(295)
    expect(observed.every((entry) => (
      masterIds.has(entry.market.sourceKey!)
    ))).toBe(true)
  })

  it('publishes deterministic cross-signal queues without a blended score', () => {
    expect(isHobbyDecisionDeskArtifact(decisionDeskJson)).toBe(true)
    expect(decisionDeskJson.snapshot.marketRowsSha256).toBe(
      board().snapshot.marketRowsSha256,
    )
    expect(decisionDeskJson.desk.queues.map((queue) => [
      queue.id,
      queue.items.length,
    ])).toEqual([
      ['durable_franchise', 8],
      ['narrative_momentum', 12],
      ['narrative_runway', 15],
      ['narrative_pressure', 33],
      ['story_before_scale', 24],
    ])
    expect(decisionDeskJson.desk.uniqueSubjectCount).toBe(89)
    expect(JSON.stringify(decisionDeskJson)).not.toMatch(
      /compositeScore|expectedReturn|buyRecommendation/iu,
    )
  })

  it('publishes the frozen research and licensed-market dates', () => {
    const snapshot = board()
    expect(snapshot.snapshot).toMatchObject({
      asOf: '2026-07-26',
      marketDataThrough: '2026-06-30',
      marketRowsSha256:
        '9584f55d14a1abb63014ff95dd6f2c7cc145731e1a54cd57cfe7fdb4c75f22c7',
      nextReviewBy: '2026-10-26',
      status: 'current',
    })
    expect(snapshot.entries.every((entry) => (
      entry.lastReviewedAt === snapshot.snapshot.asOf
    ))).toBe(true)
  })
})
