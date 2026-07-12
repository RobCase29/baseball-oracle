import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  LoaderCircle,
  Search,
  Star,
} from 'lucide-react'
import type {
  BoardFilters,
  PlayerRecord,
  PlayersPage,
  PlayerType,
  StageFilter,
} from '../domain/forecast'
import {
  arrivalProbability36,
  formatPercentileRank,
  formatProbability,
  formatWar,
  isMlbStage,
  probabilityTone,
  stageLabel,
} from '../lib/forecast'

interface ProspectBoardProps {
  players: PlayerRecord[]
  selectedId: string | null
  filters: BoardFilters
  pagination: PlayersPage
  loading: boolean
  error: string | null
  watchlist: Set<string>
  onSelect: (playerId: string) => void
  onToggleWatchlist: (playerId: string) => void
  onChangeFilters: (patch: Partial<BoardFilters>) => void
  onChangePage: (page: number) => void
}

const stages: StageFilter[] = ['All', 'Minors', 'MLB']
const playerTypes: Array<'All' | PlayerType> = ['All', 'Hitter', 'Pitcher', 'Two-way']

function confidenceLabel(player: PlayerRecord): string {
  return player.careerForecast?.confidenceState ?? 'Withheld'
}

export function ProspectBoard({
  players,
  selectedId,
  filters,
  pagination,
  loading,
  error,
  watchlist,
  onSelect,
  onToggleWatchlist,
  onChangeFilters,
  onChangePage,
}: ProspectBoardProps) {
  const hasPreviousPage = pagination.page > 1
  const hasNextPage = pagination.page < pagination.totalPages

  return (
    <section id="prospect-board" className="board-panel" aria-labelledby="board-title" aria-busy={loading}>
      <div className="board-heading">
        <div>
          <span className="eyebrow">STAGE-SPECIFIC RESEARCH RANK</span>
          <h2 id="board-title">Oracle Board</h2>
        </div>
        <span className="record-count">
          {loading ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : null}
          {pagination.total.toLocaleString()} players
        </span>
      </div>

      <div className="board-filters">
        <label className="search-field">
          <span className="sr-only">Search players</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onChangeFilters({ query: event.target.value })}
            placeholder="Search player, org, position"
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
            <option value="hofProbability">P(HOF caliber)</option>
            <option value="peerSignal">Peer signal</option>
            <option value="finalWar">Final WAR P50</option>
            <option value="arrival36">P(MLB) · 36m</option>
            <option value="age">Age</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

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
                <th scope="col">Peer signal</th>
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
                const arrival36 = arrivalProbability36(player)
                const mlbStage = isMlbStage(player.stage)
                const relativeSignal = forecast?.relativeSignal
                const currentPeer = relativeSignal?.status === 'research'
                  ? relativeSignal.currentPeer
                  : null

                return (
                  <tr key={player.id} className={selected ? 'is-selected' : ''}>
                    <td className="rank-cell">
                      <strong className="table-primary">
                        {forecast?.rank ? `#${forecast.rank}` : '—'}
                      </strong>
                      <small>
                        {forecast?.rank
                          ? mlbStage ? 'MLB' : 'minors'
                          : forecast?.hofCaliberProbability != null
                            ? 'unavailable'
                            : 'withheld'}
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
                          <strong>{player.name}</strong>
                          <small>
                            {organization} · {player.position ?? player.playerType}
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
                      <small>{player.level ?? stageLabel(player.stage)}</small>
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
                    <td className="peer-signal-cell">
                      {currentPeer === null ? (
                        <strong className="table-primary">—</strong>
                      ) : (
                        <strong
                          className="table-primary peer-signal-value"
                          aria-label={`${currentPeer.percentile.toFixed(1)} percentile, rank ${currentPeer.rank} of ${currentPeer.cohortSize} in ${currentPeer.cohort.label}`}
                          title={currentPeer.cohort.label}
                        >
                          {formatPercentileRank(currentPeer.percentile)}
                        </strong>
                      )}
                      <small>
                        {currentPeer === null
                          ? relativeSignal?.status === 'withheld' ? 'comparison withheld' : 'not available'
                          : relativeSignal?.kind === 'arrival_track'
                            ? `#${currentPeer.rank} of ${currentPeer.cohortSize} · arrival peers · descriptive`
                            : `#${currentPeer.rank} of ${currentPeer.cohortSize} · current census · descriptive`}
                      </small>
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
                          <strong className="table-primary">{formatProbability(arrival36)}</strong>
                          <small>P(MLB) within 36m</small>
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
