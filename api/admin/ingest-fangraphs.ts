import type { IncomingMessage, ServerResponse } from 'node:http'
import { ingestFangraphsProspects } from '../../scripts/ingest/fangraphs-prospects.js'
import { requirePostAndAuthorization, sendJson } from '../_admin.js'

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (!requirePostAndAuthorization(request, response)) return

  try {
    const result = await ingestFangraphsProspects()
    sendJson(response, 200, result)
  } catch (error) {
    console.error('FanGraphs ingestion failed', error)
    sendJson(response, 500, { error: 'Ingestion failed' })
  }
}
