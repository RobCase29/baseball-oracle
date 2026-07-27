import { describe, expect, it } from 'vitest'
import {
  isPlayerMobilityArtifact,
  mobilityWindowFor,
  unavailablePlayerMobilityContext,
  type PlayerMobilityArtifact,
} from './playerMobilityContext'

function artifactFixture(): PlayerMobilityArtifact {
  return {
    schemaVersion: 'hobby-player-mobility.v1',
    generatedAt: '2026-07-26T20:00:00.000Z',
    dataThrough: '2026-07-26',
    coverage: {
      observedRows: 1,
      byLeague: {
        MLB: 0,
        NFL: 0,
        NBA: 1,
        NHL: 0,
      },
      limitations: [],
    },
    sources: [
      {
        id: 'spotrac-player-contracts',
        label: 'Spotrac player contracts',
        publisher: 'Spotrac',
        url: 'https://www.spotrac.com',
        publishedAt: null,
        accessedAt: '2026-07-26',
        kind: 'authorized',
      },
    ],
    rows: [
      {
        availability: 'observed',
        gemRateSourceKey: 'athlete|basketball|Example Player',
        playerName: 'Example Player',
        sourceIds: ['spotrac-player-contracts'],
        asOf: '2026-07-26',
        league: 'NBA',
        currentTeam: {
          code: 'LAL',
          name: 'Los Angeles Lakers',
        },
        teamTenureStart: '2025-07-01',
        term: {
          status: 'under_contract',
          kind: 'standard',
          currentSeasonEndYear: 2026,
          currentSeasonLabel: '2025-26',
          reportedThrough: {
            seasonEndYear: 2029,
            label: '2028-29 season',
          },
          guaranteedThrough: {
            seasonEndYear: 2027,
            label: '2026-27 season',
          },
          maximumTeamControlThrough: null,
          remainingSeasonsIncludingCurrent: 4,
          options: [
            {
              season: {
                seasonEndYear: 2027,
                label: '2026-27 season',
              },
              type: 'player',
              status: 'pending',
            },
          ],
        },
        nextDecision: {
          kind: 'player_option',
          season: {
            seasonEndYear: 2027,
            label: '2026-27 season',
          },
          label: 'Player option for 2027',
        },
        mobilityWindow: 'after_current_season',
        reasonCodes: ['player_controlled_decision'],
        lastTeamChange: null,
        provenance: {
          sourceId: 'spotrac',
          sourcePlayerId: '12345',
          sourceUrl:
            'https://www.spotrac.com/nba/player/_/id/12345/example-player',
          accessedAt: '2026-07-26',
          identityStatus: 'unique_source_name_bridge',
        },
        semantics: {
          contextOnly: true,
          directionalClaim: false,
          interpretation: 'opportunity_or_disruption',
        },
      },
    ],
    contentSha256: 'a'.repeat(64),
  }
}

describe('player mobility context', () => {
  it('routes factual decision horizons without creating a risk score', () => {
    expect(mobilityWindowFor(2026, 2026, 'under_contract'))
      .toBe('after_current_season')
    expect(mobilityWindowFor(2026, 2027, 'under_contract'))
      .toBe('after_current_season')
    expect(mobilityWindowFor(2026, 2028, 'under_contract'))
      .toBe('within_two_seasons')
    expect(mobilityWindowFor(2026, 2032, 'under_contract'))
      .toBe('three_plus_seasons')
    expect(mobilityWindowFor(2026, null, 'unrestricted_free_agent'))
      .toBe('open_now')
    expect(mobilityWindowFor(2026, null, 'restricted_free_agent'))
      .toBe('open_now')
  })

  it('accepts an observed unsigned or UFA record without a current team', () => {
    const artifact = artifactFixture()
    const row = artifact.rows[0]!
    row.currentTeam = null
    row.teamTenureStart = null
    row.term = {
      ...row.term!,
      status: 'unrestricted_free_agent',
      reportedThrough: {
        seasonEndYear: 2025,
        label: '2024-25 season',
      },
      guaranteedThrough: {
        seasonEndYear: 2025,
        label: '2024-25 season',
      },
      remainingSeasonsIncludingCurrent: 0,
      options: [],
    }
    row.nextDecision = null
    row.mobilityWindow = 'open_now'

    expect(isPlayerMobilityArtifact(artifact)).toBe(true)

    row.term.status = 'unsigned'
    expect(isPlayerMobilityArtifact(artifact)).toBe(true)
  })

  it('rejects invalid enums and contradictory contract chronology', () => {
    const invalidStatus = artifactFixture() as unknown as {
      rows: Array<{ term: { status: string } }>
    }
    invalidStatus.rows[0]!.term.status = 'maybe_signed'
    expect(isPlayerMobilityArtifact(invalidStatus)).toBe(false)

    const guaranteePastTerm = artifactFixture()
    guaranteePastTerm.rows[0]!.term!.guaranteedThrough = {
      seasonEndYear: 2030,
      label: '2029-30 season',
    }
    expect(isPlayerMobilityArtifact(guaranteePastTerm)).toBe(false)

    const unmatchedOption = artifactFixture()
    unmatchedOption.rows[0]!.nextDecision = {
      kind: 'club_option',
      season: {
        seasonEndYear: 2027,
        label: '2026-27 season',
      },
      label: 'Club option for 2027',
    }
    expect(isPlayerMobilityArtifact(unmatchedOption)).toBe(false)
  })

  it('treats missing evidence as unavailable, never free agency', () => {
    const context = unavailablePlayerMobilityContext(
      'unavailable',
      'contract_source_not_observed',
    )

    expect(context.availability).toBe('unavailable')
    expect(context.term).toBeNull()
    expect(context.nextDecision).toBeNull()
    expect(context.mobilityWindow).toBe('unavailable')
    expect(context.semantics).toEqual({
      contextOnly: true,
      directionalClaim: false,
      interpretation: 'opportunity_or_disruption',
    })
    expect(context).not.toHaveProperty('riskScore')
  })
})
