import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import hobbySnapshotJson from '../../api/_data/gemrate-hobby-sales.json' with {
  type: 'json',
}
import hobbySubjectContextJson from '../../api/_data/hobby-subject-context.json' with {
  type: 'json',
}
import hobbyIdentityControlsJson from '../../api/_data/hobby-player-identity-controls.json' with {
  type: 'json',
}
import itFactorBoardJson from '../../src/data/it-factor-board.v1.json' with {
  type: 'json',
}
import {
  parsePlayerMobilityArtifact,
} from '../../api/_player-mobility-context.js'
import type {
  PlayerMobilityArtifact,
} from '../../src/domain/playerMobilityContext.js'
import {
  parseSpotracTeamContractList,
} from './spotrac/spotrac-contract-list-parser.js'
import {
  buildSpotracMobilityArtifact,
  type HobbyMobilityIdentityEvidence,
  spotracAcquisitionPlan,
} from './spotrac/spotrac-mobility-builder.js'
import {
  SPOTRAC_MIN_REQUEST_INTERVAL_MS,
  SPOTRAC_USER_AGENT,
  createSpotracPageClient,
} from './spotrac/spotrac-page-client.js'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
const OUTPUT_PATH = path.join(
  ROOT,
  'src/data/player-mobility-context.v1.json',
)
const RAW_ROOT = path.join(ROOT, 'data/raw/spotrac-team-runway')
const CACHE_PATH = path.join(RAW_ROOT, 'pages')
const MANIFEST_PATH = path.join(RAW_ROOT, 'manifests')
const LOCK_PATH = path.join(RAW_ROOT, '.acquisition.lock')
const PERMISSION_PATH = 'docs/permissions/SPOTRAC_ATTESTATION.md'
const PERMISSION_ABSOLUTE_PATH = path.join(ROOT, PERMISSION_PATH)
const EXPECTED_ATTESTATION = 'We’re authorized to scrape spotrac thanks'
const MANIFEST_SCHEMA_VERSION =
  'spotrac-team-runway-source-run/v1' as const
const PUBLICATION_SCHEMA_VERSION =
  'spotrac-team-runway-publication/v1' as const

interface CliOptions {
  check: boolean
  execute: boolean
  maxPages: number
}

interface AcquisitionReceipt {
  url: string
  retrievedAt: string
  contentSha256: string
  cacheStatus: 'hit' | 'downloaded' | 'revalidated'
  parsedRowCount: number
  withheldRowCount: number
  totalRowCount: number
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function atomicWrite(
  destination: string,
  body: string,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, destination)
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function cliOptions(argv: readonly string[]): CliOptions {
  let check = false
  let execute = false
  let maxPages = spotracAcquisitionPlan().length
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--execute') {
      execute = true
      continue
    }
    if (argument === '--max-pages') {
      const value = argv[index + 1]
      if (!value) throw new Error('--max-pages requires a value.')
      maxPages = parsePositiveInteger(value, '--max-pages')
      index += 1
      continue
    }
    if (argument.startsWith('--max-pages=')) {
      maxPages = parsePositiveInteger(
        argument.slice('--max-pages='.length),
        '--max-pages',
      )
      continue
    }
    throw new Error(`Unsupported argument: ${argument}`)
  }
  if (check && execute) {
    throw new Error('--check and --execute are mutually exclusive.')
  }
  return { check, execute, maxPages }
}

async function permissionEvidence(): Promise<{
  path: typeof PERMISSION_PATH
  sha256: string
}> {
  const body = await readFile(PERMISSION_ABSOLUTE_PATH, 'utf8')
  if (!body.includes(EXPECTED_ATTESTATION)) {
    throw new Error(
      'Spotrac permission evidence does not contain the recorded statement.',
    )
  }
  return { path: PERMISSION_PATH, sha256: sha256(body) }
}

async function acquisitionLock(): Promise<() => Promise<void>> {
  await mkdir(RAW_ROOT, { recursive: true })
  let handle
  try {
    handle = await open(LOCK_PATH, 'wx')
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      throw new Error(
        'Another Spotrac Team Runway acquisition is already running.',
      )
    }
    throw error
  }
  await handle.writeFile(`${process.pid}\n`, 'utf8')
  await handle.close()
  return async () => {
    await rm(LOCK_PATH, { force: true })
  }
}

function artifactSummary(artifact: PlayerMobilityArtifact): string {
  return (
    `${artifact.coverage.observedRows} observed rows ` +
    `(MLB ${artifact.coverage.byLeague.MLB}, ` +
    `NFL ${artifact.coverage.byLeague.NFL}, ` +
    `NBA ${artifact.coverage.byLeague.NBA}, ` +
    `NHL ${artifact.coverage.byLeague.NHL}) ` +
    `through ${artifact.dataThrough}`
  )
}

function reviewedIdentityEvidence(): HobbyMobilityIdentityEvidence[] {
  const currentPlayerEvidence =
    hobbySubjectContextJson.rows.flatMap((row) => {
      if (
        row.kind !== 'person' ||
        (
          row.identityStatus !== 'verified_player_bridge' &&
          row.identityStatus !== 'reviewed_player_bridge'
        )
      ) {
        return []
      }
      return [{
        gemRateSourceKey: row.gemRateSourceKey,
        evidenceSourceId: row.sourceId,
        identityStatus: row.identityStatus,
        teamCode: null,
      } satisfies HobbyMobilityIdentityEvidence]
    })
  const reviewedNameTeamEvidence =
    itFactorBoardJson.entries.flatMap((entry) => {
      const sourceKey = entry.market?.sourceKey
      if (
        !sourceKey ||
        (
          entry.market.identityStatus !== 'exact' &&
          entry.market.identityStatus !== 'normalized'
        )
      ) {
        return []
      }
      return [{
        gemRateSourceKey: sourceKey,
        evidenceSourceId: `it-factor-board:${entry.id}`,
        identityStatus: 'reviewed_name_team',
        teamCode: entry.team.code,
      } satisfies HobbyMobilityIdentityEvidence]
    })
  return [
    ...currentPlayerEvidence,
    ...reviewedNameTeamEvidence,
  ]
}

function blockedIdentityKeys(): string[] {
  return [...new Set(
    hobbyIdentityControlsJson.blocks
      .filter((entry) => entry.status === 'blocked')
      .map((entry) => entry.gemRateSourceKey),
  )].toSorted((left, right) => left.localeCompare(right, 'en-US'))
}

function runIdFor(completedAt: Date): string {
  return completedAt.toISOString().replaceAll(/[:.]/gu, '-')
}

function sourceManifestPath(runId: string): {
  absolute: string
  relative: string
} {
  const absolute = path.join(MANIFEST_PATH, `${runId}.json`)
  return {
    absolute,
    relative: path.relative(ROOT, absolute),
  }
}

async function writePinnedManifest(
  destination: string,
  manifest: unknown,
): Promise<string> {
  const body = stableJson(manifest)
  await atomicWrite(destination, body)
  const written = await readFile(destination, 'utf8')
  if (written !== body) {
    throw new Error('Spotrac acquisition manifest write verification failed.')
  }
  return sha256(written)
}

function isNodeErrorCode(
  error: unknown,
  code: string,
): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code,
  )
}

async function verifyArtifactSourceChain(
  artifact: PlayerMobilityArtifact,
): Promise<void> {
  const sourceChain = artifact.sourceChain
  if (!sourceChain) return
  const permission = await permissionEvidence()
  if (
    sourceChain.permissionEvidence.path !== permission.path ||
    sourceChain.permissionEvidence.sha256 !== permission.sha256
  ) {
    throw new Error(
      'Player mobility permission evidence no longer matches the artifact.',
    )
  }

  const manifestAbsolute = path.resolve(
    ROOT,
    sourceChain.run.manifestPath,
  )
  const allowedManifestRoot = `${path.resolve(MANIFEST_PATH)}${path.sep}`
  if (!manifestAbsolute.startsWith(allowedManifestRoot)) {
    throw new Error('Player mobility manifest path escapes its audit root.')
  }
  let manifestBody: string
  try {
    manifestBody = await readFile(manifestAbsolute, 'utf8')
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return
    throw error
  }
  if (sha256(manifestBody) !== sourceChain.run.manifestSha256) {
    throw new Error('Player mobility acquisition manifest hash drifted.')
  }
  const manifest = JSON.parse(manifestBody) as {
    schemaVersion?: unknown
    permissionEvidence?: {
      path?: unknown
      sha256?: unknown
    }
    transport?: {
      robotsAuthorization?: {
        contentSha256?: unknown
      }
    }
    receipts?: Array<{
      url?: unknown
      contentSha256?: unknown
    }>
  }
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    manifest.permissionEvidence?.path !==
      sourceChain.permissionEvidence.path ||
    manifest.permissionEvidence?.sha256 !==
      sourceChain.permissionEvidence.sha256 ||
    manifest.transport?.robotsAuthorization?.contentSha256 !==
      sourceChain.robotsPolicy.sha256 ||
    !Array.isArray(manifest.receipts)
  ) {
    throw new Error('Player mobility acquisition manifest is inconsistent.')
  }
  const manifestPages = manifest.receipts
    .map((receipt) => ({
      sourceUrl: receipt.url,
      contentSha256: receipt.contentSha256,
    }))
    .toSorted((left, right) => String(left.sourceUrl).localeCompare(
      String(right.sourceUrl),
      'en-US',
    ))
  if (
    JSON.stringify(manifestPages) !==
      JSON.stringify(sourceChain.pages.items)
  ) {
    throw new Error(
      'Player mobility acquisition page receipts do not match the artifact.',
    )
  }
}

async function executeRefresh(options: CliOptions): Promise<void> {
  const permission = await permissionEvidence()
  const plan = spotracAcquisitionPlan()
  const selected = plan.slice(0, Math.min(options.maxPages, plan.length))
  const startedAt = new Date()
  const release = await acquisitionLock()
  const receipts: AcquisitionReceipt[] = []
  try {
    const client = createSpotracPageClient({
      cacheDirectory: CACHE_PATH,
    })
    const robotsAuthorization =
      await client.authorizeTeamContractListPages(
        selected.map((unit) => unit.url),
      )
    const parsedLists = []
    for (let index = 0; index < selected.length; index += 1) {
      const unit = selected[index]!
      process.stdout.write(
        `[${index + 1}/${selected.length}] ${unit.league} ` +
        `${unit.canonicalTeam.code}\n`,
      )
      const page = await client.getTeamContractListPage(unit.url)
      const parsed = parseSpotracTeamContractList(page.html, page.sourceUrl)
      parsedLists.push(parsed)
      receipts.push({
        url: page.sourceUrl,
        retrievedAt: page.retrievedAt,
        contentSha256: page.contentSha256,
        cacheStatus: page.cacheStatus,
        parsedRowCount: parsed.rows.length,
        withheldRowCount: parsed.withheldRows.length,
        totalRowCount: parsed.rows.length + parsed.withheldRows.length,
      })
    }

    const completed = selected.length === plan.length
    const completedAt = new Date()
    const dataThrough = completedAt.toISOString().slice(0, 10)
    const runId = runIdFor(completedAt)
    const manifestPath = sourceManifestPath(runId)
    const sourceManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      runId,
      status: completed ? 'acquired' : 'partial',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      permissionEvidence: permission,
      transport: {
        userAgent: SPOTRAC_USER_AGENT,
        configuredMinimumRequestIntervalMs:
          SPOTRAC_MIN_REQUEST_INTERVAL_MS,
        minimumRequestIntervalMs:
          robotsAuthorization.effectiveMinimumRequestIntervalMs,
        concurrency: 1,
        cacheFirst: true,
        robotsPolicyUrl: robotsAuthorization.policyUrl,
        robotsAuthorization,
        allowedPathShape: '/{league}/contracts/_/team/{team}',
      },
      plan: {
        totalPages: plan.length,
        selectedPages: selected.length,
      },
      receipts,
    }
    const manifestSha256 = await writePinnedManifest(
      manifestPath.absolute,
      sourceManifest,
    )
    let artifact: PlayerMobilityArtifact | null = null
    let matching = null
    if (completed) {
      const existingArtifact = parsePlayerMobilityArtifact()
      const built = buildSpotracMobilityArtifact({
        parsedLists,
        hobbyRows: hobbySnapshotJson.rows,
        identityEvidence: reviewedIdentityEvidence(),
        blockedIdentityKeys: blockedIdentityKeys(),
        existingArtifact,
        sourceChain: {
          permissionEvidence: permission,
          robotsPolicy: {
            url: robotsAuthorization.policyUrl,
            sha256: robotsAuthorization.contentSha256,
          },
          runId,
          runManifestPath: manifestPath.relative,
          runManifestSha256: manifestSha256,
          pages: receipts.map((receipt) => ({
            sourceUrl: receipt.url,
            contentSha256: receipt.contentSha256,
          })),
        },
        generatedAt: completedAt.toISOString(),
        dataThrough,
        accessedAt: dataThrough,
      })
      artifact = parsePlayerMobilityArtifact(built.artifact)
      matching = built.matching
      await atomicWrite(OUTPUT_PATH, stableJson(artifact))
    }

    if (artifact) {
      await atomicWrite(
        path.join(MANIFEST_PATH, `${runId}.publication.json`),
        stableJson({
          schemaVersion: PUBLICATION_SCHEMA_VERSION,
          runId,
          sourceManifest: {
            path: manifestPath.relative,
            sha256: manifestSha256,
          },
          matching,
          publicArtifact: {
            path: path.relative(ROOT, OUTPUT_PATH),
            contentSha256: artifact.contentSha256,
            observedRows: artifact.coverage.observedRows,
          },
        }),
      )
    }

    if (!completed) {
      process.stdout.write(
        `Cached ${selected.length}/${plan.length} pages; public artifact ` +
        'was not changed. Re-run with a complete page cap.\n',
      )
      return
    }
    process.stdout.write(
      `Player mobility refreshed: ${artifactSummary(artifact!)}.\n`,
    )
  } finally {
    await release()
  }
}

async function main(): Promise<void> {
  const options = cliOptions(process.argv.slice(2))
  if (options.check) {
    const artifact = parsePlayerMobilityArtifact()
    await verifyArtifactSourceChain(artifact)
    process.stdout.write(
      `Player mobility context valid: ${artifactSummary(artifact)}.\n`,
    )
    return
  }
  const permission = await permissionEvidence()
  const plan = spotracAcquisitionPlan()
  if (!options.execute) {
    process.stdout.write(
      `Dry run: ${plan.length} Spotrac team contract pages across ` +
      'MLB/NFL/NBA/NHL. No network or files changed.\n' +
      `Execution requires --execute; one worker waits at least ` +
      `${SPOTRAC_MIN_REQUEST_INTERVAL_MS}ms between live requests and ` +
      `pins ${permission.path} (${permission.sha256}).\n`,
    )
    return
  }
  await executeRefresh(options)
}

await main()
