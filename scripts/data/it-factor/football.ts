import {
  normalizeItFactorName,
  type ItFactorStatus,
  type ItFactorTier,
  type ItFactorTrajectory,
} from '../../../src/domain/itFactor.js'
import { IT_FACTOR_EXPECTED_TEAMS } from './teams.js'
import type {
  ItFactorCurationEntry,
  ItFactorLeagueCuration,
} from './types.js'

const AFC_EAST_CAMP = 'nfl-afc-east-camp-2026-07-06'
const AFC_NORTH_CAMP = 'nfl-afc-north-camp-2026-07-07'
const AFC_SOUTH_CAMP = 'nfl-afc-south-camp-2026-07-08'
const AFC_WEST_CAMP = 'nfl-afc-west-camp-2026-07-09'
const NFC_EAST_CAMP = 'nfl-nfc-east-camp-2026-07-13'
const NFC_NORTH_CAMP = 'nfl-nfc-north-camp-2026-07-14'
const NFC_SOUTH_CAMP = 'nfl-nfc-south-camp-2026-07-15'
const NFC_WEST_CAMP = 'nfl-nfc-west-camp-2026-07-16'
const FREE_AGENCY = 'nfl-free-agency-2026-07-20'
const DRAFT = 'nfl-draft-first-round-2026-04-23'
const FLAGSHIP = 'nfl-topps-flagship-2026-07-15'
const QB_RANKS = 'nfl-qb-rankings-2026-07-13'
const RB_RANKS = 'nfl-rb-rankings-2026-07-14'
const WR_RANKS = 'nfl-wr-rankings-2026-07-15'
const TE_RANKS = 'nfl-te-rankings-2026-07-16'
const DYNASTY_QB = 'nfl-dynasty-qb-rankings-2026-05-12'
const ROOKIE_CONSENSUS = 'nfl-rookie-consensus-2026-07-26'
const DYNASTY_ALL = 'nfl-dynasty-cheat-sheet-2026'
const AWARDS = 'nfl-2025-awards-2026-02-05'
const SUPER_BOWL_FREE_AGENCY = 'nfl-super-bowl-free-agency-2026-03-09'
const MAYE_MARKET = 'nfl-drake-maye-card-market-2026-01-27'
const CARD_WATCH = 'nfl-card-watch-2026-07-07'
const MENDOZA_TOPPS = 'nfl-fernando-mendoza-topps-now-2026-04-23'
const LOVE_TOPPS = 'nfl-jeremiyah-love-topps-now-2026-04-23'
const RICHARDSON_MARKET = 'nfl-anthony-richardson-hobby-2024-09-05'
const WILLIS_PROFILE = 'nfl-malik-willis-dolphins-2026-03-12'
const STEELERS_RECEIVERS = 'nfl-steelers-receivers-2026-07-12'

const CAMP_SOURCE_BY_TEAM = new Map<string, string>([
  ['BUF', AFC_EAST_CAMP],
  ['MIA', AFC_EAST_CAMP],
  ['NE', AFC_EAST_CAMP],
  ['NYJ', AFC_EAST_CAMP],
  ['BAL', AFC_NORTH_CAMP],
  ['CIN', AFC_NORTH_CAMP],
  ['CLE', AFC_NORTH_CAMP],
  ['PIT', AFC_NORTH_CAMP],
  ['HOU', AFC_SOUTH_CAMP],
  ['IND', AFC_SOUTH_CAMP],
  ['JAX', AFC_SOUTH_CAMP],
  ['TEN', AFC_SOUTH_CAMP],
  ['DEN', AFC_WEST_CAMP],
  ['KC', AFC_WEST_CAMP],
  ['LV', AFC_WEST_CAMP],
  ['LAC', AFC_WEST_CAMP],
  ['DAL', NFC_EAST_CAMP],
  ['NYG', NFC_EAST_CAMP],
  ['PHI', NFC_EAST_CAMP],
  ['WAS', NFC_EAST_CAMP],
  ['CHI', NFC_NORTH_CAMP],
  ['DET', NFC_NORTH_CAMP],
  ['GB', NFC_NORTH_CAMP],
  ['MIN', NFC_NORTH_CAMP],
  ['ATL', NFC_SOUTH_CAMP],
  ['CAR', NFC_SOUTH_CAMP],
  ['NO', NFC_SOUTH_CAMP],
  ['TB', NFC_SOUTH_CAMP],
  ['ARI', NFC_WEST_CAMP],
  ['LAR', NFC_WEST_CAMP],
  ['SF', NFC_WEST_CAMP],
  ['SEA', NFC_WEST_CAMP],
])

function tierFor(score: number): ItFactorTier {
  if (score >= 92) return 'icon'
  if (score >= 84) return 'high'
  if (score >= 74) return 'emerging'
  return 'watch'
}

function recheckTriggersFor(
  position: string,
  status: ItFactorStatus,
  trajectory: ItFactorTrajectory,
): string[] {
  if (status === 'rookie') {
    return [
      'Licensed rookie-card demand after the August 21 flagship launch.',
      'First sustained NFL role, depth-chart change, or early award push.',
    ]
  }
  if (trajectory === 'fragile') {
    return [
      'Depth-chart, trade, contract, or health-status change.',
      'Material reversal in hobby-sales velocity or consensus standing.',
    ]
  }
  if (position.includes('QB')) {
    return [
      'Franchise-quarterback status, playoff, award, or injury inflection.',
      'Material movement in quarterback-card sales or consensus rank.',
    ]
  }
  if (status === 'young_star') {
    return [
      'Breakout, award, injury, extension, or team-context inflection.',
      'Material change in young-player hobby-sales momentum.',
    ]
  }
  return [
    'Award, milestone, injury, retirement, or team-context inflection.',
    'Material change in cross-cycle hobby demand.',
  ]
}

function f(
  teamCode: string,
  playerName: string,
  position: string,
  status: ItFactorStatus,
  score: number,
  confidence: number,
  trajectory: ItFactorTrajectory,
  rationale: string,
  signals: string[],
  sourceIds: string[],
): ItFactorCurationEntry {
  const team = IT_FACTOR_EXPECTED_TEAMS.football.find(
    (candidate) => candidate.code === teamCode,
  )
  if (!team) throw new Error(`Unknown NFL team ${teamCode}`)
  const campSource = CAMP_SOURCE_BY_TEAM.get(teamCode)
  if (!campSource) throw new Error(`Missing NFL camp source for ${teamCode}`)
  return {
    id: `nfl-${teamCode.toLocaleLowerCase('en-US')}-${
      normalizeItFactorName(playerName).replaceAll(' ', '-')
    }`,
    playerName,
    sport: 'football',
    league: 'NFL',
    teamCode,
    teamName: team.name,
    position,
    status,
    score,
    tier: tierFor(score),
    confidence,
    trajectory,
    rationale,
    signals,
    recheckTriggers: recheckTriggersFor(position, status, trajectory),
    sourceIds: [...new Set([campSource, ...sourceIds])],
  }
}

export const footballItFactorCuration: ItFactorLeagueCuration = {
  sources: [
    {
      id: AFC_EAST_CAMP,
      label: '2026 AFC East training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/afc-east-training-camp-2026-preview-bills-dolphins-patriots-jets',
      publishedAt: '2026-07-06',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: AFC_NORTH_CAMP,
      label: '2026 AFC North training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/afc-north-training-camp-2026-preview-ravens-bengals-browns-steelers',
      publishedAt: '2026-07-07',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: AFC_SOUTH_CAMP,
      label: '2026 AFC South training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/afc-south-training-camp-2026-preview-texans-colts-jaguars-titans',
      publishedAt: '2026-07-08',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: AFC_WEST_CAMP,
      label: '2026 AFC West training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/afc-west-training-camp-2026-preview-broncos-raiders-chargers-chiefs',
      publishedAt: '2026-07-09',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: NFC_EAST_CAMP,
      label: '2026 NFC East training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/nfc-east-training-camp-2026-preview-cowboys-giants-eagles-commanders',
      publishedAt: '2026-07-13',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: NFC_NORTH_CAMP,
      label: '2026 NFC North training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/nfc-north-training-camp-2026-preview-bears-lions-packers-vikings',
      publishedAt: '2026-07-14',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: NFC_SOUTH_CAMP,
      label: '2026 NFC South training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/nfc-south-training-camp-2026-preview-falcons-panthers-saints-buccaneers',
      publishedAt: '2026-07-15',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: NFC_WEST_CAMP,
      label: '2026 NFC West training camp preview and roster storylines',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/nfc-west-training-camp-2026-preview-cardinals-rams-49ers-seahawks',
      publishedAt: '2026-07-16',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: FREE_AGENCY,
      label: '2026 NFL free-agency, signing, and trade tracker',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/2026-nfl-free-agency-tracker-latest-signings-trades-contract-info-for-all-32-teams',
      publishedAt: '2026-07-20',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: DRAFT,
      label: '2026 NFL Draft first-round selections and analysis',
      publisher: 'Associated Press',
      url: 'https://apnews.com/article/nfl-draft-pittsburgh-mendoza-c69763dbea64665a5806bab697fa27df',
      publishedAt: '2026-04-23',
      accessedAt: '2026-07-26',
      kind: 'news',
    },
    {
      id: FLAGSHIP,
      label: '2026 Topps Flagship Football checklist and product preview',
      publisher: 'Beckett',
      url: 'https://www.beckett.com/news/2026-topps-flagship-football-cards/',
      publishedAt: '2026-07-15',
      accessedAt: '2026-07-26',
      kind: 'hobby_market',
    },
    {
      id: QB_RANKS,
      label: 'Fantasy football quarterback tiers for the 2026 season',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/fantasy-football-qb-rankings-for-2026-nfl-season-draft-tiers-and-analysis',
      publishedAt: '2026-07-13',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: RB_RANKS,
      label: 'Fantasy football running back tiers for the 2026 season',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/fantasy-football-rb-rankings-for-2026-nfl-season-draft-tiers-and-analysis',
      publishedAt: '2026-07-14',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: WR_RANKS,
      label: 'Fantasy football wide receiver tiers for the 2026 season',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/fantasy-football-wr-rankings-for-2026-nfl-season-draft-tiers-and-analysis',
      publishedAt: '2026-07-15',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: TE_RANKS,
      label: 'Fantasy football tight end tiers for the 2026 season',
      publisher: 'NFL.com',
      url: 'https://www.nfl.com/news/fantasy-football-te-rankings-for-2026-nfl-season-draft-tiers-and-analysis',
      publishedAt: '2026-07-16',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: DYNASTY_QB,
      label: 'Post-draft dynasty quarterback rankings for 2026',
      publisher: 'Sports Illustrated',
      url: 'https://www.si.com/fantasy/drake-maye-moves-up-2026-fantasy-quarterback-dynasty-rankings',
      publishedAt: '2026-05-12',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: ROOKIE_CONSENSUS,
      label: 'Community and trade-derived 2026 rookie consensus rankings',
      publisher: 'Dynasty Dealer',
      url: 'https://www.dynastydealer.com/rookie-rankings/2026',
      publishedAt: '2026-07-26',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: DYNASTY_ALL,
      label: '2026 fantasy football dynasty cheat sheet',
      publisher: 'ESPN',
      url: 'https://g.espncdn.com/s/ffldraftkit/26/NFL26_CS_Dyn.pdf?adddata=2026CS_Dyn',
      publishedAt: null,
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: AWARDS,
      label: '2025 NFL Honors award winners and voting results',
      publisher: 'Associated Press',
      url: 'https://apnews.com/article/1f6a4d94a8ffcdd5844855c5d4ba510a',
      publishedAt: '2026-02-05',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: SUPER_BOWL_FREE_AGENCY,
      label: 'Super Bowl MVP Kenneth Walker headlines 2026 free agency',
      publisher: 'Associated Press',
      url: 'https://apnews.com/article/84b4832552cdeafc134ff317520c9982',
      publishedAt: '2026-03-09',
      accessedAt: '2026-07-26',
      kind: 'news',
    },
    {
      id: MAYE_MARKET,
      label: 'Drake Maye rookie cards reprice ahead of Super Bowl LX',
      publisher: 'Sports Illustrated',
      url: 'https://www.si.com/collectibles/drake-maye-rcs-explode-with-record-prices-ahead-of-super-bowl-lx',
      publishedAt: '2026-01-27',
      accessedAt: '2026-07-26',
      kind: 'hobby_market',
    },
    {
      id: CARD_WATCH,
      label: 'NFL cards with potential to move before the 2026 season',
      publisher: 'The Times of India',
      url: 'https://timesofindia.indiatimes.com/sports/nfl/news/sports-cards-that-could-explode-in-value-before-the-2026-nfl-season/articleshow/132228195.cms',
      publishedAt: '2026-07-07',
      accessedAt: '2026-07-26',
      kind: 'hobby_market',
    },
    {
      id: MENDOZA_TOPPS,
      label: 'Fernando Mendoza selected first overall Topps NOW card',
      publisher: 'Topps',
      url: 'https://www.topps.com/products/fernando-mendoza-2026-nfl-topps-now%C2%AE-card-fmen',
      publishedAt: '2026-04-23',
      accessedAt: '2026-07-26',
      kind: 'hobby_market',
    },
    {
      id: LOVE_TOPPS,
      label: 'Jeremiyah Love selected third overall Topps NOW card',
      publisher: 'Topps',
      url: 'https://www.topps.com/products/jeremiyah-love-2026-nfl-topps-now%C2%AE-card-jlov',
      publishedAt: '2026-04-23',
      accessedAt: '2026-07-26',
      kind: 'hobby_market',
    },
    {
      id: RICHARDSON_MARKET,
      label: 'Anthony Richardson football-card grading and hobby demand',
      publisher: 'Axios',
      url: 'https://www.axios.com/newsletters/axios-indianapolis-63cfd5a0-6b77-11ef-9810-bd22d2e292bf',
      publishedAt: '2024-09-05',
      accessedAt: '2026-07-26',
      kind: 'hobby_market',
    },
    {
      id: WILLIS_PROFILE,
      label: 'Miami Dolphins Malik Willis signing profile',
      publisher: 'Miami Dolphins',
      url: 'https://www.miamidolphins.com/news/fast-facts-malik-willis',
      publishedAt: '2026-03-12',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: STEELERS_RECEIVERS,
      label: 'Pittsburgh Steelers 2026 wide receiver preview',
      publisher: 'Pittsburgh Steelers',
      url: 'https://www.steelers.com/news/pre-camp-position-previews-wide-receiver',
      publishedAt: '2026-07-12',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
  ],
  entries: [
    // AFC East — Buffalo Bills
    f('BUF', 'Josh Allen', 'QB', 'established_star', 99, 100, 'holding',
      'Allen combines perennial MVP ceiling, singular arm-and-run highlights, and the hobby liquidity of a permanent franchise face.',
      ['MVP ceiling', 'elite QB liquidity', 'visible tools', 'franchise face'],
      [QB_RANKS, FLAGSHIP]),

    // AFC East — Miami Dolphins
    f('MIA', 'De’Von Achane', 'RB', 'young_star', 85, 91, 'holding',
      'Track speed and breakaway highlights give Achane visible star tools, while a top-six current running back rank validates the story.',
      ['elite speed', 'breakaway highlights', 'top-six RB', 'hobby confirmed'],
      [RB_RANKS]),
    f('MIA', 'Malik Willis', 'QB', 'established_star', 68, 82, 'fragile',
      'A new starting opportunity and old first-round-tool conversation preserve quarterback dream equity, but the proof and role remain fragile.',
      ['QB opportunity', 'tool pedigree', 'reclamation story', 'role risk'],
      [WILLIS_PROFILE, QB_RANKS]),

    // AFC East — New England Patriots
    f('NE', 'Drake Maye', 'QB', 'young_star', 91, 100, 'rising',
      'Top-three pedigree, an MVP-runner-up Super Bowl season, and explosive rookie-card repricing make Maye the clearest near-icon riser.',
      ['top-three pick', 'MVP runner-up', 'Super Bowl visibility', 'hobby acceleration'],
      [MAYE_MARKET, QB_RANKS]),
    f('NE', 'TreVeyon Henderson', 'RB', 'young_star', 80, 87, 'rising',
      'First-round pedigree, elite speed, and national playoff exposure have produced unusually strong young-running-back hobby demand.',
      ['first-round pedigree', 'elite speed', 'playoff visibility', 'hobby confirmed'],
      [RB_RANKS, FLAGSHIP]),

    // AFC East — New York Jets
    f('NYJ', 'Garrett Wilson', 'WR', 'established_star', 84, 85, 'holding',
      'Top-ten pedigree, Rookie of the Year validation, and repeated breakout framing keep Wilson’s superstar ceiling narrative alive.',
      ['top-ten pick', 'rookie award', 'WR1 role', 'residual ceiling'],
      [WR_RANKS, FLAGSHIP]),
    f('NYJ', 'Breece Hall', 'RB', 'established_star', 68, 78, 'fragile',
      'Rare power-speed highlights and early pedigree preserve residual demand, but the hobby has not matched his theoretical football ceiling.',
      ['power-speed tools', 'early pedigree', 'residual narrative', 'market gap'],
      [RB_RANKS]),
    f('NYJ', 'Kenyon Sadiq', 'TE', 'rookie', 76, 81, 'rising',
      'The draft’s first tight end pairs premium capital with receiving athleticism, creating a live rookie narrative despite positional limits.',
      ['No. 16 pick', 'first TE drafted', 'receiving tools', 'rookie runway'],
      [DRAFT, ROOKIE_CONSENSUS]),

    // AFC North — Baltimore Ravens
    f('BAL', 'Lamar Jackson', 'QB', 'established_star', 97, 100, 'holding',
      'Two-time MVP stature and unprecedented run-pass highlights give Jackson a permanent hobby identity even without a championship.',
      ['multiple MVPs', 'singular play style', 'elite QB demand', 'durable narrative'],
      [QB_RANKS, FLAGSHIP]),
    f('BAL', 'Derrick Henry', 'RB', 'established_star', 93, 98, 'holding',
      'The King Henry brand, signature stiff-arms, milestones, and cross-team demand have transcended normal running back depreciation.',
      ['signature highlights', 'milestone chase', 'strong personal brand', 'durable demand'],
      [RB_RANKS, FLAGSHIP]),

    // AFC North — Cincinnati Bengals
    f('CIN', 'Joe Burrow', 'QB', 'established_star', 98, 100, 'holding',
      'No. 1-pick pedigree, championship-stage proof, and celebrity-level visibility give Burrow durable premium quarterback demand.',
      ['No. 1 pick', 'championship stage', 'marketability', 'elite QB liquidity'],
      [QB_RANKS, CARD_WATCH]),
    f('CIN', 'Ja’Marr Chase', 'WR', 'established_star', 91, 98, 'holding',
      'Top-five pedigree, immediate historic production, and the Burrow connection locked Chase into the hobby’s highest receiver tier.',
      ['top-five pick', 'historic launch', 'elite receiver', 'QB connection'],
      [WR_RANKS, FLAGSHIP]),

    // AFC North — Cleveland Browns
    f('CLE', 'Shedeur Sanders', 'QB', 'young_star', 73, 95, 'fragile',
      'Football lineage, college visibility, personal branding, and quarterback speculation sustain major demand without a secure starting role.',
      ['football lineage', 'personal brand', 'QB speculation', 'role risk'],
      [FLAGSHIP, DYNASTY_QB]),
    f('CLE', 'KC Concepcion', 'WR', 'rookie', 74, 78, 'rising',
      'First-round capital and return-game electricity create an early formation case, though pre-licensed hobby demand remains notably thin.',
      ['first-round pick', 'return-game speed', 'rookie consensus', 'thin market'],
      [DRAFT, ROOKIE_CONSENSUS]),

    // AFC North — Pittsburgh Steelers
    f('PIT', 'Aaron Rodgers', 'QB', 'established_star', 94, 100, 'holding',
      'Four MVPs, a championship, iconic rookie cards, and a final-season storyline make Rodgers permanently collectible.',
      ['four MVPs', 'championship pedigree', 'last-dance catalyst', 'legacy demand'],
      [QB_RANKS, FLAGSHIP]),
    f('PIT', 'DK Metcalf', 'WR', 'established_star', 67, 80, 'fragile',
      'A superhero frame, speed, viral highlights, and broad recognition preserve visual IT, but current hobby scale is comparatively modest.',
      ['rare frame', 'elite speed', 'viral highlights', 'modest liquidity'],
      [STEELERS_RECEIVERS, WR_RANKS]),

    // AFC South — Houston Texans
    f('HOU', 'C.J. Stroud', 'QB', 'young_star', 86, 95, 'fragile',
      'The No. 2-pick and instant-rookie-star story remains locked despite regression, leaving substantial rebound optionality in the hobby.',
      ['No. 2 pick', 'historic rookie year', 'QB liquidity', 'rebound narrative'],
      [DYNASTY_QB, FLAGSHIP]),

    // AFC South — Indianapolis Colts
    f('IND', 'Jonathan Taylor', 'RB', 'established_star', 85, 90, 'holding',
      'An early rushing-title explosion, Wisconsin pedigree, and breakaway identity sustain a durable star narrative into his veteran prime.',
      ['rushing-title pedigree', 'breakaway tools', 'top-five RB', 'durable demand'],
      [RB_RANKS, FLAGSHIP]),
    f('IND', 'Anthony Richardson', 'QB', 'young_star', 69, 94, 'fragile',
      'Historic combine tools and top-five pedigree preserve residual dream equity, but reserve and trade uncertainty create extreme downside.',
      ['top-five pick', 'historic athleticism', 'residual demand', 'role risk'],
      [RICHARDSON_MARKET, DYNASTY_QB]),
    f('IND', 'Tyler Warren', 'TE', 'young_star', 80, 90, 'rising',
      'First-round capital, multi-use athleticism, and a top-five current tight end profile support uncommon hobby recognition for the position.',
      ['first-round pick', 'multi-use athlete', 'top-five TE', 'hobby confirmed'],
      [TE_RANKS, FLAGSHIP]),

    // AFC South — Jacksonville Jaguars
    f('JAX', 'Travis Hunter', 'CB/WR', 'young_star', 91, 100, 'holding',
      'Heisman fame, No. 2 pedigree, two-way novelty, elite tools, and personality make Hunter one of football’s most marketable young players.',
      ['Heisman pedigree', 'No. 2 pick', 'two-way novelty', 'marketability'],
      [FLAGSHIP, CARD_WATCH]),
    f('JAX', 'Trevor Lawrence', 'QB', 'established_star', 87, 96, 'rising',
      'Generational-prospect lock-in never disappeared, and a 2025 resurgence has reactivated the original franchise-quarterback mythology.',
      ['No. 1 pick', 'generational pedigree', 'rebound season', 'QB liquidity'],
      [DYNASTY_QB, QB_RANKS]),
    f('JAX', 'Brian Thomas Jr.', 'WR', 'young_star', 72, 83, 'fragile',
      'First-round pedigree and an explosive rookie season preserve ceiling demand, but a disappointing follow-up has slowed the ascent.',
      ['first-round pick', 'explosive rookie year', 'WR1 ceiling', 'rebound needed'],
      [WR_RANKS, FLAGSHIP]),

    // AFC South — Tennessee Titans
    f('TEN', 'Cam Ward', 'QB', 'young_star', 90, 99, 'rising',
      'No. 1-pick economics, improvisational highlights, charisma, and a new top-four receiver keep Ward among the hobby’s elite young quarterbacks.',
      ['No. 1 pick', 'improvisational tools', 'QB liquidity', 'new weapon'],
      [DYNASTY_QB, QB_RANKS]),
    f('TEN', 'Carnell Tate', 'WR', 'rookie', 81, 93, 'rising',
      'Top-four draft capital, Ohio State receiver pedigree, and immediate linkage to Cam Ward make Tate the class’s cleanest receiver story.',
      ['No. 4 pick', 'Ohio State pedigree', 'polished receiver', 'QB pairing'],
      [DRAFT, ROOKIE_CONSENSUS]),

    // AFC West — Denver Broncos
    f('DEN', 'Bo Nix', 'QB', 'young_star', 89, 99, 'rising',
      'First-round pedigree, immediate team success, mobility, and Sean Payton stability have converted doubt into a locked young-quarterback story.',
      ['first-round QB', 'early team success', 'mobility', 'elite hobby scale'],
      [DYNASTY_QB, QB_RANKS]),
    f('DEN', 'Jaylen Waddle', 'WR', 'established_star', 65, 77, 'fragile',
      'Top-six pedigree, track speed, and a new-offense reset preserve rebound optionality, though current demand trails premium receivers.',
      ['top-six pick', 'elite speed', 'new-team catalyst', 'rebound narrative'],
      [FREE_AGENCY, WR_RANKS]),

    // AFC West — Kansas City Chiefs
    f('KC', 'Patrick Mahomes', 'QB', 'established_star', 100, 100, 'holding',
      'Multiple titles and MVPs, signature improvisation, global visibility, and unmatched active-player liquidity define the football hobby benchmark.',
      ['multiple championships', 'multiple MVPs', 'league face', 'elite hobby scale'],
      [QB_RANKS, CARD_WATCH]),
    f('KC', 'Travis Kelce', 'TE', 'established_star', 95, 100, 'holding',
      'All-time positional production, the Mahomes dynasty, playoff moments, and crossover celebrity transcend ordinary tight end economics.',
      ['all-time TE', 'dynasty association', 'playoff identity', 'crossover fame'],
      [TE_RANKS, FLAGSHIP]),
    f('KC', 'Kenneth Walker III', 'RB', 'established_star', 74, 81, 'rising',
      'A Super Bowl MVP and move into the Mahomes spotlight create a fresh national story that the hobby has not yet fully repriced.',
      ['Super Bowl MVP', 'new-team catalyst', 'explosive runner', 'market lag'],
      [SUPER_BOWL_FREE_AGENCY, RB_RANKS]),

    // AFC West — Las Vegas Raiders
    f('LV', 'Fernando Mendoza', 'QB', 'rookie', 83, 100, 'rising',
      'Heisman, national-title, and No. 1-pick credentials plus Topps cover-level attention make Mendoza the dominant 2026 rookie card narrative.',
      ['Heisman winner', 'national champion', 'No. 1 pick', 'Topps demand'],
      [DRAFT, MENDOZA_TOPPS]),
    f('LV', 'Ashton Jeanty', 'RB', 'young_star', 89, 97, 'holding',
      'Rare college production, top-six draft capital, power-balance highlights, and elite non-quarterback liquidity lock in Jeanty’s young-star story.',
      ['top-six pick', 'rare production', 'power-balance tools', 'elite RB liquidity'],
      [RB_RANKS, FLAGSHIP]),
    f('LV', 'Brock Bowers', 'TE', 'young_star', 88, 97, 'holding',
      'Generational scouting language, historic early production, and a No. 1 tight end ranking have overcome much of the position discount.',
      ['generational pedigree', 'historic production', 'No. 1 TE', 'hobby confirmed'],
      [TE_RANKS, FLAGSHIP]),

    // AFC West — Los Angeles Chargers
    f('LAC', 'Justin Herbert', 'QB', 'established_star', 88, 98, 'holding',
      'Top-six pedigree, prototype tools, rocket-arm highlights, and recurring breakthrough framing sustain a large premium without a title run.',
      ['top-six pick', 'prototype tools', 'rocket arm', 'QB liquidity'],
      [DYNASTY_QB, QB_RANKS]),
    f('LAC', 'Ladd McConkey', 'WR', 'young_star', 84, 87, 'rising',
      'Separation polish, early playoff visibility, and an immediate Herbert connection created a faster star narrative than his draft slot predicted.',
      ['route polish', 'playoff visibility', 'QB connection', 'hobby forming'],
      [WR_RANKS, FLAGSHIP]),
    f('LAC', 'Omarion Hampton', 'RB', 'young_star', 80, 90, 'rising',
      'First-round capital, NFL-ready size-speed, and a clear feature-back runway support unusually strong young-running-back demand.',
      ['first-round pick', 'size-speed blend', 'feature role', 'hobby confirmed'],
      [RB_RANKS, FLAGSHIP]),

    // NFC East — Dallas Cowboys
    f('DAL', 'CeeDee Lamb', 'WR', 'established_star', 90, 97, 'holding',
      'Dallas visibility, first-round pedigree, spectacular catch-and-run tools, and an established star brand support elite receiver demand.',
      ['Dallas visibility', 'first-round pick', 'elite receiver', 'durable demand'],
      [WR_RANKS, FLAGSHIP]),
    f('DAL', 'Dak Prescott', 'QB', 'established_star', 84, 91, 'holding',
      'Cowboys quarterback exposure and a long-running franchise-face identity support durable demand despite a capped postseason narrative.',
      ['Cowboys QB', 'franchise face', 'veteran liquidity', 'postseason ceiling'],
      [DYNASTY_QB, QB_RANKS]),
    f('DAL', 'Caleb Downs', 'S', 'rookie', 75, 84, 'rising',
      'Elite safety reputation, famous football lineage, Ohio State visibility, and Dallas trading up create uncommon defensive-player narrative.',
      ['No. 11 pick', 'football lineage', 'Dallas visibility', 'position tax'],
      [DRAFT, CARD_WATCH]),

    // NFC East — New York Giants
    f('NYG', 'Jaxson Dart', 'QB', 'young_star', 91, 100, 'rising',
      'First-round pedigree, New York exposure, early breakout play, mobility, and personality have produced elite young-quarterback hobby scale.',
      ['first-round QB', 'New York market', 'mobility', 'elite hobby scale'],
      [DYNASTY_QB, QB_RANKS]),
    f('NYG', 'Malik Nabers', 'WR', 'young_star', 87, 94, 'holding',
      'Top-six pedigree, immediate target dominance, explosive open-field tools, and the Dart pairing preserve a broad superstar path.',
      ['top-six pick', 'target dominance', 'open-field tools', 'young-QB pairing'],
      [WR_RANKS, FLAGSHIP]),
    f('NYG', 'Abdul Carter', 'EDGE', 'young_star', 78, 88, 'rising',
      'Top-five pedigree, Penn State visibility, and game-breaking pass-rush tools give Carter rare defensive-card upside despite position tax.',
      ['top-five pick', 'Penn State pedigree', 'pass-rush tools', 'defender ceiling'],
      [FLAGSHIP, DRAFT]),

    // NFC East — Philadelphia Eagles
    f('PHI', 'Jalen Hurts', 'QB', 'established_star', 90, 98, 'holding',
      'Championship-stage visibility, rushing-touchdown highlights, leadership branding, and the Eagles market sustain a locked premium.',
      ['championship stage', 'rushing identity', 'leadership brand', 'QB liquidity'],
      [QB_RANKS, FLAGSHIP]),
    f('PHI', 'Saquon Barkley', 'RB', 'established_star', 94, 99, 'holding',
      'No. 2-pick pedigree, generational athletic highlights, and championship imagery give Barkley permanent modern-running-back mythology.',
      ['No. 2 pick', 'generational tools', 'championship imagery', 'legacy demand'],
      [RB_RANKS, FLAGSHIP]),
    f('PHI', 'Makai Lemon', 'WR', 'rookie', 78, 89, 'rising',
      'First-round pedigree, USC visibility, a draft-day trade-up, and placement in an elite offense create a strong rookie launch platform.',
      ['first-round pick', 'USC pedigree', 'trade-up', 'elite offense'],
      [DRAFT, ROOKIE_CONSENSUS]),

    // NFC East — Washington Commanders
    f('WAS', 'Jayden Daniels', 'QB', 'young_star', 90, 99, 'holding',
      'Heisman and No. 2-pick pedigree, historic rookie impact, elite speed, and national exposure keep the premium intact through injury.',
      ['Heisman pedigree', 'No. 2 pick', 'elite speed', 'QB liquidity'],
      [QB_RANKS, CARD_WATCH]),

    // NFC North — Chicago Bears
    f('CHI', 'Caleb Williams', 'QB', 'young_star', 91, 100, 'rising',
      'No. 1-pick and Heisman pedigree, improvisational highlights, Chicago exposure, and a Madden cover supply nearly every IT input.',
      ['No. 1 pick', 'Heisman pedigree', 'Madden cover', 'elite hobby scale'],
      [QB_RANKS, CARD_WATCH]),
    f('CHI', 'Colston Loveland', 'TE', 'young_star', 82, 91, 'rising',
      'Top-ten pedigree, modern receiving traits, a Caleb Williams pairing, and unusually large tight end demand support a premium young narrative.',
      ['top-ten pick', 'receiving tools', 'young-QB pairing', 'strong TE market'],
      [TE_RANKS, FLAGSHIP]),

    // NFC North — Detroit Lions
    f('DET', 'Jahmyr Gibbs', 'RB', 'young_star', 89, 97, 'holding',
      'No. 12-pick surprise, instant validation, elite acceleration, and receiving versatility created a strong early hobby lock.',
      ['No. 12 pick', 'elite acceleration', 'receiving versatility', 'hobby confirmed'],
      [RB_RANKS, DYNASTY_ALL]),
    f('DET', 'Amon-Ra St. Brown', 'WR', 'established_star', 87, 94, 'holding',
      'The overlooked-to-superstar story, distinctive personality, consistency, and Detroit’s cultural rise provide brand power beyond statistics.',
      ['underdog story', 'distinctive personality', 'elite receiver', 'durable demand'],
      [WR_RANKS, DYNASTY_ALL]),

    // NFC North — Green Bay Packers
    f('GB', 'Jordan Love', 'QB', 'established_star', 85, 94, 'holding',
      'First-round pedigree, the Rodgers-successor apprenticeship, playoff flashes, and Green Bay quarterback lineage sustain a durable ceiling story.',
      ['first-round QB', 'succession story', 'playoff flashes', 'franchise lineage'],
      [DYNASTY_QB, QB_RANKS]),
    f('GB', 'Micah Parsons', 'EDGE', 'established_star', 84, 92, 'rising',
      'Rare rookie-year lock-in, game-breaking speed, personality, and a blockbuster Green Bay move make Parsons a scarce defensive hobby star.',
      ['elite defender', 'visible speed', 'marketability', 'blockbuster move'],
      [FREE_AGENCY, FLAGSHIP]),
    f('GB', 'Matthew Golden', 'WR', 'young_star', 79, 88, 'rising',
      'First-round pedigree, speed, and young-quarterback linkage have produced hobby activity much larger than his established production.',
      ['first-round pick', 'speed', 'young-QB pairing', 'hobby ahead of proof'],
      [WR_RANKS, FLAGSHIP]),

    // NFC North — Minnesota Vikings
    f('MIN', 'Justin Jefferson', 'WR', 'established_star', 96, 100, 'holding',
      'Record pace, signature catches, crossover celebration identity, and sustained WR1 consensus make Jefferson a permanent non-quarterback icon.',
      ['record pace', 'signature highlights', 'crossover identity', 'elite WR demand'],
      [WR_RANKS, DYNASTY_ALL]),
    f('MIN', 'J.J. McCarthy', 'QB', 'young_star', 72, 94, 'fragile',
      'National-title and top-ten pedigree sustain substantial quarterback demand despite limited proof and a newly added veteran challenger.',
      ['national champion', 'top-ten pick', 'QB speculation', 'competition risk'],
      [DYNASTY_QB, FREE_AGENCY]),
    f('MIN', 'Kyler Murray', 'QB', 'established_star', 67, 89, 'fragile',
      'No. 1-pick and Heisman pedigree plus rare athletic highlights preserve a redemption narrative, but the Minnesota job is unresolved.',
      ['No. 1 pick', 'Heisman pedigree', 'rare athleticism', 'competition risk'],
      [DYNASTY_QB, FREE_AGENCY]),

    // NFC South — Atlanta Falcons
    f('ATL', 'Bijan Robinson', 'RB', 'young_star', 90, 98, 'holding',
      'Top-ten pedigree, generational receiving-and-rushing language, impossible-cut highlights, and top-two consensus support a locked star story.',
      ['top-ten pick', 'generational tools', 'top-two RB', 'hobby confirmed'],
      [RB_RANKS, FLAGSHIP]),
    f('ATL', 'Michael Penix Jr.', 'QB', 'young_star', 71, 93, 'fragile',
      'Top-ten draft capital, national-title-stage visibility, and rare arm talent preserve demand, but knee recovery and competition add major risk.',
      ['top-ten pick', 'national-stage pedigree', 'arm talent', 'health risk'],
      [DYNASTY_QB, FREE_AGENCY]),
    f('ATL', 'Tua Tagovailoa', 'QB', 'established_star', 66, 88, 'fragile',
      'Alabama fame, top-five pedigree, and a new Atlanta redemption story preserve recognizable demand despite health and bridge-role concerns.',
      ['Alabama pedigree', 'top-five pick', 'new-team reset', 'health risk'],
      [FREE_AGENCY, DYNASTY_QB]),

    // NFC South — Carolina Panthers
    f('CAR', 'Tetairoa McMillan', 'WR', 'young_star', 89, 97, 'rising',
      'Top-ten pedigree, prototype size, contested-catch highlights, and Offensive Rookie of the Year validation rapidly locked a star narrative.',
      ['top-ten pick', 'prototype size', 'rookie award', 'elite WR demand'],
      [AWARDS, WR_RANKS]),
    f('CAR', 'Bryce Young', 'QB', 'young_star', 68, 90, 'fragile',
      'Heisman and No. 1-pick lock-in plus a late rebound keep the franchise-quarterback dream alive, though uneven proof has eroded the premium.',
      ['Heisman pedigree', 'No. 1 pick', 'rebound signs', 'prove-it season'],
      [DYNASTY_QB, QB_RANKS]),

    // NFC South — New Orleans Saints
    f('NO', 'Tyler Shough', 'QB', 'young_star', 83, 98, 'rising',
      'A late rookie surge, franchise-quarterback language, and unusually large sales created the board’s clearest new quarterback narrative wave.',
      ['late rookie breakout', 'QB1 role', 'franchise language', 'hobby acceleration'],
      [DYNASTY_QB, QB_RANKS]),
    f('NO', 'Jordyn Tyson', 'WR', 'rookie', 80, 92, 'rising',
      'Top-ten capital, size and production, and immediate placement beside Shough create a coherent young-offense story before licensed cards.',
      ['No. 8 pick', 'size-production blend', 'young-QB pairing', 'pre-market'],
      [DRAFT, ROOKIE_CONSENSUS]),

    // NFC South — Tampa Bay Buccaneers
    f('TB', 'Emeka Egbuka', 'WR', 'young_star', 82, 95, 'rising',
      'Ohio State pedigree, first-round status, polished early production, and a larger post-Evans role have produced clear hobby acceleration.',
      ['first-round pick', 'Ohio State pedigree', 'expanded role', 'hobby acceleration'],
      [WR_RANKS, FLAGSHIP]),
    f('TB', 'Baker Mayfield', 'QB', 'established_star', 84, 87, 'holding',
      'No. 1-pick and Heisman personality plus a Tampa redemption story give Mayfield a real, though performance-sensitive, collector identity.',
      ['No. 1 pick', 'Heisman pedigree', 'redemption story', 'QB liquidity'],
      [DYNASTY_QB, QB_RANKS]),

    // NFC West — Arizona Cardinals
    f('ARI', 'Jeremiyah Love', 'RB', 'rookie', 83, 99, 'rising',
      'Historic top-three running back capital, explosive tape, Notre Dame visibility, and consensus No. 1 rookie status drive the class’s top non-QB story.',
      ['No. 3 pick', 'explosive tools', 'Notre Dame pedigree', 'No. 1 rookie'],
      [DRAFT, LOVE_TOPPS, ROOKIE_CONSENSUS]),
    f('ARI', 'Marvin Harrison Jr.', 'WR', 'young_star', 72, 95, 'fragile',
      'Famous lineage, immaculate prospect credentials, and top-four capital preserve substantial residual demand after disappointing production.',
      ['famous lineage', 'top-four pick', 'can’t-miss pedigree', 'eroding narrative'],
      [CARD_WATCH, WR_RANKS]),

    // NFC West — Los Angeles Rams
    f('LAR', 'Puka Nacua', 'WR', 'young_star', 90, 99, 'rising',
      'Historic early production, fan-favorite physicality, playoff visibility, and top-overall dynasty value have overcome late-draft pedigree.',
      ['historic launch', 'playoff visibility', 'marketability', 'elite WR demand'],
      [WR_RANKS, DYNASTY_ALL]),
    f('LAR', 'Matthew Stafford', 'QB', 'established_star', 86, 96, 'rising',
      'No. 1-pick arm talent, a title, a late-career MVP, and Hall of Fame debate have pulled the hobby narrative closer to his résumé.',
      ['No. 1 pick', 'championship pedigree', 'reigning MVP', 'legacy rerating'],
      [AWARDS, QB_RANKS]),
    f('LAR', 'Ty Simpson', 'QB', 'rookie', 70, 93, 'fragile',
      'First-round quarterback scarcity, Alabama branding, and a McVay-Stafford succession path create a powerful but highly speculative dream case.',
      ['No. 13 pick', 'Alabama pedigree', 'QB scarcity', 'succession story'],
      [DRAFT, ROOKIE_CONSENSUS]),

    // NFC West — San Francisco 49ers
    f('SF', 'Christian McCaffrey', 'RB', 'established_star', 94, 99, 'holding',
      'Football lineage, top-ten pedigree, receiving-and-rushing uniqueness, and championship imagery make McCaffrey a permanent modern running back.',
      ['football lineage', 'dual-threat identity', 'award pedigree', 'legacy demand'],
      [RB_RANKS, FLAGSHIP]),
    f('SF', 'Brock Purdy', 'QB', 'young_star', 86, 95, 'holding',
      'The Mr. Irrelevant-to-contender story, early Super Bowl stage, and quarterback economics sustain demand despite nonexistent draft pedigree.',
      ['underdog story', 'Super Bowl stage', 'winning identity', 'QB liquidity'],
      [DYNASTY_QB, QB_RANKS]),
    f('SF', 'Mike Evans', 'WR', 'established_star', 92, 98, 'holding',
      'A record 1,000-yard streak, championship, signature contested catches, and Hall of Fame certainty create permanent collector relevance.',
      ['historic consistency', 'championship pedigree', 'signature catches', 'Hall of Fame path'],
      [SUPER_BOWL_FREE_AGENCY, WR_RANKS]),

    // NFC West — Seattle Seahawks
    f('SEA', 'Jaxon Smith-Njigba', 'WR', 'young_star', 90, 99, 'rising',
      'First-round and Ohio State pedigree, a 1,793-yard season, Offensive Player of the Year, and Super Bowl visibility complete the ceiling story.',
      ['first-round pick', 'Ohio State pedigree', 'OPOY', 'Super Bowl visibility'],
      [AWARDS, WR_RANKS]),
    f('SEA', 'Sam Darnold', 'QB', 'established_star', 69, 90, 'rising',
      'Former No. 3-pick mythology and an improbable championship resurrection create a compelling late-forming story that remains performance-sensitive.',
      ['No. 3 pick', 'career resurrection', 'Super Bowl champion', 'late-forming market'],
      [DYNASTY_QB, QB_RANKS]),
    f('SEA', 'Jadarian Price', 'RB', 'rookie', 76, 87, 'rising',
      'First-round capital, Notre Dame speed, and the explicit task of replacing a Super Bowl MVP create immediate narrative leverage.',
      ['first-round pick', 'Notre Dame pedigree', 'speed', 'immediate runway'],
      [DRAFT, ROOKIE_CONSENSUS]),
  ],
}
