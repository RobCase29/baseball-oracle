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
  careerWarForPlayer,
  developmentChapterLabel,
  formatWar,
  isMlbStage,
  stageLabel,
} from '../lib/forecast'
import { careerIndexFor, playerMapFor, prospectScoreFor } from './playerMapView'
import { currentMinorEvidence, currentMinorSignal } from './currentMinorView'
import {
  formatRookieWar,
  formatRookieWarPercentile,
  rookieMlbReadLabel,
  rookieEvidenceLabel,
} from './rookieTrackView'

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
                  ...(stage.value === 'All'
                    ? { sort: 'name' as const }
                    : stage.value === 'Minors' && filters.stage !== 'Minors'
                      ? { sort: 'prospectScore' as const }
                      : filters.stage === 'All'
                      ? { sort: stage.value === 'Minors' ? 'prospectScore' as const : 'careerIndex' as const }
                      : sortIsUnavailable
                        ? { sort: stage.value === 'Minors' ? 'prospectScore' as const : 'careerIndex' as const }
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
                {filters.stage === 'Minors' ? (
                  <option value="prospectScore">Prospect Score</option>
                ) : null}
                <option value="careerIndex">{filters.stage === 'MLB' ? 'Career Index' : 'Ceiling if MLB'}</option>
                <option value="stageStanding">{filters.stage === 'MLB' ? 'MLB outlook rank' : 'Long-term potential rank'}</option>
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
                <th scope="col">{filters.stage === 'Minors' ? 'Player / Prospect Score' : 'Player / Career Index'}</th>
                <th scope="col">{filters.stage === 'Minors' ? 'Impact rank' : 'Stage standing'}</th>
                <th scope="col">{filters.stage === 'Minors' ? 'Ceiling if MLB' : 'Career projection'}</th>
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
                const handling = playerMap.handling?.primary ?? null
                const careerIndex = careerIndexFor(player, playerMap)
                const prospectScore = filters.stage === 'Minors' && playerMap.route === 'milb'
                  ? prospectScoreFor(player, playerMap)
                  : null
                const primaryScore = prospectScore ?? careerIndex
                const primaryScoreLabel = prospectScore?.label ?? (
                  filters.stage === 'All' ? 'Career Index' : careerIndex.label
                )
                const isRookieTrack = player.stage === 'recent_callup' && player.recentCallup !== null
                const rawProspectPrior = player.recentCallup?.prospectPrior ?? null
                const prospectPrior = rawProspectPrior?.forecast.publicationState === 'withheld'
                  ? null
                  : rawProspectPrior
                const hasProspectPrior = prospectPrior !== null
                const mlbStage = isMlbStage(player.stage) && !isRookieTrack
                const chapter = forecast?.careerChapter
                const chapterLabel = handling?.label ?? (mlbStage
                  ? (chapter?.status === 'research'
                    ? chapter.label
                    : 'MLB career in progress')
                  : isRookieTrack
                    ? 'Rookie Track'
                    : developmentChapterLabel(player.level))
                const careerWar = careerWarForPlayer(player)
                const careerMiddleCase = careerWar?.p50 ?? null
                const careerHighCase = careerWar?.p90 ?? null
                const liveMinorSignal = playerMap.route === 'milb'
                  ? currentMinorSignal(player)
                  : null
                const liveMinorEvidence = playerMap.route === 'milb'
                  ? currentMinorEvidence(player)
                  : null
                const evidenceDisplay = isRookieTrack
                  ? rookieEvidenceLabel(player)
                  : playerMap.route === 'milb'
                    ? liveMinorEvidence?.label ?? playerMap.scores.evidence.display.replace('pillars', 'data areas')
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
                          className={`career-index-badge career-index-badge--${primaryScore.tone}`}
                          aria-label={`${primaryScoreLabel} ${primaryScore.display}`}
                          title={primaryScore.explanation}
                        >
                          <strong>{primaryScore.display}</strong>
                          <small>{prospectScore ? 'SCORE' : 'INDEX'}</small>
                        </span>
                        <span>
                          <strong className="player-name">{player.name}</strong>
                          <small>
                            {organization} · {player.position ?? player.playerType} · Age {player.age ?? '—'} · {player.level ?? stageLabel(player.stage)}
                          </small>
                          <span className={`stage-badge stage-badge--${player.stage}`}>
                            {stageLabel(player.stage)}
                          </span>
                          {handling ? <span className="handling-badge">{handling.label}</span> : null}
                        </span>
                        <ChevronRight className="row-chevron" size={16} aria-hidden="true" />
                      </button>
                    </td>
                    <td className="rank-cell">
                      <strong className="table-primary">
                        {(prospectScore ? prospectScore.rank : careerIndex.rank)
                          ? `#${(prospectScore ? prospectScore.rank : careerIndex.rank)?.toLocaleString()}`
                          : '—'}
                      </strong>
                      <small>
                        {prospectScore?.rank && prospectScore.universe
                          ? `of ${prospectScore.universe.toLocaleString()} prospects · five-year impact`
                          : prospectScore
                            ? 'Prospect rank unavailable or withheld'
                          : careerIndex.topLabel && careerIndex.universe
                          ? `${careerIndex.topLabel} of ${careerIndex.universe.toLocaleString()} ${careerIndex.cohortLabel}`
                          : isRookieTrack && !hasProspectPrior
                            ? 'Prospect prior not matched'
                            : chapterLabel}
                      </small>
                      <small className="mobile-standing-evidence">Evidence · {evidenceDisplay}</small>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {prospectScore
                          ? careerIndex.display
                          : careerMiddleCase === null && handling ? 'Not scored' : formatWar(careerMiddleCase)}
                      </strong>
                      <small>
                        {prospectScore
                          ? careerIndex.value === null
                            ? 'Career ceiling not yet mapped'
                            : `Conditional career index · middle ${formatWar(careerMiddleCase)} · high ${formatWar(careerHighCase)} · arrival age ${forecast?.decomposition.estimatedDebutAge ?? '—'}`
                          : handling && careerMiddleCase === null
                          ? handling.summary
                          : isRookieTrack && !hasProspectPrior
                          ? 'Career projection available after the prospect prior is matched'
                          : `${mlbStage ? 'Middle career WAR' : 'If MLB: middle career WAR'} · high case ${formatWar(careerHighCase)}${!mlbStage && !isRookieTrack ? ` · arrival age ${forecast?.decomposition.estimatedDebutAge ?? '—'}` : ''}`}
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
                          <strong className={`table-primary${liveMinorSignal ? ' signal-positive' : ''}`}>
                            {liveMinorSignal?.label ?? (player.milbAlphaSignal?.rank ? `Arrival rank #${player.milbAlphaSignal.rank}` : 'Not confirmed')}
                          </strong>
                          <small>{liveMinorSignal?.detail ?? playerMap.stateLabel}</small>
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
                            ? liveMinorEvidence?.detail ?? 'current stat coverage'
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
