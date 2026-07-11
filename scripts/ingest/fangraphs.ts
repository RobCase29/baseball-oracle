import { z } from 'zod'
import {
  fetchWithRetry as fetchUrlWithRetry,
  sha256,
  stableStringify,
  type SourceRecord,
} from './shared.js'

export {
  idempotencyKey,
  normalizeRequestUrl,
  requestFingerprint,
  safeResponseHeaders,
  sanitizedRequest,
  schemaFingerprint,
  sha256,
  stableStringify,
  type SourceRecord,
} from './shared.js'

const sourceRecordSchema = z.record(z.string(), z.unknown())

export const fangraphsEnvelopeSchema = z
  .object({
    dataScout: z.array(sourceRecordSchema),
    dataStats: z.array(sourceRecordSchema),
  })
  .passthrough()

export type FangraphsEnvelope = z.infer<typeof fangraphsEnvelopeSchema>
export const PARSER_VERSION = 'fangraphs-prospect-board-v1'

function identifier(record: SourceRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return `${key}:${value.trim()}`
    if (typeof value === 'number' && Number.isFinite(value)) return `${key}:${value}`
  }
  return null
}

export function sourceRecordKey(
  recordType: 'scout' | 'stats',
  record: SourceRecord,
): string {
  if (recordType === 'scout') {
    return (
      identifier(record, ['RowID', 'ID', 'PlayerId', 'UPID', 'minorMasterId']) ??
      `hash:${sha256(stableStringify(record))}`
    )
  }

  const player =
    identifier(record, ['UPID', 'minormasterid', 'xMLBAMID', 'playerids']) ??
    `hash:${sha256(stableStringify(record)).slice(0, 24)}`
  const context = ['Season', 'level', 'aLevel', 'Team', 'AffId', 'playerTeamId']
    .map((key) => `${key}:${String(record[key] ?? '')}`)
    .join('|')

  return `${player}|${context}`
}

export function parseFangraphsEnvelope(body: string): FangraphsEnvelope {
  return fangraphsEnvelopeSchema.parse(JSON.parse(body))
}

export async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  return fetchUrlWithRetry(url, {
    attempts,
    sourceName: 'FanGraphs',
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'BaseballOracleResearch/0.1 (+https://github.com/RobCase29/baseball-oracle)',
    },
  })
}
