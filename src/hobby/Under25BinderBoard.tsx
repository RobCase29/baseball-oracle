import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  Database,
  Printer,
  ShieldCheck,
} from 'lucide-react'
import type {
  BinderGraduationBlocker,
} from '../domain/binderGraduationIndex'
import {
  isBinderGraduationV2Response,
  type BinderGraduationV2Item,
  type BinderGraduationV2Response,
} from '../domain/binderGraduationIndexV2'
import './top-100-binder-board.css'

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const sportLabels = {
  baseball: 'Baseball',
  football: 'Football',
  basketball: 'Basketball',
} as const

const pathLabels = {
  graduated: 'On Build Board',
  on_deck: 'On Deck',
  approaching: 'Approaching',
  developing: 'Developing',
  long_range: 'Long Range',
  withheld: 'Withheld',
} as const

const blockerLabels: Record<BinderGraduationBlocker, string> = {
  already_on_build_board: 'Build standard cleared',
  ttm_scale: 'TTM demand',
  current_run_rate: 'Current run rate',
  master_score: 'Current Binder Index',
  global_top_one_percent: 'Top-1% demand',
  persistence: 'Persistence',
  shock_resistance: 'Demand stability',
  downside_protection: 'Downside protection',
  six_month_growth: 'Six-month velocity',
  three_month_growth: 'Three-month velocity',
  evidence_not_publishable: 'Evidence refresh',
}

function moneyLabel(value: number): string {
  return compactCurrencyFormatter.format(value)
}

function scoreLabel(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function ageLabel(value: number | null): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function titleLabel(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (character) => character.toLocaleUpperCase('en-US'))
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

function nextGateLabel(item: BinderGraduationV2Item): string {
  const { graduation } = item
  const distance = graduation.distance
  switch (graduation.primaryBlocker) {
    case 'ttm_scale':
      return `TTM +${moneyLabel(distance.ttmSalesUsd)}`
    case 'current_run_rate':
      return `Run rate +${moneyLabel(distance.currentRunRateUsd)}`
    case 'master_score':
      return `Binder +${distance.masterScorePoints.toFixed(1)} pts`
    case 'global_top_one_percent':
      return `P99 +${moneyLabel(distance.globalTopOneTtmUsd)}`
    case 'persistence':
      return `Persistence +${distance.persistencePoints.toFixed(1)}`
    case 'shock_resistance':
      return `Stability +${distance.shockResistancePoints.toFixed(1)}`
    case 'downside_protection':
      return `Downside +${distance.downsideProtectionPoints.toFixed(1)}`
    case 'six_month_growth':
      return `6M pace +${distance.sixMonthGrowthMultiple.toFixed(2)}×`
    case 'three_month_growth':
      return `3M pace +${distance.threeMonthGrowthMultiple.toFixed(2)}×`
    case 'already_on_build_board':
      return 'Build standard cleared'
    case 'evidence_not_publishable':
      return 'Evidence refresh required'
  }
}

function rankedUnder25(
  response: BinderGraduationV2Response | null,
): BinderGraduationV2Item[] {
  return (response?.items ?? [])
    .filter(
      (item) =>
        item.player.age !== null &&
        item.player.age <= 25 &&
        item.graduation.status === 'ranked' &&
        item.graduation.globalRank !== null,
    )
    .toSorted(
      (left, right) =>
        (right.graduation.index ?? -1) -
          (left.graduation.index ?? -1) ||
        (left.graduation.globalRank ?? Number.MAX_SAFE_INTEGER) -
          (right.graduation.globalRank ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 25)
}

export function Under25BinderBoard() {
  const [response, setResponse] =
    useState<BinderGraduationV2Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = '25 Under 25 · Backstop Binder Index'
    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      sport: 'all',
      maxAge: '25',
      band: 'all',
      sort: 'graduation_index',
      page: '1',
      limit: '100',
    })

    setLoading(true)
    setError(null)
    fetch(`/api/v2/backstop-binder-index?${parameters.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(`25 Under 25 board returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (
          !isBinderGraduationV2Response(payload) ||
          payload.scope.sport !== 'all' ||
          payload.scope.maxAge !== 25
        ) {
          throw new Error('25 Under 25 board returned an unexpected response.')
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
            : 'Unable to load the 25 Under 25 board.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [])

  const items = rankedUnder25(response)
  const current = response?.snapshot.freshness.status === 'current'
  const complete = current && items.length === 25

  return (
    <div className="bbi-top100 bbi-top100--under25">
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
            <a href="/hobby?view=top100">Top 100</a>
            <a aria-current="page" href="/hobby?view=under25">
              25 Under 25
            </a>
          </nav>
          <a
            className="bbi-top100__live-link"
            href="/hobby?lens=players&sport=all&maxAge=26"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Live board
          </a>
          <button
            type="button"
            aria-label="Print 25 Under 25"
            disabled={!complete}
            onClick={() => window.print()}
          >
            <Printer size={15} aria-hidden="true" />
            <span>Print 25 Under 25</span>
          </button>
        </div>
      </header>

      <main>
        <header className="bbi-top100__masthead">
          <div className="bbi-top100__edition">
            <span>PRINT EDITION · YOUNG PLAYER PIPELINE</span>
            <strong>
              {response?.snapshot.id
                ? response.snapshot.id.slice(-8).toLocaleUpperCase('en-US')
                : 'LOADING'}
            </strong>
          </div>
          <div className="bbi-top100__title-row">
            <div>
              <p>BACKSTOP BINDER INDEX</p>
              <h1>25 Under 25</h1>
              <h2>Closest to Master Build</h2>
            </div>
            <div className="bbi-top100__mark" aria-hidden="true">
              <BookOpenCheck size={29} />
            </div>
          </div>
          <p className="bbi-top100__dek">
            The 25 highest Graduation Index scores among baseball, football,
            and basketball players age 25 or younger. The list rank is specific
            to this young-player screen; each row retains its global path rank.
          </p>
          <dl className="bbi-top100__snapshot">
            <div>
              <dt>Positions</dt>
              <dd>{items.length || '—'} / 25</dd>
            </div>
            <div>
              <dt>Age ceiling</dt>
              <dd>25</dd>
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
          <strong>Graduation Index</strong>
          <span>
            Weak-link blend of sport-specific player outlook and absolute
            market-path readiness. Higher means closer to Master Build; it is
            not the Binder Score and not a probability.
          </span>
        </section>

        {error ? (
          <div className="bbi-top100__message" role="alert">
            <strong>25 Under 25 unavailable.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="bbi-top100__message" role="status">
            Preparing the current 25 Under 25…
          </div>
        ) : null}

        {!loading && !error && !complete ? (
          <div className="bbi-top100__message" role="status">
            <strong>Print edition withheld.</strong>
            <span>
              The board requires a current snapshot with 25 eligible young
              players.
            </span>
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="bbi-top100__table-frame">
            <table aria-label="Backstop Binder Index 25 Under 25">
              <caption>
                The 25 players age 25 or younger with the highest Graduation
                Index.
              </caption>
              <thead>
                <tr>
                  <th scope="col">U25 rank</th>
                  <th scope="col">Player</th>
                  <th scope="col">Age</th>
                  <th scope="col">Graduation Index</th>
                  <th scope="col">Outlook / market</th>
                  <th scope="col">TTM / run rate</th>
                  <th scope="col">Path</th>
                  <th scope="col">Binding gate</th>
                  <th scope="col">Grade</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    className={`bbi-top100__row bbi-top100__row--${item.player.sport}`}
                    key={item.player.id}
                  >
                    <td className="bbi-top100__rank">
                      <span aria-hidden="true" />
                      <div>
                        <strong>#{index + 1}</strong>
                        <small>global #{item.graduation.globalRank}</small>
                      </div>
                    </td>
                    <th scope="row">
                      <strong>{item.player.name}</strong>
                      <span>
                        {sportLabels[item.player.sport]} ·{' '}
                        {item.player.primaryPosition}
                        {item.player.team ? ` · ${item.player.team}` : ''}
                      </span>
                    </th>
                    <td>{ageLabel(item.player.age)}</td>
                    <td className="bbi-top100__index">
                      <strong>{scoreLabel(item.graduation.index)}</strong>
                    </td>
                    <td>
                      <strong>{item.playerSignal.outlook.toFixed(1)}</strong>
                      <span>
                        {scoreLabel(item.graduation.marketPathReadiness)} market
                      </span>
                    </td>
                    <td>
                      <strong>{moneyLabel(item.market.ttmSalesUsd)}</strong>
                      <span>
                        {moneyLabel(item.market.currentRunRateUsd)} run rate
                      </span>
                    </td>
                    <td>
                      <strong>{pathLabels[item.graduation.band]}</strong>
                      <span>{titleLabel(item.graduation.trajectory)}</span>
                    </td>
                    <td>
                      <strong>{nextGateLabel(item)}</strong>
                      <span>
                        {blockerLabels[item.graduation.primaryBlocker]}
                      </span>
                    </td>
                    <td className="bbi-top100__grade">
                      <strong>{item.graduation.evidence.grade}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <footer className="bbi-top100__notes">
          <ShieldCheck size={16} aria-hidden="true" />
          <p>
            <strong>Research boundary.</strong> Subject-level prioritization
            only. Card, grade, supply, entry price, liquidity, and personal risk
            tolerance require separate underwriting. Graduation probability
            remains withheld pending prospective calibration.
          </p>
          <span>
            Model {response?.modelVersion ?? '—'} · Published{' '}
            {timestampLabel(response?.snapshot.generatedAt)}
          </span>
        </footer>
      </main>
    </div>
  )
}
