import { describe, expect, it } from 'vitest'
import {
  assertMlbStatsApiMilbRosterCensus,
  buildMlbStatsApiMilbRosterUrl,
  buildMlbStatsApiMilbTeamsUrl,
  composeMlbStatsApiMilbRosterBundle,
  mapWithBoundedConcurrency,
  mlbStatsApiMilbRosterPlayerType,
  parseMlbStatsApiMilbRosterEnvelope,
  parseMlbStatsApiMilbTeamsEnvelope,
  quarantineStaleOrganizationMemberships,
  type CapturedMlbStatsApiResponse,
  type FetchedMlbStatsApiMilbRosterCensus,
  type MlbStatsApiMilbRosterEntry,
  type MlbStatsApiMilbRosterResponse,
  type MlbStatsApiMilbRosterTeam,
} from './mlb-statsapi-milb-roster.js'
import { sha256 } from './shared.js'

function team(
  id: number,
  sportId: number,
  organizationId = 100 + (id % 30),
): MlbStatsApiMilbRosterTeam {
  return {
    id,
    name: `Affiliate ${id}`,
    active: true,
    parentOrgId: organizationId,
    parentOrgName: `Organization ${organizationId}`,
    sport: { id: sportId },
    league: { name: `League ${sportId}`, abbreviation: `L${sportId}` },
  }
}

function entry(
  id: number,
  parentTeamId: number,
  options: { primaryType?: string; currentTeamId?: number; status?: string } = {},
): MlbStatsApiMilbRosterEntry {
  const primaryType = options.primaryType ?? (id % 2 === 0 ? 'Pitcher' : 'Infielder')
  return {
    person: {
      id,
      fullName: `Player ${id}`,
      active: true,
      currentAge: 20,
      primaryPosition: {
        abbreviation: primaryType === 'Pitcher' ? 'P' : primaryType === 'Two-Way Player' ? 'TWP' : 'SS',
        name: primaryType,
        type: primaryType,
      },
      batSide: { code: 'R' },
      pitchHand: { code: 'R' },
      currentTeam: options.currentTeamId === undefined
        ? undefined
        : { id: options.currentTeamId, name: `Affiliate ${options.currentTeamId}` },
    },
    position: {
      abbreviation: primaryType === 'Pitcher' ? 'P' : 'SS',
      type: primaryType,
    },
    status: { code: 'A', description: options.status ?? 'Active' },
    parentTeamId,
  }
}

function rosterBody(
  sourceTeam: MlbStatsApiMilbRosterTeam,
  roster: unknown[],
  teamId = sourceTeam.id,
): string {
  return JSON.stringify({
    copyright: 'MLB Advanced Media',
    rosterType: 'fullRoster',
    teamId,
    roster,
  })
}

function captured(url: string, bodyText: string): CapturedMlbStatsApiResponse {
  return {
    url,
    statusCode: 200,
    mediaType: 'application/json',
    contentEncoding: null,
    etag: null,
    lastModified: null,
    headers: { 'content-type': 'application/json' },
    bodyText,
    bodySha256: sha256(bodyText),
    byteLength: Buffer.byteLength(bodyText, 'utf8'),
  }
}

function response(
  sourceTeam: MlbStatsApiMilbRosterTeam,
  membershipKind: 'affiliate' | 'parent_census',
  roster: MlbStatsApiMilbRosterEntry[],
  quarantinedRows = 0,
): MlbStatsApiMilbRosterResponse {
  const bodyText = rosterBody(sourceTeam, roster)
  return {
    team: sourceTeam,
    membershipKind,
    response: captured(`https://example.test/teams/${sourceTeam.id}/roster`, bodyText),
    roster,
    reportedRows: roster.length + quarantinedRows,
    quarantinedRows,
  }
}

function completeSyntheticCensus() {
  const teams: MlbStatsApiMilbRosterTeam[] = []
  let teamId = 1_000
  for (const sportId of [11, 12, 13, 14]) {
    for (let index = 0; index < 30; index += 1) {
      teams.push(team(teamId, sportId, 101 + index))
      teamId += 1
    }
  }
  for (let index = 0; index < 60; index += 1) {
    teams.push(team(teamId, 16, 101 + (index % 30)))
    teamId += 1
  }
  const teamEnvelope = parseMlbStatsApiMilbTeamsEnvelope(JSON.stringify({ teams }))
  let playerId = 700_000
  const affiliateResponses = teams.map((sourceTeam) => {
    const roster = Array.from({ length: 34 }, () => {
      playerId += 1
      return entry(playerId, sourceTeam.parentOrgId, { currentTeamId: sourceTeam.id })
    })
    return response(sourceTeam, 'affiliate', roster)
  })
  const organizations = [...new Map(
    teams.map((sourceTeam) => [sourceTeam.parentOrgId, sourceTeam.parentOrgName]),
  )]
  const parentResponses = organizations.map(([id, name]) => {
    const parentTeam = team(id, 1, id)
    parentTeam.name = name
    parentTeam.parentOrgName = name
    const roster = Array.from({ length: 220 }, () => {
      playerId += 1
      return entry(playerId, id)
    })
    return response(parentTeam, 'parent_census', roster)
  })
  return { teamEnvelope, affiliateResponses, parentResponses }
}

describe('MLB StatsAPI full MiLB roster census', () => {
  it('builds the official all-level team request and full-roster request', () => {
    const teamsUrl = new URL(buildMlbStatsApiMilbTeamsUrl(2026))
    expect(teamsUrl.pathname).toBe('/api/v1/teams')
    expect(teamsUrl.searchParams.get('sportIds')).toBe('11,12,13,14,16')
    expect(teamsUrl.searchParams.get('season')).toBe('2026')

    const rosterUrl = new URL(buildMlbStatsApiMilbRosterUrl(512, 2026))
    expect(rosterUrl.pathname).toBe('/api/v1/teams/512/roster')
    expect(rosterUrl.searchParams.get('rosterType')).toBe('fullRoster')
    expect(rosterUrl.searchParams.get('hydrate')).toContain('primaryPosition')
  })

  it('keeps zero-stat players and maps primary two-way players to Hitter', () => {
    const sourceTeam = team(512, 11, 116)
    const twoWay = entry(808_124, 116, { primaryType: 'Two-Way Player' })
    const pitcher = entry(701_552, 116, { primaryType: 'Pitcher' })
    const parsed = parseMlbStatsApiMilbRosterEnvelope(
      rosterBody(sourceTeam, [twoWay, pitcher]),
      sourceTeam,
    )

    expect(parsed.roster).toHaveLength(2)
    expect(parsed.roster[0]).not.toHaveProperty('stat')
    expect(mlbStatsApiMilbRosterPlayerType(parsed.roster[0])).toBe('Hitter')
    expect(mlbStatsApiMilbRosterPlayerType(parsed.roster[1])).toBe('Pitcher')
  })

  it('quarantines invalid placeholders, duplicate IDs, and conflicting parents', () => {
    const sourceTeam = team(512, 11, 116)
    const valid = entry(701_552, 116)
    const conflicting = entry(701_553, 117)
    const parsed = parseMlbStatsApiMilbRosterEnvelope(
      rosterBody(sourceTeam, [valid, valid, conflicting, { person: { id: 0 } }]),
      sourceTeam,
    )

    expect(parsed.roster.map((item) => item.person.id)).toEqual([701_552])
    expect(parsed.reportedRows).toBe(4)
    expect(parsed.quarantinedRows).toBe(3)
    expect(() =>
      parseMlbStatsApiMilbRosterEnvelope(rosterBody(sourceTeam, [valid], 999), sourceTeam),
    ).toThrow(/identified itself as team 999/u)
  })

  it('quarantines stale old-organization rows while retaining current evidence', () => {
    const currentAffiliate = team(512, 11, 116)
    const oldParent = team(118, 1, 118)
    const movedPlayer = entry(701_552, 118, { currentTeamId: 512 })
    const stale = response(oldParent, 'parent_census', [movedPlayer])
    const filtered = quarantineStaleOrganizationMemberships(
      stale,
      new Map([[currentAffiliate.id, currentAffiliate]]),
      new Set([116, 118]),
    )

    expect(filtered.roster).toHaveLength(0)
    expect(filtered.reportedRows).toBe(1)
    expect(filtered.quarantinedRows).toBe(1)
  })

  it('requires every dynamically discovered affiliate and parent roster', () => {
    const { teamEnvelope, affiliateResponses, parentResponses } = completeSyntheticCensus()
    const quality = assertMlbStatsApiMilbRosterCensus(
      teamEnvelope,
      [...affiliateResponses, ...parentResponses],
    )

    expect(quality).toMatchObject({
      teams: 180,
      organizations: 30,
      parentRosters: 30,
      affiliateRosterRows: 6_120,
      parentRosterRows: 6_600,
      rosterRows: 12_720,
      uniquePlayers: 12_720,
      minimumTeamRows: 34,
      minimumParentTeamRows: 220,
      quarantinedRows: 0,
    })
    expect(() =>
      assertMlbStatsApiMilbRosterCensus(
        teamEnvelope,
        [...affiliateResponses.slice(1), ...parentResponses],
      ),
    ).toThrow(/179 unique team rosters for 180 indexed teams/u)
    expect(() =>
      assertMlbStatsApiMilbRosterCensus(
        teamEnvelope,
        [...affiliateResponses, ...parentResponses.slice(1)],
      ),
    ).toThrow(/29 unique parent organization rosters for 30 discovered organizations/u)
  })

  it('rejects a large quarantine or cardinality collapse', () => {
    const { teamEnvelope, affiliateResponses, parentResponses } = completeSyntheticCensus()
    const quarantined = [...affiliateResponses, ...parentResponses]
    quarantined[0] = { ...quarantined[0], reportedRows: 134, quarantinedRows: 100 }
    expect(() =>
      assertMlbStatsApiMilbRosterCensus(teamEnvelope, quarantined),
    ).toThrow(/maximum allowed/u)
    expect(() =>
      assertMlbStatsApiMilbRosterCensus(
        teamEnvelope,
        [...affiliateResponses, ...parentResponses],
        { teams: 240, rosterRows: 16_000, uniquePlayers: 16_000 },
      ),
    ).toThrow(/expected at least 192 after 240 previously/u)
  })

  it('bounds concurrent roster requests', async () => {
    let active = 0
    let maximumActive = 0
    const result = await mapWithBoundedConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      4,
      async (value) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active -= 1
        return value * 2
      },
    )

    expect(maximumActive).toBe(4)
    expect(result).toEqual(Array.from({ length: 20 }, (_, index) => index * 2))
  })

  it('stores exact source texts and resolves parent-only affiliate assignment explicitly', () => {
    const affiliate = team(512, 11, 116)
    const parent = team(116, 1, 116)
    parent.name = 'Detroit Tigers'
    parent.parentOrgName = 'Detroit Tigers'
    const affiliateBody = rosterBody(affiliate, [entry(701_552, 116, { currentTeamId: 512 })])
    const parentBody = rosterBody(parent, [entry(808_124, 116, { currentTeamId: 512 })])
    const teamIndexBody = JSON.stringify({ teams: [affiliate] })
    const census = {
      season: 2026,
      teamIndex: captured('https://example.test/teams', teamIndexBody),
      teams: [affiliate],
      rosterResponses: [
        response(affiliate, 'affiliate', [entry(701_552, 116, { currentTeamId: 512 })]),
        {
          ...response(parent, 'parent_census', [entry(808_124, 116, { currentTeamId: 512 })]),
          response: captured('https://example.test/teams/116/roster', parentBody),
        },
      ],
      quality: {} as FetchedMlbStatsApiMilbRosterCensus['quality'],
    } satisfies FetchedMlbStatsApiMilbRosterCensus
    census.rosterResponses[0].response = captured(
      'https://example.test/teams/512/roster',
      affiliateBody,
    )

    const bundle = composeMlbStatsApiMilbRosterBundle(census)
    const rawBundle = JSON.parse(bundle.bodyText)
    expect(rawBundle.teamIndex.bodyText).toBe(teamIndexBody)
    expect(rawBundle.rosterResponses[0].response.bodyText).toBe(affiliateBody)
    expect(rawBundle.rosterResponses[1].response.bodyText).toBe(parentBody)
    expect(bundle.responseHash).toBe(sha256(bundle.bodyText))
    expect(bundle.records[1].record).toMatchObject({
      membershipKind: 'parent_census',
      organization: { id: 116, name: 'Detroit Tigers' },
      assignmentTeam: { id: 512, name: 'Affiliate 512' },
    })
  })
})
