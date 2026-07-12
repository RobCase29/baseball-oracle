import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CRAWL_DELAY_MS,
  MAX_RETRY_AFTER_MS,
  PARSER_VERSION,
  acquireAcquisitionLock,
  normalizePlayerTeamSeasons,
  parseAffiliatePage,
  parseCliArguments,
  parseTeamPage,
  requestFingerprint,
  retryAfterMilliseconds,
  runBackfill,
} from './sports-reference-register.js'

const TEAM_ID = '0080f66c'

const affiliateHtml = `<!doctype html><html><body>
  <table id="affiliates"><tbody><tr>
    <th data-stat="franch_name"><a href="/register/affiliate.cgi?id=CHC&year=2017">Chicago Cubs</a></th>
    <td data-stat="teams">1</td>
    <td data-stat="AAA"><a href="/register/team.cgi?id=${TEAM_ID}" data-tip="Iowa Cubs, PCL">Iowa</a></td>
  </tr></tbody></table>
</body></html>`

const teamHtml = `<!doctype html><html><body>
  <div id="meta"><h1><span>2017</span><span>Iowa Cubs</span></h1>
    <p><strong>Classification</strong>: AAA</p>
    <p><strong>League</strong>: <a>Pacific Coast League</a> (American Northern)</p>
    <p><strong>Affiliation</strong>: <a>Chicago Cubs</a> (NL)</p>
  </div>
  <table id="standard_roster"><tbody><tr>
    <th data-stat="player"><a href="/register/player.fcgi?id=ramir-001jos">José Ramírez</a></th>
    <td data-stat="bats">S</td><td data-stat="throws">R</td>
    <td data-stat="height" csk="69">5' 9&quot;</td><td data-stat="weight">190</td>
    <td data-stat="date_of_birth" csk="1992-09-17">Sep 17, 1992</td>
    <td data-stat="dateFirst">2017-04-06</td><td data-stat="dateLast">2017-09-04</td>
  </tr></tbody></table>
  <!-- <table id="team_batting"><tbody><tr>
    <th data-stat="player"><a href="/register/player.fcgi?id=ramir-001jos">José Ramírez</a></th>
    <td data-stat="G">120</td><td data-stat="PA">500</td><td data-stat="AB">450</td>
    <td data-stat="HR">20</td><td data-stat="BB">45</td><td data-stat="SO">80</td>
  </tr></tbody></table> -->
  <table id="team_pitching"><tbody><tr>
    <th data-stat="player"><a href="/register/player.fcgi?id=pitch-001pat">Pat Pitcher</a></th>
    <td data-stat="G">24</td><td data-stat="IP">130.1</td><td data-stat="SO">140</td>
  </tr></tbody></table>
  <table id="team_fielding_SS"><tbody><tr>
    <th data-stat="player"><a href="/register/player.fcgi?id=ramir-001jos">José Ramírez</a></th>
    <td data-stat="G">100</td><td data-stat="Inn_def">850.0</td>
  </tr></tbody></table>
  <table id="team_fielding_P"><tbody><tr>
    <th data-stat="player"><a href="/register/player.fcgi?id=pitch-001pat">Pat Pitcher</a></th>
    <td data-stat="G">24</td><td data-stat="Inn_def">130.1</td>
  </tr></tbody></table>
</body></html>`

const noRecordTeamHtml = `<!doctype html><html><body>
  <div id="meta"><h1><span>2017</span><span>Iowa Cubs</span></h1>
    <p><strong>Classification</strong>: AAA</p>
    <p><strong>League</strong>: <a>Pacific Coast League</a> (American Northern)</p>
    <p><strong>Affiliation</strong>: <a>Chicago Cubs</a> (NL)</p>
    <p><strong>Record</strong>: N/A</p>
  </div>
</body></html>`

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'baseball-oracle-bref-'))
  temporaryDirectories.push(root)
  const permissions = path.join(root, 'docs/permissions')
  await mkdir(permissions, { recursive: true })
  await writeFile(
    path.join(permissions, 'RESEARCH_SOURCE_ATTESTATIONS.md'),
    '# Test permission evidence\n',
  )
  return root
}

function discovery() {
  return parseAffiliatePage(affiliateHtml, 2017).teams[0]
}

describe('Baseball-Reference Register parser', () => {
  it('discovers deterministic team units and reconciles the declared count', () => {
    const parsed = parseAffiliatePage(affiliateHtml, 2017)

    expect(parsed.declaredTeamCount).toBe(1)
    expect(parsed.teams).toEqual([
      expect.objectContaining({
        teamId: TEAM_ID,
        teamName: 'Iowa Cubs',
        organization: 'Chicago Cubs',
        organizationId: 'CHC',
        level: 'AAA',
        leagueAbbreviation: 'PCL',
      }),
    ])
  })

  it('preserves every organization for a cooperative affiliate', () => {
    const cooperativeHtml = affiliateHtml.replace(
      '</tbody></table>',
      `<tr>
        <th data-stat="franch_name"><a href="/register/affiliate.cgi?id=MIL&year=2017">Milwaukee Brewers</a></th>
        <td data-stat="teams">1</td>
        <td data-stat="AAA"><a href="/register/team.cgi?id=${TEAM_ID}" data-tip="Iowa Cubs, PCL">Iowa</a></td>
      </tr></tbody></table>`,
    )

    const parsed = parseAffiliatePage(cooperativeHtml, 2017)

    expect(parsed.declaredTeamCount).toBe(1)
    expect(parsed.affiliateSlotCount).toBe(2)
    expect(parsed.teams[0].organizations).toEqual([
      { name: 'Chicago Cubs', id: 'CHC' },
      { name: 'Milwaukee Brewers', id: 'MIL' },
    ])
    expect(parsed.teams[0].organization).toBe(
      'Chicago Cubs | Milwaukee Brewers',
    )
    expect(
      parsed.teams.reduce((sum, team) => sum + team.organizations.length, 0),
    ).toBe(parsed.affiliateSlotCount)
  })

  it('rejects affiliate team links with missing or malformed Register IDs', () => {
    expect(() =>
      parseAffiliatePage(
        affiliateHtml.replace(`team.cgi?id=${TEAM_ID}`, 'team.cgi'),
        2017,
      ),
    ).toThrow('invalid Register team ID or URL')
    expect(() =>
      parseAffiliatePage(
        affiliateHtml.replace(TEAM_ID, 'not-an-id'),
        2017,
      ),
    ).toThrow('invalid Register team ID or URL')
  })

  it('requires declared affiliate slots to match parsed team relationships', () => {
    expect(() =>
      parseAffiliatePage(
        affiliateHtml.replace('<td data-stat="teams">1</td>', '<td data-stat="teams">2</td>'),
        2017,
      ),
    ).toThrow('declares 2 teams but contains 1 team links')
  })

  it('uses structured parsing for visible and comment-wrapped stat tables', () => {
    const page = parseTeamPage(teamHtml, discovery(), 2017)
    const players = normalizePlayerTeamSeasons(page)

    expect(page.team.activityStatus).toBe('observed')
    expect(page.batting).toHaveLength(1)
    expect(page.pitching).toHaveLength(1)
    expect(page.fielding).toHaveLength(2)
    expect(players).toEqual([
      expect.objectContaining({
        source_player_id: 'pitch-001pat',
        role: 'pitcher',
        position: 'P',
        pitching_IP: '130.1',
      }),
      expect.objectContaining({
        source_player_id: 'ramir-001jos',
        player_name: 'José Ramírez',
        role: 'hitter',
        position: 'SS',
        height_inches: '69',
        batting_PA: '500',
      }),
    ])
  })

  it('reconciles an explicit Record: N/A page without inventing participants', () => {
    const page = parseTeamPage(noRecordTeamHtml, discovery(), 2017)

    expect(page.team.activityStatus).toBe('declared_no_record')
    expect(page.roster).toEqual([])
    expect(page.batting).toEqual([])
    expect(page.pitching).toEqual([])
    expect(page.fielding).toEqual([])
    expect(normalizePlayerTeamSeasons(page)).toEqual([])
  })

  it('rejects partial tables and unlabeled all-table loss', () => {
    expect(() =>
      parseTeamPage(
        noRecordTeamHtml.replace(
          '</body>',
          '<table id="team_pitching"><tbody></tbody></table></body>',
        ),
        discovery(),
        2017,
      ),
    ).toThrow('missing required tables: standard_roster, team_batting')

    expect(() =>
      parseTeamPage(
        noRecordTeamHtml.replace(
          '</body>',
          '<table id="team_fielding_P"><tbody></tbody></table></body>',
        ),
        discovery(),
        2017,
      ),
    ).toThrow(
      'missing required tables: standard_roster, team_batting, team_pitching',
    )

    expect(() =>
      parseTeamPage(
        noRecordTeamHtml.replace(
          '<p><strong>Record</strong>: N/A</p>',
          '<p><strong>Record</strong>: 0-0</p>',
        ),
        discovery(),
        2017,
      ),
    ).toThrow(
      'missing required tables: standard_roster, team_batting, team_pitching',
    )
  })

  it('rejects every non-header player row without one accepted Register ID', () => {
    expect(() =>
      parseTeamPage(
        teamHtml.replace(
          '/register/player.fcgi?id=ramir-001jos',
          '/register/player.fcgi',
        ),
        discovery(),
        2017,
      ),
    ).toThrow('invalid Register player ID: missing')
    expect(() =>
      parseTeamPage(
        teamHtml.replace('ramir-001jos', 'bad-id'),
        discovery(),
        2017,
      ),
    ).toThrow('invalid Register player ID: bad-id')
    expect(() =>
      parseTeamPage(
        teamHtml.replace('data-stat="player"', 'data-stat="unexpected"'),
        discovery(),
        2017,
      ),
    ).toThrow('non-header data row without a player cell')
  })

  it('accepts legitimate 11-character IDs and rejects shorter or longer IDs', () => {
    const elevenCharacterPage = parseTeamPage(
      teamHtml.replaceAll('ramir-001jos', 'deal--000jo'),
      discovery(),
      2017,
    )
    expect(elevenCharacterPage.roster[0].source_player_id).toBe('deal--000jo')
    expect(elevenCharacterPage.batting[0].source_player_id).toBe('deal--000jo')

    for (const invalidId of ['abc-123456', 'abcde12345678']) {
      expect(() =>
        parseTeamPage(
          teamHtml.replaceAll('ramir-001jos', invalidId),
          discovery(),
          2017,
        ),
      ).toThrow(`invalid Register player ID: ${invalidId}`)
    }
  })

  it('treats 2020 as a structural zero-team season', () => {
    expect(parseAffiliatePage('<html></html>', 2020)).toEqual({
      season: 2020,
      teams: [],
      declaredTeamCount: 0,
      affiliateSlotCount: 0,
    })
  })
})

describe('bounded resumable backfill', () => {
  it('enforces one live acquisition process per project root', async () => {
    const rootDir = await projectRoot()
    const release = await acquireAcquisitionLock(rootDir)

    await expect(acquireAcquisitionLock(rootDir)).rejects.toThrow(
      'Another Baseball-Reference acquisition is running',
    )
    await release()
    const releaseAgain = await acquireAcquisitionLock(rootDir)
    await releaseAgain()
  })

  it('is dry by default and bounds the season/team arguments', () => {
    expect(parseCliArguments([])).toEqual({ season: 2017, maxTeams: 1, execute: false })
    expect(parseCliArguments(['--season=2019', '--max-teams=3', '--execute'])).toEqual({
      season: 2019,
      maxTeams: 3,
      execute: true,
    })
    expect(() => parseCliArguments(['--max-teams=0'])).toThrow('integer from 1')
    expect(() => parseCliArguments(['--max-teams=251'])).toThrow('integer from 1')
  })

  it('honors Retry-After delta seconds and HTTP dates', () => {
    const now = new Date('2026-07-11T20:00:00.000Z')

    expect(retryAfterMilliseconds('10', now)).toBe(10_000)
    expect(
      retryAfterMilliseconds('Sat, 11 Jul 2026 20:00:30 GMT', now),
    ).toBe(30_000)
    expect(retryAfterMilliseconds('invalid', now)).toBe(0)
    expect(MAX_RETRY_AFTER_MS).toBeGreaterThan(30_000)
  })

  it('does not promote an HTTP-200 challenge page into the immutable cache', async () => {
    const rootDir = await projectRoot()
    let calls = 0

    await expect(
      runBackfill({
        rootDir,
        season: 2017,
        maxTeams: 1,
        execute: true,
        fetchImpl: async () => {
          calls += 1
          return new Response('<html><title>Challenge</title></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        },
        sleep: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow('missing table#affiliates')
    expect(calls).toBe(3)
    const payloadPath = path.join(
      rootDir,
      'data/raw/baseball-reference-register/2017/requests',
      requestFingerprint(
        'https://www.baseball-reference.com/register/affiliate.cgi?year=2017',
      ),
      'payload.html',
    )
    await expect(access(payloadPath)).rejects.toThrow()
  })

  it('quarantines a structurally invalid player page before cache promotion', async () => {
    const rootDir = await projectRoot()
    const invalidTeamHtml = teamHtml.replace(
      '/register/player.fcgi?id=ramir-001jos',
      '/register/player.fcgi',
    )
    const responses = [affiliateHtml, invalidTeamHtml]
    let calls = 0

    await expect(
      runBackfill({
        rootDir,
        season: 2017,
        maxTeams: 1,
        execute: true,
        fetchImpl: async () =>
          new Response(responses[calls++], {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        sleep: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow('invalid Register player ID: missing')

    expect(calls).toBe(2)
    const teamPayload = path.join(
      rootDir,
      'data/raw/baseball-reference-register/2017/requests',
      requestFingerprint(discovery().url),
      'payload.html',
    )
    await expect(access(teamPayload)).rejects.toThrow()
    const state = JSON.parse(
      await readFile(
        path.join(rootDir, 'data/raw/baseball-reference-register/2017/state.json'),
        'utf8',
      ),
    ) as { teams: Array<{ status: string; lastError: string }> }
    expect(state.teams[0]).toMatchObject({
      status: 'failed',
      lastError: expect.stringContaining('invalid Register player ID: missing'),
    })
  })

  it('rejects redirects instead of relabeling another endpoint', async () => {
    const rootDir = await projectRoot()
    let calls = 0

    await expect(
      runBackfill({
        rootDir,
        season: 2017,
        maxTeams: 1,
        execute: true,
        fetchImpl: async () => {
          calls += 1
          return new Response('', {
            status: 302,
            headers: {
              location:
                'https://www.baseball-reference.com/register/affiliate.cgi?year=2018',
            },
          })
        },
        sleep: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow('HTTP 302')
    expect(calls).toBe(1)
  })

  it('waits for Retry-After before retrying a throttled request', async () => {
    const rootDir = await projectRoot()
    const bodies = [affiliateHtml, teamHtml]
    let successfulResponses = 0
    let calls = 0
    let currentMs = Date.parse('2026-07-11T20:00:00.000Z')
    const sleeps: number[] = []

    const result = await runBackfill({
      rootDir,
      season: 2017,
      maxTeams: 1,
      execute: true,
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) {
          return new Response('slow down', {
            status: 429,
            headers: { 'retry-after': '10' },
          })
        }
        const body = bodies[successfulResponses]
        successfulResponses += 1
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      },
      now: () => new Date(currentMs),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        currentMs += milliseconds
      },
      log: () => undefined,
    })

    expect(result.status).toBe('complete')
    expect(calls).toBe(3)
    expect(sleeps).toContain(10_000)
  })

  it('preserves exact bytes, throttles one worker, writes manifests, and resumes', async () => {
    const rootDir = await projectRoot()
    const bodies = [affiliateHtml, teamHtml]
    let fetchCalls = 0
    let currentMs = Date.parse('2026-07-11T20:00:00.000Z')
    const sleeps: number[] = []
    const fetchImpl: typeof fetch = async () => {
      const body = bodies[fetchCalls]
      fetchCalls += 1
      if (!body) throw new Error('unexpected network request')
      return new Response(new TextEncoder().encode(body), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    const now = () => new Date(currentMs)
    const sleep = async (milliseconds: number) => {
      sleeps.push(milliseconds)
      currentMs += milliseconds
    }

    const first = await runBackfill({
      rootDir,
      season: 2017,
      maxTeams: 1,
      execute: true,
      fetchImpl,
      now,
      sleep,
      log: () => undefined,
    })

    expect(first.status).toBe('complete')
    expect(fetchCalls).toBe(2)
    expect(sleeps).toContain(CRAWL_DELAY_MS)
    const fingerprint = requestFingerprint(discovery().url)
    const payloadPath = path.join(
      rootDir,
      'data/raw/baseball-reference-register/2017/requests',
      fingerprint,
      'payload.html',
    )
    const payload = await readFile(payloadPath)
    expect(payload.equals(Buffer.from(teamHtml))).toBe(true)
    const requestManifestPath = path.join(path.dirname(payloadPath), 'manifest.json')
    const requestManifest = JSON.parse(
      await readFile(requestManifestPath, 'utf8'),
    ) as { sha256: string; byteLength: number; parserVersion: string }
    expect(requestManifest.sha256).toBe(createHash('sha256').update(payload).digest('hex'))
    expect(requestManifest.byteLength).toBe(payload.byteLength)
    expect(requestManifest.parserVersion).toBe(PARSER_VERSION)
    expect(await readFile(path.join(rootDir, 'data/processed/baseball-reference-register/2017/roster.csv'), 'utf8')).toContain('ramir-001jos')
    expect(await readFile(path.join(rootDir, 'data/processed/baseball-reference-register/2017/player_team_seasons.json'), 'utf8')).toContain('pitch-001pat')
    const quality = JSON.parse(
      await readFile(
        path.join(rootDir, 'data/processed/baseball-reference-register/2017/quality.json'),
        'utf8',
      ),
    ) as {
      censusAttested: boolean
      censusAttestationReason: string
      observedTeamCount: number
      appearanceDataTeamCount: number
      declaredNoRecordTeamCount: number
    }
    expect(quality).toMatchObject({
      censusAttested: false,
      observedTeamCount: 1,
      appearanceDataTeamCount: 1,
      declaredNoRecordTeamCount: 0,
      censusAttestationReason:
        'Complete team pages establish a season-appearance population, not a contracted roster census; zero-appearance players may be absent.',
    })

    requestManifest.parserVersion = 'baseball-reference-register/v4'
    await writeFile(requestManifestPath, `${JSON.stringify(requestManifest, null, 2)}\n`)

    const resumed = await runBackfill({
      rootDir,
      season: 2017,
      maxTeams: 1,
      execute: true,
      fetchImpl,
      now,
      sleep,
      log: () => undefined,
    })

    expect(resumed.status).toBe('complete')
    expect(resumed.attemptedTeams).toBe(0)
    expect(fetchCalls).toBe(2)
    const resumedManifest = JSON.parse(
      await readFile(path.join(rootDir, resumed.runManifestPath as string), 'utf8'),
    ) as { inputCount: number; liveRequestCount: number; requests: unknown[] }
    expect(resumedManifest.inputCount).toBe(2)
    expect(resumedManifest.liveRequestCount).toBe(0)
    expect(resumedManifest.requests).toHaveLength(2)
  })

  it('writes explicit no-record team coverage without player rows', async () => {
    const rootDir = await projectRoot()
    const responses = [affiliateHtml, noRecordTeamHtml]
    let calls = 0

    const result = await runBackfill({
      rootDir,
      season: 2017,
      maxTeams: 1,
      execute: true,
      fetchImpl: async () =>
        new Response(responses[calls++], {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      sleep: async () => undefined,
      log: () => undefined,
    })

    expect(result.status).toBe('complete')
    const teams = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          'data/processed/baseball-reference-register/2017/teams.json',
        ),
        'utf8',
      ),
    ) as Array<{ team_id: string; activity_status: string }>
    expect(teams).toEqual([
      expect.objectContaining({
        team_id: TEAM_ID,
        activity_status: 'declared_no_record',
      }),
    ])
    const participants = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          'data/processed/baseball-reference-register/2017/player_team_seasons.json',
        ),
        'utf8',
      ),
    ) as unknown[]
    expect(participants).toEqual([])
    const quality = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          'data/processed/baseball-reference-register/2017/quality.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>
    expect(quality).toMatchObject({
      declaredTeamCount: 1,
      observedTeamCount: 1,
      appearanceDataTeamCount: 0,
      declaredNoRecordTeamCount: 1,
      complete: true,
    })
  })

  it('retries transient responses with backoff and records the successful attempt count', async () => {
    const rootDir = await projectRoot()
    let fetchCalls = 0
    let currentMs = Date.parse('2026-07-11T20:00:00.000Z')
    const sleeps: number[] = []
    const fetchImpl: typeof fetch = async () => {
      fetchCalls += 1
      if (fetchCalls === 1) return new Response('busy', { status: 503 })
      return new Response(fetchCalls === 2 ? affiliateHtml : teamHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }

    await runBackfill({
      rootDir,
      season: 2017,
      maxTeams: 1,
      execute: true,
      fetchImpl,
      now: () => new Date(currentMs),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        currentMs += milliseconds
      },
      log: () => undefined,
    })

    expect(fetchCalls).toBe(3)
    expect(sleeps).toEqual([CRAWL_DELAY_MS, CRAWL_DELAY_MS])
    const fingerprint = requestFingerprint(
      'https://www.baseball-reference.com/register/affiliate.cgi?year=2017',
    )
    const manifest = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          'data/raw/baseball-reference-register/2017/requests',
          fingerprint,
          'manifest.json',
        ),
        'utf8',
      ),
    ) as { attemptCount: number }
    expect(manifest.attemptCount).toBe(2)
  })

  it('materializes the structural 2020 partition without network access', async () => {
    const rootDir = await projectRoot()
    const result = await runBackfill({
      rootDir,
      season: 2020,
      maxTeams: 1,
      execute: true,
      fetchImpl: async () => {
        throw new Error('2020 must not issue a request')
      },
      log: () => undefined,
    })

    expect(result.status).toBe('structural-zero-season')
    const quality = JSON.parse(
      await readFile(
        path.join(rootDir, 'data/processed/baseball-reference-register/2020/quality.json'),
        'utf8',
      ),
    ) as { structuralZeroSeason: boolean; declaredTeamCount: number }
    expect(quality).toMatchObject({ structuralZeroSeason: true, declaredTeamCount: 0 })
  })

  it('rejects a compressed representation when identity encoding was requested', async () => {
    const rootDir = await projectRoot()

    await expect(
      runBackfill({
        rootDir,
        season: 2017,
        maxTeams: 1,
        execute: true,
        fetchImpl: async () =>
          new Response(affiliateHtml, {
            status: 200,
            headers: {
              'content-type': 'text/html',
              'content-encoding': 'gzip',
            },
          }),
        sleep: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow('Unexpected content encoding gzip')
  })
})
