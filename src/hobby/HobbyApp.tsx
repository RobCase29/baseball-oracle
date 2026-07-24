import { useDeferredValue, useEffect, useState } from 'react'
import {
  ArrowUpRight,
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
  ResearchLensTabs,
  type HobbyResearchLens,
} from './ResearchLensTabs'
import {
  YoungInvestorWorkbench,
  type YoungPlayerAgeCeiling,
  type YoungPlayerStage,
} from './YoungInvestorWorkbench'

const PAGE_SIZE = 50
const DEFAULT_POSTURE: MagnificentXResearchPosture = 'build_candidate'
const DEFAULT_SORT: MagnificentXSortKey = 'cohort_rank'
const DEFAULT_DIRECTION: MagnificentXSortDirection = 'asc'
const DEFAULT_YOUNG_AGE: YoungPlayerAgeCeiling = 25
const DEFAULT_YOUNG_STAGE: YoungPlayerStage = 'All'

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
  const [search, setSearch] = useState(() => initialParameters().get('q') ?? '')
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
  const [response, setResponse] = useState<MagnificentXFeedResponse | null>(null)
  const [loading, setLoading] = useState(() => initialLens() === 'market')
  const [error, setError] = useState<string | null>(null)
  const [youngResponse, setYoungResponse] =
    useState<BinderScoresResponse | null>(null)
  const [youngLoading, setYoungLoading] =
    useState(() => initialLens() === 'young')
  const [youngError, setYoungError] = useState<string | null>(null)
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
    fetch(`/api/v1/magnificent-x?${parameters.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Investor board returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (!isMagnificentXFeedResponse(payload)) {
          throw new Error('Investor board returned an unexpected response.')
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
            : 'Unable to load the investor board.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [deferredSearch, direction, domain, lens, page, posture, sort])

  useEffect(() => {
    if (lens !== 'young') return
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
  }, [lens, page, youngAgeMax, youngStage])

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
      url.searchParams.set('maxAge', youngAgeMax.toString())
      if (youngStage === DEFAULT_YOUNG_STAGE) url.searchParams.delete('stage')
      else url.searchParams.set('stage', youngStage)
      url.searchParams.delete('q')
      url.searchParams.delete('domain')
      url.searchParams.delete('posture')
      url.searchParams.delete('sort')
      url.searchParams.delete('direction')
    } else {
      const normalizedSearch = search.trim()
      url.searchParams.delete('lens')
      url.searchParams.delete('maxAge')
      url.searchParams.delete('stage')
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
    setSort(value === 'build_candidate' ? 'cohort_rank' : 'name')
    setDirection('asc')
    setPage(1)
  }

  function selectYoungPlayers(): void {
    setLens('young')
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

  const universeCount = response?.cohorts.reduce(
    (total, cohort) => total + cohort.subjectCount,
    0,
  ) ?? 0
  const buildCandidateCount = response?.cohorts.reduce(
    (total, cohort) => total + cohort.marketLeaderCount,
    0,
  ) ?? 0
  const marketFreshness = response?.snapshot.freshness.status ?? 'unknown'
  const youngFreshness = youngResponse === null
    ? 'unknown'
    : youngResponse.snapshot.baseballFreshness.status === 'current' &&
        youngResponse.snapshot.marketFreshness.status === 'current'
      ? 'current'
      : youngResponse.snapshot.baseballFreshness.status === 'stale' ||
          youngResponse.snapshot.marketFreshness.status === 'stale'
        ? 'stale'
        : 'unknown'
  const freshness = lens === 'young' ? youngFreshness : marketFreshness
  const showRefreshPosture =
    posture === 'needs_refresh' ||
    (response !== null && response.snapshot.freshness.status !== 'current')

  return (
    <div className="mx-app">
      <header className="mx-topbar">
        <a className="mx-brand" href="/hobby" aria-label="Magnificent X investor board">
          <span className="mx-brand-mark" aria-hidden="true">
            <Orbit size={18} />
          </span>
          <span>
            <small>ORACLE</small>
            <strong>MAGNIFICENT X</strong>
          </span>
        </a>
        <nav className="mx-nav" aria-label="Oracle products">
          <a href="/">Baseball</a>
          <a href="/football">Football</a>
          <a
            href="https://www.gemrate.com/sales-trends"
            target="_blank"
            rel="noreferrer"
          >
            Athlete data <ArrowUpRight size={11} aria-hidden="true" />
          </a>
          <a
            href="https://www.gemrate.com/sales-trends-pokemon"
            target="_blank"
            rel="noreferrer"
          >
            Pokémon data <ArrowUpRight size={11} aria-hidden="true" />
          </a>
        </nav>
      </header>

      <main className="mx-main">
        <section className="mx-page-heading" aria-labelledby="investor-board-title">
          <div className="mx-heading-copy">
            <span>LONG-HORIZON COLLECTION RESEARCH</span>
            <h1 id="investor-board-title">Investor Board</h1>
            <p>
              {lens === 'young'
                ? 'Find the strongest scored prospects, recent callups, and young MLB players inside an Oracle age window.'
                : 'Screen who belongs on the build list, hold list, or sidelines. Open a row only when you need the evidence behind the call.'}
            </p>
          </div>

          <dl className="mx-snapshot-strip">
            <div>
              <dt>{lens === 'young' ? 'Young screen' : 'Universe'}</dt>
              <dd>
                {lens === 'young'
                  ? youngResponse?.page.total.toLocaleString() ?? '—'
                  : universeCount > 0
                    ? universeCount.toLocaleString()
                    : '—'}
              </dd>
            </div>
            <div>
              <dt>{lens === 'young' ? 'Age lens' : 'Build screen'}</dt>
              <dd>
                {lens === 'young'
                  ? `≤ ${youngAgeMax}`
                  : freshness === 'current' && buildCandidateCount > 0
                    ? buildCandidateCount.toLocaleString()
                    : freshness === 'stale'
                      ? 'Suspended'
                      : '—'}
              </dd>
            </div>
            <div>
              <dt>{lens === 'young' ? 'Score model' : 'History'}</dt>
              <dd>
                {lens === 'young'
                  ? 'Binder v1'
                  : response
                    ? `${response.snapshot.historyMonths} mo`
                    : '—'}
              </dd>
            </div>
            <div>
              <dt>Data through</dt>
              <dd>
                {formatDate(
                  lens === 'young'
                    ? youngResponse?.snapshot.marketDataThrough
                    : response?.snapshot.dataThrough,
                )}
              </dd>
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
            {lens === 'young'
              ? 'Age is a lens—not a shortcut.'
              : 'Research posture—not a card order.'}
          </strong>
          <span>
            {lens === 'young'
              ? 'The ranking uses the existing Binder Score; age is already a modest 11.25% of its pre-penalty total. Recent callup is not an official rookie designation.'
              : 'Build and hold candidates identify durable subject demand. Exact-card valuation, supply, liquidity, and return evidence are still required.'}
          </span>
        </aside>

        <section
          className="iw-shell"
          aria-label="Investor research workbench"
        >
          <ResearchLensTabs
            lens={lens}
            posture={posture}
            showRefresh={showRefreshPosture}
            onYoungSelect={selectYoungPlayers}
            onPostureSelect={changePosture}
          />
          {lens === 'young' ? (
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
          ) : (
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
          )}
        </section>
      </main>

      <footer className="mx-footer">
        <span>
          {lens === 'young'
            ? 'Young Players · Baseball Oracle + Binder Score research'
            : 'Magnificent X · subject-level demand research'}
        </span>
        <span>
          {lens === 'young'
            ? 'Cross-stage heuristic · exact-card action withheld'
            : '18-month provisional model · exact-card action withheld'}
        </span>
      </footer>
    </div>
  )
}
