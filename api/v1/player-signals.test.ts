import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { playersHandler } = vi.hoisted(() => ({ playersHandler: vi.fn() }))

vi.mock('../players.js', () => ({
  default: playersHandler,
}))

import handler from './player-signals.js'

describe('/api/v1/player-signals', () => {
  beforeEach(() => playersHandler.mockReset())

  it('forces the normalized signals view while preserving supported filters', () => {
    const request = {
      url: '/api/v1/player-signals?stage=RC&q=Joe+Mack&view=full',
    } as IncomingMessage
    const response = {} as ServerResponse

    handler(request, response)

    expect(request.url).toBe('/api/players?stage=RC&q=Joe+Mack&view=signals')
    expect(playersHandler).toHaveBeenCalledWith(request, response)
  })
})
