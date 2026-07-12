import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  archiveSportsReferenceSeason,
  assertFullRunCoverage,
  parseArchiveSeasonArguments,
} from './archive-sports-reference-season.js'
import type {
  ImmutableObjectStore,
  ImmutableStorePutRequest,
  ImmutableStorePutResult,
} from './immutable-raw-archive.js'

const USER_AGENT =
  'BaseballOracleResearch/0.1 (+https://github.com/RobCase29/baseball-oracle; authorized research backfill)'
const PERMISSION_BODY = '# Authorized test evidence\n'
const SEASON = 2017

function sha256(body: Uint8Array | string): string {
  return createHash('sha256').update(body).digest('hex')
}

function fingerprint(url: string): string {
  return sha256(
    JSON.stringify({
      method: 'GET',
      url,
      userAgent: USER_AGENT,
      acceptEncoding: 'identity',
    }),
  )
}

class MemoryStore implements ImmutableObjectStore {
  readonly requests: ImmutableStorePutRequest[] = []
  readonly objects = new Map<string, Uint8Array>()
  failOnCall: number | null = null

  async putIfAbsent(request: ImmutableStorePutRequest): Promise<ImmutableStorePutResult> {
    this.requests.push(request)
    if (this.failOnCall === this.requests.length) throw new Error('injected upload failure')
    const status = this.objects.has(request.pathname) ? 'already-exists' : 'created'
    this.objects.set(request.pathname, request.body.slice())
    return {
      status,
      pathname: request.pathname,
      objectUri: `https://private.example.test/${request.pathname}`,
      byteLength: request.body.byteLength,
      etag: status,
    }
  }
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function testRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'baseball-oracle-bref-archive-'))
  temporaryDirectories.push(root)
  const permissions = path.join(root, 'docs/permissions')
  await mkdir(permissions, { recursive: true })
  await writeFile(
    path.join(permissions, 'RESEARCH_SOURCE_ATTESTATIONS.md'),
    PERMISSION_BODY,
  )
  return root
}

async function cachedRequest(root: string, url: string, bodyText: string) {
  const requestFingerprint = fingerprint(url)
  const payloadPath = path.posix.join(
    'data/raw/baseball-reference-register',
    String(SEASON),
    'requests',
    requestFingerprint,
    'payload.html',
  )
  const absolutePayloadPath = path.join(root, payloadPath)
  await mkdir(path.dirname(absolutePayloadPath), { recursive: true })
  const body = new TextEncoder().encode(bodyText)
  const input = {
    requestFingerprint,
    url,
    payloadPath,
    sha256: sha256(body),
    byteLength: body.byteLength,
    retrievedAt: '2026-07-11T20:00:00.000Z',
    attemptCount: 1,
  }
  const permissionEvidence = {
    path: 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
    sha256: sha256(PERMISSION_BODY),
  }
  await writeFile(absolutePayloadPath, body)
  await writeFile(
    path.join(path.dirname(absolutePayloadPath), 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 'baseball-reference-register-request/v1',
        source: 'baseball-reference-register',
        requestFingerprint,
        request: {
          method: 'GET',
          url,
          userAgent: USER_AGENT,
          acceptEncoding: 'identity',
        },
        response: { status: 200, finalUrl: url, headers: { 'content-type': 'text/html' } },
        retrievedAt: input.retrievedAt,
        attemptCount: input.attemptCount,
        byteLength: input.byteLength,
        sha256: input.sha256,
        mediaType: 'text/html',
        payloadPath,
        parserVersion: 'baseball-reference-register/v1',
        permissionEvidence,
      },
      null,
      2,
    )}\n`,
  )
  return input
}

async function completeRun(root: string, overrides: Record<string, unknown> = {}) {
  const discovery = await cachedRequest(
    root,
    'https://www.baseball-reference.com/register/affiliate.cgi?year=2017',
    '<html>affiliates</html>',
  )
  const team = await cachedRequest(
    root,
    'https://www.baseball-reference.com/register/team.cgi?id=0080f66c',
    '<html>team</html>',
  )
  const manifest = {
    schemaVersion: 'baseball-reference-register-run/v1',
    source: 'baseball-reference-register',
    season: SEASON,
    startedAt: '2026-07-11T20:00:00.000Z',
    finishedAt: '2026-07-11T21:00:00.000Z',
    status: 'complete',
    error: null,
    permissionEvidence: {
      path: 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
      sha256: sha256(PERMISSION_BODY),
    },
    coverage: {
      structuralZeroSeason: false,
      structuralReason: null,
      declaredTeams: 1,
      affiliateSlots: 1,
      discoveredTeams: 1,
      completedTeams: 1,
      failedTeams: 0,
    },
    inputCount: 2,
    liveRequestCount: 2,
    requests: [discovery, team],
    outputs: [],
    ...overrides,
  }
  const runRoot = path.join(root, 'data/manifests/runs')
  await mkdir(runRoot, { recursive: true })
  const runPath = path.join(
    runRoot,
    '20260711T210000000Z-test-baseball-reference-register-2017.json',
  )
  await writeFile(runPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifest, runPath, discovery, team }
}

describe('Sports Reference season archive', () => {
  it('archives every verified payload and a deterministic season manifest, then resumes', async () => {
    const rootDir = await testRoot()
    await completeRun(rootDir)
    const store = new MemoryStore()
    let clock = Date.parse('2026-07-12T00:00:00.000Z')
    const now = () => new Date(clock++)

    const first = await archiveSportsReferenceSeason({
      rootDir,
      season: SEASON,
      store,
      now,
      log: () => undefined,
    })

    expect(first.inputCount).toBe(2)
    expect(first.resumed).toBe(false)
    expect(store.requests).toHaveLength(3)
    expect(store.requests.every((request) =>
      request.pathname.startsWith('raw/v1/sports-reference/baseball-register/sha256/'),
    )).toBe(true)
    const seasonManifest = JSON.parse(
      Buffer.from(store.requests.at(-1)!.body).toString('utf8'),
    ) as { schemaVersion: string; season: number; inputCount: number; members: unknown[] }
    expect(seasonManifest).toMatchObject({
      schemaVersion: 'baseball-reference-register-archive-manifest/v1',
      season: SEASON,
      inputCount: 2,
    })
    expect(seasonManifest.members).toHaveLength(2)
    const checkpoint = JSON.parse(
      await readFile(path.join(rootDir, first.checkpointPath), 'utf8'),
    ) as {
      status: string
      receipts: Array<{ receipt: { byteLength: number } }>
      seasonManifestReceipt: { sha256: string }
    }
    expect(checkpoint.status).toBe('complete')
    expect(checkpoint.receipts).toHaveLength(2)
    expect(checkpoint.seasonManifestReceipt.sha256).toBe(first.manifestSha256)
    const lockBody = await readFile(
      path.join(
        rootDir,
        'data/archive-locks/sports-reference-baseball-register/2017.json',
      ),
      'utf8',
    )
    const lock = JSON.parse(lockBody) as {
      schemaVersion: string
      inputCount: number
      inputBytes: number
      manifest: { sha256: string }
    }
    expect(lock).toMatchObject({
      schemaVersion: 'baseball-reference-register-archive-lock/v1',
      inputCount: 2,
      manifest: { sha256: first.manifestSha256 },
    })
    expect(lock.inputBytes).toBe(
      checkpoint.receipts.reduce(
        (total, archived) => total + archived.receipt.byteLength,
        0,
      ),
    )
    expect(lockBody).not.toContain('objectUri')
    expect(lockBody).not.toContain('etag')

    const resumed = await archiveSportsReferenceSeason({
      rootDir,
      season: SEASON,
      store,
      now,
      log: () => undefined,
    })
    expect(resumed.resumed).toBe(true)
    expect(resumed.manifestSha256).toBe(first.manifestSha256)
    expect(store.requests).toHaveLength(3)
  })

  it('rejects a complete flag when coverage is incomplete before uploading', async () => {
    const rootDir = await testRoot()
    const { manifest } = await completeRun(rootDir, {
      coverage: {
        structuralZeroSeason: false,
        structuralReason: null,
        declaredTeams: 2,
        affiliateSlots: 2,
        discoveredTeams: 2,
        completedTeams: 1,
        failedTeams: 1,
      },
    })
    expect(() => assertFullRunCoverage(manifest as never)).toThrow('full team coverage')
    const store = new MemoryStore()
    await expect(
      archiveSportsReferenceSeason({ rootDir, season: SEASON, store, log: () => undefined }),
    ).rejects.toThrow('full team coverage')
    expect(store.requests).toHaveLength(0)
  })

  it('resumes an interrupted checkpoint without replaying completed inputs', async () => {
    const rootDir = await testRoot()
    await completeRun(rootDir)
    const store = new MemoryStore()
    store.failOnCall = 2

    await expect(
      archiveSportsReferenceSeason({
        rootDir,
        season: SEASON,
        store,
        log: () => undefined,
      }),
    ).rejects.toThrow('injected upload failure')
    expect(store.objects).toHaveLength(1)
    const firstPathname = store.requests[0].pathname

    store.failOnCall = null
    const resumed = await archiveSportsReferenceSeason({
      rootDir,
      season: SEASON,
      store,
      log: () => undefined,
    })

    expect(resumed.resumed).toBe(true)
    expect(store.objects).toHaveLength(3)
    expect(store.requests.filter((request) => request.pathname === firstPathname)).toHaveLength(1)
  })

  it('rejects changed cached bytes and stale permission evidence before uploading', async () => {
    const rootDir = await testRoot()
    const { team } = await completeRun(rootDir)
    await writeFile(path.join(rootDir, team.payloadPath), '<html>tampered</html>')
    const store = new MemoryStore()

    await expect(
      archiveSportsReferenceSeason({ rootDir, season: SEASON, store, log: () => undefined }),
    ).rejects.toThrow('Cached payload is missing or changed')
    expect(store.requests).toHaveLength(0)

    await writeFile(
      path.join(rootDir, 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md'),
      '# Changed evidence\n',
    )
    await expect(
      archiveSportsReferenceSeason({ rootDir, season: SEASON, store, log: () => undefined }),
    ).rejects.toThrow('permission evidence')
    expect(store.requests).toHaveLength(0)
  })

  it('rejects a cached redirect to a different team identity', async () => {
    const rootDir = await testRoot()
    const { team } = await completeRun(rootDir)
    const manifestPath = path.join(
      rootDir,
      path.dirname(team.payloadPath),
      'manifest.json',
    )
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      response: { finalUrl: string }
    }
    manifest.response.finalUrl =
      'https://www.baseball-reference.com/register/team.cgi?id=ffffffff'
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(
      archiveSportsReferenceSeason({
        rootDir,
        season: SEASON,
        store: new MemoryStore(),
        log: () => undefined,
      }),
    ).rejects.toThrow('changed endpoint identity')
  })

  it('requires an explicit bounded season argument', () => {
    expect(parseArchiveSeasonArguments(['--season=2017'])).toEqual({ season: 2017 })
    expect(() => parseArchiveSeasonArguments([])).toThrow('--season=YYYY is required')
    expect(() => parseArchiveSeasonArguments(['--season=2017', '--execute'])).toThrow(
      'Unknown archive arguments',
    )
  })
})
