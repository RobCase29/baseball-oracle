import { spawnSync } from 'node:child_process'
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(testDirectory, '../..')
const scriptPath = resolve(
  repositoryRoot,
  'scripts/ingest/checklist-hobby-player-signals.ts',
)
const artifactPath = resolve(
  repositoryRoot,
  'api/_data/checklist-hobby-player-signals.json',
)

interface ExchangeFixture {
  schemaVersion: string
  contractVersion: string
  rows: Array<{
    sport: 'football' | 'basketball'
    careerStartYear?: number | null
  }>
}

function runValidator(sourcePath = artifactPath) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      scriptPath,
      '--source',
      sourcePath,
      '--output',
      artifactPath,
      '--check',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  )
}

async function withChangedArtifact(
  change: (artifact: ExchangeFixture) => void,
): Promise<ReturnType<typeof runValidator>> {
  const directory = await mkdtemp(resolve(tmpdir(), 'oracle-signals-v2-'))
  const sourcePath = resolve(directory, 'exchange.json')
  try {
    const artifact = JSON.parse(
      await readFile(artifactPath, 'utf8'),
    ) as ExchangeFixture
    change(artifact)
    await writeFile(sourcePath, `${JSON.stringify(artifact)}\n`)
    return runValidator(sourcePath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Checklist Hobby Oracle player-signal v2 ingestion', () => {
  it('validates the committed strict v2 artifact', () => {
    const result = runValidator()

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      mode: 'check',
      schemaVersion: 'backstop-hobby-player-signals.v2',
      contractVersion: '2.0.0',
      rows: 864,
      football: 464,
      basketball: 400,
    })
  })

  it('rejects the prior schema and contract', async () => {
    const result = await withChangedArtifact((artifact) => {
      artifact.schemaVersion = 'backstop-hobby-player-signals.v1'
      artifact.contractVersion = '1.0.0'
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'Checklist player-signal exchange failed its import contract',
    )
  })

  it('requires careerStartYear on every row', async () => {
    const result = await withChangedArtifact((artifact) => {
      delete artifact.rows[0]!.careerStartYear
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'Checklist player-signal row failed contract validation',
    )
  })

  it('rejects an out-of-range football careerStartYear', async () => {
    const result = await withChangedArtifact((artifact) => {
      const football = artifact.rows.find((row) => row.sport === 'football')
      if (!football) throw new Error('Football fixture is missing')
      football.careerStartYear = 1800
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'Checklist player-signal row failed contract validation',
    )
  })

  it('rejects a basketball careerStartYear supplied by no source', async () => {
    const result = await withChangedArtifact((artifact) => {
      const basketball = artifact.rows.find(
        (row) => row.sport === 'basketball',
      )
      if (!basketball) throw new Error('Basketball fixture is missing')
      basketball.careerStartYear = 2020
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'Checklist player-signal row failed contract validation',
    )
  })
})
