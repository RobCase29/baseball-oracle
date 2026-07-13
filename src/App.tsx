import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CircleDot,
  DatabaseZap,
  History,
  LoaderCircle,
} from 'lucide-react'
import './App.css'
import { AppSidebar, type WorkspaceView } from './components/AppSidebar'
import { DataHealth } from './components/DataHealth'
import { ModelLab } from './components/ModelLab'
import { PlayerDossier } from './components/PlayerDossier'
import { ProspectBoard } from './components/ProspectBoard'
import type {
  BoardFilters,
  PlayerRecord,
  PlayersPage,
  PlayersResponse,
  PlayersResponseMeta,
} from './domain/forecast'
import {
  filterAndSortPlayers,
  stageCoverageForPlayers,
} from './lib/forecast'
import {
  LEGACY_WATCHLIST_STORAGE_KEY,
  loadStoredWatchlist,
  mergeRefreshedWatchlist,
  serializeWatchlist,
  WATCHLIST_STORAGE_KEY,
  watchlistIdBatches,
} from './lib/watchlist'

const PAGE_SIZE = 50

const ValidationDashboard = lazy(() =>
  import('./components/ValidationDashboard').then((module) => ({
    default: module.ValidationDashboard,
  })),
)

const defaultFilters: BoardFilters = {
  query: '',
  stage: 'Minors',
  playerType: 'All',
  level: 'All',
  team: 'All',
  position: 'All',
  sort: 'alphaOpportunity',
}

function filtersFromUrl(): BoardFilters {
  const parameters = new URLSearchParams(window.location.search)
  const stage = parameters.get('stage')
  const playerType = parameters.get('playerType')
  const level = parameters.get('level')
  const sort = parameters.get('sort')
  const resolvedStage: BoardFilters['stage'] = stage === 'All' || stage === 'Minors' || stage === 'MLB'
    ? stage
    : defaultFilters.stage
  const resolvedLevel: BoardFilters['level'] = level === 'AAA' || level === 'AA' || level === 'A+' || level === 'A' || level === 'Rk'
    ? level
    : defaultFilters.level
  const validSorts = new Set<BoardFilters['sort']>([
    'alphaOpportunity',
    'nearTermImpact',
    'finalWar',
    'arrival36',
    'age',
    'name',
  ])
  const resolvedSort = sort && validSorts.has(sort as BoardFilters['sort'])
    ? sort as BoardFilters['sort']
    : defaultFilters.sort
  const stageSort = (resolvedStage === 'Minors' && (
    resolvedSort === 'nearTermImpact' || resolvedSort === 'finalWar'
  )) || (resolvedStage === 'MLB' && resolvedSort === 'arrival36')
    ? defaultFilters.sort
    : resolvedSort

  return {
    query: parameters.get('q') ?? defaultFilters.query,
    stage: resolvedStage,
    playerType: playerType === 'Hitter' || playerType === 'Pitcher' || playerType === 'Two-way'
      ? playerType
      : defaultFilters.playerType,
    level: resolvedStage === 'MLB' ? 'All' : resolvedLevel,
    team: parameters.get('team') ?? defaultFilters.team,
    position: parameters.get('position') ?? defaultFilters.position,
    sort: stageSort,
  }
}

function pageFromUrl(): number {
  const value = Number.parseInt(new URLSearchParams(window.location.search).get('page') ?? '', 10)
  return Number.isInteger(value) && value > 0 ? value : 1
}

const emptyPage: PlayersPage = {
  page: 1,
  limit: PAGE_SIZE,
  total: 0,
  totalPages: 0,
}

const emptyMeta: PlayersResponseMeta = {
  dataAsOf: null,
  season: null,
  coverage: 'Professional player universe awaiting Career Oracle preview',
  forecastStatus: 'research_only',
  source: 'Baseball Oracle research',
}

function loadWatchlist(): Map<string, PlayerRecord> {
  return loadStoredWatchlist(
    window.localStorage.getItem(WATCHLIST_STORAGE_KEY),
    window.localStorage.getItem(LEGACY_WATCHLIST_STORAGE_KEY),
  )
}

function formatDataDate(value: string | null): string {
  if (!value) return 'Awaiting source snapshot'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

function isPlayersResponse(value: unknown): value is PlayersResponse {
  if (typeof value !== 'object' || value === null) return false
  return (
    'schemaVersion' in value &&
    value.schemaVersion === 'players.v1' &&
    'items' in value &&
    Array.isArray(value.items) &&
    'page' in value &&
    typeof value.page === 'object' &&
    value.page !== null &&
    'meta' in value &&
    typeof value.meta === 'object' &&
    value.meta !== null
  )
}

function normalizePlayerRecord(player: PlayerRecord): PlayerRecord {
  const validStages = new Set(['pre_debut', 'early_mlb', 'established_mlb', 'inactive'])
  return {
    ...player,
    // players.v1 predates the unified artifact and contains only minor-league records.
    stage: validStages.has(player.stage) ? player.stage : 'pre_debut',
    careerForecast: player.careerForecast ?? null,
  }
}

function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('Board')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(filtersFromUrl)
  const [page, setPage] = useState(pageFromUrl)
  const [players, setPlayers] = useState<PlayerRecord[]>([])
  const [pagination, setPagination] = useState<PlayersPage>(emptyPage)
  const [meta, setMeta] = useState<PlayersResponseMeta>(emptyMeta)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [watchlist, setWatchlist] = useState<Map<string, PlayerRecord>>(loadWatchlist)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(filters.query)
  const isWatchlistView = activeView === 'Watchlist'
  const watchlistIdsKey = useMemo(
    () => Array.from(watchlist.keys()).toSorted().join('\n'),
    [watchlist],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WATCHLIST_STORAGE_KEY,
        serializeWatchlist(watchlist.values()),
      )
      window.localStorage.removeItem(LEGACY_WATCHLIST_STORAGE_KEY)
    } catch {
      // The in-memory watchlist remains usable if browser storage is unavailable.
    }
  }, [watchlist])

  useEffect(() => {
    if (!watchlistIdsKey) return
    const controller = new AbortController()
    const batches = watchlistIdBatches(watchlistIdsKey.split('\n'))

    void Promise.allSettled(batches.map(async (ids) => {
      const parameters = new URLSearchParams({
        ids: ids.join(','),
        page: '1',
        limit: ids.length.toString(),
        sort: 'name',
        stage: 'All',
      })
      const response = await fetch(`/api/players?${parameters.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Player endpoint returned ${response.status}.`)
      const result = (await response.json()) as unknown
      if (!isPlayersResponse(result)) {
        throw new Error('Player endpoint returned an unexpected response.')
      }
      return result.items.map(normalizePlayerRecord)
    })).then((results) => {
      if (controller.signal.aborted) return
      const refreshed = results.flatMap((result) => (
        result.status === 'fulfilled' ? result.value : []
      ))
      if (refreshed.length === 0) return
      setWatchlist((current) => mergeRefreshedWatchlist(current, refreshed))
    })

    return () => controller.abort()
  }, [isWatchlistView, watchlistIdsKey])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      sort: filters.sort,
    })
    const query = deferredQuery.trim()
    if (query) parameters.set('q', query)
    if (filters.stage !== 'All') parameters.set('stage', filters.stage)
    if (filters.playerType !== 'All') parameters.set('playerType', filters.playerType)
    if (filters.level !== 'All') parameters.set('level', filters.level)
    if (filters.team && filters.team !== 'All') parameters.set('team', filters.team)
    if (filters.position && filters.position !== 'All') parameters.set('position', filters.position)

    setLoading(true)
    setError(null)

    fetch(`/api/players?${parameters.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Player endpoint returned ${response.status}.`)
        const result = (await response.json()) as unknown
        if (!isPlayersResponse(result)) throw new Error('Player endpoint returned an unexpected response.')
        setPlayers(result.items.map(normalizePlayerRecord))
        setPagination(result.page)
        setMeta(result.meta)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setPlayers([])
        setPagination((current) => ({ ...current, page, total: 0, totalPages: 0 }))
        setError(requestError instanceof Error ? requestError.message : 'Unable to load player data.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [
    deferredQuery,
    filters.level,
    filters.playerType,
    filters.position,
    filters.sort,
    filters.stage,
    filters.team,
    page,
  ])

  useEffect(() => {
    const parameters = new URLSearchParams()
    if (filters.query.trim()) parameters.set('q', filters.query.trim())
    if (filters.stage !== defaultFilters.stage) parameters.set('stage', filters.stage)
    if (filters.playerType !== 'All') parameters.set('playerType', filters.playerType)
    if (filters.level !== 'All') parameters.set('level', filters.level)
    if (filters.team && filters.team !== 'All') parameters.set('team', filters.team)
    if (filters.position && filters.position !== 'All') parameters.set('position', filters.position)
    if (filters.sort !== defaultFilters.sort) parameters.set('sort', filters.sort)
    if (page > 1) parameters.set('page', page.toString())
    const query = parameters.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [filters, page])

  const savedPlayers = useMemo(
    () => filterAndSortPlayers(Array.from(watchlist.values()), filters),
    [filters, watchlist],
  )
  const visiblePlayers = isWatchlistView ? savedPlayers : players
  const visiblePagination: PlayersPage = isWatchlistView
    ? {
        page: 1,
        limit: Math.max(savedPlayers.length, 1),
        total: savedPlayers.length,
        totalPages: savedPlayers.length > 0 ? 1 : 0,
      }
    : pagination
  const selectedPlayer =
    visiblePlayers.find((player) => player.id === selectedId) ?? visiblePlayers[0] ?? null
  const watchedIds = useMemo(() => new Set(watchlist.keys()), [watchlist])

  function changeView(view: WorkspaceView) {
    setActiveView(view)
    setSelectedId(null)
  }

  function changeFilters(patch: Partial<BoardFilters>) {
    const compatiblePatch = patch.stage === 'MLB' ? { ...patch, level: 'All' } : patch
    setFilters((current) => ({ ...current, ...compatiblePatch }))
    setPage(1)
  }

  function toggleWatchlist(playerId: string) {
    setWatchlist((current) => {
      const next = new Map(current)
      if (next.has(playerId)) {
        next.delete(playerId)
        return next
      }

      const player = visiblePlayers.find((candidate) => candidate.id === playerId)
      if (player) next.set(playerId, player)
      return next
    })
  }

  function selectPlayer(playerId: string) {
    setSelectedId(playerId)
    if (window.matchMedia('(max-width: 1120px)').matches) {
      window.requestAnimationFrame(() => {
        document.getElementById('player-dossier')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      })
    }
  }

  function returnToBoard() {
    document.getElementById('prospect-board')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const statcastCoverage = visiblePlayers.filter((player) => player.coverage.hasStatcast).length
  const stageCoverage = isWatchlistView
    ? stageCoverageForPlayers(visiblePlayers)
    : meta.stageCoverage ?? stageCoverageForPlayers(visiblePlayers)
  const loadedMappedOutlookCount = visiblePlayers.filter((player) => (
    player.stage === 'pre_debut'
      ? player.milbImpactRanking !== null && player.milbImpactRanking !== undefined
      : player.careerForecast?.rank !== null && player.careerForecast?.rank !== undefined
  )).length
  const mappedOutlookCount = isWatchlistView
    ? loadedMappedOutlookCount
    : meta.matchingMappedCount ?? loadedMappedOutlookCount
  const topbarStatus = loading && players.length === 0
    ? 'loading'
    : error
      ? 'error'
      : meta.degraded
        ? 'degraded'
        : 'live'
  const modelVintage = selectedPlayer?.stage === 'pre_debut'
    ? selectedPlayer.milbImpactRanking?.frozenAsOf ?? selectedPlayer.milbAlphaSignal?.asOf ?? null
    : selectedPlayer?.careerForecast?.careerChapter?.featureSeason
      ? `${selectedPlayer.careerForecast.careerChapter.featureSeason}-12-31T00:00:00.000Z`
      : null
  const evidenceBuildingCount = Math.max(0, visiblePagination.total - mappedOutlookCount)
  const statsClockLabel = filters.stage === 'Minors'
    ? 'Minor-league stats checked'
    : filters.stage === 'MLB'
      ? 'MLB stats checked'
      : 'All stats checked'

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <AppSidebar
        activeView={activeView}
        collapsed={sidebarCollapsed}
        watchlistCount={watchlist.size}
        onChangeView={changeView}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />

      <div className="app-content">
        <div className="topbar">
          <div className="topbar-context">
            <CircleDot size={14} aria-hidden="true" />
            <span>Professional baseball · projected career upside</span>
          </div>
          <div className="topbar-meta">
            <span><CalendarDays size={14} aria-hidden="true" /> {statsClockLabel} {formatDataDate(meta.dataAsOf)}</span>
            <span><History size={14} aria-hidden="true" /> Score data through {formatDataDate(modelVintage)}</span>
            <span className={`source-pill source-pill--${topbarStatus}`} aria-live="polite">
              {topbarStatus === 'loading' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'error' || topbarStatus === 'degraded' ? <AlertTriangle size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'live' ? <DatabaseZap size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'loading'
                ? 'Connecting'
                : topbarStatus === 'error'
                  ? 'Source unavailable'
                  : topbarStatus === 'degraded'
                    ? 'Partial source data'
                    : 'Sources connected'}
            </span>
          </div>
        </div>

        {activeView === 'Model lab' ? <ModelLab /> : null}
        {activeView === 'Data health' ? <DataHealth /> : null}
        {activeView === 'Validation' ? (
          <Suspense fallback={<div className="workspace-page validation-loading">Loading validation workspace</div>}>
            <ValidationDashboard />
          </Suspense>
        ) : null}

        {activeView === 'Board' || activeView === 'Watchlist' ? (
          <main className="research-workspace">
            <header className="workspace-header board-workspace-header">
              <div>
                <span className="eyebrow">PLAYER FORECASTS</span>
                <h1>{isWatchlistView ? 'Watchlist' : 'Player Rankings'}</h1>
                <p>
                  {isWatchlistView
                    ? 'Saved players, current Oracle Scores, and the stats behind each outlook.'
                    : 'Start with the Oracle Score, then inspect the upside, readiness, and evidence behind each player.'}
                </p>
              </div>
              <div className="snapshot-id">
                <span>MODEL STATUS</span>
                <strong>{meta.targetVersion ? 'Research predictions' : 'Model update pending'}</strong>
              </div>
            </header>

            {meta.degraded && !isWatchlistView ? (
              <div className="degraded-source-banner" role="status">
                <AlertTriangle size={16} aria-hidden="true" />
                <strong>Partial player universe</strong>
                <span>{meta.degradedReason ?? meta.coverage}</span>
              </div>
            ) : null}

            <section className="overview-strip" aria-label="Board summary">
              <div>
                <span>{isWatchlistView ? 'MATCHING WATCHLIST' : 'MATCHING PLAYERS'}</span>
                <strong>{visiblePagination.total.toLocaleString()}</strong>
                <small>{isWatchlistView ? `${watchlist.size} saved total` : 'after the selected filters'}</small>
              </div>
              <div>
                <span>ORACLE SCORES</span>
                <strong>{mappedOutlookCount.toLocaleString()}</strong>
                <small>
                  {evidenceBuildingCount > 0
                    ? `${evidenceBuildingCount.toLocaleString()} players still need more model data`
                    : 'every matching player has a score'}
                </small>
              </div>
              <div>
                <span>MINORS / MLB</span>
                <strong>{stageCoverage.minors.toLocaleString()} / {stageCoverage.mlb.toLocaleString()}</strong>
                <small>
                  {isWatchlistView
                    ? 'stage mix in matching watchlist'
                    : statcastCoverage > 0
                      ? `${statcastCoverage} with current tracking stats`
                      : 'players available at each stage'}
                </small>
              </div>
              <div>
                <span>WATCHLIST</span>
                <strong>{watchlist.size}</strong>
                <small>saved in this browser</small>
              </div>
            </section>

            <div className="research-grid">
              <ProspectBoard
                players={visiblePlayers}
                selectedId={selectedPlayer?.id ?? null}
                filters={filters}
                pagination={visiblePagination}
                loading={!isWatchlistView && loading}
                error={isWatchlistView ? null : error}
                watchlist={watchedIds}
                facets={meta.facets}
                onSelect={selectPlayer}
                onToggleWatchlist={toggleWatchlist}
                onChangeFilters={changeFilters}
                onChangePage={isWatchlistView ? () => undefined : setPage}
              />
              {selectedPlayer ? (
                <PlayerDossier
                  player={selectedPlayer}
                  saved={watchlist.has(selectedPlayer.id)}
                  onToggleWatchlist={toggleWatchlist}
                  onReturnToBoard={returnToBoard}
                />
              ) : (
                <div className="dossier-empty">
                  {loading && !isWatchlistView ? <LoaderCircle className="spin" size={22} aria-hidden="true" /> : null}
                  <strong>{loading && !isWatchlistView ? 'Loading player profiles' : 'No player selected'}</strong>
                  <span>
                    {isWatchlistView
                      ? 'Save a real player from the board to begin a watchlist.'
                      : 'Choose a player to see the full outlook.'}
                  </span>
                </div>
              )}
            </div>
          </main>
        ) : null}
      </div>
    </div>
  )
}

export default App
