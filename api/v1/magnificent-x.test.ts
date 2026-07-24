import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import handler from './magnificent-x.js'

function request(url: string, method = 'GET'): IncomingMessage {
  return { url, method, headers: {} } as IncomingMessage
}

function responseRecorder() {
  const headers = new Map<string, string>()
  let body = ''
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value))
    },
    end(value?: string) {
      body = value ?? ''
    },
  } as unknown as ServerResponse
  return {
    response,
    headers,
    json: () => JSON.parse(body) as Record<string, unknown>,
  }
}

describe('/api/v1/magnificent-x', () => {
  it('serves a bounded Pokémon research page with private shared caching', () => {
    const recorder = responseRecorder()
    handler(
      request('/api/v1/magnificent-x?domain=pokemon&q=char&limit=5'),
      recorder.response,
    )
    const payload = recorder.json() as {
      schemaVersion: string
      items: Array<{ subject: { domain: string; name: string } }>
      meta: { magnificentEligibleCount: number }
    }

    expect(recorder.response.statusCode).toBe(200)
    expect(recorder.headers.get('cache-control')).toContain('s-maxage=300')
    expect(payload.schemaVersion).toBe('magnificent-x-feed.v1')
    expect(payload.items.map((item) => item.subject.name)).toContain('Charizard')
    expect(payload.items.every((item) => item.subject.domain === 'pokemon')).toBe(true)
    expect(payload.meta.magnificentEligibleCount).toBe(0)
  })

  it('rejects duplicate, unsupported, and oversized query parameters', () => {
    for (const url of [
      '/api/v1/magnificent-x?domain=pokemon&domain=baseball',
      '/api/v1/magnificent-x?domain=quidditch',
      '/api/v1/magnificent-x?tier=buy_now',
      '/api/v1/magnificent-x?page=0',
    ]) {
      const recorder = responseRecorder()
      handler(request(url), recorder.response)
      expect(recorder.response.statusCode).toBe(400)
      expect(recorder.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('permits only GET', () => {
    const recorder = responseRecorder()
    handler(request('/api/v1/magnificent-x', 'POST'), recorder.response)

    expect(recorder.response.statusCode).toBe(405)
    expect(recorder.headers.get('allow')).toBe('GET')
  })
})
