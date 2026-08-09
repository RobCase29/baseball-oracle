import { describe, expect, it } from 'vitest'
import { mobilityContextDisplay } from './hobbySubjectDisplay'

describe('mobilityContextDisplay', () => {
  it('frames long contract runway as neutral context', () => {
    const display = mobilityContextDisplay({
      type: 'athlete',
      mobility: {
        availability: 'observed',
        asOf: '2026-07-26',
        league: 'MLB',
        currentTeam: {
          code: 'LAD',
          name: 'Los Angeles Dodgers',
        },
        teamTenureStart: '2020-02-10',
        term: {
          status: 'under_contract',
          kind: 'extension',
          currentSeasonLabel: '2026',
          reportedThrough: {
            seasonEndYear: 2032,
            label: '2032 season',
          },
          guaranteedThrough: {
            seasonEndYear: 2032,
            label: '2032 season',
          },
          maximumTeamControlThrough: {
            seasonEndYear: 2032,
            label: '2032 season',
          },
          remainingSeasonsIncludingCurrent: 7,
          options: [],
        },
        nextDecision: {
          kind: 'unrestricted_free_agency',
          label: 'UFA after the 2032 season',
          season: {
            seasonEndYear: 2033,
            label: '2033 offseason',
          },
        },
        mobilityWindow: 'three_plus_seasons',
        lastTeamChange: {
          effectiveAt: '2020-02-10',
          kind: 'trade',
          fromTeam: { code: 'BOS', name: 'Boston Red Sox' },
          toTeam: { code: 'LAD', name: 'Los Angeles Dodgers' },
        },
        provenance: {
          sourceId: 'official_mlb',
          sourceUrl: 'https://www.mlb.com/example',
          accessedAt: '2026-07-26',
        },
      },
    })

    expect(display).toMatchObject({
      primary: 'Contract term through 2032',
      compact: 'LAD · term 2032',
      guaranteeLabel: 'Guaranteed through 2032',
      decisionActor: 'Free agency',
      band: 'long_runway',
      observed: true,
      sourceLabel: 'MLB.com',
      sourceAsOf: 'Jul 26, 2026',
      accentDecision: false,
    })
    expect(display.secondary).toContain('7 seasons incl. 2026')
    expect(display.detail).toContain('disrupt continuity or expand collector reach')
    expect(display.detail).not.toContain('negative')
  })

  it('separates an NBA contract term, guarantee, and player decision', () => {
    const display = mobilityContextDisplay({
      type: 'athlete',
      mobility: {
        availability: 'observed',
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
          label: 'Player option for 2027',
          season: {
            seasonEndYear: 2027,
            label: '2026-27 season',
          },
        },
        mobilityWindow: 'after_current_season',
        lastTeamChange: null,
        provenance: {
          sourceId: 'spotrac',
          sourceUrl:
            'https://www.spotrac.com/nba/player/_/id/12345/example-player',
          accessedAt: '2026-07-26',
        },
      },
    })

    expect(display).toMatchObject({
      primary: 'Contract term through 2028-29',
      compact: 'LAL · term 2028-29',
      guaranteeLabel: 'Guaranteed through 2026-27',
      decisionLabel: 'Player option for 2027',
      decisionCompact: 'Player option 2026-27',
      decisionActor: 'Player-controlled',
      optionLabels: ['Player option 2026-27'],
      band: 'decision_window',
      sourceLabel: 'Spotrac',
      sourceAsOf: 'Jul 26, 2026',
      accentDecision: true,
    })
    expect(display.primary).not.toContain('Signed')
    expect(display.primary).not.toContain('control')
  })

  it('uses team-control wording only for a true team-control term', () => {
    const display = mobilityContextDisplay({
      type: 'athlete',
      mobility: {
        availability: 'observed',
        asOf: '2026-07-26',
        league: 'MLB',
        currentTeam: {
          code: 'BAL',
          name: 'Baltimore Orioles',
        },
        teamTenureStart: '2024-03-28',
        term: {
          status: 'team_control',
          kind: 'pre_arbitration',
          currentSeasonLabel: '2026',
          reportedThrough: null,
          guaranteedThrough: null,
          maximumTeamControlThrough: {
            seasonEndYear: 2030,
            label: '2030 season',
          },
          remainingSeasonsIncludingCurrent: 5,
          options: [],
        },
        nextDecision: {
          kind: 'unrestricted_free_agency',
          label: 'UFA after the 2030 season',
          season: {
            seasonEndYear: 2031,
            label: '2031 offseason',
          },
        },
        mobilityWindow: 'three_plus_seasons',
        lastTeamChange: null,
        provenance: {
          sourceId: 'spotrac',
          sourceUrl:
            'https://www.spotrac.com/mlb/player/_/id/54321/example-player',
          accessedAt: '2026-07-26',
        },
      },
    })

    expect(display.primary).toBe('Team control through 2030')
    expect(display.compact).toBe('BAL · control 2030')
  })

  it('shows a verified free agent without manufacturing a team', () => {
    const display = mobilityContextDisplay({
      type: 'athlete',
      mobility: {
        availability: 'observed',
        asOf: '2026-07-26',
        league: 'NFL',
        currentTeam: null,
        teamTenureStart: null,
        term: {
          status: 'unrestricted_free_agent',
          kind: 'standard',
          currentSeasonLabel: '2026',
          reportedThrough: {
            seasonEndYear: 2025,
            label: '2025 season',
          },
          guaranteedThrough: null,
          maximumTeamControlThrough: null,
          remainingSeasonsIncludingCurrent: 0,
          options: [],
        },
        nextDecision: null,
        mobilityWindow: 'open_now',
        lastTeamChange: null,
        provenance: {
          sourceId: 'spotrac',
          sourceUrl:
            'https://www.spotrac.com/nfl/player/_/id/67890/example-player',
          accessedAt: '2026-07-26',
        },
      },
    })

    expect(display.primary).toBe('Unrestricted free agent')
    expect(display.compact).toBe('UFA · open market')
    expect(display.compact).not.toContain('Team')
    expect(display.decisionCompact).toBe('UFA now')
    expect(display.accentDecision).toBe(true)
  })

  it('keeps a term-only record neutral when no decision is verified', () => {
    const display = mobilityContextDisplay({
      type: 'athlete',
      mobility: {
        availability: 'observed',
        asOf: '2026-07-26',
        league: 'NBA',
        currentTeam: {
          code: 'ORL',
          name: 'Orlando Magic',
        },
        teamTenureStart: null,
        term: {
          status: 'under_contract',
          kind: 'standard',
          currentSeasonLabel: '2026-27',
          reportedThrough: {
            seasonEndYear: 2027,
            label: '2026-27 season',
          },
          guaranteedThrough: null,
          maximumTeamControlThrough: null,
          remainingSeasonsIncludingCurrent: 1,
          options: [],
        },
        nextDecision: {
          kind: 'unknown',
          label: 'Contract term concludes after the 2026-27 season',
          season: {
            seasonEndYear: 2027,
            label: '2027 offseason',
          },
        },
        mobilityWindow: 'after_current_season',
        lastTeamChange: null,
        provenance: {
          sourceId: 'spotrac',
          sourceUrl:
            'https://www.spotrac.com/nba/player/_/id/24680/example-player',
          accessedAt: '2026-07-26',
        },
      },
    })

    expect(display).toMatchObject({
      primary: 'Contract term through 2026-27',
      compact: 'ORL · term 2026-27',
      secondary: expect.stringContaining('Decision not verified'),
      decisionLabel: 'Decision not verified',
      decisionCompact: null,
      decisionActor: null,
      band: 'neutral_term',
      accentDecision: false,
    })
    expect(display.detail).toContain(
      'does not by itself establish free agency, relocation, or a team change',
    )
    expect(display.detail).not.toContain('Next known decision')
    expect(display.detail).not.toContain(
      'disrupt continuity or expand collector reach',
    )
  })

  it('does not mislabel missing context as open market', () => {
    const display = mobilityContextDisplay({
      type: 'athlete',
      mobility: null,
    })

    expect(display.primary).toBe('Team runway unavailable')
    expect(display.secondary).toBe('No verified contract record linked')
    expect(display.band).toBe('unavailable')
    expect(display.detail).toContain('not treated as free agency')
  })
})
