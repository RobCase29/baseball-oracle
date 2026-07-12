import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CRAWL_DELAY_MS,
  PARSER_VERSION,
  PROTOCOL_LOCK_PATH,
  SEASON,
  acquireAcquisitionLock,
  parseActiveRosterPage,
  parseCliArguments,
  parseTeamDiscoveryPage,
  runBackfill,
  type TeamDiscovery,
} from './baseball-reference-active-rosters.js'

const TEAM_IDS = [
  'ARI', 'ATH', 'ATL', 'BAL', 'BOS', 'CHC', 'CHW', 'CIN', 'CLE', 'COL',
  'DET', 'HOU', 'KCR', 'LAA', 'LAD', 'MIA', 'MIL', 'MIN', 'NYM', 'NYY',
  'PHI', 'PIT', 'SDP', 'SEA', 'SFG', 'STL', 'TBR', 'TEX', 'TOR', 'WSN',
]

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function discoveryHtml(ids = TEAM_IDS): string {
  return `<!doctype html><html><body><table id="teams_standard_batting"><tbody>
    ${ids
      .map(
        (id) => `<tr><th data-stat="team_name"><a href="/teams/${id}/${SEASON}.shtml">${id} Baseball Club</a></th></tr>`,
      )
      .join('\n')}
    <tr><td><a href="https://example.com/teams/XXX/${SEASON}.shtml">Foreign</a></td></tr>
  </tbody></table>
  <!-- <table><tbody><tr><td><a href="/teams/ATL/${SEASON}.shtml">ATL</a></td></tr></tbody></table> -->
  </body></html>`
}

function playerId(teamIndex: number, playerIndex: number): string {
  return `p${teamIndex.toString().padStart(2, '0')}${playerIndex
    .toString()
    .padStart(4, '0')}`
}

function rosterHtml(teamIndex: number, options: { commented?: boolean } = {}): string {
  const rows = Array.from({ length: 20 }, (_, playerIndex) => {
    const id = playerId(teamIndex, playerIndex)
    const state = playerIndex % 4
    const active = state === 0 || state === 1
    const injured = state === 2
    return `<tr>
      <th data-stat="player" data-append-csv="${id}"><a href="/players/p/${id}.shtml">Player ${teamIndex}-${playerIndex}</a></th>
      <td data-stat="pos">${playerIndex % 5 === 0 ? 'P' : 'OF'}</td>
      <td data-stat="is_active"${active ? '>Y' : ' class="iz">'}</td>
      <td data-stat="is_dl"${injured ? '>10-day' : ' class="iz">'}</td>
      <td data-stat="age">${20 + (playerIndex % 20)}</td>
      <td data-stat="bats">${playerIndex % 2 === 0 ? 'R' : 'L'}</td>
      <td data-stat="throws">R</td>
    </tr>`
  }).join('\n')
  const table = `<table id="the40man"><tbody>${rows}</tbody></table>`
  return `<!doctype html><html><body>${options.commented ? `<!-- ${table} -->` : table}</body></html>`
}

function team(teamIndex = 0): TeamDiscovery {
  const id = TEAM_IDS[teamIndex]
  return {
    team_id: id,
    team_name: `${id} Baseball Club`,
    season: SEASON,
    team_url: `https://www.baseball-reference.com/teams/${id}/${SEASON}.shtml`,
    roster_url: `https://www.baseball-reference.com/teams/${id}/${SEASON}-roster.shtml`,
  }
}

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'baseball-oracle-rosters-'))
  temporaryDirectories.push(root)
  const permissionBody = '# Authorized test research acquisition\n'
  await mkdir(path.join(root, 'docs/permissions'), { recursive: true })
  await writeFile(
    path.join(root, 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md'),
    permissionBody,
  )
  const protocol = {
    schemaVersion: 'baseball-reference-rosters-protocol/v1',
    source: 'baseball-reference-rosters',
    parserVersion: PARSER_VERSION,
    permissionEvidence: {
      path: 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
      sha256: sha256(permissionBody),
    },
    coverage: { season: SEASON, expectedTeamCount: 30 },
    transport: {
      crawlDelayMs: CRAWL_DELAY_MS,
      maxAttempts: 3,
      oneWorker: true,
      acceptEncoding: 'identity',
    },
    resources: {
      teamDiscovery: `https://www.baseball-reference.com/leagues/majors/${SEASON}.shtml`,
      teamRoster: `https://www.baseball-reference.com/teams/{team}/${SEASON}-roster.shtml#the40man`,
    },
  }
  await mkdir(path.join(root, path.dirname(PROTOCOL_LOCK_PATH)), { recursive: true })
  await writeFile(
    path.join(root, PROTOCOL_LOCK_PATH),
    `${JSON.stringify(protocol, null, 2)}\n`,
  )
  return root
}

describe('Baseball-Reference active-roster parser', () => {
  it('discovers exactly 30 canonical 2026 MLB team pages', () => {
    const teams = parseTeamDiscoveryPage(discoveryHtml())

    expect(teams).toHaveLength(30)
    expect(teams[0]).toEqual({
      team_id: 'ARI',
      team_name: 'ARI Baseball Club',
      season: 2026,
      team_url: 'https://www.baseball-reference.com/teams/ARI/2026.shtml',
      roster_url: 'https://www.baseball-reference.com/teams/ARI/2026-roster.shtml',
    })
    expect(teams.find((value) => value.team_id === 'ATL')?.team_name).toBe(
      'ATL Baseball Club',
    )
  })

  it('fails closed when the league page does not reconcile to 30 teams', () => {
    expect(() => parseTeamDiscoveryPage(discoveryHtml(TEAM_IDS.slice(0, -1)))).toThrow(
      'exposes 29 unique team links; expected 30',
    )
  })

  it('parses comment-wrapped #the40man rows with source status evidence', () => {
    const rows = parseActiveRosterPage(
      rosterHtml(0, { commented: true }),
      team(0),
      '2026-07-12T18:00:00.000Z',
    )

    expect(rows).toHaveLength(20)
    expect(rows.filter((row) => row.is_active)).toHaveLength(10)
    expect(rows.filter((row) => row.is_dl)).toHaveLength(5)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        source_player_key: 'p000000',
        bbref_id: 'p000000',
        mlbam_id: null,
        team_id: 'ARI',
        position: 'P',
        is_active: true,
        is_dl: false,
        is_active_source: 'Y',
        is_dl_source: null,
        age: 20,
        bats: 'R',
        throws: 'R',
        known_at: '2026-07-12T18:00:00.000Z',
      }),
    )
  })

  it('preserves MLBAM-only redirect identities until Baseball-Reference assigns a slug', () => {
    const html = rosterHtml(0)
      .replace(
        'data-append-csv="p000000"',
        'data-append-csv="redirect.fcgi?player=1&amp;mlb_ID=691009"',
      )
      .replace(
        'href="/players/p/p000000.shtml"',
        'href="/redirect.fcgi?player=1&amp;mlb_ID=691009"',
      )

    const rows = parseActiveRosterPage(
      html,
      team(),
      '2026-07-12T18:00:00Z',
    )

    expect(rows.find((row) => row.mlbam_id === 691009)).toEqual(
      expect.objectContaining({
        source_player_key: 'redirect.fcgi?player=1&mlb_ID=691009',
        bbref_id: null,
        mlbam_id: 691009,
        player_name: 'Player 0-0',
      }),
    )
  })

  it('preserves non-IL roster statuses without counting them as injured-list rows', () => {
    const rows = parseActiveRosterPage(
      rosterHtml(0).replace('>10-day', '>Bereavement'),
      team(),
      '2026-07-12T18:00:00Z',
    )

    expect(rows.find((row) => row.bbref_id === 'p000002')).toEqual(
      expect.objectContaining({
        is_active: false,
        is_dl: false,
        is_dl_source: 'Bereavement',
      }),
    )
  })

  it('rejects missing tables, malformed player IDs, and contradictory statuses', () => {
    expect(() =>
      parseActiveRosterPage('<html></html>', team(), '2026-07-12T18:00:00Z'),
    ).toThrow('missing table#the40man')
    expect(() =>
      parseActiveRosterPage(
        rosterHtml(0).replace('data-append-csv="p000000"', 'data-append-csv="bad"'),
        team(),
        '2026-07-12T18:00:00Z',
      ),
    ).toThrow('invalid Baseball-Reference player key')
    expect(() =>
      parseActiveRosterPage(
        rosterHtml(0).replace(
          '<td data-stat="is_dl" class="iz">',
          '<td data-stat="is_dl">10-day',
        ),
        team(),
        '2026-07-12T18:00:00Z',
      ),
    ).toThrow('both active and on the injured list')
  })
})

describe('Baseball-Reference active-roster acquisition', () => {
  it('is resumable, serialized, locked, and reconciles IDs to the WAR corpus', async () => {
    const root = await projectRoot()
    const warRows = TEAM_IDS.flatMap((_, teamIndex) =>
      Array.from({ length: 20 }, (_, playerIndex) => ({
        bbref_id: playerId(teamIndex, playerIndex),
      })),
    ).slice(0, -1)
    await mkdir(
      path.join(root, 'data/processed/baseball-reference-mlb-war'),
      { recursive: true },
    )
    await writeFile(
      path.join(root, 'data/processed/baseball-reference-mlb-war/player_seasons.json'),
      `${JSON.stringify(warRows)}\n`,
    )
    const requested: string[] = []
    const slept: number[] = []
    let milliseconds = Date.parse('2026-07-12T18:00:00.000Z')
    const now = () => new Date(milliseconds)
    const sleep = async (duration: number) => {
      slept.push(duration)
      milliseconds += duration
    }
    const fetchImpl = (async (url: string | URL | Request) => {
      const value = String(url)
      requested.push(value)
      const rosterMatch = /\/teams\/([A-Z0-9]{2,3})\/2026-roster\.shtml$/.exec(value)
      const body = rosterMatch
        ? rosterHtml(TEAM_IDS.indexOf(rosterMatch[1]))
        : discoveryHtml()
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }) as typeof fetch

    const first = await runBackfill({
      rootDir: root,
      execute: true,
      maxPages: 2,
      fetchImpl,
      now,
      sleep,
      log: () => undefined,
    })
    expect(first).toEqual(expect.objectContaining({
      status: 'partial',
      completedPages: 2,
      attemptedPages: 2,
      liveRequests: 2,
    }))

    const second = await runBackfill({
      rootDir: root,
      execute: true,
      maxPages: 30,
      fetchImpl,
      now,
      sleep,
      log: () => undefined,
    })

    expect(second).toEqual(expect.objectContaining({
      status: 'complete',
      completedPages: 31,
      attemptedPages: 29,
      liveRequests: 29,
      teamCount: 30,
      rosterRows: 600,
      activeRows: 300,
      injuredListRows: 150,
      unmatchedWarIds: ['p290019'],
      outputPath: 'data/processed/baseball-reference-rosters/2026/active_roster.json',
      manifestPath: 'data/processed/baseball-reference-rosters/2026/manifest.json',
      referenceLockPath: 'data/reference-locks/baseball-reference-rosters-2026.json',
    }))
    expect(requested).toHaveLength(31)
    expect(slept).toHaveLength(30)
    expect(slept.every((duration) => duration === CRAWL_DELAY_MS)).toBe(true)

    const output = JSON.parse(
      await readFile(
        path.join(root, 'data/processed/baseball-reference-rosters/2026/active_roster.json'),
        'utf8',
      ),
    ) as unknown[]
    const manifest = JSON.parse(
      await readFile(
        path.join(root, 'data/processed/baseball-reference-rosters/2026/manifest.json'),
        'utf8',
      ),
    ) as { coverage: Record<string, unknown>; identity_reconciliation: Record<string, unknown> }
    expect(output).toHaveLength(600)
    expect(manifest.coverage).toEqual(expect.objectContaining({
      team_count: 30,
      roster_rows: 600,
      active_rows: 300,
      injured_list_rows: 150,
      complete: true,
    }))
    expect(manifest.identity_reconciliation).toEqual(expect.objectContaining({
      available: true,
      matched_roster_player_count: 599,
      unmatched_roster_player_ids: ['p290019'],
    }))
  })

  it('refuses to overlap a Baseball-Reference WAR acquisition', async () => {
    const root = await projectRoot()
    await mkdir(path.join(root, 'data/raw/baseball-reference-mlb-war'), {
      recursive: true,
    })
    await writeFile(
      path.join(root, 'data/raw/baseball-reference-mlb-war/.acquisition.lock'),
      '123\n',
    )

    await expect(acquireAcquisitionLock(root)).rejects.toThrow(
      'Another Baseball-Reference acquisition is running',
    )
  })

  it('defaults to a dry run and validates max-pages', () => {
    expect(parseCliArguments([])).toEqual(expect.objectContaining({
      execute: false,
      maxPages: 31,
    }))
    expect(() => parseCliArguments(['--max-pages=32'])).toThrow(
      'max-pages must be an integer from 1 to 31',
    )
  })
})
