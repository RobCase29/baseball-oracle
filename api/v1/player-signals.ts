import type { IncomingMessage, ServerResponse } from 'node:http'
import playersHandler from '../players.js'

export default function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? '/api/v1/player-signals', 'https://baseball-oracle.local')
  url.pathname = '/api/players'
  url.searchParams.set('view', 'signals')
  request.url = `${url.pathname}${url.search}`
  return playersHandler(request, response)
}
