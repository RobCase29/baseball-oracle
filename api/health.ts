import { neon } from '@neondatabase/serverless'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface HealthRow {
  database_time: string
  migration_count: string
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== 'GET') {
    response.statusCode = 405
    response.setHeader('Allow', 'GET')
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!databaseUrl) {
    response.statusCode = 503
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ status: 'unconfigured' }))
    return
  }

  try {
    const sql = neon(databaseUrl)
    const rows = await sql`
      SELECT
        now()::text AS database_time,
        count(*)::text AS migration_count
      FROM public.schema_migration
    `
    const [result] = rows as unknown as HealthRow[]

    response.statusCode = 200
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        status: 'ok',
        databaseTime: result.database_time,
        migrations: Number(result.migration_count),
      }),
    )
  } catch {
    response.statusCode = 503
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ status: 'unavailable' }))
  }
}
