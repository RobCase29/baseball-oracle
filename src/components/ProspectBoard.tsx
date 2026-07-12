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
} from '../domain/forecast'
import { formatOrdinal, formatScore, probabilityTone } from '../lib/forecast'

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

const playerTypes: Array<'All' | PlayerType> = ['All', 'Hitter', 'Pitcher']

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
          <span className="eyebrow">RESEARCH UNIVERSE</span>
          <h2 id="board-title">Prospect board</h2>
        </div>
        <span className="record-count">
          {loading ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : null}
          {pagination.total.toLocaleString()} profiles
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

        <div className="segmented-control" aria-label="Player type">
          {playerTypes.map((type) => (
            <button
              key={type}
              type="button"
              className={filters.playerType === type ? 'is-active' : ''}
              onClick={() => onChangeFilters({ playerType: type })}
            >
              {type === 'All' ? 'All' : `${type}s`}
            </button>
          ))}
        </div>

        <label className="select-field">
          <span>Level</span>
          <select
            aria-label="Level"
            value={filters.level}
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

        <label className="select-field">
          <span>Rank by</span>
          <select
            aria-label="Rank by"
            value={filters.sort}
            onChange={(event) =>
              onChangeFilters({ sort: event.target.value as BoardFilters['sort'] })
            }
          >
            <option value="arrival36">Research P(MLB) · 36m</option>
            <option value="psScore">PS Score</option>
            <option value="psPercentile">PS percentile</option>
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
          <strong>Loading real player profiles</strong>
          <span>Reading the current Prospect Savant snapshot.</span>
        </div>
      ) : null}

      {players.length > 0 ? (
        <div className="board-table-wrap">
          <table className="board-table">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Age / level</th>
                <th scope="col">PS Score</th>
                <th scope="col">Research P36</th>
                <th scope="col">Percentile</th>
                <th scope="col">Opportunity</th>
                <th scope="col"><span className="sr-only">Save</span></th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const saved = watchlist.has(player.id)
                const selected = player.id === selectedId
                const organization =
                  player.organizationCode ?? player.organization ?? 'Organization unavailable'
                const research36 = player.researchEstimate?.horizons.find(
                  (horizon) => horizon.months === 36,
                )?.probability

                return (
                  <tr key={player.id} className={selected ? 'is-selected' : ''}>
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
                        </span>
                        <ChevronRight className="row-chevron" size={16} aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <strong className="table-primary">{player.age ?? '—'}</strong>
                      <small>{player.level}</small>
                    </td>
                    <td>
                      <strong className="table-primary">{formatScore(player.psScore)}</strong>
                      <small>source metric</small>
                    </td>
                    <td>
                      {research36 === undefined ? (
                        <strong className="table-primary">—</strong>
                      ) : (
                        <span className={`probability-value tone-${probabilityTone(research36 * 100)}`}>
                          {(research36 * 100).toFixed(1)}%
                        </span>
                      )}
                      <small>{research36 === undefined ? 'no exact match' : 'frozen 2025'}</small>
                    </td>
                    <td>
                      {player.psPercentile === null ? (
                        <strong className="table-primary">—</strong>
                      ) : (
                        <span className={`probability-value tone-${probabilityTone(player.psPercentile)}`}>
                          {formatOrdinal(player.psPercentile)}
                        </span>
                      )}
                      <small>PS cohort</small>
                    </td>
                    <td>
                      <strong className="table-primary">{player.opportunity?.value ?? '—'}</strong>
                      <small>{player.opportunity?.label ?? 'not reported'}</small>
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
          <strong>{pagination.total === 0 ? 'No matching players' : 'No profiles on this page'}</strong>
          <span>
            {pagination.total === 0
              ? 'Adjust the search or cohort filters.'
              : 'Move to another results page.'}
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
