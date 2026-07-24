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
import { InvestorWorkbench } from './InvestorWorkbench'

const PAGE_SIZE = 50
const DEFAULT_POSTURE: MagnificentXResearchPosture = 'build_candidate'
const DEFAULT_SORT: MagnificentXSortKey = 'cohort_rank'
const DEFAULT_DIRECTION: MagnificentXSortDirection = 'asc'

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
  return value && validSorts.has(value as MagnificentXSortKey)
    ? value as MagnificentXSortKey
    : DEFAULT_SORT
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
  const [search, setSearch] = useState(() => initialParameters().get('q') ?? '')
  const [domain, setDomain] = useState<MagnificentXDomain | 'all'>(initialDomain)
  const [posture, setPosture] = useState<
    MagnificentXResearchPosture | 'all'
  >(initialPosture)
  const [sort, setSort] = useState<MagnificentXSortKey>(initialSort)
  const [direction, setDirection] =
    useState<MagnificentXSortDirection>(initialDirection)
  const [page, setPage] = useState(initialPage)
  const [response, setResponse] = useState<MagnificentXFeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
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
  }, [deferredSearch, direction, domain, page, posture, sort])

  useEffect(() => {
    if (
      response?.snapshot.freshness.status !== 'current' &&
      response !== null &&
      posture === DEFAULT_POSTURE
    ) {
      setPosture('needs_refresh')
      setPage(1)
    }
  }, [posture, response])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const normalizedSearch = search.trim()
    if (normalizedSearch) url.searchParams.set('q', normalizedSearch)
    else url.searchParams.delete('q')
    if (domain === 'all') url.searchParams.delete('domain')
    else url.searchParams.set('domain', domain)
    url.searchParams.set('posture', posture)
    url.searchParams.set('sort', sort)
    url.searchParams.set('direction', direction)
    if (page === 1) url.searchParams.delete('page')
    else url.searchParams.set('page', page.toString())
    url.searchParams.delete('tier')
    window.history.replaceState(window.history.state, '', url)
  }, [direction, domain, page, posture, search, sort])

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
    setPosture(value)
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

  const universeCount = response?.cohorts.reduce(
    (total, cohort) => total + cohort.subjectCount,
    0,
  ) ?? 0
  const buildCandidateCount = response?.cohorts.reduce(
    (total, cohort) => total + cohort.marketLeaderCount,
    0,
  ) ?? 0
  const freshness = response?.snapshot.freshness.status ?? 'unknown'

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
              Screen who belongs on the build list, hold list, or sidelines.
              Open a row only when you need the evidence behind the call.
            </p>
          </div>

          <dl className="mx-snapshot-strip">
            <div>
              <dt>Universe</dt>
              <dd>{universeCount > 0 ? universeCount.toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt>Build screen</dt>
              <dd>
                {freshness === 'current' && buildCandidateCount > 0
                  ? buildCandidateCount.toLocaleString()
                  : freshness === 'stale'
                    ? 'Suspended'
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>{response ? `${response.snapshot.historyMonths} mo` : '—'}</dd>
            </div>
            <div>
              <dt>Data through</dt>
              <dd>{formatDate(response?.snapshot.dataThrough)}</dd>
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
          <strong>Research posture—not a card order.</strong>
          <span>
            Build and hold candidates identify durable subject demand. Exact-card
            valuation, supply, liquidity, and return evidence are still required.
          </span>
        </aside>

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
          onPostureChange={changePosture}
          onSortChange={changeSort}
          onDirectionChange={changeDirection}
          onPageChange={setPage}
          onReset={resetFilters}
        />
      </main>

      <footer className="mx-footer">
        <span>Magnificent X · subject-level demand research</span>
        <span>18-month provisional model · exact-card action withheld</span>
      </footer>
    </div>
  )
}
