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
  PlayerRecord,
  PlayersPage,
  PlayerType,
  StageFilter,
} from '../domain/forecast'
import {
  developmentChapterLabel,
  formatWar,
  isMlbStage,
  stageLabel,
} from '../lib/forecast'
import { careerIndexFor, playerMapFor } from './playerMapView'
import {
  formatRookieWar,
  formatRookieWarPercentile,
  rookieMlbReadLabel,
  rookieEvidenceLabel,
} from './rookieTrackView'

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
  facets?: {
    teams: PlayerFacetOption[]
    positions: PlayerFacetOption[]
  }
  onSelect: (playerId: string) => void
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
    return { eyebrow: 'PROJECTED CAREER VALUE', title: 'Prospect Rankings' }
  }
  if (filters.stage === 'RC') {
    return { eyebrow: 'PROSPECT OUTLOOK + MLB EVIDENCE', title: 'Rookie Track' }
  }
  if (filters.stage === 'MLB') {
    return { eyebrow: 'PROJECTED CAREER VALUE', title: 'MLB Rankings' }
  }
  return { eyebrow: 'SEARCH ACROSS CAREER STAGES', title: 'All Players' }
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
  onSelect,
  onChangeFilters,
  onChangePage,
}: ProspectBoardProps) {
  const [displayMode, setDisplayMode] = useState<'table' | 'landscape'>('table')
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
  const activeDisplayMode = filters.stage === 'Minors' ? displayMode : 'table'
  const noResults = emptyStateCopy(filters.stage)

  return (
    <section id="prospect-board" className="board-panel" aria-labelledby="board-title" aria-busy={loading}>
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
                onClick={() => setDisplayMode('table')}
              >
                <Table2 size={14} aria-hidden="true" />
                Table
              </button>
              <button
                type="button"
                className={activeDisplayMode === 'landscape' ? 'is-active' : ''}
                aria-pressed={activeDisplayMode === 'landscape'}
                onClick={() => setDisplayMode('landscape')}
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
                const sortIsUnavailable = (
                  stage.value === 'Minors' && (
                    filters.sort === 'nearTermImpact' || filters.sort === 'finalWar'
                  )
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
                  ...(stage.value === 'All'
                    ? { sort: 'name' as const }
                    : filters.stage === 'All'
                      ? { sort: 'careerIndex' as const }
                      : sortIsUnavailable
                        ? { sort: 'careerIndex' as const }
                        : {}),
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
          <span>Rank by</span>
          <select
            aria-label="Rank by"
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
                <option value="careerIndex">Career Index</option>
                <option value="alphaOpportunity">Stage standing</option>
                {filters.stage !== 'Minors' && filters.stage !== 'RC' ? (
                  <option value="nearTermImpact">Next 3-year upside</option>
                ) : null}
                {filters.stage !== 'Minors' && filters.stage !== 'RC' ? (
                  <option value="finalWar">Projected career WAR</option>
                ) : null}
                {filters.stage !== 'MLB' && filters.stage !== 'RC' ? (
                  <option value="arrival36">MLB arrival research rank</option>
                ) : null}
                <option value="age">Youngest first</option>
                <option value="name">Name</option>
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
          <span><strong>Directory, not a combined leaderboard.</strong> Career Index uses one fixed career-value scale, while each rank compares players only within Prospects, Rookie Track, or MLB.</span>
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

      {players.length > 0 && activeDisplayMode === 'landscape' ? (
        <Suspense fallback={<div className="opportunity-map opportunity-map-loading">Loading ceiling landscape</div>}>
          <MilbOpportunityMap
            players={players}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </Suspense>
      ) : null}

      {players.length > 0 && activeDisplayMode === 'table' ? (
        <div className="board-table-wrap">
          <table className="board-table oracle-board-table">
            <thead>
              <tr>
                <th scope="col">Player / Career Index</th>
                <th scope="col">Stage standing</th>
                <th scope="col">Career projection</th>
                <th scope="col">Current signal</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const selected = player.id === selectedId
                const organization =
                  player.organizationCode ?? player.organization ?? 'Organization unavailable'
                const forecast = player.careerForecast
                const playerMap = playerMapFor(player)
                const careerIndex = careerIndexFor(player, playerMap)
                const isRookieTrack = player.stage === 'recent_callup' && player.recentCallup !== null
                const rawProspectPrior = player.recentCallup?.prospectPrior ?? null
                const prospectPrior = rawProspectPrior?.forecast.publicationState === 'withheld'
                  ? null
                  : rawProspectPrior
                const hasProspectPrior = prospectPrior !== null
                const mlbStage = isMlbStage(player.stage) && !isRookieTrack
                const chapter = forecast?.careerChapter
                const chapterLabel = mlbStage
                  ? chapter?.status === 'research'
                    ? chapter.label
                    : 'MLB career in progress'
                  : isRookieTrack
                    ? 'Rookie Track'
                    : developmentChapterLabel(player.level)
                const prospectForecast = prospectPrior?.forecast ?? null
                const careerMiddleCase = isRookieTrack
                  ? prospectForecast?.finalCareerWar?.p50 ?? null
                  : forecast?.finalCareerWar?.p50 ?? null
                const careerHighCase = isRookieTrack
                  ? prospectForecast?.finalCareerWar?.p90 ?? null
                  : forecast?.finalCareerWar?.p90 ?? null
                const evidenceDisplay = isRookieTrack
                  ? rookieEvidenceLabel(player)
                  : playerMap.route === 'milb'
                    ? playerMap.scores.evidence.display.replace('pillars', 'data areas')
                    : forecast?.confidenceState ?? 'Not available'

                return (
                  <tr key={player.id} className={selected ? 'is-selected' : ''}>
                    <td>
                      <button
                        className="player-cell"
                        type="button"
                        onClick={() => onSelect(player.id)}
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span
                          className={`career-index-badge career-index-badge--${careerIndex.tone}`}
                          aria-label={`Career Index ${careerIndex.display}`}
                          title={careerIndex.explanation}
                        >
                          <strong>{careerIndex.display}</strong>
                          <small>INDEX</small>
                        </span>
                        <span>
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
                    <td className="rank-cell">
                      <strong className="table-primary">
                        {careerIndex.rank ? `#${careerIndex.rank.toLocaleString()}` : '—'}
                      </strong>
                      <small>
                        {careerIndex.topLabel && careerIndex.universe
                          ? `${careerIndex.topLabel} of ${careerIndex.universe.toLocaleString()} ${careerIndex.cohortLabel}`
                          : isRookieTrack && !hasProspectPrior
                            ? 'Prospect prior not matched'
                            : chapterLabel}
                      </small>
                      <small className="mobile-standing-evidence">Evidence · {evidenceDisplay}</small>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {formatWar(careerMiddleCase)}
                      </strong>
                      <small>
                        {isRookieTrack && !hasProspectPrior
                          ? 'Career projection available after the prospect prior is matched'
                          : `Middle career WAR · high case ${formatWar(careerHighCase)}${!mlbStage && !isRookieTrack ? ` · arrival age ${forecast?.decomposition.estimatedDebutAge ?? '—'}` : ''}`}
                      </small>
                    </td>
                    <td className="signal-cell">
                      {isRookieTrack ? (
                        <>
                          <strong className="table-primary signal-positive">{rookieMlbReadLabel(player)}</strong>
                          <small>
                            {formatRookieWar(player)} · {formatRookieWarPercentile(player)}
                            {player.recentCallup?.currentMlbEvidence.opportunity
                              ? ` · ${player.recentCallup.currentMlbEvidence.opportunity.value} ${player.recentCallup.currentMlbEvidence.opportunity.label}`
                              : ''}
                          </small>
                        </>
                      ) : mlbStage ? (
                        <>
                          <strong className="table-primary">{chapterLabel}</strong>
                          <small>{formatWar(forecast?.cumulativeWar ?? null)} career WAR to date</small>
                        </>
                      ) : (
                        <>
                          <strong className="table-primary">
                            {player.milbAlphaSignal?.rank ? `Arrival rank #${player.milbAlphaSignal.rank}` : 'Not confirmed'}
                          </strong>
                          <small>{playerMap.stateLabel}</small>
                        </>
                      )}
                    </td>
                    <td>
                      <strong className="table-primary confidence-value">{evidenceDisplay}</strong>
                      <small>
                        {isRookieTrack
                          ? player.recentCallup?.currentMlbEvidence.opportunity
                            ? `${player.recentCallup.currentMlbEvidence.opportunity.value} ${player.recentCallup.currentMlbEvidence.opportunity.label} of MLB evidence`
                            : 'Awaiting MLB opportunity data'
                          : playerMap.route === 'milb'
                            ? 'current stat coverage'
                            : 'support behind the career outlook'}
                      </small>
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
