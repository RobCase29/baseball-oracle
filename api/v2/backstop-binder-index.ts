import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  loadBaseballGraduationUniverse,
  type BaseballGraduationUniverse,
} from '../_baseball-graduation-universe.js'
import {
  binderGraduationV2Bands,
  binderGraduationV2SortKeys,
  binderGraduationV2Sports,
  buildBinderGraduationV2Catalog,
  buildBinderGraduationV2Feed,
  type BinderGraduationV2Catalog,
  type BinderGraduationV2Query,
} from '../_binder-graduation-index-v2.js'

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
const CATALOG_CACHE_MS = 5 * 60 * 1_000
let cachedCatalog: {
  universeSnapshotId: string
  expiresAt: number
  value: BinderGraduationV2Catalog
} | null = null

function catalogFor(
  universe: BaseballGraduationUniverse,
  now: Date,
): BinderGraduationV2Catalog {
  if (
    cachedCatalog?.universeSnapshotId === universe.snapshotId &&
    cachedCatalog.expiresAt > now.valueOf()
  ) {
    return cachedCatalog.value
  }
  const value = buildBinderGraduationV2Catalog(universe, now)
  cachedCatalog = {
    universeSnapshotId: universe.snapshotId,
    expiresAt: now.valueOf() + CATALOG_CACHE_MS,
    value,
  }
  return value
}

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

export async function handleBackstopBinderIndexV2(
  request: IncomingMessage,
  response: ServerResponse,
  now = new Date(),
  universeLoader: (
    now: Date,
  ) => Promise<BaseballGraduationUniverse> =
    loadBaseballGraduationUniverse,
): Promise<void> {
  const head = request.method === 'HEAD'
  if (request.method !== 'GET' && !head) {
    response.setHeader('Allow', 'GET, HEAD')
    writeJson(response, 405, { error: 'Method not allowed' }, 'no-store')
    return
  }

  let query: BinderGraduationV2Query
  let sport: (typeof binderGraduationV2Sports)[number]
  let position: string | undefined
  try {
    const url = new URL(
      request.url ?? '/api/v2/backstop-binder-index',
      'https://baseball-oracle.local',
    )
    for (const key of url.searchParams.keys()) {
      if (!allowedParameters.has(key)) {
        throw new Error(`${key} is unsupported`)
      }
    }
    const sportValue =
      oneParameter(url.searchParams, 'sport') ?? 'all'
    sport = sportValue as typeof sport
    const band = oneParameter(url.searchParams, 'band') ?? 'all'
    const sort =
      oneParameter(url.searchParams, 'sort') ?? 'graduation_rank'
    if (
      !binderGraduationV2Sports.includes(
        sport as (typeof binderGraduationV2Sports)[number],
      )
    ) {
      throw new Error('sport is unsupported')
    }
    if (
      band !== 'all' &&
      !binderGraduationV2Bands.includes(
        band as (typeof binderGraduationV2Bands)[number],
      )
    ) {
      throw new Error('band is unsupported')
    }
    if (
      !binderGraduationV2SortKeys.includes(
        sort as (typeof binderGraduationV2SortKeys)[number],
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
    position = oneParameter(url.searchParams, 'position')
      ?.trim()
      .toLocaleUpperCase('en-US')
    query = {
      sport: sport as BinderGraduationV2Query['sport'],
      q: search,
      maxAge,
      position,
      band: band as BinderGraduationV2Query['band'],
      sort: sort as BinderGraduationV2Query['sort'],
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
    return
  }

  try {
    const baseballUniverse = await universeLoader(now)
    const catalog = catalogFor(baseballUniverse, now)
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
    const payload = buildBinderGraduationV2Feed(catalog, query)
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
    const message =
      error instanceof Error
        ? error.message
        : 'Unified Graduation Board is unavailable'
    const invalidPosition = message ===
      'position is unsupported for this sport'
    writeJson(
      response,
      invalidPosition ? 400 : 503,
      {
        error: invalidPosition
          ? message
          : 'unified_graduation_source_unavailable',
        reason: message,
        retryable: !invalidPosition,
      },
      'no-store',
      head,
    )
  }
}

export default async function backstopBinderIndexV2Handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await handleBackstopBinderIndexV2(request, response, new Date())
}
