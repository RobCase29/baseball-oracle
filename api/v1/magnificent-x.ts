import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  buildMagnificentXFeed,
  buildMagnificentXCatalog,
  magnificentXCatalog,
  magnificentXDomains,
  magnificentXResearchPostures,
  magnificentXResearchTiers,
  magnificentXSortDirections,
  magnificentXSortKeys,
  type MagnificentXQuery,
} from '../_magnificent-x.js'

function oneParameter(
  searchParams: URLSearchParams,
  name: string,
): string | undefined {
  const values = searchParams.getAll(name)
  if (values.length > 1) throw new Error(`${name} may be provided only once`)
  return values[0]
}

function positiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`)
  return parsed
}

export default function magnificentXHandler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.method !== 'GET') {
    response.statusCode = 405
    response.setHeader('Allow', 'GET')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'https://baseball-oracle.local')
    const domainValue = oneParameter(url.searchParams, 'domain') ?? 'all'
    const tierValue = oneParameter(url.searchParams, 'tier') ?? 'all'
    const postureValue = oneParameter(url.searchParams, 'posture') ?? 'all'
    const sortValue = oneParameter(url.searchParams, 'sort')
    const directionValue = oneParameter(url.searchParams, 'direction')
    if (
      domainValue !== 'all' &&
      !magnificentXDomains.includes(
        domainValue as (typeof magnificentXDomains)[number],
      )
    ) {
      throw new Error('domain is unsupported')
    }
    if (
      tierValue !== 'all' &&
      !magnificentXResearchTiers.includes(
        tierValue as (typeof magnificentXResearchTiers)[number],
      )
    ) {
      throw new Error('tier is unsupported')
    }
    if (
      postureValue !== 'all' &&
      !magnificentXResearchPostures.includes(
        postureValue as (typeof magnificentXResearchPostures)[number],
      )
    ) {
      throw new Error('posture is unsupported')
    }
    if (
      sortValue !== undefined &&
      !magnificentXSortKeys.includes(
        sortValue as (typeof magnificentXSortKeys)[number],
      )
    ) {
      throw new Error('sort is unsupported')
    }
    if (
      directionValue !== undefined &&
      !magnificentXSortDirections.includes(
        directionValue as (typeof magnificentXSortDirections)[number],
      )
    ) {
      throw new Error('direction is unsupported')
    }
    const query: MagnificentXQuery = {
      q: oneParameter(url.searchParams, 'q'),
      domain: domainValue as MagnificentXQuery['domain'],
      tier: tierValue as MagnificentXQuery['tier'],
      posture: postureValue as MagnificentXQuery['posture'],
      sort: sortValue as MagnificentXQuery['sort'],
      direction: directionValue as MagnificentXQuery['direction'],
      page: positiveInteger(oneParameter(url.searchParams, 'page'), 'page'),
      limit: positiveInteger(oneParameter(url.searchParams, 'limit'), 'limit'),
    }
    // Re-evaluate the monthly freshness gate for every uncached request. A
    // warm function must not keep serving a pre-deadline status after expiry.
    const currentCatalog = buildMagnificentXCatalog(
      magnificentXCatalog.snapshot,
      new Date(),
    )
    const payload = buildMagnificentXFeed(currentCatalog, query)
    response.statusCode = 200
    response.setHeader(
      'Cache-Control',
      'private, max-age=0, s-maxage=300, stale-while-revalidate=900',
    )
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.end(JSON.stringify(payload))
  } catch (error) {
    response.statusCode = 400
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : 'Invalid query parameters',
    }))
  }
}
