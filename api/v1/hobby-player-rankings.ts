import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  buildHobbyPlayerRankingCatalog,
  buildHobbyPlayerRankingsFeed,
  hobbyPlayerRankingPostures,
  hobbyPlayerRankingSortKeys,
  hobbyPlayerRankingSports,
  type HobbyPlayerRankingsQuery,
} from '../_hobby-player-rankings-v1.js'

const allowedParameters = new Set([
  'sport',
  'q',
  'maxAge',
  'position',
  'posture',
  'sort',
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

export function handleHobbyPlayerRankings(
  request: IncomingMessage,
  response: ServerResponse,
  now = new Date(),
): void {
  const head = request.method === 'HEAD'
  if (request.method !== 'GET' && !head) {
    response.setHeader('Allow', 'GET, HEAD')
    writeJson(
      response,
      405,
      { error: 'Method not allowed' },
      'no-store',
    )
    return
  }
  try {
    const url = new URL(
      request.url ?? '/api/v1/hobby-player-rankings',
      'https://baseball-oracle.local',
    )
    for (const key of url.searchParams.keys()) {
      if (!allowedParameters.has(key)) {
        throw new Error(`${key} is unsupported`)
      }
    }
    const sport = oneParameter(url.searchParams, 'sport') ?? 'football'
    const posture = oneParameter(url.searchParams, 'posture') ?? 'all'
    const sort = oneParameter(url.searchParams, 'sort') ?? 'score'
    if (
      !hobbyPlayerRankingSports.includes(
        sport as (typeof hobbyPlayerRankingSports)[number],
      )
    ) {
      throw new Error('sport is unsupported')
    }
    if (
      posture !== 'all' &&
      !hobbyPlayerRankingPostures.includes(
        posture as (typeof hobbyPlayerRankingPostures)[number],
      )
    ) {
      throw new Error('posture is unsupported')
    }
    if (
      !hobbyPlayerRankingSortKeys.includes(
        sort as (typeof hobbyPlayerRankingSortKeys)[number],
      )
    ) {
      throw new Error('sort is unsupported')
    }
    const search = oneParameter(url.searchParams, 'q')
    if (search !== undefined && search.trim().length > 100) {
      throw new Error('q may not exceed 100 characters')
    }
    const maxAge = positiveInteger(
      oneParameter(url.searchParams, 'maxAge'),
      'maxAge',
      60,
    )
    if (maxAge !== undefined && maxAge < 15) {
      throw new Error('maxAge is outside the supported range')
    }
    const position = oneParameter(url.searchParams, 'position')
      ?.trim()
      .toLocaleUpperCase('en-US')
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      now,
    )
    const sportKey = sport as (typeof hobbyPlayerRankingSports)[number]
    if (
      position &&
      !catalog.positionsBySport[sportKey].includes(position)
    ) {
      throw new Error('position is unsupported for this sport')
    }
    const query: HobbyPlayerRankingsQuery = {
      sport: sportKey,
      q: search,
      maxAge,
      position,
      posture: posture as HobbyPlayerRankingsQuery['posture'],
      sort: sort as HobbyPlayerRankingsQuery['sort'],
      page: positiveInteger(
        oneParameter(url.searchParams, 'page'),
        'page',
      ),
      limit: positiveInteger(
        oneParameter(url.searchParams, 'limit'),
        'limit',
        100,
      ),
    }
    const payload = buildHobbyPlayerRankingsFeed(catalog, query)
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

export default function hobbyPlayerRankingsHandler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  handleHobbyPlayerRankings(request, response, new Date())
}
