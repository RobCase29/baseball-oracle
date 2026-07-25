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
  isBinderScoresResponse,
  type BinderScoresResponse,
} from '../domain/binderScore'
import {
  isBinderGraduationResponse,
  type BinderGraduationResponse,
  type BinderGraduationSortKey,
} from '../domain/binderGraduationIndex'
import { InvestorWorkbench } from './InvestorWorkbench'
import {
  ResearchLensTabs,
  type HobbyResearchLens,
  type PlayerRankingSport,
} from './ResearchLensTabs'
import {
  YoungInvestorWorkbench,
  type YoungPlayerAgeCeiling,
  type YoungPlayerStage,
} from './YoungInvestorWorkbench'
import {
  CrossSportPlayerWorkbench,
  type PlayerRankingAgeCeiling,
  type PlayerRankingBand,
  type PlayerRankingPosition,
} from './CrossSportPlayerWorkbench'

const PAGE_SIZE = 50
const DEFAULT_POSTURE: MagnificentXResearchPosture = 'build_candidate'
const DEFAULT_SORT: HobbyMasterSortKey = 'master_rank'
const DEFAULT_DIRECTION: HobbyMasterSortDirection = 'asc'
const DEFAULT_YOUNG_AGE: YoungPlayerAgeCeiling = 25
const DEFAULT_YOUNG_STAGE: YoungPlayerStage = 'All'
const DEFAULT_PLAYER_SPORT: PlayerRankingSport = 'all'
const DEFAULT_PLAYER_AGE: PlayerRankingAgeCeiling = 26
const DEFAULT_PLAYER_POSITION: PlayerRankingPosition = 'all'
const DEFAULT_PLAYER_BAND: PlayerRankingBand = 'all'
const DEFAULT_PLAYER_SORT: BinderGraduationSortKey = 'graduation_rank'

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
  const value = initialParameters().get('lens')
  return value === 'players' || value === 'young' ? 'players' : 'market'
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
  return DEFAULT_POSTURE
}

function initialSort(): HobbyMasterSortKey {
  const value = initialParameters().get('sort')
  if (value === 'signal') return 'master_score'
  if (value && validSorts.has(value as HobbyMasterSortKey)) {
    return value as HobbyMasterSortKey
  }
  return DEFAULT_SORT
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

function initialYoungAge(): YoungPlayerAgeCeiling {
  const value = Number.parseInt(initialParameters().get('maxAge') ?? '', 10)
  return value === 21 || value === 23 || value === 25 || value === 27
    ? value
    : DEFAULT_YOUNG_AGE
}

function initialYoungStage(): YoungPlayerStage {
  const value = initialParameters().get('stage')
  return value === 'Minors' || value === 'RC' || value === 'MLB'
    ? value
    : DEFAULT_YOUNG_STAGE
}

function initialPlayerAge(): PlayerRankingAgeCeiling {
  const value = Number.parseInt(initialParameters().get('maxAge') ?? '', 10)
  return value === 23 || value === 26 || value === 30
    ? value
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

export function HobbyApp() {
  const [lens, setLens] = useState<HobbyResearchLens>(initialLens)
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
  const [youngAgeMax, setYoungAgeMax] =
    useState<YoungPlayerAgeCeiling>(initialYoungAge)
  const [youngStage, setYoungStage] =
    useState<YoungPlayerStage>(initialYoungStage)
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
    initialLens() === 'players' && initialPlayerSport() !== 'baseball'
      ? initialParameters().get('q') ?? ''
      : ''
  ))
  const [response, setResponse] =
    useState<HobbyMasterFeedResponse | null>(null)
  const [loading, setLoading] = useState(() => initialLens() === 'market')
  const [error, setError] = useState<string | null>(null)
  const [youngResponse, setYoungResponse] =
    useState<BinderScoresResponse | null>(null)
  const [youngLoading, setYoungLoading] =
    useState(() => (
      initialLens() === 'players' && initialPlayerSport() === 'baseball'
    ))
  const [youngError, setYoungError] = useState<string | null>(null)
  const [playerResponse, setPlayerResponse] =
    useState<BinderGraduationResponse | null>(null)
  const [playerLoading, setPlayerLoading] = useState(() => (
    initialLens() === 'players' && initialPlayerSport() !== 'baseball'
  ))
  const [playerError, setPlayerError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)
  const deferredPlayerSearch = useDeferredValue(playerSearch)

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
  }, [deferredSearch, direction, domain, lens, page, posture, sort])

  useEffect(() => {
    if (lens !== 'players' || playerSport !== 'baseball') return
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      stage: youngStage,
      maxAge: youngAgeMax.toString(),
      rankedOnly: 'true',
      sort: 'binderScore',
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
    })

    setYoungLoading(true)
    setYoungError(null)
    setYoungResponse(null)
    fetch(`/api/v1/binder-scores?${parameters.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Young-player screen returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (!isBinderScoresResponse(payload)) {
          throw new Error('Young-player screen returned an unexpected response.')
        }
        setYoungResponse(payload)
      })
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        setYoungResponse(null)
        setYoungError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load the young-player screen.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setYoungLoading(false)
      })

    return () => controller.abort()
  }, [lens, page, playerSport, youngAgeMax, youngStage])

  useEffect(() => {
    if (lens !== 'players' || playerSport === 'baseball') return
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
    fetch(`/api/v1/backstop-binder-index?${parameters.toString()}`, {
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
          !isBinderGraduationResponse(payload) ||
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
    if (lens === 'players') {
      url.searchParams.set('lens', 'players')
      url.searchParams.delete('domain')
      url.searchParams.delete('direction')
      url.searchParams.set('sport', playerSport)
      if (playerSport !== 'baseball') {
        const normalizedPlayerSearch = playerSearch.trim()
        if (normalizedPlayerSearch) {
          url.searchParams.set('q', normalizedPlayerSearch)
        } else {
          url.searchParams.delete('q')
        }
        if (playerAgeMax === DEFAULT_PLAYER_AGE) {
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
      } else {
        url.searchParams.set('maxAge', youngAgeMax.toString())
        if (youngStage === DEFAULT_YOUNG_STAGE) url.searchParams.delete('stage')
        else url.searchParams.set('stage', youngStage)
        url.searchParams.delete('q')
        url.searchParams.delete('position')
        url.searchParams.delete('band')
        url.searchParams.delete('posture')
        url.searchParams.delete('sort')
      }
      url.searchParams.delete('format')
    } else {
      const normalizedSearch = search.trim()
      url.searchParams.delete('lens')
      url.searchParams.delete('sport')
      url.searchParams.delete('maxAge')
      url.searchParams.delete('stage')
      url.searchParams.delete('position')
      url.searchParams.delete('band')
      url.searchParams.delete('format')
      if (normalizedSearch) url.searchParams.set('q', normalizedSearch)
      else url.searchParams.delete('q')
      if (domain === 'all') url.searchParams.delete('domain')
      else url.searchParams.set('domain', domain)
      url.searchParams.set('posture', posture)
      url.searchParams.set('sort', sort)
      url.searchParams.set('direction', direction)
    }
    if (page === 1) url.searchParams.delete('page')
    else url.searchParams.set('page', page.toString())
    url.searchParams.delete('tier')
    window.history.replaceState(window.history.state, '', url)
  }, [
    direction,
    domain,
    lens,
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
    youngAgeMax,
    youngStage,
  ])

  function changeSearch(value: string): void {
    setSearch(value)
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
    setPage(1)
  }

  function selectPlayerRankings(): void {
    setLens('players')
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
    setSearch('')
    setDomain('all')
    setPosture(DEFAULT_POSTURE)
    setSort(DEFAULT_SORT)
    setDirection(DEFAULT_DIRECTION)
    setPage(1)
  }

  function changeYoungAge(value: YoungPlayerAgeCeiling): void {
    setYoungAgeMax(value)
    setPage(1)
  }

  function changeYoungStage(value: YoungPlayerStage): void {
    setYoungStage(value)
    setPage(1)
  }

  function resetYoungFilters(): void {
    setYoungAgeMax(DEFAULT_YOUNG_AGE)
    setYoungStage(DEFAULT_YOUNG_STAGE)
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
    setPlayerSearch(value)
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

  const marketFreshness = response?.snapshot.freshness.status ?? 'unknown'
  const baseballYoungFreshness = youngResponse === null
    ? 'unknown'
    : youngResponse.snapshot.baseballFreshness.status === 'current' &&
        youngResponse.snapshot.marketFreshness.status === 'current'
      ? 'current'
      : youngResponse.snapshot.baseballFreshness.status === 'stale' ||
          youngResponse.snapshot.marketFreshness.status === 'stale'
        ? 'stale'
        : 'unknown'
  const crossSportFreshness =
    playerResponse?.snapshot.freshness.status ?? 'unknown'
  const freshness = lens === 'market'
    ? marketFreshness
    : playerSport === 'baseball'
      ? baseballYoungFreshness
      : crossSportFreshness
  const resultCount = lens === 'market'
    ? response?.page.total
    : playerSport === 'baseball'
      ? youngResponse?.page.total
      : playerResponse?.page.total
  const dataThrough = lens === 'market'
    ? response?.snapshot.dataThrough
    : playerSport === 'baseball'
      ? youngResponse?.snapshot.marketDataThrough
      : playerResponse?.snapshot.dataThrough
  const headlineMetricLabel = lens === 'market'
    ? 'On Build Board'
    : playerSport === 'baseball'
      ? 'Ranked players'
      : 'On Deck'
  const headlineMetricValue = lens === 'market'
    ? response?.meta.buildCount
    : playerSport === 'baseball'
      ? resultCount
      : playerResponse?.summary.onDeckCount
  const showRefreshPosture =
    posture === 'needs_refresh' ||
    (response !== null && response.snapshot.freshness.status !== 'current')

  return (
    <div className="mx-app">
      <header className="mx-topbar">
        <a
          className="mx-brand"
          href="/hobby"
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
          <a href="/hobby">Build Board</a>
          <a href="/hobby?lens=players">Graduation Board</a>
          <a href="#methodology">Data &amp; methodology</a>
        </nav>
      </header>

      <main className="mx-main">
        <section className="mx-page-heading" aria-labelledby="investor-workbench-title">
          <div className="mx-heading-copy">
            <span>BACKSTOP BINDER INDEX</span>
            <h1 id="investor-workbench-title">
              {lens === 'market'
                ? 'The Build Board'
                : 'The Graduation Board'}
            </h1>
            <p>
              {lens === 'market'
                ? 'The few subjects whose demand scale and durability have earned a place in a long-horizon collection.'
                : playerSport === 'baseball'
                  ? 'A baseball development screen for prospects, recent callups, and young MLB players while Build-transition history accumulates.'
                  : 'One global football and basketball pipeline, ranked by readiness to earn the exact same absolute Build standard.'}
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
          <ResearchLensTabs
            lens={lens}
            posture={posture}
            playerSport={playerSport}
            showRefresh={showRefreshPosture}
            onMarketSelect={selectPositions}
            onPlayerRankingsSelect={selectPlayerRankings}
            onPlayerSportSelect={changePlayerSport}
            onPostureSelect={changePosture}
          />
          {lens === 'market' ? (
            <InvestorWorkbench
              response={response}
              loading={loading}
              error={error}
              search={search}
              domain={domain}
              posture={posture}
              sort={sort}
              direction={direction}
              page={page}
              onSearchChange={changeSearch}
              onDomainChange={changeDomain}
              onSortChange={changeSort}
              onDirectionChange={changeDirection}
              onPageChange={setPage}
              onReset={resetFilters}
            />
          ) : playerSport !== 'baseball' ? (
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
              onSearchChange={changePlayerSearch}
              onPageChange={setPage}
              onReset={resetPlayerFilters}
            />
          ) : (
            <YoungInvestorWorkbench
              response={youngResponse}
              loading={youngLoading}
              error={youngError}
              ageMax={youngAgeMax}
              stage={youngStage}
              page={page}
              onAgeMaxChange={changeYoungAge}
              onStageChange={changeYoungStage}
              onPageChange={setPage}
              onReset={resetYoungFilters}
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
