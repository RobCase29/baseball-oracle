import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface LockedResource {
  bytes: number
  sha256: string
  url: string
}

interface SourceLockEntry {
  version: string
  license: string
  licenseUrl: string
  evidenceSha256?: string
  resources: Record<string, LockedResource>
}

interface SourceLock {
  schemaVersion: number
  updatedAt: string
  sources: Record<string, SourceLockEntry>
}

interface ResourceSpec {
  source: keyof SourceLock['sources']
  key: string
  relativePath: string
  url: string
  expectedEdition?: number
}

interface AcquiredResource extends LockedResource {
  key: string
  path: string
  source: string
  status: 'downloaded' | 'verified'
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '../..')
const lockPath = path.join(projectRoot, 'data/source-lock.json')
const rawRoot = path.join(projectRoot, 'data/raw')
const runManifestRoot = path.join(projectRoot, 'data/manifests/runs')

const chadwickVersion = '7e23e7dfaff51b3ae72c16393703eda7e5ecad27'
const lahmanShare = 'y1prhc795jk8zvmelfd3jq7tl389y6cd'
const allMinorLeagues = '2,4,5,6,7,8,9,10,11,14,12,13,15,16,17,18,30,32,33'

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function argument(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

function chadwickResources(): ResourceSpec[] {
  const files = [
    ...Array.from({ length: 16 }, (_, index) => `data/people-${index.toString(16)}.csv`),
    'README.md',
  ]

  return files.map((file) => ({
    source: 'chadwick-register',
    key: file,
    relativePath: path.join('chadwick-register', chadwickVersion, file),
    url: `https://raw.githubusercontent.com/chadwickbureau/register/${chadwickVersion}/${file}`,
  }))
}

function lahmanResources(): ResourceSpec[] {
  const files: Array<[string, string]> = [
    ['People.csv', '2084263017537'],
    ['Batting.csv', '2084272468053'],
    ['Pitching.csv', '2084261668691'],
    ['HallOfFame.csv', '2084268925644'],
    ['Fielding.csv', '2084272585201'],
    ['readme2025.txt', '2084259918153'],
  ]

  return files.map(([file, id]) => ({
    source: 'sabr-lahman',
    key: file,
    relativePath: path.join('sabr-lahman', '2025', file),
    url:
      'https://sabr.app.box.com/index.php?rm=box_download_shared_file' +
      `&shared_name=${lahmanShare}&file_id=f_${id}`,
  }))
}

function retrosheetResources(): ResourceSpec[] {
  const version = 'bf5af7d40e1f0c33026074705cda8ed1c5177f95'
  return [
    {
      source: 'retrosheet',
      key: 'biofile0.csv',
      relativePath: path.join('retrosheet', version, 'reference/biofile0.csv'),
      url: `https://raw.githubusercontent.com/chadwickbureau/retrosheet/${version}/reference/biofile0.csv`,
    },
  ]
}

function fangraphsResources(): ResourceSpec[] {
  const resources: ResourceSpec[] = []

  for (let edition = 2017; edition <= 2026; edition += 1) {
    for (const role of ['bat', 'pit'] as const) {
      const priorSeason = edition - 1
      const url = new URL('https://www.fangraphs.com/api/prospects/board/prospects-list-combined')
      url.searchParams.set('pos', 'all')
      url.searchParams.set('lg', allMinorLeagues)
      url.searchParams.set('stats', role)
      url.searchParams.set('qual', '0')
      url.searchParams.set('type', '0')
      url.searchParams.set('team', '')
      url.searchParams.set('season', String(priorSeason))
      url.searchParams.set('seasonend', String(priorSeason))
      url.searchParams.set('draft', `${edition}prospect`)
      url.searchParams.set('valueheader', 'prospect-new')
      url.searchParams.set('quickleaderboard', `${edition}all`)

      const file = `${edition}-${role}.json`
      resources.push({
        source: 'fangraphs-prospect-board',
        key: file,
        relativePath: path.join('fangraphs-prospect-board', '2017-2026-editions', file),
        url: url.toString(),
        expectedEdition: edition,
      })
    }
  }

  return resources
}

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

async function fileDigest(filePath: string): Promise<{ bytes: number; sha256: string }> {
  const body = await readFile(filePath)
  return { bytes: body.byteLength, sha256: sha256(body) }
}

function validateFangraphsEdition(body: Uint8Array, expectedEdition: number): void {
  const envelope = JSON.parse(Buffer.from(body).toString('utf8')) as {
    dataScout?: Array<{ Season?: unknown; Type?: unknown }>
    dataStats?: unknown[]
  }
  if (!Array.isArray(envelope.dataScout) || envelope.dataScout.length === 0) {
    throw new Error(`FanGraphs edition ${expectedEdition} has no scouting rows`)
  }
  if (!Array.isArray(envelope.dataStats)) {
    throw new Error(`FanGraphs edition ${expectedEdition} has no stats array`)
  }

  const editions = new Set(
    envelope.dataScout.map((record) => Number(record.Season)).filter(Number.isFinite),
  )
  const reportTypes = new Set(envelope.dataScout.map((record) => String(record.Type)))
  if (editions.size !== 1 || !editions.has(expectedEdition)) {
    throw new Error(
      `FanGraphs requested edition ${expectedEdition} but returned ${[...editions].join(', ') || 'unknown'}`,
    )
  }
  if (![...reportTypes].every((value) => value === `${expectedEdition} Report`)) {
    throw new Error(
      `FanGraphs edition ${expectedEdition} returned unexpected report types: ${[...reportTypes].join(', ')}`,
    )
  }
}

async function fetchResource(
  spec: ResourceSpec,
  force: boolean,
  updatingLock: boolean,
): Promise<AcquiredResource> {
  const destination = path.join(rawRoot, spec.relativePath)
  const source = sourceLock.sources[spec.source]
  if (!source) {
    throw new Error(`Source is absent from data/source-lock.json: ${spec.source}`)
  }
  const lock = source.resources[spec.key]
  if (!lock && !updatingLock) {
    throw new Error(
      `Resource is not pinned: ${spec.source}/${spec.key}; explicitly run with --update-lock to create a lock`,
    )
  }
  if (lock && lock.url !== spec.url && !updatingLock) {
    throw new Error(
      `Resource URL differs from lock for ${spec.source}/${spec.key}; expected ${lock.url}`,
    )
  }

  const canReuseLocal = !force && lock !== undefined && lock.url === spec.url
  if (canReuseLocal) {
    try {
      await stat(destination)
      const digest = await fileDigest(destination)
      if (lock && (digest.bytes !== lock.bytes || digest.sha256 !== lock.sha256)) {
        throw new Error(`Local file differs from lock: ${spec.relativePath}`)
      }
      if (spec.expectedEdition !== undefined) {
        validateFangraphsEdition(await readFile(destination), spec.expectedEdition)
      }
      return {
        ...digest,
        key: spec.key,
        path: path.relative(projectRoot, destination),
        source: spec.source,
        status: 'verified',
        url: spec.url,
      }
    } catch (error) {
      if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }
  }

  const response = await fetch(spec.url, {
    headers: {
      accept: '*/*',
      'user-agent': 'Baseball-Oracle-Research/0.1 (reproducible public-data acquisition)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    throw new Error(`${spec.source}/${spec.key} returned HTTP ${response.status}`)
  }

  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength === 0) {
    throw new Error(`${spec.source}/${spec.key} returned an empty body`)
  }
  if (spec.expectedEdition !== undefined) {
    validateFangraphsEdition(body, spec.expectedEdition)
  }

  const digest = { bytes: body.byteLength, sha256: sha256(body) }
  if (lock && !updatingLock && (digest.bytes !== lock.bytes || digest.sha256 !== lock.sha256)) {
    throw new Error(
      `${spec.source}/${spec.key} changed upstream: expected ${lock.sha256}, received ${digest.sha256}`,
    )
  }

  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.part`
  await writeFile(temporary, body)
  await rename(temporary, destination)

  return {
    ...digest,
    key: spec.key,
    path: path.relative(projectRoot, destination),
    source: spec.source,
    status: 'downloaded',
    url: spec.url,
  }
}

async function updateLock(resources: AcquiredResource[]): Promise<void> {
  let changed = false
  for (const resource of resources) {
    const source = sourceLock.sources[resource.source]
    const next = {
      bytes: resource.bytes,
      sha256: resource.sha256,
      url: resource.url,
    }
    const current = source.resources[resource.key]
    if (
      current?.bytes !== next.bytes ||
      current?.sha256 !== next.sha256 ||
      current?.url !== next.url
    ) {
      source.resources[resource.key] = next
      changed = true
    }
  }
  if (changed) {
    sourceLock.updatedAt = new Date().toISOString()
    await writeFile(lockPath, `${JSON.stringify(sourceLock, null, 2)}\n`)
  }
}

async function verifySourceEvidence(resources: ResourceSpec[]): Promise<void> {
  const sources = new Set(resources.map((resource) => resource.source))
  for (const source of sources) {
    const entry = sourceLock.sources[source]
    if (!entry.evidenceSha256) continue
    const evidencePath = path.resolve(projectRoot, entry.licenseUrl)
    const relative = path.relative(projectRoot, evidencePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Permission evidence must be a project file: ${entry.licenseUrl}`)
    }
    const evidence = await fileDigest(evidencePath)
    if (evidence.sha256 !== entry.evidenceSha256) {
      throw new Error(`Permission evidence hash differs from the source lock: ${entry.licenseUrl}`)
    }
  }
}

async function writeRunManifest(resources: AcquiredResource[]): Promise<string> {
  const acquiredAt = new Date().toISOString()
  const runId = acquiredAt.replaceAll(':', '').replaceAll('.', '')
  const manifestPath = path.join(runManifestRoot, `${runId}.json`)
  const lockBody = await readFile(lockPath)
  const sourceEvidence = Object.fromEntries(
    [...new Set(resources.map((resource) => resource.source))].map((source) => {
      const entry = sourceLock.sources[source]
      return [
        source,
        {
          version: entry.version,
          license: entry.license,
          licenseUrl: entry.licenseUrl,
          evidenceSha256: entry.evidenceSha256 ?? null,
        },
      ]
    }),
  )
  await mkdir(runManifestRoot, { recursive: true })
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        acquiredAt,
        sourceLock: {
          path: path.relative(projectRoot, lockPath),
          sha256: sha256(lockBody),
          schemaVersion: sourceLock.schemaVersion,
          updatedAt: sourceLock.updatedAt,
        },
        sourceEvidence,
        resources,
      },
      null,
      2,
    )}\n`,
  )
  return path.relative(projectRoot, manifestPath)
}

const sourceLock = JSON.parse(await readFile(lockPath, 'utf8')) as SourceLock

async function main(): Promise<void> {
  const selectedSource = argument('source')
  const force = hasFlag('force')
  const update = hasFlag('update-lock')
  const allResources = [
    ...chadwickResources(),
    ...lahmanResources(),
    ...retrosheetResources(),
    ...fangraphsResources(),
  ]
  const resources = selectedSource
    ? allResources.filter((resource) => resource.source === selectedSource)
    : allResources
  if (resources.length === 0) {
    throw new Error(`Unknown or empty source selection: ${selectedSource}`)
  }
  await verifySourceEvidence(resources)

  const acquired: AcquiredResource[] = []
  for (const [index, resource] of resources.entries()) {
    process.stdout.write(
      `[${index + 1}/${resources.length}] ${resource.source}/${resource.key} ... `,
    )
    try {
      const result = await fetchResource(resource, force, update)
      acquired.push(result)
      process.stdout.write(`${result.status} (${result.bytes.toLocaleString()} bytes)\n`)
    } catch (error) {
      await rm(path.join(rawRoot, `${resource.relativePath}.${process.pid}.part`), { force: true })
      throw error
    }
  }

  if (update) {
    await updateLock(acquired)
  }
  const manifest = await writeRunManifest(acquired)
  const totalBytes = acquired.reduce((sum, resource) => sum + resource.bytes, 0)
  process.stdout.write(
    `Acquired ${acquired.length} resources (${totalBytes.toLocaleString()} bytes); manifest ${manifest}\n`,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown acquisition error'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
