import { useDeferredValue, useEffect, useRef, useState } from 'react'
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
import { BinderBoard, type BinderStageFilter } from './components/BinderBoard'
import { ModelLab } from './components/ModelLab'
import { PlayerDossier } from './components/PlayerDossier'
import { ProspectBoard, type BoardDisplayMode } from './components/ProspectBoard'
import { defaultBoardFilters, filtersFromUrl } from './boardFilters'
import type {
  BoardFilters,
  PlayerMapFeedItem,
  PlayerMapFeedResponse,
  PlayerRecord,
  PlayersPage,
  PlayersResponse,
  PlayersResponseMeta,
} from './domain/forecast'
import {
  isCommunitySignalsResponse,
  mlbamIdForCommunity,
  type CommunitySignalItem,
} from './domain/communitySignals'
import {
  isCardMarketResponse,
  type CardMarketResponse,
} from './domain/cardMarket'
import {
  isBinderScoresResponse,
  type BinderScoresResponse,
} from './domain/binderScore'

const PAGE_SIZE = 50
const LANDSCAPE_SIZE = 100
const CLIENT_REVALIDATE_MS = 15 * 60 * 1_000

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

const emptyBinderPage: BinderScoresResponse['page'] = {
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

function formatDataTimestamp(value: string | null): string {
  if (!value) return 'awaiting first refresh'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
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

function isPlayerMapFeedResponse(value: unknown): value is PlayerMapFeedResponse {
  if (typeof value !== 'object' || value === null) return false
  return (
    'schemaVersion' in value &&
    value.schemaVersion === 'player-map-feed.v4' &&
    'items' in value &&
    Array.isArray(value.items) &&
    'page' in value &&
    typeof value.page === 'object' &&
    value.page !== null
  )
}

function normalizePlayerRecord(player: PlayerRecord): PlayerRecord {
  const validStages = new Set(['pre_debut', 'post_debut_minors', 'recent_callup', 'early_mlb', 'established_mlb', 'inactive'])
  return {
    ...player,
    // players.v1 predates the unified artifact and contains only minor-league records.
    stage: validStages.has(player.stage) ? player.stage : 'pre_debut',
    careerForecast: player.careerForecast ?? null,
    recentCallup: player.recentCallup ?? null,
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedPlayerRecord, setSelectedPlayerRecord] = useState<PlayerRecord | null>(null)
  const [openingPlayerId, setOpeningPlayerId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [boardDisplayMode, setBoardDisplayMode] = useState<BoardDisplayMode>('table')
  const [landscapeItems, setLandscapeItems] = useState<PlayerMapFeedItem[]>([])
  const [landscapeTotal, setLandscapeTotal] = useState(0)
  const [landscapeLoading, setLandscapeLoading] = useState(false)
  const [landscapeError, setLandscapeError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [communitySignals, setCommunitySignals] = useState<Record<string, CommunitySignalItem>>({})
  const [cardMarket, setCardMarket] = useState<CardMarketResponse | null>(null)
  const [cardMarketLoading, setCardMarketLoading] = useState(false)
  const [cardMarketError, setCardMarketError] = useState<string | null>(null)
  const [binderQuery, setBinderQuery] = useState('')
  const [binderStage, setBinderStage] = useState<BinderStageFilter>('All')
  const [binderPage, setBinderPage] = useState(1)
  const [binderResponse, setBinderResponse] = useState<BinderScoresResponse | null>(null)
  const [binderLoading, setBinderLoading] = useState(false)
  const [binderError, setBinderError] = useState<string | null>(null)
  const selectionRequest = useRef(0)
  const deferredQuery = useDeferredValue(filters.query)
  const deferredBinderQuery = useDeferredValue(binderQuery)

  useEffect(() => {
    const refresh = () => setRefreshTick((current) => current + 1)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const timer = window.setInterval(refresh, CLIENT_REVALIDATE_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

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
    if (filters.signal && filters.signal !== 'All') parameters.set('signal', filters.signal)

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
    filters.signal,
    filters.sort,
    filters.stage,
    filters.team,
    page,
    refreshTick,
  ])

  useEffect(() => {
    if (filters.stage !== 'Minors' || boardDisplayMode !== 'landscape') {
      setLandscapeItems([])
      setLandscapeTotal(0)
      setLandscapeLoading(false)
      setLandscapeError(null)
      return
    }

    const controller = new AbortController()
    const parameters = new URLSearchParams({
      stage: 'Minors',
      page: '1',
      limit: LANDSCAPE_SIZE.toString(),
      sort: 'prospectScore',
      view: 'map',
    })
    const query = deferredQuery.trim()
    if (query) parameters.set('q', query)
    if (filters.playerType !== 'All') parameters.set('playerType', filters.playerType)
    if (filters.level !== 'All') parameters.set('level', filters.level)
    if (filters.team && filters.team !== 'All') parameters.set('team', filters.team)
    if (filters.position && filters.position !== 'All') parameters.set('position', filters.position)
    if (filters.signal && filters.signal !== 'All') parameters.set('signal', filters.signal)

    setLandscapeItems([])
    setLandscapeTotal(0)
    setLandscapeLoading(true)
    setLandscapeError(null)

    fetch(`/api/players?${parameters.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Landscape endpoint returned ${response.status}.`)
        const result = (await response.json()) as unknown
        if (!isPlayerMapFeedResponse(result)) {
          throw new Error('Landscape endpoint returned an unexpected response.')
        }
        setLandscapeItems(result.items)
        setLandscapeTotal(result.page.total)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setLandscapeItems([])
        setLandscapeTotal(0)
        setLandscapeError(requestError instanceof Error
          ? requestError.message
          : 'Unable to load the filtered landscape.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLandscapeLoading(false)
      })

    return () => controller.abort()
  }, [
    boardDisplayMode,
    deferredQuery,
    filters.level,
    filters.playerType,
    filters.position,
    filters.signal,
    filters.stage,
    filters.team,
    refreshTick,
  ])

  useEffect(() => {
    if (activeView !== 'Binder') {
      setBinderLoading(false)
      return
    }

    const controller = new AbortController()
    const parameters = new URLSearchParams({
      page: binderPage.toString(),
      limit: PAGE_SIZE.toString(),
      sort: 'binderScore',
    })
    const query = deferredBinderQuery.trim()
    if (query) parameters.set('q', query)
    if (binderStage !== 'All') parameters.set('stage', binderStage)

    setBinderLoading(true)
    setBinderError(null)

    fetch(`/api/v1/binder-scores?${parameters.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Binder endpoint returned ${response.status}.`)
        const result = (await response.json()) as unknown
        if (!isBinderScoresResponse(result)) {
          throw new Error('Binder endpoint returned an unexpected response.')
        }
        setBinderResponse(result)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setBinderError(requestError instanceof Error
          ? requestError.message
          : 'Unable to load Binder rankings.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setBinderLoading(false)
      })

    return () => controller.abort()
  }, [
    activeView,
    binderPage,
    binderStage,
    deferredBinderQuery,
    refreshTick,
  ])

  useEffect(() => {
    const parameters = new URLSearchParams()
    if (filters.query.trim()) parameters.set('q', filters.query.trim())
    if (filters.stage !== defaultBoardFilters.stage) parameters.set('stage', filters.stage)
    if (filters.playerType !== 'All') parameters.set('playerType', filters.playerType)
    if (filters.level !== 'All') parameters.set('level', filters.level)
    if (filters.team && filters.team !== 'All') parameters.set('team', filters.team)
    if (filters.position && filters.position !== 'All') parameters.set('position', filters.position)
    if (filters.signal && filters.signal !== 'All') parameters.set('signal', filters.signal)
    if (filters.sort !== defaultBoardFilters.sort) parameters.set('sort', filters.sort)
    if (page > 1) parameters.set('page', page.toString())
    const query = parameters.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [filters, page])

  const selectedPlayer = selectedId
    ? players.find((player) => player.id === selectedId) ?? selectedPlayerRecord
    : null
  const selectedBinderScore = selectedId
    ? binderResponse?.items.find((item) => item.player.id === selectedId)?.assessment ?? null
    : null

  const communityIds = Array.from(new Set(
    [...players, ...(selectedPlayer ? [selectedPlayer] : [])]
      .map(mlbamIdForCommunity)
      .filter((value): value is string => value !== null),
  )).sort()
  const communityIdsKey = communityIds.join(',')

  useEffect(() => {
    if (!communityIdsKey) {
      setCommunitySignals({})
      return
    }

    const controller = new AbortController()
    const parameters = new URLSearchParams({ ids: communityIdsKey })

    fetch(`/api/v1/dynasty-scores?${parameters.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Community endpoint returned ${response.status}.`)
        const result = (await response.json()) as unknown
        if (!isCommunitySignalsResponse(result)) {
          throw new Error('Community endpoint returned an unexpected response.')
        }
        setCommunitySignals(Object.fromEntries(
          result.items.map((item) => [item.player.mlbamId, item]),
        ))
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        // Community sentiment is optional and never blocks the Oracle board.
      })

    return () => controller.abort()
  }, [communityIdsKey, refreshTick])

  const selectedCommunitySignal = selectedPlayer
    ? (() => {
        const mlbamId = mlbamIdForCommunity(selectedPlayer)
        return mlbamId ? communitySignals[mlbamId] ?? null : null
      })()
    : null

  useEffect(() => {
    if (!selectedPlayer) {
      setCardMarket(null)
      setCardMarketLoading(false)
      setCardMarketError(null)
      return
    }

    const controller = new AbortController()
    const parameters = new URLSearchParams({ player: selectedPlayer.name })
    setCardMarket(null)
    setCardMarketLoading(true)
    setCardMarketError(null)

    fetch(`/api/v1/card-market?${parameters.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Card market endpoint returned ${response.status}.`)
        const result = (await response.json()) as unknown
        if (!isCardMarketResponse(result)) {
          throw new Error('Card market endpoint returned an unexpected response.')
        }
        setCardMarket(result)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setCardMarket(null)
        setCardMarketError('Card-market pricing is temporarily unavailable.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setCardMarketLoading(false)
      })

    return () => controller.abort()
  }, [refreshTick, selectedPlayer])

  function changeView(view: WorkspaceView) {
    selectionRequest.current += 1
    setActiveView(view)
    setSelectedId(null)
    setSelectedPlayerRecord(null)
    setOpeningPlayerId(null)
    setSelectionError(null)
  }

  function changeFilters(patch: Partial<BoardFilters>) {
    const compatiblePatch = patch.stage === 'All'
      ? { ...patch, level: 'All', sort: 'name' as const }
      : patch.stage === 'MLB' || patch.stage === 'RC'
        ? { ...patch, level: 'All' }
        : patch
    setFilters((current) => ({ ...current, ...compatiblePatch }))
    setPage(1)
    setSelectionError(null)
  }

  function changeBinderQuery(query: string) {
    selectionRequest.current += 1
    setBinderQuery(query)
    setBinderPage(1)
    setSelectedId(null)
    setSelectedPlayerRecord(null)
    setOpeningPlayerId(null)
    setSelectionError(null)
  }

  function changeBinderStage(stage: BinderStageFilter) {
    selectionRequest.current += 1
    setBinderStage(stage)
    setBinderPage(1)
    setSelectedId(null)
    setSelectedPlayerRecord(null)
    setOpeningPlayerId(null)
    setSelectionError(null)
  }

  function selectPlayer(playerId: string) {
    const localPlayer = players.find((player) => player.id === playerId)
    selectionRequest.current += 1
    const requestNumber = selectionRequest.current
    setSelectedId(playerId)
    setSelectionError(null)

    if (localPlayer) {
      setSelectedPlayerRecord(localPlayer)
      setOpeningPlayerId(null)
      return
    }

    setSelectedPlayerRecord(null)
    setOpeningPlayerId(playerId)
    const parameters = new URLSearchParams({ ids: playerId, limit: '1' })
    fetch(`/api/players?${parameters.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Player endpoint returned ${response.status}.`)
        const result = (await response.json()) as unknown
        if (!isPlayersResponse(result) || result.items.length !== 1) {
          throw new Error('The full player outlook is unavailable.')
        }
        if (selectionRequest.current !== requestNumber) return
        setSelectedPlayerRecord(normalizePlayerRecord(result.items[0]))
      })
      .catch((requestError: unknown) => {
        if (selectionRequest.current !== requestNumber) return
        setSelectedId(null)
        setSelectedPlayerRecord(null)
        setSelectionError(requestError instanceof Error
          ? requestError.message
          : 'Unable to open the player outlook.')
      })
      .finally(() => {
        if (selectionRequest.current === requestNumber) setOpeningPlayerId(null)
      })
  }

  function returnToBoard() {
    selectionRequest.current += 1
    setSelectedId(null)
    setSelectedPlayerRecord(null)
    setOpeningPlayerId(null)
    setSelectionError(null)
    window.requestAnimationFrame(() => {
      document.getElementById(
        activeView === 'Binder' ? 'binder-board' : 'prospect-board',
      )?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const identityNeedsRefresh = (
    meta.identity?.identityCrosswalkStatus !== undefined &&
    meta.identity.identityCrosswalkStatus !== 'current'
  ) || (meta.identity?.unmatchedCurrentBbrefIds ?? 0) > 0
  const baseballTopbarStatus = loading && players.length === 0
    ? 'loading'
    : error
      ? 'error'
      : meta.degraded || identityNeedsRefresh || meta.currentDataFreshness?.status !== 'ok'
        ? 'degraded'
        : 'live'
  const binderMarketFreshness = binderResponse?.snapshot.marketFreshness.status ?? 'unknown'
  const binderBaseballFreshness =
    binderResponse?.snapshot.baseballFreshness.status ?? 'unknown'
  const topbarStatus = activeView === 'Binder'
    ? binderLoading && !binderResponse
      ? 'loading'
      : binderError && !binderResponse
        ? 'error'
        : binderError !== null ||
            binderMarketFreshness !== 'current' ||
            binderBaseballFreshness !== 'current'
          ? 'degraded'
          : 'live'
    : baseballTopbarStatus
  const modelVintage = selectedPlayer
    ? selectedPlayer.stage === 'pre_debut'
      ? selectedPlayer.milbImpactRanking?.frozenAsOf ?? selectedPlayer.milbAlphaSignal?.asOf ?? null
      : selectedPlayer.stage === 'recent_callup'
        ? selectedPlayer.recentCallup?.prospectPrior?.asOf ?? meta.researchAsOf ?? null
      : selectedPlayer.careerForecast?.careerChapter?.featureSeason
        ? `${selectedPlayer.careerForecast.careerChapter.featureSeason}-12-31T00:00:00.000Z`
        : meta.researchAsOf ?? null
    : meta.researchAsOf ?? null
  const statsClockLabel = filters.stage === 'Minors'
      ? 'Minor-league stats checked'
      : filters.stage === 'MLB' || filters.stage === 'RC'
        ? 'MLB stats checked'
        : 'All stats checked'
  const statsCheckedAt = meta.currentDataFreshness?.lastCheckedAt ?? meta.dataAsOf
  const sourceStatusLabel = activeView === 'Binder'
    ? topbarStatus === 'loading'
      ? 'Loading Binder evidence'
      : topbarStatus === 'error'
        ? 'Binder source unavailable'
        : binderError
          ? 'Binder refresh failed'
          : binderBaseballFreshness === 'stale'
            ? 'Baseball model overdue'
            : binderBaseballFreshness === 'unknown'
              ? 'Baseball freshness unverified'
          : binderMarketFreshness === 'stale'
            ? 'Market snapshot overdue'
            : binderMarketFreshness === 'unknown'
              ? 'Market freshness unverified'
              : 'Binder evidence current'
    : topbarStatus === 'loading'
      ? 'Connecting'
      : topbarStatus === 'error'
        ? 'Source unavailable'
        : identityNeedsRefresh
          ? 'Identity refresh needed'
          : meta.degraded
            ? 'Partial source data'
            : meta.currentDataFreshness?.reasonCodes.some((reason) => (
                reason === 'cron_not_configured' || reason === 'scheduled_run_not_observed'
              ))
              ? 'Refresh verification pending'
              : meta.currentDataFreshness?.status === 'stale'
                ? 'Stats refresh overdue'
                : meta.currentDataFreshness?.status === 'degraded'
                  ? 'Refresh verification pending'
                  : 'Updated twice daily'
  const rankingIntro = filters.stage === 'Minors'
    ? 'Prospect Rank sets five-year impact priority. Career Outlook adds long-term context. Current Results show what is happening now.'
    : filters.stage === 'RC'
      ? 'Pre-Debut Rank preserves the original prospect signal. Career Outlook and Current Results show how the transition is developing.'
      : 'MLB Career Rank sets the priority. Career Outlook adds long-term context. Current Results show what is happening now.'

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <AppSidebar
        activeView={activeView}
        collapsed={sidebarCollapsed}
        onChangeView={changeView}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />

      <div className="app-content">
        <div className="topbar">
          <div className="topbar-context">
            <CircleDot size={14} aria-hidden="true" />
            <span>
              {activeView === 'Binder'
                ? 'Long-term collection thesis · baseball trajectory + collector demand'
                : 'Professional baseball · projected career upside'}
            </span>
          </div>
          <div className="topbar-meta">
            {activeView === 'Binder' ? (
              <span>
                <CalendarDays size={14} aria-hidden="true" /> Baseball model through{' '}
                {formatDataDate(binderResponse?.snapshot.baseballDataAsOf ?? null)}
              </span>
            ) : (
              <span>
                <CalendarDays size={14} aria-hidden="true" /> {statsClockLabel}{' '}
                {formatDataTimestamp(statsCheckedAt)}
              </span>
            )}
            {activeView === 'Binder' && binderResponse ? (
              <span>
                <DatabaseZap size={14} aria-hidden="true" /> Market through{' '}
                {formatDataDate(binderResponse.snapshot.marketDataThrough)}
              </span>
            ) : null}
            {activeView !== 'Binder' ? (
              <span>
                <History size={14} aria-hidden="true" /> Career model through{' '}
                {formatDataDate(modelVintage)}
              </span>
            ) : null}
            <span className={`source-pill source-pill--${topbarStatus}`} aria-live="polite">
              {topbarStatus === 'loading' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'error' || topbarStatus === 'degraded' ? <AlertTriangle size={13} aria-hidden="true" /> : null}
              {topbarStatus === 'live' ? <DatabaseZap size={13} aria-hidden="true" /> : null}
              {sourceStatusLabel}
            </span>
          </div>
        </div>

        {activeView === 'Model lab' ? <ModelLab /> : null}

        {activeView === 'Board' ? (
          <main className="research-workspace">
            {!selectedPlayer ? (
              <header className="workspace-header board-workspace-header">
                <div>
                  <span className="eyebrow">PLAYER FORECASTS</span>
                  <h1>{filters.stage === 'All' ? 'Player Directory' : 'Player Rankings'}</h1>
                  <p>{filters.stage === 'All'
                    ? 'Search every active player, then compare each player within the right career stage.'
                    : rankingIntro}</p>
                </div>
                <div className="snapshot-id">
                  <span>MODEL STATUS</span>
                  <strong>{meta.targetVersion ? 'Research predictions' : 'Model update pending'}</strong>
                </div>
              </header>
            ) : null}

            {meta.degraded ? (
              <div className="degraded-source-banner" role="status">
                <AlertTriangle size={16} aria-hidden="true" />
                <strong>Partial player universe</strong>
                <span>{meta.degradedReason ?? meta.coverage}</span>
              </div>
            ) : null}

            {selectedPlayer ? (
              <PlayerDossier
                player={selectedPlayer}
                communitySignal={selectedCommunitySignal}
                cardMarket={cardMarket}
                cardMarketLoading={cardMarketLoading}
                cardMarketError={cardMarketError}
                onReturnToBoard={returnToBoard}
              />
            ) : (
              <ProspectBoard
                players={players}
                communitySignals={communitySignals}
                selectedId={selectedId}
                filters={filters}
                pagination={pagination}
                loading={loading}
                error={error}
                facets={meta.facets}
                searchRecovery={meta.searchRecovery}
                displayMode={boardDisplayMode}
                landscapeItems={landscapeItems}
                landscapeTotal={landscapeTotal}
                landscapeLoading={landscapeLoading}
                landscapeError={landscapeError}
                openingPlayerId={openingPlayerId}
                selectionError={selectionError}
                onSelect={selectPlayer}
                onChangeDisplayMode={setBoardDisplayMode}
                onChangeFilters={changeFilters}
                onChangePage={setPage}
              />
            )}
          </main>
        ) : null}

        {activeView === 'Binder' ? (
          <main className="research-workspace binder-workspace">
            {selectedPlayer ? (
              <PlayerDossier
                player={selectedPlayer}
                communitySignal={selectedCommunitySignal}
                cardMarket={cardMarket}
                cardMarketLoading={cardMarketLoading}
                cardMarketError={cardMarketError}
                binderScore={selectedBinderScore}
                returnLabel="Return to Build a Binder"
                onReturnToBoard={returnToBoard}
              />
            ) : (
              <>
                <header className="workspace-header binder-workspace-header">
                  <div>
                    <span className="eyebrow">COLLECTION THESIS · RESEARCH ONLY</span>
                    <h1>Build a Binder</h1>
                    <p>
                      Rank long-term collection candidates using career trajectory,
                      age-adjusted runway, and measured collector demand. Demand volume
                      is not a forecast of card appreciation.
                    </p>
                  </div>
                  <div className="snapshot-id">
                    <span>MARKET SNAPSHOT</span>
                    <strong>
                      {binderResponse
                        ? `Through ${formatDataDate(binderResponse.snapshot.marketDataThrough)}`
                        : 'Loading monthly evidence'}
                    </strong>
                  </div>
                </header>
                <BinderBoard
                  items={binderResponse?.items ?? []}
                  response={binderResponse}
                  page={binderResponse?.page ?? {
                    ...emptyBinderPage,
                    page: binderPage,
                  }}
                  loading={binderLoading}
                  error={binderError}
                  query={binderQuery}
                  stage={binderStage}
                  selectedId={selectedId}
                  openingPlayerId={openingPlayerId}
                  selectionError={selectionError}
                  onQueryChange={changeBinderQuery}
                  onStageChange={changeBinderStage}
                  onPageChange={setBinderPage}
                  onSelect={selectPlayer}
                />
              </>
            )}
          </main>
        ) : null}
      </div>
    </div>
  )
}

export default App
