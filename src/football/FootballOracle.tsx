import { useState, type ChangeEvent } from 'react'
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
  marketConsensusFor,
  parseMarketRankingsCsv,
  type MarketConsensus,
  type MarketRanking,
} from './marketRankings'

const DEFAULT_FORMAT_ID = 'sf_12t_half_ppr_no_tep'
const STANDOUT_GAP_POINTS = 15

const SOURCE_LINKS = [
  {
    name: 'KeepTradeCut Devy',
    coverage: 'College market lens',
    status: 'Link only · automated reuse blocked',
    href: 'https://keeptradecut.com/devy-rankings',
  },
  {
    name: 'KeepTradeCut Dynasty',
    coverage: 'NFL dynasty market lens',
    status: 'Link only · automated reuse blocked',
    href: 'https://keeptradecut.com/dynasty-rankings',
  },
  {
    name: 'Dynasty Daddy',
    coverage: 'NFL multi-market comparison',
    status: 'Link only · reuse permission pending',
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
  const [marketRankings, setMarketRankings] = useState<MarketRanking[]>([])
  const [formatId, setFormatId] = useState(DEFAULT_FORMAT_ID)
  const [importError, setImportError] = useState<string | null>(null)

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
  const selectedEdge = selectedPlayer ? edgeFor(selectedPlayer, selectedConsensus) : null
  const importedSources = new Set(marketRankings.map((ranking) => ranking.source)).size
  const formatOptions = [...new Set([DEFAULT_FORMAT_ID, ...marketRankings.map((ranking) => ranking.formatId)])].sort()
  const standoutGaps = footballPlayers.filter((player) => {
    const edge = edgeFor(player, marketForPlayer(marketRankings, player, formatId))
    return edge !== null && edge >= STANDOUT_GAP_POINTS
  }).length

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
      setMarketRankings(rankings)
      const importedFormats = [...new Set(rankings.map((ranking) => ranking.formatId))]
      if (!importedFormats.includes(formatId)) setFormatId(importedFormats[0] ?? DEFAULT_FORMAT_ID)
      setImportError(null)
    } catch (error) {
      setMarketRankings([])
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
          <span className="fo-status-dot">Research preview</span>
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
              position-specific; market divergence activates only from a rights-attested, exact-format snapshot.
            </p>
          </div>
          <div className="fo-hero-badge" aria-label="Current research posture">
            <Sparkles size={19} aria-hidden="true" />
            <span><strong>Shadow v0</strong>Ordinal signals, not probabilities</span>
          </div>
        </section>

        <section className="fo-rights-banner" aria-label="Market data policy">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Market feeds fail closed.</strong>
            <span>
              KTC prohibits reuse in tools, and Dynasty Daddy has no supported reuse API or downstream-use
              license. Live links stay link-only; rights-attested imports remain in this browser session.
            </span>
          </div>
        </section>

        <section className="fo-metrics" aria-label="Football Oracle status">
          <article><span>NFL research rows</span><strong>16</strong><small>Locked preseason checkpoint</small></article>
          <article><span>College identities</span><strong>16</strong><small>Feature feed pending</small></article>
          <article><span>Market sources loaded</span><strong>{importedSources}</strong><small>{marketRankings.length} rights-attested rows</small></article>
          <article><span>Oracle-ahead gaps</span><strong>{standoutGaps}</strong><small>At least +{STANDOUT_GAP_POINTS} percentile points</small></article>
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
                  {formatOptions.map((option) => <option value={option} key={option}>{option}</option>)}
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
                    <th scope="col">Market percentile</th>
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
                        <td data-label="Market percentile">{consensus ? `${consensus.positionPercentile.toFixed(1)} · ${consensus.sourceCount} src` : 'Not loaded'}</td>
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
                      Median position percentile {selectedConsensus.positionPercentile.toFixed(1)} in {formatId} across {selectedConsensus.sources.join(', ')}.
                      Median source rank: {formatRank(selectedConsensus.positionRank)}. Latest imported date: {selectedConsensus.asOf}.
                    </p>
                  ) : (
                    <p>No rights-attested same-universe, same-position, exact-format ranking is loaded for this player.</p>
                  )}
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
            <span className="fo-eyebrow">RIGHTS-ATTESTED COMPARISON</span>
            <h2 id="market-import-title">Load a licensed or self-authored rank snapshot.</h2>
            <p>
              Required columns: <code>name, universe, position, source, format_id, position_rank,
              position_universe_size, as_of, rights_attested</code>. Restricted-source aliases are rejected;
              exact formats and player pools are normalized to position percentiles.
            </p>
          </div>
          <div className="fo-import-actions">
            <label className="fo-primary-action">
              <FileUp size={15} aria-hidden="true" /> Import CSV
              <input className="fo-sr-only" type="file" accept=".csv,text/csv" onChange={importMarketFile} />
            </label>
            <a className="fo-secondary-action" href="/football/market-rankings-template.csv" download>Download template</a>
            {marketRankings.length > 0 ? (
              <button className="fo-clear-action" type="button" onClick={() => { setMarketRankings([]); setFormatId(DEFAULT_FORMAT_ID) }}><X size={14} /> Clear</button>
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
