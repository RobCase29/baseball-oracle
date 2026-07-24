import { useDeferredValue, useEffect, useState } from 'react'
import {
  Database,
  LockKeyhole,
  Orbit,
} from 'lucide-react'
import {
  isMagnificentXFeedResponse,
  type MagnificentXDomain,
  type MagnificentXFeedResponse,
  type MagnificentXResearchPosture,
  type MagnificentXSortDirection,
  type MagnificentXSortKey,
} from '../domain/magnificentX'
import {
  isBinderScoresResponse,
  type BinderScoresResponse,
} from '../domain/binderScore'
import { InvestorWorkbench } from './InvestorWorkbench'
import {
  FOOTBALL_MARKET_FORMAT_IDS,
  isFootballMarketFeedResponse,
  type FootballMarketFeedResponse,
  type FootballMarketFormatId,
} from '../football/marketFeedContract'
import {
  ResearchLensTabs,
  type HobbyResearchLens,
  type YoungPlayerSport,
} from './ResearchLensTabs'
import {
  YoungInvestorWorkbench,
  type YoungPlayerAgeCeiling,
  type YoungPlayerStage,
} from './YoungInvestorWorkbench'
import {
  FootballYoungInvestorWorkbench,
  type FootballYoungPosition,
} from './FootballYoungInvestorWorkbench'

const PAGE_SIZE = 50
const DEFAULT_POSTURE: MagnificentXResearchPosture = 'build_candidate'
const DEFAULT_SORT: MagnificentXSortKey = 'cohort_rank'
const DEFAULT_DIRECTION: MagnificentXSortDirection = 'asc'
const DEFAULT_YOUNG_AGE: YoungPlayerAgeCeiling = 25
const DEFAULT_YOUNG_STAGE: YoungPlayerStage = 'All'
const DEFAULT_YOUNG_SPORT: YoungPlayerSport = 'baseball'
const DEFAULT_FOOTBALL_POSITION: FootballYoungPosition = 'WR'
const DEFAULT_FOOTBALL_FORMAT: FootballMarketFormatId =
  'sf_12t_half_ppr_no_tep'

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

const validSorts = new Set<MagnificentXSortKey>([
  'cohort_rank',
  'signal',
  'ttm_sales',
  'trend',
  'persistence',
  'shock_resistance',
  'cohort_percentile',
  'name',
])

function initialParameters(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function initialLens(): HobbyResearchLens {
  return initialParameters().get('lens') === 'young' ? 'young' : 'market'
}

function initialYoungSport(): YoungPlayerSport {
  return initialParameters().get('sport') === 'football'
    ? 'football'
    : DEFAULT_YOUNG_SPORT
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

function initialSort(): MagnificentXSortKey {
  const value = initialParameters().get('sort')
  const posture = initialPosture()
  if (value && validSorts.has(value as MagnificentXSortKey)) {
    if (value === 'cohort_rank' && posture !== 'build_candidate') return 'name'
    return value as MagnificentXSortKey
  }
  return posture === 'build_candidate' ? DEFAULT_SORT : 'name'
}

function initialDirection(): MagnificentXSortDirection {
  return initialParameters().get('direction') === 'desc'
    ? 'desc'
    : DEFAULT_DIRECTION
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

function initialFootballPosition(): FootballYoungPosition {
  const value = initialParameters().get('position')
  return value === 'QB' || value === 'WR' || value === 'RB' || value === 'TE'
    ? value
    : DEFAULT_FOOTBALL_POSITION
}

function initialFootballFormat(): FootballMarketFormatId {
  const value = initialParameters().get('format')
  return value && FOOTBALL_MARKET_FORMAT_IDS.includes(
    value as FootballMarketFormatId,
  )
    ? value as FootballMarketFormatId
    : DEFAULT_FOOTBALL_FORMAT
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
  const [sort, setSort] = useState<MagnificentXSortKey>(initialSort)
  const [direction, setDirection] =
    useState<MagnificentXSortDirection>(initialDirection)
  const [page, setPage] = useState(initialPage)
  const [youngAgeMax, setYoungAgeMax] =
    useState<YoungPlayerAgeCeiling>(initialYoungAge)
  const [youngStage, setYoungStage] =
    useState<YoungPlayerStage>(initialYoungStage)
  const [youngSport, setYoungSport] =
    useState<YoungPlayerSport>(initialYoungSport)
  const [footballPosition, setFootballPosition] =
    useState<FootballYoungPosition>(initialFootballPosition)
  const [footballFormat, setFootballFormat] =
    useState<FootballMarketFormatId>(initialFootballFormat)
  const [footballSearch, setFootballSearch] = useState(() => (
    initialLens() === 'young' && initialYoungSport() === 'football'
      ? initialParameters().get('q') ?? ''
      : ''
  ))
  const [response, setResponse] = useState<MagnificentXFeedResponse | null>(null)
  const [loading, setLoading] = useState(() => initialLens() === 'market')
  const [error, setError] = useState<string | null>(null)
  const [youngResponse, setYoungResponse] =
    useState<BinderScoresResponse | null>(null)
  const [youngLoading, setYoungLoading] =
    useState(() => initialLens() === 'young')
  const [youngError, setYoungError] = useState<string | null>(null)
  const [footballResponse, setFootballResponse] =
    useState<FootballMarketFeedResponse | null>(null)
  const [footballLoading, setFootballLoading] = useState(() => (
    initialLens() === 'young' && initialYoungSport() === 'football'
  ))
  const [footballError, setFootballError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

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
    fetch(`/api/v1/hobby-oracle?${parameters.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Hobby Oracle returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (!isMagnificentXFeedResponse(payload)) {
          throw new Error('Hobby Oracle returned an unexpected response.')
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
            : 'Unable to load Hobby Oracle.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [deferredSearch, direction, domain, lens, page, posture, sort])

  useEffect(() => {
    if (lens !== 'young' || youngSport !== 'baseball') return
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
  }, [lens, page, youngAgeMax, youngSport, youngStage])

  useEffect(() => {
    if (lens !== 'young' || youngSport !== 'football') return
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      universe: 'college',
      format: footballFormat,
    })

    setFootballLoading(true)
    setFootballError(null)
    setFootballResponse(null)
    fetch(`/api/football/v1/market-rankings?${parameters.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Football market watchlist returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (
          !isFootballMarketFeedResponse(payload) ||
          payload.request.universe !== 'college' ||
          payload.request.formatId !== footballFormat
        ) {
          throw new Error(
            'Football market watchlist returned an unexpected response.',
          )
        }
        setFootballResponse(payload)
      })
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        setFootballResponse(null)
        setFootballError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load the football market watchlist.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setFootballLoading(false)
      })

    return () => controller.abort()
  }, [footballFormat, lens, youngSport])

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
    if (lens === 'young') {
      url.searchParams.set('lens', 'young')
      url.searchParams.delete('domain')
      url.searchParams.delete('posture')
      url.searchParams.delete('sort')
      url.searchParams.delete('direction')
      if (youngSport === 'football') {
        const normalizedFootballSearch = footballSearch.trim()
        url.searchParams.set('sport', 'football')
        url.searchParams.set('position', footballPosition)
        url.searchParams.set('format', footballFormat)
        if (normalizedFootballSearch) {
          url.searchParams.set('q', normalizedFootballSearch)
        } else {
          url.searchParams.delete('q')
        }
        url.searchParams.delete('maxAge')
        url.searchParams.delete('stage')
      } else {
        url.searchParams.delete('sport')
        url.searchParams.set('maxAge', youngAgeMax.toString())
        if (youngStage === DEFAULT_YOUNG_STAGE) url.searchParams.delete('stage')
        else url.searchParams.set('stage', youngStage)
        url.searchParams.delete('q')
        url.searchParams.delete('position')
        url.searchParams.delete('format')
      }
    } else {
      const normalizedSearch = search.trim()
      url.searchParams.delete('lens')
      url.searchParams.delete('sport')
      url.searchParams.delete('maxAge')
      url.searchParams.delete('stage')
      url.searchParams.delete('position')
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
    footballFormat,
    footballPosition,
    footballSearch,
    lens,
    page,
    posture,
    search,
    sort,
    youngAgeMax,
    youngSport,
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
    setSort(value === 'build_candidate' ? 'cohort_rank' : 'name')
    setDirection('asc')
    setPage(1)
  }

  function selectPositions(): void {
    setLens('market')
    setPage(1)
  }

  function selectYoungPlayers(): void {
    setLens('young')
    setPage(1)
  }

  function changeYoungSport(value: YoungPlayerSport): void {
    setYoungSport(value)
    setPage(1)
  }

  function changeSort(value: MagnificentXSortKey): void {
    setSort(value)
    setPage(1)
  }

  function changeDirection(value: MagnificentXSortDirection): void {
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

  function changeFootballPosition(value: FootballYoungPosition): void {
    setFootballPosition(value)
    setPage(1)
  }

  function changeFootballFormat(value: FootballMarketFormatId): void {
    setFootballFormat(value)
    setPage(1)
  }

  function changeFootballSearch(value: string): void {
    setFootballSearch(value)
    setPage(1)
  }

  function resetFootballFilters(): void {
    setFootballPosition(DEFAULT_FOOTBALL_POSITION)
    setFootballFormat(DEFAULT_FOOTBALL_FORMAT)
    setFootballSearch('')
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
  const footballKtcStatus = footballResponse?.providers.find(
    (provider) => provider.provider === 'keeptradecut',
  )?.status
  const footballYoungFreshness = footballResponse === null
    ? 'unknown'
    : footballKtcStatus === 'available'
      ? 'current'
      : 'stale'
  const freshness = lens === 'market'
    ? marketFreshness
    : youngSport === 'football'
      ? footballYoungFreshness
      : baseballYoungFreshness
  const normalizedFootballSearch = footballSearch.trim().toLocaleLowerCase(
    'en-US',
  )
  const footballResultCount = footballResponse?.rankings.filter((row) => (
    row.provider === 'keeptradecut' &&
    row.universe === 'college' &&
    row.position === footballPosition &&
    (
      !normalizedFootballSearch ||
      row.name.toLocaleLowerCase('en-US').includes(normalizedFootballSearch)
    )
  )).length ?? 0
  const resultCount = lens === 'market'
    ? response?.page.total
    : youngSport === 'football'
      ? footballResultCount
      : youngResponse?.page.total
  const dataThrough = lens === 'market'
    ? response?.snapshot.dataThrough
    : youngSport === 'football'
      ? footballResponse?.generatedAt
      : youngResponse?.snapshot.marketDataThrough
  const showRefreshPosture =
    posture === 'needs_refresh' ||
    (response !== null && response.snapshot.freshness.status !== 'current')

  return (
    <div className="mx-app">
      <header className="mx-topbar">
        <a className="mx-brand" href="/hobby" aria-label="Hobby Oracle">
          <span className="mx-brand-mark" aria-hidden="true">
            <Orbit size={18} />
          </span>
          <span>
            <small>ORACLE</small>
            <strong>HOBBY ORACLE</strong>
          </span>
        </a>
        <nav className="mx-nav" aria-label="Oracle products">
          <a href="/">Baseball Oracle</a>
          <a href="/football">Football Research</a>
          <a href="#methodology">Data &amp; methodology</a>
        </nav>
      </header>

      <main className="mx-main">
        <section className="mx-page-heading" aria-labelledby="investor-workbench-title">
          <div className="mx-heading-copy">
            <span>LONG-HORIZON COLLECTION RESEARCH</span>
            <h1 id="investor-workbench-title">Investor Workbench</h1>
            <p>
              {lens === 'market'
                ? 'Screen long-term collection positions across sports and Pokémon, then open only the evidence you need.'
                : youngSport === 'football'
                  ? 'Track live College / Devy market attention while production conviction and verified NFL age ranking remain gated.'
                  : 'Find the strongest scored baseball prospects, recent callups, and young MLB players inside an Oracle age window.'}
            </p>
          </div>

          <dl className="mx-snapshot-strip">
            <div>
              <dt>Results</dt>
              <dd>{resultCount?.toLocaleString() ?? '—'}</dd>
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
          <strong>
            {lens === 'market'
              ? 'Subject demand is the screen.'
              : youngSport === 'football'
                ? 'Market watchlist—not a conviction rank.'
                : 'Age is a lens—not a shortcut.'}
          </strong>
          <span>
            {lens === 'market'
              ? 'Exact-card valuation, supply, liquidity, and return evidence still decide whether a position is investable.'
              : youngSport === 'football'
                ? 'Verified age, production quality, card demand, and expected appreciation are not inferred from a Devy market rank.'
                : 'The existing Binder Score is re-ordered inside the selected age and stage universe; the base posture does not change.'}
          </span>
        </aside>

        <section
          className="iw-shell"
          aria-label="Investor research workbench"
        >
          <ResearchLensTabs
            lens={lens}
            posture={posture}
            youngSport={youngSport}
            showRefresh={showRefreshPosture}
            onMarketSelect={selectPositions}
            onYoungSelect={selectYoungPlayers}
            onYoungSportSelect={changeYoungSport}
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
          ) : youngSport === 'football' ? (
            <FootballYoungInvestorWorkbench
              response={footballResponse}
              loading={footballLoading}
              error={footballError}
              position={footballPosition}
              formatId={footballFormat}
              search={footballSearch}
              page={page}
              onPositionChange={changeFootballPosition}
              onFormatChange={changeFootballFormat}
              onSearchChange={changeFootballSearch}
              onPageChange={setPage}
              onReset={resetFootballFilters}
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
        <span>Hobby Oracle · long-horizon collection research</span>
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
            href="https://keeptradecut.com/devy-rankings"
            target="_blank"
            rel="noreferrer"
          >
            KTC Devy
          </a>
        </nav>
      </footer>
    </div>
  )
}
