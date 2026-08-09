import type { IncomingMessage, ServerResponse } from 'node:http'
import playersHandler from '../players.js'

export default async function binderScores(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let url: URL
  try {
    url = new URL(request.url ?? '/', 'https://baseball-oracle.local')
  } catch {
    response.statusCode = 400
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'Invalid query parameters' }))
    return
  }

  url.pathname = '/api/players'
  url.searchParams.delete('view')
  url.searchParams.set('view', 'binder')
  const originalUrl = request.url
  request.url = `${url.pathname}${url.search}`
  try {
    await playersHandler(request, response)
  } finally {
    request.url = originalUrl
  }
}
