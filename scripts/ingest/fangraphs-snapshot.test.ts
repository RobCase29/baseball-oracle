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
})
