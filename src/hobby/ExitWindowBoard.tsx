import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  Database,
  Printer,
  ShieldCheck,
} from 'lucide-react'
import {
  buildHobbyExitWindowSignal,
  HOBBY_EXIT_WINDOW_MIN_DECLINE,
  HOBBY_EXIT_WINDOW_MIN_RUN_RATE_USD,
  HOBBY_EXIT_WINDOW_MIN_TTM_PERCENTILE,
  HOBBY_EXIT_WINDOW_MODEL_VERSION,
  type HobbyExitWindowSignal,
} from '../domain/hobbyLiquidationSignal'
import {
  isHobbyMasterFeedResponse,
  type HobbyMasterFeedItem,
  type HobbyMasterFeedResponse,
  type MagnificentXDomain,
  type MagnificentXResearchPosture,
} from '../domain/hobbyMasterRanking'
import {
  salesTrendDisplay,
  subjectContextDisplay,
} from './hobbySubjectDisplay'
import { PrintableBoardTabs } from './PrintableBoardTabs'
import './top-100-binder-board.css'

interface ExitWindowRow {
  item: HobbyMasterFeedItem
  exit: HobbyExitWindowSignal
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const unsignedPercentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
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

function unsignedPercentLabel(value: number): string {
  return unsignedPercentFormatter.format(value)
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

function rankedExit100(
  response: HobbyMasterFeedResponse | null,
): ExitWindowRow[] {
  return (response?.items ?? [])
    .map((item) => ({
      item,
      exit: buildHobbyExitWindowSignal(item),
    }))
    .filter((row) => row.exit.eligible)
    .toSorted(
      (left, right) =>
        right.exit.score - left.exit.score ||
        right.exit.resaleHeat - left.exit.resaleHeat ||
        (left.item.masterRank ?? Number.MAX_SAFE_INTEGER) -
          (right.item.masterRank ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 100)
}

export function ExitWindowBoard() {
  const [response, setResponse] =
    useState<HobbyMasterFeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Exit 100 · Backstop Binder Index'
    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      posture: 'all',
      sort: 'exit_window',
      direction: 'desc',
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
          throw new Error(`Exit 100 board returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (!isHobbyMasterFeedResponse(payload)) {
          throw new Error('Exit 100 board returned an unexpected response.')
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
            : 'Unable to load the Exit 100 board.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [])

  const rows = rankedExit100(response)
  const current = response?.snapshot.freshness.status === 'current'
  const complete = current && rows.length === 100

  return (
    <div className="bbi-top100 bbi-top100--exit">
      <header className="bbi-top100__screen-nav">
        <a className="bbi-top100__brand" href="/hobby">
          <span aria-hidden="true"><BookOpenCheck size={18} /></span>
          <span>
            <small>BACKSTOP CARDS</small>
            <strong>BINDER INDEX</strong>
          </span>
        </a>
        <div className="bbi-top100__actions">
          <PrintableBoardTabs current="exit100" />
          <a
            className="bbi-top100__live-link"
            href="/hobby?posture=all&sort=exit_window&direction=desc"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Live board
          </a>
          <button
            type="button"
            aria-label="Print Exit 100"
            disabled={!complete}
            onClick={() => window.print()}
          >
            <Printer size={15} aria-hidden="true" />
            <span>Print Exit 100</span>
          </button>
        </div>
      </header>

      <main>
        <header className="bbi-top100__masthead">
          <div className="bbi-top100__edition">
            <span>PRINT EDITION · LIQUIDATION WATCHLIST</span>
            <strong>
              {response?.snapshot.id
                ? response.snapshot.id.slice(-8).toLocaleUpperCase('en-US')
                : 'LOADING'}
            </strong>
          </div>
          <div className="bbi-top100__title-row">
            <div>
              <p>BACKSTOP BINDER INDEX</p>
              <h1>Exit 100</h1>
              <h2>Hot demand. Fading durability.</h2>
            </div>
            <div className="bbi-top100__mark" aria-hidden="true">
              <BookOpenCheck size={29} />
            </div>
          </div>
          <p className="bbi-top100__dek">
            Non-Build, non-Hold subjects with top-15% observed TTM demand,
            at least {moneyLabel(HOBBY_EXIT_WINDOW_MIN_RUN_RATE_USD)} in
            annualized current sales, persistent monthly activity, and a
            six-month decline of at least{' '}
            {unsignedPercentLabel(HOBBY_EXIT_WINDOW_MIN_DECLINE)}.
          </p>
          <dl className="bbi-top100__snapshot">
            <div>
              <dt>Positions</dt>
              <dd>{rows.length || '—'} / 100</dd>
            </div>
            <div>
              <dt>TTM screen</dt>
              <dd>P{HOBBY_EXIT_WINDOW_MIN_TTM_PERCENTILE}+</dd>
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
          <strong>Exit Window</strong>
          <span>
            A weak-link blend of current resale heat and decline pressure.
            High demand without deterioration—and sharp deterioration without
            active demand—cannot rank near the top.
          </span>
        </section>

        {error ? (
          <div className="bbi-top100__message" role="alert">
            <strong>Exit 100 unavailable.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="bbi-top100__message" role="status">
            Preparing the current Exit 100…
          </div>
        ) : null}

        {!loading && !error && !complete ? (
          <div className="bbi-top100__message" role="status">
            <strong>Print edition withheld.</strong>
            <span>
              The board requires a current snapshot with 100 subjects clearing
              every exit-window screen.
            </span>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="bbi-top100__table-frame">
            <table aria-label="Backstop Binder Index Exit 100">
              <caption>
                The 100 strongest subject-level exit-window signals among
                markets not designated Build or Hold.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Exit rank</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Cohort</th>
                  <th scope="col">Exit Window</th>
                  <th scope="col">Resale heat</th>
                  <th scope="col">Decline pressure</th>
                  <th scope="col">TTM / run rate</th>
                  <th scope="col">Demand trend</th>
                  <th scope="col">Binder read</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, exit }, index) => {
                  const signal = item.assessment.marketSignal
                  const context = subjectContextDisplay(item.subject)
                  const trend = salesTrendDisplay(item.assessment)
                  return (
                    <tr
                      className={`bbi-top100__row bbi-top100__row--${item.subject.domain}`}
                      key={item.subject.id}
                    >
                      <td className="bbi-top100__rank">
                        <span aria-hidden="true" />
                        <strong>#{index + 1}</strong>
                      </td>
                      <th scope="row">
                        <strong>{item.subject.name}</strong>
                        <span>
                          {item.subject.type === 'pokemon_character'
                            ? `Character · ${context.compact}`
                            : `Athlete · ${context.compact}`}
                        </span>
                      </th>
                      <td>
                        <strong>{domainLabels[item.subject.domain]}</strong>
                        <span>P{signal.globalObservedPercentile.toFixed(1)} TTM</span>
                      </td>
                      <td className="bbi-top100__index bbi-top100__index--exit">
                        <strong>{exit.score.toFixed(1)}</strong>
                        <span>/100</span>
                      </td>
                      <td>
                        <strong>{exit.resaleHeat.toFixed(1)}</strong>
                        <span>active-demand proxy</span>
                      </td>
                      <td>
                        <strong>{exit.declinePressure.toFixed(1)}</strong>
                        <span>downside signal</span>
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
                      <td
                        className={`bbi-top100__trend bbi-top100__trend--${trend.direction}`}
                      >
                        <strong>{trend.compact}</strong>
                        <span>
                          3M {trend.recentThreeMonth} · {trend.evidence}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {signal.score.toFixed(1)} ·{' '}
                          {postureLabels[item.assessment.posture]}
                        </strong>
                        <span>
                          {signal.durabilityScore.toFixed(0)} durability ·{' '}
                          {exit.openBuildGates} gates open
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
            <strong>Research boundary.</strong> Subject sales dollars are only
            a resale-heat proxy. This board cannot observe exact-card bids,
            spread, transaction count, grade, population, cost basis, fees, or
            tax consequences. It is a liquidation research queue—not advice to
            sell.
          </p>
          <span>
            Model {HOBBY_EXIT_WINDOW_MODEL_VERSION} · Published{' '}
            {timestampLabel(response?.snapshot.publishedAt)}
          </span>
        </footer>
      </main>
    </div>
  )
}
