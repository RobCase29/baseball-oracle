import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CircleDot,
  DatabaseZap,
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
import { filterAndSortPlayers } from './lib/forecast'

const PAGE_SIZE = 50
const WATCHLIST_STORAGE_KEY = 'baseball-oracle.real-watchlist.v1'

const ValidationDashboard = lazy(() =>
  import('./components/ValidationDashboard').then((module) => ({
    default: module.ValidationDashboard,
  })),
)

const initialFilters: BoardFilters = {
  query: '',
  playerType: 'All',
  level: 'All',
  sort: 'arrival36',
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
  coverage: 'Current minor-league observed profiles',
  forecastStatus: 'research_only',
  source: 'Prospect Savant',
}

function loadWatchlist(): Map<string, PlayerRecord> {
  try {
    const stored = window.localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (!stored) return new Map()
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return new Map()

    const players = parsed.filter(
      (candidate): candidate is PlayerRecord =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'id' in candidate &&
        typeof candidate.id === 'string' &&
        'name' in candidate &&
        typeof candidate.name === 'string' &&
        'forecast' in candidate,
    )
    return new Map(players.map((player) => [player.id, player]))
  } catch {
    return new Map()
  }
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

function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('Board')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(initialFilters)
  const [page, setPage] = useState(1)
  const [players, setPlayers] = useState<PlayerRecord[]>([])
  const [pagination, setPagination] = useState<PlayersPage>(emptyPage)
  const [meta, setMeta] = useState<PlayersResponseMeta>(emptyMeta)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [watchlist, setWatchlist] = useState<Map<string, PlayerRecord>>(loadWatchlist)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(filters.query)

  useEffect(() => {
    window.localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify(Array.from(watchlist.values())),
    )
  }, [watchlist])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      sort: filters.sort,
    })
    const query = deferredQuery.trim()
    if (query) parameters.set('q', query)
    if (filters.playerType !== 'All') parameters.set('playerType', filters.playerType)
    if (filters.level !== 'All') parameters.set('level', filters.level)

    setLoading(true)
    setError(null)

    fetch(`/api/players?${parameters.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Player endpoint returned ${response.status}.`)
        const result = (await response.json()) as unknown
        if (!isPlayersResponse(result)) throw new Error('Player endpoint returned an unexpected response.')
        setPlayers(result.items)
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
  }, [deferredQuery, filters.level, filters.playerType, filters.sort, page])

  const savedPlayers = useMemo(
    () => filterAndSortPlayers(Array.from(watchlist.values()), filters),
    [filters, watchlist],
  )
  const isWatchlistView = activeView === 'Watchlist'
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
    setFilters((current) => ({ ...current, ...patch }))
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
  const topbarStatus = loading && players.length === 0 ? 'loading' : error ? 'error' : 'live'

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
            <span>Professional baseball · MLB-affiliated development</span>
          </div>
          <div className="topbar-meta">
            <span><CalendarDays size={14} aria-hidden="true" /> Data as of {formatDataDate(meta.dataAsOf)}</span>
            <span className={`source-pill source-pill--${topbarStatus}`}>
              {topbarStatus === 'loading' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'error' ? <AlertTriangle size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'live' ? <DatabaseZap size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'loading' ? 'Connecting' : topbarStatus === 'error' ? 'Source unavailable' : 'Live source data'}
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
                <span className="eyebrow">OBSERVED PLAYER INTELLIGENCE</span>
                <h1>{isWatchlistView ? 'Watchlist' : 'Prospect intelligence'}</h1>
                <p>
                  {isWatchlistView
                    ? 'Saved real-player profiles and their current source evidence.'
                    : 'Current minor-league evidence joined to frozen 2025 research arrival estimates where identity and role match.'}
                </p>
              </div>
              <div className="snapshot-id">
                <span>SOURCE COHORT</span>
                <strong>{meta.season ? `${meta.season} · ${meta.source}` : meta.source}</strong>
              </div>
            </header>

            <section className="overview-strip" aria-label="Board summary">
              <div>
                <span>{isWatchlistView ? 'MATCHING WATCHLIST' : 'PLAYER PROFILES'}</span>
                <strong>{visiblePagination.total.toLocaleString()}</strong>
                <small>{isWatchlistView ? `${watchlist.size} saved total` : `${meta.season ?? 'Current'} source profiles`}</small>
              </div>
              <div>
                <span>RESEARCH ESTIMATES</span>
                <strong>{meta.researchCoverage?.toLocaleString() ?? visiblePlayers.filter((player) => player.researchEstimate).length}</strong>
                <small>exact ID + role matches</small>
              </div>
              <div>
                <span>STATCAST COVERAGE</span>
                <strong>{statcastCoverage}</strong>
                <small>of {visiblePlayers.length} visible profiles</small>
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
                      : 'Choose a record from the current cohort.'}
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
