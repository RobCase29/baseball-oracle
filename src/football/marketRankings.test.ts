import { describe, expect, it } from 'vitest'
import {
  marketConsensusFor,
  normalizeFootballPlayerName,
  parseMarketRankingsCsv,
} from './marketRankings'

const HEADER = 'name,universe,position,source,format_id,position_rank,position_universe_size,as_of,rights_attested'

describe('football market ranking CSV parsing', () => {
  it('parses quoted values, a BOM, and provider-independent player names', () => {
    const rankings = parseMarketRankingsCsv([
      `\uFEFF${HEADER}`,
      '"Terrance Carter, Jr.",college,te,Licensed Devy Board,sf_12t_half_ppr_no_tep,12,40,2026-07-15,true',
      'Ja\'Marr Chase,nfl,wr,Licensed Dynasty Board,sf_12t_half_ppr_no_tep,1,80,2026-07-16,true',
    ].join('\r\n'))

    expect(rankings).toEqual([
      {
        name: 'Terrance Carter, Jr.',
        normalizedName: 'terrancecarter',
        universe: 'college',
        position: 'TE',
        source: 'Licensed Devy Board',
        formatId: 'sf_12t_half_ppr_no_tep',
        positionRank: 12,
        positionUniverseSize: 40,
        positionPercentile: 71.7948717948718,
        asOf: '2026-07-15',
      },
      {
        name: "Ja'Marr Chase",
        normalizedName: 'jamarrchase',
        universe: 'nfl',
        position: 'WR',
        source: 'Licensed Dynasty Board',
        formatId: 'sf_12t_half_ppr_no_tep',
        positionRank: 1,
        positionUniverseSize: 80,
        positionPercentile: 100,
        asOf: '2026-07-16',
      },
    ])
    expect(normalizeFootballPlayerName('  José Example III  ')).toBe('joseexample')
  })

  it.each([
    {
      label: 'a missing required column',
      csv: 'name,universe,position,source,format_id,position_rank,position_universe_size,as_of\nArch Manning,college,QB,Board,sf_12t_half_ppr_no_tep,1,40,2026-07-16',
      message: /Missing required columns: rights_attested\./u,
    },
    {
      label: 'an unsupported universe',
      csv: `${HEADER}\nArch Manning,rookie,QB,Board,sf_12t_half_ppr_no_tep,1,40,2026-07-16,true`,
      message: /universe must be college or nfl/u,
    },
    {
      label: 'an unsupported position',
      csv: `${HEADER}\nArch Manning,college,K,Board,sf_12t_half_ppr_no_tep,1,40,2026-07-16,true`,
      message: /position must be QB, WR, RB, or TE/u,
    },
    {
      label: 'a non-positive rank',
      csv: `${HEADER}\nArch Manning,college,QB,Board,sf_12t_half_ppr_no_tep,0,40,2026-07-16,true`,
      message: /position_rank must be a positive integer/u,
    },
    {
      label: 'a non-ISO date',
      csv: `${HEADER}\nArch Manning,college,QB,Board,sf_12t_half_ppr_no_tep,1,40,07/16/2026,true`,
      message: /as_of must use YYYY-MM-DD/u,
    },
    {
      label: 'an impossible calendar date',
      csv: `${HEADER}\nArch Manning,college,QB,Board,sf_12t_half_ppr_no_tep,1,40,2026-02-31,true`,
      message: /as_of must use YYYY-MM-DD/u,
    },
    {
      label: 'a rank larger than its source universe',
      csv: `${HEADER}\nArch Manning,college,QB,Board,sf_12t_half_ppr_no_tep,41,40,2026-07-16,true`,
      message: /position_rank cannot exceed position_universe_size/u,
    },
    {
      label: 'a missing rights attestation',
      csv: `${HEADER}\nArch Manning,college,QB,Board,sf_12t_half_ppr_no_tep,1,40,2026-07-16,false`,
      message: /rights_attested must be true/u,
    },
  ])('rejects $label', ({ csv, message }) => {
    expect(() => parseMarketRankingsCsv(csv)).toThrow(message)
  })

  it('rejects duplicate provider rows after suffix and punctuation normalization', () => {
    const csv = [
      HEADER,
      'Terrance Carter Jr.,college,TE,Licensed Board,sf_12t_half_ppr_no_tep,8,40,2026-07-15,true',
      'Terrance Carter III,college,TE,licensed board,sf_12t_half_ppr_no_tep,9,40,2026-07-16,true',
    ].join('\n')

    expect(() => parseMarketRankingsCsv(csv)).toThrow(
      'The CSV contains duplicate player, universe, position, source, and format rows.',
    )
  })

  it.each(['KTC', 'Keep Trade Cut', 'Dynasty Daddy', 'ADP Daddy'])('rejects restricted source alias %s', (source) => {
    const csv = `${HEADER}\nArch Manning,college,QB,${source},sf_12t_half_ppr_no_tep,1,40,2026-07-16,true`
    expect(() => parseMarketRankingsCsv(csv)).toThrow(/link-only until written reuse permission exists/u)
  })
})

describe('football market consensus isolation', () => {
  it('uses only matching player, universe, and position rows', () => {
    const rankings = parseMarketRankingsCsv([
      HEADER,
      'Arch Manning,college,QB,Alpha Board,sf_12t_half_ppr_no_tep,2,20,2026-07-14,true',
      'Arch Manning,college,QB,Beta Board,sf_12t_half_ppr_no_tep,6,50,2026-07-16,true',
      'Arch Manning,college,QB,One QB Board,one_qb_12t_half_ppr_no_tep,1,30,2026-07-18,true',
      'Arch Manning,nfl,QB,NFL Board,sf_12t_half_ppr_no_tep,40,100,2026-07-17,true',
      'Arch Manning,college,WR,Receiver Board,sf_12t_half_ppr_no_tep,1,90,2026-07-18,true',
    ].join('\n'))

    const superflexConsensus = marketConsensusFor(
      rankings,
      'Arch Manning Jr.',
      'college',
      'QB',
      'sf_12t_half_ppr_no_tep',
    )
    expect(superflexConsensus).toMatchObject({
      positionRank: 4,
      sourceCount: 2,
      sources: ['Alpha Board', 'Beta Board'],
      asOf: '2026-07-16',
    })
    expect(superflexConsensus?.positionPercentile).toBeCloseTo(92.2664, 4)
    expect(marketConsensusFor(rankings, 'Arch Manning', 'college', 'QB', 'one_qb_12t_half_ppr_no_tep')).toMatchObject({
      positionRank: 1,
      positionPercentile: 100,
      sourceCount: 1,
    })
    expect(marketConsensusFor(rankings, 'Arch Manning', 'nfl', 'QB', 'sf_12t_half_ppr_no_tep')).toMatchObject({
      positionRank: 40,
      sourceCount: 1,
    })
    expect(marketConsensusFor(rankings, 'Arch Manning', 'college', 'TE', 'sf_12t_half_ppr_no_tep')).toBeNull()
    expect(marketConsensusFor(rankings, 'Dante Moore', 'college', 'QB', 'sf_12t_half_ppr_no_tep')).toBeNull()
  })
})
