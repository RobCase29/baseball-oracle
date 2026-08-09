import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
} from './spotrac-contract-list-parser.js'
import {
  SPOTRAC_CONTRACT_PARSER_VERSION,
} from './spotrac-contract-parser.js'
import {
  SPOTRAC_PAGE_CACHE_SCHEMA_VERSION,
  SPOTRAC_MIN_REQUEST_INTERVAL_MS,
  SPOTRAC_ROBOTS_CACHE_SCHEMA_VERSION,
  SPOTRAC_ROBOTS_POLICY_URL,
  SPOTRAC_USER_AGENT,
  SpotracRequestPacer,
  createSpotracPageClient,
} from './spotrac-page-client.js'

const temporaryDirectories: string[] = []
const sourceUrl =
  'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts'
const teamSourceUrl =
  'https://www.spotrac.com/mlb/contracts/_/team/lad'

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotrac-cache-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function fixture(
  name = 'mookie-betts-contract.html',
): Promise<string> {
  return readFile(
    new URL(`./fixtures/${name}`, import.meta.url),
    'utf8',
  )
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ))
})

describe('Spotrac cached page client', () => {
  it('downloads once, verifies a content-addressed cache, and reuses it', async () => {
    const cacheDirectory = await temporaryDirectory()
    const html = await fixture()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        etag: '"fixture-v1"',
        'last-modified': 'Sun, 26 Jul 2026 20:00:00 GMT',
      },
    }))
    const client = createSpotracPageClient({
      cacheDirectory,
      fetchImpl,
      now: () => new Date('2026-07-26T20:00:00.000Z'),
      minimumRequestIntervalMs: 0,
    })

    const downloaded = await client.getPlayerPage(sourceUrl)
    const cached = await client.getPlayerPage(sourceUrl)

    expect(downloaded.cacheStatus).toBe('downloaded')
    expect(downloaded.html).toBe(html)
    expect(downloaded.contentSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(cached).toEqual({
      ...downloaded,
      cacheStatus: 'hit',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const cacheFiles = await readdir(cacheDirectory)
    expect(cacheFiles).toHaveLength(2)
    const metadataPath = path.join(
      cacheDirectory,
      cacheFiles.find((name) => name.endsWith('.json'))!,
    )
    const metadata = JSON.parse(
      await readFile(metadataPath, 'utf8'),
    ) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: SPOTRAC_PAGE_CACHE_SCHEMA_VERSION,
      parserVersion: SPOTRAC_CONTRACT_PARSER_VERSION,
      sourceUrl,
      etag: '"fixture-v1"',
    })
  })

  it('uses validators when a stale entry is revalidated', async () => {
    const cacheDirectory = await temporaryDirectory()
    const html = await fixture()
    let now = new Date('2026-07-26T20:00:00.000Z')
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html',
          etag: '"fixture-v1"',
          'last-modified': 'Sun, 26 Jul 2026 20:00:00 GMT',
        },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: { etag: '"fixture-v1"' },
      }))
    const client = createSpotracPageClient({
      cacheDirectory,
      fetchImpl,
      now: () => now,
      cacheTtlMs: 1_000,
      minimumRequestIntervalMs: 0,
    })

    const first = await client.getPlayerPage(sourceUrl)
    now = new Date('2026-07-26T20:01:00.000Z')
    const second = await client.getPlayerPage(sourceUrl)

    expect(first.cacheStatus).toBe('downloaded')
    expect(second.cacheStatus).toBe('revalidated')
    expect(second.html).toBe(html)
    const secondRequest = fetchImpl.mock.calls[1]
    const headers = new Headers(secondRequest?.[1]?.headers)
    expect(headers.get('if-none-match')).toBe('"fixture-v1"')
    expect(headers.get('if-modified-since'))
      .toBe('Sun, 26 Jul 2026 20:00:00 GMT')
  })

  it('serializes callers and enforces a start-to-start delay', async () => {
    let clock = 10_000
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds
    })
    const pacer = new SpotracRequestPacer(
      SPOTRAC_MIN_REQUEST_INTERVAL_MS,
      () => clock,
      sleep,
    )
    const starts: number[] = []

    await Promise.all([
      pacer.run(async () => {
        starts.push(clock)
        return 'first'
      }),
      pacer.run(async () => {
        starts.push(clock)
        return 'second'
      }),
    ])

    expect(starts).toEqual([
      10_000,
      10_000 + SPOTRAC_MIN_REQUEST_INTERVAL_MS,
    ])
    expect(sleep).toHaveBeenCalledWith(SPOTRAC_MIN_REQUEST_INTERVAL_MS)
  })

  it('honors a bounded Retry-After and does not cache block pages', async () => {
    const cacheDirectory = await temporaryDirectory()
    const blocked = await readFile(
      new URL('./fixtures/blocked-response.html', import.meta.url),
      'utf8',
    )
    const sleep = vi.fn(async () => undefined)
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { 'retry-after': '2' },
      }))
      .mockResolvedValueOnce(new Response(blocked, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }))
    const client = createSpotracPageClient({
      cacheDirectory,
      fetchImpl,
      sleep,
      minimumRequestIntervalMs: 0,
      maxAttempts: 2,
    })

    await expect(client.getPlayerPage(sourceUrl)).rejects.toMatchObject({
      code: 'blocked_response',
    })
    expect(sleep).toHaveBeenCalledWith(2_000)
    await expect(readdir(cacheDirectory)).resolves.toEqual([])
  })

  it('retries a transient network failure behind the request pacer', async () => {
    const cacheDirectory = await temporaryDirectory()
    const html = await fixture()
    const sleep = vi.fn(async () => undefined)
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('connect timeout'))
      .mockResolvedValueOnce(new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }))
    const client = createSpotracPageClient({
      cacheDirectory,
      fetchImpl,
      sleep,
      minimumRequestIntervalMs: 0,
      maxAttempts: 2,
    })

    await expect(client.getPlayerPage(sourceUrl)).resolves.toMatchObject({
      cacheStatus: 'downloaded',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1_000)
  })

  it('requires robots authorization before any team-page retrieval', async () => {
    const cacheDirectory = await temporaryDirectory()
    const fetchImpl = vi.fn<typeof fetch>()
    const client = createSpotracPageClient({
      cacheDirectory,
      fetchImpl,
      minimumRequestIntervalMs: 0,
    })

    await expect(
      client.getTeamContractListPage(teamSourceUrl),
    ).rejects.toMatchObject({
      code: 'robots_authorization_required',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches and caches robots with the same user agent before team pages', async () => {
    const cacheDirectory = await temporaryDirectory()
    const robots = await fixture('robots-team-pages.txt')
    const teamHtml = await fixture('mlb-team-contracts.html')
    let clock = Date.parse('2026-07-26T20:00:00.000Z')
    const starts: number[] = []
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds
    })
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      starts.push(clock)
      const url = String(input)
      if (url === SPOTRAC_ROBOTS_POLICY_URL) {
        return new Response(robots, {
          status: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            etag: '"robots-v1"',
          },
        })
      }
      if (url === teamSourceUrl) {
        return new Response(teamHtml, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = createSpotracPageClient({
      cacheDirectory,
      fetchImpl,
      now: () => new Date(clock),
      sleep,
      minimumRequestIntervalMs: 0,
    })

    const authorization = await client.authorizeTeamContractListPages([
      teamSourceUrl,
    ])
    const page = await client.getTeamContractListPage(teamSourceUrl)

    expect(authorization).toMatchObject({
      policyUrl: SPOTRAC_ROBOTS_POLICY_URL,
      cacheStatus: 'downloaded',
      userAgent: SPOTRAC_USER_AGENT,
      userAgentProduct: 'BaseballOracleTeamRunway',
      policyCrawlDelayMs: 7_000,
      effectiveMinimumRequestIntervalMs: 7_000,
      evaluatedUrls: [teamSourceUrl],
    })
    expect(page).toMatchObject({
      sourceUrl: teamSourceUrl,
      cacheStatus: 'downloaded',
    })
    expect(starts).toEqual([
      Date.parse('2026-07-26T20:00:00.000Z'),
      Date.parse('2026-07-26T20:00:07.000Z'),
    ])
    expect(sleep).toHaveBeenCalledWith(7_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const call of fetchImpl.mock.calls) {
      const headers = new Headers(call[1]?.headers)
      expect(headers.get('user-agent')).toBe(SPOTRAC_USER_AGENT)
    }

    const metadata = await Promise.all(
      (await readdir(cacheDirectory))
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => JSON.parse(
          await readFile(path.join(cacheDirectory, name), 'utf8'),
        ) as Record<string, unknown>),
    )
    expect(metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schemaVersion: SPOTRAC_ROBOTS_CACHE_SCHEMA_VERSION,
        sourceUrl: SPOTRAC_ROBOTS_POLICY_URL,
      }),
      expect.objectContaining({
        schemaVersion: SPOTRAC_PAGE_CACHE_SCHEMA_VERSION,
        parserVersion: SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
        sourceUrl: teamSourceUrl,
      }),
    ]))
  })

  it('reuses a fresh verified robots policy without a network fallback', async () => {
    const cacheDirectory = await temporaryDirectory()
    const robots = await fixture('robots-team-pages.txt')
    const firstFetch = vi.fn<typeof fetch>(async () => new Response(robots, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
    const now = () => new Date('2026-07-26T20:00:00.000Z')
    const firstClient = createSpotracPageClient({
      cacheDirectory,
      fetchImpl: firstFetch,
      now,
      minimumRequestIntervalMs: 0,
    })
    await firstClient.authorizeTeamContractListPages([teamSourceUrl])

    const secondFetch = vi.fn<typeof fetch>()
    const secondClient = createSpotracPageClient({
      cacheDirectory,
      fetchImpl: secondFetch,
      now,
      minimumRequestIntervalMs: 0,
    })
    const authorization =
      await secondClient.authorizeTeamContractListPages([teamSourceUrl])

    expect(authorization.cacheStatus).toBe('hit')
    expect(firstFetch).toHaveBeenCalledTimes(1)
    expect(secondFetch).not.toHaveBeenCalled()
  })

  it('fails closed when robots disallows or cannot parse a planned route', async () => {
    const disallowedDirectory = await temporaryDirectory()
    const disallowedFetch = vi.fn<typeof fetch>(
      async () => new Response(`
User-agent: *
Disallow: /mlb/contracts/_/team/
`, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const disallowedClient = createSpotracPageClient({
      cacheDirectory: disallowedDirectory,
      fetchImpl: disallowedFetch,
      minimumRequestIntervalMs: 0,
    })

    await expect(
      disallowedClient.authorizeTeamContractListPages([teamSourceUrl]),
    ).rejects.toMatchObject({
      code: 'robots_disallowed',
    })
    await expect(
      disallowedClient.getTeamContractListPage(teamSourceUrl),
    ).rejects.toMatchObject({
      code: 'robots_authorization_required',
    })
    expect(disallowedFetch).toHaveBeenCalledTimes(1)

    const malformedDirectory = await temporaryDirectory()
    const malformedFetch = vi.fn<typeof fetch>(
      async () => new Response(`
User-agent: *
Allow: /mlb/contracts/_/team/
Crawl-delay: later
`, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const malformedClient = createSpotracPageClient({
      cacheDirectory: malformedDirectory,
      fetchImpl: malformedFetch,
      minimumRequestIntervalMs: 0,
    })

    await expect(
      malformedClient.authorizeTeamContractListPages([teamSourceUrl]),
    ).rejects.toMatchObject({
      code: 'malformed_applicable_policy',
    })
    expect(malformedFetch).toHaveBeenCalledTimes(1)
  })

  it('paces robots retries at the non-bypassable minimum', async () => {
    const cacheDirectory = await temporaryDirectory()
    const robots = await fixture('robots-team-pages.txt')
    let clock = Date.parse('2026-07-26T20:00:00.000Z')
    const starts: number[] = []
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      starts.push(clock)
      if (starts.length === 1) throw new Error('temporary timeout')
      return new Response(robots, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    })
    const client = createSpotracPageClient({
      cacheDirectory,
      fetchImpl,
      now: () => new Date(clock),
      sleep,
      minimumRequestIntervalMs: 0,
      maxAttempts: 2,
    })

    await client.authorizeTeamContractListPages([teamSourceUrl])

    expect(starts).toEqual([
      Date.parse('2026-07-26T20:00:00.000Z'),
      Date.parse('2026-07-26T20:00:05.000Z'),
    ])
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds))
      .toEqual([1_000, 4_000])
  })
})
