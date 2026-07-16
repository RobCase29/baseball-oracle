import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decideHarryKnowsBallBootstrap,
  decideHarryKnowsBallBootstrapLoop,
  harryKnowsBallExactCoveragePercent,
  HKB_BOOTSTRAP_MINIMUM_CURRENT_ROWS,
  type HarryKnowsBallBootstrapCoverage,
} from './bootstrap-harry-knows-ball.js'

function coverage(
  patch: Partial<HarryKnowsBallBootstrapCoverage> = {},
): HarryKnowsBallBootstrapCoverage {
  return {
    currentRows: 1_726,
    mappedRows: 1_554,
    queueRows: 172,
    ...patch,
  }
}

describe('HarryKnowsBall production bootstrap decision', () => {
  it('does not connect or ingest outside a production Vercel build', () => {
    expect(decideHarryKnowsBallBootstrap({
      coverage: null,
      environment: 'preview',
    })).toEqual({ action: 'skip', reason: 'not_production' })
  })

  it('ingests when the current snapshot is missing or below its quality floor', () => {
    expect(decideHarryKnowsBallBootstrap({
      coverage: null,
      environment: 'production',
    })).toEqual({ action: 'ingest', reason: 'snapshot_missing' })
    expect(decideHarryKnowsBallBootstrap({
      coverage: coverage({
        currentRows: HKB_BOOTSTRAP_MINIMUM_CURRENT_ROWS - 1,
        mappedRows: HKB_BOOTSTRAP_MINIMUM_CURRENT_ROWS - 1,
        queueRows: 0,
      }),
      environment: 'production',
    })).toEqual({ action: 'ingest', reason: 'snapshot_missing' })
  })

  it('exits fast at 90% exact MLBAM coverage and backfills just below it', () => {
    expect(harryKnowsBallExactCoveragePercent(coverage())).toBeCloseTo(90.03, 2)
    expect(decideHarryKnowsBallBootstrap({
      coverage: coverage(),
      environment: 'production',
    })).toEqual({ action: 'skip', reason: 'adequate' })

    expect(decideHarryKnowsBallBootstrap({
      coverage: coverage({ mappedRows: 1_553, queueRows: 173 }),
      environment: 'production',
    })).toEqual({
      action: 'backfill',
      reason: 'identity_coverage_incomplete',
    })
  })
})

describe('HarryKnowsBall bootstrap crawl stop logic', () => {
  it('continues while a nonempty queue is making progress', () => {
    expect(decideHarryKnowsBallBootstrapLoop({
      coverage: coverage({ mappedRows: 1_200, queueRows: 526 }),
      previousMappedRows: 1_100,
      rounds: 12,
    })).toBe('continue')
  })

  it('stops immediately for adequate coverage or an exhausted queue', () => {
    expect(decideHarryKnowsBallBootstrapLoop({
      coverage: coverage(),
      previousMappedRows: 1_500,
      rounds: 16,
    })).toBe('adequate')
    expect(decideHarryKnowsBallBootstrapLoop({
      coverage: coverage({ mappedRows: 1_000, queueRows: 0 }),
      previousMappedRows: 900,
      rounds: 10,
    })).toBe('queue_empty')
  })

  it('stops on a batch with no exact-identity progress', () => {
    expect(decideHarryKnowsBallBootstrapLoop({
      coverage: coverage({ mappedRows: 1_200, queueRows: 526 }),
      previousMappedRows: 1_200,
      rounds: 13,
    })).toBe('no_progress')
  })

  it('caps the crawl even when every bounded batch is making progress', () => {
    expect(decideHarryKnowsBallBootstrapLoop({
      coverage: coverage({ mappedRows: 1_300, queueRows: 426 }),
      maximumRounds: 20,
      previousMappedRows: 1_250,
      rounds: 20,
    })).toBe('max_rounds')
  })

  it('exposes a remote entrypoint without coupling it to a local env file', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    )
    expect(packageJson.scripts['bootstrap:harry-knows-ball:remote']).toBe(
      'tsx scripts/bootstrap-harry-knows-ball.ts',
    )
  })
})
