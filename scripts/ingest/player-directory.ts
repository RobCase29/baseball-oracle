import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'

export async function refreshPlayerDirectorySnapshot(): Promise<void> {
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })

  try {
    await sql`REFRESH MATERIALIZED VIEW app.player_directory_snapshot`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
