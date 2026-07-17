import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  CARD_MARKET_SCHEMA_VERSION,
  type CardMarketModel,
  type CardMarketResponse,
} from '../src/domain/cardMarket.js'

const CARD_MARKET_MODEL_VERSION = 'card-market-v1'
const CACHE_FRESH_MS = 5 * 60 * 1_000
const CACHE_STALE_MS = 60 * 60 * 1_000
const MAX_CACHE_ENTRIES = 250

const playerModelSchema = z.object({
  modelId: z.string().min(1).max(300),
  player: z.object({
    name: z.string().min(1).max(160),
    normalizedName: z.string().min(1).max(160),
    currentTeamCode: z.string().max(20).nullable().optional(),
    currentTeamName: z.string().max(120).nullable().optional(),
    checklistTeam: z.string().max(120).nullable().optional(),
  }),
  card: z.object({
    release: z.string().min(1).max(160),
    releaseYear: z.number().int().min(1900).max(2200),
    productFamily: z.string().min(1).max(120),
    cardType: z.literal('Base Auto'),
    grade: z.literal('Raw'),
  }),
  valuation: z.object({
    amount: z.number().positive().nullable(),
    currency: z.literal('USD'),
    low: z.number().positive().nullable(),
    high: z.number().positive().nullable(),
    confidenceScore: z.number().int().min(0).max(100),
    evidenceTier: z.string().min(1).max(60),
    evidenceQuality: z.enum(['strong', 'moderate', 'thin', 'unpriced']),
    actionable: z.boolean(),
  }),
  evidence: z.object({
    sales: z.number().int().min(0),
    effectiveSales: z.number().min(0),
    sales30: z.number().int().min(0),
    sales90: z.number().int().min(0),
    auctionSales: z.number().int().min(0),
    binSales: z.number().int().min(0),
    volatility: z.number().min(0),
    latestSaleAt: z.string().datetime().nullable(),
  }),
  freshness: z.object({
    modelGeneratedAt: z.string().datetime().nullable(),
    modelAgeDays: z.number().int().min(0).nullable(),
    latestSaleAgeDays: z.number().int().min(0).nullable(),
    stale: z.boolean(),
  }),
  variationLadder: z.array(z.object({
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    multiplier: z.number().positive(),
    amount: z.number().positive().nullable(),
    low: z.number().positive().nullable(),
    high: z.number().positive().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    evidenceTier: z.string().max(60).nullable(),
    actionable: z.boolean(),
  })).max(100).optional(),
})

const upstreamSchema = z.object({
  schemaVersion: z.literal('player-models.v1'),
  modelVersion: z.string().min(1).max(120),
  generatedAt: z.string().datetime(),
  snapshotGeneratedAt: z.string().datetime().nullable(),
  warnings: z.array(z.string().max(500)).max(20),
  items: z.array(playerModelSchema).max(100),
})

interface CardMarketDependencies {
  apiBase: () => string
  apiKey: () => string | null
  fetcher: typeof fetch
  now?: () => number
}

interface CachedMarketResponse {
  response: CardMarketResponse
  upstreamEtag: string | null
  revalidateAfter: number
  staleUntil: number
}

const dependencies: CardMarketDependencies = {
  apiBase: () => process.env.BACKSTOP_API_BASE?.trim() || 'https://backstopcards.com',
  apiKey: () => process.env.BACKSTOP_API_KEY?.trim() || null,
  fetcher: fetch,
}

function singleParameter(parameters: URLSearchParams, name: string): string | null {
  const values = parameters.getAll(name)
  return values.length === 1 ? values[0].trim() : null
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

export function parseCardMarketQuery(request: IncomingMessage): {
  player: string
  release: string | null
} | null {
  let url: URL
  try {
    url = new URL(request.url ?? '/', 'https://baseball-oracle.local')
  } catch {
    return null
  }
  if (Array.from(url.searchParams.keys()).some((key) => key !== 'player' && key !== 'release')) {
    return null
  }
  const player = singleParameter(url.searchParams, 'player')
  const release = url.searchParams.has('release')
    ? singleParameter(url.searchParams, 'release')
    : null
  if (
    !player ||
    player.length > 160 ||
    hasControlCharacter(player) ||
    (release !== null && (
      release.length < 1 ||
      release.length > 160 ||
      hasControlCharacter(release)
    ))
  ) return null
  return { player, release }
}

function cardMarketModel(
  input: z.infer<typeof playerModelSchema>,
): CardMarketModel {
  return {
    modelId: input.modelId,
    matchKey: `${input.player.normalizedName}|${input.card.release.toLocaleLowerCase('en-US')}`,
    player: {
      name: input.player.name,
      normalizedName: input.player.normalizedName,
      currentTeamCode: input.player.currentTeamCode ?? null,
      currentTeamName: input.player.currentTeamName ?? null,
      checklistTeam: input.player.checklistTeam ?? null,
    },
    card: input.card,
    valuation: input.valuation,
    evidence: input.evidence,
    freshness: input.freshness,
    variations: (input.variationLadder ?? []).map((variation) => ({ ...variation })),
  }
}

export function cardMarketResponse(
  player: string,
  input: z.infer<typeof upstreamSchema>,
): CardMarketResponse {
  const items = input.items
    .map(cardMarketModel)
    .toSorted((left, right) => (
      right.card.releaseYear - left.card.releaseYear ||
      Number(right.valuation.actionable) - Number(left.valuation.actionable) ||
      right.valuation.confidenceScore - left.valuation.confidenceScore ||
      left.card.release.localeCompare(right.card.release)
    ))
  return {
    schemaVersion: CARD_MARKET_SCHEMA_VERSION,
    player,
    generatedAt: input.generatedAt,
    snapshotGeneratedAt: input.snapshotGeneratedAt,
    modelVersion: CARD_MARKET_MODEL_VERSION,
    count: items.length,
    items,
    warnings: [],
  }
}

function setHeaders(response: ServerResponse, cacheControl = 'no-store'): void {
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
  cacheControl = 'no-store',
): void {
  const json = JSON.stringify(body)
  const etag = `"${createHash('sha256').update(json).digest('base64url')}"`
  response.statusCode = status
  setHeaders(response, cacheControl)
  response.setHeader('ETag', etag)
  if (request.headers?.['if-none-match'] === etag && status === 200) {
    response.statusCode = 304
    response.removeHeader('Content-Type')
    response.end()
    return
  }
  response.setHeader('Content-Length', Buffer.byteLength(json).toString())
  response.end(request.method === 'HEAD' ? undefined : json)
}

export function createCardMarketHandler(
  inputDependencies: CardMarketDependencies = dependencies,
) {
  const cache = new Map<string, CachedMarketResponse>()
  const now = inputDependencies.now ?? Date.now

  function cacheKey(player: string, release: string | null): string {
    return `${player.toLocaleLowerCase('en-US')}|${release?.toLocaleLowerCase('en-US') ?? ''}`
  }

  function cacheResponse(
    key: string,
    response: CardMarketResponse,
    upstreamEtag: string | null,
    currentTime: number,
  ): void {
    if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value as string | undefined
      if (oldestKey) cache.delete(oldestKey)
    }
    cache.set(key, {
      response,
      upstreamEtag,
      revalidateAfter: currentTime + CACHE_FRESH_MS,
      staleUntil: currentTime + CACHE_STALE_MS,
    })
  }

  function sendStaleFallback(
    request: IncomingMessage,
    response: ServerResponse,
    cached: CachedMarketResponse | undefined,
    currentTime: number,
  ): boolean {
    if (!cached || currentTime >= cached.staleUntil) return false
    sendJson(request, response, 200, {
      ...cached.response,
      warnings: ['market_data_stale_fallback'],
    }, 'private, max-age=30, stale-while-revalidate=300')
    return true
  }

  return async function cardMarketHandler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      sendJson(request, response, 405, { error: 'Method not allowed' })
      return
    }
    const query = parseCardMarketQuery(request)
    if (!query) {
      sendJson(request, response, 400, { error: 'Invalid query parameters' })
      return
    }
    const apiKey = inputDependencies.apiKey()
    if (!apiKey) {
      sendJson(request, response, 503, { error: 'Card market is not configured' })
      return
    }
    const currentTime = now()
    const key = cacheKey(query.player, query.release)
    let cached = cache.get(key)
    if (cached && currentTime < cached.revalidateAfter) {
      sendJson(
        request,
        response,
        200,
        cached.response,
        'private, max-age=60, stale-while-revalidate=300',
      )
      return
    }
    if (cached && currentTime >= cached.staleUntil) {
      cache.delete(key)
      cached = undefined
    }

    try {
      const url = new URL('/api/v1/player-models', inputDependencies.apiBase())
      url.searchParams.set('player', query.player)
      if (query.release) url.searchParams.set('release', query.release)
      url.searchParams.set('priced', 'all')
      url.searchParams.set('include', 'ladder')
      url.searchParams.set('limit', '100')
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      if (cached?.upstreamEtag) headers['If-None-Match'] = cached.upstreamEtag
      const upstream = await inputDependencies.fetcher(url, {
        headers,
        signal: AbortSignal.timeout(8_000),
      })
      if (upstream.status === 304 && cached) {
        cacheResponse(key, cached.response, cached.upstreamEtag, currentTime)
        sendJson(
          request,
          response,
          200,
          cached.response,
          'private, max-age=60, stale-while-revalidate=300',
        )
        return
      }
      if (!upstream.ok) {
        if (upstream.status === 429) {
          const retryAfter = upstream.headers.get('retry-after')
          if (retryAfter) response.setHeader('Retry-After', retryAfter)
        }
        if (sendStaleFallback(request, response, cached, currentTime)) return
        sendJson(request, response, 503, { error: 'Card market is temporarily unavailable' })
        return
      }
      const parsed = upstreamSchema.safeParse(await upstream.json())
      if (!parsed.success) {
        if (sendStaleFallback(request, response, cached, currentTime)) return
        sendJson(request, response, 502, { error: 'Card market returned an unexpected response' })
        return
      }
      const normalized = cardMarketResponse(query.player, parsed.data)
      cacheResponse(key, normalized, upstream.headers.get('etag'), currentTime)
      sendJson(
        request,
        response,
        200,
        normalized,
        'private, max-age=60, stale-while-revalidate=300',
      )
    } catch (error) {
      console.error('Card market query failed', error)
      if (sendStaleFallback(request, response, cached, currentTime)) return
      sendJson(request, response, 503, { error: 'Card market is temporarily unavailable' })
    }
  }
}

export default createCardMarketHandler()
