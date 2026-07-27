import {
  normalizeItFactorName,
  type ItFactorSource,
  type ItFactorStatus,
  type ItFactorTier,
  type ItFactorTrajectory,
} from '../../../src/domain/itFactor.js'
import { IT_FACTOR_EXPECTED_TEAMS } from './teams.js'
import type {
  ItFactorCurationEntry,
  ItFactorLeagueCuration,
} from './types.js'

const FG_TOP_100 = 'mlb-fangraphs-top-100-2026-07-23'
const PIPELINE_TOP_100 = 'mlb-pipeline-top-100-2026-07-26'
const ALL_STAR = 'mlb-all-star-rosters-2026'
const ROY_POLL = 'mlb-rookie-poll-2026-07'
const DERBY = 'mlb-home-run-derby-2026-07-14'
const CHROME = 'mlb-topps-chrome-chases-2026-07-22'
const JERSEYS = 'mlb-jersey-sales-2025-09-26'
const BOOTH_DRAFT = 'mlb-eric-booth-draft-2026'
const EMERSON_DRAFT = 'mlb-grady-emerson-draft-2026'
const ROCH_DRAFT = 'mlb-roch-cholowsky-draft-2026'
const LACKEY_DRAFT = 'mlb-vahn-lackey-draft-2026'
const MURAKAMI_BREAKOUT = 'mlb-murakami-derby-all-star-2026-07-10'
const RICE_BREAKOUT = 'mlb-ben-rice-derby-2026-07-07'
const SCHLITTLER_BREAKOUT = 'mlb-cam-schlittler-2026-07-25'
const BRADEN_DEBUT = 'mlb-braden-montgomery-debut-2026-06-10'
const MISIOROWSKI_VELOCITY = 'mlb-misiorowski-velocity-2026'
const YAMAMOTO_ALL_STAR = 'mlb-yamamoto-all-star-2026-07-05'
const YAMAMOTO_PROFILE = 'mlb-yamamoto-world-series-mvp-2026-02-14'

const MLB_PLAYER_PAGES = [
  [683002, 'Gunnar Henderson'],
  [702616, 'Jackson Holliday'],
  [701350, 'Roman Anthony'],
  [691785, 'Marcelo Mayer'],
  [592450, 'Aaron Judge'],
  [700250, 'Ben Rice'],
  [693645, 'Cam Schlittler'],
  [691406, 'Junior Caminero'],
  [665489, 'Vladimir Guerrero Jr.'],
  [702056, 'Trey Yesavage'],
  [808959, 'Munetaka Murakami'],
  [695731, 'Braden Montgomery'],
  [683953, 'Travis Bazzana'],
  [800050, 'Chase DeLauter'],
  [805808, 'Kevin McGonigle'],
  [677951, 'Bobby Witt Jr.'],
  [695506, 'Jac Caglianone'],
  [670541, 'Yordan Alvarez'],
  [701358, 'Cam Smith'],
  [545361, 'Mike Trout'],
  [701762, 'Nick Kurtz'],
  [805779, 'Jacob Wilson'],
  [677594, 'Julio Rodríguez'],
  [806068, 'Colt Emerson'],
  [694671, 'Wyatt Langford'],
  [660670, 'Ronald Acuña Jr.'],
  [686948, 'Drake Baldwin'],
  [665742, 'Juan Soto'],
  [690997, 'Nolan McLean'],
  [701807, 'Carson Benge'],
  [547180, 'Bryce Harper'],
  [691725, 'Andrew Painter'],
  [695578, 'James Wood'],
  [686611, 'Dylan Crews'],
  [691718, 'Pete Crow-Armstrong'],
  [807713, 'Matt Shaw'],
  [682829, 'Elly De La Cruz'],
  [695505, 'Chase Burns'],
  [701398, 'Sal Stewart'],
  [694192, 'Jackson Chourio'],
  [694819, 'Jacob Misiorowski'],
  [694973, 'Paul Skenes'],
  [804606, 'Konnor Griffin'],
  [802139, 'JJ Wetherholt'],
  [691023, 'Jordan Walker'],
  [682998, 'Corbin Carroll'],
  [814439, 'Ryan Waldschmidt'],
  [660271, 'Shohei Ohtani'],
  [808967, 'Yoshinobu Yamamoto'],
  [808963, 'Roki Sasaki'],
  [665487, 'Fernando Tatis Jr.'],
  [701538, 'Jackson Merrill'],
  [805811, 'Bryce Eldridge'],
  [646240, 'Rafael Devers'],
] as const

function playerPage(mlbamId: number): string {
  return `mlb-player-${mlbamId}`
}

const playerPageSources: ItFactorSource[] = MLB_PLAYER_PAGES.map(
  ([mlbamId, playerName]) => ({
    id: playerPage(mlbamId),
    label: `${playerName} official player page`,
    publisher: 'MLB.com',
    url: `https://www.mlb.com/player/${normalizeItFactorName(playerName).replaceAll(' ', '-')}-${mlbamId}`,
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'official',
  }),
)

const researchSources: ItFactorSource[] = [
  {
    id: FG_TOP_100,
    label: '2026 pre-trade-deadline Top 100 prospects update',
    publisher: 'FanGraphs',
    url: 'https://blogs.fangraphs.com/2026-pre-trade-deadline-top-100-prospects-update/',
    publishedAt: '2026-07-23',
    accessedAt: '2026-07-26',
    kind: 'consensus',
  },
  {
    id: PIPELINE_TOP_100,
    label: 'MLB Pipeline live Top 100 prospects',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/milb/prospects/top100',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'scouting',
  },
  {
    id: ALL_STAR,
    label: '2026 MLB All-Star Game rosters',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/news/2026-all-star-game-rosters',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: ROY_POLL,
    label: 'July 2026 Rookie of the Year poll',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/news/rookie-of-the-year-poll-july-2026',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'news',
  },
  {
    id: DERBY,
    label: '2026 MLB Home Run Derby results',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/news/2026-mlb-home-run-derby-results',
    publishedAt: '2026-07-14',
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: CHROME,
    label: '2026 Topps Chrome headline chases',
    publisher: 'Baseball America',
    url: 'https://www.baseballamerica.com/stories/2026-topps-chrome-logoman-patches-konnor-griffin-kevin-mcgonigle-rookie-cards-highlight-top-chases/',
    publishedAt: '2026-07-22',
    accessedAt: '2026-07-26',
    kind: 'hobby_market',
  },
  {
    id: JERSEYS,
    label: 'MLB player jersey-sales leaders',
    publisher: 'Associated Press',
    url: 'https://apnews.com/article/6109c3de3ca1e2872522170049a07fb5',
    publishedAt: '2025-09-26',
    accessedAt: '2026-07-26',
    kind: 'news',
  },
  {
    id: BOOTH_DRAFT,
    label: 'Orioles sign 2026 first-round pick Eric Booth Jr.',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/news/eric-booth-jr-orioles-deal',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: EMERSON_DRAFT,
    label: 'Rays draft Grady Emerson second overall',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/rays/news/grady-emerson-drafted-no-2-rays-2026-mlb-draft',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: ROCH_DRAFT,
    label: 'White Sox draft Roch Cholowsky first overall',
    publisher: 'Baseball America',
    url: 'https://www.baseballamerica.com/stories/chicago-white-sox-draft-shortstop-roch-cholowsky-no-1-overall/',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'scouting',
  },
  {
    id: LACKEY_DRAFT,
    label: 'Twins draft Vahn Lackey third overall',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/twins/news/vahn-lackey-drafted-twins-no-3-pick-2026-mlb-draft',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: MURAKAMI_BREAKOUT,
    label: 'Munetaka Murakami joins the 2026 Home Run Derby',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/whitesox/news/munetaka-murakami-joins-2026-home-run-derby',
    publishedAt: '2026-07-10',
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: RICE_BREAKOUT,
    label: 'Ben Rice joins the 2026 Home Run Derby',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/yankees/news/ben-rice-joins-2026-home-run-derby',
    publishedAt: '2026-07-07',
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: SCHLITTLER_BREAKOUT,
    label: 'Cam Schlittler strikes out 12 in Philadelphia',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/news/cam-schlittler-strikes-out-12-phillies-for-yankees',
    publishedAt: '2026-07-25',
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: BRADEN_DEBUT,
    label: 'Braden Montgomery homers in his MLB debut',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/news/braden-montgomery-white-sox-callup',
    publishedAt: '2026-06-10',
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: MISIOROWSKI_VELOCITY,
    label: 'Jacob Misiorowski brings record starter velocity',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/brewers/news/jacob-misiorowski-brings-record-velocity-for-brewers',
    publishedAt: null,
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: YAMAMOTO_ALL_STAR,
    label: 'Yoshinobu Yamamoto named a 2026 NL All-Star',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/dodgers/press-release/dodgers-yoshinobu-yamamoto-named-national-league-all-star',
    publishedAt: '2026-07-05',
    accessedAt: '2026-07-26',
    kind: 'official',
  },
  {
    id: YAMAMOTO_PROFILE,
    label: 'World Series MVP Yamamoto enters 2026 as Dodgers ace',
    publisher: 'MLB.com',
    url: 'https://www.mlb.com/dodgers/news/yoshinobu-yamamoto-looks-to-build-on-success-in-2026',
    publishedAt: '2026-02-14',
    accessedAt: '2026-07-26',
    kind: 'official',
  },
]

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
  if (trajectory === 'fragile') {
    return [
      'Health, role, promotion, or availability materially changes.',
      'Hobby-sales velocity or consensus standing reverses direction.',
    ]
  }
  if (status === 'prospect') {
    return [
      'Next major ranking, promotion, draft-card, or debut milestone.',
      'Material change in Bowman 1st and early-card sales velocity.',
    ]
  }
  if (position.endsWith('HP')) {
    return [
      'Velocity, workload, role, award, or arm-health inflection.',
      'Material change in pitcher-card sales scale or momentum.',
    ]
  }
  if (status === 'rookie') {
    return [
      'Rookie role, award race, first sustained slump, or injury inflection.',
      'Material change in flagship rookie-card sales velocity.',
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

function b(
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
  recheckTriggers?: string[],
): ItFactorCurationEntry {
  const team = IT_FACTOR_EXPECTED_TEAMS.baseball.find(
    (candidate) => candidate.code === teamCode,
  )
  if (!team) throw new Error(`Unknown MLB team ${teamCode}`)
  return {
    id: `mlb-${teamCode.toLocaleLowerCase('en-US')}-${
      normalizeItFactorName(playerName).replaceAll(' ', '-')
    }`,
    playerName,
    sport: 'baseball',
    league: 'MLB',
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
    recheckTriggers:
      recheckTriggers ?? recheckTriggersFor(position, status, trajectory),
    sourceIds: [...new Set(sourceIds)],
  }
}

export const baseballItFactorCuration: ItFactorLeagueCuration = {
  sources: [...researchSources, ...playerPageSources],
  entries: [
    // Baltimore Orioles
    b('BAL', 'Gunnar Henderson', 'SS', 'established_star', 88, 92, 'holding',
      'Former elite-prospect status plus MVP-level shortstop production created a durable star narrative with substantial hobby demand.',
      ['elite prospect pedigree', 'MVP ceiling', 'premium position', 'hobby confirmed'],
      [playerPage(683002)]),
    b('BAL', 'Jackson Holliday', '2B', 'young_star', 84, 85, 'fragile',
      'No. 1-pick pedigree, a famous surname, and massive early supply preserve the dream through injury and ordinary MLB stretches.',
      ['No. 1 pick', 'baseball family', 'residual prospect equity', 'injury risk'],
      [playerPage(702616)]),
    b('BAL', 'Eric Booth Jr.', 'CF', 'prospect', 66, 65, 'rising',
      'The No. 7 overall pick owns premium speed and physicality, but mainstream prospect-card supply and stable hobby demand have not formed.',
      ['No. 7 pick', 'premium speed', 'center-field projection', 'pre-market'],
      [FG_TOP_100, BOOTH_DRAFT]),

    // Boston Red Sox
    b('BOS', 'Roman Anthony', 'OF', 'young_star', 91, 96, 'rising',
      'The former No. 1 prospect paired elite hard contact and on-base skill with a flagship chase identity and elite baseball demand.',
      ['former No. 1 prospect', 'elite bat', 'young franchise face', 'flagship chase'],
      [playerPage(701350), CHROME]),
    b('BOS', 'Franklin Arias', 'SS', 'prospect', 89, 88, 'rising',
      'Arias is a 20-year-old shortstop ranked No. 2 by FanGraphs and No. 7 by Pipeline, with unusually strong hobby demand for a non-graduate.',
      ['multi-source top 10', 'premium position', 'youth for level', 'hobby confirmed'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('BOS', 'Marcelo Mayer', '2B/3B', 'young_star', 75, 78, 'fragile',
      'Former top-five-pick and top-prospect equity still sells, but repeated injuries keep Mayer from rebuilding a strong star lock.',
      ['No. 4 pick', 'residual prospect equity', 'Boston market', 'injury risk'],
      [playerPage(691785)]),

    // New York Yankees
    b('NYY', 'Aaron Judge', 'RF', 'established_star', 98, 99, 'holding',
      'Judge is a permanent Yankees and record-chase brand whose top-three baseball market is insulated from ordinary performance cycles.',
      ['franchise icon', 'record chases', 'Yankees platform', 'elite hobby scale'],
      [playerPage(592450), CHROME, JERSEYS]),
    b('NYY', 'Ben Rice', '1B/C', 'young_star', 91, 95, 'rising',
      'A 2026 All-Star and Derby stage plus 29 homers turned Rice into a national Yankees power identity backed by fast-growing baseball sales.',
      ['2026 All-Star', 'Home Run Derby', 'left-handed power', 'hobby breakout'],
      [playerPage(700250), ALL_STAR, RICE_BREAKOUT]),
    b('NYY', 'Cam Schlittler', 'RHP', 'young_star', 90, 94, 'rising',
      'The 2025 postseason breakout became the 2026 AL ERA leader and an All-Star, with triple-digit velocity and fast-growing hobby demand.',
      ['postseason mythology', 'triple-digit fastball', '2026 All-Star', 'hobby breakout'],
      [playerPage(693645), ALL_STAR, SCHLITTLER_BREAKOUT]),

    // Tampa Bay Rays
    b('TB', 'Junior Caminero', '3B', 'young_star', 90, 93, 'rising',
      'Elite bat speed, huge first-half power, repeated Derby visibility, and an expressive persona form the loud-tool story collectors reward.',
      ['elite bat speed', 'Home Run Derby', 'young slugger', 'marketability'],
      [playerPage(691406), DERBY]),
    b('TB', 'Grady Emerson', 'SS', 'prospect', 82, 83, 'rising',
      'The No. 2 overall pick immediately landed No. 15 at FanGraphs, giving a premium-position prep star a strong pre-card narrative.',
      ['No. 2 pick', 'premium position', 'prep awards', 'pre-market'],
      [FG_TOP_100, EMERSON_DRAFT]),
    b('TB', 'Theo Gillen', 'CF', 'prospect', 86, 86, 'rising',
      'New power arrived without sacrificing speed or discipline, moving Gillen into the Pipeline top 10 and FanGraphs top 20.',
      ['top-10 Pipeline rank', 'power-speed growth', 'center-field projection', 'hobby acceleration'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Toronto Blue Jays
    b('TOR', 'Vladimir Guerrero Jr.', '1B', 'established_star', 86, 89, 'holding',
      'Famous pedigree, Derby history, star-level power, and mass-market visibility support a durable hobby floor below the permanent icons.',
      ['baseball family', 'elite power', 'Derby history', 'durable demand'],
      [playerPage(665489), ALL_STAR, JERSEYS]),
    b('TOR', 'Trey Yesavage', 'RHP', 'rookie', 85, 86, 'rising',
      'A rapid ascent, 2025 postseason mythology, and early 2026 dominance give Yesavage unusually strong visibility for a rookie pitcher.',
      ['rapid ascent', 'postseason moments', 'strikeout tools', 'rookie-card demand'],
      [playerPage(702056)]),
    b('TOR', 'Arjun Nimmala', 'SS', 'prospect', 75, 75, 'fragile',
      'Nimmala remains very young at Double-A with opposite-field power and aligned mid-40s consensus, but health risk and modest sales leave only a partial hobby lock.',
      ['premium position', 'youth for level', 'projected power', 'health risk'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Chicago White Sox
    b('CWS', 'Munetaka Murakami', '1B', 'rookie', 91, 96, 'rising',
      'The NPB 56-homer and WBC superstar story was validated by 20 first-half MLB homers, an All-Star nod, Derby exposure, and strong demand.',
      ['international superstar', '2026 All-Star', 'Home Run Derby', 'elite hobby scale'],
      [playerPage(808959), ALL_STAR, MURAKAMI_BREAKOUT]),
    b('CWS', 'Roch Cholowsky', 'SS', 'prospect', 88, 87, 'rising',
      'The 2026 No. 1 overall pick combines record draft investment, a premium position, and immediate top-20 FanGraphs standing.',
      ['No. 1 pick', 'record bonus', 'premium position', 'pre-pro narrative'],
      [FG_TOP_100, ROCH_DRAFT]),
    b('CWS', 'Braden Montgomery', 'RF', 'rookie', 80, 83, 'rising',
      'The switch-hitting first-round trade centerpiece reached MLB in June and turned a walk-off debut homer into a live hobby window.',
      ['first-round pedigree', 'trade centerpiece', 'switch-hitting power', 'walk-off debut'],
      [playerPage(695731), BRADEN_DEBUT]),

    // Cleveland Guardians
    b('CLE', 'Travis Bazzana', '2B', 'rookie', 89, 90, 'rising',
      'First-overall pedigree became an April debut and All-Star selection within ten weeks, quickly converting prospect demand into MLB star belief.',
      ['No. 1 pick', '2026 All-Star', 'international appeal', 'fast narrative lock'],
      [playerPage(683953), ALL_STAR]),
    b('CLE', 'Chase DeLauter', 'RF', 'rookie', 77, 79, 'fragile',
      'A two-homer regular-season debut reignited former top-prospect demand, but an extreme injury record makes the renewed story unstable.',
      ['former top prospect', 'two-homer debut', 'impact bat', 'injury risk'],
      [playerPage(800050)]),
    b('CLE', 'Angel Genao', 'SS', 'prospect', 76, 72, 'rising',
      'FanGraphs ranks Genao No. 11 on improved impact and retained contact, while a cooler Pipeline rank and thin sales leave him ahead of market.',
      ['FanGraphs top 15', 'premium position', 'contact plus impact', 'ahead of market'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Detroit Tigers
    b('DET', 'Kevin McGonigle', '2B/SS', 'rookie', 91, 96, 'rising',
      'The elite hit-tool prospect became a 2026 All-Star and Rookie of the Year favorite with a headline Chrome identity and strong young-player demand.',
      ['elite hit tool', '2026 All-Star', 'ROY favorite', 'flagship chase'],
      [playerPage(805808), ROY_POLL, CHROME]),
    b('DET', 'Max Clark', 'CF', 'prospect', 87, 86, 'holding',
      'Top-five FanGraphs and top-15 Pipeline consensus preserve a five-tool center-field dream even before a full offensive breakout.',
      ['multi-source top 15', 'five-tool projection', 'center field', 'hobby confirmed'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('DET', 'Bryce Rainer', 'SS', 'prospect', 75, 76, 'fragile',
      'Premium-position and first-round pedigree sustain a meaningful market, but injury history and fading momentum have paused the story.',
      ['first-round pedigree', 'premium position', 'projected power', 'injury risk'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Kansas City Royals
    b('KC', 'Bobby Witt Jr.', 'SS', 'established_star', 95, 97, 'holding',
      'Elite draft and prospect belief was validated by perennial MVP-level power and speed at shortstop, creating a structural hobby brand.',
      ['elite prospect pedigree', 'MVP ceiling', 'power-speed', 'premium position'],
      [playerPage(677951), ALL_STAR]),
    b('KC', 'Jac Caglianone', 'RF/1B', 'young_star', 89, 91, 'rising',
      'Oversized power, two-way amateur fame, and Derby visibility make Caglianone a spectacle-first young star with strong hobby demand.',
      ['two-way amateur fame', 'elite raw power', 'Home Run Derby', 'hobby acceleration'],
      [playerPage(695506), DERBY]),

    // Minnesota Twins
    b('MIN', 'Walker Jenkins', 'CF', 'prospect', 87, 86, 'holding',
      'Top-five FanGraphs and top-15 Pipeline standing keep the young five-tool, middle-of-order center-field dream intact at Triple-A.',
      ['multi-source top 15', 'five-tool projection', 'youth for level', 'center field'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('MIN', 'Vahn Lackey', 'C', 'prospect', 78, 75, 'rising',
      'The No. 3 overall pick and immediate No. 14 FanGraphs rank create elite draft heat, though catcher risk and absent card supply cap it.',
      ['No. 3 pick', 'top-15 consensus', 'premium catcher', 'pre-market'],
      [FG_TOP_100, LACKEY_DRAFT]),

    // Houston Astros
    b('HOU', 'Yordan Alvarez', 'DH/LF', 'established_star', 85, 83, 'fragile',
      'One of baseball’s loudest left-handed bats owns postseason mythology and strong demand, with recurring injury limiting permanent status.',
      ['elite power', 'postseason mythology', 'established demand', 'injury risk'],
      [playerPage(670541)]),
    b('HOU', 'Cam Smith', 'RF/3B', 'young_star', 77, 80, 'fragile',
      'Trade-centerpiece fame, a rapid debut, and premium raw power left a real collector base, but cooling sales now require revalidation.',
      ['trade centerpiece', 'rapid MLB path', 'raw power', 'cooling demand'],
      [playerPage(701358)]),
    b('HOU', 'Kevin Alvarez', 'OF', 'prospect', 75, 72, 'rising',
      'Teenage power projection and matching No. 68 placements at FanGraphs and Pipeline show an early narrative forming well before MLB.',
      ['teenage projection', 'consensus top 70', 'power upside', 'early hobby demand'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Los Angeles Angels
    b('LAA', 'Mike Trout', 'CF', 'established_star', 96, 98, 'holding',
      'Injuries changed current output but not Trout’s defining modern-card and all-time-player identity, which still commands elite demand.',
      ['all-time player', 'defining modern card', 'franchise icon', 'elite hobby scale'],
      [playerPage(545361)]),
    b('LAA', 'Tyler Bremner', 'RHP', 'prospect', 64, 64, 'fragile',
      'The 2025 No. 2 pick remains the Angels top arm, but pitcher discount, modest consensus, and declining sales keep him on watch.',
      ['No. 2 pick', 'top organizational arm', 'pitcher volatility', 'cooling demand'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Athletics
    b('ATH', 'Nick Kurtz', '1B', 'young_star', 91, 95, 'rising',
      'A top-four pick became an elite young power hitter and 2026 All-Star starter with a surging top-12 baseball market.',
      ['top-four pick', 'elite power', 'All-Star starter', 'elite hobby scale'],
      [playerPage(701762), ALL_STAR]),
    b('ATH', 'Leo De Vries', 'SS', 'prospect', 91, 93, 'rising',
      'A 19-year-old switch-hitting power-speed shortstop ranked No. 2 by Pipeline and No. 6 by FanGraphs is the cleanest speculative profile after Made.',
      ['multi-source top six', 'switch hitter', 'power-speed', 'premium position'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('ATH', 'Jacob Wilson', 'SS', 'young_star', 87, 87, 'holding',
      'Elite bat-to-ball skill and immediate MLB success validated top-six draft pedigree, with contact-first shape slightly limiting hobby ceiling.',
      ['top-six pick', 'elite contact', 'premium position', 'hobby confirmed'],
      [playerPage(805779)]),

    // Seattle Mariners
    b('SEA', 'Julio Rodríguez', 'CF', 'established_star', 88, 89, 'holding',
      'The original five-tool face narrative, charisma, and center-field power-speed preserve a strong hobby floor through uneven stretches.',
      ['five-tool identity', 'franchise face', 'power-speed', 'marketability'],
      [playerPage(677594)]),
    b('SEA', 'Colt Emerson', 'SS/3B', 'rookie', 87, 88, 'rising',
      'Former top-six prospect consensus, a premium position, and a May 2026 debut keep a seven-figure rookie narrative active.',
      ['former top-six prospect', 'premium position', '2026 debut', 'hobby confirmed'],
      [playerPage(806068)]),
    b('SEA', 'Kade Anderson', 'LHP', 'prospect', 89, 88, 'rising',
      'The No. 3 FanGraphs and No. 5 Pipeline prospect pairs four bat-missing pitches with command and an imminent MLB path.',
      ['multi-source top five', 'four-pitch arsenal', 'strike throwing', 'imminent debut'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Texas Rangers
    b('TEX', 'Wyatt Langford', 'OF', 'young_star', 85, 86, 'holding',
      'Top-five draft pedigree and 30/30-style athletic visuals maintain a strong market even before his star narrative becomes permanent.',
      ['top-five pick', 'power-speed', 'athletic visuals', 'hobby confirmed'],
      [playerPage(694671)]),
    b('TEX', 'Sebastian Walcott', 'SS/3B', 'prospect', 85, 84, 'fragile',
      'A massive 20-year-old power frame at a premium position supports top-15 consensus, with Tommy John recovery adding meaningful uncertainty.',
      ['multi-source top 15', 'rare frame', 'premium position', 'surgery recovery'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Atlanta Braves
    b('ATL', 'Ronald Acuña Jr.', 'RF', 'established_star', 93, 95, 'holding',
      'Charisma, historic power-speed, and an international collector base make Acuña demand durable through recurring injury cycles.',
      ['historic power-speed', 'marketability', 'international demand', 'durable brand'],
      [playerPage(660670), JERSEYS]),
    b('ATL', 'Drake Baldwin', 'C', 'young_star', 84, 85, 'holding',
      'The 2025 NL Rookie of the Year pairs left-handed catcher power with a winning-team platform and a meaningful collector base.',
      ['2025 Rookie of the Year', 'catcher power', 'winning platform', 'hobby confirmed'],
      [playerPage(686948)]),
    b('ATL', 'Eric Hartman', 'CF', 'prospect', 81, 82, 'rising',
      'A leap to No. 32 at FanGraphs and the Pipeline Top 100 coincided with explosive May and June sales, making Hartman a formation signal.',
      ['ranking velocity', 'center-field projection', 'sales acceleration', 'ahead of consensus'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Miami Marlins
    b('MIA', 'Thomas White', 'LHP', 'prospect', 84, 82, 'fragile',
      'A No. 9 FanGraphs rank and broad top-arm consensus sustain the dream, but shoulder trouble and pitcher volatility lower confidence.',
      ['top-10 FanGraphs rank', 'top pitching prospect', 'youth for level', 'shoulder risk'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('MIA', 'Aiva Arquette', 'SS', 'prospect', 79, 79, 'rising',
      'The physical No. 7 pick at shortstop reached No. 51 at FanGraphs while May and June hobby volume formed from almost nothing.',
      ['No. 7 pick', 'premium position', 'physical projection', 'sales acceleration'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // New York Mets
    b('NYM', 'Juan Soto', 'OF', 'established_star', 95, 97, 'holding',
      'Generational plate skill, a massive contract, the New York stage, and top-35 hobby volume create a permanent star floor.',
      ['generational plate skill', 'record contract', 'New York platform', 'durable demand'],
      [playerPage(665742), ALL_STAR, JERSEYS]),
    b('NYM', 'Nolan McLean', 'RHP', 'rookie', 85, 84, 'holding',
      'Former top pitching-prospect status, national-team visibility, and a headline 2026 rookie-card identity support unusually strong arm demand.',
      ['top pitching prospect', 'national-team visibility', 'rookie-card identity', 'hobby confirmed'],
      [playerPage(690997)]),
    b('NYM', 'Carson Benge', 'RF', 'rookie', 84, 84, 'rising',
      'A former top-20 prospect won an Opening Day role beside Soto and carries rising demand, though his balanced tools are less spectacular.',
      ['former top-20 prospect', 'Opening Day role', 'well-rounded tools', 'sales acceleration'],
      [playerPage(701807)]),

    // Philadelphia Phillies
    b('PHI', 'Bryce Harper', '1B/RF', 'established_star', 94, 96, 'holding',
      'The No. 1-pick prodigy story matured into MVP and Hall-level fame with a durable Philadelphia brand and top-40 hobby market.',
      ['No. 1 pick', 'MVP pedigree', 'Philadelphia icon', 'durable demand'],
      [playerPage(547180), ALL_STAR, JERSEYS]),
    b('PHI', 'Aidan Miller', 'SS', 'prospect', 70, 70, 'fragile',
      'Premium-position pedigree and former top-20 consensus preserve demand, but a full-season injury marker makes this residual rather than rising IT.',
      ['premium position', 'former top-20 prospect', 'residual demand', 'season-long injury'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('PHI', 'Andrew Painter', 'RHP', 'rookie', 64, 65, 'fragile',
      'Once-best-pitching-prospect pedigree still creates demand, but early MLB struggles, demotion, and falling sales show active narrative erosion.',
      ['former top pitching prospect', 'rookie-card base', 'MLB struggles', 'demotion risk'],
      [playerPage(691725)]),

    // Washington Nationals
    b('WSH', 'James Wood', 'OF', 'young_star', 91, 94, 'rising',
      'Top-tier exit velocity, towering physical presence, youth, and a second straight All-Star selection make the franchise-face story sticky.',
      ['elite exit velocity', 'rare frame', 'two-time All-Star', 'franchise face'],
      [playerPage(695578), ALL_STAR]),
    b('WSH', 'Eli Willits', 'SS', 'prospect', 90, 93, 'rising',
      'The youngest No. 1 pick since Griffey is succeeding at High-A with improving power and top-seven multi-source consensus.',
      ['No. 1 pick', 'historic youth', 'premium position', 'multi-source top seven'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('WSH', 'Dylan Crews', 'OF', 'young_star', 79, 80, 'fragile',
      'Golden Spikes, No. 2-pick, and former top-prospect identity still carry demand, but a less explosive MLB start needs revalidation.',
      ['Golden Spikes winner', 'No. 2 pick', 'residual prospect equity', 'needs revalidation'],
      [playerPage(686611)]),

    // Chicago Cubs
    b('CHC', 'Pete Crow-Armstrong', 'CF', 'young_star', 89, 91, 'rising',
      'Elite defense, visible speed and power, consecutive 20/20 seasons, and Chicago exposure have created a genuine young-star identity.',
      ['elite center-field defense', 'power-speed', 'Chicago platform', 'hobby acceleration'],
      [playerPage(691718), JERSEYS]),
    b('CHC', 'Matt Shaw', '3B', 'young_star', 76, 78, 'holding',
      'First-round and top-prospect pedigree keeps a collector base, but ordinary visual tools and flat sales leave only a partial lock.',
      ['first-round pedigree', 'former top prospect', 'MLB role', 'flat demand'],
      [playerPage(807713)]),
    b('CHC', 'Josiah Hartshorn', 'OF/1B', 'prospect', 77, 75, 'rising',
      'Teenage power and converging top-65 consensus pair with sharply rising June sales, though a corner profile raises the ceiling bar.',
      ['teenage power', 'multi-source top 65', 'sales acceleration', 'corner-profile risk'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Cincinnati Reds
    b('CIN', 'Elly De La Cruz', 'SS', 'young_star', 91, 94, 'holding',
      'Switch-hitting shortstop power, extreme speed, and constant highlights make Elly the hobby’s loudest non-Ohtani tool show.',
      ['80-grade speed', 'switch-hitting power', 'premium position', 'highlight visibility'],
      [playerPage(682829), JERSEYS]),
    b('CIN', 'Chase Burns', 'RHP', 'young_star', 85, 83, 'rising',
      'No. 2-pick pedigree, triple-digit fastball and slider spectacle, and early MLB impact create unusually good pitcher visibility.',
      ['No. 2 pick', 'triple-digit fastball', 'elite slider', 'young MLB impact'],
      [playerPage(695505)]),
    b('CIN', 'Sal Stewart', '2B/3B', 'rookie', 86, 85, 'rising',
      'Bat-first prospect success became a leading 2026 NL Rookie of the Year case with a tracked and growing baseball hobby market.',
      ['elite hit tool', 'ROY contender', 'young MLB bat', 'rookie-card demand'],
      [playerPage(701398), ROY_POLL]),

    // Milwaukee Brewers
    b('MIL', 'Jackson Chourio', 'OF', 'young_star', 89, 91, 'holding',
      'Historic youth, an early extension, playoff moments, and power-speed visuals created a durable face-of-franchise story.',
      ['historic youth', 'power-speed', 'playoff moments', 'franchise face'],
      [playerPage(694192)]),
    b('MIL', 'Jesús Made', 'SS', 'prospect', 91, 96, 'rising',
      'The consensus No. 1 prospect is a teenage Double-A switch hitter with 30-homer infield projection and exceptional non-graduate demand.',
      ['consensus No. 1', 'teenage Double-A hitter', 'switch hitter', 'premium position'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('MIL', 'Jacob Misiorowski', 'RHP', 'young_star', 91, 97, 'rising',
      'Two All-Star selections in two seasons and the hardest starter fastball ever recorded produce one of baseball’s loudest visual stories.',
      ['two-time All-Star', 'record velocity', 'ace performance', 'elite pitcher demand'],
      [playerPage(694819), ALL_STAR, MISIOROWSKI_VELOCITY]),

    // Pittsburgh Pirates
    b('PIT', 'Paul Skenes', 'RHP', 'young_star', 98, 98, 'holding',
      'Generational stuff, No. 1-pick and instant-ace mythology, and a defining modern-card chase make Skenes the rare pitcher with icon gravity.',
      ['generational arm', 'No. 1 pick', 'instant ace', 'elite hobby scale'],
      [playerPage(694973), JERSEYS]),
    b('PIT', 'Konnor Griffin', 'SS/CF', 'rookie', 91, 98, 'rising',
      'The former consensus No. 1 prospect brought five tools to MLB at 19 and became a headline Chrome chase with elite baseball demand.',
      ['former consensus No. 1', 'five-tool projection', 'teenage MLB debut', 'flagship chase'],
      [playerPage(804606), CHROME]),
    b('PIT', 'Seth Hernandez', 'RHP', 'prospect', 89, 90, 'rising',
      'The 2025 No. 6 pick pairs an upper-90s fastball and elite changeup with top-eight consensus and seven-figure hobby demand.',
      ['No. 6 pick', 'top-eight consensus', 'elite fastball-changeup', 'hobby confirmed'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // St. Louis Cardinals
    b('STL', 'JJ Wetherholt', '2B/SS', 'rookie', 90, 94, 'rising',
      'The former top prospect became an NL Rookie of the Year favorite and featured Chrome rookie with strong baseball demand.',
      ['former top prospect', 'ROY favorite', 'premium infield role', 'flagship chase'],
      [playerPage(802139), ROY_POLL, CHROME]),
    b('STL', 'Jordan Walker', 'RF', 'young_star', 88, 90, 'rising',
      'Residual top-prospect equity relocked when Walker won the 2026 Derby on six straight do-or-die homers before a national audience.',
      ['former top prospect', 'elite raw power', 'Derby champion', 'narrative relock'],
      [playerPage(691023), DERBY]),
    b('STL', 'Rainiel Rodriguez', 'C', 'prospect', 86, 87, 'rising',
      'A 19-year-old catcher with big power, top-25 multi-source consensus, and meaningful demand has a strong story despite positional attrition.',
      ['teenage catcher', 'big power', 'multi-source top 25', 'hobby confirmed'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Arizona Diamondbacks
    b('ARI', 'Corbin Carroll', 'CF', 'established_star', 86, 87, 'holding',
      'Rookie of the Year, speed and power, and World Series visibility created a durable young-star base that survives softer cycles.',
      ['Rookie of the Year', 'power-speed', 'World Series visibility', 'durable demand'],
      [playerPage(682998)]),
    b('ARI', 'Ryan Waldschmidt', 'CF', 'rookie', 74, 73, 'fragile',
      'The former team No. 1 prospect reached MLB after a strong Triple-A run, but modest and cooling demand makes this a call-up window.',
      ['former team No. 1 prospect', '2026 debut', 'center field', 'cooling demand'],
      [playerPage(814439)]),
    b('ARI', 'Druw Jones', 'CF', 'prospect', 68, 68, 'fragile',
      'No. 2-pick pedigree, a famous surname, and premium defense preserve residual demand despite the loss of current elite consensus.',
      ['No. 2 pick', 'baseball family', 'premium defense', 'lost consensus'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Colorado Rockies
    b('COL', 'Ethan Holliday', '3B', 'prospect', 84, 85, 'fragile',
      'No. 4-pick pedigree, an elite baseball surname, and projected infield power create sticky demand despite a full-season injury marker.',
      ['No. 4 pick', 'baseball family', 'projected power', 'season-long injury'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('COL', 'Charlie Condon', '1B/OF', 'prospect', 78, 77, 'rising',
      'Record-bonus and college-slugger pedigree plus a healthy power rebound restored consensus, with contact and corner risk still material.',
      ['record bonus', 'college slugger', 'power rebound', 'corner-profile risk'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // Los Angeles Dodgers
    b('LAD', 'Shohei Ohtani', 'DH/RHP', 'established_star', 100, 100, 'holding',
      'Ohtani is the hobby’s singular global brand: two-way impossibility, constant record chases, and a sales market in a category of one.',
      ['two-way icon', 'global superstar', 'record chases', 'singular hobby scale'],
      [playerPage(660271), CHROME, JERSEYS]),
    b('LAD', 'Yoshinobu Yamamoto', 'RHP', 'established_star', 91, 97, 'holding',
      'Three NPB MVPs, a 2025 World Series MVP, consecutive MLB All-Star selections, and Dodgers ace status created structural pitcher demand.',
      ['international superstar', 'World Series MVP', 'two-time MLB All-Star', 'Dodgers ace'],
      [playerPage(808967), YAMAMOTO_ALL_STAR, YAMAMOTO_PROFILE]),
    b('LAD', 'Roki Sasaki', 'RHP', 'young_star', 90, 93, 'rising',
      'Japan-to-Dodgers ace mythology, elite velocity and splitter visuals, and scarce early-card history support a top-30 baseball market.',
      ['international phenom', 'elite velocity', 'signature splitter', 'scarce early cards'],
      [playerPage(808963)]),

    // San Diego Padres
    b('SD', 'Fernando Tatis Jr.', 'RF', 'established_star', 87, 88, 'holding',
      'Charisma, premium athletic visuals, and an early face-of-baseball lock sustain demand after injuries and suspension.',
      ['early superstar lock', 'athletic visuals', 'marketability', 'residual demand'],
      [playerPage(665487), JERSEYS]),
    b('SD', 'Jackson Merrill', 'CF', 'young_star', 85, 86, 'holding',
      'A young center-field star with postseason and clutch mythology owns a broad rookie-card base, though demand is not yet permanent.',
      ['young center fielder', 'postseason moments', 'clutch narrative', 'rookie-card base'],
      [playerPage(701538)]),
    b('SD', 'Ethan Salas', 'C', 'prospect', 79, 79, 'rising',
      'The former teenage phenom re-entered elite consensus after injury and aggressive assignments, while hobby belief remains only partly restored.',
      ['former teenage phenom', 'top-12 FanGraphs rank', 'premium catcher', 'rebound narrative'],
      [FG_TOP_100, PIPELINE_TOP_100]),

    // San Francisco Giants
    b('SF', 'Bryce Eldridge', '1B/DH', 'rookie', 89, 89, 'rising',
      'A 6-foot-7 power prototype reached MLB as June sales exploded, making Eldridge one of the board’s strongest live formation signals.',
      ['70-grade power', 'rare frame', '2026 debut', 'sales acceleration'],
      [playerPage(805811), ROY_POLL]),
    b('SF', 'Josuar Gonzalez', 'SS', 'prospect', 87, 87, 'rising',
      'The top 2025 international amateur pairs a premium position with top-30 multi-source consensus and major demand at age 18.',
      ['top international amateur', 'premium position', 'age-18 production', 'hobby confirmed'],
      [FG_TOP_100, PIPELINE_TOP_100]),
    b('SF', 'Rafael Devers', '1B/DH', 'established_star', 84, 78, 'holding',
      'Long-lived prodigy and power identity plus broad recognition survive the move to San Francisco, though current hobby premium is modest.',
      ['former prodigy', 'elite left-handed power', 'established brand', 'new-team reset'],
      [playerPage(646240), JERSEYS]),
  ],
}
