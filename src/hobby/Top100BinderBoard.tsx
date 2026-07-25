import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  Database,
  Printer,
  ShieldCheck,
} from 'lucide-react'
import {
  isHobbyMasterFeedResponse,
  type HobbyMasterFeedItem,
  type HobbyMasterFeedResponse,
  type MagnificentXDomain,
  type MagnificentXResearchPosture,
} from '../domain/hobbyMasterRanking'
import './top-100-binder-board.css'

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const domainLabels: Record<MagnificentXDomain, string> = {
  baseball: 'Baseball',
  basketball: 'Basketball',
  football: 'Football',
  soccer: 'Soccer',
  hockey: 'Hockey',
  golf: 'Golf',
  combat: 'Combat',
  other_sport: 'Other sport',
  mixed_sport: 'Mixed sport',
  culture: 'Culture',
  pokemon: 'Pokémon',
}

const postureLabels: Record<MagnificentXResearchPosture, string> = {
  build_candidate: 'Build',
  hold_candidate: 'Hold',
  watch: 'Watch',
  risk_review: 'Risk review',
  pass: 'Pass',
  unrated: 'Unrated',
  needs_refresh: 'Needs refresh',
}

function moneyLabel(value: number): string {
  return compactCurrencyFormatter.format(value)
}

function calendarDateLabel(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00.000Z`)
  if (!Number.isFinite(date.valueOf())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function timestampLabel(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function qualificationLabel(item: HobbyMasterFeedItem): string {
  switch (item.assessment.buildQualification.route) {
    case 'established_durability':
      return 'Durable scale'
    case 'escape_velocity':
      return 'Escape velocity'
    case null:
      return 'Not qualified'
  }
}

function rankedTop100(
  response: HobbyMasterFeedResponse | null,
): HobbyMasterFeedItem[] {
  return (response?.items ?? [])
    .filter(
      (item) =>
        item.masterRank !== null &&
        item.masterRank >= 1 &&
        item.masterRank <= 100,
    )
    .toSorted(
      (left, right) =>
        (left.masterRank ?? 101) - (right.masterRank ?? 101),
    )
    .slice(0, 100)
}

export function Top100BinderBoard() {
  const [response, setResponse] =
    useState<HobbyMasterFeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Top 100 by Binder Index · Backstop'
    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      posture: 'all',
      sort: 'master_rank',
      direction: 'asc',
      page: '1',
      limit: '100',
    })

    setLoading(true)
    setError(null)
    fetch(`/api/v2/hobby-oracle?${parameters.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`Top 100 board returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (!isHobbyMasterFeedResponse(payload)) {
          throw new Error('Top 100 board returned an unexpected response.')
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
            : 'Unable to load the Top 100 board.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [])

  const items = rankedTop100(response)
  const current = response?.snapshot.freshness.status === 'current'
  const complete = current && items.length === 100
  const modelVersion = items[0]?.assessment.modelVersion ?? '—'

  return (
    <div className="bbi-top100">
      <header className="bbi-top100__screen-nav">
        <a className="bbi-top100__brand" href="/hobby">
          <span aria-hidden="true"><BookOpenCheck size={18} /></span>
          <span>
            <small>BACKSTOP CARDS</small>
            <strong>BINDER INDEX</strong>
          </span>
        </a>
        <div className="bbi-top100__actions">
          <nav
            className="bbi-top100__board-tabs"
            aria-label="Printable Binder Index boards"
          >
            <a aria-current="page" href="/hobby?view=top100">Top 100</a>
            <a href="/hobby?view=under25">25 Under 25</a>
          </nav>
          <a className="bbi-top100__live-link" href="/hobby">
            <ArrowLeft size={14} aria-hidden="true" />
            Live board
          </a>
          <button
            type="button"
            aria-label="Print Top 100"
            disabled={!complete}
            onClick={() => window.print()}
          >
            <Printer size={15} aria-hidden="true" />
            <span>Print Top 100</span>
          </button>
        </div>
      </header>

      <main>
        <header className="bbi-top100__masthead">
          <div className="bbi-top100__edition">
            <span>PRINT EDITION · ABSOLUTE BINDER SCORE</span>
            <strong>
              {response?.snapshot.id
                ? response.snapshot.id.slice(-8).toLocaleUpperCase('en-US')
                : 'LOADING'}
            </strong>
          </div>
          <div className="bbi-top100__title-row">
            <div>
              <p>BACKSTOP BINDER INDEX</p>
              <h1>Top 100</h1>
              <h2>By Binder Index</h2>
            </div>
            <div className="bbi-top100__mark" aria-hidden="true">
              <BookOpenCheck size={29} />
            </div>
          </div>
          <p className="bbi-top100__dek">
            The actual score order across the coherent GemRate athlete and
            Pokémon universe. No cohort quotas, sport balancing, age screen,
            or Graduation Index.
          </p>
          <dl className="bbi-top100__snapshot">
            <div>
              <dt>Positions</dt>
              <dd>{items.length || '—'} / 100</dd>
            </div>
            <div>
              <dt>Ranked universe</dt>
              <dd>
                {response?.meta.rankingUniverseCount.toLocaleString() ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Data through</dt>
              <dd>{calendarDateLabel(response?.snapshot.dataThrough)}</dd>
            </div>
            <div>
              <dt>Snapshot</dt>
              <dd className={current ? 'is-current' : ''}>
                <Database size={12} aria-hidden="true" />
                {response?.snapshot.freshness.status ?? 'loading'}
              </dd>
            </div>
          </dl>
        </header>

        <section className="bbi-top100__formula" aria-label="Ranking definition">
          <strong>Binder Index</strong>
          <span>
            Absolute demand magnitude and durability on a 0–100 scale.
            Positive momentum never adds score. Rank follows Binder Index;
            TTM demand breaks score ties.
          </span>
        </section>

        {error ? (
          <div className="bbi-top100__message" role="alert">
            <strong>Top 100 unavailable.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="bbi-top100__message" role="status">
            Preparing the current Binder Index Top 100…
          </div>
        ) : null}

        {!loading && !error && !complete ? (
          <div className="bbi-top100__message" role="status">
            <strong>Print edition withheld.</strong>
            <span>
              The board requires a current snapshot with all 100
              score-ranked positions.
            </span>
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="bbi-top100__table-frame">
            <table aria-label="Backstop Binder Index score-ranked Top 100">
              <caption>
                The 100 highest Binder Index scores in the eligible master
                ranking universe.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Cohort</th>
                  <th scope="col">Binder Index</th>
                  <th scope="col">TTM / run rate</th>
                  <th scope="col">Demand / durability</th>
                  <th scope="col">Persistence / stability</th>
                  <th scope="col">Board read</th>
                  <th scope="col">Qualification</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const signal = item.assessment.marketSignal
                  const qualification = item.assessment.buildQualification
                  return (
                    <tr
                      className={`bbi-top100__row bbi-top100__row--${item.subject.domain}`}
                      key={item.subject.id}
                    >
                      <td className="bbi-top100__rank">
                        <span aria-hidden="true" />
                        <strong>#{item.masterRank}</strong>
                      </td>
                      <th scope="row">
                        <strong>{item.subject.name}</strong>
                        <span>
                          {item.subject.type === 'pokemon_character'
                            ? 'Character'
                            : 'Athlete'}
                        </span>
                      </th>
                      <td>
                        <strong>{domainLabels[item.subject.domain]}</strong>
                        <span>Cohort #{item.withinCohortRank}</span>
                      </td>
                      <td className="bbi-top100__index">
                        <strong>{signal.score.toFixed(1)}</strong>
                        <span>/100</span>
                      </td>
                      <td>
                        <strong>
                          {moneyLabel(signal.latestTwelveMonthSalesUsd)}
                        </strong>
                        <span>
                          {moneyLabel(
                            signal.annualizedCurrentSixMonthSalesUsd,
                          )}{' '}
                          run rate
                        </span>
                      </td>
                      <td>
                        <strong>{signal.demandMagnitudeScore.toFixed(0)}</strong>
                        <span>{signal.durabilityScore.toFixed(0)} durability</span>
                      </td>
                      <td>
                        <strong>
                          {signal.components.persistence.toFixed(0)}
                        </strong>
                        <span>
                          {signal.components.shockResistance.toFixed(0)} stability
                        </span>
                      </td>
                      <td>
                        <strong>
                          {postureLabels[item.assessment.posture]}
                        </strong>
                        <span>
                          P{signal.globalObservedPercentile.toFixed(1)} demand
                        </span>
                      </td>
                      <td>
                        <strong>{qualificationLabel(item)}</strong>
                        <span>
                          {qualification.passed}/{qualification.required} gates
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <footer className="bbi-top100__notes">
          <ShieldCheck size={16} aria-hidden="true" />
          <p>
            <strong>Research boundary.</strong> Subject-level demand
            prioritization only. Card, grade, supply, entry price, liquidity,
            and personal risk tolerance require separate underwriting.
          </p>
          <span>
            Model {modelVersion} · Published{' '}
            {timestampLabel(response?.snapshot.publishedAt)}
          </span>
        </footer>
      </main>
    </div>
  )
}
