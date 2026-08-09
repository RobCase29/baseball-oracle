import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  buildHobbyMasterCatalog,
  buildHobbyMasterFeed,
  hobbyMasterCatalog,
  hobbyMasterDomains,
  hobbyMasterPostures,
  hobbyMasterSortDirections,
  type HobbyMasterQuery,
} from '../_hobby-master-ranking.js'
import {
  HOBBY_MASTER_SORT_KEYS,
} from '../../src/domain/hobbyMasterRanking.js'

const allowedParameters = new Set([
  'q',
  'screen',
  'domain',
  'posture',
  'sort',
  'direction',
  'page',
  'limit',
])

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
  maximum?: number,
): number | undefined {
  if (value === undefined) return undefined
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer`)
  }
  const parsed = Number(value)
  if (
    !Number.isSafeInteger(parsed) ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw new Error(`${name} is outside the supported range`)
  }
  return parsed
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  cacheControl: string,
  head = false,
): void {
  response.statusCode = statusCode
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(head ? undefined : JSON.stringify(body))
}

export function handleHobbyMasterRanking(
  request: IncomingMessage,
  response: ServerResponse,
  now = new Date(),
): void {
  const head = request.method === 'HEAD'
  if (request.method !== 'GET' && !head) {
    response.setHeader('Allow', 'GET, HEAD')
    writeJson(response, 405, { error: 'Method not allowed' }, 'no-store')
    return
  }
  try {
    const url = new URL(
      request.url ?? '/api/v2/hobby-oracle',
      'https://baseball-oracle.local',
    )
    for (const key of url.searchParams.keys()) {
      if (!allowedParameters.has(key)) {
        throw new Error(`${key} is unsupported`)
      }
    }
    const screen = oneParameter(url.searchParams, 'screen') ?? 'standard'
    const domain = oneParameter(url.searchParams, 'domain') ?? 'all'
    const posture = oneParameter(url.searchParams, 'posture') ?? 'all'
    const sort = oneParameter(url.searchParams, 'sort') ??
      (screen === 'breakout' ? 'breakout' : 'master_rank')
    const direction = oneParameter(url.searchParams, 'direction') ??
      (
        sort === 'master_rank' ||
        sort === 'cohort_rank' ||
        sort === 'name'
          ? 'asc'
          : 'desc'
      )
    if (
      screen !== 'standard' &&
      screen !== 'breakout'
    ) {
      throw new Error('screen is unsupported')
    }
    if (
      domain !== 'all' &&
      !hobbyMasterDomains.includes(
        domain as (typeof hobbyMasterDomains)[number],
      )
    ) {
      throw new Error('domain is unsupported')
    }
    if (
      posture !== 'all' &&
      !hobbyMasterPostures.includes(
        posture as (typeof hobbyMasterPostures)[number],
      )
    ) {
      throw new Error('posture is unsupported')
    }
    if (
      !HOBBY_MASTER_SORT_KEYS.includes(
        sort as (typeof HOBBY_MASTER_SORT_KEYS)[number],
      )
    ) {
      throw new Error('sort is unsupported')
    }
    if (
      !hobbyMasterSortDirections.includes(
        direction as (typeof hobbyMasterSortDirections)[number],
      )
    ) {
      throw new Error('direction is unsupported')
    }
    const search = oneParameter(url.searchParams, 'q')
    if (search !== undefined && search.trim().length > 100) {
      throw new Error('q may not exceed 100 characters')
    }
    const catalog = buildHobbyMasterCatalog(hobbyMasterCatalog.snapshot, now)
    const payload = buildHobbyMasterFeed(catalog, {
      q: search,
      screen: screen as HobbyMasterQuery['screen'],
      domain: domain as HobbyMasterQuery['domain'],
      posture: posture as HobbyMasterQuery['posture'],
      sort: sort as HobbyMasterQuery['sort'],
      direction: direction as HobbyMasterQuery['direction'],
      page: positiveInteger(oneParameter(url.searchParams, 'page'), 'page'),
      limit: positiveInteger(
        oneParameter(url.searchParams, 'limit'),
        'limit',
        100,
      ),
    })
    writeJson(
      response,
      200,
      payload,
      'private, max-age=0, s-maxage=300, stale-while-revalidate=900',
      head,
    )
  } catch (error) {
    writeJson(
      response,
      400,
      {
        error:
          error instanceof Error
            ? error.message
            : 'Invalid query parameters',
      },
      'no-store',
      head,
    )
  }
}

export default function hobbyMasterRankingHandler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  handleHobbyMasterRanking(request, response)
}
