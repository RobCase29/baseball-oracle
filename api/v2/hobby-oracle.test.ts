import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { handleHobbyMasterRanking } from './hobby-oracle.js'

const currentAt = new Date('2026-07-25T12:00:00.000Z')

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

describe('/api/v2/hobby-oracle', () => {
  it('serves the absolute Build screen in master-rank order', () => {
    const recorder = responseRecorder()
    handleHobbyMasterRanking(
      request(
        '/api/v2/hobby-oracle?posture=build_candidate' +
        '&sort=master_rank&direction=asc&limit=100',
      ),
      recorder.response,
      currentAt,
    )
    const payload = recorder.json() as {
      schemaVersion: string
      items: Array<{
        masterRank: number
        subject: { name: string }
        assessment: {
          posture: string
          buildQualification: { eligible: boolean }
        }
      }>
      page: { total: number }
      meta: { rankingPolicy: string; buildCount: number }
    }

    expect(recorder.response.statusCode).toBe(200)
    expect(recorder.headers.get('cache-control')).toContain('s-maxage=300')
    expect(payload.schemaVersion).toBe('hobby-oracle-master-ranking.v2')
    expect(payload.page.total).toBe(23)
    expect(payload.meta.buildCount).toBe(23)
    expect(payload.meta.rankingPolicy)
      .toBe('single_observed_universe_absolute_demand_and_durability_order')
    expect(payload.items[0]?.subject.name).toBe('Charizard')
    expect(payload.items.every(
      (item, index, items) =>
        item.assessment.posture === 'build_candidate' &&
        item.assessment.buildQualification.eligible &&
        (
          index === 0 ||
          items[index - 1]!.masterRank < item.masterRank
        ),
    )).toBe(true)
  })

  it('supports cohort filters without manufacturing a new number one and HEAD', () => {
    const getRecorder = responseRecorder()
    handleHobbyMasterRanking(
      request(
        '/api/v2/hobby-oracle?domain=football' +
        '&posture=build_candidate&sort=master_rank&limit=100',
      ),
      getRecorder.response,
      currentAt,
    )
    const payload = getRecorder.json() as {
      items: Array<{ masterRank: number; subject: { domain: string } }>
    }

    expect(payload.items).toHaveLength(3)
    expect(payload.items.every((item) => item.subject.domain === 'football'))
      .toBe(true)
    expect(payload.items[0]?.masterRank).toBeGreaterThan(1)

    const headRecorder = responseRecorder()
    handleHobbyMasterRanking(
      request('/api/v2/hobby-oracle', 'HEAD'),
      headRecorder.response,
      currentAt,
    )
    expect(headRecorder.response.statusCode).toBe(200)
    expect(headRecorder.body()).toBe('')
  })

  it('serves the Exit 100 sort without presenting it as a sell instruction', () => {
    const recorder = responseRecorder()
    handleHobbyMasterRanking(
      request(
        '/api/v2/hobby-oracle?posture=all' +
        '&sort=exit_window&direction=desc&limit=100',
      ),
      recorder.response,
      currentAt,
    )
    const payload = recorder.json() as {
      items: Array<{
        subject: { name: string }
        assessment: { posture: string }
      }>
      meta: {
        investmentAdvice: boolean
        exactCardRecommendationsAvailable: boolean
      }
    }

    expect(recorder.response.statusCode).toBe(200)
    expect(payload.items).toHaveLength(100)
    expect(payload.items[0]?.subject.name).toBe('Jayden Daniels')
    expect(payload.items.every(
      (item) =>
        item.assessment.posture !== 'build_candidate' &&
        item.assessment.posture !== 'hold_candidate',
    )).toBe(true)
    expect(payload.meta.investmentAdvice).toBe(false)
    expect(payload.meta.exactCardRecommendationsAvailable).toBe(false)
  })

  it('rejects duplicate, unsupported, and oversized parameters', () => {
    for (const url of [
      '/api/v2/hobby-oracle?domain=football&domain=basketball',
      '/api/v2/hobby-oracle?domain=quidditch',
      '/api/v2/hobby-oracle?posture=Buy',
      '/api/v2/hobby-oracle?sort=expected_return',
      '/api/v2/hobby-oracle?direction=sideways',
      '/api/v2/hobby-oracle?limit=101',
      '/api/v2/hobby-oracle?tier=market_leader',
    ]) {
      const recorder = responseRecorder()
      handleHobbyMasterRanking(
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
    handleHobbyMasterRanking(
      request('/api/v2/hobby-oracle', 'POST'),
      recorder.response,
      currentAt,
    )

    expect(recorder.response.statusCode).toBe(405)
    expect(recorder.headers.get('allow')).toBe('GET, HEAD')
  })
})
