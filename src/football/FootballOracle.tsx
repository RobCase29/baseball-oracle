import { useEffect, useState, type ChangeEvent } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Database,
  ExternalLink,
  FileUp,
  Goal,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import {
  FOOTBALL_POSITIONS,
  NFL_ORACLE_POSITION_UNIVERSE_SIZE,
  footballPlayers,
  type FootballPlayer,
  type FootballPosition,
  type FootballUniverse,
} from './footballData'
import {
  FOOTBALL_MARKET_FORMAT_IDS,
  isFootballMarketFormatId,
  type FootballMarketFeedResponse,
  type FootballMarketFormatId,
} from './marketFeedContract'
import {
  marketConsensusFor,
  marketRankingFromLiveFeed,
  marketRankingsForPlayer,
  parseMarketRankingsCsv,
  type MarketConsensus,
  type MarketRanking,
} from './marketRankings'

const DEFAULT_FORMAT_ID: FootballMarketFormatId = 'sf_12t_half_ppr_no_tep'
const STANDOUT_GAP_POINTS = 15

const FORMAT_LABELS: Record<FootballMarketFormatId, string> = {
  one_qb_12t_half_ppr_no_tep: '1QB · 12-team · 0.5 PPR',
  one_qb_12t_half_ppr_tep: '1QB · 12-team · 0.5 PPR · TE+',
  one_qb_12t_half_ppr_tepp: '1QB · 12-team · 0.5 PPR · TE++',
  one_qb_12t_half_ppr_teppp: '1QB · 12-team · 0.5 PPR · TE+++',
  sf_12t_half_ppr_no_tep: 'Superflex · 12-team · 0.5 PPR',
  sf_12t_half_ppr_tep: 'Superflex · 12-team · 0.5 PPR · TE+',
  sf_12t_half_ppr_tepp: 'Superflex · 12-team · 0.5 PPR · TE++',
  sf_12t_half_ppr_teppp: 'Superflex · 12-team · 0.5 PPR · TE+++',
}

const SOURCE_LINKS = [
  {
    name: 'KeepTradeCut Devy',
    coverage: 'College market lens',
    status: 'Authorized live feed · exact KTC format',
    href: 'https://keeptradecut.com/devy-rankings',
  },
  {
    name: 'KeepTradeCut Dynasty',
    coverage: 'NFL dynasty market lens',
    status: 'Authorized live feed · exact KTC format',
    href: 'https://keeptradecut.com/dynasty-rankings',
  },
  {
    name: 'Dynasty Daddy',
    coverage: 'NFL first-party dynasty lens',
    status: 'Authorized live feed · provider-default format',
    href: 'https://dynasty-daddy.com/fantasy-rankings',
  },
  {
    name: 'CollegeFootballData',
    coverage: 'College production features',
    status: 'Official API candidate · terms and tier review',
    href: 'https://collegefootballdata.com/api-tiers',
  },
] as const

function formatRank(value: number | null): string {
  if (value === null) return '—'
  return `#${Number.isInteger(value) ? value : value.toFixed(1)}`
}

function formatMarketFormat(formatId: string): string {
  return isFootballMarketFormatId(formatId)
    ? FORMAT_LABELS[formatId]
    : formatId.replaceAll('_', ' ')
}

function isMarketFeedResponse(value: unknown): value is FootballMarketFeedResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<FootballMarketFeedResponse>
  const request = response.request as Partial<FootballMarketFeedResponse['request']> | undefined
  return response.schemaVersion === 'football-market-feed.v1'
    && typeof response.generatedAt === 'string'
    && Boolean(request)
    && (request?.universe === 'college' || request?.universe === 'nfl')
    && typeof request?.formatId === 'string'
    && Array.isArray(response.providers)
    && Array.isArray(response.rankings)
}

function oraclePercentileFor(player: FootballPlayer): number | null {
  if (player.universe !== 'nfl' || player.oracleRank === null) return null
  const universeSize = NFL_ORACLE_POSITION_UNIVERSE_SIZE[player.position]
  if (universeSize === 1) return 100
  return 100 * (1 - ((player.oracleRank - 1) / (universeSize - 1)))
}

function edgeFor(player: FootballPlayer, consensus: MarketConsensus | null): number | null {
  const oraclePercentile = oraclePercentileFor(player)
  if (oraclePercentile === null || consensus === null) return null
  return oraclePercentile - consensus.positionPercentile
}

function edgeLabel(player: FootballPlayer, edge: number | null): string {
  if (edge !== null && edge >= STANDOUT_GAP_POINTS) return 'Oracle ahead'
  if (edge !== null && edge <= -STANDOUT_GAP_POINTS) return 'Market ahead'
  if (edge !== null) return 'Aligned'
  if (player.oracleRank !== null && player.oracleRank <= 3) return 'Oracle leader'
  return player.universe === 'college' ? 'Coverage building' : 'Market pending'
}

function edgeTone(edge: number | null, player: FootballPlayer): string {
  if (edge !== null && edge >= STANDOUT_GAP_POINTS) return 'positive'
  if (edge !== null && edge <= -STANDOUT_GAP_POINTS) return 'negative'
  if (edge !== null) return 'neutral'
  return player.oracleRank !== null && player.oracleRank <= 3 ? 'leader' : 'pending'
}

function marketForPlayer(
  rankings: readonly MarketRanking[],
  player: FootballPlayer,
  formatId: string,
) {
  return marketConsensusFor(rankings, player.name, player.universe, player.position, formatId)
}

export function FootballOracle() {
  const [universe, setUniverse] = useState<FootballUniverse>('nfl')
  const [position, setPosition] = useState<FootballPosition>('QB')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [manualMarketRankings, setManualMarketRankings] = useState<MarketRanking[]>([])
  const [marketFeed, setMarketFeed] = useState<FootballMarketFeedResponse | null>(null)
  const [isFeedLoading, setIsFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [formatId, setFormatId] = useState<string>(DEFAULT_FORMAT_ID)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    if (!isFootballMarketFormatId(formatId)) {
      setMarketFeed(null)
      setFeedError(null)
      setIsFeedLoading(false)
      return undefined
    }

    const controller = new AbortController()
    let active = true
    setMarketFeed(null)
    setFeedError(null)
    setIsFeedLoading(true)

    const queryParameters = new URLSearchParams({ universe, format: formatId })
    void fetch(`/api/football/v1/market-rankings?${queryParameters.toString()}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Market feed returned HTTP ${response.status}.`)
        const payload: unknown = await response.json()
        if (
          !isMarketFeedResponse(payload)
          || payload.request.universe !== universe
          || payload.request.formatId !== formatId
        ) {
          throw new Error('Market feed contract validation failed.')
        }
        if (active) setMarketFeed(payload)
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        setMarketFeed(null)
        setFeedError(error instanceof Error ? error.message : 'Market feed unavailable.')
      })
      .finally(() => {
        if (active) setIsFeedLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [formatId, universe])

  const liveMarketRankings = marketFeed?.rankings.map(marketRankingFromLiveFeed) ?? []
  const marketRankings = [...liveMarketRankings, ...manualMarketRankings]

  const normalizedQuery = query.trim().toLowerCase()
  const filteredPlayers = footballPlayers.filter((player) => (
    player.universe === universe &&
    player.position === position &&
    (
      normalizedQuery.length === 0 ||
      player.name.toLowerCase().includes(normalizedQuery) ||
      player.organization.toLowerCase().includes(normalizedQuery)
    )
  ))
  const selectedPlayer = filteredPlayers.find((player) => player.id === selectedId)
    ?? filteredPlayers[0]
    ?? null
  const selectedConsensus = selectedPlayer
    ? marketForPlayer(marketRankings, selectedPlayer, formatId)
    : null
  const selectedSourceRankings = selectedPlayer
    ? marketRankingsForPlayer(
      marketRankings,
      selectedPlayer.name,
      selectedPlayer.universe,
      selectedPlayer.position,
      formatId,
    )
    : []
  const selectedEdge = selectedPlayer ? edgeFor(selectedPlayer, selectedConsensus) : null
  const loadedSources = new Set(marketRankings.map((ranking) => ranking.source)).size
  const availableProviders = marketFeed?.providers.filter((provider) => provider.status === 'available') ?? []
  const expectedProviderCount = universe === 'nfl' ? 2 : 1
  const formatOptions = [...new Set([
    ...FOOTBALL_MARKET_FORMAT_IDS,
    ...manualMarketRankings.map((ranking) => ranking.formatId),
  ])]
  const standoutGaps = footballPlayers.filter((player) => {
    if (player.universe !== universe) return false
    const edge = edgeFor(player, marketForPlayer(marketRankings, player, formatId))
    return edge !== null && edge >= STANDOUT_GAP_POINTS
  }).length
  const feedStatus = !isFootballMarketFormatId(formatId)
    ? 'Manual format selected; verified live feeds are paused.'
    : isFeedLoading
      ? 'Refreshing the authorized market snapshots…'
      : feedError
        ? `Verified feed unavailable: ${feedError}`
        : availableProviders.length === 0
          ? 'No authorized provider returned a valid snapshot.'
          : availableProviders.length < expectedProviderCount
            ? `${availableProviders.length} of ${expectedProviderCount} authorized sources available; invalid sources stayed closed.`
            : `${availableProviders.length} authorized sources live from the shared cache.`

  function changeUniverse(nextUniverse: FootballUniverse) {
    setUniverse(nextUniverse)
    setSelectedId(null)
    setQuery('')
  }

  function changePosition(nextPosition: FootballPosition) {
    setPosition(nextPosition)
    setSelectedId(null)
  }

  async function importMarketFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const rankings = parseMarketRankingsCsv(await file.text())
      setManualMarketRankings(rankings)
      const importedFormats = [...new Set(rankings.map((ranking) => ranking.formatId))]
      if (!importedFormats.includes(formatId)) setFormatId(importedFormats[0] ?? DEFAULT_FORMAT_ID)
      setImportError(null)
    } catch (error) {
      setManualMarketRankings([])
      setFormatId(DEFAULT_FORMAT_ID)
      setImportError(error instanceof Error ? error.message : 'The ranking file could not be read.')
    }
  }

  return (
    <div className="football-oracle">
      <header className="fo-topbar">
        <a className="fo-brand" href="/" aria-label="Back to Baseball Oracle">
          <span className="fo-brand-mark" aria-hidden="true"><Goal size={20} /></span>
          <span className="fo-brand-copy"><small>BASEBALL ORACLE</small><strong>FOOTBALL LAB</strong></span>
        </a>
        <div className="fo-topbar-meta">
          <span>College + NFL</span>
          <span>QB · WR · RB · TE</span>
          <span className="fo-status-dot">Live market beta</span>
        </div>
      </header>

      <main className="fo-main">
        <a className="fo-back-link" href="/"><ArrowLeft size={14} /> Baseball Oracle</a>

        <section className="fo-hero" aria-labelledby="football-oracle-title">
          <div>
            <span className="fo-eyebrow">SKILL-POSITION RESEARCH</span>
            <h1 id="football-oracle-title">Find where football production outruns perception.</h1>
            <p>
              One isolated research surface for college prospects and NFL players. Oracle ranks stay
              position-specific; authorized market ranks refresh automatically and exact-format divergence
              stays separate from provider-default directional context.
            </p>
          </div>
          <div className="fo-hero-badge" aria-label="Current research posture">
            <Sparkles size={19} aria-hidden="true" />
            <span><strong>Shadow v0</strong>Ordinal signals, not probabilities</span>
          </div>
        </section>

        <section className="fo-rights-banner" aria-label="Market data policy" role="status" aria-live="polite">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Authorized market feeds.</strong>
            <span>
              Owner-attested KTC and Dynasty Daddy retrieval is server-side, bounded, attributed, and cached.
              {` ${feedStatus}`}
            </span>
            {marketFeed ? (
              <ul className="fo-feed-providers" aria-label="Market provider status">
                {marketFeed.providers.map((provider) => (
                  <li className={`is-${provider.status}`} key={provider.provider}>
                    <strong>{provider.label}</strong>
                    <span>
                      {provider.status === 'available'
                        ? `${provider.rowCount} rows`
                        : provider.status === 'unsupported'
                          ? 'Not used for this universe'
                          : `Unavailable · ${provider.errorCode ?? 'validation failure'}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="fo-metrics" aria-label="Football Oracle status">
          <article><span>NFL research rows</span><strong>16</strong><small>Locked preseason checkpoint</small></article>
          <article><span>College identities</span><strong>16</strong><small>Feature feed pending</small></article>
          <article><span>Market sources ready</span><strong>{loadedSources}</strong><small>{marketRankings.length} normalized live + manual rows</small></article>
          <article><span>Oracle-ahead gaps</span><strong>{standoutGaps}</strong><small>{universe === 'nfl' ? 'NFL' : 'College'} · at least +{STANDOUT_GAP_POINTS} percentile points</small></article>
        </section>

        <section className="fo-workspace" aria-label="Football player board">
          <div className="fo-board-panel">
            <div className="fo-board-toolbar">
              <div className="fo-segmented" role="group" aria-label="Player universe">
                <button type="button" className={universe === 'college' ? 'is-active' : ''} onClick={() => changeUniverse('college')} aria-pressed={universe === 'college'}>
                  College / Devy
                </button>
                <button type="button" className={universe === 'nfl' ? 'is-active' : ''} onClick={() => changeUniverse('nfl')} aria-pressed={universe === 'nfl'}>
                  NFL / Dynasty
                </button>
              </div>
              <div className="fo-position-tabs" role="group" aria-label="Position">
                {FOOTBALL_POSITIONS.map((playerPosition) => (
                  <button
                    type="button"
                    key={playerPosition}
                    className={position === playerPosition ? 'is-active' : ''}
                    onClick={() => changePosition(playerPosition)}
                    aria-pressed={position === playerPosition}
                  >
                    {playerPosition}
                  </button>
                ))}
              </div>
              <label className="fo-format">
                <span>Format</span>
                <select value={formatId} onChange={(event) => setFormatId(event.target.value)}>
                  {formatOptions.map((option) => <option value={option} key={option}>{formatMarketFormat(option)}</option>)}
                </select>
              </label>
              <label className="fo-search">
                <Search size={15} aria-hidden="true" />
                <span className="fo-sr-only">Search football players</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or team" />
              </label>
            </div>

            <div className="fo-board-heading">
              <div>
                <span className="fo-eyebrow">{universe === 'college' ? 'DEVELOPMENTAL UNIVERSE' : 'ESTABLISHED NFL UNIVERSE'}</span>
                <h2>{position} research board</h2>
              </div>
              <span>{filteredPlayers.length} players · position-specific only</span>
            </div>

            <div className="fo-table-wrap" tabIndex={0} role="region" aria-label={`${position} player comparison table`}>
              <table className="fo-player-table">
                <caption className="fo-sr-only">{position} players in the {universe} research universe</caption>
                <thead>
                  <tr>
                    <th scope="col">Oracle</th>
                    <th scope="col">Player</th>
                    <th scope="col">Team / school</th>
                    <th scope="col">Oracle percentile</th>
                    <th scope="col">Exact market percentile</th>
                    <th scope="col">Gap points</th>
                    <th scope="col">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.map((player) => {
                    const consensus = marketForPlayer(marketRankings, player, formatId)
                    const edge = edgeFor(player, consensus)
                    const oraclePercentile = oraclePercentileFor(player)
                    const isSelected = selectedPlayer?.id === player.id
                    return (
                      <tr className={isSelected ? 'is-selected' : ''} key={player.id}>
                        <td className="fo-rank-cell" data-label="Oracle rank">{formatRank(player.oracleRank)}</td>
                        <td data-label="Player">
                          <button className="fo-player-button" type="button" onClick={() => setSelectedId(player.id)} aria-pressed={isSelected}>
                            <strong>{player.name}</strong>
                            <span>{player.position} · {player.secondary}</span>
                          </button>
                        </td>
                        <td data-label="Team / school">{player.organization}</td>
                        <td data-label="Oracle percentile">{oraclePercentile === null ? 'Withheld' : oraclePercentile.toFixed(1)}</td>
                        <td data-label="Exact market percentile">
                          {consensus
                            ? `${consensus.positionPercentile.toFixed(1)} · ${consensus.sourceCount} src`
                            : isFeedLoading && isFootballMarketFormatId(formatId)
                              ? 'Refreshing…'
                              : 'Not ranked'}
                        </td>
                        <td data-label="Gap points" className={edge !== null && edge > 0 ? 'fo-positive' : edge !== null && edge < 0 ? 'fo-negative' : ''}>
                          {edge === null ? '—' : `${edge > 0 ? '+' : ''}${edge.toFixed(1)}`}
                        </td>
                        <td data-label="Signal"><span className={`fo-signal fo-signal--${edgeTone(edge, player)}`}>{edgeLabel(player, edge)}</span></td>
                      </tr>
                    )
                  })}
                  {filteredPlayers.length === 0 ? (
                    <tr><td className="fo-empty-row" colSpan={7}>No players match this search.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="fo-dossier">
            <span className="fo-sr-only" role="status" aria-live="polite">
              {selectedPlayer ? `${selectedPlayer.name} selected` : 'No player selected'}
            </span>
            {selectedPlayer ? (
              <>
                <div className="fo-dossier-header">
                  <div>
                    <span>{selectedPlayer.position} · {selectedPlayer.organization}</span>
                    <h2>{selectedPlayer.name}</h2>
                  </div>
                  <span className={`fo-signal fo-signal--${edgeTone(selectedEdge, selectedPlayer)}`}>
                    {edgeLabel(selectedPlayer, selectedEdge)}
                  </span>
                </div>

                <p className="fo-dossier-summary">{selectedPlayer.summary}</p>

                <dl className="fo-dossier-metrics">
                  <div><dt>Oracle position rank</dt><dd>{formatRank(selectedPlayer.oracleRank)}</dd></div>
                  <div><dt>Oracle percentile</dt><dd>{oraclePercentileFor(selectedPlayer)?.toFixed(1) ?? 'Withheld'}</dd></div>
                  <div><dt>Market percentile</dt><dd>{selectedConsensus?.positionPercentile.toFixed(1) ?? '—'}</dd></div>
                  <div><dt>Percentile-point gap</dt><dd>{selectedEdge === null ? '—' : `${selectedEdge > 0 ? '+' : ''}${selectedEdge.toFixed(1)}`}</dd></div>
                </dl>

                <div className="fo-evidence-note">
                  <Database size={16} aria-hidden="true" />
                  <div>
                    <strong>{selectedPlayer.evidenceState === 'completed_season' ? 'Completed-season evidence' : 'College feature feed pending'}</strong>
                    <span>
                      {selectedPlayer.evidenceState === 'completed_season'
                        ? 'The model output is an ordinal research score and is not calibrated as a probability.'
                        : 'Identity is visible, but model rank stays withheld until college source, target, and coverage gates pass.'}
                    </span>
                  </div>
                </div>

                <div className="fo-market-detail">
                  <span className="fo-eyebrow">MARKET LENS</span>
                  {selectedConsensus ? (
                    <p>
                      Exact-format position percentile {selectedConsensus.positionPercentile.toFixed(1)} in {formatMarketFormat(formatId)} across {selectedConsensus.sources.join(', ')}.
                      Median source rank: {formatRank(selectedConsensus.positionRank)}. Latest snapshot date: {selectedConsensus.asOf}.
                    </p>
                  ) : isFeedLoading && isFootballMarketFormatId(formatId) ? (
                    <p>Refreshing the authorized ranking snapshots for this universe and format.</p>
                  ) : (
                    <p>No verified same-universe, same-position, exact-format ranking is available for this player.</p>
                  )}
                  {selectedSourceRankings.length > 0 ? (
                    <div className="fo-provider-ranks" aria-label="Provider ranks for selected player">
                      {selectedSourceRankings.map((ranking) => (
                        <div key={`${ranking.source}:${ranking.providerPlayerId ?? ranking.normalizedName}:${ranking.formatId}`}>
                          <span>
                            <strong>{ranking.source}</strong>
                            <small>
                              {ranking.comparisonScope === 'provider_default_directional'
                                ? 'Provider default · directional only'
                                : formatMarketFormat(ranking.formatId)}
                            </small>
                          </span>
                          <span>
                            <strong>{formatRank(ranking.positionRank)}</strong>
                            <small>
                              {ranking.positionPercentile.toFixed(1)} pct
                              {ranking.value !== null && ranking.value !== undefined ? ` · value ${ranking.value.toLocaleString()}` : ''}
                            </small>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="fo-link-row">
                    <a href={selectedPlayer.universe === 'college' ? 'https://keeptradecut.com/devy-rankings' : 'https://keeptradecut.com/dynasty-rankings'} target="_blank" rel="noreferrer">
                      View on KTC <ExternalLink size={13} />
                    </a>
                    {selectedPlayer.universe === 'nfl' ? (
                      <a href="https://dynasty-daddy.com/fantasy-rankings" target="_blank" rel="noreferrer">
                        View on Dynasty Daddy <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <p>No player selected.</p>
            )}
          </aside>
        </section>

        <section className="fo-market-import" aria-labelledby="market-import-title">
          <div>
            <span className="fo-eyebrow">OPTIONAL MANUAL COMPARISON</span>
            <h2 id="market-import-title">Add a licensed or self-authored rank snapshot.</h2>
            <p>
              Required columns: <code>name, universe, position, source, format_id, position_rank,
              position_universe_size, as_of, rights_attested</code>. KTC and Dynasty Daddy aliases are reserved
              for their verified automatic feeds; exact formats and player pools normalize to position percentiles.
            </p>
          </div>
          <div className="fo-import-actions">
            <label className="fo-primary-action">
              <FileUp size={15} aria-hidden="true" /> Import CSV
              <input className="fo-sr-only" type="file" accept=".csv,text/csv" onChange={importMarketFile} />
            </label>
            <a className="fo-secondary-action" href="/football/market-rankings-template.csv" download>Download template</a>
            {manualMarketRankings.length > 0 ? (
              <button className="fo-clear-action" type="button" onClick={() => { setManualMarketRankings([]); setFormatId(DEFAULT_FORMAT_ID) }}><X size={14} /> Clear manual</button>
            ) : null}
          </div>
          {importError ? <p className="fo-import-error" role="alert">{importError}</p> : null}
        </section>

        <section className="fo-sources" aria-labelledby="football-sources-title">
          <div className="fo-section-heading">
            <div><span className="fo-eyebrow">SOURCE PLAN</span><h2 id="football-sources-title">Market and production connections</h2></div>
            <BarChart3 size={22} aria-hidden="true" />
          </div>
          <div className="fo-source-grid">
            {SOURCE_LINKS.map((source) => (
              <a href={source.href} target="_blank" rel="noreferrer" key={source.name}>
                <span>{source.coverage}</span>
                <strong>{source.name}</strong>
                <small>{source.status}</small>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
