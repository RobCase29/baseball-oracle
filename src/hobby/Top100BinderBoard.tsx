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
  if (graduation.status === 'graduated') return 'Build standard cleared'
  if (graduation.status === 'withheld') return 'Evidence refresh required'
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

function rankedTop100(
  response: BinderGraduationV2Response | null,
): BinderGraduationV2Item[] {
  return (response?.items ?? [])
    .filter(
      (item) =>
        item.graduation.status === 'ranked' &&
        item.graduation.globalRank !== null &&
        item.graduation.globalRank <= 100,
    )
    .toSorted(
      (left, right) =>
        (left.graduation.globalRank ?? 101) -
        (right.graduation.globalRank ?? 101),
    )
    .slice(0, 100)
}

export function Top100BinderBoard() {
  const [response, setResponse] =
    useState<BinderGraduationV2Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Top 100 · Backstop Binder Index'
    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      sport: 'all',
      band: 'all',
      sort: 'graduation_rank',
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
          throw new Error(`Top 100 board returned ${result.status}.`)
        }
        const payload = (await result.json()) as unknown
        if (
          !isBinderGraduationV2Response(payload) ||
          payload.scope.sport !== 'all' ||
          payload.scope.maxAge !== null
        ) {
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
  const current =
    response?.snapshot.freshness.status === 'current'
  const complete = current && items.length === 100

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
          <a href="/hobby?lens=players&sport=all">
            <ArrowLeft size={14} aria-hidden="true" />
            Live board
          </a>
          <button
            type="button"
            disabled={!complete}
            onClick={() => window.print()}
          >
            <Printer size={15} aria-hidden="true" />
            Print Top 100
          </button>
        </div>
      </header>

      <main>
        <header className="bbi-top100__masthead">
          <div className="bbi-top100__edition">
            <span>PRINT EDITION · GLOBAL PLAYER PIPELINE</span>
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
              <h2>Closest to Master Build</h2>
            </div>
            <div className="bbi-top100__mark" aria-hidden="true">
              <BookOpenCheck size={29} />
            </div>
          </div>
          <p className="bbi-top100__dek">
            One absolute order across baseball, football, and basketball.
            No sport quotas, no age screen, and no filtered reranking.
          </p>
          <dl className="bbi-top100__snapshot">
            <div>
              <dt>Positions</dt>
              <dd>{items.length || '—'} / 100</dd>
            </div>
            <div>
              <dt>Data through</dt>
              <dd>{calendarDateLabel(response?.snapshot.dataThrough)}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{timestampLabel(response?.snapshot.generatedAt)}</dd>
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
            Weak-link blend of player outlook and absolute market-path
            readiness. Higher means closer to the existing Master Build
            standard; it is not a probability.
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
            Preparing the current global Top 100…
          </div>
        ) : null}

        {!loading && !error && !complete ? (
          <div className="bbi-top100__message" role="status">
            <strong>Print edition withheld.</strong>
            <span>
              The board requires a current snapshot with all 100 globally
              ranked positions.
            </span>
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="bbi-top100__table-frame">
            <table aria-label="Backstop Binder Index global Top 100">
              <caption>
                The 100 globally ranked players closest to the Master Build
                standard.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col">Age</th>
                  <th scope="col">Index</th>
                  <th scope="col">Outlook / market</th>
                  <th scope="col">TTM / run rate</th>
                  <th scope="col">Path</th>
                  <th scope="col">Binding gate</th>
                  <th scope="col">Grade</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    className={`bbi-top100__row bbi-top100__row--${item.player.sport}`}
                    key={item.player.id}
                  >
                    <td className="bbi-top100__rank">
                      <span aria-hidden="true" />
                      <strong>#{item.graduation.globalRank}</strong>
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
            tolerance require separate underwriting. Probability remains
            withheld until prospective transition history earns calibration.
          </p>
          <span>
            Model {response?.modelVersion ?? '—'} ·{' '}
            {response?.meta.rankingPolicy
              ? 'Global rank assigned before every filter'
              : 'Loading ranking policy'}
          </span>
        </footer>
      </main>
    </div>
  )
}
