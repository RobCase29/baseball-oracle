import { useDeferredValue, useEffect, useState } from 'react'
import {
  BookOpenCheck,
  Database,
  LockKeyhole,
} from 'lucide-react'
import {
  HOBBY_MASTER_SORT_KEYS,
  isHobbyMasterFeedResponse,
  type HobbyMasterFeedResponse,
  type HobbyMasterSortDirection,
  type HobbyMasterSortKey,
  type MagnificentXDomain,
  type MagnificentXResearchPosture,
} from '../domain/hobbyMasterRanking'
import {
  type BinderGraduationSortKey,
} from '../domain/binderGraduationIndex'
import {
  isBinderGraduationV2Response,
  type BinderGraduationV2Response,
} from '../domain/binderGraduationIndexV2'
import {
  filterItFactorEntries,
  isItFactorBadgeIndex,
  isItFactorBoardResponse,
  type ItFactorBoardResponse,
} from '../domain/itFactor'
import {
  isHobbyDecisionDeskArtifact,
  type HobbyDecisionDeskArtifact,
} from '../domain/hobbyDecisionDesk'
import itFactorBadgeIndexJson from '../data/it-factor-badges.v1.json'
import { InvestorWorkbench } from './InvestorWorkbench'
import {
  ResearchLensTabs,
  type HobbyMarketScreen,
  type HobbyResearchLens,
  type PlayerRankingSport,
} from './ResearchLensTabs'
import {
  CrossSportPlayerWorkbench,
  type PlayerRankingAgeCeiling,
  type PlayerRankingBand,
  type PlayerRankingPosition,
} from './CrossSportPlayerWorkbench'
import { GlobalBoardSearch } from './GlobalBoardSearch'
import { ItFactorBoard } from './ItFactorBoard'
import { HobbyDecisionDesk } from './HobbyDecisionDesk'

const PAGE_SIZE = 50
const DEFAULT_MARKET_SCREEN: HobbyMarketScreen = 'standard'
const DEFAULT_POSTURE: MagnificentXResearchPosture = 'build_candidate'
const DEFAULT_SORT: HobbyMasterSortKey = 'master_rank'
const DEFAULT_DIRECTION: HobbyMasterSortDirection = 'asc'
const DEFAULT_PLAYER_SPORT: PlayerRankingSport = 'all'
const DEFAULT_PLAYER_AGE: PlayerRankingAgeCeiling = 26
const DEFAULT_PLAYER_POSITION: PlayerRankingPosition = 'all'
const DEFAULT_PLAYER_BAND: PlayerRankingBand = 'all'
const DEFAULT_PLAYER_SORT: BinderGraduationSortKey = 'graduation_rank'
const itFactorBadgeEntries =
  isItFactorBadgeIndex(itFactorBadgeIndexJson)
    ? itFactorBadgeIndexJson.entries
    : []

const validDomains = new Set<MagnificentXDomain>([
  'baseball',
  'basketball',
  'football',
  'soccer',
  'hockey',
  'golf',
  'combat',
  'other_sport',
  'mixed_sport',
  'culture',
  'pokemon',
])

const validPostures = new Set<MagnificentXResearchPosture>([
  'build_candidate',
  'hold_candidate',
  'watch',
  'risk_review',
  'pass',
  'unrated',
  'needs_refresh',
])

const validSorts = new Set<HobbyMasterSortKey>(HOBBY_MASTER_SORT_KEYS)

function initialParameters(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function initialLens(): HobbyResearchLens {
  const parameters = initialParameters()
  const value = parameters.get('lens')
  if (value === 'players' || value === 'young') return 'players'
  if (value === 'desk') return 'desk'
  if (value === 'market' || value === 'it') return value
  if (
    [
      'q',
      'domain',
      'direction',
      'screen',
      'posture',
      'sort',
      'page',
      'tier',
    ].some((parameter) => parameters.has(parameter))
  ) {
    return 'market'
  }
  return 'desk'
}

function initialMarketScreen(): HobbyMarketScreen {
  const parameters = initialParameters()
  return (
    parameters.get('screen') === 'breakout' &&
    !parameters.get('q')?.trim()
  )
    ? 'breakout'
    : DEFAULT_MARKET_SCREEN
}

function initialPlayerSport(): PlayerRankingSport {
  const value = initialParameters().get('sport')
  return value === 'baseball' ||
      value === 'football' ||
      value === 'basketball' ||
      value === 'all'
    ? value
    : DEFAULT_PLAYER_SPORT
}

function initialDomain(): MagnificentXDomain | 'all' {
  const value = initialParameters().get('domain')
  return value && validDomains.has(value as MagnificentXDomain)
    ? value as MagnificentXDomain
    : 'all'
}

function initialPosture(): MagnificentXResearchPosture | 'all' {
  const parameters = initialParameters()
  const value = parameters.get('posture')
  if (value === 'all') return 'all'
  if (value && validPostures.has(value as MagnificentXResearchPosture)) {
    return value as MagnificentXResearchPosture
  }
  const legacyTier = parameters.get('tier')
  if (legacyTier === 'market_leader') return 'build_candidate'
  if (legacyTier === 'durable_demand') return 'hold_candidate'
  if (legacyTier === 'watch') return 'watch'
  if (legacyTier === 'noise_risk') return 'risk_review'
  if (legacyTier === 'long_tail') return 'pass'
  if (legacyTier === 'evidence_needed') return 'unrated'
  if (parameters.get('q')?.trim()) return 'all'
  if (parameters.get('screen') === 'breakout') return 'all'
  return DEFAULT_POSTURE
}

function initialSort(): HobbyMasterSortKey {
  const value = initialParameters().get('sort')
  if (value === 'signal') return 'master_score'
  if (value && validSorts.has(value as HobbyMasterSortKey)) {
    return value as HobbyMasterSortKey
  }
  return initialMarketScreen() === 'breakout' ? 'breakout' : DEFAULT_SORT
}

function initialDirection(): HobbyMasterSortDirection {
  const explicit = initialParameters().get('direction')
  if (explicit === 'asc' || explicit === 'desc') return explicit
  const sort = initialSort()
  return sort === 'master_rank' ||
    sort === 'cohort_rank' ||
    sort === 'name'
    ? 'asc'
    : 'desc'
}

function initialPage(): number {
  const value = Number.parseInt(initialParameters().get('page') ?? '1', 10)
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

function initialPlayerAge(): PlayerRankingAgeCeiling {
  const parameters = initialParameters()
  const value = Number.parseInt(parameters.get('maxAge') ?? '', 10)
  return value === 23 || value === 26 || value === 30
    ? value
    : parameters.get('q')?.trim()
      ? 'all'
      : DEFAULT_PLAYER_AGE
}

function initialPlayerPosition(): PlayerRankingPosition {
  return initialParameters().get('position') ?? DEFAULT_PLAYER_POSITION
}

function initialPlayerBand(): PlayerRankingBand {
  const value = initialParameters().get('band')
  if (
    value === 'graduated' ||
    value === 'on_deck' ||
    value === 'approaching' ||
    value === 'developing' ||
    value === 'long_range' ||
    value === 'withheld'
  ) {
    return value
  }
  const legacyPosture = initialParameters().get('posture')
  if (legacyPosture === 'Build') return 'on_deck'
  if (legacyPosture === 'Research') return 'approaching'
  if (legacyPosture === 'Watch') return 'developing'
  if (legacyPosture === 'Deprioritize') return 'long_range'
  return DEFAULT_PLAYER_BAND
}

function initialPlayerSort(): BinderGraduationSortKey {
  const value = initialParameters().get('sort')
  return value === 'graduation_index' ||
      value === 'market_readiness' ||
      value === 'player_outlook' ||
      value === 'ttm_sales' ||
      value === 'current_run_rate' ||
      value === 'age' ||
      value === 'name'
    ? value
    : DEFAULT_PLAYER_SORT
}

function formatDate(value: string | undefined): string {
  if (!value) return 'Loading'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

function itFactorSnapshotStatus(
  response: ItFactorBoardResponse | null,
): 'current' | 'review_due' | 'unknown' {
  if (!response) return 'unknown'
  const reviewDeadline = new Date(
    `${response.snapshot.nextReviewBy}T23:59:59.999Z`,
  )
  if (
    !Number.isNaN(reviewDeadline.getTime()) &&
    Date.now() > reviewDeadline.getTime()
  ) {
    return 'review_due'
  }
  return response.snapshot.status
}

export function HobbyApp() {
  const [lens, setLens] = useState<HobbyResearchLens>(initialLens)
  const [marketScreen, setMarketScreen] =
    useState<HobbyMarketScreen>(initialMarketScreen)
  const [search, setSearch] = useState(() => (
    initialLens() === 'market' ? initialParameters().get('q') ?? '' : ''
  ))
  const [domain, setDomain] = useState<MagnificentXDomain | 'all'>(initialDomain)
  const [posture, setPosture] = useState<
    MagnificentXResearchPosture | 'all'
  >(initialPosture)
  const [sort, setSort] = useState<HobbyMasterSortKey>(initialSort)
  const [direction, setDirection] =
    useState<HobbyMasterSortDirection>(initialDirection)
  const [page, setPage] = useState(initialPage)
  const [playerSport, setPlayerSport] =
    useState<PlayerRankingSport>(initialPlayerSport)
  const [playerAgeMax, setPlayerAgeMax] =
    useState<PlayerRankingAgeCeiling>(initialPlayerAge)
  const [playerPosition, setPlayerPosition] =
    useState<PlayerRankingPosition>(initialPlayerPosition)
  const [playerBand, setPlayerBand] =
    useState<PlayerRankingBand>(initialPlayerBand)
  const [playerSort, setPlayerSort] =
    useState<BinderGraduationSortKey>(initialPlayerSort)
  const [playerSearch, setPlayerSearch] = useState(() => (
    initialLens() === 'players'
      ? initialParameters().get('q') ?? ''
      : ''
  ))
  const [itSearch, setItSearch] = useState(() => (
    initialLens() === 'it'
      ? initialParameters().get('q') ?? ''
      : ''
  ))
  const [response, setResponse] =
    useState<HobbyMasterFeedResponse | null>(null)
  const [loading, setLoading] = useState(() => initialLens() === 'market')
  const [error, setError] = useState<string | null>(null)
  const [playerResponse, setPlayerResponse] =
    useState<BinderGraduationV2Response | null>(null)
  const [playerLoading, setPlayerLoading] = useState(() => (
    initialLens() === 'players'
  ))
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [itFactorBoard, setItFactorBoard] =
    useState<ItFactorBoardResponse | null>(null)
  const [itFactorLoading, setItFactorLoading] = useState(() => (
    initialLens() === 'it'
  ))
  const [itFactorError, setItFactorError] = useState<string | null>(null)
  const [decisionArtifact, setDecisionArtifact] =
    useState<HobbyDecisionDeskArtifact | null>(null)
  const [decisionLoading, setDecisionLoading] = useState(() => (
    initialLens() === 'desk'
  ))
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)
  const deferredPlayerSearch = useDeferredValue(playerSearch)

  useEffect(() => {
    if (lens !== 'it') return
    if (itFactorBoard !== null) {
      setItFactorLoading(false)
      return
    }
    let active = true
    setItFactorLoading(true)
    setItFactorError(null)
    import('../data/it-factor-board.v1.json')
      .then((module) => {
        if (!active) return
        const payload = module.default as unknown
        if (!isItFactorBoardResponse(payload)) {
          throw new Error('The bundled IT dataset failed contract validation.')
        }
        setItFactorBoard(payload)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setItFactorError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load the IT research layer.',
        )
      })
      .finally(() => {
        if (active) setItFactorLoading(false)
      })

    return () => {
      active = false
    }
  }, [itFactorBoard, lens])

  useEffect(() => {
    if (lens !== 'desk') return
    if (decisionArtifact !== null) {
      setDecisionLoading(false)
      return
    }
    let active = true
    setDecisionLoading(true)
    setDecisionError(null)
    import('../data/hobby-decision-desk.v1.json')
      .then((module) => {
        if (!active) return
        const payload = module.default as unknown
        if (!isHobbyDecisionDeskArtifact(payload)) {
          throw new Error(
            'The bundled Decision Desk failed contract validation.',
          )
        }
        setDecisionArtifact(payload)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setDecisionError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load the Decision Desk signals.',
        )
      })
      .finally(() => {
        if (active) setDecisionLoading(false)
      })

    return () => {
      active = false
    }
  }, [decisionArtifact, lens])

  useEffect(() => {
    if (lens !== 'market') return
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      posture,
      sort,
      direction,
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
    })
    if (marketScreen === 'breakout') parameters.set('screen', 'breakout')
    const normalizedSearch = deferredSearch.trim()
    if (normalizedSearch) parameters.set('q', normalizedSearch)
    if (domain !== 'all') parameters.set('domain', domain)

    setLoading(true)
    setError(null)
    setResponse(null)
    fetch(`/api/v2/hobby-oracle?${parameters.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Build Board returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (!isHobbyMasterFeedResponse(payload)) {
          throw new Error('Build Board returned an unexpected response.')
        }
        setResponse(payload)
      })
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        setResponse(null)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load the Build Board.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [
    deferredSearch,
    direction,
    domain,
    lens,
    marketScreen,
    page,
    posture,
    sort,
  ])

  useEffect(() => {
    if (lens !== 'players') return
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      sport: playerSport,
      band: playerBand,
      sort: playerSort,
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
    })
    const normalizedSearch = deferredPlayerSearch.trim()
    if (normalizedSearch) parameters.set('q', normalizedSearch)
    if (playerAgeMax !== 'all') {
      parameters.set('maxAge', playerAgeMax.toString())
    }
    if (playerPosition !== 'all') {
      parameters.set('position', playerPosition)
    }

    setPlayerLoading(true)
    setPlayerError(null)
    setPlayerResponse(null)
    fetch(`/api/v2/backstop-binder-index?${parameters.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Graduation Board returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (
          !isBinderGraduationV2Response(payload) ||
          (
            playerSport !== 'all' &&
            payload.items.some(
              (item) => item.player.sport !== playerSport,
            )
          )
        ) {
          throw new Error('Graduation Board returned an unexpected response.')
        }
        setPlayerResponse(payload)
      })
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        setPlayerResponse(null)
        setPlayerError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load the Graduation Board.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlayerLoading(false)
      })

    return () => controller.abort()
  }, [
    deferredPlayerSearch,
    lens,
    page,
    playerAgeMax,
    playerBand,
    playerPosition,
    playerSort,
    playerSport,
  ])

  useEffect(() => {
    if (
      lens === 'market' &&
      response?.snapshot.freshness.status !== 'current' &&
      response !== null &&
      posture === DEFAULT_POSTURE
    ) {
      setPosture('needs_refresh')
      setSort('name')
      setDirection('asc')
      setPage(1)
    }
  }, [lens, posture, response])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (lens === 'desk') {
      url.searchParams.set('lens', 'desk')
      url.searchParams.delete('q')
      url.searchParams.delete('domain')
      url.searchParams.delete('direction')
      url.searchParams.delete('screen')
      url.searchParams.delete('sport')
      url.searchParams.delete('maxAge')
      url.searchParams.delete('stage')
      url.searchParams.delete('position')
      url.searchParams.delete('band')
      url.searchParams.delete('format')
      url.searchParams.delete('posture')
      url.searchParams.delete('sort')
    } else if (lens === 'players') {
      url.searchParams.set('lens', 'players')
      url.searchParams.delete('domain')
      url.searchParams.delete('direction')
      url.searchParams.delete('screen')
      url.searchParams.set('sport', playerSport)
      const normalizedPlayerSearch = playerSearch.trim()
      if (normalizedPlayerSearch) {
        url.searchParams.set('q', normalizedPlayerSearch)
      } else {
        url.searchParams.delete('q')
      }
      if (
        playerAgeMax === DEFAULT_PLAYER_AGE ||
        playerAgeMax === 'all'
      ) {
        url.searchParams.delete('maxAge')
      } else {
        url.searchParams.set('maxAge', playerAgeMax.toString())
      }
      if (playerPosition === DEFAULT_PLAYER_POSITION) {
        url.searchParams.delete('position')
      } else {
        url.searchParams.set('position', playerPosition)
      }
      if (playerBand === DEFAULT_PLAYER_BAND) {
        url.searchParams.delete('band')
      } else {
        url.searchParams.set('band', playerBand)
      }
      url.searchParams.delete('posture')
      if (playerSort === DEFAULT_PLAYER_SORT) {
        url.searchParams.delete('sort')
      } else {
        url.searchParams.set('sort', playerSort)
      }
      url.searchParams.delete('stage')
      url.searchParams.delete('format')
    } else if (lens === 'it') {
      url.searchParams.set('lens', 'it')
      url.searchParams.delete('domain')
      url.searchParams.delete('direction')
      url.searchParams.delete('screen')
      url.searchParams.delete('sport')
      url.searchParams.delete('maxAge')
      url.searchParams.delete('stage')
      url.searchParams.delete('position')
      url.searchParams.delete('band')
      url.searchParams.delete('format')
      url.searchParams.delete('posture')
      url.searchParams.delete('sort')
      const normalizedItSearch = itSearch.trim()
      if (normalizedItSearch) {
        url.searchParams.set('q', normalizedItSearch)
      } else {
        url.searchParams.delete('q')
      }
    } else {
      const normalizedSearch = search.trim()
      url.searchParams.set('lens', 'market')
      url.searchParams.delete('sport')
      url.searchParams.delete('maxAge')
      url.searchParams.delete('stage')
      url.searchParams.delete('position')
      url.searchParams.delete('band')
      url.searchParams.delete('format')
      if (marketScreen === 'breakout') {
        url.searchParams.set('screen', 'breakout')
      } else {
        url.searchParams.delete('screen')
      }
      if (normalizedSearch) url.searchParams.set('q', normalizedSearch)
      else url.searchParams.delete('q')
      if (domain === 'all') url.searchParams.delete('domain')
      else url.searchParams.set('domain', domain)
      url.searchParams.set('posture', posture)
      url.searchParams.set('sort', sort)
      url.searchParams.set('direction', direction)
    }
    if (lens === 'desk' || lens === 'it' || page === 1) {
      url.searchParams.delete('page')
    }
    else url.searchParams.set('page', page.toString())
    url.searchParams.delete('tier')
    window.history.replaceState(window.history.state, '', url)
  }, [
    direction,
    domain,
    itSearch,
    lens,
    marketScreen,
    page,
    playerAgeMax,
    playerBand,
    playerPosition,
    playerSearch,
    playerSort,
    playerSport,
    posture,
    search,
    sort,
  ])

  function changeSearch(value: string): void {
    const enteringGlobalSearch =
      value.trim().length > 0 &&
      (
        search.trim().length === 0 ||
        domain !== 'all' ||
        posture !== 'all'
      )
    setSearch(value)
    if (enteringGlobalSearch) {
      setMarketScreen(DEFAULT_MARKET_SCREEN)
      setDomain('all')
      setPosture('all')
      setSort(DEFAULT_SORT)
      setDirection(DEFAULT_DIRECTION)
    }
    setPage(1)
  }

  function changeDomain(value: MagnificentXDomain | 'all'): void {
    setDomain(value)
    setPage(1)
  }

  function changePosture(
    value: MagnificentXResearchPosture | 'all',
  ): void {
    setLens('market')
    setPosture(value)
    setSort(value === 'unrated' || value === 'needs_refresh'
      ? 'name'
      : 'master_rank')
    setDirection('asc')
    setPage(1)
  }

  function selectPositions(): void {
    setLens('market')
    setMarketScreen(DEFAULT_MARKET_SCREEN)
    setPosture(DEFAULT_POSTURE)
    setSort(DEFAULT_SORT)
    setDirection(DEFAULT_DIRECTION)
    setPage(1)
  }

  function selectBreakout(): void {
    setLens('market')
    setMarketScreen('breakout')
    setSearch('')
    setPosture('all')
    setSort('breakout')
    setDirection('desc')
    setPage(1)
  }

  function selectDecisionDesk(): void {
    setLens('desk')
    setPage(1)
  }

  function selectPlayerRankings(): void {
    setLens('players')
    setPage(1)
  }

  function selectItFactor(): void {
    setLens('it')
    setPage(1)
  }

  function changePlayerSport(value: PlayerRankingSport): void {
    setPlayerSport(value)
    setPlayerPosition(DEFAULT_PLAYER_POSITION)
    setPage(1)
  }

  function changeSort(value: HobbyMasterSortKey): void {
    setSort(value)
    setPage(1)
  }

  function changeDirection(value: HobbyMasterSortDirection): void {
    setDirection(value)
    setPage(1)
  }

  function resetFilters(): void {
    setMarketScreen(DEFAULT_MARKET_SCREEN)
    setSearch('')
    setDomain('all')
    setPosture(DEFAULT_POSTURE)
    setSort(DEFAULT_SORT)
    setDirection(DEFAULT_DIRECTION)
    setPage(1)
  }

  function changePlayerAge(value: PlayerRankingAgeCeiling): void {
    setPlayerAgeMax(value)
    setPage(1)
  }

  function changePlayerPosition(value: PlayerRankingPosition): void {
    setPlayerPosition(value)
    setPage(1)
  }

  function changePlayerBand(value: PlayerRankingBand): void {
    setPlayerBand(value)
    setPage(1)
  }

  function changePlayerSort(value: BinderGraduationSortKey): void {
    setPlayerSort(value)
    setPage(1)
  }

  function changePlayerSearch(value: string): void {
    const enteringGlobalSearch =
      value.trim().length > 0 &&
      (
        playerSearch.trim().length === 0 ||
        playerSport !== 'all' ||
        playerAgeMax !== 'all' ||
        playerPosition !== 'all' ||
        playerBand !== 'all'
      )
    setPlayerSearch(value)
    if (enteringGlobalSearch) {
      setPlayerSport(DEFAULT_PLAYER_SPORT)
      setPlayerAgeMax('all')
      setPlayerPosition(DEFAULT_PLAYER_POSITION)
      setPlayerBand(DEFAULT_PLAYER_BAND)
      setPlayerSort(DEFAULT_PLAYER_SORT)
    }
    setPage(1)
  }

  function resetPlayerFilters(): void {
    setPlayerAgeMax(DEFAULT_PLAYER_AGE)
    setPlayerPosition(DEFAULT_PLAYER_POSITION)
    setPlayerBand(DEFAULT_PLAYER_BAND)
    setPlayerSort(DEFAULT_PLAYER_SORT)
    setPlayerSearch('')
    setPage(1)
  }

  function changeItSearch(value: string): void {
    setItSearch(value)
  }

  function resetItSearch(): void {
    setItSearch('')
  }

  const decisionDesk = decisionArtifact?.desk ?? null
  const marketFreshness = response?.snapshot.freshness.status ?? 'unknown'
  const graduationFreshness =
    playerResponse?.snapshot.freshness.status ?? 'unknown'
  const itFreshness = itFactorSnapshotStatus(itFactorBoard)
  const decisionReviewDeadline = decisionArtifact
    ? new Date(`${decisionArtifact.snapshot.itNextReviewBy}T23:59:59.999Z`)
    : null
  const decisionFreshness = decisionArtifact === null
    ? 'unknown'
    : decisionReviewDeadline &&
        !Number.isNaN(decisionReviewDeadline.getTime()) &&
        Date.now() > decisionReviewDeadline.getTime()
      ? 'review_due'
      : 'current'
  const freshness = lens === 'desk'
    ? decisionFreshness
    : lens === 'market'
      ? marketFreshness
      : lens === 'players'
        ? graduationFreshness
        : itFreshness
  const dataThrough = lens === 'desk'
    ? decisionArtifact?.snapshot.marketDataThrough
    : lens === 'market'
      ? response?.snapshot.dataThrough
      : lens === 'players'
        ? playerResponse?.snapshot.dataThrough
        : itFactorBoard?.snapshot.asOf
  const headlineMetricLabel = lens === 'desk'
    ? 'Surfaced subjects'
    : lens === 'market'
      ? marketScreen === 'breakout'
        ? 'On Breakout Radar'
        : 'On Build Board'
      : lens === 'players'
        ? 'On Deck'
        : 'Flagged players'
  const headlineMetricValue = lens === 'desk'
    ? decisionDesk?.uniqueSubjectCount
    : lens === 'market'
      ? marketScreen === 'breakout'
        ? response?.page.total
        : response?.meta.buildCount
      : lens === 'players'
        ? playerResponse?.summary.onDeckCount
        : itFactorBoard?.coverage.entryCount
  const showRefreshPosture =
    posture === 'needs_refresh' ||
    (response !== null && response.snapshot.freshness.status !== 'current')
  const activeSearch = lens === 'market'
    ? search
    : lens === 'players'
      ? playerSearch
      : itSearch
  const searchLoading = lens === 'market'
    ? loading
    : lens === 'players'
      ? playerLoading
      : false
  const searchResultCount = lens === 'market'
    ? response?.page.total ?? null
    : lens === 'players'
      ? playerResponse?.page.total ?? null
      : itFactorBoard
        ? filterItFactorEntries(itFactorBoard.entries, itSearch).length
        : null

  return (
    <div className="mx-app">
      <header className="mx-topbar">
        <a
          className="mx-brand"
          href="/hobby?lens=desk"
          aria-label="Backstop Binder Index"
        >
          <span className="mx-brand-mark" aria-hidden="true">
            <BookOpenCheck size={18} />
          </span>
          <span>
            <small>BACKSTOP CARDS</small>
            <strong>BINDER INDEX</strong>
          </span>
        </a>
        <nav className="mx-nav" aria-label="Binder Index sections">
          <a href="/hobby?lens=desk">Decision Desk</a>
          <a href="/hobby?lens=market">Build Board</a>
          <a href="/hobby?lens=players">Graduation Board</a>
          <a href="/hobby?lens=it">IT Board</a>
          <a href="/hobby?view=top100">Print</a>
        </nav>
      </header>

      <main className="mx-main">
        <section className="mx-page-heading" aria-labelledby="investor-workbench-title">
          <div className="mx-heading-copy">
            <span>BACKSTOP BINDER INDEX</span>
            <h1 id="investor-workbench-title">
              {lens === 'desk'
                ? 'The Decision Desk'
                : lens === 'market'
                  ? marketScreen === 'breakout'
                    ? 'The Breakout Radar'
                    : 'The Build Board'
                  : lens === 'players'
                    ? 'The Graduation Board'
                    : 'The IT Board'}
            </h1>
            <p>
              {lens === 'desk'
                ? 'Transparent intersections reveal where durable demand, player path, narrative, momentum, and risk reinforce—or challenge—one another.'
                : lens === 'market'
                  ? marketScreen === 'breakout'
                    ? 'A selective small- and mid-demand screen for subjects adding real completed-sales dollars with broad, accelerating momentum.'
                    : 'The few subjects whose demand scale and durability have earned a place in a long-horizon collection.'
                  : lens === 'players'
                    ? 'One global baseball, football, and basketball pipeline, ranked by readiness to earn the exact same absolute Build standard.'
                    : 'A researched team-by-team map of the players whose superstar ceiling already carries hobby belief.'}
            </p>
          </div>

          <dl className="mx-snapshot-strip">
            <div>
              <dt>{headlineMetricLabel}</dt>
              <dd>{headlineMetricValue?.toLocaleString() ?? '—'}</dd>
            </div>
            <div>
              <dt>Data through</dt>
              <dd>{formatDate(dataThrough)}</dd>
            </div>
            <div className={`mx-freshness mx-freshness--${freshness}`}>
              <dt>Snapshot</dt>
              <dd>
                <Database size={12} aria-hidden="true" />
                {freshness}
              </dd>
            </div>
          </dl>
        </section>

        <aside className="mx-boundary-note" aria-label="Research scope">
          <LockKeyhole size={15} aria-hidden="true" />
          <strong>Subject-level research only.</strong>
          <span>
            Card, grade, supply, entry price, liquidity, and personal risk
            tolerance remain separate underwriting.
          </span>
        </aside>

        <section
          className="iw-shell"
          aria-label="Backstop Binder Index boards"
        >
          {lens !== 'desk' ? (
            <GlobalBoardSearch
              lens={lens}
              value={activeSearch}
              loading={searchLoading}
              resultCount={lens === 'it' ? null : searchResultCount}
              onChange={
                lens === 'market'
                  ? changeSearch
                  : lens === 'players'
                    ? changePlayerSearch
                    : changeItSearch
              }
            />
          ) : null}
          <ResearchLensTabs
            lens={lens}
            marketScreen={marketScreen}
            posture={posture}
            playerSport={playerSport}
            showRefresh={showRefreshPosture}
            onDecisionDeskSelect={selectDecisionDesk}
            onMarketSelect={selectPositions}
            onBreakoutSelect={selectBreakout}
            onPlayerRankingsSelect={selectPlayerRankings}
            onItFactorSelect={selectItFactor}
            onPlayerSportSelect={changePlayerSport}
            onPostureSelect={changePosture}
          />
          {lens === 'desk' ? (
            <HobbyDecisionDesk
              desk={decisionDesk}
              loading={decisionLoading}
              error={decisionError}
              marketDataThrough={
                decisionArtifact?.snapshot.marketDataThrough ?? null
              }
              graduationDataThrough={
                decisionArtifact?.snapshot.pathDataThrough ?? null
              }
              itReviewedAsOf={
                decisionArtifact?.snapshot.itReviewedAsOf ?? null
              }
              coverageLimitations={
                decisionArtifact?.coverage.limitations ?? []
              }
            />
          ) : lens === 'market' ? (
            <InvestorWorkbench
              response={response}
              loading={loading}
              error={error}
              search={search}
              marketScreen={marketScreen}
              domain={domain}
              posture={posture}
              sort={sort}
              direction={direction}
              page={page}
              onDomainChange={changeDomain}
              onSortChange={changeSort}
              onDirectionChange={changeDirection}
              onPageChange={setPage}
              onReset={resetFilters}
              itFactorEntries={itFactorBadgeEntries}
            />
          ) : lens === 'players' ? (
            <CrossSportPlayerWorkbench
              response={playerResponse}
              loading={playerLoading}
              error={playerError}
              sport={playerSport}
              maxAge={playerAgeMax}
              position={playerPosition}
              band={playerBand}
              sort={playerSort}
              search={playerSearch}
              page={page}
              onMaxAgeChange={changePlayerAge}
              onPositionChange={changePlayerPosition}
              onBandChange={changePlayerBand}
              onSortChange={changePlayerSort}
              onPageChange={setPage}
              onReset={resetPlayerFilters}
              itFactorEntries={itFactorBadgeEntries}
            />
          ) : (
            <ItFactorBoard
              response={itFactorBoard}
              loading={itFactorLoading}
              error={itFactorError}
              search={itSearch}
              onResetSearch={resetItSearch}
            />
          )}
        </section>
      </main>

      <footer className="mx-footer" id="methodology">
        <span>Backstop Binder Index · long-horizon collection research</span>
        <nav aria-label="Data sources">
          <a
            href="https://www.gemrate.com/sales-trends"
            target="_blank"
            rel="noreferrer"
          >
            GemRate Athlete
          </a>
          <a href="/api/players?view=map">
            Career Oracle
          </a>
          <a
            href="https://www.gemrate.com/sales-trends-pokemon"
            target="_blank"
            rel="noreferrer"
          >
            GemRate Pokémon
          </a>
          <a
            href="https://keeptradecut.com/dynasty-rankings?format=2&page=0"
            target="_blank"
            rel="noreferrer"
          >
            KTC Dynasty
          </a>
          <a
            href="https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings"
            target="_blank"
            rel="noreferrer"
          >
            Hashtag Basketball
          </a>
        </nav>
      </footer>
    </div>
  )
}
