import { Fragment, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  LockKeyhole,
  RotateCcw,
  Search,
} from 'lucide-react'
import {
  FOOTBALL_MARKET_FORMAT_IDS,
  type FootballMarketFeedResponse,
  type FootballMarketFormatId,
  type FootballMarketPosition,
  type FootballMarketRanking,
} from '../football/marketFeedContract'
import './football-young-investor-workbench.css'

export type FootballYoungPosition = FootballMarketPosition

interface FootballYoungInvestorWorkbenchProps {
  response: FootballMarketFeedResponse | null
  loading: boolean
  error: string | null
  position: FootballYoungPosition
  formatId: FootballMarketFormatId
  search: string
  page: number
  onPositionChange: (value: FootballYoungPosition) => void
  onFormatChange: (value: FootballMarketFormatId) => void
  onSearchChange: (value: string) => void
  onPageChange: (value: number) => void
  onReset: () => void
}

const PAGE_SIZE = 50

const formatLabels: Record<FootballMarketFormatId, string> = {
  one_qb_12t_half_ppr_no_tep: '1QB · 12-team · 0.5 PPR',
  one_qb_12t_half_ppr_tep: '1QB · 12-team · 0.5 PPR · TE+',
  one_qb_12t_half_ppr_tepp: '1QB · 12-team · 0.5 PPR · TE++',
  one_qb_12t_half_ppr_teppp: '1QB · 12-team · 0.5 PPR · TE+++',
  sf_12t_half_ppr_no_tep: 'Superflex · 12-team · 0.5 PPR',
  sf_12t_half_ppr_tep: 'Superflex · 12-team · 0.5 PPR · TE+',
  sf_12t_half_ppr_tepp: 'Superflex · 12-team · 0.5 PPR · TE++',
  sf_12t_half_ppr_teppp: 'Superflex · 12-team · 0.5 PPR · TE+++',
}

const positionOptions: readonly FootballYoungPosition[] = [
  'QB',
  'WR',
  'RB',
  'TE',
]

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(parsed)
}

function percentileLabel(value: number): string {
  return `${value.toFixed(1)} pct`
}

function valueLabel(value: number | null): string {
  return value === null ? '—' : value.toLocaleString()
}

function matchedRows(
  response: FootballMarketFeedResponse | null,
  position: FootballYoungPosition,
  search: string,
): FootballMarketRanking[] {
  const query = search.trim().toLocaleLowerCase('en-US')
  return (response?.rankings ?? [])
    .filter((row) => (
      row.provider === 'keeptradecut' &&
      row.comparisonScope === 'exact_format' &&
      row.universe === 'college' &&
      row.position === position &&
      (!query || row.name.toLocaleLowerCase('en-US').includes(query))
    ))
    .toSorted((left, right) => (
      left.positionRank - right.positionRank ||
      left.name.localeCompare(right.name, 'en-US')
    ))
}

export function FootballYoungInvestorWorkbench({
  response,
  loading,
  error,
  position,
  formatId,
  search,
  page,
  onPositionChange,
  onFormatChange,
  onSearchChange,
  onPageChange,
  onReset,
}: FootballYoungInvestorWorkbenchProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const rows = matchedRows(response, position, search)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage = Math.min(page, Math.max(1, totalPages))
  const visibleRows = rows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )
  const ktcStatus = response?.providers.find(
    (provider) => provider.provider === 'keeptradecut',
  )
  const providerUnavailable =
    response !== null && ktcStatus?.status !== 'available'
  const filtersActive =
    position !== 'WR' ||
    formatId !== 'sf_12t_half_ppr_no_tep' ||
    search.trim().length > 0

  return (
    <div className="fyw-body" aria-busy={loading}>
      <div className="iw-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading
          ? 'Updating the football prospect watchlist.'
          : error
            ? ''
            : `${rows.length.toLocaleString()} ${position} Devy market matches.`}
      </div>

      <div
        className="iw-controls fyw-controls"
        role="group"
        aria-label="Football prospect filters"
      >
        <div className="yw-control-context">
          <span className="iw-control-label">Football Beta</span>
          <strong>College / Devy market watchlist</strong>
          <small>Live provider order; Oracle production and verified age are withheld.</small>
        </div>

        <label>
          <span className="iw-control-label">Position</span>
          <select
            value={position}
            onChange={(event) => {
              onPositionChange(
                event.currentTarget.value as FootballYoungPosition,
              )
            }}
          >
            {positionOptions.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="iw-control-label">Dynasty format</span>
          <select
            value={formatId}
            onChange={(event) => {
              onFormatChange(
                event.currentTarget.value as FootballMarketFormatId,
              )
            }}
          >
            {FOOTBALL_MARKET_FORMAT_IDS.map((value) => (
              <option key={value} value={value}>
                {formatLabels[value]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="iw-control-label">Player</span>
          <span className="iw-input-shell">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              aria-label="Football prospect"
              placeholder="Search player"
              value={search}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
          </span>
        </label>

        <button
          type="button"
          className="iw-reset"
          disabled={!filtersActive}
          onClick={onReset}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset
        </button>
      </div>

      <div className="iw-result-bar fyw-result-bar">
        <div>
          <strong>{rows.length.toLocaleString()}</strong>
          <span>college {position}s · provider-defined Devy order</span>
        </div>
        <p>
          This is live dynasty-market context—not an Oracle Build rank or card-demand score.
        </p>
        <span className="iw-withheld-status">
          <LockKeyhole size={13} aria-hidden="true" />
          NFL age screen withheld
        </span>
      </div>

      {error ? (
        <div className="iw-message iw-message--error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {providerUnavailable && !error ? (
        <div className="iw-message iw-message--error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>
            KeepTradeCut Devy is temporarily unavailable
            {ktcStatus?.errorCode ? ` (${ktcStatus.errorCode.replaceAll('_', ' ')})` : ''}.
            No substitute ranking is being shown.
          </span>
        </div>
      ) : null}

      {loading && visibleRows.length === 0 ? (
        <div className="iw-message" role="status">
          Loading the live College / Devy watchlist…
        </div>
      ) : null}

      {visibleRows.length > 0 ? (
        <div
          className={`iw-table-frame fyw-table-frame${loading ? ' is-loading' : ''}`}
          aria-busy={loading}
        >
          <table aria-label="Football prospect Devy market watchlist">
            <caption className="iw-sr-only">
              College football prospects ordered by the selected KeepTradeCut
              Devy position rank.
            </caption>
            <thead>
              <tr>
                <th className="iw-expand-column" aria-label="Row details" />
                <th className="iw-subject-column" scope="col">Player</th>
                <th scope="col">Devy position rank</th>
                <th scope="col">Position percentile</th>
                <th scope="col">Provider value</th>
                <th scope="col">Tier</th>
                <th scope="col">Format</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const expanded = expandedId === row.providerPlayerId
                return (
                  <Fragment key={row.providerPlayerId}>
                    <tr className="iw-data-row iw-posture--watch">
                      <td className="iw-expand-column">
                        <button
                          type="button"
                          aria-label={`${expanded ? 'Hide' : 'Show'} football prospect detail for ${row.name}`}
                          aria-expanded={expanded}
                          onClick={() => {
                            setExpandedId(
                              expanded ? null : row.providerPlayerId,
                            )
                          }}
                        >
                          {expanded ? (
                            <ChevronUp size={15} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={15} aria-hidden="true" />
                          )}
                        </button>
                      </td>
                      <th className="iw-subject-column" scope="row">
                        <strong>{row.name}</strong>
                        <span>
                          College · {row.position} · KTC ID {row.providerPlayerId}
                        </span>
                      </th>
                      <td className="iw-number iw-rank fyw-rank">
                        <strong>#{row.positionRank}</strong>
                        <span>of {row.positionUniverseSize}</span>
                      </td>
                      <td className="iw-number">
                        <strong>{percentileLabel(row.positionPercentile)}</strong>
                        <span>within {row.position}</span>
                      </td>
                      <td className="iw-number">
                        <strong>{valueLabel(row.value)}</strong>
                        <span>KTC scale</span>
                      </td>
                      <td className="iw-number">
                        <strong>{row.tier ?? '—'}</strong>
                        <span>provider tier</span>
                      </td>
                      <td className="fyw-format">
                        <strong>{formatLabels[row.requestedFormatId]}</strong>
                        <span>exact KTC format</span>
                      </td>
                      <td className="iw-evidence">
                        <strong>Live market</strong>
                        <span>Retrieved {formatDateTime(row.fetchedAt)}</span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="iw-detail-row">
                        <td colSpan={8}>
                          <div className="iw-detail yw-detail fyw-detail">
                            <section>
                              <span className="iw-detail-label">What this order means</span>
                              <h3>#{row.positionRank} in KTC Devy {row.position}</h3>
                              <p>
                                The rank and value are KeepTradeCut&apos;s
                                provider-defined Devy market reading for the
                                selected exact fantasy format. Hobby Oracle has
                                not converted it into a collection score.
                              </p>
                              <a
                                className="fyw-source-link"
                                href={row.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open attributed source
                                <ExternalLink size={12} aria-hidden="true" />
                              </a>
                            </section>

                            <section>
                              <span className="iw-detail-label">Evidence present</span>
                              <dl className="iw-signal-grid">
                                <div>
                                  <dt>Position rank</dt>
                                  <dd>#{row.positionRank}</dd>
                                </div>
                                <div>
                                  <dt>Percentile</dt>
                                  <dd>{percentileLabel(row.positionPercentile)}</dd>
                                </div>
                                <div>
                                  <dt>Value</dt>
                                  <dd>{valueLabel(row.value)}</dd>
                                </div>
                                <div>
                                  <dt>Tier</dt>
                                  <dd>{row.tier ?? '—'}</dd>
                                </div>
                              </dl>
                              <p className="yw-age-note">
                                Provider values are not comparable across the
                                College / Devy and NFL dynasty universes.
                              </p>
                            </section>

                            <section>
                              <span className="iw-detail-label">Evidence withheld</span>
                              <h3>Production conviction is not released</h3>
                              <p>
                                Verified age, eligibility, college production,
                                NFL trajectory, GemRate card demand, exact-card
                                supply, and expected appreciation are not part
                                of this row.
                              </p>
                              <a className="fyw-oracle-link" href="/football">
                                Open Football Oracle research
                                <ExternalLink size={12} aria-hidden="true" />
                              </a>
                            </section>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !error && !providerUnavailable && rows.length === 0 ? (
        <div className="iw-empty" role="status">
          <strong>No Devy players match this screen.</strong>
          <span>Try another position or clear the player search.</span>
          <button type="button" onClick={onReset}>Reset football filters</button>
        </div>
      ) : null}

      {!error && totalPages > 1 ? (
        <nav className="iw-pagination" aria-label="Football prospect result pages">
          <button
            type="button"
            disabled={loading || safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
            Previous
          </button>
          <span>
            Page <strong>{safePage}</strong> of {totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            disabled={loading || safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
          >
            Next
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  )
}
