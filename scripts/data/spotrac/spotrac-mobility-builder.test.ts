import { describe, expect, it } from 'vitest'
import type {
  PlayerMobilityArtifact,
  PlayerMobilityArtifactRow,
  PlayerMobilityLeague,
  PlayerMobilitySource,
} from '../../../src/domain/playerMobilityContext.js'
import {
  isPlayerMobilityArtifact,
} from '../../../src/domain/playerMobilityContext.js'
import {
  SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
  type SpotracParsedContractList,
} from './spotrac-contract-list-parser.js'
import {
  buildSpotracMobilityArtifact,
  type HobbyIdentityRow,
  type HobbyMobilityIdentityEvidence,
  type SpotracSourceChainInput,
  spotracAcquisitionPlan,
} from './spotrac-mobility-builder.js'

const minimumRows: Readonly<Record<PlayerMobilityLeague, number>> = {
  MLB: 20,
  NFL: 60,
  NBA: 10,
  NHL: 15,
}

function parsedLists(): SpotracParsedContractList[] {
  return spotracAcquisitionPlan().map((unit, unitIndex) => {
    const rows = Array.from(
      { length: minimumRows[unit.league] },
      (_, rowIndex) => {
        const playerId = String(8_000_000 + unitIndex * 100 + rowIndex)
        return {
          playerId,
          playerName:
            `Coverage Sentinel ${unit.league} ` +
            `${unit.sourceTeamCode} ${rowIndex}`,
          playerUrl:
            `https://www.spotrac.com/${unit.leagueSlug}/player/_/id/` +
            `${playerId}/coverage-sentinel-${rowIndex}`,
          position: 'P',
          sourceTeamCode: unit.sourceTeamCode,
          sourceStartYear: 2026,
          sourceEndYear: 2026,
          reportedYears: 1,
        }
      },
    )
    return {
      parserVersion: SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
      sourceUrl: unit.url,
      leagueSlug: unit.leagueSlug,
      league: unit.league,
      sourceTeamSlug: unit.sourceTeamSlug,
      sourceTeamCode: unit.sourceTeamCode,
      sourceTeamLabel: unit.canonicalTeam.name,
      rows,
      withheldRows: [],
    }
  })
}

function addPlayer(
  lists: SpotracParsedContractList[],
  input: {
    league: PlayerMobilityLeague
    teamCode: string
    id: string
    name: string
    start: number
    end: number
  },
): void {
  const list = lists.find((candidate) => (
    candidate.league === input.league &&
    candidate.sourceTeamCode === input.teamCode
  ))
  if (!list) throw new Error('Missing test team list')
  list.rows.push({
    playerId: input.id,
    playerName: input.name,
    playerUrl:
      `https://www.spotrac.com/${list.leagueSlug}/player/_/id/` +
      `${input.id}/${input.name.toLocaleLowerCase('en-US').replaceAll(' ', '-')}`,
    position: 'P',
    sourceTeamCode: input.teamCode,
    sourceStartYear: input.start,
    sourceEndYear: input.end,
    reportedYears: input.end - input.start + 1,
  })
}

function hobby(
  domain: HobbyIdentityRow['domain'],
  subjectName: string,
): HobbyIdentityRow {
  return {
    sourceKey: `athlete|${domain}|${subjectName}`,
    subjectName,
    subjectType: 'athlete',
    domain,
  }
}

function evidence(
  row: HobbyIdentityRow,
  identityStatus:
    HobbyMobilityIdentityEvidence['identityStatus'] =
      'verified_player_bridge',
  teamCode: string | null = null,
): HobbyMobilityIdentityEvidence {
  return {
    gemRateSourceKey: row.sourceKey,
    evidenceSourceId:
      identityStatus === 'reviewed_name_team'
        ? 'it-factor-board'
        : 'hobby-subject-context',
    identityStatus,
    teamCode,
  }
}

function sourceChain(
  lists: readonly SpotracParsedContractList[],
  runId = 'run-2026-07-26',
): SpotracSourceChainInput {
  return {
    permissionEvidence: {
      path: 'docs/permissions/SPOTRAC_ATTESTATION.md',
      sha256: 'a'.repeat(64),
    },
    robotsPolicy: {
      url: 'https://www.spotrac.com/robots.txt',
      sha256: 'b'.repeat(64),
    },
    runId,
    runManifestPath:
      `data/raw/spotrac-team-runway/manifests/${runId}.json`,
    runManifestSha256: 'd'.repeat(64),
    pages: lists.map((list, index) => ({
      sourceUrl: list.sourceUrl,
      contentSha256: index.toString(16).padStart(64, '0'),
    })),
  }
}

function emptyArtifact(): PlayerMobilityArtifact {
  return {
    schemaVersion: 'hobby-player-mobility.v1',
    generatedAt: '2026-07-25T00:00:00.000Z',
    dataThrough: '2026-07-25',
    coverage: {
      observedRows: 0,
      byLeague: { MLB: 0, NFL: 0, NBA: 0, NHL: 0 },
      limitations: [],
    },
    sources: [],
    rows: [],
    contentSha256: '0'.repeat(64),
  }
}

function totalRows(lists: readonly SpotracParsedContractList[]): number {
  return lists.reduce(
    (sum, list) => sum + list.rows.length + list.withheldRows.length,
    0,
  )
}

function build(input: {
  lists: SpotracParsedContractList[]
  hobbyRows?: HobbyIdentityRow[]
  identityEvidence?: HobbyMobilityIdentityEvidence[]
  blockedIdentityKeys?: string[]
  existingArtifact?: PlayerMobilityArtifact
  dataThrough?: string
  runId?: string
}) {
  const dataThrough = input.dataThrough ?? '2026-07-26'
  return buildSpotracMobilityArtifact({
    parsedLists: input.lists,
    hobbyRows: input.hobbyRows ?? [],
    identityEvidence: input.identityEvidence ?? [],
    blockedIdentityKeys: input.blockedIdentityKeys ?? [],
    existingArtifact: input.existingArtifact ?? emptyArtifact(),
    sourceChain: sourceChain(
      input.lists,
      input.runId ?? `run-${dataThrough}`,
    ),
    generatedAt: `${dataThrough}T21:00:00.000Z`,
    dataThrough,
    accessedAt: dataThrough,
  })
}

describe('Spotrac Team Runway artifact builder', () => {
  it('plans every team without using a robots-disallowed sort route', () => {
    const plan = spotracAcquisitionPlan()

    expect(plan).toHaveLength(124)
    expect(new Set(plan.map((unit) => unit.url)).size).toBe(124)
    expect(plan.every((unit) => (
      /\/contracts\/_\/team\/[a-z0-9]+$/u.test(unit.url) &&
      !/\/_\/(?:sort|dir|column|position|type)\//u.test(unit.url)
    ))).toBe(true)
    expect(plan.find((unit) => (
      unit.league === 'MLB' && unit.canonicalTeam.code === 'CWS'
    ))).toMatchObject({ sourceTeamCode: 'CHW', sourceTeamSlug: 'chw' })
  })

  it('uses reviewed current-player evidence and dynamic split seasons', () => {
    const lists = parsedLists()
    addPlayer(lists, {
      league: 'MLB',
      teamCode: 'LAD',
      id: '15744',
      name: 'Mookie Betts',
      start: 2021,
      end: 2032,
    })
    addPlayer(lists, {
      league: 'NFL',
      teamCode: 'KC',
      id: '21751',
      name: 'Patrick Mahomes',
      start: 2026,
      end: 2033,
    })
    addPlayer(lists, {
      league: 'NBA',
      teamCode: 'BOS',
      id: '23598',
      name: 'Jayson Tatum',
      start: 2025,
      end: 2029,
    })
    addPlayer(lists, {
      league: 'NHL',
      teamCode: 'EDM',
      id: '17891',
      name: 'Connor McDavid',
      start: 2026,
      end: 2027,
    })
    const mookieHobby = hobby('baseball', 'Mookie Betts')
    const mahomesHobby = hobby('football', 'Patrick Mahomes')
    const tatumHobby = hobby('basketball', 'Jayson Tatum')
    const mcdavidHobby = hobby('hockey', 'Connor McDavid')
    const result = build({
      lists,
      hobbyRows: [
        mookieHobby,
        mahomesHobby,
        tatumHobby,
        mcdavidHobby,
      ],
      identityEvidence: [
        evidence(mookieHobby),
        evidence(mookieHobby, 'reviewed_name_team', 'LAD'),
        evidence(mahomesHobby, 'reviewed_player_bridge'),
        evidence(tatumHobby, 'reviewed_player_bridge'),
        evidence(mcdavidHobby, 'reviewed_name_team', 'EDM'),
      ],
    })

    expect(result.matching).toMatchObject({
      sourceContractRows: totalRows(lists),
      observedRows: 4,
      uniqueNormalizedNameMatches: 4,
      uniqueCompactNameMatches: 0,
      existingReviewedSupplementMatches: 0,
      verifiedCurrentIdentityMatches: 1,
      reviewedCurrentIdentityMatches: 2,
      reviewedNameTeamMatches: 1,
      blockedIdentitySourceRows: 0,
      identityEvidenceWithheldSourceRows: 0,
      unmatchedSourceRows: totalRows(lists) - 4,
      ambiguousSourceRows: 0,
      structurallyWithheldSourceRows: 0,
      staleTermSourceRows: 0,
    })
    const mookie = result.artifact.rows.find(
      (row) => row.playerName === 'Mookie Betts',
    )
    const tatum = result.artifact.rows.find(
      (row) => row.playerName === 'Jayson Tatum',
    )
    const mcdavid = result.artifact.rows.find(
      (row) => row.playerName === 'Connor McDavid',
    )
    expect(mookie).toMatchObject({
      currentTeam: { code: 'LAD', name: 'Los Angeles Dodgers' },
      term: {
        currentSeasonEndYear: 2026,
        currentSeasonLabel: '2026',
        reportedThrough: {
          seasonEndYear: 2032,
          label: '2032 season',
        },
        guaranteedThrough: null,
        remainingSeasonsIncludingCurrent: 7,
      },
      provenance: {
        sourcePlayerId: '15744',
        identityStatus: 'reviewed_bridge',
      },
    })
    expect(tatum).toMatchObject({
      term: {
        currentSeasonEndYear: 2027,
        currentSeasonLabel: '2026-27',
        reportedThrough: {
          seasonEndYear: 2030,
          label: '2029-30 season',
        },
        remainingSeasonsIncludingCurrent: 4,
      },
      mobilityWindow: 'three_plus_seasons',
    })
    expect(mcdavid).toMatchObject({
      term: {
        currentSeasonEndYear: 2027,
        reportedThrough: {
          seasonEndYear: 2028,
          label: '2027-28 season',
        },
        remainingSeasonsIncludingCurrent: 2,
      },
      nextDecision: {
        season: {
          seasonEndYear: 2028,
          label: '2028 offseason',
        },
      },
      mobilityWindow: 'within_two_seasons',
    })
    expect(result.artifact.sourceChain).toMatchObject({
      normalizerVersion: 'spotrac-team-runway-normalizer/v1',
      parserVersion: SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
      run: {
        id: 'run-2026-07-26',
        manifestPath:
          'data/raw/spotrac-team-runway/manifests/run-2026-07-26.json',
        manifestSha256: 'd'.repeat(64),
      },
      pages: { count: 124 },
    })
    expect(result.artifact.sourceChain?.pages.items).toHaveLength(124)
    expect(result.artifact.sourceChain?.pages.items).toEqual(
      [...result.artifact.sourceChain!.pages.items].toSorted(
        (left, right) => left.sourceUrl.localeCompare(
          right.sourceUrl,
          'en-US',
        ),
      ),
    )
    expect(result.artifact.sourceChain?.pages.setSha256)
      .toMatch(/^[a-f0-9]{64}$/u)
    expect(result.artifact.rows.every((row) => (
      row.semantics.contextOnly &&
      !row.semantics.directionalClaim &&
      !('riskScore' in row)
    ))).toBe(true)
    expect(isPlayerMobilityArtifact(result.artifact)).toBe(true)

    const tamperedSetHash = structuredClone(result.artifact)
    tamperedSetHash.sourceChain!.pages.setSha256 = '0'.repeat(64)
    expect(isPlayerMobilityArtifact(tamperedSetHash)).toBe(false)

    const mismatchedTeamPage = structuredClone(result.artifact)
    mismatchedTeamPage.coverage.teamPages![0]!.sourceUrl =
      'https://www.spotrac.com/mlb/contracts/_/team/not-the-source-page'
    expect(isPlayerMobilityArtifact(mismatchedTeamPage)).toBe(false)

    const missingSourceChain = structuredClone(result.artifact)
    delete missingSourceChain.sourceChain
    expect(isPlayerMobilityArtifact(missingSourceChain)).toBe(false)
  })

  it('derives calendar and split-season labels from dataThrough', () => {
    const lists = parsedLists()
    const rows = [
      { league: 'MLB' as const, teamCode: 'LAD', id: '1', name: 'MLB Current', end: 2028 },
      { league: 'NFL' as const, teamCode: 'KC', id: '2', name: 'NFL Current', end: 2027 },
      { league: 'NBA' as const, teamCode: 'BOS', id: '3', name: 'NBA Current', end: 2027 },
      { league: 'NHL' as const, teamCode: 'EDM', id: '4', name: 'NHL Current', end: 2027 },
    ]
    for (const row of rows) {
      addPlayer(lists, { ...row, start: row.end })
    }
    const hobbyRows = [
      hobby('baseball', 'MLB Current'),
      hobby('football', 'NFL Current'),
      hobby('basketball', 'NBA Current'),
      hobby('hockey', 'NHL Current'),
    ]
    const result = build({
      lists,
      hobbyRows,
      identityEvidence: hobbyRows.map((row) => evidence(row)),
      dataThrough: '2028-01-15',
    })

    expect(result.artifact.rows.map((row) => ({
      league: row.league,
      endYear: row.term?.currentSeasonEndYear,
      label: row.term?.currentSeasonLabel,
    }))).toEqual([
      { league: 'MLB', endYear: 2028, label: '2028' },
      { league: 'NBA', endYear: 2028, label: '2027-28' },
      { league: 'NFL', endYear: 2027, label: '2027' },
      { league: 'NHL', endYear: 2028, label: '2027-28' },
    ])
  })

  it('does not infer a near-term decision from a current-year team-list row', () => {
    const lists = parsedLists()
    addPlayer(lists, {
      league: 'MLB',
      teamCode: 'BAL',
      id: '30440',
      name: 'Gunnar Henderson',
      start: 2026,
      end: 2026,
    })
    addPlayer(lists, {
      league: 'MLB',
      teamCode: 'PIT',
      id: '83150',
      name: 'Paul Skenes',
      start: 2026,
      end: 2026,
    })
    const gunnar = hobby('baseball', 'Gunnar Henderson')
    const skenes = hobby('baseball', 'Paul Skenes')
    const result = build({
      lists,
      hobbyRows: [gunnar, skenes],
      identityEvidence: [evidence(gunnar), evidence(skenes)],
    })

    for (const row of result.artifact.rows) {
      expect(row.term?.reportedThrough).toMatchObject({
        seasonEndYear: 2026,
        label: '2026 season',
      })
      expect(row.nextDecision).toBeNull()
      expect(row.mobilityWindow).toBe('unavailable')
      expect(row.reasonCodes).toContain(
        'reported_term_not_verified_mobility_decision',
      )
    }
    expect(isPlayerMobilityArtifact(result.artifact)).toBe(true)
  })

  it('lets an enriched option outrank the longer reported term horizon', () => {
    const lists = parsedLists()
    addPlayer(lists, {
      league: 'NBA',
      teamCode: 'BOS',
      id: '23598',
      name: 'Jayson Tatum',
      start: 2025,
      end: 2029,
    })
    const tatum = hobby('basketball', 'Jayson Tatum')
    const first = build({
      lists,
      hobbyRows: [tatum],
      identityEvidence: [evidence(tatum, 'reviewed_player_bridge')],
    }).artifact
    const officialSource: PlayerMobilitySource = {
      id: 'nba-tatum-player-option',
      label: 'Jayson Tatum contract option',
      publisher: 'NBA.com',
      url: 'https://www.nba.com/celtics/news/tatum-contract-option',
      publishedAt: '2026-07-01',
      accessedAt: '2026-07-26',
      kind: 'official',
    }
    const enrichedRow: PlayerMobilityArtifactRow = {
      ...first.rows[0]!,
      sourceIds: [
        'spotrac-team-contract-lists',
        officialSource.id,
      ],
      term: {
        ...first.rows[0]!.term!,
        options: [{
          season: {
            seasonEndYear: 2028,
            label: '2027-28 season',
          },
          type: 'player',
          status: 'pending',
        }],
      },
      nextDecision: {
        kind: 'player_option',
        season: {
          seasonEndYear: 2028,
          label: '2027-28 season',
        },
        label: 'Player option after 2027-28',
      },
      mobilityWindow: 'after_current_season',
      provenance: {
        ...first.rows[0]!.provenance,
        identityStatus: 'reviewed_bridge',
      },
    }
    const enrichedArtifact: PlayerMobilityArtifact = {
      ...first,
      sources: [...first.sources, officialSource],
      rows: [enrichedRow],
    }

    const result = build({
      lists,
      hobbyRows: [tatum],
      identityEvidence: [evidence(tatum, 'reviewed_player_bridge')],
      existingArtifact: enrichedArtifact,
      dataThrough: '2026-07-27',
    })

    expect(result.artifact.rows[0]).toMatchObject({
      term: { remainingSeasonsIncludingCurrent: 4 },
      nextDecision: { kind: 'player_option' },
      mobilityWindow: 'after_current_season',
    })
    expect(isPlayerMobilityArtifact(result.artifact)).toBe(true)
  })

  it('fails closed on historical homonyms without current-player evidence', () => {
    const lists = parsedLists()
    for (const player of [
      { teamCode: 'MIN', id: '107639', name: 'Marcus Allen', end: 2028 },
      { teamCode: 'MIA', id: '47980', name: 'A.J. Green', end: 2026 },
      { teamCode: 'TEN', id: '77063', name: 'Zach Thomas', end: 2026 },
      { teamCode: 'BUF', id: '39179', name: 'Josh Allen', end: 2030 },
      { teamCode: 'KC', id: '21751', name: 'Patrick Mahomes', end: 2033 },
    ]) {
      addPlayer(lists, {
        league: 'NFL',
        start: 2026,
        ...player,
      })
    }
    const marcus = hobby('football', 'Marcus Allen')
    const green = hobby('football', 'A.J. Green')
    const thomas = hobby('football', 'Zach Thomas')
    const allen = hobby('football', 'Josh Allen')
    const mahomes = hobby('football', 'Patrick Mahomes')
    const result = build({
      lists,
      hobbyRows: [marcus, green, thomas, allen, mahomes],
      identityEvidence: [
        evidence(allen, 'reviewed_name_team', 'BUF'),
        evidence(mahomes, 'reviewed_player_bridge'),
      ],
      blockedIdentityKeys: [allen.sourceKey],
    })

    expect(result.artifact.rows.map((row) => row.playerName))
      .toEqual(['Patrick Mahomes'])
    expect(result.matching.identityEvidenceWithheldSourceRows).toBe(3)
    expect(result.matching.blockedIdentitySourceRows).toBe(1)
    expect(result.matching.reviewedCurrentIdentityMatches).toBe(1)
  })

  it('requires reviewed name-and-team evidence to agree with Spotrac', () => {
    const lists = parsedLists()
    addPlayer(lists, {
      league: 'NHL',
      teamCode: 'EDM',
      id: '17891',
      name: 'Connor McDavid',
      start: 2026,
      end: 2027,
    })
    const mcdavid = hobby('hockey', 'Connor McDavid')
    const result = build({
      lists,
      hobbyRows: [mcdavid],
      identityEvidence: [
        evidence(mcdavid, 'reviewed_name_team', 'TOR'),
      ],
    })

    expect(result.artifact.rows).toHaveLength(0)
    expect(result.matching.identityEvidenceWithheldSourceRows).toBe(1)
  })

  it('rejects partial pages and material coverage regressions', () => {
    const partial = parsedLists()
    partial[0]!.rows.pop()
    expect(() => build({ lists: partial })).toThrow(
      /coverage is incomplete/u,
    )

    const teamRegressionLists = parsedLists()
    const teamRegressionArtifact = emptyArtifact()
    teamRegressionArtifact.coverage.teamPages = [{
      league: 'MLB',
      teamCode: teamRegressionLists[0]!.sourceTeamCode,
      sourceUrl: teamRegressionLists[0]!.sourceUrl,
      parsedRows: 40,
      withheldRows: 0,
      totalRows: 40,
    }]
    expect(() => build({
      lists: teamRegressionLists,
      existingArtifact: teamRegressionArtifact,
    })).toThrow(/team coverage regressed materially/u)

    const totalRegressionLists = parsedLists()
    const totalRegressionArtifact = emptyArtifact()
    totalRegressionArtifact.coverage.identityMatching = {
      sourceContractRows: 4_000,
      observedRows: 0,
      uniqueNormalizedNameMatches: 0,
      uniqueCompactNameMatches: 0,
      unmatchedSourceRows: 4_000,
      ambiguousSourceRows: 0,
      structurallyWithheldSourceRows: 0,
      staleTermSourceRows: 0,
    }
    expect(() => build({
      lists: totalRegressionLists,
      existingArtifact: totalRegressionArtifact,
    })).toThrow(/total coverage regressed materially/u)
  })

  it('withholds ambiguous same-sport identities and stale source terms', () => {
    const lists = parsedLists()
    addPlayer(lists, {
      league: 'NFL',
      teamCode: 'BUF',
      id: '123',
      name: 'Josh Allen',
      start: 2025,
      end: 2030,
    })
    addPlayer(lists, {
      league: 'NBA',
      teamCode: 'PHX',
      id: '456',
      name: 'Past Player',
      start: 2024,
      end: 2025,
    })
    const result = build({
      lists,
      hobbyRows: [
        hobby('football', 'Josh Allen'),
        {
          ...hobby('football', 'Josh Allen'),
          sourceKey: 'athlete|football|Josh Allen 2',
        },
        hobby('basketball', 'Past Player'),
      ],
    })

    expect(result.artifact.rows).toHaveLength(0)
    expect(result.matching.ambiguousSourceRows).toBe(1)
    expect(result.matching.staleTermSourceRows).toBe(1)
  })

  it('keeps a stable Spotrac source and only carries independent supplements', () => {
    const lists = parsedLists()
    addPlayer(lists, {
      league: 'MLB',
      teamCode: 'LAD',
      id: '15744',
      name: 'Mookie Betts',
      start: 2021,
      end: 2032,
    })
    const mookie = hobby('baseball', 'Mookie Betts')
    const first = build({
      lists,
      hobbyRows: [mookie],
      identityEvidence: [evidence(mookie)],
    }).artifact
    const officialSource: PlayerMobilitySource = {
      id: 'mlb-betts-dodgers-extension-2032',
      label: 'Mookie Betts contract',
      publisher: 'MLB.com',
      url: 'https://www.mlb.com/news/mookie-betts-contract-extension',
      publishedAt: '2020-07-22',
      accessedAt: '2026-07-25',
      kind: 'official',
    }
    const datedSpotracSource: PlayerMobilitySource = {
      id: 'spotrac-team-contract-lists-2026-07-25',
      label: 'Old Spotrac snapshot',
      publisher: 'Spotrac',
      url: 'https://www.spotrac.com',
      publishedAt: null,
      accessedAt: '2026-07-25',
      kind: 'authorized',
    }
    const reviewedRow: PlayerMobilityArtifactRow = {
      ...first.rows[0]!,
      sourceIds: [datedSpotracSource.id, officialSource.id],
      provenance: {
        ...first.rows[0]!.provenance,
        identityStatus: 'reviewed_bridge',
      },
    }
    const reviewedArtifact: PlayerMobilityArtifact = {
      ...first,
      sources: [
        ...first.sources,
        datedSpotracSource,
        officialSource,
      ],
      rows: [reviewedRow],
    }

    const second = build({
      lists,
      hobbyRows: [mookie],
      identityEvidence: [evidence(mookie)],
      existingArtifact: reviewedArtifact,
      dataThrough: '2026-07-27',
    }).artifact
    expect(second.sources.map((source) => source.id)).toEqual([
      'mlb-betts-dodgers-extension-2032',
      'spotrac-team-contract-lists',
    ])
    expect(second.rows[0]!.sourceIds).toEqual([
      'spotrac-team-contract-lists',
      'mlb-betts-dodgers-extension-2032',
    ])
    expect(second.coverage.identityMatching)
      .toMatchObject({ existingReviewedSupplementMatches: 1 })
    expect(isPlayerMobilityArtifact(second)).toBe(true)

    const repeated = build({
      lists,
      hobbyRows: [mookie],
      identityEvidence: [evidence(mookie)],
      existingArtifact: second,
      dataThrough: '2026-07-28',
    }).artifact
    expect(repeated.sources).toHaveLength(2)
    expect(repeated.sources.every((source) => (
      !source.id.startsWith('spotrac-team-contract-lists-')
    ))).toBe(true)
  })
})
