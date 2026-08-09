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

const TOP_250 = 'nhl-top-250-2026-07-23'
const DYNASTY = 'nhl-dynasty-2026-07-17'
const ROOKIES = 'nhl-rookies-2026-07-16'
const DRAFT = 'nhl-draft-2026-06-27'
const CALDER = 'nhl-calder-2026-05-13'
const ALL_ROOKIE = 'nhl-all-rookie-2026-06-12'
const TRADES = 'nhl-trades-2026-07-01'
const CUP = 'nhl-cup-2026-06-15'
const CUP_GAME_2 = 'nhl-cup-final-game-2-2026-06-05'
const CBJ_TOP_PROSPECTS = 'nhl-blue-jackets-prospects-2025-08-08'
const LINDSTROM_UPDATE = 'nhl-lindstrom-update-2026-07-01'
const UTAH_TOP_PROSPECTS = 'nhl-utah-prospects-2025-08-28'
const UTAH_ROSTER_PUSH = 'nhl-utah-roster-push-2026-07-18'
const MARNER_TRADE = 'nhl-marner-trade-2025-07-01'
const KUCHEROV_HART = 'nhl-kucherov-hart-2026-06-11'
const HELLEBUYCK_HART = 'nhl-hellebuyck-hart-2025-06-12'
const EICHEL_FINAL = 'nhl-eichel-cup-final-2026-05-29'
const OVECHKIN = 'nhl-ovechkin-return-2026-07-02'

function tierFor(score: number): ItFactorTier {
  if (score >= 92) return 'icon'
  if (score >= 84) return 'high'
  if (score >= 74) return 'emerging'
  return 'watch'
}

function h(
  teamCode: string,
  playerName: string,
  position: string,
  status: ItFactorStatus,
  score: number,
  confidence: number,
  trajectory: ItFactorTrajectory,
  rationale: string,
  signals: string[],
  sourceIds: string[] = [TOP_250],
): ItFactorCurationEntry {
  const team = IT_FACTOR_EXPECTED_TEAMS.hockey.find(
    (candidate) => candidate.code === teamCode,
  )
  if (!team) throw new Error(`Unknown NHL team ${teamCode}`)
  return {
    id: `nhl-${teamCode.toLocaleLowerCase('en-US')}-${
      normalizeItFactorName(playerName).replaceAll(' ', '-')
    }`,
    playerName,
    sport: 'hockey',
    league: 'NHL',
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
    sourceIds,
  }
}

export const hockeyItFactorCuration: ItFactorLeagueCuration = {
  sources: [
    {
      id: TOP_250,
      label: 'Fantasy hockey top 250 player rankings for 2026-27',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/fantasy/nhl-fantasy-hockey-top-250-200-rankings-drafts-players-big-board-281505474',
      publishedAt: '2026-07-23',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: DYNASTY,
      label: 'Fantasy hockey keeper and dynasty rankings',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/nhl-fantasy-hockey-keeper-dynasty-league-rankings-players-prospects-291137298',
      publishedAt: '2026-07-17',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: ROOKIES,
      label: 'Fantasy hockey top 10 rookie rankings for 2026-27',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/fantasy/fantasy-hockey-top-10-rookie-rankings-for-2025-26-season',
      publishedAt: '2026-07-16',
      accessedAt: '2026-07-26',
      kind: 'consensus',
    },
    {
      id: DRAFT,
      label: '2026 NHL Draft first-round tracker and analysis',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/nhl-draft/2026-nhl-draft-first-round-tracker-analysis',
      publishedAt: '2026-06-27',
      accessedAt: '2026-07-26',
      kind: 'scouting',
    },
    {
      id: CALDER,
      label: 'Matthew Schaefer wins the 2026 Calder Trophy',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/new-york-islanders-matthew-schaefer-wins-2026-calder-trophy',
      publishedAt: '2026-05-13',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: ALL_ROOKIE,
      label: 'NHL announces the 2025-26 All-Rookie Team',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/nhl-awards/2025-26-nhl-all-rookie-team',
      publishedAt: '2026-06-12',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: TRADES,
      label: '2025-26 NHL trade tracker',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/trade-coverage/2025-26-nhl-trades',
      publishedAt: '2026-07-01',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: CUP,
      label: 'Carolina Hurricanes win the 2026 Stanley Cup',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/carolina-hurricanes-win-2026-stanley-cup-final',
      publishedAt: '2026-06-15',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: CUP_GAME_2,
      label: 'Jarvis scores in overtime in Game 2 of the 2026 Cup Final',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/vegas-golden-knights-carolina-hurricanes-stanley-cup-final-game-2-recap-june-4-2026',
      publishedAt: '2026-06-05',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: CBJ_TOP_PROSPECTS,
      label: 'Top prospects for the Columbus Blue Jackets',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/32-in-32/columbus-blue-jackets-top-prospects-for-2025-26-season-32-in-32',
      publishedAt: '2025-08-08',
      accessedAt: '2026-07-26',
      kind: 'scouting',
    },
    {
      id: LINDSTROM_UPDATE,
      label: 'Lindstrom continues recovery and development with Columbus',
      publisher: 'Columbus Blue Jackets',
      url: 'https://www.nhl.com/bluejackets/news/cayden-lindstrom-continues-to-work-his-way-back-blue-jackets',
      publishedAt: '2026-07-01',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: UTAH_TOP_PROSPECTS,
      label: 'Top prospects for the Utah Mammoth',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/utah-mammoth-top-prospects-for-2025-26-season-32-in-32',
      publishedAt: '2025-08-28',
      accessedAt: '2026-07-26',
      kind: 'scouting',
    },
    {
      id: UTAH_ROSTER_PUSH,
      label: 'Iginla and Desnoyers push for Utah roster spots',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/prospects/tij-iginla-caleb-desnoyers-eye-huge-impact-with-utah',
      publishedAt: '2026-07-18',
      accessedAt: '2026-07-26',
      kind: 'scouting',
    },
    {
      id: MARNER_TRADE,
      label: 'Golden Knights acquire Mitch Marner from Maple Leafs',
      publisher: 'Vegas Golden Knights',
      url: 'https://www.nhl.com/goldenknights/news/vegas-golden-knights-acquire-forward-mitch-marner-from-toronto-maple-leafs',
      publishedAt: '2025-07-01',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: KUCHEROV_HART,
      label: 'Nikita Kucherov wins the 2026 Hart Trophy',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/tampa-bay-lightning-nikita-kucherov-wins-hart-trophy-as-nhl-mvp',
      publishedAt: '2026-06-11',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: HELLEBUYCK_HART,
      label: 'Connor Hellebuyck wins the Hart and Vezina trophies',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/winnipeg-jets-connor-hellebuyck-wins-hart-trophy-as-nhl-mvp',
      publishedAt: '2025-06-12',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: EICHEL_FINAL,
      label: 'Eichel returns to the 2026 Cup Final with Vegas',
      publisher: 'NHL.com',
      url: 'https://www.nhl.com/news/topic/playoffs/jack-eichel-grateful-for-time-with-golden-knights-as-they-return-to-cup-final',
      publishedAt: '2026-05-29',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: OVECHKIN,
      label: 'Ovechkin re-signs with Washington for a 22nd season',
      publisher: 'Associated Press',
      url: 'https://apnews.com/article/2f1410cc72e150169fe3b07cc51eb574',
      publishedAt: '2026-07-02',
      accessedAt: '2026-07-26',
      kind: 'news',
    },
  ],
  entries: [
    // Anaheim Ducks
    h('ANA', 'Leo Carlsson', 'C', 'young_star', 86, 91, 'rising',
      'A No. 2 pick with a trophy-level ceiling now has both a top-seven dynasty case and firmly established hobby demand.',
      ['No. 2 pick', 'franchise center', 'elite two-way ceiling', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('ANA', 'Cutter Gauthier', 'LW', 'young_star', 82, 86, 'rising',
      'The big-shot, high-pedigree scorer ranks inside the NHL young-player elite and already carries one of Anaheim’s strongest card markets.',
      ['No. 5 pick', 'goal-scoring tools', 'young-player consensus', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('ANA', 'Beckett Sennecke', 'RW', 'young_star', 83, 88, 'rising',
      'The surprise No. 3 pick converted skepticism into a Calder-finalist season, while recent hobby dollars accelerated sharply.',
      ['No. 3 pick', 'Calder finalist', 'size-skill blend', 'hobby acceleration'],
      [DYNASTY, CALDER]),

    // Boston Bruins
    h('BOS', 'David Pastrnak', 'RW', 'established_star', 88, 94, 'holding',
      'Pastrnak remains Boston’s singular visible superstar, pairing a top-six current ranking with durable personality-driven hobby recognition.',
      ['franchise face', 'elite scorer', 'marketability', 'durable hobby demand']),
    h('BOS', 'James Hagens', 'C', 'rookie', 78, 81, 'rising',
      'A premium recent pick with speed, creativity, and a projected rookie role gives Boston its clearest new ceiling narrative.',
      ['high draft capital', 'creative center', 'rookie runway', 'national-team pedigree'],
      [DYNASTY, ROOKIES]),
    h('BOS', 'JJ Peterka', 'RW', 'young_star', 74, 76, 'rising',
      'The 2026 acquisition adds a young, explosive scorer whose fresh-market storyline can grow beside Boston’s established star.',
      ['young scorer', 'new-team catalyst', 'speed', 'narrative reset'],
      [TOP_250, TRADES]),

    // Buffalo Sabres
    h('BUF', 'Tage Thompson', 'C', 'established_star', 79, 86, 'holding',
      'Rare size, a highlight-reel shot, and prior 47-goal proof keep Thompson’s ceiling story alive even through uneven team stretches.',
      ['singular frame', 'elite shot', 'goal ceiling', 'hobby confirmed']),
    h('BUF', 'Zach Benson', 'LW', 'young_star', 74, 78, 'rising',
      'Benson’s youth, creativity, and top-half dynasty standing sustain a credible next-wave star narrative for Buffalo collectors.',
      ['young for level', 'playmaking', 'top-15 pedigree', 'hobby forming'],
      [TOP_250, DYNASTY]),
    h('BUF', 'Daxon Rudolph', 'D', 'prospect', 69, 72, 'rising',
      'The No. 4 pick was the first defenseman drafted in 2026 and owns the size, mobility, and host-city draft moment needed for early buzz.',
      ['No. 4 pick', 'first defenseman drafted', 'size and mobility', 'early narrative'],
      [DRAFT]),

    // Calgary Flames
    h('CGY', 'Zayne Parekh', 'D', 'young_star', 78, 82, 'rising',
      'An unusually creative offensive defenseman with premium draft capital and rising hobby sales looks capable of becoming Calgary’s visual star.',
      ['No. 9 pick', 'offensive defenseman', 'highlight tools', 'hobby acceleration'],
      [TOP_250, DYNASTY]),
    h('CGY', 'Dustin Wolf', 'G', 'young_star', 74, 82, 'holding',
      'Wolf’s Calder-caliber launch and underdog size narrative created uncommon hobby recognition for a young goaltender.',
      ['Calder pedigree', 'young starter', 'underdog story', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('CGY', 'Carson Carels', 'D', 'prospect', 67, 70, 'rising',
      'The sixth pick in the 2026 draft brings elite skating and major draft capital, but the hobby story is still pre-card and fragile.',
      ['No. 6 pick', 'elite skating', 'two-way ceiling', 'pre-market'],
      [DRAFT]),

    // Carolina Hurricanes
    h('CAR', 'Logan Stankoven', 'C', 'young_star', 80, 87, 'rising',
      'A compact, high-motor scorer became a visible playoff driver on the 2026 champion, adding team success to an already active hobby base.',
      ['Cup champion', 'playoff moments', 'high motor', 'hobby confirmed'],
      [TOP_250, DYNASTY, CUP]),
    h('CAR', 'Seth Jarvis', 'C', 'young_star', 78, 85, 'holding',
      'Jarvis pairs a top young-player consensus with a winning-market personality and a signature overtime moment during Carolina’s title run.',
      ['Cup champion', 'young core', 'clutch narrative', 'marketability'],
      [DYNASTY, CUP, CUP_GAME_2]),
    h('CAR', 'Jackson Blake', 'RW', 'young_star', 73, 76, 'rising',
      'A Stanley Cup breakout supplied the kind of visible postseason validation that can form a new hobby story around the young scorer.',
      ['Cup breakout', 'playoff visibility', 'young scorer', 'hobby acceleration'],
      [TOP_250, CUP]),

    // Chicago Blackhawks
    h('CHI', 'Connor Bedard', 'C', 'young_star', 95, 97, 'holding',
      'The generational No. 1 pick remains one of hockey’s permanent hobby identities, with demand that survives ordinary or injured stretches.',
      ['generational pedigree', 'No. 1 pick', 'franchise face', 'elite hobby scale'],
      [TOP_250, DYNASTY]),
    h('CHI', 'Frank Nazar', 'C', 'young_star', 80, 84, 'rising',
      'Nazar’s speed, offensive growth, and unusually strong young-player hobby volume make him Chicago’s clearest second narrative.',
      ['speed', 'young core', 'offensive growth', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('CHI', 'Anton Frondell', 'C', 'rookie', 78, 80, 'rising',
      'A recent top-three pick entering the season among the leading rookie candidates inherits immediate exposure beside Bedard.',
      ['top-three pick', 'rookie favorite', 'power center', 'Bedard halo'],
      [TOP_250, ROOKIES]),

    // Colorado Avalanche
    h('COL', 'Cale Makar', 'D', 'established_star', 95, 97, 'holding',
      'Makar is the hobby’s modern defenseman archetype: spectacular skating, awards, a Cup, and demand that transcends position.',
      ['generational defenseman', 'Cup champion', 'award pedigree', 'durable hobby demand']),
    h('COL', 'Nathan MacKinnon', 'C', 'established_star', 94, 97, 'holding',
      'The former No. 1 pick and perennial MVP candidate has a permanent power-and-speed story backed by top-tier hobby scale.',
      ['No. 1 pick', 'MVP ceiling', 'power and speed', 'durable hobby demand']),

    // Columbus Blue Jackets
    h('CBJ', 'Adam Fantilli', 'C', 'young_star', 82, 88, 'rising',
      'Fantilli’s No. 3 pedigree, size-speed package, and top-30 dynasty standing preserve a credible franchise-center ceiling.',
      ['No. 3 pick', 'franchise center', 'power-speed tools', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('CBJ', 'Cayden Lindstrom', 'C', 'prospect', 69, 69, 'fragile',
      'The No. 4 pick still has a rare power-center frame, but two injury-hit years and a quiet first NCAA season leave the original ceiling narrative fragile.',
      ['No. 4 pick', 'rare frame', 'power tools', 'health and production risk'],
      [CBJ_TOP_PROSPECTS, LINDSTROM_UPDATE]),

    // Dallas Stars
    h('DAL', 'Wyatt Johnston', 'C', 'young_star', 84, 91, 'rising',
      'Johnston’s youth, playoff scoring, and top-five dynasty status have moved him from excellent player to genuine face-level hobby story.',
      ['young star', 'playoff scorer', 'top-five dynasty', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('DAL', 'Mikko Rantanen', 'RW', 'established_star', 81, 88, 'holding',
      'Rantanen carries a proven championship power-wing identity and renewed visibility as a centerpiece in a major hockey market.',
      ['Cup pedigree', 'power winger', 'elite production', 'residual demand']),
    h('DAL', 'Jason Robertson', 'LW', 'young_star', 80, 87, 'holding',
      'A top-ten current ranking, distinctive scoring touch, and meaningful card activity keep Robertson above performance-only status.',
      ['elite scorer', 'top-ten current rank', 'young prime', 'hobby confirmed']),

    // Detroit Red Wings
    h('DET', 'Lucas Raymond', 'RW', 'young_star', 78, 84, 'rising',
      'Raymond’s No. 4 pedigree and growing offensive role sustain Detroit’s clearest young-forward star narrative.',
      ['No. 4 pick', 'young scorer', 'franchise core', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('DET', 'Moritz Seider', 'D', 'young_star', 76, 83, 'holding',
      'A Calder winner with size, edge, and franchise-defenseman visibility retains narrative equity even when production is less flashy.',
      ['Calder winner', 'franchise defenseman', 'physical identity', 'hobby confirmed'],
      [TOP_250, DYNASTY]),

    // Edmonton Oilers
    h('EDM', 'Connor McDavid', 'C', 'established_star', 99, 99, 'holding',
      'McDavid is hockey’s active hobby benchmark: generational speed, annual best-player status, and permanent cross-cycle demand.',
      ['generational talent', 'league face', 'historic speed', 'elite hobby scale']),
    h('EDM', 'Leon Draisaitl', 'C', 'established_star', 91, 97, 'holding',
      'Draisaitl’s MVP-level scoring and inseparable place in Edmonton’s title pursuit give him durable superstar narrative equity.',
      ['MVP pedigree', 'elite scorer', 'playoff identity', 'durable demand']),

    // Florida Panthers
    h('FLA', 'Matthew Tkachuk', 'LW', 'established_star', 85, 92, 'holding',
      'Tkachuk combines championships, personality, physical theater, and family branding into one of hockey’s most marketable identities.',
      ['Cup champion', 'marketability', 'physical identity', 'family narrative'],
      [TOP_250]),
    h('FLA', 'Brady Tkachuk', 'LW', 'established_star', 84, 87, 'rising',
      'A blockbuster move beside his brother creates a fresh, highly visible family storyline on top of Brady’s established power-forward brand.',
      ['blockbuster trade', 'family narrative', 'power forward', 'marketability'],
      [TOP_250, TRADES]),

    // Los Angeles Kings
    h('LAK', 'Quinton Byfield', 'C', 'young_star', 75, 79, 'rising',
      'The No. 2 pick still owns rare size, speed, and market context; stronger production could quickly reactivate his original ceiling premium.',
      ['No. 2 pick', 'size-speed tools', 'major market', 'residual narrative'],
      [TOP_250, DYNASTY]),
    h('LAK', 'Brandt Clarke', 'D', 'young_star', 70, 72, 'rising',
      'An offense-first young defenseman with top-ten pedigree has the visual toolkit for a breakout story, though hobby scale remains modest.',
      ['No. 8 pick', 'offensive defenseman', 'highlight tools', 'thin market'],
      [TOP_250, DYNASTY]),

    // Minnesota Wild
    h('MIN', 'Quinn Hughes', 'D', 'established_star', 89, 93, 'rising',
      'The blockbuster acquisition gives Minnesota an elite, highlight-driven defenseman whose skating and awards already carry durable hobby weight.',
      ['blockbuster trade', 'award pedigree', 'elite skating', 'hobby confirmed'],
      [TOP_250, TRADES]),
    h('MIN', 'Kirill Kaprizov', 'LW', 'established_star', 88, 94, 'holding',
      'Kaprizov remains Minnesota’s proven scoring face, with a top-ten current ranking and one of the league’s strongest non-icon card markets.',
      ['franchise face', 'elite scorer', 'top-ten current rank', 'hobby confirmed']),
    h('MIN', 'Matt Boldy', 'LW', 'young_star', 83, 89, 'rising',
      'A top-ten dynasty and current-ranking profile plus rising hobby dollars make Boldy a credible second-generation star narrative.',
      ['top-ten dynasty', 'young scorer', 'franchise runway', 'hobby acceleration'],
      [TOP_250, DYNASTY]),

    // Montreal Canadiens
    h('MTL', 'Lane Hutson', 'D', 'young_star', 90, 95, 'rising',
      'Hutson’s electric skating, record-setting early impact, major-market spotlight, and seven-figure hobby demand have fully locked in the story.',
      ['electric tools', 'award pedigree', 'major market', 'elite hobby scale'],
      [TOP_250, DYNASTY]),
    h('MTL', 'Ivan Demidov', 'RW', 'young_star', 88, 93, 'rising',
      'Elite pre-draft creativity became a Calder-runner-up season, validating the superstar narrative while hobby demand surged.',
      ['top-five pick', 'Calder runner-up', 'elite creativity', 'hobby acceleration'],
      [TOP_250, DYNASTY, CALDER]),
    h('MTL', 'Cole Caufield', 'RW', 'young_star', 85, 91, 'holding',
      'Caufield’s compact goal-scorer identity, U.S. pedigree, and Montreal visibility support a durable premium beyond his raw totals.',
      ['elite shot', 'goal-scorer identity', 'major market', 'hobby confirmed'],
      [TOP_250, DYNASTY]),

    // Nashville Predators
    h('NSH', 'Steven Stamkos', 'C', 'established_star', 76, 84, 'fragile',
      'Stamkos retains Hall-level goal-scoring and captaincy equity, though aging and a smaller Nashville narrative make the premium more residual.',
      ['Hall trajectory', 'elite shot', 'legacy demand', 'aging risk']),
    h('NSH', 'Wyatt Cullen', 'LW', 'prospect', 66, 66, 'rising',
      'The 2026 No. 10 pick offers speed and finishing upside, but Nashville’s next-star story remains early and unconfirmed by the hobby.',
      ['No. 10 pick', 'speed', 'scoring upside', 'pre-market'],
      [DRAFT]),

    // New Jersey Devils
    h('NJD', 'Jack Hughes', 'C', 'young_star', 89, 94, 'holding',
      'The No. 1 pick’s skating, personality, U.S. identity, and seven-figure hobby market keep him in hockey’s permanent young-star class.',
      ['No. 1 pick', 'franchise face', 'elite skating', 'elite hobby scale'],
      [TOP_250, DYNASTY]),
    h('NJD', 'Luke Hughes', 'D', 'young_star', 78, 83, 'rising',
      'Family branding, top-four pedigree, and an offense-first style give Luke a hobby ceiling beyond that of a typical young defenseman.',
      ['No. 4 pick', 'family narrative', 'offensive tools', 'hobby confirmed'],
      [TOP_250, DYNASTY]),

    // New York Islanders
    h('NYI', 'Matthew Schaefer', 'D', 'young_star', 94, 97, 'rising',
      'The No. 1 pick became the youngest and first unanimous Calder winner in decades, producing one of hockey’s clearest new hobby superstars.',
      ['No. 1 pick', 'unanimous Calder', 'historic youth', 'elite hobby scale'],
      [TOP_250, DYNASTY, CALDER]),
    h('NYI', 'Victor Eklund', 'LW', 'rookie', 72, 73, 'rising',
      'A recent first-round skill forward entering the rookie conversation has a path to inherit attention behind Schaefer, but the market is nascent.',
      ['first-round pick', 'rookie runway', 'skilled winger', 'pre-market'],
      [TOP_250, ROOKIES]),

    // New York Rangers
    h('NYR', 'Gabe Perreault', 'RW', 'young_star', 76, 79, 'rising',
      'Elite junior production, first-round pedigree, and Madison Square Garden exposure give Perreault the Rangers’ strongest young hobby path.',
      ['first-round pick', 'elite production', 'major market', 'hobby acceleration'],
      [TOP_250, DYNASTY]),
    h('NYR', 'Igor Shesterkin', 'G', 'established_star', 74, 83, 'holding',
      'A Vezina-caliber identity in the league’s largest U.S. market sustains uncommon hobby relevance for a goaltender.',
      ['Vezina pedigree', 'major market', 'franchise goalie', 'hobby confirmed']),
    h('NYR', 'Alberts Smits', 'D', 'prospect', 70, 75, 'rising',
      'The No. 5 pick’s rare Olympic experience, size, skating, and Latvian milestone give him an unusually distinct early defenseman story.',
      ['No. 5 pick', 'Olympic pedigree', 'rare national story', 'size and skating'],
      [DRAFT]),

    // Ottawa Senators
    h('OTT', 'Tim Stützle', 'C', 'young_star', 81, 87, 'holding',
      'The No. 3 pick remains Ottawa’s most visible young star after the Tkachuk trade, with speed and scoring that still look special on video.',
      ['No. 3 pick', 'franchise face', 'speed', 'hobby confirmed'],
      [TOP_250, DYNASTY, TRADES]),
    h('OTT', 'Jake Sanderson', 'D', 'young_star', 75, 80, 'rising',
      'A top-five pick with a growing two-way reputation has the pedigree and role to become Ottawa’s new foundational identity.',
      ['No. 5 pick', 'franchise defenseman', 'young core', 'consensus support'],
      [TOP_250, DYNASTY]),
    h('OTT', 'Carter Yakemchuk', 'D', 'rookie', 68, 69, 'rising',
      'The No. 7 pick brings size and offense into the 2026 rookie mix, but card demand and NHL validation remain early.',
      ['No. 7 pick', 'offensive defenseman', 'rookie runway', 'pre-market'],
      [TOP_250, ROOKIES]),

    // Philadelphia Flyers
    h('PHI', 'Matvei Michkov', 'RW', 'young_star', 87, 91, 'rising',
      'Michkov’s elite pre-draft scoring reputation, visible skill, and strong card market preserve superstar belief despite a lower current ranking.',
      ['elite pre-draft pedigree', 'scoring creativity', 'major market', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('PHI', 'Porter Martone', 'RW', 'rookie', 82, 86, 'rising',
      'The physically imposing No. 6 pick enters 2026-27 as the leading Calder candidate, giving Philadelphia a second premium ceiling story.',
      ['No. 6 pick', 'top rookie candidate', 'power-wing tools', 'hobby acceleration'],
      [TOP_250, DYNASTY, ROOKIES]),
    h('PHI', 'Trevor Zegras', 'C', 'young_star', 74, 76, 'fragile',
      'Zegras still owns rare viral-skill and personality equity, while Philadelphia offers a plausible reset for a once-hot hobby narrative.',
      ['viral skill', 'marketability', 'major market reset', 'fragile narrative'],
      [TOP_250, DYNASTY]),

    // Pittsburgh Penguins
    h('PIT', 'Sidney Crosby', 'C', 'established_star', 96, 99, 'holding',
      'Crosby’s generational résumé, one-franchise identity, and seven-figure annual hobby demand make his IT status effectively permanent.',
      ['generational legacy', 'one-franchise icon', 'Cup pedigree', 'elite hobby scale']),
    h('PIT', 'Ben Kindel', 'C', 'young_star', 79, 82, 'rising',
      'A recent first-rounder immediately earned Calder votes and unusual hobby acceleration, making him Pittsburgh’s clearest bridge beyond Crosby.',
      ['first-round pick', 'Calder votes', 'succession narrative', 'hobby acceleration'],
      [DYNASTY, CALDER]),

    // San Jose Sharks
    h('SJS', 'Macklin Celebrini', 'C', 'young_star', 97, 98, 'rising',
      'The No. 1 pick is already the top under-25 consensus player and hockey’s active-player completed-sales leader, locking in a franchise-superstar story.',
      ['No. 1 pick', 'franchise face', 'top young consensus', 'sport-leading hobby demand'],
      [TOP_250, DYNASTY]),
    h('SJS', 'Michael Misa', 'C', 'young_star', 85, 90, 'rising',
      'Another elite draft pedigree and fast-rising hobby base give San Jose a rare second center with genuine superstar narrative weight.',
      ['No. 2 pick', 'elite scorer', 'young core', 'hobby acceleration'],
      [TOP_250, DYNASTY]),
    h('SJS', 'Ivar Stenberg', 'LW', 'rookie', 82, 85, 'rising',
      'The 2026 No. 2 pick was the top international skater and is expected to play immediately beside an unusually marketable young core.',
      ['No. 2 pick', 'top international skater', 'immediate runway', 'franchise halo'],
      [TOP_250, DYNASTY, ROOKIES, DRAFT]),

    // Seattle Kraken
    h('SEA', 'Berkly Catton', 'C', 'prospect', 75, 77, 'rising',
      'The No. 8 pick’s speed and creativity provide Seattle’s clearest unspent ceiling story, though his hobby footprint remains small.',
      ['No. 8 pick', 'speed and creativity', 'franchise upside', 'thin market'],
      [DYNASTY]),
    h('SEA', 'Shane Wright', 'C', 'young_star', 72, 76, 'fragile',
      'Former exceptional-status and No. 4-pick belief still leaves residual hobby equity, but it now needs a visible NHL breakout.',
      ['exceptional-status pedigree', 'No. 4 pick', 'residual narrative', 'needs validation'],
      [TOP_250]),
    h('SEA', 'Matty Beniers', 'C', 'young_star', 69, 75, 'fragile',
      'A No. 2 pick and Calder winner remains a recognizable franchise face, but ordinary follow-up seasons have weakened the ceiling premium.',
      ['No. 2 pick', 'Calder winner', 'franchise face', 'narrative erosion'],
      [DYNASTY]),

    // St. Louis Blues
    h('STL', 'Jimmy Snuggerud', 'RW', 'young_star', 82, 88, 'rising',
      'An All-Rookie season, visible scoring tools, and accelerating card demand have made Snuggerud the Blues’ clearest new hobby star.',
      ['All-Rookie', 'goal-scoring tools', 'young core', 'hobby acceleration'],
      [TOP_250, DYNASTY, CALDER, ALL_ROOKIE]),
    h('STL', 'Dalibor Dvorsky', 'C', 'young_star', 76, 79, 'rising',
      'Top-ten draft capital and a projected top-six center role keep Dvorsky’s ceiling narrative alive as St. Louis turns younger.',
      ['No. 10 pick', 'center ceiling', 'young core', 'hobby forming'],
      [DYNASTY]),
    h('STL', 'Mason McTavish', 'C', 'young_star', 73, 77, 'rising',
      'The former No. 3 pick gets a fresh-team reset with power-forward tools and enough residual pedigree to re-form the original story.',
      ['No. 3 pick', 'trade reset', 'power forward', 'residual narrative'],
      [TOP_250, DYNASTY, TRADES]),

    // Tampa Bay Lightning
    h('TBL', 'Nikita Kucherov', 'RW', 'established_star', 90, 96, 'holding',
      'The reigning Hart winner combines historic offense and championship credibility, preserving superstar belief beyond a relatively modest card base.',
      ['2026 Hart winner', 'Cup pedigree', 'historic offense', 'durable narrative'],
      [TOP_250, KUCHEROV_HART]),
    h('TBL', 'Andrei Vasilevskiy', 'G', 'established_star', 78, 88, 'holding',
      'Vasilevskiy’s trophies, championships, and big-game reputation create one of the few durable modern-goalie hobby identities.',
      ['Vezina pedigree', 'Cup champion', 'big-game identity', 'goalie exception']),

    // Toronto Maple Leafs
    h('TOR', 'Gavin McKenna', 'LW', 'rookie', 91, 95, 'rising',
      'A long-anointed elite prospect became Toronto’s No. 1 pick in a celebrity draft moment, creating immediate face-of-franchise hobby heat.',
      ['No. 1 pick', 'long consensus runway', 'Toronto spotlight', 'celebrity draft moment'],
      [TOP_250, DYNASTY, ROOKIES, DRAFT]),
    h('TOR', 'Auston Matthews', 'C', 'established_star', 90, 96, 'holding',
      'Matthews remains a permanent Toronto hobby face through No. 1 pedigree, singular goal scoring, U.S. marketability, and sustained demand.',
      ['No. 1 pick', 'franchise face', 'elite scorer', 'durable hobby demand']),
    h('TOR', 'Matthew Knies', 'LW', 'young_star', 76, 80, 'rising',
      'Knies’ size, playoff visibility, and placement beside Toronto’s stars have grown a meaningful hobby story without elite draft capital.',
      ['power-wing tools', 'Toronto spotlight', 'playoff visibility', 'hobby confirmed'],
      [TOP_250, DYNASTY]),

    // Utah Mammoth
    h('UTA', 'Logan Cooley', 'C', 'young_star', 81, 87, 'rising',
      'The No. 3 pick’s speed and creativity anchor Utah’s new-market identity and already support one of the team’s strongest card bases.',
      ['No. 3 pick', 'franchise face', 'speed and creativity', 'hobby confirmed'],
      [TOP_250, DYNASTY]),
    h('UTA', 'Caleb Desnoyers', 'C', 'prospect', 78, 80, 'rising',
      'The 2025 No. 4 pick pairs a projectable two-way center ceiling with a direct 2026-27 roster push even before meaningful hobby confirmation.',
      ['No. 4 pick', 'center ceiling', 'training-camp runway', 'pre-market'],
      [UTAH_TOP_PROSPECTS, UTAH_ROSTER_PUSH]),
    h('UTA', 'Tij Iginla', 'C', 'prospect', 77, 79, 'rising',
      'Top-six pedigree, a healthy 90-point season, and the Iginla name give Utah a rare prospect with lineage, marketability, and an immediate roster push.',
      ['No. 6 pick', 'family lineage', '90-point season', 'training-camp runway'],
      [UTAH_TOP_PROSPECTS, UTAH_ROSTER_PUSH]),

    // Vancouver Canucks
    h('VAN', 'Caleb Malhotra', 'C', 'prospect', 80, 84, 'rising',
      'The 2026 No. 3 pick joining his father-coach gives a rebuilding Vancouver club an unusually clean, emotional franchise-reset story.',
      ['No. 3 pick', 'father-son narrative', 'franchise reset', 'major Canadian market'],
      [DRAFT]),
    h('VAN', 'Zeev Buium', 'D', 'young_star', 75, 78, 'rising',
      'An offense-driving young defenseman acquired in the Quinn Hughes blockbuster inherits both opportunity and a direct succession narrative.',
      ['first-round pedigree', 'offensive defenseman', 'blockbuster trade', 'succession story'],
      [TOP_250, DYNASTY, TRADES]),

    // Vegas Golden Knights
    h('VGK', 'Jack Eichel', 'C', 'established_star', 85, 91, 'holding',
      'A No. 2 pick, Cup centerpiece, Olympic-stage scorer, and 2026 finalist gives Vegas its clearest durable star identity.',
      ['No. 2 pick', 'Cup champion', 'big-stage scorer', 'hobby confirmed'],
      [TOP_250, EICHEL_FINAL]),
    h('VGK', 'Mitch Marner', 'RW', 'established_star', 80, 85, 'rising',
      'A full season in Vegas converted Marner’s Toronto exit into a Finals-stage reset, while accelerating card sales preserve his elite-playmaker narrative.',
      ['major-market exit', 'elite playmaker', '2026 Cup finalist', 'hobby acceleration'],
      [TOP_250, CUP, MARNER_TRADE]),

    // Washington Capitals
    h('WSH', 'Alex Ovechkin', 'LW', 'established_star', 97, 99, 'holding',
      'The all-time goals leader returned for another season, cementing a permanent hobby identity built on one franchise and one historic chase.',
      ['all-time record', 'one-franchise icon', 'historic chase', 'elite hobby scale'],
      [TOP_250, OVECHKIN]),
    h('WSH', 'Ryan Leonard', 'RW', 'young_star', 80, 85, 'rising',
      'First-round pedigree, U.S. captain energy, Calder votes, and rapidly rising card demand make Leonard Washington’s clearest successor story.',
      ['top-ten pick', 'U.S. pedigree', 'Calder votes', 'hobby acceleration'],
      [TOP_250, DYNASTY, CALDER]),
    h('WSH', 'Cole Hutson', 'D', 'rookie', 77, 79, 'rising',
      'An offense-first defenseman entering 2026-27 as a leading rookie candidate also benefits from the visible Hutson family skill narrative.',
      ['top rookie candidate', 'offensive tools', 'family narrative', 'succession runway'],
      [TOP_250, ROOKIES]),

    // Winnipeg Jets
    h('WPG', 'Connor Hellebuyck', 'G', 'established_star', 80, 91, 'holding',
      'Repeated Vezina-level dominance and an MVP season give Hellebuyck rare, durable hobby recognition for a modern goaltender.',
      ['MVP pedigree', 'Vezina dominance', 'franchise face', 'goalie exception'],
      [TOP_250, HELLEBUYCK_HART]),
    h('WPG', 'Viggo Björck', 'C', 'prospect', 71, 73, 'rising',
      'The 2026 No. 8 pick combined SHL and international success at 18, creating Winnipeg’s strongest new ceiling story before cards catch up.',
      ['No. 8 pick', 'played against men', 'international pedigree', 'pre-market'],
      [DRAFT]),
  ],
}
