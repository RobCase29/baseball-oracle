import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SPOTRAC_CONTRACT_PARSER_VERSION,
  SpotracContractParseError,
  parseSpotracPlayerContract,
} from './spotrac-contract-parser.js'

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/${name}`, import.meta.url),
    'utf8',
  )
}

describe('Spotrac player-contract HTML parser v1', () => {
  it('parses a current extension without confusing historical contracts', () => {
    const result = parseSpotracPlayerContract({
      html: fixture('mookie-betts-contract.html'),
      sourceUrl:
        'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts/contract/',
      currentLeagueSeasonYear: 2026,
    })

    expect(result).toMatchObject({
      parserVersion: SPOTRAC_CONTRACT_PARSER_VERSION,
      source: {
        url:
          'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts/contract',
        leagueSlug: 'mlb',
        playerId: '15744',
      },
      league: 'MLB',
      player: {
        id: '15744',
        name: 'Mookie Betts',
      },
      team: {
        name: 'Los Angeles Dodgers',
        sourceSlug: 'los-angeles-dodgers',
        sourceCode: 'LAD',
      },
      contract: {
        current: true,
        kind: 'extension',
        startYear: 2021,
        throughYear: 2032,
        reportedYears: 12,
        options: [],
      },
      freeAgency: {
        year: 2033,
        type: 'UFA',
        sourceText: '2033 / UFA',
      },
      nextDecision: {
        kind: 'unrestricted_free_agency',
        year: 2033,
        label: 'UFA in 2033',
      },
    })
  })

  it('fails closed when multiple contracts have no explicit current marker', () => {
    const ambiguous = fixture('mookie-betts-contract.html')
      .replace(' (CURRENT)', '')

    expect(() => parseSpotracPlayerContract({
      html: ambiguous,
      sourceUrl:
        'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts',
      currentLeagueSeasonYear: 2026,
    })).toThrowError(expect.objectContaining({
      name: 'SpotracContractParseError',
      code: 'ambiguous_current_contract',
    }))
  })

  it('accepts one unmarked contract because its identity is unambiguous', () => {
    const unmarked = fixture('luis-robert-options.html')
      .replace(' (CURRENT)', '')
    const result = parseSpotracPlayerContract({
      html: unmarked,
      sourceUrl: 'https://spotrac.com/mlb/player/_/id/22648',
      currentLeagueSeasonYear: 2026,
    })

    expect(result.contract).toMatchObject({
      current: true,
      startYear: 2020,
      throughYear: 2027,
    })
  })

  it('fails closed when multiple contracts claim to be current', () => {
    const conflicting = fixture('mookie-betts-contract.html')
      .replace(
        '2020-2020 Arbitration',
        '2020-2020 Arbitration (CURRENT)',
      )

    expect(() => parseSpotracPlayerContract({
      html: conflicting,
      sourceUrl:
        'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts',
      currentLeagueSeasonYear: 2026,
    })).toThrowError(expect.objectContaining({
      code: 'ambiguous_current_contract',
    }))
  })

  it('uses JSON-LD current-team identity when no explicit test hook exists', () => {
    const html = fixture('mookie-betts-contract.html')
      .replace(
        /<a\s+data-spotrac-team="Los Angeles Dodgers"[\s\S]*?<\/a>/u,
        '<script type="application/ld+json">{"@type":"Person","name":"Mookie Betts","description":"Signed with Los Angeles (LAD)","memberOf":{"@type":"SportsOrganization","name":"Los Angeles Dodgers"}}</script>',
      )
    const result = parseSpotracPlayerContract({
      html,
      sourceUrl:
        'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts',
      currentLeagueSeasonYear: 2026,
    })

    expect(result.team).toEqual({
      name: 'Los Angeles Dodgers',
      sourceSlug: null,
      sourceCode: 'LAD',
    })
  })

  it('retains all reported options and selects the next pending decision', () => {
    const result = parseSpotracPlayerContract({
      html: fixture('luis-robert-options.html'),
      sourceUrl: 'https://spotrac.com/mlb/player/_/id/22648',
      currentLeagueSeasonYear: 2026,
    })

    expect(result.source.url)
      .toBe('https://www.spotrac.com/mlb/player/_/id/22648')
    expect(result.player).toEqual({
      id: '22648',
      name: 'Luis Robert Jr.',
    })
    expect(result.team).toEqual({
      name: 'New York Mets',
      sourceSlug: 'new-york-mets',
      sourceCode: 'NYM',
    })
    expect(result.contract).toMatchObject({
      kind: 'extension',
      kindLabel: 'Pre-Arbitration Extension',
      startYear: 2020,
      throughYear: 2027,
      reportedYears: 6,
    })
    expect(result.contract.options).toEqual([
      {
        year: 2026,
        type: 'club',
        sourceText: '2026 Club Option',
        pendingRelativeToCurrentSeason: false,
      },
      {
        year: 2027,
        type: 'club',
        sourceText: '2027 Club Option',
        pendingRelativeToCurrentSeason: true,
      },
    ])
    expect(result.nextDecision).toEqual({
      kind: 'club_option',
      year: 2027,
      label: 'Club option for 2027',
    })
    expect(result.freeAgency).toMatchObject({ year: 2028, type: 'UFA' })
  })

  it('fails closed on block pages and unsupported source URLs', () => {
    expect(() => parseSpotracPlayerContract({
      html: fixture('blocked-response.html'),
      sourceUrl:
        'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts',
      currentLeagueSeasonYear: 2026,
    })).toThrowError(expect.objectContaining({
      name: 'SpotracContractParseError',
      code: 'blocked_response',
    }))

    expect(() => parseSpotracPlayerContract({
      html: fixture('mookie-betts-contract.html'),
      sourceUrl: 'https://example.com/mlb/player/_/id/15744/mookie-betts',
      currentLeagueSeasonYear: 2026,
    })).toThrowError(expect.objectContaining({
      code: 'unsupported_source_url',
    }))
  })

  it('rejects chronology drift instead of manufacturing a term', () => {
    const drifted = fixture('mookie-betts-contract.html')
      .replace('2021-2032 Extension (CURRENT)', '2025-2026 Extension (CURRENT)')

    try {
      parseSpotracPlayerContract({
        html: drifted,
        sourceUrl:
          'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts',
        currentLeagueSeasonYear: 2026,
      })
      throw new Error('Expected chronology validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(SpotracContractParseError)
      expect((error as SpotracContractParseError).code)
        .toBe('invalid_contract_chronology')
    }
  })
})
