import { lazy, Suspense } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  FilterX,
  LoaderCircle,
  Search,
  Star,
} from 'lucide-react'
import type {
  BoardFilters,
  PlayerRecord,
  PlayerFacetOption,
  PlayersPage,
  PlayerType,
  StageFilter,
} from '../domain/forecast'
import {
  eligibleAlphaSignal,
  developmentChapterLabel,
  formatPercentagePointDelta,
  formatProbability,
  formatTopRankPercent,
  formatWar,
  isMlbStage,
  probabilityTone,
  stageLabel,
} from '../lib/forecast'
import { playerMapFor } from './playerMapView'

const MilbOpportunityMap = lazy(() =>
  import('./MilbOpportunityMap').then((module) => ({ default: module.MilbOpportunityMap })),
)

interface ProspectBoardProps {
  players: PlayerRecord[]
  selectedId: string | null
  filters: BoardFilters
  pagination: PlayersPage
  loading: boolean
  error: string | null
  watchlist: Set<string>
  facets?: {
    teams: PlayerFacetOption[]
    positions: PlayerFacetOption[]
  }
  onSelect: (playerId: string) => void
  onToggleWatchlist: (playerId: string) => void
  onChangeFilters: (patch: Partial<BoardFilters>) => void
  onChangePage: (page: number) => void
}

const stages: StageFilter[] = ['All', 'Minors', 'MLB']
const playerTypes: Array<'All' | PlayerType> = ['All', 'Hitter', 'Pitcher', 'Two-way']

function withCurrentFacet(
  options: PlayerFacetOption[],
  current: string | undefined,
): PlayerFacetOption[] {
  if (!current || current === 'All' || options.some((option) => option.value === current)) {
    return options
  }
  return [{ value: current, label: current, count: 0 }, ...options]
}

function confidenceLabel(player: PlayerRecord): string {
  return player.careerForecast?.confidenceState ?? 'Withheld'
}

function alphaMissLabel(player: PlayerRecord): string {
  if (!isMlbStage(player.stage)) {
    if (!player.researchEstimate) return 'No exact frozen arrival-model match'
    if (!player.milbAlphaSignal?.eligible) return 'Arrival confirmation gate not cleared'
    if (!player.milbImpactRanking) return 'No exact frozen impact-rank match'
    if (player.milbImpactRanking.rankPercentile < 90) return 'Outside the five-year impact top decile'
    return 'Research ceiling rank withheld'
  }
  const signal = player.careerForecast?.alphaSignal
  if (!signal || signal.status === 'withheld') return 'Completed-season signal withheld'
  if (!signal.gates.earlyCareer) return 'Outside the early-career gate'
  if (!signal.gates.prePrimeRunway) return 'Insufficient pre-prime runway'
  if (!signal.gates.absoluteCeiling) return 'Absolute ceiling gate not cleared'
  return 'No positive edge versus the historical baseline'
}

export function ProspectBoard({
  players,
  selectedId,
  filters,
  pagination,
  loading,
  error,
  watchlist,
  facets,
  onSelect,
  onToggleWatchlist,
  onChangeFilters,
  onChangePage,
}: ProspectBoardProps) {
  const hasPreviousPage = pagination.page > 1
  const hasNextPage = pagination.page < pagination.totalPages
  const alphaView = filters.sort === 'alphaOpportunity'
  const minorAlphaView = alphaView && filters.stage === 'Minors'
  const mlbAlphaView = alphaView && filters.stage === 'MLB'
  const activeFilterCount = [
    filters.query.trim() ? filters.query : null,
    filters.playerType !== 'All' ? filters.playerType : null,
    filters.level !== 'All' ? filters.level : null,
    filters.team && filters.team !== 'All' ? filters.team : null,
    filters.position && filters.position !== 'All' ? filters.position : null,
  ].filter(Boolean).length
  const teamOptions = withCurrentFacet(facets?.teams ?? [], filters.team)
  const positionOptions = withCurrentFacet(facets?.positions ?? [], filters.position)

  return (
    <section id="prospect-board" className="board-panel" aria-labelledby="board-title" aria-busy={loading}>
      <div className="board-heading">
        <div>
          <span className="eyebrow">
            {minorAlphaView
              ? 'DIRECT IMPACT RANK + ARRIVAL CONFIRMATION'
              : mlbAlphaView
                ? 'MODEL-GATED CAREER ANOMALIES'
                : alphaView
                  ? 'UNIVERSAL STAGE-SPECIFIC ASSESSMENT'
                : 'STAGE-SPECIFIC RESEARCH RANK'}
          </span>
          <h2 id="board-title">
            {minorAlphaView
              ? 'Early Ceiling Radar'
              : mlbAlphaView
                ? 'Alpha Radar'
                : alphaView
                  ? 'Player Map'
                  : 'Oracle Board'}
          </h2>
        </div>
        <span className="record-count">
          {loading ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : null}
          {pagination.total.toLocaleString()} players
        </span>
      </div>

      <div className="board-filters" aria-label="Player cohort filters">
        <label className="search-field">
          <span className="sr-only">Search players</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onChangeFilters({ query: event.target.value })}
            placeholder="Search player, team, position"
          />
        </label>

        <div className="segmented-control stage-control" aria-label="Career stage">
          {stages.map((stage) => (
            <button
              key={stage}
              type="button"
              className={filters.stage === stage ? 'is-active' : ''}
              aria-pressed={filters.stage === stage}
              onClick={() => onChangeFilters(stage === 'MLB' ? { stage, level: 'All' } : { stage })}
            >
              {stage}
            </button>
          ))}
        </div>

        <label className="select-field">
          <span>Role</span>
          <select
            aria-label="Player role"
            value={filters.playerType}
            onChange={(event) =>
              onChangeFilters({ playerType: event.target.value as 'All' | PlayerType })
            }
          >
            {playerTypes.map((type) => (
              <option key={type} value={type}>
                {type === 'All' ? 'All roles' : type === 'Two-way' ? 'Two-way' : `${type}s`}
              </option>
            ))}
          </select>
        </label>

        <label className="select-field">
          <span>Team</span>
          <select
            aria-label="Team"
            value={filters.team ?? 'All'}
            onChange={(event) => onChangeFilters({ team: event.target.value })}
          >
            <option value="All">All teams</option>
            {teamOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.count.toLocaleString()}
              </option>
            ))}
          </select>
        </label>

        <label className="select-field">
          <span>Position</span>
          <select
            aria-label="Position"
            value={filters.position ?? 'All'}
            onChange={(event) => onChangeFilters({ position: event.target.value })}
          >
            <option value="All">All positions</option>
            {positionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.count.toLocaleString()}
              </option>
            ))}
          </select>
        </label>

        <label className="select-field">
          <span>Level</span>
          <select
            aria-label="Level"
            value={filters.level}
            disabled={filters.stage === 'MLB'}
            onChange={(event) => onChangeFilters({ level: event.target.value })}
          >
            <option>All</option>
            <option>AAA</option>
            <option>AA</option>
            <option>A+</option>
            <option>A</option>
            <option>Rk</option>
          </select>
        </label>

        <label className="select-field rank-select">
          <span>Rank by</span>
          <select
            aria-label="Rank by"
            value={filters.sort}
            onChange={(event) =>
              onChangeFilters({ sort: event.target.value as BoardFilters['sort'] })
            }
          >
            <option value="alphaOpportunity">Player map</option>
            <option value="hofProbability">P(HOF caliber)</option>
            <option value="nearTermImpact">Near-term impact</option>
            <option value="finalWar">Final WAR P50</option>
            <option value="arrival36">Arrival anomaly rank</option>
            <option value="age">Age</option>
            <option value="name">Name</option>
          </select>
        </label>

        <button
          className="filter-reset"
          type="button"
          disabled={activeFilterCount === 0}
          onClick={() => onChangeFilters({
            query: '',
            playerType: 'All',
            level: 'All',
            team: 'All',
            position: 'All',
          })}
          title="Clear cohort filters"
        >
          <FilterX size={14} aria-hidden="true" />
          Clear{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
      </div>

      {filters.stage === 'Minors' && players.length > 0 ? (
        <Suspense fallback={<div className="opportunity-map opportunity-map-loading">Loading ceiling landscape</div>}>
          <MilbOpportunityMap
            players={players}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </Suspense>
      ) : null}

      {error && players.length === 0 ? (
        <div className="empty-state empty-state--error" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <strong>Player data is unavailable</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {loading && players.length === 0 ? (
        <div className="empty-state" role="status">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <strong>Loading the player universe</strong>
          <span>Reading the current research artifact and source directory.</span>
        </div>
      ) : null}

      {players.length > 0 ? (
        <div className="board-table-wrap">
          <table className="board-table oracle-board-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player / stage</th>
                <th scope="col">Age / context</th>
                <th scope="col">P(HOF caliber)</th>
                <th scope="col">Player map</th>
                <th scope="col">Final WAR</th>
                <th scope="col">Arrival / actual</th>
                <th scope="col">Confidence</th>
                <th scope="col"><span className="sr-only">Save</span></th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const saved = watchlist.has(player.id)
                const selected = player.id === selectedId
                const organization =
                  player.organizationCode ?? player.organization ?? 'Organization unavailable'
                const forecast = player.careerForecast
                const hofProbability = forecast?.hofCaliberProbability ?? null
                const mlbStage = isMlbStage(player.stage)
                const chapter = forecast?.careerChapter
                const alpha = eligibleAlphaSignal(player)
                const playerMap = playerMapFor(player)
                const impact = !mlbStage ? player.milbImpactRanking ?? null : null
                const rawAlpha = forecast?.alphaSignal
                const chapterLabel = mlbStage
                  ? chapter?.status === 'research'
                    ? chapter.label
                    : chapter ? 'Chapter withheld' : 'Chapter unavailable'
                  : developmentChapterLabel(player.level)
                const displayedRank = alphaView
                  ? alpha?.rank ?? impact?.rank ?? playerMap.scores.outcome.rank
                  : forecast?.rank ?? null
                const rankScope = alphaView
                  ? impact
                    ? `of ${impact.universeRows.toLocaleString()}`
                    : alpha
                      ? 'alpha'
                      : playerMap.route === 'mlb' ? 'MLB outlook' : 'player map'
                  : mlbStage ? 'MLB' : 'minors'

                return (
                  <tr key={player.id} className={selected ? 'is-selected' : ''}>
                    <td className="rank-cell">
                      <strong className="table-primary">
                        {displayedRank ? `#${displayedRank}` : '—'}
                      </strong>
                      <small>
                        {displayedRank ? rankScope : playerMap.stateLabel}
                      </small>
                    </td>
                    <td>
                      <button
                        className="player-cell"
                        type="button"
                        onClick={() => onSelect(player.id)}
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span className={`player-avatar player-avatar--${player.playerType.toLowerCase()}`}>
                          {player.initials}
                        </span>
                        <span>
                          <span className="mobile-player-rank">
                            {displayedRank ? `#${displayedRank} ${rankScope}` : playerMap.stateLabel}
                          </span>
                          <strong className="player-name">{player.name}</strong>
                          <small>
                            {organization} · {player.position ?? player.playerType} · Age {player.age ?? '—'} · {player.level ?? stageLabel(player.stage)}
                          </small>
                          <span className={`stage-badge stage-badge--${player.stage}`}>
                            {stageLabel(player.stage)}
                          </span>
                        </span>
                        <ChevronRight className="row-chevron" size={16} aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <strong className="table-primary">{player.age ?? '—'}</strong>
                      <small>{chapterLabel}</small>
                    </td>
                    <td>
                      {hofProbability === null ? (
                        <strong className="table-primary">—</strong>
                      ) : (
                        <span className={`probability-value tone-${probabilityTone(hofProbability * 100)}`}>
                          {formatProbability(hofProbability)}
                        </span>
                      )}
                      <small>
                        {player.stage === 'pre_debut' && forecast
                          ? 'research · 60m lower bound'
                          : forecast?.publicationState ?? 'no career model'}
                      </small>
                    </td>
                    <td className="alpha-cell">
                      {alpha ? (
                        <>
                          <div className="alpha-cell-lead">
                            <strong className="alpha-edge-value">
                              {formatPercentagePointDelta(alpha.edge?.probabilityDelta ?? null)}
                            </strong>
                            <span className={`alpha-tier alpha-tier--${alpha.tier}`}>
                              {alpha.tier === 'priority' ? 'model priority' : 'model watch'}
                            </span>
                          </div>
                          <small>
                            {formatProbability(alpha.modeledProbability)} modeled vs {formatProbability(alpha.baseline?.probability ?? null)} base
                          </small>
                        </>
                      ) : impact ? (
                        <>
                          <div className="alpha-cell-lead">
                            <strong className="alpha-edge-value">
                              {formatTopRankPercent(
                                impact.rank,
                                impact.universeRows,
                              )}
                            </strong>
                            <span className={`alpha-tier alpha-tier--map-${playerMap.state}`}>
                              {playerMap.stateLabel}
                            </span>
                          </div>
                          <small>
                            Impact #{impact.rank.toLocaleString()} · {player.milbAlphaSignal?.eligible
                              ? `arrival #${player.milbAlphaSignal.rank?.toLocaleString() ?? '—'}`
                              : 'arrival not confirmed'}
                          </small>
                        </>
                      ) : (
                        <>
                          <div className="alpha-cell-lead">
                            <strong className="alpha-withheld">
                              {playerMap.scores.outcome.rank
                                ? `#${playerMap.scores.outcome.rank.toLocaleString()}`
                                : playerMap.scores.evidence.display}
                            </strong>
                            <span className={`alpha-tier alpha-tier--map-${playerMap.state}`}>
                              {playerMap.stateLabel}
                            </span>
                          </div>
                          <small>
                            {mlbStage
                              ? rawAlpha?.status === 'research'
                                ? 'Terminal outlook mapped · Alpha gate not triggered'
                                : alphaMissLabel(player)
                              : 'Direct impact rank unavailable · evidence retained'}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <strong className="table-primary">
                        {formatWar(forecast?.finalCareerWar?.p50 ?? null)}
                      </strong>
                      <small>P50 · P90 {formatWar(forecast?.finalCareerWar?.p90 ?? null)}</small>
                    </td>
                    <td>
                      {mlbStage ? (
                        <>
                          <strong className="table-primary">{formatWar(forecast?.cumulativeWar ?? null)}</strong>
                          <small>cumulative WAR</small>
                        </>
                      ) : (
                        <>
                          <strong className="table-primary">
                            {player.milbAlphaSignal?.rank ? `#${player.milbAlphaSignal.rank}` : 'Withheld'}
                          </strong>
                          <small>
                            {player.milbAlphaSignal?.rank
                              ? 'frozen arrival-anomaly rank'
                              : 'arrival confidence not calibrated'}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <strong className="table-primary confidence-value">{confidenceLabel(player)}</strong>
                      <small>
                        {forecast?.confidenceScore === null || !forecast
                          ? 'score withheld'
                          : `${formatProbability(forecast.confidenceScore)} evidence`}
                      </small>
                    </td>
                    <td>
                      <button
                        className={`icon-button${saved ? ' is-saved' : ''}`}
                        type="button"
                        onClick={() => onToggleWatchlist(player.id)}
                        aria-label={saved ? `Remove ${player.name} from watchlist` : `Add ${player.name} to watchlist`}
                        title={saved ? 'Remove from watchlist' : 'Add to watchlist'}
                      >
                        <Star size={16} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !error && players.length === 0 ? (
        <div className="empty-state">
          {pagination.total === 0 ? <Search size={22} aria-hidden="true" /> : <Database size={22} aria-hidden="true" />}
          <strong>{filters.stage === 'MLB' ? 'No matching MLB players' : 'No matching players'}</strong>
          <span>
            {filters.stage === 'MLB'
              ? 'Adjust the search or role filters.'
              : 'Adjust the search or cohort filters.'}
          </span>
        </div>
      ) : null}

      {pagination.totalPages > 1 ? (
        <nav className="board-pagination" aria-label="Player results pages">
          <button
            className="icon-button"
            type="button"
            disabled={!hasPreviousPage || loading}
            onClick={() => onChangePage(pagination.page - 1)}
            aria-label="Previous page"
            title="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span>
            Page <strong>{pagination.page}</strong> of {pagination.totalPages.toLocaleString()}
          </span>
          <button
            className="icon-button"
            type="button"
            disabled={!hasNextPage || loading}
            onClick={() => onChangePage(pagination.page + 1)}
            aria-label="Next page"
            title="Next page"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  )
}
