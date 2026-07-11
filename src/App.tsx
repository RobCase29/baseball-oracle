import { useState } from 'react'
import { CalendarDays, CircleDot, DatabaseZap } from 'lucide-react'
import './App.css'
import { AppSidebar, type WorkspaceView } from './components/AppSidebar'
import { DataHealth } from './components/DataHealth'
import { ModelLab } from './components/ModelLab'
import { PlayerDossier } from './components/PlayerDossier'
import { ProspectBoard } from './components/ProspectBoard'
import { demoPlayers } from './data/demoPlayers'
import type { BoardFilters } from './domain/forecast'
import { rankPlayers } from './lib/forecast'

const initialFilters: BoardFilters = {
  query: '',
  playerType: 'All',
  level: 'All',
  sort: 'oracle',
  watchlistOnly: false,
}

function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('Board')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(initialFilters)
  const [watchlist, setWatchlist] = useState(() => new Set(['eli-marin', 'marcus-hall']))
  const [selectedId, setSelectedId] = useState('eli-marin')

  const visiblePlayers = rankPlayers(demoPlayers, filters, watchlist)
  const selectedPlayer =
    visiblePlayers.find((player) => player.id === selectedId) ?? visiblePlayers[0] ?? null

  function changeView(view: WorkspaceView) {
    setActiveView(view)
    if (view === 'Watchlist') {
      setFilters((current) => ({ ...current, watchlistOnly: true }))
    }
    if (view === 'Board') {
      setFilters((current) => ({ ...current, watchlistOnly: false }))
    }
  }

  function changeFilters(patch: Partial<BoardFilters>) {
    setFilters((current) => ({ ...current, ...patch }))
  }

  function toggleWatchlist(playerId: string) {
    setWatchlist((current) => {
      const next = new Set(current)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }

  const avgArrival = Math.round(
    visiblePlayers.reduce((sum, player) => sum + player.arrivalProbability, 0) /
      Math.max(visiblePlayers.length, 1),
  )
  const positiveMovers = visiblePlayers.filter((player) => player.arrivalDelta > 0).length

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
            <span>Professional baseball · North America</span>
          </div>
          <div className="topbar-meta">
            <span><CalendarDays size={14} aria-hidden="true" /> As of Jul 10, 2026</span>
            <span className="demo-pill"><DatabaseZap size={13} aria-hidden="true" /> Simulated data</span>
          </div>
        </div>

        {activeView === 'Model lab' ? <ModelLab /> : null}
        {activeView === 'Data health' ? <DataHealth /> : null}

        {activeView === 'Board' || activeView === 'Watchlist' ? (
          <main className="research-workspace">
            <header className="workspace-header board-workspace-header">
              <div>
                <span className="eyebrow">DECISION COCKPIT</span>
                <h1>{activeView === 'Watchlist' ? 'Watchlist' : 'Prospect intelligence'}</h1>
                <p>
                  {activeView === 'Watchlist'
                    ? 'Saved forecasts and the evidence behind every revision.'
                    : 'Point-in-time arrival probabilities and career outcome distributions.'}
                </p>
              </div>
              <div className="snapshot-id">
                <span>SNAPSHOT</span>
                <strong>2026.07.10-01</strong>
              </div>
            </header>

            <section className="overview-strip" aria-label="Board summary">
              <div>
                <span>VISIBLE UNIVERSE</span>
                <strong>{visiblePlayers.length}</strong>
                <small>of {demoPlayers.length} demo players</small>
              </div>
              <div>
                <span>AVG. MLB PROBABILITY</span>
                <strong>{avgArrival}%</strong>
                <small>current filtered cohort</small>
              </div>
              <div>
                <span>POSITIVE MOVERS</span>
                <strong>{positiveMovers}</strong>
                <small>since prior snapshot</small>
              </div>
              <div>
                <span>WATCHLIST</span>
                <strong>{watchlist.size}</strong>
                <small>active research theses</small>
              </div>
            </section>

            <div className="research-grid">
              <ProspectBoard
                players={visiblePlayers}
                selectedId={selectedPlayer?.id ?? null}
                filters={filters}
                watchlist={watchlist}
                onSelect={setSelectedId}
                onToggleWatchlist={toggleWatchlist}
                onChangeFilters={changeFilters}
              />
              {selectedPlayer ? (
                <PlayerDossier
                  player={selectedPlayer}
                  saved={watchlist.has(selectedPlayer.id)}
                  onToggleWatchlist={toggleWatchlist}
                />
              ) : (
                <div className="dossier-empty">
                  <strong>No player selected</strong>
                  <span>Choose a record from the current cohort.</span>
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
