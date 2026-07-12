import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  archiveRawPayload,
  rawArchivePath,
  type ImmutableObjectStore,
  type RawArchiveReceipt,
} from './immutable-raw-archive.js'
import { VercelPrivateBlobStore } from './vercel-private-blob-store.js'

const RUN_SCHEMA_VERSION = 'baseball-reference-register-run/v1'
const REQUEST_SCHEMA_VERSION = 'baseball-reference-register-request/v1'
const CHECKPOINT_SCHEMA_VERSION = 'baseball-reference-register-archive/v1'
const SEASON_MANIFEST_SCHEMA_VERSION = 'baseball-reference-register-archive-manifest/v1'
const SEASON_LOCK_SCHEMA_VERSION = 'baseball-reference-register-archive-lock/v1'
const SOURCE_SLUG = 'sports-reference'
const DATASET_KEY = 'baseball-register'
const REQUEST_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const TEAM_ID_PATTERN = /^[0-9a-f]{8}$/

interface PermissionEvidence {
  path: string
  sha256: string
}

interface RunRequest {
  requestFingerprint: string
  url: string
  payloadPath: string
  sha256: string
  byteLength: number
  retrievedAt: string
  attemptCount: number
}

interface SeasonRunManifest {
  schemaVersion: typeof RUN_SCHEMA_VERSION
  source: 'baseball-reference-register'
  season: number
  startedAt: string
  finishedAt: string
  status: 'complete'
  permissionEvidence: PermissionEvidence
  coverage: {
    structuralZeroSeason: boolean
    structuralReason: string | null
    declaredTeams: number
    affiliateSlots: number
    discoveredTeams: number
    completedTeams: number
    failedTeams: number
  }
  inputCount: number
  requests: RunRequest[]
  outputs: Array<{ path: string; rows: number; bytes: number; sha256: string }>
}

interface RequestCacheManifest {
  schemaVersion: typeof REQUEST_SCHEMA_VERSION
  source: 'baseball-reference-register'
  requestFingerprint: string
  request: {
    method: 'GET'
    url: string
    userAgent: string
    acceptEncoding: 'identity'
  }
  response: {
    status: number
    finalUrl: string
    headers: Record<string, string>
  }
  retrievedAt: string
  attemptCount: number
  byteLength: number
  sha256: string
  mediaType: string
  payloadPath: string
  parserVersion: string
  permissionEvidence: PermissionEvidence
}

interface VerifiedInput {
  runRequest: RunRequest
  requestManifest: RequestCacheManifest
  payloadPath: string
  body: Uint8Array
}

interface InputArchiveReceipt {
  requestFingerprint: string
  sourceUrl: string
  sourcePayloadPath: string
  receipt: RawArchiveReceipt
}

interface SeasonArchiveCheckpoint {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION
  source: typeof SOURCE_SLUG
  dataset: typeof DATASET_KEY
  season: number
  status: 'running' | 'complete'
  startedAt: string
  updatedAt: string
  sourceRunManifestPath: string
  sourceRunManifestSha256: string
  permissionEvidence: PermissionEvidence
  expectedInputCount: number
  receipts: InputArchiveReceipt[]
  seasonManifestReceipt?: RawArchiveReceipt
}

interface ArchiveSeasonOptions {
  rootDir: string
  season: number
  store?: ImmutableObjectStore
  now?: () => Date
  log?: (message: string) => void
}

export interface ArchiveSeasonResult {
  season: number
  inputCount: number
  checkpointPath: string
  manifestSha256: string
  resumed: boolean
}

function sha256(body: Uint8Array | string): string {
  return createHash('sha256').update(body).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function atomicWrite(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.part`
  await writeFile(temporary, body)
  await rename(temporary, filePath)
}

function repositoryPath(rootDir: string, relativePath: string, label: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be repository-relative`)
  const resolved = path.resolve(rootDir, relativePath)
  const relative = path.relative(rootDir, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the repository root`)
  }
  return resolved
}

function expectedPayloadPath(
  season: number,
  requestFingerprint: string,
): string {
  return path.posix.join(
    'data/raw/baseball-reference-register',
    String(season),
    'requests',
    requestFingerprint,
    'payload.html',
  )
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/')
}

async function currentPermissionEvidence(rootDir: string): Promise<PermissionEvidence> {
  const filePath = path.join(
    rootDir,
    'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
  )
  const body = await readFile(filePath)
  return {
    path: normalizeRelativePath(path.relative(rootDir, filePath)),
    sha256: sha256(body),
  }
}

function assertPermissionEvidence(
  actual: PermissionEvidence | undefined,
  expected: PermissionEvidence,
  label: string,
): void {
  if (
    actual?.path !== expected.path ||
    actual.sha256 !== expected.sha256
  ) {
    throw new Error(`${label} does not match current permission evidence`)
  }
}

function parseFinishedAt(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new Error(`${label} has no finishedAt timestamp`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} has an invalid finishedAt timestamp`)
  return parsed
}

export async function latestCompleteSeasonRun(
  rootDir: string,
  season: number,
): Promise<{ path: string; body: Uint8Array; manifest: SeasonRunManifest }> {
  const runRoot = path.join(rootDir, 'data/manifests/runs')
  const suffix = `-baseball-reference-register-${season}.json`
  let names: string[]
  try {
    names = (await readdir(runRoot)).filter((name) => name.endsWith(suffix))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`No complete Baseball-Reference run exists for ${season}`)
    }
    throw error
  }

  const candidates: Array<{
    path: string
    body: Uint8Array
    manifest: SeasonRunManifest
    finishedAt: number
  }> = []
  for (const name of names) {
    const manifestPath = path.join(runRoot, name)
    const body = new Uint8Array(await readFile(manifestPath))
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(body).toString('utf8'))
    } catch {
      throw new Error(`Invalid Baseball-Reference run manifest JSON: ${name}`)
    }
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== RUN_SCHEMA_VERSION ||
      parsed.source !== 'baseball-reference-register' ||
      parsed.season !== season ||
      parsed.status !== 'complete'
    ) {
      continue
    }
    candidates.push({
      path: manifestPath,
      body,
      manifest: parsed as unknown as SeasonRunManifest,
      finishedAt: parseFinishedAt(parsed.finishedAt, name),
    })
  }
  candidates.sort((left, right) =>
    right.finishedAt - left.finishedAt || right.path.localeCompare(left.path),
  )
  const latest = candidates[0]
  if (!latest) throw new Error(`No complete Baseball-Reference run exists for ${season}`)
  return latest
}

function finiteWhole(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

export function assertFullRunCoverage(manifest: SeasonRunManifest): void {
  const coverage = manifest.coverage
  if (!isRecord(coverage)) throw new Error('Complete run has no coverage record')
  if (typeof coverage.structuralZeroSeason !== 'boolean') {
    throw new Error('Complete run structural coverage flag is invalid')
  }
  for (const [key, value] of Object.entries({
    declaredTeams: coverage.declaredTeams,
    affiliateSlots: coverage.affiliateSlots,
    discoveredTeams: coverage.discoveredTeams,
    completedTeams: coverage.completedTeams,
    failedTeams: coverage.failedTeams,
  })) {
    if (!finiteWhole(value)) throw new Error(`Complete run coverage ${key} is invalid`)
  }
  if (!Array.isArray(manifest.requests) || !finiteWhole(manifest.inputCount)) {
    throw new Error('Complete run has invalid request coverage')
  }
  if (manifest.inputCount !== manifest.requests.length) {
    throw new Error('Complete run inputCount does not match its request list')
  }

  if (coverage.structuralZeroSeason) {
    if (
      coverage.declaredTeams !== 0 ||
      coverage.discoveredTeams !== 0 ||
      coverage.completedTeams !== 0 ||
      coverage.failedTeams !== 0 ||
      manifest.requests.length !== 0
    ) {
      throw new Error('Structural zero-team season contains unexpected team inputs')
    }
    return
  }

  if (
    coverage.declaredTeams < 1 ||
    coverage.discoveredTeams !== coverage.declaredTeams ||
    coverage.completedTeams !== coverage.declaredTeams ||
    coverage.failedTeams !== 0 ||
    coverage.affiliateSlots < coverage.declaredTeams
  ) {
    throw new Error('Complete run does not have full team coverage')
  }
  if (manifest.requests.length !== coverage.declaredTeams + 1) {
    throw new Error('Complete run must contain one discovery input plus every team input')
  }
}

function validateSourceUrl(urlValue: string, season: number): 'discovery' | 'team' {
  const url = new URL(urlValue)
  if (url.protocol !== 'https:' || url.hostname !== 'www.baseball-reference.com') {
    throw new Error(`Run request is outside Baseball-Reference: ${urlValue}`)
  }
  if (url.pathname === '/register/affiliate.cgi' && url.searchParams.get('year') === String(season)) {
    return 'discovery'
  }
  if (
    url.pathname === '/register/team.cgi' &&
    TEAM_ID_PATTERN.test(url.searchParams.get('id') ?? '')
  ) {
    return 'team'
  }
  throw new Error(`Run request is outside the expected Register season endpoints: ${urlValue}`)
}

function computedRequestFingerprint(manifest: RequestCacheManifest): string {
  return sha256(
    JSON.stringify({
      method: manifest.request.method,
      url: manifest.request.url,
      userAgent: manifest.request.userAgent,
      acceptEncoding: manifest.request.acceptEncoding,
    }),
  )
}

async function verifySeasonInputs(
  rootDir: string,
  season: number,
  run: SeasonRunManifest,
  permissionEvidence: PermissionEvidence,
): Promise<VerifiedInput[]> {
  assertFullRunCoverage(run)
  assertPermissionEvidence(run.permissionEvidence, permissionEvidence, 'Run manifest')
  const fingerprints = new Set<string>()
  const payloadPaths = new Set<string>()
  const sourceUrls = new Set<string>()
  let discoveryCount = 0
  let teamCount = 0
  const verified: VerifiedInput[] = []

  for (const input of run.requests) {
    if (!isRecord(input)) throw new Error('Run manifest contains an invalid request')
    if (
      typeof input.requestFingerprint !== 'string' ||
      !REQUEST_FINGERPRINT_PATTERN.test(input.requestFingerprint)
    ) {
      throw new Error(`Invalid request fingerprint: ${input.requestFingerprint}`)
    }
    if (
      typeof input.url !== 'string' ||
      typeof input.payloadPath !== 'string' ||
      typeof input.sha256 !== 'string' ||
      !REQUEST_FINGERPRINT_PATTERN.test(input.sha256) ||
      !Number.isSafeInteger(input.byteLength) ||
      input.byteLength < 1 ||
      !Number.isSafeInteger(input.attemptCount) ||
      input.attemptCount < 1 ||
      typeof input.retrievedAt !== 'string' ||
      !Number.isFinite(Date.parse(input.retrievedAt))
    ) {
      throw new Error(`Run manifest contains invalid request metadata for ${input.requestFingerprint}`)
    }
    if (fingerprints.has(input.requestFingerprint)) {
      throw new Error(`Duplicate request fingerprint: ${input.requestFingerprint}`)
    }
    fingerprints.add(input.requestFingerprint)
    if (sourceUrls.has(input.url)) throw new Error(`Duplicate source URL: ${input.url}`)
    sourceUrls.add(input.url)
    const expected = expectedPayloadPath(season, input.requestFingerprint)
    if (normalizeRelativePath(input.payloadPath) !== expected) {
      throw new Error(`Unexpected cached payload path: ${input.payloadPath}`)
    }
    if (payloadPaths.has(expected)) throw new Error(`Duplicate cached payload path: ${expected}`)
    payloadPaths.add(expected)
    const kind = validateSourceUrl(input.url, season)
    if (kind === 'discovery') discoveryCount += 1
    else teamCount += 1

    const payloadPath = repositoryPath(rootDir, expected, 'Cached payload path')
    const canonicalExpected = path.join(await realpath(rootDir), ...expected.split('/'))
    if ((await realpath(payloadPath)) !== canonicalExpected) {
      throw new Error(`Cached payload path contains a symbolic link: ${expected}`)
    }
    const requestManifestPath = path.join(path.dirname(payloadPath), 'manifest.json')
    const requestManifest = JSON.parse(
      await readFile(requestManifestPath, 'utf8'),
    ) as RequestCacheManifest
    if (
      !isRecord(requestManifest) ||
      !isRecord(requestManifest.request) ||
      !isRecord(requestManifest.response) ||
      requestManifest.schemaVersion !== REQUEST_SCHEMA_VERSION ||
      requestManifest.source !== 'baseball-reference-register' ||
      requestManifest.requestFingerprint !== input.requestFingerprint ||
      requestManifest.request.method !== 'GET' ||
      requestManifest.request.acceptEncoding !== 'identity' ||
      requestManifest.request.url !== input.url ||
      requestManifest.response.status !== 200 ||
      typeof requestManifest.response.finalUrl !== 'string' ||
      typeof requestManifest.payloadPath !== 'string' ||
      normalizeRelativePath(requestManifest.payloadPath) !== expected ||
      requestManifest.sha256 !== input.sha256 ||
      requestManifest.byteLength !== input.byteLength ||
      requestManifest.retrievedAt !== input.retrievedAt ||
      requestManifest.attemptCount !== input.attemptCount ||
      computedRequestFingerprint(requestManifest) !== input.requestFingerprint ||
      typeof requestManifest.mediaType !== 'string' ||
      !requestManifest.mediaType.includes('html') ||
      (requestManifest.response.headers['content-encoding'] !== undefined &&
        requestManifest.response.headers['content-encoding'].toLowerCase() !==
          'identity')
    ) {
      throw new Error(`Cached request manifest differs from run input ${input.requestFingerprint}`)
    }
    assertPermissionEvidence(
      requestManifest.permissionEvidence,
      permissionEvidence,
      `Cached request ${input.requestFingerprint}`,
    )
    if (
      validateSourceUrl(requestManifest.response.finalUrl, season) !== kind ||
      new URL(requestManifest.response.finalUrl).toString() !==
        new URL(input.url).toString()
    ) {
      throw new Error(`Cached request redirect changed endpoint identity for ${input.requestFingerprint}`)
    }
    const body = new Uint8Array(await readFile(payloadPath))
    if (body.byteLength !== input.byteLength || sha256(body) !== input.sha256) {
      throw new Error(`Cached payload is missing or changed: ${expected}`)
    }
    verified.push({ runRequest: input, requestManifest, payloadPath, body })
  }

  if (!run.coverage.structuralZeroSeason) {
    if (discoveryCount !== 1 || teamCount !== run.coverage.declaredTeams) {
      throw new Error('Complete run endpoint coverage does not match its team coverage')
    }
  }
  return verified.sort((left, right) =>
    left.runRequest.requestFingerprint.localeCompare(right.runRequest.requestFingerprint),
  )
}

function checkpointPath(
  rootDir: string,
  season: number,
  runManifestSha256: string,
): string {
  return path.join(
    rootDir,
    'data/manifests/archive',
    'sports-reference-baseball-register',
    String(season),
    `${runManifestSha256}.json`,
  )
}

function seasonLockPath(rootDir: string, season: number): string {
  return path.join(
    rootDir,
    'data/archive-locks/sports-reference-baseball-register',
    `${season}.json`,
  )
}

async function writeSeasonLock(
  rootDir: string,
  checkpoint: SeasonArchiveCheckpoint,
  run: SeasonRunManifest,
): Promise<void> {
  const manifest = checkpoint.seasonManifestReceipt
  if (checkpoint.status !== 'complete' || !manifest) {
    throw new Error('Only a complete season archive can produce a committed lock')
  }
  const inputBytes = checkpoint.receipts.reduce(
    (total, archived) => total + archived.receipt.byteLength,
    0,
  )
  if (!Number.isSafeInteger(inputBytes)) {
    throw new Error('Season archive byte total exceeds JavaScript safe integer precision')
  }
  const lock = {
    schemaVersion: SEASON_LOCK_SCHEMA_VERSION,
    season: checkpoint.season,
    sourceRunManifest: {
      path: checkpoint.sourceRunManifestPath,
      sha256: checkpoint.sourceRunManifestSha256,
    },
    permissionEvidence: checkpoint.permissionEvidence,
    coverage: run.coverage,
    inputCount: checkpoint.receipts.length,
    inputBytes,
    manifest: {
      sha256: manifest.sha256,
      byteLength: manifest.byteLength,
      mediaType: manifest.mediaType,
      pathname: manifest.pathname,
      storageStatus: manifest.storageStatus,
      archivedAt: manifest.archivedAt,
    },
  }
  await atomicWrite(
    seasonLockPath(rootDir, checkpoint.season),
    `${JSON.stringify(lock, null, 2)}\n`,
  )
}

async function loadCheckpoint(
  filePath: string,
  season: number,
  runManifestPath: string,
  runManifestSha256: string,
  permissionEvidence: PermissionEvidence,
  expectedInputCount: number,
): Promise<SeasonArchiveCheckpoint | null> {
  if (!(await exists(filePath))) return null
  const checkpoint = JSON.parse(await readFile(filePath, 'utf8')) as SeasonArchiveCheckpoint
  if (
    checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
    checkpoint.source !== SOURCE_SLUG ||
    checkpoint.dataset !== DATASET_KEY ||
    checkpoint.season !== season ||
    checkpoint.sourceRunManifestPath !== runManifestPath ||
    checkpoint.sourceRunManifestSha256 !== runManifestSha256 ||
    checkpoint.expectedInputCount !== expectedInputCount ||
    !Array.isArray(checkpoint.receipts) ||
    !['running', 'complete'].includes(checkpoint.status) ||
    !Number.isFinite(Date.parse(checkpoint.startedAt)) ||
    !Number.isFinite(Date.parse(checkpoint.updatedAt))
  ) {
    throw new Error(`Archive checkpoint conflicts with the selected season run: ${filePath}`)
  }
  assertPermissionEvidence(checkpoint.permissionEvidence, permissionEvidence, 'Archive checkpoint')
  return checkpoint
}

function assertCheckpointReceipts(
  checkpoint: SeasonArchiveCheckpoint,
  inputs: VerifiedInput[],
): Map<string, InputArchiveReceipt> {
  const inputByFingerprint = new Map(
    inputs.map((input) => [input.runRequest.requestFingerprint, input]),
  )
  const receipts = new Map<string, InputArchiveReceipt>()
  for (const archived of checkpoint.receipts) {
    const input = inputByFingerprint.get(archived.requestFingerprint)
    if (!input || receipts.has(archived.requestFingerprint)) {
      throw new Error(`Archive checkpoint contains an unknown or duplicate input receipt`)
    }
    const expectedPathname = rawArchivePath(
      SOURCE_SLUG,
      DATASET_KEY,
      input.runRequest.sha256,
    )
    if (
      archived.sourceUrl !== input.runRequest.url ||
      archived.sourcePayloadPath !== normalizeRelativePath(input.runRequest.payloadPath) ||
      archived.receipt.schemaVersion !== 'raw-archive-receipt/v1' ||
      archived.receipt.sourceSlug !== SOURCE_SLUG ||
      archived.receipt.datasetKey !== DATASET_KEY ||
      archived.receipt.sha256 !== input.runRequest.sha256 ||
      archived.receipt.byteLength !== input.runRequest.byteLength ||
      archived.receipt.mediaType !== input.requestManifest.mediaType ||
      archived.receipt.pathname !== expectedPathname ||
      !archived.receipt.objectUri.startsWith('https://') ||
      !['created', 'already-exists'].includes(archived.receipt.storageStatus) ||
      !Number.isFinite(Date.parse(archived.receipt.archivedAt))
    ) {
      throw new Error(`Archive checkpoint receipt conflicts with ${archived.requestFingerprint}`)
    }
    receipts.set(archived.requestFingerprint, archived)
  }
  return receipts
}

function stableSeasonManifest(
  runManifestPath: string,
  runManifestSha256: string,
  run: SeasonRunManifest,
  permissionEvidence: PermissionEvidence,
  receipts: InputArchiveReceipt[],
): Uint8Array {
  const members = [...receipts]
    .sort((left, right) => left.requestFingerprint.localeCompare(right.requestFingerprint))
    .map((archived) => ({
      requestFingerprint: archived.requestFingerprint,
      sourceUrl: archived.sourceUrl,
      sourcePayloadPath: archived.sourcePayloadPath,
      sha256: archived.receipt.sha256,
      byteLength: archived.receipt.byteLength,
      mediaType: archived.receipt.mediaType,
      pathname: archived.receipt.pathname,
    }))
  return new TextEncoder().encode(
    `${JSON.stringify(
      {
        schemaVersion: SEASON_MANIFEST_SCHEMA_VERSION,
        source: SOURCE_SLUG,
        dataset: DATASET_KEY,
        season: run.season,
        sourceRunManifest: {
          path: runManifestPath,
          sha256: runManifestSha256,
          manifest: run,
        },
        permissionEvidence,
        coverage: run.coverage,
        inputCount: members.length,
        members,
      },
      null,
      2,
    )}\n`,
  )
}

export async function archiveSportsReferenceSeason(
  options: ArchiveSeasonOptions,
): Promise<ArchiveSeasonResult> {
  const now = options.now ?? (() => new Date())
  const log = options.log ?? ((message) => process.stdout.write(`${message}\n`))
  const permissionEvidence = await currentPermissionEvidence(options.rootDir)
  const selected = await latestCompleteSeasonRun(options.rootDir, options.season)
  const runManifestPath = normalizeRelativePath(path.relative(options.rootDir, selected.path))
  const runManifestSha256 = sha256(selected.body)
  const inputs = await verifySeasonInputs(
    options.rootDir,
    options.season,
    selected.manifest,
    permissionEvidence,
  )
  const localCheckpointPath = checkpointPath(
    options.rootDir,
    options.season,
    runManifestSha256,
  )
  const existing = await loadCheckpoint(
    localCheckpointPath,
    options.season,
    runManifestPath,
    runManifestSha256,
    permissionEvidence,
    inputs.length,
  )
  const startedAt = now().toISOString()
  const checkpoint: SeasonArchiveCheckpoint = existing ?? {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    source: SOURCE_SLUG,
    dataset: DATASET_KEY,
    season: options.season,
    status: 'running',
    startedAt,
    updatedAt: startedAt,
    sourceRunManifestPath: runManifestPath,
    sourceRunManifestSha256: runManifestSha256,
    permissionEvidence,
    expectedInputCount: inputs.length,
    receipts: [],
  }
  const archived = assertCheckpointReceipts(checkpoint, inputs)
  const manifestBody = stableSeasonManifest(
    runManifestPath,
    runManifestSha256,
    selected.manifest,
    permissionEvidence,
    checkpoint.receipts,
  )
  if (checkpoint.status === 'complete') {
    if (
      archived.size !== inputs.length ||
      !checkpoint.seasonManifestReceipt ||
      checkpoint.seasonManifestReceipt.schemaVersion !== 'raw-archive-receipt/v1' ||
      checkpoint.seasonManifestReceipt.sourceSlug !== SOURCE_SLUG ||
      checkpoint.seasonManifestReceipt.datasetKey !== DATASET_KEY ||
      checkpoint.seasonManifestReceipt.sha256 !== sha256(manifestBody) ||
      checkpoint.seasonManifestReceipt.byteLength !== manifestBody.byteLength ||
      checkpoint.seasonManifestReceipt.pathname !==
        rawArchivePath(SOURCE_SLUG, DATASET_KEY, sha256(manifestBody)) ||
      checkpoint.seasonManifestReceipt.mediaType !== 'application/json' ||
      !checkpoint.seasonManifestReceipt.objectUri.startsWith('https://') ||
      !Number.isFinite(Date.parse(checkpoint.seasonManifestReceipt.archivedAt))
    ) {
      throw new Error('Completed archive checkpoint is incomplete or inconsistent')
    }
    await writeSeasonLock(options.rootDir, checkpoint, selected.manifest)
    log(`Season ${options.season} archive already complete: ${inputs.length} inputs.`)
    return {
      season: options.season,
      inputCount: inputs.length,
      checkpointPath: normalizeRelativePath(path.relative(options.rootDir, localCheckpointPath)),
      manifestSha256: checkpoint.seasonManifestReceipt.sha256,
      resumed: true,
    }
  }

  const store = options.store ?? new VercelPrivateBlobStore()
  checkpoint.status = 'running'
  for (const [index, input] of inputs.entries()) {
    if (archived.has(input.runRequest.requestFingerprint)) {
      log(`[${index + 1}/${inputs.length}] ${input.runRequest.requestFingerprint} checkpointed`)
      continue
    }
    const receipt = await archiveRawPayload(
      store,
      {
        sourceSlug: SOURCE_SLUG,
        datasetKey: DATASET_KEY,
        body: input.body,
        expectedSha256: input.runRequest.sha256,
        expectedByteLength: input.runRequest.byteLength,
        mediaType: input.requestManifest.mediaType,
      },
      now,
    )
    const archivedInput: InputArchiveReceipt = {
      requestFingerprint: input.runRequest.requestFingerprint,
      sourceUrl: input.runRequest.url,
      sourcePayloadPath: normalizeRelativePath(input.runRequest.payloadPath),
      receipt,
    }
    checkpoint.receipts.push(archivedInput)
    archived.set(input.runRequest.requestFingerprint, archivedInput)
    checkpoint.updatedAt = now().toISOString()
    await atomicWrite(localCheckpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
    log(`[${index + 1}/${inputs.length}] ${input.runRequest.requestFingerprint} ${receipt.storageStatus}`)
  }

  if (checkpoint.receipts.length !== inputs.length) {
    throw new Error('Archive checkpoint did not cover every verified season input')
  }
  const completedManifestBody = stableSeasonManifest(
    runManifestPath,
    runManifestSha256,
    selected.manifest,
    permissionEvidence,
    checkpoint.receipts,
  )
  checkpoint.seasonManifestReceipt = await archiveRawPayload(
    store,
    {
      sourceSlug: SOURCE_SLUG,
      datasetKey: DATASET_KEY,
      body: completedManifestBody,
      expectedSha256: sha256(completedManifestBody),
      expectedByteLength: completedManifestBody.byteLength,
      mediaType: 'application/json',
    },
    now,
  )
  checkpoint.status = 'complete'
  checkpoint.updatedAt = now().toISOString()
  await atomicWrite(localCheckpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
  await writeSeasonLock(options.rootDir, checkpoint, selected.manifest)
  log(
    `Archived ${inputs.length} Baseball-Reference inputs for ${options.season}; ` +
      `manifest ${checkpoint.seasonManifestReceipt.sha256}.`,
  )
  return {
    season: options.season,
    inputCount: inputs.length,
    checkpointPath: normalizeRelativePath(path.relative(options.rootDir, localCheckpointPath)),
    manifestSha256: checkpoint.seasonManifestReceipt.sha256,
    resumed: existing !== null,
  }
}

export function parseArchiveSeasonArguments(argv = process.argv.slice(2)): { season: number } {
  const raw = argv.find((value) => value.startsWith('--season='))?.slice('--season='.length)
  if (raw === undefined) throw new Error('--season=YYYY is required')
  const season = Number(raw)
  if (!Number.isInteger(season) || season < 1901 || season > new Date().getUTCFullYear()) {
    throw new Error('--season must be a four-digit season from 1901 through the current year')
  }
  const unknown = argv.filter((value) => !value.startsWith('--season='))
  if (unknown.length > 0) throw new Error(`Unknown archive arguments: ${unknown.join(', ')}`)
  return { season }
}

async function main(): Promise<void> {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const rootDir = path.resolve(scriptDirectory, '../..')
  const { season } = parseArchiveSeasonArguments()
  await archiveSportsReferenceSeason({ rootDir, season })
}

const directInvocation =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (directInvocation) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
