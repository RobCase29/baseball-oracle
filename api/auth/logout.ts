import type { IncomingMessage, ServerResponse } from 'node:http'
import { expiredOracleSessionCookie } from '../_oracle-auth.js'

export default function logout(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'POST') {
    response.statusCode = 405
    response.setHeader('Allow', 'POST')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  response.statusCode = 204
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Set-Cookie', expiredOracleSessionCookie())
  response.end()
}
