import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/migrations/0015_current_fangraphs_scouting_snapshot.sql',
  ),
  'utf8',
)
const candidateCensusMigration = readFileSync(
  resolve(
    process.cwd(),
    'db/migrations/0016_fangraphs_current_candidate_census.sql',
  ),
  'utf8',
)
const historicalIdentityMigration = readFileSync(
  resolve(
    process.cwd(),
    'db/migrations/0017_fangraphs_historical_exact_identity_census.sql',
  ),
  'utf8',
)
const refreshSource = readFileSync(
  resolve(process.cwd(), 'scripts/ingest/fangraphs-prospects.ts'),
  'utf8',
)

describe('current FanGraphs scouting snapshot migration', () => {
  it('selects only validated v2 landings from the newest complete two-role season', () => {
    expect(migration).toContain("run.parser_version = 'fangraphs-prospect-board-v2'")
    expect(migration).toContain("run.parameters ->> 'refreshScope' = 'current_prospect_board'")
    expect(migration).toContain("run.parameters ->> 'statsRole' IN ('bat', 'pit')")
    expect(migration).toContain('HAVING count(DISTINCT stats_side) = 2')
    expect(migration).toContain('ORDER BY report_season DESC')
    expect(migration).toContain('JOIN complete_season USING (report_season)')
  })

  it('joins MLBAM only through the exact UPID and MinorMaster tuple', () => {
    expect(migration).toContain(
      'LEFT JOIN statistics USING (stats_side, fangraphs_id, minor_master_id)',
    )
    expect(migration).toContain(
      'names are display fields and never identity keys',
    )
    expect(migration).not.toMatch(/JOIN[^\n]+player_name/iu)
  })

  it('publishes the stable scouting and tool-grade contract', () => {
    for (const column of [
      'mlbam_id',
      'fangraphs_id',
      'minor_master_id',
      'org_rank',
      'overall_rank',
      'future_value',
      'eta',
      'present_hit',
      'future_hit',
      'present_fastball',
      'future_fastball',
      'bat_control',
      'pitch_selection',
      'known_at',
    ]) {
      expect(migration).toContain(column)
    }
    expect(migration).toContain(
      'CREATE UNIQUE INDEX fangraphs_current_scouting_role_mlbam_uidx',
    )
  })

  it('adds point-in-time fields needed to seed an exact-ID candidate census', () => {
    for (const column of ['age', 'fangraphs_path', 'stats_season', 'stats_level']) {
      expect(candidateCensusMigration).toContain(column)
    }
    expect(candidateCensusMigration).toContain(
      'LEFT JOIN statistics USING (stats_side, fangraphs_id, minor_master_id)',
    )
    expect(candidateCensusMigration).toContain(
      'names are display fields and never identity keys',
    )
    expect(candidateCensusMigration).not.toMatch(/JOIN[^\n]+player_name/iu)
  })

  it('resolves missing current MLBAM only through unambiguous validated tuple history', () => {
    expect(historicalIdentityMigration).toContain(
      "run.parameters ->> 'refreshScope' = 'current_prospect_board'",
    )
    expect(historicalIdentityMigration).toContain(
      "run.parameters ->> 'statsRole' IN ('bat', 'pit')",
    )
    expect(historicalIdentityMigration).toContain(
      'GROUP BY fangraphs_id, minor_master_id',
    )
    expect(historicalIdentityMigration).toContain('current_person_tuple AS')
    expect(historicalIdentityMigration).toContain(
      'count(DISTINCT mlbam_id)::integer AS historical_mlbam_candidate_count',
    )
    expect(historicalIdentityMigration).toContain(
      'count(DISTINCT (fangraphs_id, minor_master_id))::integer',
    )
    expect(historicalIdentityMigration).toContain('candidate_mlbam_multiplicity')
    expect(historicalIdentityMigration).toContain("THEN 'current_tuple_conflict'")
    expect(historicalIdentityMigration).toContain("THEN 'historical_tuple_conflict'")
    expect(historicalIdentityMigration).toContain("THEN 'current_history_conflict'")
    expect(historicalIdentityMigration).toContain("THEN 'historical_census_conflict'")
    expect(historicalIdentityMigration).toContain("THEN 'historical_exact'")
    expect(historicalIdentityMigration).toContain(
      'CREATE UNIQUE INDEX fangraphs_current_candidate_role_mlbam_uidx',
    )
    expect(historicalIdentityMigration).toContain(
      'Names are never identity keys',
    )
    expect(historicalIdentityMigration).not.toMatch(/JOIN[^\n]+player_name/iu)
  })

  it('refreshes the identity census after its current scouting dependency', () => {
    const scoutingRefresh = refreshSource.indexOf(
      'REFRESH MATERIALIZED VIEW app.fangraphs_current_scouting_snapshot',
    )
    const censusRefresh = refreshSource.indexOf(
      'REFRESH MATERIALIZED VIEW app.fangraphs_current_candidate_census',
    )
    expect(scoutingRefresh).toBeGreaterThan(-1)
    expect(censusRefresh).toBeGreaterThan(scoutingRefresh)
    expect(refreshSource).toContain('FROM app.fangraphs_current_candidate_census')
    expect(refreshSource).toContain("mlbam_resolution_status = 'current_exact'")
    expect(refreshSource).toContain('AS batting_resolved_mlbam_rows')
    expect(refreshSource).toContain('AS pitching_resolved_mlbam_rows')
    expect(refreshSource).toContain(
      'WHERE source_role = \'Hitter\' AND resolved_mlbam_id IS NOT NULL',
    )
    expect(refreshSource).toContain(
      'WHERE source_role = \'Pitcher\' AND resolved_mlbam_id IS NOT NULL',
    )
  })
})
