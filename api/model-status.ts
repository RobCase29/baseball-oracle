import type { IncomingMessage, ServerResponse } from 'node:http'
import modelStatus from './_data/model-status.json' with { type: 'json' }

export default function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    response.statusCode = 405
    response.end()
    return
  }

  const body = JSON.stringify(modelStatus)
  response.statusCode = 200
  response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(request.method === 'HEAD' ? undefined : body)
}
