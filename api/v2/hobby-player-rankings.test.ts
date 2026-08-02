import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { handleHobbyPlayerRankings } from './hobby-player-rankings.js'

const currentAt = new Date('2026-08-02T11:00:00.000Z')

function request(url: string, method = 'GET'): IncomingMessage {
  return { url, method, headers: {} } as IncomingMessage
}

function responseRecorder() {
  const headers = new Map<string, string>()
  let body = ''
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLocaleLowerCase('en-US'), String(value))
    },
    end(value?: string) {
      body = value ?? ''
    },
  } as unknown as ServerResponse
  return {
    response,
    headers,
    body: () => body,
    json: () => JSON.parse(body) as Record<string, unknown>,
  }
}

describe('/api/v2/hobby-player-rankings', () => {
  it('serves a current, bounded within-sport investor screen', () => {
    const recorder = responseRecorder()
    handleHobbyPlayerRankings(
      request(
        '/api/v2/hobby-player-rankings?sport=football' +
        '&maxAge=26&position=WR&sort=score&limit=10',
      ),
      recorder.response,
      currentAt,
    )
    const payload = recorder.json() as {
      schemaVersion: string
      snapshot: { freshness: { status: string } }
      items: Array<{
        sport: string
        age: number | null
        positions: string[]
        screenRank: number
      }>
      meta: {
        expectedReturnClaim: boolean
        rankingPolicy: string
      }
    }

    expect(recorder.response.statusCode).toBe(200)
    expect(recorder.headers.get('cache-control')).toContain('s-maxage=300')
    expect(payload.schemaVersion).toBe('hobby-player-rankings.v2')
    expect(payload.snapshot.freshness.status).toBe('current')
    expect(payload.items).toHaveLength(10)
    expect(payload.items.every(
      (item) =>
        item.sport === 'football' &&
        item.age !== null &&
        item.age <= 26 &&
        item.positions.includes('WR'),
    )).toBe(true)
    expect(payload.meta).toMatchObject({
      expectedReturnClaim: false,
      rankingPolicy: 'within_sport_only',
    })
  })

  it('supports Build-only basketball research and HEAD', () => {
    const getRecorder = responseRecorder()
    handleHobbyPlayerRankings(
      request(
        '/api/v2/hobby-player-rankings?sport=basketball' +
        '&posture=Build&limit=100',
      ),
      getRecorder.response,
      currentAt,
    )
    const payload = getRecorder.json() as {
      items: Array<{
        posture: string
        gates: { buildEligible: boolean }
      }>
      page: { total: number }
    }
    expect(getRecorder.response.statusCode).toBe(200)
    expect(payload.page.total).toBeGreaterThan(0)
    expect(payload.items.every(
      (item) => item.posture === 'Build' && item.gates.buildEligible,
    )).toBe(true)

    const headRecorder = responseRecorder()
    handleHobbyPlayerRankings(
      request(
        '/api/v2/hobby-player-rankings?sport=basketball',
        'HEAD',
      ),
      headRecorder.response,
      currentAt,
    )
    expect(headRecorder.response.statusCode).toBe(200)
    expect(headRecorder.body()).toBe('')
  })

  it('rejects duplicate, unsupported, and oversized parameters', () => {
    for (const url of [
      '/api/v2/hobby-player-rankings?sport=football&sport=basketball',
      '/api/v2/hobby-player-rankings?sport=baseball',
      '/api/v2/hobby-player-rankings?posture=Buy',
      '/api/v2/hobby-player-rankings?sort=expected_return',
      '/api/v2/hobby-player-rankings?maxAge=14',
      '/api/v2/hobby-player-rankings?sport=football&position=C',
      '/api/v2/hobby-player-rankings?limit=101',
      '/api/v2/hobby-player-rankings?direction=desc',
    ]) {
      const recorder = responseRecorder()
      handleHobbyPlayerRankings(
        request(url),
        recorder.response,
        currentAt,
      )
      expect(recorder.response.statusCode, url).toBe(400)
      expect(recorder.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('permits only GET and HEAD', () => {
    const recorder = responseRecorder()
    handleHobbyPlayerRankings(
      request('/api/v2/hobby-player-rankings', 'POST'),
      recorder.response,
      currentAt,
    )

    expect(recorder.response.statusCode).toBe(405)
    expect(recorder.headers.get('allow')).toBe('GET, HEAD')
  })
})
