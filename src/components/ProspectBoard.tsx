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
  formatTopRankPercent,
  formatWar,
  isMlbStage,
  stageLabel,
} from '../lib/forecast'
import { oracleScoreFor, plainPlayerState, playerMapFor } from './playerMapView'

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

function alphaMissLabel(player: PlayerRecord): string {
  if (!isMlbStage(player.stage)) {
    if (!player.researchEstimate) return 'Not enough matched data to estimate MLB arrival'
    if (!player.milbAlphaSignal?.eligible) return 'MLB arrival is not confirmed yet'
    if (!player.milbImpactRanking) return 'Not enough matched data for an impact score'
    if (player.milbImpactRanking.rankPercentile < 90) return 'Outside the top 10% for five-year MLB impact'
    return 'Five-year impact score unavailable'
  }
  const signal = player.careerForecast?.alphaSignal
  if (!signal || signal.status === 'withheld') return 'No standout career signal yet'
  if (!signal.gates.earlyCareer) return 'Past the early-career breakout window'
  if (!signal.gates.prePrimeRunway) return 'Limited development time before the typical peak years'
  if (!signal.gates.absoluteCeiling) return 'Projected ceiling is below the standout threshold'
  return 'Career outlook does not beat the similar-player baseline'
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
              ? 'FIVE-YEAR MLB IMPACT RANKING'
              : mlbAlphaView
                ? 'HALL-LEVEL CAREER RANKING'
                : alphaView
                  ? 'ONE SCORE, COMPARED WITH PLAYERS AT THE SAME STAGE'
                  : 'PLAYER OUTLOOK RANKINGS'}
          </span>
          <h2 id="board-title">
            {minorAlphaView
              ? 'Prospect Rankings'
              : mlbAlphaView
                ? 'MLB Rankings'
                : alphaView
                  ? 'Player Rankings'
                  : 'Oracle Rankings'}
          </h2>
        </div>
        <span className="record-count">
          {loading ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : null}
          {pagination.total.toLocaleString()} players
        </span>
      </div>

      <div className="board-filters" aria-label="Player filters">
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
              onClick={() => {
                const sortIsUnavailable = (
                  stage === 'Minors' && (
                    filters.sort === 'nearTermImpact' || filters.sort === 'finalWar'
                  )
                ) || (stage === 'MLB' && filters.sort === 'arrival36')
                onChangeFilters({
                  stage,
                  ...(stage === 'MLB' ? { level: 'All' } : {}),
                  ...(sortIsUnavailable ? { sort: 'alphaOpportunity' as const } : {}),
                })
              }}
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
            <option value="alphaOpportunity">Oracle Score</option>
            {filters.stage !== 'Minors' ? <option value="nearTermImpact">Next 3-year upside</option> : null}
            {filters.stage !== 'Minors' ? <option value="finalWar">Projected career WAR</option> : null}
            {filters.stage !== 'MLB' ? <option value="arrival36">MLB arrival research rank</option> : null}
            <option value="age">Youngest first</option>
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
          title="Clear player filters"
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
          <strong>Loading players</strong>
          <span>Loading current stats and career projections.</span>
        </div>
      ) : null}

      {players.length > 0 ? (
        <div className="board-table-wrap">
          <table className="board-table oracle-board-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player / Oracle Score</th>
                <th scope="col">Age / career stage</th>
                <th scope="col">What the score ranks</th>
                <th scope="col">Why it stands out</th>
                <th scope="col">Career projection</th>
                <th scope="col">Current path</th>
                <th scope="col">Evidence</th>
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
                const mlbStage = isMlbStage(player.stage)
                const chapter = forecast?.careerChapter
                const alpha = eligibleAlphaSignal(player)
                const playerMap = playerMapFor(player)
                const oracleScore = oracleScoreFor(player)
                const impact = !mlbStage ? player.milbImpactRanking ?? null : null
                const rawAlpha = forecast?.alphaSignal
                const chapterLabel = mlbStage
                  ? chapter?.status === 'research'
                    ? chapter.label
                    : chapter ? 'Chapter withheld' : 'Chapter unavailable'
                  : developmentChapterLabel(player.level)
                const displayedRank = oracleScore.rank
                const rankScope = oracleScore.universe
                  ? `of ${oracleScore.universe.toLocaleString()}`
                  : playerMap.route === 'mlb' ? 'major leaguers' : 'prospects'
                const evidenceDisplay = playerMap.route === 'milb'
                  ? playerMap.scores.evidence.display.replace('pillars', 'data areas')
                  : forecast?.confidenceState ?? 'Not available'

                return (
                  <tr key={player.id} className={selected ? 'is-selected' : ''}>
                    <td className="rank-cell">
                      <strong className="table-primary">
                        {displayedRank ? `#${displayedRank}` : '—'}
                      </strong>
                      <small>
                        {displayedRank ? rankScope : plainPlayerState(playerMap.state)}
                      </small>
                    </td>
                    <td>
                      <button
                        className="player-cell"
                        type="button"
                        onClick={() => onSelect(player.id)}
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span
                          className={`oracle-score-badge oracle-score-badge--${oracleScore.tone}`}
                          aria-label={`Oracle Score ${oracleScore.display}`}
                          title={oracleScore.explanation}
                        >
                          <strong>{oracleScore.display}</strong>
                          <small>SCORE</small>
                        </span>
                        <span>
                          <span className="mobile-player-rank">
                            {displayedRank ? `Stage #${displayedRank} ${rankScope}` : 'Score pending'}
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
                      <strong className="table-primary">
                        {mlbStage ? 'Hall-level career stats' : '5+ MLB WAR in 5 years'}
                      </strong>
                      <small>Stage rank, not a probability</small>
                    </td>
                    <td className="alpha-cell">
                      {alpha ? (
                        <>
                          <div className="alpha-cell-lead">
                            <strong className="alpha-edge-value">Standout</strong>
                            <span className={`alpha-tier alpha-tier--${alpha.tier}`}>
                              {plainPlayerState(playerMap.state)}
                            </span>
                          </div>
                          <small>Career outlook clears the early-career upside checks</small>
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
                              {plainPlayerState(playerMap.state)}
                            </span>
                          </div>
                          <small>
                            Five-year rank #{impact.rank.toLocaleString()} · {player.milbAlphaSignal?.eligible
                              ? `MLB arrival rank #${player.milbAlphaSignal.rank?.toLocaleString() ?? '—'}`
                              : 'MLB arrival not yet confirmed'}
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
                              {plainPlayerState(playerMap.state)}
                            </span>
                          </div>
                          <small>
                            {mlbStage
                              ? rawAlpha?.status === 'research'
                                ? 'Career outlook scored · no standout signal yet'
                                : alphaMissLabel(player)
                              : 'More data needed before an Oracle Score is assigned'}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {mlbStage ? (
                        <>
                          <strong className="table-primary">
                            {formatWar(forecast?.finalCareerWar?.p50 ?? null)}
                          </strong>
                          <small>Middle estimate · high case {formatWar(forecast?.finalCareerWar?.p90 ?? null)}</small>
                        </>
                      ) : (
                        <>
                          <strong className="table-primary">In development</strong>
                          <small>Direct minor-to-career model is not ready</small>
                        </>
                      )}
                    </td>
                    <td>
                      {mlbStage ? (
                        <>
                          <strong className="table-primary">{formatWar(forecast?.cumulativeWar ?? null)}</strong>
                          <small>cumulative WAR</small>
                        </>
                      ) : (
                        <>
                          <strong className="table-primary">{player.milbAlphaSignal?.rank ? `#${player.milbAlphaSignal.rank}` : 'Not confirmed'}</strong>
                          <small>
                            {player.milbAlphaSignal?.rank
                              ? 'MLB arrival signal rank'
                              : 'Model has not confirmed near-term MLB arrival'}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <strong className="table-primary confidence-value">{evidenceDisplay}</strong>
                      <small>{playerMap.route === 'milb' ? 'current stat coverage' : 'support behind the career outlook'}</small>
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
              : 'Adjust the search or player filters.'}
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
