import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  binderGraduationBands,
  binderGraduationSortKeys,
  binderGraduationSports,
  buildBinderGraduationCatalog,
  buildBinderGraduationFeed,
  type BinderGraduationQuery,
} from '../_binder-graduation-index.js'

const allowedParameters = new Set([
  'sport',
  'q',
  'maxAge',
  'position',
  'band',
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

export function handleBackstopBinderIndex(
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
      request.url ?? '/api/v1/backstop-binder-index',
      'https://baseball-oracle.local',
    )
    for (const key of url.searchParams.keys()) {
      if (!allowedParameters.has(key)) {
        throw new Error(`${key} is unsupported`)
      }
    }
    const sport = oneParameter(url.searchParams, 'sport') ?? 'all'
    const band = oneParameter(url.searchParams, 'band') ?? 'all'
    const sort =
      oneParameter(url.searchParams, 'sort') ?? 'graduation_rank'
    if (
      !binderGraduationSports.includes(
        sport as (typeof binderGraduationSports)[number],
      )
    ) {
      throw new Error('sport is unsupported')
    }
    if (
      band !== 'all' &&
      !binderGraduationBands.includes(
        band as (typeof binderGraduationBands)[number],
      )
    ) {
      throw new Error('band is unsupported')
    }
    if (
      !binderGraduationSortKeys.includes(
        sort as (typeof binderGraduationSortKeys)[number],
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
    const catalog = buildBinderGraduationCatalog(now)
    if (position) {
      const supported = new Set(
        catalog.items
          .filter(
            (item) => sport === 'all' || item.player.sport === sport,
          )
          .flatMap((item) => item.player.positions),
      )
      if (!supported.has(position)) {
        throw new Error('position is unsupported for this sport')
      }
    }
    const query: BinderGraduationQuery = {
      sport: sport as BinderGraduationQuery['sport'],
      q: search,
      maxAge,
      position,
      band: band as BinderGraduationQuery['band'],
      sort: sort as BinderGraduationQuery['sort'],
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
    const payload = buildBinderGraduationFeed(catalog, query)
    response.setHeader('X-Snapshot-Id', payload.snapshot.id)
    response.setHeader('X-Model-Version', payload.modelVersion)
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

export default function backstopBinderIndexHandler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  handleBackstopBinderIndex(request, response, new Date())
}
