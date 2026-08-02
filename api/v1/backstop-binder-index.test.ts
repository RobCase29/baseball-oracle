import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { handleBackstopBinderIndex } from './backstop-binder-index.js'

interface CapturedResponse {
  statusCode: number
  headers: Map<string, string>
  body: string
}

function invoke(
  url: string,
  method = 'GET',
): CapturedResponse {
  const captured: CapturedResponse = {
    statusCode: 0,
    headers: new Map(),
    body: '',
  }
  const request = { method, url } as IncomingMessage
  const responseObject = {
    statusCode: 200,
    setHeader(name: string, value: string | number) {
      captured.headers.set(name.toLocaleLowerCase('en-US'), String(value))
    },
    end: (body?: string) => {
      captured.statusCode = responseObject.statusCode
      captured.body = body ?? ''
    },
  }
  const response = responseObject as unknown as ServerResponse

  handleBackstopBinderIndex(
    request,
    response,
    new Date('2026-08-02T11:00:00.000Z'),
  )
  return captured
}

describe('GET /api/v1/backstop-binder-index', () => {
  it('serves the young cross-sport Graduation Board', () => {
    const response = invoke(
      '/api/v1/backstop-binder-index?maxAge=26&sort=graduation_rank&limit=10',
    )
    const payload = JSON.parse(response.body) as {
      schemaVersion: string
      items: Array<{
        player: { name: string }
        graduation: { probability: null }
      }>
      meta: { probabilityAvailable: boolean }
    }

    expect(response.statusCode).toBe(200)
    expect(payload.schemaVersion).toBe('backstop-binder-index.v1')
    expect(payload.items[0]?.player.name).toBe('Kon Knueppel')
    expect(payload.items.every(
      (item) => item.graduation.probability === null,
    )).toBe(true)
    expect(payload.meta.probabilityAvailable).toBe(false)
    expect(response.headers.get('x-snapshot-id')).toMatch(
      /^backstop-binder-index\/v1:/u,
    )
  })

  it('supports HEAD without returning the body', () => {
    const response = invoke(
      '/api/v1/backstop-binder-index?sport=football',
      'HEAD',
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('')
    expect(response.headers.get('x-model-version')).toContain(
      'binder-graduation-readiness',
    )
  })

  it('rejects unsupported filters and duplicate parameters', () => {
    expect(invoke(
      '/api/v1/backstop-binder-index?sport=hockey',
    ).statusCode).toBe(400)
    expect(invoke(
      '/api/v1/backstop-binder-index?band=maybe',
    ).statusCode).toBe(400)
    expect(invoke(
      '/api/v1/backstop-binder-index?maxAge=26&maxAge=30',
    ).statusCode).toBe(400)
  })

  it('rejects mutation methods', () => {
    const response = invoke('/api/v1/backstop-binder-index', 'POST')

    expect(response.statusCode).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })
})
