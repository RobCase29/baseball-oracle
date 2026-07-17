import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  cardMarketResponse,
  createCardMarketHandler,
  parseCardMarketQuery,
} from './_card-market.js'

function request(url: string, method = 'GET', headers: IncomingMessage['headers'] = {}): IncomingMessage {
  return { url, method, headers } as IncomingMessage
}

function responseRecorder() {
  let body: string | undefined
  const headers = new Map<string, string>()
  const response = {
    statusCode: 200,
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

function upstreamPayload() {
  return {
    schemaVersion: 'player-models.v1' as const,
    contractVersion: 'backstop-public-api/v1',
    modelVersion: 'backstop-fv-v3',
    generatedAt: '2026-07-17T12:00:00.000Z',
    snapshotGeneratedAt: '2026-07-17T08:00:00.000Z',
    warnings: [],
    items: [{
      modelId: 'aiva-arquette:2026-bowman:raw-base-auto',
      player: {
        name: 'Aiva Arquette',
        normalizedName: 'aiva arquette',
        currentTeamCode: 'MIA',
        currentTeamName: 'Miami Marlins',
        checklistTeam: 'Miami Marlins',
      },
      card: {
        release: '2026 Bowman',
        releaseYear: 2026,
        productFamily: 'Bowman Chrome',
        cardType: 'Base Auto' as const,
        grade: 'Raw' as const,
      },
      valuation: {
        amount: 106.46,
        currency: 'USD' as const,
        low: 81.29,
        high: 139.44,
        confidenceScore: 87,
        evidenceTier: 'observed',
        evidenceQuality: 'strong' as const,
        actionable: true,
      },
      evidence: {
        sales: 10,
        effectiveSales: 8.85,
        sales30: 10,
        sales90: 10,
        auctionSales: 7,
        binSales: 3,
        volatility: 0.18,
        latestSaleAt: '2026-06-22T12:00:00.000Z',
      },
      freshness: {
        modelGeneratedAt: '2026-07-17T08:00:00.000Z',
        modelAgeDays: 0,
        latestSaleAgeDays: 25,
        stale: false,
      },
      variationLadder: [{
        key: 'base',
        label: 'Base',
        multiplier: 1,
        amount: 106.46,
        low: 81.29,
        high: 139.44,
        confidence: 0.87,
        evidenceTier: 'observed',
        actionable: true,
      }],
    }],
  }
}

describe('card market adapter', () => {
  it('accepts one exact player and optional release', () => {
    expect(parseCardMarketQuery(request(
      '/api/v1/card-market?player=Aiva%20Arquette&release=2026%20Bowman',
    ))).toEqual({ player: 'Aiva Arquette', release: '2026 Bowman' })
    expect(parseCardMarketQuery(request('/api/v1/card-market'))).toBeNull()
    expect(parseCardMarketQuery(request('/api/v1/card-market?player=Aiva&player=Other'))).toBeNull()
    expect(parseCardMarketQuery(request('/api/v1/card-market?player=Aiva&q=extra'))).toBeNull()
  })

  it('whitelists decision-useful values without relaying source internals', () => {
    const response = cardMarketResponse('Aiva Arquette', upstreamPayload())
    expect(response).toMatchObject({
      schemaVersion: 'card-market.v1',
      modelVersion: 'card-market-v1',
      count: 1,
      items: [{
        matchKey: 'aiva arquette|2026 bowman',
        valuation: { amount: 106.46, confidenceScore: 87, actionable: true },
        evidence: { sales: 10 },
        variations: [{ label: 'Base', amount: 106.46 }],
      }],
    })
    expect(JSON.stringify(response)).not.toContain('rawThirdPartyDataIncluded')
    expect(JSON.stringify(response)).not.toContain('rankings')
    expect(JSON.stringify(response)).not.toContain('source')
    expect(JSON.stringify(response).toLocaleLowerCase('en-US')).not.toContain('backstop')
  })

  it('keeps the credential server-side and returns a cacheable normalized response', async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer server-secret' })
      return new Response(JSON.stringify(upstreamPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const fetcher = fetchMock as unknown as typeof fetch
    const handler = createCardMarketHandler({
      apiBase: () => 'https://backstopcards.com',
      apiKey: () => 'server-secret',
      fetcher,
    })
    const recorder = responseRecorder()
    await handler(request('/api/v1/card-market?player=Aiva%20Arquette'), recorder.response)

    expect(recorder.response.statusCode).toBe(200)
    expect(recorder.headers.get('cache-control')).toContain('max-age=60')
    expect(JSON.parse(recorder.body ?? '{}')).toMatchObject({
      schemaVersion: 'card-market.v1',
      player: 'Aiva Arquette',
      items: [{ valuation: { amount: 106.46 } }],
    })
    const calledUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(calledUrl).toContain('priced=all')
    expect(calledUrl).toContain('include=ladder')
  })

  it('fails closed when unconfigured or upstream rejects the key', async () => {
    const unconfigured = responseRecorder()
    await createCardMarketHandler({
      apiBase: () => 'https://backstopcards.com',
      apiKey: () => null,
      fetcher: vi.fn() as unknown as typeof fetch,
    })(request('/api/v1/card-market?player=Aiva'), unconfigured.response)
    expect(unconfigured.response.statusCode).toBe(503)

    const unauthorized = responseRecorder()
    await createCardMarketHandler({
      apiBase: () => 'https://backstopcards.com',
      apiKey: () => 'bad-key',
      fetcher: vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
    })(request('/api/v1/card-market?player=Aiva'), unauthorized.response)
    expect(unauthorized.response.statusCode).toBe(503)
    expect(unauthorized.body).not.toContain('bad-key')
  })

  it('revalidates with an ETag and serves a short last-known-good fallback', async () => {
    let now = 1_000
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(upstreamPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"upstream-v1"' },
      }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    const handler = createCardMarketHandler({
      apiBase: () => 'https://backstopcards.com',
      apiKey: () => 'server-secret',
      fetcher: fetchMock as unknown as typeof fetch,
      now: () => now,
    })

    const first = responseRecorder()
    await handler(request('/api/v1/card-market?player=Aiva%20Arquette'), first.response)
    expect(first.response.statusCode).toBe(200)

    now += 5 * 60 * 1_000 + 1
    const fallback = responseRecorder()
    await handler(request('/api/v1/card-market?player=Aiva%20Arquette'), fallback.response)

    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'If-None-Match': '"upstream-v1"',
    })
    expect(fallback.response.statusCode).toBe(200)
    expect(JSON.parse(fallback.body ?? '{}')).toMatchObject({
      warnings: ['market_data_stale_fallback'],
      items: [{ valuation: { amount: 106.46 } }],
    })
  })
})
