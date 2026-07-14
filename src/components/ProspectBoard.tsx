import { lazy, Suspense, useState } from 'react'
import {
  AlertTriangle,
  ChartScatter,
  ChevronLeft,
  ChevronRight,
  Database,
  FilterX,
  Info,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Table2,
} from 'lucide-react'
import type {
  BoardFilters,
  PlayerFacetOption,
  PlayerMapFeedItem,
  PlayerRecord,
  PlayersPage,
  PlayersResponseMeta,
  PlayerType,
  StageFilter,
} from '../domain/forecast'
import {
  formatPosition,
  stageLabel,
} from '../lib/forecast'
import {
  careerOutlookFor,
  currentResultsFor,
  playerMapFor,
  routeRankFor,
} from './playerMapView'

const MilbOpportunityMap = lazy(() =>
  import('./MilbOpportunityMap').then((module) => ({ default: module.MilbOpportunityMap })),
)

export type BoardDisplayMode = 'table' | 'landscape'

interface ProspectBoardProps {
  players: PlayerRecord[]
  selectedId: string | null
  filters: BoardFilters
  pagination: PlayersPage
  loading: boolean
  error: string | null
  facets?: {
    teams: PlayerFacetOption[]
    positions: PlayerFacetOption[]
  }
  searchRecovery?: PlayersResponseMeta['searchRecovery']
  displayMode?: BoardDisplayMode
  landscapeItems?: PlayerMapFeedItem[]
  landscapeTotal?: number
  landscapeLoading?: boolean
  landscapeError?: string | null
  openingPlayerId?: string | null
  selectionError?: string | null
  onSelect: (playerId: string) => void
  onChangeDisplayMode?: (mode: BoardDisplayMode) => void
  onChangeFilters: (patch: Partial<BoardFilters>) => void
  onChangePage: (page: number) => void
}

const stages: Array<{ value: StageFilter; label: string }> = [
  { value: 'All', label: 'Directory' },
  { value: 'Minors', label: 'Prospects' },
  { value: 'RC', label: 'Rookie Track' },
  { value: 'MLB', label: 'MLB' },
]
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

function boardHeading(filters: BoardFilters): { eyebrow: string; title: string } {
  if (filters.stage === 'Minors') {
    return { eyebrow: 'FIVE-YEAR IMPACT OUTLOOK', title: 'Prospect Rankings' }
  }
  if (filters.stage === 'RC') {
    return { eyebrow: 'PROSPECT OUTLOOK + MLB EVIDENCE', title: 'Rookie Track' }
  }
  if (filters.stage === 'MLB') {
    return { eyebrow: 'PROJECTED CAREER VALUE', title: 'MLB Career Rankings' }
  }
  return { eyebrow: 'SEARCH ACROSS CAREER STAGES', title: 'All Players' }
}

function rankColumnLabel(stage: StageFilter): string {
  if (stage === 'Minors') return 'Prospect Rank'
  if (stage === 'RC') return 'Pre-Debut Rank'
  if (stage === 'MLB') return 'MLB Career Rank'
  return 'Stage Rank'
}

function emptyStateCopy(stage: StageFilter): { title: string; detail: string } {
  if (stage === 'RC') {
    return {
      title: 'No matching Rookie Track players',
      detail: 'Adjust the search, team, position, or role filters.',
    }
  }
  if (stage === 'MLB') {
    return { title: 'No matching MLB players', detail: 'Adjust the search or player filters.' }
  }
  return { title: 'No matching players', detail: 'Adjust the search or player filters.' }
}

export function ProspectBoard({
  players,
  selectedId,
  filters,
  pagination,
  loading,
  error,
  facets,
  searchRecovery,
  displayMode: controlledDisplayMode,
  landscapeItems,
  landscapeTotal,
  landscapeLoading = false,
  landscapeError = null,
  openingPlayerId = null,
  selectionError = null,
  onSelect,
  onChangeDisplayMode,
  onChangeFilters,
  onChangePage,
}: ProspectBoardProps) {
  const [uncontrolledDisplayMode, setUncontrolledDisplayMode] = useState<BoardDisplayMode>('table')
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const hasPreviousPage = pagination.page > 1
  const hasNextPage = pagination.page < pagination.totalPages
  const activeFilterCount = [
    filters.query.trim() ? filters.query : null,
    filters.playerType !== 'All' ? filters.playerType : null,
    filters.level !== 'All' ? filters.level : null,
    filters.team && filters.team !== 'All' ? filters.team : null,
    filters.position && filters.position !== 'All' ? filters.position : null,
  ].filter(Boolean).length
  const teamOptions = withCurrentFacet(facets?.teams ?? [], filters.team)
  const positionOptions = withCurrentFacet(facets?.positions ?? [], filters.position)
  const heading = boardHeading(filters)
  const displayMode = controlledDisplayMode ?? uncontrolledDisplayMode
  const activeDisplayMode = filters.stage === 'Minors' ? displayMode : 'table'
  const noResults = emptyStateCopy(filters.stage)

  function changeDisplayMode(mode: BoardDisplayMode) {
    setUncontrolledDisplayMode(mode)
    onChangeDisplayMode?.(mode)
  }

  return (
    <section id="prospect-board" className="board-panel" aria-labelledby="board-title" aria-busy={loading || landscapeLoading}>
      <div className="board-heading">
        <div>
          <span className="eyebrow">{heading.eyebrow}</span>
          <h2 id="board-title">{heading.title}</h2>
        </div>
        <div className="board-heading-actions">
          <span className="record-count">
            {loading ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : null}
            {pagination.total.toLocaleString()} players
          </span>
          {filters.stage === 'Minors' ? (
            <div className="segmented-control board-view-control" aria-label="Prospect view">
              <button
                type="button"
                className={activeDisplayMode === 'table' ? 'is-active' : ''}
                aria-pressed={activeDisplayMode === 'table'}
                onClick={() => changeDisplayMode('table')}
              >
                <Table2 size={14} aria-hidden="true" />
                Table
              </button>
              <button
                type="button"
                className={activeDisplayMode === 'landscape' ? 'is-active' : ''}
                aria-pressed={activeDisplayMode === 'landscape'}
                onClick={() => changeDisplayMode('landscape')}
              >
                <ChartScatter size={14} aria-hidden="true" />
                Landscape
              </button>
            </div>
          ) : null}
        </div>
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
              key={stage.value}
              type="button"
              className={filters.stage === stage.value ? 'is-active' : ''}
              aria-pressed={filters.stage === stage.value}
              onClick={() => {
                const defaultSort = stage.value === 'All'
                  ? 'name' as const
                  : stage.value === 'Minors'
                    ? 'prospectScore' as const
                    : 'stageStanding' as const
                const sortIsUnavailable = (
                  stage.value === 'Minors' && (
                    filters.sort === 'nearTermImpact' || filters.sort === 'finalWar'
                  )
                ) || (
                  (stage.value === 'MLB' || stage.value === 'RC') && filters.sort === 'prospectScore'
                ) || (
                  stage.value === 'MLB' && filters.sort === 'arrival36'
                ) || (
                  stage.value === 'RC' && (
                    filters.sort === 'nearTermImpact' ||
                    filters.sort === 'finalWar' ||
                    filters.sort === 'arrival36'
                  )
                )
                onChangeFilters({
                  stage: stage.value,
                  ...(stage.value === 'All' || stage.value === 'MLB' || stage.value === 'RC' ? { level: 'All' } : {}),
                  ...(filters.stage !== stage.value || sortIsUnavailable ? { sort: defaultSort } : {}),
                })
              }}
            >
              {stage.label}
            </button>
          ))}
        </div>

        <button
          className={`mobile-filter-toggle${filtersExpanded ? ' is-open' : ''}`}
          type="button"
          onClick={() => setFiltersExpanded((current) => !current)}
          aria-expanded={filtersExpanded}
          aria-controls="advanced-player-filters"
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
        </button>

        <div
          id="advanced-player-filters"
          className={`filter-advanced${filtersExpanded ? ' is-open' : ''}`}
        >
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
            disabled={filters.stage === 'MLB' || filters.stage === 'RC'}
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
          <span>Sort by</span>
          <select
            aria-label="Sort by"
            value={filters.sort}
            onChange={(event) =>
              onChangeFilters({ sort: event.target.value as BoardFilters['sort'] })
            }
          >
            {filters.stage === 'All' ? (
              <>
                <option value="name">Player name</option>
                <option value="age">Youngest first</option>
              </>
            ) : (
              <>
                {filters.stage === 'Minors' ? (
                  <option value="prospectScore">Prospect Rank</option>
                ) : null}
                {filters.stage !== 'Minors' ? <option value="stageStanding">{rankColumnLabel(filters.stage)}</option> : null}
                <option value="careerIndex">Career Outlook</option>
                {filters.stage !== 'Minors' && filters.stage !== 'RC' ? (
                  <option value="nearTermImpact">Next 3-year upside</option>
                ) : null}
                {filters.stage !== 'Minors' && filters.stage !== 'RC' ? (
                  <option value="finalWar">Projected career WAR</option>
                ) : null}
                {filters.stage !== 'MLB' && filters.stage !== 'RC' ? (
                  <option value="arrival36">Projected MLB arrival</option>
                ) : null}
                <option value="age">Youngest first</option>
                <option value="name">Player name</option>
              </>
            )}
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
      </div>

      {filters.stage === 'All' ? (
        <div className="directory-notice" role="note">
          <Info size={15} aria-hidden="true" />
          <span><strong>Stage Ranks are not one combined leaderboard.</strong> Prospect Rank, Pre-Debut Rank, and MLB Career Rank each compare players with a different group.</span>
        </div>
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

      {selectionError ? (
        <div className="board-inline-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{selectionError}</span>
        </div>
      ) : null}

      {!loading && players.length === 0 && searchRecovery?.outsideFilterMatches.length ? (
        <div className="search-recovery" role="status">
          <Search size={18} aria-hidden="true" />
          <div>
            <strong>Found outside the current filters</strong>
            <span>Open the player directly without changing your board setup.</span>
          </div>
          <div className="search-recovery-results">
            {searchRecovery.outsideFilterMatches.map((match) => (
              <button key={match.id} type="button" onClick={() => onSelect(match.id)}>
                <span>{match.name}</span>
                <small>{match.organizationCode ?? match.organization ?? 'Team unavailable'} · {stageLabel(match.stage)}</small>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {players.length > 0 && activeDisplayMode === 'landscape' && landscapeLoading && !landscapeItems?.length ? (
        <div className="opportunity-map opportunity-map-loading" role="status">
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          <span>Building the filtered prospect landscape</span>
        </div>
      ) : null}

      {players.length > 0 && activeDisplayMode === 'landscape' && (!landscapeLoading || Boolean(landscapeItems?.length)) ? (
        <Suspense fallback={<div className="opportunity-map opportunity-map-loading">Loading ceiling landscape</div>}>
          <MilbOpportunityMap
            players={players}
            feedItems={landscapeItems?.length ? landscapeItems : undefined}
            totalCount={landscapeItems?.length ? landscapeTotal : pagination.total}
            selectedId={selectedId}
            openingPlayerId={openingPlayerId}
            loadError={landscapeError}
            onSelect={onSelect}
          />
        </Suspense>
      ) : null}

      {players.length > 0 && activeDisplayMode === 'table' ? (
        <div className="board-table-wrap">
          <table className="board-table oracle-board-table">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">{rankColumnLabel(filters.stage)}</th>
                <th scope="col">Career Outlook</th>
                <th scope="col">Current Results</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const selected = player.id === selectedId
                const organization =
                  player.organizationCode ?? player.organization ?? 'Organization unavailable'
                const playerMap = playerMapFor(player)
                const routeRank = routeRankFor(player, playerMap)
                const careerOutlook = careerOutlookFor(player, playerMap)
                const currentResults = currentResultsFor(player, playerMap)

                return (
                  <tr key={player.id} className={selected ? 'is-selected' : ''}>
                    <td>
                      <button
                        className="player-cell"
                        type="button"
                        onClick={() => onSelect(player.id)}
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span>
                          <strong className="player-name">{player.name}</strong>
                          <small>
                            {organization} · {formatPosition(player.position, player.playerType)} · Age {player.age ?? '—'} · {player.level ?? stageLabel(player.stage)}
                          </small>
                          <span className={`stage-badge stage-badge--${player.stage}`}>
                            {stageLabel(player.stage)}
                          </span>
                        </span>
                        <ChevronRight className="row-chevron" size={16} aria-hidden="true" />
                      </button>
                    </td>
                    <td className="rank-summary-cell">
                      <span className="mobile-column-label">{routeRank.label}</span>
                      <strong
                        className={`table-primary rank-summary rank-summary--${routeRank.tone}`}
                        title={routeRank.explanation}
                      >
                        {routeRank.display}
                      </strong>
                      <small>
                        {filters.stage === 'All' ? `${routeRank.label} · ` : ''}{routeRank.tableDetail}
                      </small>
                    </td>
                    <td className="outlook-cell">
                      <span className="mobile-column-label">Career Outlook</span>
                      <strong
                        className={`table-primary outlook-value outlook-value--${careerOutlook.tone}`}
                        title={careerOutlook.explanation}
                      >
                        {careerOutlook.band}
                      </strong>
                      <small>{careerOutlook.display} · {careerOutlook.basis}</small>
                    </td>
                    <td className="current-results-cell">
                      <span className="mobile-column-label">Current Results</span>
                      <strong className={`table-primary current-results current-results--${currentResults.tone}`}>
                        {currentResults.headline}
                      </strong>
                      <small>{currentResults.detail}</small>
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
          <strong>{noResults.title}</strong>
          <span>{noResults.detail}</span>
        </div>
      ) : null}

      {activeDisplayMode === 'table' && pagination.totalPages > 1 ? (
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
