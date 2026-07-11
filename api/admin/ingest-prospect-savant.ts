import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  prospectSavantLevels,
  prospectSavantRoles,
} from '../../scripts/ingest/prospect-savant.js'
import { ingestProspectSavantSlice } from '../../scripts/ingest/prospect-savant-leaders.js'
import { refreshPlayerDirectorySnapshot } from '../../scripts/ingest/player-directory.js'
import {
  readJsonBody,
  requirePostAndAuthorization,
  sendJson,
} from '../_admin.js'

const requestSchema = z.object({
  role: z.enum(prospectSavantRoles),
  level: z.enum(prospectSavantLevels),
  season: z.number().int().min(2023).max(2100),
  pitchQualifier: z.number().int().positive().default(1),
  minAge: z.number().int().min(0).max(100).default(16),
  maxAge: z.number().int().min(0).max(100).default(40),
})

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (!requirePostAndAuthorization(request, response)) return

  try {
    const input = requestSchema.parse(await readJsonBody(request))
    if (input.minAge > input.maxAge) {
      sendJson(response, 400, { error: 'minAge must not exceed maxAge' })
      return
    }

    const result = await ingestProspectSavantSlice(input)
    if (result.status === 'stored') await refreshPlayerDirectorySnapshot()
    sendJson(response, 200, result)
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      sendJson(response, 400, { error: 'Invalid ingestion request' })
      return
    }

    console.error('Prospect Savant ingestion failed', error)
    sendJson(response, 500, { error: 'Ingestion failed' })
  }
}
