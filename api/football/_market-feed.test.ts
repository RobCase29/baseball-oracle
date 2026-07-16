import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  FOOTBALL_MARKET_FORMAT_IDS,
  dynastyDaddyFormatFor,
  footballMarketFormatFamily,
  type FootballMarketPosition,
} from '../../src/football/marketFeedContract.js'
import {
  FootballMarketFeedError,
  createFootballMarketFeedHandler,
  extractKtcPlayersArray,
  loadFootballMarketFeed,
  parseDynastyDaddyMarketRankings,
  parseFootballMarketFeedQuery,
  parseKtcMarketRankings,
  readResponseTextWithLimit,
} from './_market-feed.js'

const FETCHED_AT = '2026-07-16T18:00:00.000Z'
const POSITIONS: FootballMarketPosition[] = ['QB', 'WR', 'RB', 'TE']

function values(value: number, rank: number, positionRank: number, tier: number) {
  return { value, rank, positionalRank: positionRank, overallTier: tier, positionalTier: tier }
}

function ktcFixtureRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  let overall = 0
  for (const position of POSITIONS) {
    for (let positionRank = 1; positionRank <= 8; positionRank += 1) {
      overall += 1
      const oneQb = values(1_000 + overall, overall, positionRank, Math.ceil(positionRank / 2))
      const superflex = values(2_000 + overall, overall + 100, positionRank, Math.ceil(positionRank / 2))
      rows.push({
        playerName: overall === 1 ? 'Quoted "]" Player' : `${position} Player ${positionRank}`,
        playerID: overall,
        slug: `${position.toLowerCase()}-player-${positionRank}-${overall}`,
        position,
        oneQBValues: {
          ...oneQb,
          tep: values(3_000 + overall, overall + 200, 9 - positionRank, 3),
          tepp: values(4_000 + overall, overall + 300, 9 - positionRank, 4),
          teppp: values(5_000 + overall, overall + 400, 9 - positionRank, 5),
        },
        superflexValues: {
          ...superflex,
          tep: values(6_000 + overall, overall + 500, 9 - positionRank, 6),
          tepp: values(7_000 + overall, overall + 600, 9 - positionRank, 7),
          teppp: values(8_000 + overall, overall + 700, 9 - positionRank, 8),
        },
      })
    }
  }
  rows.push({ playerName: '2027 Early 1st', playerID: 99_999, slug: '2027-early-1st-99999', position: 'RDP' })
  return rows
}

function ktcHtml(rows = ktcFixtureRows(), leagueType: 1 | 2 = 1): string {
  return `<html><script>var leagueType = ${leagueType}; var playersArray = ${JSON.stringify(rows)};</script></html>`
}

function dynastyDaddyFixtureRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  let overall = 0
  for (const position of POSITIONS) {
    for (let positionRank = 1; positionRank <= 8; positionRank += 1) {
      overall += 1
      rows.push({
        name_id: `${position.toLowerCase()}-${positionRank}`,
        full_name: `${position} Daddy ${positionRank}`,
        position,
        position_rank: positionRank,
        sf_position_rank: 9 - positionRank,
        overall_rank: overall,
        sf_overall_rank: overall + 100,
        trade_value: 1_000 + overall,
        sf_trade_value: 2_000 + overall,
      })
    }
  }
  rows.push({
    name_id: 'unranked-qb',
    full_name: 'Unranked QB',
    position: 'QB',
    position_rank: 0,
    sf_position_rank: null,
    overall_rank: 0,
    sf_overall_rank: null,
    trade_value: 0,
    sf_trade_value: 0,
  })
  rows.push({
    name_id: 'ranked-zero-wr',
    full_name: 'Ranked Zero WR',
    position: 'WR',
    position_rank: 9,
    sf_position_rank: 9,
    overall_rank: 99,
    sf_overall_rank: 199,
    trade_value: 0,
    sf_trade_value: 0,
  })
  rows.push({
    name_id: '2027early1stpi',
    full_name: '2027 Early 1st',
    position: 'PI',
  })
  return rows
}

function request(url: string, method = 'GET'): IncomingMessage {
  return { url, method, headers: {} } as IncomingMessage
}

function responseRecorder() {
  const headers = new Map<string, string>()
  let body: string | undefined
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLocaleLowerCase('en-US'), String(value))
    },
    end(value?: string) {
      body = value
    },
  } as unknown as ServerResponse
  return { response, headers, get body() { return body } }
}

describe('football market format contract', () => {
  it('maps all eight exact IDs without conflating Dynasty Daddy provider defaults', () => {
    expect(FOOTBALL_MARKET_FORMAT_IDS).toHaveLength(8)
    expect(footballMarketFormatFamily('one_qb_12t_half_ppr_no_tep')).toEqual({
      lineup: 'one_qb',
      tightEndPremium: 'no_tep',
    })
    expect(footballMarketFormatFamily('sf_12t_half_ppr_teppp')).toEqual({
      lineup: 'sf',
      tightEndPremium: 'teppp',
    })
    expect(dynastyDaddyFormatFor('one_qb_12t_half_ppr_tepp')).toBe('dd_1qb_provider_default')
    expect(dynastyDaddyFormatFor('sf_12t_half_ppr_no_tep')).toBe('dd_sf_provider_default')
  })
})

describe('KTC market parser', () => {
  it('extracts a string-safe embedded array and maps the selected exact branch', () => {
    expect(extractKtcPlayersArray(ktcHtml())).toHaveLength(33)
    const rankings = parseKtcMarketRankings(ktcHtml(ktcFixtureRows(), 2), {
      universe: 'college',
      formatId: 'sf_12t_half_ppr_tepp',
      fetchedAt: FETCHED_AT,
    })

    expect(rankings).toHaveLength(32)
    expect(rankings.find((row) => row.providerPlayerId === '1')).toMatchObject({
      name: 'Quoted "]" Player',
      normalizedName: 'quotedplayer',
      universe: 'college',
      position: 'QB',
      requestedFormatId: 'sf_12t_half_ppr_tepp',
      formatId: 'sf_12t_half_ppr_tepp',
      comparisonScope: 'exact_format',
      positionRank: 1,
      positionUniverseSize: 8,
      positionPercentile: 100,
      overallRank: 601,
      value: 7_001,
      tier: 1,
    })
    expect(rankings.find((row) => row.providerPlayerId === '8')).toMatchObject({
      positionRank: 8,
      positionUniverseSize: 8,
      positionPercentile: 0,
    })
    expect(rankings.find((row) => row.providerPlayerId === '25')).toMatchObject({
      position: 'TE',
      positionRank: 8,
      value: 7_025,
      tier: 7,
    })
    expect(rankings.some((row) => row.name === '2027 Early 1st')).toBe(false)
  })

  it('fails closed for malformed markers, selected-branch drift, and oversized input', () => {
    expect(() => extractKtcPlayersArray('<script>playersArray = [];</script>')).toThrowError(
      expect.objectContaining({ code: 'schema_drift' }),
    )
    expect(() => extractKtcPlayersArray('var playersArray = [{"name":"]"}')).toThrowError(
      expect.objectContaining({ code: 'schema_drift' }),
    )

    const drifted = ktcFixtureRows()
    delete (drifted[0].superflexValues as Record<string, unknown>).tepp
    expect(() => parseKtcMarketRankings(ktcHtml(drifted), {
      universe: 'nfl',
      formatId: 'sf_12t_half_ppr_tepp',
      fetchedAt: FETCHED_AT,
    })).toThrowError(expect.objectContaining({ code: 'schema_drift' }))

    expect(() => parseKtcMarketRankings(ktcHtml(ktcFixtureRows(), 1), {
      universe: 'college',
      formatId: 'one_qb_12t_half_ppr_no_tep',
      fetchedAt: FETCHED_AT,
    })).toThrowError(expect.objectContaining({ code: 'schema_drift' }))

    expect(() => extractKtcPlayersArray('x'.repeat((4 * 1024 * 1024) + 1))).toThrowError(
      expect.objectContaining({ code: 'response_too_large' }),
    )
  })
})

describe('Dynasty Daddy market 14 parser', () => {
  it('maps one-QB and superflex defaults directionally and skips unranked/pick rows', () => {
    const fixture = JSON.stringify(dynastyDaddyFixtureRows())
    const oneQb = parseDynastyDaddyMarketRankings(fixture, {
      universe: 'nfl',
      formatId: 'one_qb_12t_half_ppr_teppp',
      fetchedAt: FETCHED_AT,
    })
    const superflex = parseDynastyDaddyMarketRankings(fixture, {
      universe: 'nfl',
      formatId: 'sf_12t_half_ppr_tep',
      fetchedAt: FETCHED_AT,
    })

    expect(oneQb).toHaveLength(32)
    expect(superflex).toHaveLength(32)
    expect(oneQb.find((row) => row.providerPlayerId === 'qb-1')).toMatchObject({
      formatId: 'dd_1qb_provider_default',
      requestedFormatId: 'one_qb_12t_half_ppr_teppp',
      comparisonScope: 'provider_default_directional',
      positionRank: 1,
      value: 1_001,
      tier: null,
    })
    expect(superflex.find((row) => row.providerPlayerId === 'qb-1')).toMatchObject({
      formatId: 'dd_sf_provider_default',
      requestedFormatId: 'sf_12t_half_ppr_tep',
      comparisonScope: 'provider_default_directional',
      positionRank: 8,
      value: 2_001,
    })
    expect(oneQb.some((row) => row.providerPlayerId === 'unranked-qb')).toBe(false)
    expect(oneQb.some((row) => row.providerPlayerId === '2027early1stpi')).toBe(false)
    expect(oneQb.some((row) => row.providerPlayerId === 'ranked-zero-wr')).toBe(false)
  })

  it('rejects college use and rank schema drift', () => {
    const fixture = dynastyDaddyFixtureRows()
    fixture[0].position_rank = '1'
    expect(() => parseDynastyDaddyMarketRankings(JSON.stringify(fixture), {
      universe: 'nfl',
      formatId: 'one_qb_12t_half_ppr_no_tep',
      fetchedAt: FETCHED_AT,
    })).toThrowError(expect.objectContaining({ code: 'schema_drift' }))
    expect(() => parseDynastyDaddyMarketRankings(JSON.stringify(dynastyDaddyFixtureRows()), {
      universe: 'college',
      formatId: 'sf_12t_half_ppr_no_tep',
      fetchedAt: FETCHED_AT,
    })).toThrowError(expect.objectContaining({ code: 'schema_drift' }))
  })
})

describe('bounded upstream reads', () => {
  it('rejects declared and streamed bodies over the limit', async () => {
    await expect(readResponseTextWithLimit(new Response('tiny', {
      headers: { 'Content-Length': '100' },
    }), 10)).rejects.toMatchObject({ code: 'response_too_large' })
    await expect(readResponseTextWithLimit(new Response('elevenbytes'), 10)).rejects.toMatchObject({
      code: 'response_too_large',
    })
    await expect(readResponseTextWithLimit(new Response('exact'), 5)).resolves.toBe('exact')
  })
})

describe('football market feed orchestration and route contract', () => {
  it('validates an exact two-parameter query', () => {
    for (const formatId of FOOTBALL_MARKET_FORMAT_IDS) {
      expect(parseFootballMarketFeedQuery(request(
        `/api/football/v1/market-rankings?universe=nfl&format=${formatId}`,
      ))).toEqual({ universe: 'nfl', formatId })
    }
    expect(parseFootballMarketFeedQuery(request(
      '/api/football/v1/market-rankings?universe=NFL&format=sf_12t_half_ppr_no_tep',
    ))).toBeNull()
    expect(parseFootballMarketFeedQuery(request(
      '/api/football/v1/market-rankings?universe=nfl&format=sf_12t_half_ppr_no_tep&market=6',
    ))).toBeNull()
    expect(parseFootballMarketFeedQuery(request(
      '/api/football/v1/market-rankings?universe=nfl&universe=college&format=sf_12t_half_ppr_no_tep',
    ))).toBeNull()
  })

  it('returns partial normalized results and only requests Dynasty Daddy market 14', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('keeptradecut.com')) return new Response(ktcHtml(), { status: 200 })
      if (url.includes('market=14')) return new Response('{"unexpected":true}', { status: 200 })
      throw new Error(`Unexpected source ${url}`)
    })
    const result = await loadFootballMarketFeed({
      universe: 'nfl',
      formatId: 'sf_12t_half_ppr_no_tep',
    }, { fetchFn, now: () => new Date(FETCHED_AT) })

    expect(result).toMatchObject({
      schemaVersion: 'football-market-feed.v1',
      generatedAt: FETCHED_AT,
      request: { universe: 'nfl', formatId: 'sf_12t_half_ppr_no_tep' },
      providers: [
        {
          provider: 'keeptradecut',
          label: 'KeepTradeCut Dynasty',
          status: 'available',
          rowCount: 32,
          errorCode: null,
        },
        { provider: 'dynasty-daddy', status: 'unavailable', rowCount: 0, errorCode: 'schema_drift' },
      ],
    })
    expect(result.rankings).toHaveLength(32)
    expect(fetchFn.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      expect.stringContaining('keeptradecut.com/dynasty-rankings'),
      expect.stringContaining('market=14'),
    ]))
    expect(fetchFn.mock.calls.some(([input]) => String(input).includes('market=6'))).toBe(false)
  })

  it('marks Dynasty Daddy unsupported for college without calling it', async () => {
    const fetchFn = vi.fn(async () => new Response(ktcHtml(ktcFixtureRows(), 2), { status: 200 }))
    const result = await loadFootballMarketFeed({
      universe: 'college',
      formatId: 'one_qb_12t_half_ppr_tep',
    }, { fetchFn, now: () => new Date(FETCHED_AT) })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(result.providers[1]).toMatchObject({
      provider: 'dynasty-daddy',
      status: 'unsupported',
      errorCode: 'unsupported_universe',
      rowCount: 0,
    })
    expect(result.providers[0]).toMatchObject({ label: 'KeepTradeCut Devy', status: 'available' })
    expect(result.rankings.every((row) => row.provider === 'keeptradecut')).toBe(true)
  })

  it('serves GET/HEAD with CDN caching and rejects invalid methods/queries without caching', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => (
      String(input).includes('devy-rankings')
        ? new Response(ktcHtml(ktcFixtureRows(), 2), { status: 200 })
        : String(input).includes('keeptradecut.com')
          ? new Response(ktcHtml(), { status: 200 })
        : new Response(JSON.stringify(dynastyDaddyFixtureRows()), { status: 200 })
    ))
    const handler = createFootballMarketFeedHandler({ fetchFn, now: () => new Date(FETCHED_AT) })
    const get = responseRecorder()
    await handler(request(
      '/api/football/v1/market-rankings?universe=nfl&format=one_qb_12t_half_ppr_no_tep',
    ), get.response)
    expect(get.response.statusCode).toBe(200)
    expect(get.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
    )
    expect(JSON.parse(get.body ?? '{}').rankings).toHaveLength(64)

    const head = responseRecorder()
    await handler(request(
      '/api/football/v1/market-rankings?universe=college&format=sf_12t_half_ppr_teppp',
      'HEAD',
    ), head.response)
    expect(head.response.statusCode).toBe(200)
    expect(head.body).toBeUndefined()

    const invalid = responseRecorder()
    await handler(request('/api/football/v1/market-rankings?universe=nfl'), invalid.response)
    expect(invalid.response.statusCode).toBe(400)
    expect(invalid.headers.get('cache-control')).toBe('no-store')

    const post = responseRecorder()
    await handler(request('/api/football/v1/market-rankings', 'POST'), post.response)
    expect(post.response.statusCode).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
    expect(post.headers.get('cache-control')).toBe('no-store')
  })
})

it('retains typed feed errors for safe provider status classification', () => {
  expect(new FootballMarketFeedError('network_error', 'private detail')).toMatchObject({
    name: 'FootballMarketFeedError',
    code: 'network_error',
  })
})
