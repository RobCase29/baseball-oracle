import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
  parseSpotracContractListSourceUrl,
  parseSpotracTeamContractList,
} from './spotrac-contract-list-parser.js'

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/${name}`, import.meta.url),
    'utf8',
  )
}

describe('Spotrac team contract-list parser', () => {
  it('parses a structurally verified team page', () => {
    const parsed = parseSpotracTeamContractList(
      fixture('mlb-team-contracts.html'),
      'https://spotrac.com/mlb/contracts/_/team/lad/',
    )

    expect(parsed).toMatchObject({
      parserVersion: SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
      sourceUrl: 'https://www.spotrac.com/mlb/contracts/_/team/lad',
      league: 'MLB',
      sourceTeamSlug: 'lad',
      sourceTeamCode: 'LAD',
      sourceTeamLabel: 'Dodgers',
      withheldRows: [],
    })
    expect(parsed.rows).toEqual([
      {
        playerId: '15744',
        playerName: 'Mookie Betts',
        playerUrl:
          'https://www.spotrac.com/mlb/player/_/id/15744/mookie-betts',
        position: 'SS',
        sourceTeamCode: 'LAD',
        sourceStartYear: 2021,
        sourceEndYear: 2032,
        reportedYears: 12,
      },
      {
        playerId: '38710',
        playerName: 'Shohei Ohtani',
        playerUrl:
          'https://www.spotrac.com/mlb/player/_/id/38710/shohei-ohtani',
        position: 'DH',
        sourceTeamCode: 'LAD',
        sourceStartYear: 2024,
        sourceEndYear: 2033,
        reportedYears: 10,
      },
    ])
  })

  it('fails closed on block pages and unsupported filtered routes', () => {
    expect(() => parseSpotracTeamContractList(
      fixture('blocked-response.html'),
      'https://www.spotrac.com/mlb/contracts/_/team/lad',
    )).toThrowError(expect.objectContaining({ code: 'blocked_response' }))

    expect(() => parseSpotracContractListSourceUrl(
      'https://www.spotrac.com/mlb/contracts/_/sort/value/dir/desc/team/lad',
    )).toThrowError(expect.objectContaining({
      code: 'unsupported_source_url',
    }))
  })

  it('withholds a bad row without manufacturing chronology', () => {
    const drifted = fixture('mlb-team-contracts.html')
      .replace(
        '<td class="text-center contract-length">12</td>',
        '<td class="text-center contract-length">20</td>',
      )

    const parsed = parseSpotracTeamContractList(
      drifted,
      'https://www.spotrac.com/mlb/contracts/_/team/lad',
    )

    expect(parsed.rows.map((row) => row.playerName))
      .toEqual(['Shohei Ohtani'])
    expect(parsed.withheldRows).toEqual([{
      playerId: '15744',
      playerName: 'Mookie Betts',
      reason: 'invalid_contract_chronology',
    }])
  })
})
