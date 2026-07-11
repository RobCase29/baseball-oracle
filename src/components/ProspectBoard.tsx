import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Minus,
  Search,
  Star,
} from 'lucide-react'
import type { BoardFilters, PlayerForecast, PlayerType } from '../domain/forecast'
import { formatSigned, oracleScore, probabilityTone } from '../lib/forecast'

interface ProspectBoardProps {
  players: PlayerForecast[]
  selectedId: string | null
  filters: BoardFilters
  watchlist: Set<string>
  onSelect: (playerId: string) => void
  onToggleWatchlist: (playerId: string) => void
  onChangeFilters: (patch: Partial<BoardFilters>) => void
}

const playerTypes: Array<'All' | PlayerType> = ['All', 'Hitter', 'Pitcher']

function TrendIcon({ player }: { player: PlayerForecast }) {
  if (player.trend === 'up') return <ArrowUpRight size={14} aria-hidden="true" />
  if (player.trend === 'down') return <ArrowDownRight size={14} aria-hidden="true" />
  return <Minus size={14} aria-hidden="true" />
}

export function ProspectBoard({
  players,
  selectedId,
  filters,
  watchlist,
  onSelect,
  onToggleWatchlist,
  onChangeFilters,
}: ProspectBoardProps) {
  return (
    <section className="board-panel" aria-labelledby="board-title">
      <div className="board-heading">
        <div>
          <span className="eyebrow">RESEARCH UNIVERSE</span>
          <h2 id="board-title">Prospect board</h2>
        </div>
        <span className="record-count">{players.length} shown</span>
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
            value={filters.level}
            onChange={(event) => onChangeFilters({ level: event.target.value })}
          >
            <option>All</option>
            <option>MLB</option>
            <option>AAA</option>
            <option>AA</option>
            <option>A+</option>
            <option>A</option>
          </select>
        </label>

        <label className="select-field">
          <span>Rank by</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              onChangeFilters({ sort: event.target.value as BoardFilters['sort'] })
            }
          >
            <option value="oracle">Oracle score</option>
            <option value="arrival">MLB probability</option>
            <option value="ceiling">Career ceiling</option>
            <option value="momentum">Momentum</option>
          </select>
        </label>
      </div>

      <div className="board-table-wrap">
        <table className="board-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Age / level</th>
              <th scope="col">MLB</th>
              <th scope="col">Career WAR</th>
              <th scope="col">Score</th>
              <th scope="col"><span className="sr-only">Save</span></th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => {
              const saved = watchlist.has(player.id)
              const selected = player.id === selectedId

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
                          {player.organizationCode} · {player.position}
                        </small>
                      </span>
                      <ChevronRight className="row-chevron" size={16} aria-hidden="true" />
                    </button>
                  </td>
                  <td>
                    <strong className="table-primary">{player.age}</strong>
                    <small>{player.level}</small>
                  </td>
                  <td>
                    <span className={`probability-value tone-${probabilityTone(player.arrivalProbability)}`}>
                      {player.arrivalProbability}%
                    </span>
                    <small className={`trend trend--${player.trend}`}>
                      <TrendIcon player={player} />
                      {formatSigned(player.arrivalDelta)}
                    </small>
                  </td>
                  <td>
                    <strong className="table-primary">{player.expectedCareerWar.toFixed(1)}</strong>
                    <small>P50 · {player.ceilingWar.toFixed(0)} high</small>
                  </td>
                  <td>
                    <span className="oracle-score">{oracleScore(player)}</span>
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

      {players.length === 0 ? (
        <div className="empty-state">
          <Search size={22} aria-hidden="true" />
          <strong>No matching players</strong>
          <span>Adjust the search or cohort filters.</span>
        </div>
      ) : null}
    </section>
  )
}
