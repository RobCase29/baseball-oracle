import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CRAWL_DELAY_MS,
  PARSER_VERSION,
  acquireAcquisitionLock,
  inferSeasonRole,
  parseCliArguments,
  parseHallOfFamePage,
  parseJawsStandardPage,
  parseValueSeasonPage,
  runBackfill,
} from './baseball-reference-mlb-war.js'

const battingHtml = `<!doctype html><html><body>
  <!-- <table id="players_value_batting"><tbody>
    <tr><td data-stat="name_display" data-append-csv="ohtansh01"><a href="/players/o/ohtansh01.shtml">Shohei Ohtani</a></td>
      <td data-stat="age">30</td><td data-stat="team_name_abbr">LAD</td><td data-stat="b_pa">731</td>
      <td data-stat="b_runs_batting" csk="61.2">61</td><td data-stat="b_runs_baserunning">3</td>
      <td data-stat="b_runs_double_plays">-1</td><td data-stat="b_runs_fielding">0</td>
      <td data-stat="b_runs_position">-17</td><td data-stat="b_raa">46</td><td data-stat="b_waa" csk="4.57">4.6</td>
      <td data-stat="b_runs_replacement">24</td><td data-stat="b_rar">70</td>
      <td data-stat="b_war" csk="7.05">7.1</td><td data-stat="b_war_off">7.2</td><td data-stat="b_war_def">-1.7</td>
      <td data-stat="pos">D</td></tr>
    <tr class="partial_table"><td data-stat="name_display" data-append-csv="ohtansh01"><a href="/players/o/ohtansh01.shtml">Shohei Ohtani</a></td>
      <td data-stat="b_pa">100</td><td data-stat="b_war">1.0</td></tr>
    <tr class="norank"><td data-stat="name_display" data-append-csv="league01"><a href="/players/l/league01.shtml">League</a></td>
      <td data-stat="b_pa">1</td><td data-stat="b_war">0</td></tr>
  </tbody></table> -->
</body></html>`

const pitchingHtml = `<!doctype html><html><body>
  <table id="players_value_pitching"><tbody>
    <tr><td data-stat="name_display" data-append-csv="ohtansh01"><a href="/players/o/ohtansh01.shtml">Shohei Ohtani</a></td>
      <td data-stat="age">30</td><td data-stat="team_name_abbr">LAD</td>
      <td data-stat="p_ip" csk="360">120.0</td><td data-stat="p_g">21</td><td data-stat="p_gs">21</td>
      <td data-stat="p_r">40</td><td data-stat="p_raa">25</td><td data-stat="p_waa">2.5</td>
      <td data-stat="p_waa_adj">-0.1</td><td data-stat="p_rar">39</td><td data-stat="p_war" csk="4.15">4.2</td></tr>
  </tbody></table>
</body></html>`

const hofBattingHtml = `<!doctype html><html><body>
  <table id="hof_batting"><tbody>
    <tr><td data-stat="player" data-append-csv="ruthba01"><a href="/players/r/ruthba01.shtml">Babe Ruth</a></td>
      <td data-stat="year_induction">1936</td><td data-stat="year_min">1914</td><td data-stat="year_max">1935</td>
      <td data-stat="WAR_bat">162.2</td><td data-stat="PA">10627</td></tr>
    <tr class="non_batter"><td data-stat="player" data-append-csv="youngcy01"><a href="/players/y/youngcy01.shtml">Cy Young</a></td>
      <td data-stat="year_induction">1937</td><td data-stat="year_min">1890</td><td data-stat="year_max">1911</td>
      <td data-stat="WAR_bat">-1</td><td data-stat="PA">1</td></tr>
    <tr><td data-stat="player"><strong>Average Batting HOFer</strong></td><td data-stat="WAR_bat">67</td></tr>
  </tbody></table>
</body></html>`

const hofPitchingHtml = `<!doctype html><html><body>
  <table id="hof_pitching"><tbody>
    <tr class="pitcher"><td data-stat="player" data-append-csv="ruthba01"><a href="/players/r/ruthba01.shtml">Babe Ruth</a></td>
      <td data-stat="year_induction">1936</td><td data-stat="year_min">1914</td><td data-stat="year_max">1935</td>
      <td data-stat="WAR_pitch">20.4</td><td data-stat="IP">1221.1</td></tr>
    <tr class="non_pitcher"><td data-stat="player" data-append-csv="aaronha01"><a href="/players/a/aaronha01.shtml">Henry Aaron</a></td></tr>
  </tbody></table>
</body></html>`

function jawsHtml(position: string): string {
  const specialized = position === 'P'
    ? '<td data-stat="S_JAWS">56.8</td>'
    : position === 'RP'
      ? '<td data-stat="R_JAWS">29.2</td>'
      : ''
  return `<!doctype html><html><body><table id="jaws"><tbody>
    <tr><td data-stat="player">Some Player</td><td data-stat="WAR_career">70</td></tr>
    <tr class="norank"><td data-stat="player">Avg of 17 HOFers at this position</td>
      <td data-stat="WAR_career">53.7</td><td data-stat="WAR_peak7">34.9</td><td data-stat="JAWS">44.3</td>${specialized}</tr>
  </tbody></table></body></html>`
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'baseball-oracle-mlb-war-'))
  temporaryDirectories.push(root)
  const permissionPath = 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md'
  const permissionBody = '# Authorized test research\n'
  await mkdir(path.join(root, 'docs/permissions'), { recursive: true })
  await writeFile(path.join(root, permissionPath), permissionBody)
  await mkdir(path.join(root, 'data/reference-locks'), { recursive: true })
  await writeFile(
    path.join(root, 'data/reference-locks/baseball-reference-mlb-war-protocol-v1.json'),
    `${JSON.stringify({
      schemaVersion: 'baseball-reference-mlb-war-protocol/v1',
      source: 'baseball-reference-mlb-war',
      parserVersion: PARSER_VERSION,
      permissionEvidence: {
        path: permissionPath,
        sha256: createHash('sha256').update(permissionBody).digest('hex'),
      },
      coverage: {
        earliestSeason: 1871,
        latestCompleteSeason: 2025,
        latestAllowedSeason: 2026,
      },
      transport: {
        crawlDelayMs: CRAWL_DELAY_MS,
        maxAttempts: 3,
        oneWorker: true,
        acceptEncoding: 'identity',
      },
    }, null, 2)}\n`,
  )
  return root
}

describe('Baseball-Reference value and HOF parsers', () => {
  it('accepts one total value row and excludes partial and norank rows', () => {
    const rows = parseValueSeasonPage(battingHtml, 2025, 'batting')

    expect(rows).toEqual([
      expect.objectContaining({
        bbref_id: 'ohtansh01',
        player_name: 'Shohei Ohtani',
        season: 2025,
        b_pa: 731,
        b_war: 7.05,
        b_waa: 4.57,
        position: 'D',
      }),
    ])
  })

  it('uses displayed innings rather than the csk outs value', () => {
    const rows = parseValueSeasonPage(pitchingHtml, 2025, 'pitching')
    expect(rows[0]).toMatchObject({
      p_ip: '120.0',
      p_ip_outs: 360,
      p_ip_decimal: 120,
      p_war: 4.15,
      p_games_started: 21,
    })

    const twoOuts = parseValueSeasonPage(
      pitchingHtml.replace('csk="360">120.0', 'csk="2">0.2'),
      2025,
      'pitching',
    )[0]
    expect(twoOuts.p_ip).toBe('0.2')
    expect(twoOuts.p_ip_outs).toBe(2)
    expect(twoOuts.p_ip_decimal).toBeCloseTo(2 / 3, 8)
  })

  it('accepts provider-observed short MLB IDs without weakening URL reconciliation', () => {
    const shortIdPage = pitchingHtml
      .replaceAll('ohtansh01', 'gowo01')
      .replace('/players/o/gowo01.shtml', '/players/g/gowo01.shtml')
    expect(parseValueSeasonPage(shortIdPage, 2026, 'pitching')[0].bbref_id).toBe(
      'gowo01',
    )
    expect(() =>
      parseValueSeasonPage(
        shortIdPage.replace('/players/g/gowo01.shtml', '/players/g/other01.shtml'),
        2026,
        'pitching',
      ),
    ).toThrow('conflicts with data-append-csv')

    const legacyIdPage = pitchingHtml
      .replaceAll('ohtansh01', 'dela_fr01')
      .replace('/players/o/dela_fr01.shtml', '/players/d/dela_fr01.shtml')
    expect(parseValueSeasonPage(legacyIdPage, 1991, 'pitching')[0].bbref_id).toBe(
      'dela_fr01',
    )
  })

  it('rejects duplicate total rows instead of guessing', () => {
    const duplicate = battingHtml.replace(
      '</tbody>',
      `<tr><td data-stat="name_display" data-append-csv="ohtansh01"><a href="/players/o/ohtansh01.shtml">Shohei Ohtani</a></td>
        <td data-stat="b_war">1</td></tr></tbody>`,
    )
    expect(() => parseValueSeasonPage(duplicate, 2025, 'batting')).toThrow(
      'duplicate total row',
    )
  })

  it('keeps actual HOF batters and pitchers while excluding provider cross-role rows', () => {
    expect(parseHallOfFamePage(hofBattingHtml, 'batting')).toEqual([
      expect.objectContaining({ bbref_id: 'ruthba01', career_war: 162.2 }),
    ])
    expect(parseHallOfFamePage(hofPitchingHtml, 'pitching')).toEqual([
      expect.objectContaining({ bbref_id: 'ruthba01', career_war: 20.4 }),
    ])
  })

  it('extracts the exact HOF-average JAWS row and specialized pitching metric', () => {
    expect(parseJawsStandardPage(jawsHtml('P'), 'P')).toEqual([
      {
        position: 'P',
        label: 'Avg of 17 HOFers at this position',
        hof_player_count: 17,
        career_war_standard: 53.7,
        peak_seven_war_standard: 34.9,
        jaws_standard: 44.3,
        specialized_jaws_standard: 56.8,
        specialized_metric: 'S_JAWS',
      },
    ])
  })

  it('requires meaningful workloads before assigning two-way', () => {
    expect(inferSeasonRole({
      battingPa: 650,
      pitchingIp: 1,
      battingPosition: '5/3',
      hasBattingRow: true,
      hasPitchingRow: true,
    })).toBe('hitter')
    expect(inferSeasonRole({
      battingPa: 70,
      pitchingIp: 25,
      battingPosition: 'D/9',
      hasBattingRow: true,
      hasPitchingRow: true,
    })).toBe('two_way')
    expect(inferSeasonRole({
      battingPa: 90,
      pitchingIp: 180,
      battingPosition: '1',
      hasBattingRow: true,
      hasPitchingRow: true,
    })).toBe('pitcher')
  })
})

describe('bounded, resumable MLB WAR acquisition', () => {
  it('is dry by default, supports spaced values, and admits 2026 explicitly', () => {
    expect(parseCliArguments([])).toEqual({
      startSeason: 2025,
      endSeason: 2025,
      maxPages: 4,
      execute: false,
    })
    expect(parseCliArguments([
      '--start-season', '2025', '--end-season', '2026', '--max-pages=20', '--execute',
    ])).toEqual({
      startSeason: 2025,
      endSeason: 2026,
      maxPages: 20,
      execute: true,
    })
    expect(() => parseCliArguments(['--end-season=2027'])).toThrow('1871-2026')
  })

  it('enforces one acquisition process per project root', async () => {
    const rootDir = await projectRoot()
    const release = await acquireAcquisitionLock(rootDir)
    await expect(acquireAcquisitionLock(rootDir)).rejects.toThrow(
      'Another Baseball-Reference MLB WAR acquisition is running',
    )
    await release()
  })

  it('pins exact bytes and permission, materializes joined outputs, and resumes offline', async () => {
    const rootDir = await projectRoot()
    let fetchCalls = 0
    let currentMs = Date.parse('2026-07-12T18:00:00.000Z')
    const sleeps: number[] = []
    const fetchImpl: typeof fetch = async (input) => {
      fetchCalls += 1
      const url = String(input)
      const body = url.includes('-value-batting')
        ? battingHtml
        : url.includes('-value-pitching')
          ? pitchingHtml
          : url.includes('hof_batting')
            ? hofBattingHtml
            : url.includes('hof_pitching')
              ? hofPitchingHtml
              : jawsHtml(/jaws_([^/.]+)\.shtml/.exec(url)?.[1] ?? 'C')
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    const now = () => new Date(currentMs)
    const sleep = async (milliseconds: number) => {
      sleeps.push(milliseconds)
      currentMs += milliseconds
    }

    const result = await runBackfill({
      rootDir,
      startSeason: 2025,
      endSeason: 2025,
      maxPages: 20,
      execute: true,
      fetchImpl,
      now,
      sleep,
      log: () => undefined,
    })

    expect(result.status).toBe('complete')
    expect(result.plannedUnits).toBe(14)
    expect(fetchCalls).toBe(14)
    expect(sleeps).toContain(CRAWL_DELAY_MS)
    expect(result.referenceLockPath).toBe(
      'data/reference-locks/baseball-reference-mlb-war.json',
    )
    const playerSeasons = JSON.parse(
      await readFile(path.join(rootDir, 'data/processed/baseball-reference-mlb-war/player_seasons.json'), 'utf8'),
    ) as Array<Record<string, unknown>>
    expect(playerSeasons).toEqual([
      expect.objectContaining({
        bbref_id: 'ohtansh01',
        season_state: 'complete',
        role: 'two_way',
        total_war: 11.2,
        known_at: expect.stringMatching(/^2026-07-12T/),
      }),
    ])
    const hof = JSON.parse(
      await readFile(path.join(rootDir, 'data/processed/baseball-reference-mlb-war/hof_inductees.json'), 'utf8'),
    ) as Array<Record<string, unknown>>
    expect(hof).toEqual([
      expect.objectContaining({
        bbref_id: 'ruthba01',
        position_player: true,
        pitcher: true,
        career_b_war: 162.2,
        career_p_war: 20.4,
      }),
    ])
    const manifest = JSON.parse(
      await readFile(path.join(rootDir, 'data/processed/baseball-reference-mlb-war/manifest.json'), 'utf8'),
    ) as { coverage: { complete: boolean }; sourceLockIsolation: { includedInGlobalSourceLock: boolean } }
    expect(manifest.coverage.complete).toBe(true)
    expect(manifest.sourceLockIsolation.includedInGlobalSourceLock).toBe(false)

    const resumed = await runBackfill({
      rootDir,
      startSeason: 2025,
      endSeason: 2025,
      maxPages: 20,
      execute: true,
      fetchImpl: async () => {
        throw new Error('resume must not make a network request')
      },
      now,
      sleep,
      log: () => undefined,
    })
    expect(resumed.status).toBe('complete')
    expect(resumed.liveRequests).toBe(0)
    expect(fetchCalls).toBe(14)
  })

  it('marks 2026 as an in-season, known-at snapshot', async () => {
    const rootDir = await projectRoot()
    await runBackfill({
      rootDir,
      startSeason: 2026,
      endSeason: 2026,
      maxPages: 2,
      execute: true,
      fetchImpl: async (input) => new Response(
        String(input).includes('-value-batting') ? battingHtml : pitchingHtml,
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
      sleep: async () => undefined,
      now: () => new Date('2026-07-12T19:00:00.000Z'),
      log: () => undefined,
    })
    const rows = JSON.parse(
      await readFile(path.join(rootDir, 'data/processed/baseball-reference-mlb-war/player_seasons.json'), 'utf8'),
    ) as Array<{ season: number; season_state: string; known_at: string }>
    expect(rows).toEqual([
      expect.objectContaining({
        season: 2026,
        season_state: 'in_season',
        known_at: '2026-07-12T19:00:00.000Z',
      }),
    ])
  })
})
