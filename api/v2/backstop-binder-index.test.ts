import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  buildBaseballGraduationUniverseFromRows,
} from '../_baseball-graduation-universe.js'
import { handleBackstopBinderIndexV2 } from './backstop-binder-index.js'

interface CapturedResponse {
  statusCode: number
  headers: Map<string, string>
  body: string
}

const currentAt = new Date('2026-07-25T01:00:00.000Z')
const universe = buildBaseballGraduationUniverseFromRows([], currentAt)

async function invoke(
  url: string,
  method = 'GET',
  loader = async () => universe,
): Promise<CapturedResponse> {
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
  await handleBackstopBinderIndexV2(
    request,
    responseObject as unknown as ServerResponse,
    currentAt,
    loader,
  )
  return captured
}

describe('GET /api/v2/backstop-binder-index', () => {
  it('serves baseball inside the unified Graduation Board', async () => {
    const response = await invoke(
      '/api/v2/backstop-binder-index?maxAge=26&limit=20',
    )
    const payload = JSON.parse(response.body) as {
      schemaVersion: string
      items: Array<{
        player: { name: string; sport: string }
        graduation: { globalRank: number | null; probability: null }
      }>
      meta: { coverageBySport: { baseball: number } }
    }
    const skenes = payload.items.find(
      (item) => item.player.name === 'Paul Skenes',
    )

    expect(response.statusCode).toBe(200)
    expect(payload.schemaVersion).toBe('backstop-binder-index.v2')
    expect(payload.meta.coverageBySport.baseball).toBeGreaterThan(100)
    expect(skenes).toMatchObject({
      player: { sport: 'baseball' },
      graduation: { globalRank: 8, probability: null },
    })
    expect(response.headers.get('x-snapshot-id')).toMatch(
      /^backstop-binder-index\/v2:/u,
    )
  })

  it('filters baseball without minting a new rank', async () => {
    const response = await invoke(
      '/api/v2/backstop-binder-index?sport=baseball&maxAge=26&limit=20',
    )
    const payload = JSON.parse(response.body) as {
      items: Array<{
        player: { name: string; sport: string }
        graduation: { globalRank: number | null }
      }>
    }
    const skenes = payload.items.find(
      (item) => item.player.name === 'Paul Skenes',
    )

    expect(response.statusCode).toBe(200)
    expect(payload.items.every(
      (item) => item.player.sport === 'baseball',
    )).toBe(true)
    expect(skenes?.graduation.globalRank).toBe(8)
  })

  it('fails closed when the baseball universe cannot load', async () => {
    const response = await invoke(
      '/api/v2/backstop-binder-index',
      'GET',
      async () => {
        throw new Error('prospect directory unavailable')
      },
    )

    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'unified_graduation_source_unavailable',
      retryable: true,
    })
  })

  it('rejects invalid filters and mutation methods', async () => {
    expect((await invoke(
      '/api/v2/backstop-binder-index?sport=hockey',
    )).statusCode).toBe(400)
    const mutation = await invoke(
      '/api/v2/backstop-binder-index',
      'POST',
    )
    expect(mutation.statusCode).toBe(405)
    expect(mutation.headers.get('allow')).toBe('GET, HEAD')
  })
})
