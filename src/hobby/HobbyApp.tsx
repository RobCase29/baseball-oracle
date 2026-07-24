import { useDeferredValue, useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Database,
  Orbit,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import {
  isMagnificentXFeedResponse,
  type MagnificentXDomain,
  type MagnificentXFeedResponse,
  type MagnificentXResearchTier,
} from '../domain/magnificentX'
import {
  MagnificentXBoard,
  type MagnificentXDomainFilter,
  type MagnificentXTierFilter,
} from './MagnificentXBoard'

const PAGE_SIZE = 24

function formatDate(value: string | undefined): string {
  if (!value) return 'Awaiting snapshot'
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
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState<MagnificentXDomainFilter>('all')
  const [tier, setTier] = useState<MagnificentXTierFilter>('all')
  const [page, setPage] = useState(1)
  const [response, setResponse] = useState<MagnificentXFeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
    })
    const normalizedSearch = deferredSearch.trim()
    if (normalizedSearch) parameters.set('q', normalizedSearch)
    if (domain !== 'all') parameters.set('domain', domain)
    if (tier !== 'all') parameters.set('tier', tier)

    setLoading(true)
    setError(null)
    fetch(`/api/v1/magnificent-x?${parameters.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Magnificent X endpoint returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (!isMagnificentXFeedResponse(payload)) {
          throw new Error('Magnificent X returned an unexpected response.')
        }
        setResponse(payload)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') {
          return
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load cross-hobby research.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [deferredSearch, domain, page, tier])

  function changeSearch(value: string): void {
    setSearch(value)
    setPage(1)
  }

  function changeDomain(value: MagnificentXDomain | 'all'): void {
    setDomain(value)
    setPage(1)
  }

  function changeTier(value: MagnificentXResearchTier | 'all'): void {
    setTier(value)
    setPage(1)
  }

  function resetFilters(): void {
    setSearch('')
    setDomain('all')
    setTier('all')
    setPage(1)
  }

  const eligibleCount = response?.meta.magnificentEligibleCount ?? 0

  return (
    <div className="mx-shell">
      <header className="mx-site-header">
        <a className="mx-brand" href="/hobby" aria-label="Magnificent X home">
          <span className="mx-brand-mark" aria-hidden="true">
            <Orbit size={22} />
          </span>
          <span>
            <small>ORACLE HOBBY RESEARCH</small>
            <strong>MAGNIFICENT X</strong>
          </span>
        </a>
        <nav className="mx-primary-nav" aria-label="Oracle products">
          <a href="/">Baseball Oracle</a>
          <a href="/football">Football Oracle</a>
          <a
            href="https://www.gemrate.com/sales-trends"
            target="_blank"
            rel="noreferrer"
          >
            Athlete source <ArrowUpRight size={13} aria-hidden="true" />
          </a>
          <a
            href="https://www.gemrate.com/sales-trends-pokemon"
            target="_blank"
            rel="noreferrer"
          >
            Pokémon source <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </nav>
      </header>

      <main>
        <section className="mx-hero" aria-labelledby="mx-title">
          <div className="mx-hero-copy">
            <span className="mx-kicker">
              <Sparkles size={15} aria-hidden="true" />
              SIGNAL, WITH THE CERTAINTY STRIPPED OUT
            </span>
            <h1 id="mx-title">
              Find enduring hobby demand.
              <em> Refuse the easy answer.</em>
            </h1>
            <p>
              Magnificent X compares persistent subject-level collector demand
              inside each GemRate cohort. It is a disciplined research queue—not
              a global price ranking, return forecast, or card recommendation.
            </p>
          </div>
          <div className="mx-zero-card" aria-label={`${eligibleCount} full Magnificent X designations`}>
            <div className="mx-zero-orbit" aria-hidden="true">
              <span>0</span>
            </div>
            <div>
              <span>FULL DESIGNATIONS</span>
              <h2>No full designations. By design.</h2>
              <p>
                Market strength alone cannot clear identity, fundamentals,
                supply, exact-card, history, and validation gates.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-principles" aria-label="Research limitations">
          <div>
            <Database size={17} aria-hidden="true" />
            <span>
              <strong>18 complete months</strong>
              Market history through {formatDate(response?.snapshot.dataThrough)}
            </span>
          </div>
          <div>
            <ShieldAlert size={17} aria-hidden="true" />
            <span>
              <strong>Designation withheld</strong>
              A provisional market signal never becomes an investment instruction
            </span>
          </div>
          <div>
            <Orbit size={17} aria-hidden="true" />
            <span>
              <strong>Pokémon means character</strong>
              No exact card, set, language, grade, population, or price is selected
            </span>
          </div>
        </section>

        <MagnificentXBoard
          response={response}
          loading={loading}
          error={error}
          search={search}
          domain={domain}
          tier={tier}
          page={page}
          onSearchChange={changeSearch}
          onDomainChange={changeDomain}
          onTierChange={changeTier}
          onPageChange={setPage}
          onReset={resetFilters}
        />
      </main>

      <footer className="mx-footer">
        <div>
          <strong>Magnificent X</strong>
          <span>Research only · not investment advice</span>
        </div>
        <p>
          Completed eBay singles sales volume is a demand proxy. It does not
          measure a card&apos;s scarcity, condition, population, valuation, or
          future performance.
        </p>
      </footer>
    </div>
  )
}
