import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  communitySignalItem,
  communitySignalsResponse,
  createCommunitySignalsHandler,
  parseCommunitySignalsQuery,
  type CommunitySignalRow,
} from './_community-signals.js'

function request(url: string, method = 'GET', headers: IncomingMessage['headers'] = {}): IncomingMessage {
  return { url, method, headers } as IncomingMessage
}

function responseRecorder() {
  const headers = new Map<string, string>()
  let body: string | undefined
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLocaleLowerCase('en-US'), String(value))
    },
    removeHeader(name: string) {
      headers.delete(name.toLocaleLowerCase('en-US'))
    },
    end(value?: string) {
      body = value
    },
  } as unknown as ServerResponse
  return { response, headers, get body() { return body } }
}

function row(overrides: Partial<CommunitySignalRow> = {}): CommunitySignalRow {
  return {
    oracle_player_id: 'mlbam:660271',
    mlbam_id: 660271,
    hkb_player_id: 'ohtani-hkb',
    player_name: 'Shohei Ohtani',
    dynasty_value: 10_000,
    overall_rank: 1,
    overall_universe: 1_744,
    prospect_rank: null,
    prospect_universe: 728,
    rank_change_7d: 1,
    rank_change_30d: 2,
    value_change_7d: 35,
    value_change_30d: 80,
    rank_history_30d: [2, 1, 1],
    value_history_30d: [9_950, 9_980, 10_000],
    attention_count_30d: 120,
    attention_rank_30d: 2,
    prospect_attention_count_30d: null,
    prospect_attention_rank_30d: null,
    source_updated_at: '2026-07-16T16:56:45.455Z',
    captured_at: '2026-07-16T17:00:00.000Z',
    source_url: 'https://harryknowsball.com/rankings',
    ...overrides,
  }
}

describe('community signals contract', () => {
  it('parses up to 100 exact MLBAM identifiers and rejects ambiguous requests', () => {
    expect(parseCommunitySignalsQuery(request(
      '/api/v1/community-signals?ids=660271,mlbam%3A691176%3Ahitter,mlbam%3A800001',
    ))).toEqual({
      requestedIds: ['660271', 'mlbam:691176:hitter', 'mlbam:800001'],
      oracleIds: [],
      mlbamIds: ['660271', '691176', '800001'],
    })
    expect(parseCommunitySignalsQuery(request(
      '/api/v1/community-signals?ids=prospect-savant%3Aminor%3Aabc%3Ahitters',
    ))).toEqual({
      requestedIds: ['prospect-savant:minor:abc:hitters'],
      oracleIds: ['prospect-savant:minor:abc:hitters'],
      mlbamIds: [],
    })
    expect(parseCommunitySignalsQuery(request('/api/v1/community-signals'))).toBeNull()
    expect(parseCommunitySignalsQuery(request('/api/v1/community-signals?ids=660271&ids=691176'))).toBeNull()
    expect(parseCommunitySignalsQuery(request('/api/v1/community-signals?ids=660271,mlbam%3A660271'))).toBeNull()
    expect(parseCommunitySignalsQuery(request('/api/v1/community-signals?ids=660271&sort=rank'))).toBeNull()

    const hundred = Array.from({ length: 100 }, (_, index) => String(700_000 + index)).join(',')
    const hundredOne = `${hundred},800000`
    expect(parseCommunitySignalsQuery(request(`/api/v1/community-signals?ids=${hundred}`))).not.toBeNull()
    expect(parseCommunitySignalsQuery(request(`/api/v1/community-signals?ids=${hundredOne}`))).toBeNull()
  })

  it('normalizes Dynasty Score and explicitly identifies the default floor', () => {
    const ranked = communitySignalItem(row())
    expect(ranked).toMatchObject({
      recordVersion: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      player: {
        oracleId: 'mlbam:660271',
        mlbamId: '660271',
      },
      dynastyScore: {
        label: 'Dynasty Score',
        value: 10_000,
        signalStatus: 'ranked',
        overallRank: 1,
        movement: { rank7d: 1, rank30d: 2, value7d: 35, value30d: 80 },
        attention: { views30d: 120, rank30d: 2 },
        history: { rank30d: [2, 1, 1], value30d: [9_950, 9_980, 10_000] },
      },
      observation: { capturedAt: '2026-07-16T17:00:00.000Z' },
    })

    const floor = communitySignalItem(row({ dynasty_value: 10, overall_rank: 840 }))
    expect(floor.dynastyScore).toMatchObject({ value: 10, signalStatus: 'default_floor' })
  })

  it('uses null for missing attention and rejects an out-of-range dynasty value', () => {
    const item = communitySignalItem(row({
      attention_count_30d: 0,
      attention_rank_30d: 0,
      rank_history_30d: ['bad'],
    }))
    expect(item.dynastyScore.attention).toMatchObject({ views30d: null, rank30d: null })
    expect(item.dynastyScore.history.rank30d).toBeNull()
    expect(() => communitySignalItem(row({ dynasty_value: 10_001 }))).toThrow(
      'Invalid Dynasty Score value',
    )
  })

  it('preserves leading null history days for newly listed players', () => {
    const item = communitySignalItem(row({
      rank_history_30d: [null, null, 420, 400],
      value_history_30d: [null, null, 25, 30],
    }))
    expect(item.dynastyScore.history).toEqual({
      rank30d: [null, null, 420, 400],
      value30d: [null, null, 25, 30],
    })
  })

  it('preserves requested order, reports misses, and versions a snapshot deterministically', () => {
    const firstRows = [
      row(),
      row({
        oracle_player_id: 'mlbam:691176',
        mlbam_id: 691176,
        hkb_player_id: 'mack-hkb',
        player_name: 'Joe Mack',
        dynasty_value: 1_900,
        overall_rank: 140,
      }),
    ]
    const response = communitySignalsResponse(firstRows, ['691176', 'missing:id', '660271'])
    expect(response.items.map((item) => item.player.name)).toEqual(['Joe Mack', 'Shohei Ohtani'])
    expect(response.snapshot?.id).toMatch(/^dynasty-scores-snapshot\/v1:[a-f0-9]{64}$/u)
    expect(response.meta).toMatchObject({
      excludedFromOracleModel: true,
      nullMeans: 'unavailable_not_zero',
      nullMeansUnavailableNotZero: true,
      identityPolicy: 'exact_mlbam_join_no_name_matching',
      requestedIds: ['691176', 'missing:id', '660271'],
      unmatchedIds: ['missing:id'],
    })
    expect(communitySignalsResponse(firstRows.toReversed(), ['691176', 'missing:id', '660271']))
      .toEqual(response)
    expect(communitySignalsResponse([], ['660271'])).toMatchObject({
      snapshot: null,
      items: [],
      meta: { unmatchedIds: ['660271'] },
    })
  })
})

describe('/api/v1/community-signals handler', () => {
  it('loads exact IDs through injected dependencies and publishes cache validators', async () => {
    const loadRows = vi.fn(async () => [row()])
    const handler = createCommunitySignalsHandler({ databaseUrl: () => 'postgres://test', loadRows })
    const first = responseRecorder()
    await handler(request('/api/v1/community-signals?ids=660271'), first.response)

    expect(loadRows).toHaveBeenCalledWith('postgres://test', [], ['660271'])
    expect(first.response.statusCode).toBe(200)
    expect(first.headers.get('cache-control')).toContain('s-maxage=300')
    expect(first.headers.get('x-snapshot-id')).toMatch(/^dynasty-scores-snapshot\/v1:/u)
    expect(first.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]{43}"$/u)
    expect(JSON.parse(first.body ?? '{}')).toMatchObject({
      schemaVersion: 'dynasty-scores.v1',
      items: [{ dynastyScore: { label: 'Dynasty Score', value: 10_000 } }],
    })

    const conditional = responseRecorder()
    await handler(request(
      '/api/v1/community-signals?ids=660271',
      'GET',
      { 'if-none-match': `W/${first.headers.get('etag')}` },
    ), conditional.response)
    expect(conditional.response.statusCode).toBe(304)
    expect(conditional.body).toBeUndefined()
  })

  it('supports HEAD and fails closed for invalid, unconfigured, and unsupported requests', async () => {
    const loadRows = vi.fn(async () => [row()])
    const handler = createCommunitySignalsHandler({ databaseUrl: () => 'postgres://test', loadRows })
    const head = responseRecorder()
    await handler(request('/api/v1/community-signals?ids=660271', 'HEAD'), head.response)
    expect(head.response.statusCode).toBe(200)
    expect(head.body).toBeUndefined()

    const invalid = responseRecorder()
    await handler(request('/api/v1/community-signals'), invalid.response)
    expect(invalid.response.statusCode).toBe(400)

    const unconfigured = responseRecorder()
    await createCommunitySignalsHandler({ databaseUrl: () => null, loadRows })(
      request('/api/v1/community-signals?ids=660271'),
      unconfigured.response,
    )
    expect(unconfigured.response.statusCode).toBe(503)

    const post = responseRecorder()
    await handler(request('/api/v1/community-signals?ids=660271', 'POST'), post.response)
    expect(post.response.statusCode).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })
})
