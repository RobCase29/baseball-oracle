import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { directDatabaseUrl } from '../db/client.js'

const migrationDirectory = resolve(process.cwd(), 'db/migrations')
const advisoryLockId = 2_026_071_101

async function migrate() {
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public.schema_migration (
        filename text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `
    await sql`SELECT pg_advisory_lock(${advisoryLockId})`

    const filenames = (await readdir(migrationDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort()

    for (const filename of filenames) {
      const body = await readFile(resolve(migrationDirectory, filename), 'utf8')
      const sha256 = createHash('sha256').update(body).digest('hex')
      const existing = await sql<{ sha256: string }[]>`
        SELECT sha256 FROM public.schema_migration WHERE filename = ${filename}
      `

      if (existing.length > 0) {
        if (existing[0].sha256 !== sha256) {
          throw new Error(`Applied migration changed on disk: ${filename}`)
        }
        continue
      }

      await sql.begin(async (transaction) => {
        await transaction.unsafe(body)
        await transaction`
          INSERT INTO public.schema_migration (filename, sha256)
          VALUES (${filename}, ${sha256})
        `
      })
      process.stdout.write(`Applied ${filename}\n`)
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(${advisoryLockId})`.catch(() => undefined)
    await sql.end({ timeout: 5 })
  }
}

migrate().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
