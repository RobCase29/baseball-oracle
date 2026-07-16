import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  assertHarryKnowsBallSnapshot,
  assertHarryKnowsBallPreviousRetention,
  buildHarryKnowsBallCaptureId,
  buildHarryKnowsBallUrl,
  classifyHarryKnowsBallIdentityFailure,
  HKB_MINIMUM_PLAYER_ROWS,
  HKB_MINIMUM_PROSPECT_ROWS,
  identityObservationFromStoredRaw,
  parseHarryKnowsBallPlayerPage,
  parseHarryKnowsBallRankingsHtml,
  parseHarryKnowsBallTopViewed,
  type HarryKnowsBallRankingAsset,
  type HarryKnowsBallTopViewedRow,
} from './harry-knows-ball.js'

function player(
  index: number,
  options: { assetType?: 'PICK' | 'PLAYER'; prospectRank?: number | null } = {},
): HarryKnowsBallRankingAsset {
  const assetType = options.assetType ?? 'PLAYER'
  const prospectRank = options.prospectRank ?? null
  return {
    id: `player_${String(index).padStart(4, '0')}`,
    originalIndex: index - 1,
    rank: index,
    name: assetType === 'PLAYER' ? `Player ${index}` : `2027 Pick ${index}`,
    age: assetType === 'PLAYER' ? 20 + (index % 10) / 10 : null,
    positions: assetType === 'PLAYER' ? ['SS'] : [],
    positionRanks: assetType === 'PLAYER' ? { SS: index } : {},
    team: assetType === 'PLAYER' ? 'SEA' : null,
    level: assetType === 'PLAYER' ? 'AA' : null,
    hitterStats: null,
    pitcherStats: null,
    statsYear: 2026,
    activeLevels: assetType === 'PLAYER' ? 'AA' : null,
    value: Math.max(10, 10_001 - index),
    valueChange30Days: index % 5,
    rankChange30Days: index % 3,
    valueChange7Days: index % 2,
    rankChange7Days: 0,
    assetType,
    valueHistory30Days: Array.from({ length: 30 }, () => Math.max(10, 10_001 - index)),
    rankHistory30Days: Array.from({ length: 30 }, () => index),
    active: true,
    prospect: prospectRank !== null,
    fypd: false,
    prospectRank,
    prospectPositionRanks: prospectRank === null ? null : { SS: prospectRank },
    prospectRankChange30Days: prospectRank === null ? null : 0,
  }
}

function rankingsHtml(
  players: HarryKnowsBallRankingAsset[],
  lastUpdated = '2026-07-16T16:56:45.455Z',
): string {
  return (
    '<!doctype html><html><body>' +
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { players, lastUpdated } },
    })}</script>` +
    '</body></html>'
  )
}

function validSnapshot(): {
  parsed: ReturnType<typeof parseHarryKnowsBallRankingsHtml>
  topPlayers: HarryKnowsBallTopViewedRow[]
  topProspects: HarryKnowsBallTopViewedRow[]
} {
  const players = Array.from({ length: HKB_MINIMUM_PLAYER_ROWS }, (_, index) =>
    player(index + 1, {
      prospectRank: index < HKB_MINIMUM_PROSPECT_ROWS ? index + 1 : null,
    }),
  )
  const parsed = parseHarryKnowsBallRankingsHtml(rankingsHtml(players))
  const topPlayers = players.slice(0, 10).map((item, index) => ({
    player: item,
    viewCount: 100 - index,
  }))
  const topProspects = players.slice(10, 20).map((item, index) => ({
    player: item,
    viewCount: 90 - index,
  }))
  return { parsed, topPlayers, topProspects }
}

describe('HarryKnowsBall ingestion contract', () => {
  it('keeps the current-view and identity queue fail-closed in SQL', async () => {
    const migration = await readFile(
      new URL('../../db/migrations/0020_harry_knows_ball_external_signals.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE core.hkb_identity_backfill_attempt')
    expect(migration).toMatch(
      /ORDER BY\s+source_updated_at DESC NULLS LAST,\s+captured_at DESC/gu,
    )
    expect(migration).toMatch(
      /coalesce\(\s+\(ingestion\.counts ->> 'sourceAssets'\)::integer,\s+\(ingestion\.counts ->> 'players'\)::integer\s+\)/u,
    )
    expect(migration).toContain("backfill.status = 'retryable'")
    expect(migration).toContain('DELETE FROM core.hkb_identity_backfill_attempt')
  })

  it('builds only the audited public rankings and attention URLs', () => {
    expect(buildHarryKnowsBallUrl('rankings')).toBe(
      'https://harryknowsball.com/rankings',
    )
    expect(buildHarryKnowsBallUrl('top_viewed_players')).toBe(
      'https://harryknowsball.com/hkb/topViewedPlayers',
    )
    expect(buildHarryKnowsBallUrl('top_viewed_prospects')).toBe(
      'https://harryknowsball.com/hkb/topViewedProspects',
    )
    expect(
      buildHarryKnowsBallUrl('player', { hkbPlayerId: 'nmwW2beB' }),
    ).toBe('https://harryknowsball.com/player/nmwW2beB')
  })

  it('parses Next data, retains source prospect ranks, and excludes draft picks', () => {
    const prospect = player(1, { prospectRank: 1 })
    const pick = player(2, { assetType: 'PICK' })
    const parsed = parseHarryKnowsBallRankingsHtml(rankingsHtml([prospect, pick]))

    expect(parsed.sourceAssets).toBe(2)
    expect(parsed.players).toEqual([prospect])
    expect(parsed.players[0].prospectRank).toBe(1)
    expect(parsed.sourceUpdatedAt).toBe('2026-07-16T16:56:45.455Z')
  })

  it('preserves leading null history for newly listed players', () => {
    const newlyListed = player(1, { prospectRank: 1 })
    newlyListed.valueHistory30Days = [
      ...Array.from({ length: 7 }, () => null),
      ...Array.from({ length: 23 }, () => newlyListed.value),
    ]
    newlyListed.rankHistory30Days = [
      ...Array.from({ length: 7 }, () => null),
      ...Array.from({ length: 23 }, () => newlyListed.rank),
    ]

    const parsed = parseHarryKnowsBallRankingsHtml(rankingsHtml([newlyListed]))
    expect(parsed.players[0].valueHistory30Days.slice(0, 7)).toEqual(
      Array.from({ length: 7 }, () => null),
    )
    expect(parsed.players[0].rankHistory30Days.at(-1)).toBe(newlyListed.rank)
  })

  it('parses the player and prospect most-viewed response shape', () => {
    const body = JSON.stringify([
      { player: player(1, { prospectRank: 1 }), viewCount: 353 },
      { player: player(2, { prospectRank: 2 }), viewCount: 350 },
    ])
    expect(parseHarryKnowsBallTopViewed(body).map((row) => row.viewCount)).toEqual([
      353,
      350,
    ])
  })

  it('accepts a complete, fresh, internally consistent atomic snapshot', () => {
    const { parsed, topPlayers, topProspects } = validSnapshot()
    expect(
      assertHarryKnowsBallSnapshot(
        parsed,
        topPlayers,
        topProspects,
        new Date('2026-07-16T17:00:00Z'),
      ),
    ).toMatchObject({
      activePlayers: HKB_MINIMUM_PLAYER_ROWS,
      nonFloorPlayers: HKB_MINIMUM_PLAYER_ROWS,
      players: HKB_MINIMUM_PLAYER_ROWS,
      prospects: HKB_MINIMUM_PROSPECT_ROWS,
      topViewedPlayers: 10,
      topViewedProspects: 10,
    })
  })

  it('rejects a rankings collapse and malformed prospect sequence', () => {
    const tooSmall = parseHarryKnowsBallRankingsHtml(
      rankingsHtml([player(1, { prospectRank: 1 })]),
    )
    expect(() =>
      assertHarryKnowsBallSnapshot(
        tooSmall,
        [],
        [],
        new Date('2026-07-16T17:00:00Z'),
      ),
    ).toThrow(`expected at least ${HKB_MINIMUM_PLAYER_ROWS}`)

    const { parsed, topPlayers, topProspects } = validSnapshot()
    parsed.players[1].prospectRank = 1
    expect(() =>
      assertHarryKnowsBallSnapshot(
        parsed,
        topPlayers,
        topProspects,
        new Date('2026-07-16T17:00:00Z'),
      ),
    ).toThrow('prospect ranks are not a complete 1-based sequence')
  })

  it('rejects out-of-contract Dynasty Scores and mismatched history endpoints', () => {
    const belowFloor = player(1, { prospectRank: 1 })
    belowFloor.value = 9
    belowFloor.valueHistory30Days = Array.from({ length: 30 }, () => 9)
    expect(() => parseHarryKnowsBallRankingsHtml(rankingsHtml([belowFloor])))
      .toThrow()

    const mismatched = player(1, { prospectRank: 1 })
    mismatched.valueHistory30Days[29] = mismatched.value - 1
    expect(() => parseHarryKnowsBallRankingsHtml(rankingsHtml([mismatched])))
      .toThrow('Current Dynasty Score does not match its history endpoint')

    const rankMismatch = player(1, { prospectRank: 1 })
    rankMismatch.rankHistory30Days[29] = rankMismatch.rank + 1
    expect(() => parseHarryKnowsBallRankingsHtml(rankingsHtml([rankMismatch])))
      .toThrow('Current overall rank does not match its history endpoint')
  })

  it('rejects unknown or incorrectly ordered most-viewed players', () => {
    const { parsed, topPlayers, topProspects } = validSnapshot()
    topPlayers[1] = { player: player(9_999), viewCount: 101 }
    expect(() =>
      assertHarryKnowsBallSnapshot(
        parsed,
        topPlayers,
        topProspects,
        new Date('2026-07-16T17:00:00Z'),
      ),
    ).toThrow(/unknown HKB player|not ordered/u)
  })

  it('extracts exact provider-published MLBAM identity and fails on ID mismatch', () => {
    const html = rankingsHtml([]).replace(
      JSON.stringify({ players: [], lastUpdated: '2026-07-16T16:56:45.455Z' }),
      JSON.stringify({
        player: { id: 'nmwW2beB', mlbId: 703610, name: 'Justin Lamkin' },
      }),
    )

    expect(parseHarryKnowsBallPlayerPage(html, 'nmwW2beB')).toEqual({
      hkbPlayerId: 'nmwW2beB',
      mlbamId: 703610,
      playerName: 'Justin Lamkin',
    })
    expect(() => parseHarryKnowsBallPlayerPage(html, 'differentId')).toThrow(
      'returned nmwW2beB for requested differentId',
    )
  })

  it('uses every response hash in the atomic capture identity', () => {
    const original = buildHarryKnowsBallCaptureId({
      rankings: 'a'.repeat(64),
      topViewedPlayers: 'b'.repeat(64),
      topViewedProspects: 'c'.repeat(64),
    })
    expect(original).toHaveLength(64)
    expect(
      buildHarryKnowsBallCaptureId({
        rankings: 'a'.repeat(64),
        topViewedPlayers: 'b'.repeat(64),
        topViewedProspects: 'd'.repeat(64),
      }),
    ).not.toBe(original)
  })

  it('rejects a severe player-universe drop from the prior complete snapshot', () => {
    const current = {
      activePlayers: 1_300,
      nonFloorPlayers: 800,
      players: 1_400,
      prospects: 600,
      sourceAssets: 1_420,
      topViewedPlayers: 10,
      topViewedProspects: 10,
      sourceUpdatedAt: '2026-07-16T17:00:00.000Z',
    }
    const previous = {
      activePlayers: 1_600,
      nonFloorPlayers: 900,
      players: 1_700,
      prospects: 700,
      sourceUpdatedAt: '2026-07-16T16:00:00.000Z',
    }
    expect(assertHarryKnowsBallPreviousRetention(current, previous)).toMatchObject({
      previous,
      required: {
        activePlayers: 1_280,
        nonFloorPlayers: 720,
        players: 1_360,
        prospects: 560,
      },
    })
    expect(() => assertHarryKnowsBallPreviousRetention(
      { ...current, players: 1_359 },
      previous,
    )).toThrow(
      'expected at least 1360',
    )
    expect(() => assertHarryKnowsBallPreviousRetention(
      { ...current, nonFloorPlayers: 719 },
      previous,
    )).toThrow('expected at least 720')
    expect(() => assertHarryKnowsBallPreviousRetention(
      { ...current, sourceUpdatedAt: '2026-07-16T15:59:59.000Z' },
      previous,
    )).toThrow('source timestamp regressed')
  })

  it('quarantines permanent identity conflicts and retries transient failures', () => {
    expect(classifyHarryKnowsBallIdentityFailure({ code: 'P2001' })).toEqual({
      failureKind: 'mlbam_collision',
      quarantined: true,
    })
    expect(classifyHarryKnowsBallIdentityFailure({
      code: '23505',
      constraint_name: 'hkb_exact_identity_mlbam_id_key',
    })).toEqual({
      failureKind: 'mlbam_collision',
      quarantined: true,
    })
    expect(classifyHarryKnowsBallIdentityFailure(
      new Error('HarryKnowsBall player page returned wrong for requested expected'),
    )).toEqual({
      failureKind: 'provider_id_mismatch',
      quarantined: true,
    })
    expect(classifyHarryKnowsBallIdentityFailure(new Error('HTTP 503'))).toEqual({
      failureKind: 'transient',
      quarantined: false,
    })
  })

  it('recovers duplicate identity observations from stored raw evidence', () => {
    const storedAt = new Date('2026-07-16T17:03:09.000Z')
    const hash = 'a'.repeat(64)
    const observation = identityObservationFromStoredRaw({
      id: '00000000-0000-4000-8000-000000000001',
      fetched_at: storedAt,
      blob_sha256: hash,
      record_json: {
        hkbPlayerId: 'nmwW2beB',
        mlbamId: 703610,
        playerName: 'Justin Lamkin',
        sourceUrl: 'https://harryknowsball.com/player/justin-lamkin-nmwW2beB',
        requestedUrl: 'https://harryknowsball.com/player/nmwW2beB',
        observedAt: storedAt.toISOString(),
        responseSha256: hash,
        evidenceMethod: 'hkb_player_page_published_mlbam',
        identityPolicy: 'exact_hkb_player_page_published_mlbam_no_name_matching',
      },
    })

    expect(observation.observedAt).toEqual(storedAt)
    expect(observation.rawRecordId).toBe('00000000-0000-4000-8000-000000000001')
    expect(observation.mlbamId).toBe(703610)
  })
})
