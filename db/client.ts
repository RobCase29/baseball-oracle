import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

export function databaseUrl(): string {
  const url = [process.env.DATABASE_URL, process.env.POSTGRES_URL].find(
    (candidate): candidate is string => Boolean(candidate?.trim()),
  )
  if (!url) {
    throw new Error('DATABASE_URL is required for server-side database access')
  }
  return url
}

export function directDatabaseUrl(): string {
  return (
    [process.env.DATABASE_URL_UNPOOLED, process.env.POSTGRES_URL_NON_POOLING].find(
      (candidate): candidate is string => Boolean(candidate?.trim()),
    ) ?? databaseUrl()
  )
}

export function getDatabase() {
  const client = neon(databaseUrl())
  return drizzle(client, { schema })
}
