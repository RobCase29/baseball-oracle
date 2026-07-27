import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenText,
  RotateCcw,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import {
  filterItFactorEntries,
  IT_FACTOR_SPORTS,
  IT_FACTOR_TIERS,
  type ItFactorBoardResponse,
  type ItFactorEntry,
  type ItFactorSport,
  type ItFactorTier,
} from '../domain/itFactor'
import { ItFactorBadge } from './ItFactorBadge'
import './it-factor-board.css'

interface ItFactorBoardProps {
  response: ItFactorBoardResponse | null
  loading: boolean
  error: string | null
  search: string
  onResetSearch: () => void
}

type ItFactorSort = 'team' | 'score'
const INITIAL_TEAM_GROUPS = 12
const TEAM_GROUP_INCREMENT = 12
const EMPTY_IT_ENTRIES: readonly ItFactorEntry[] = []

interface ItFactorTeamGroup {
  key: string
  team: ItFactorEntry['team']
  league: ItFactorEntry['league']
  sport: ItFactorSport
  entries: ItFactorEntry[]
}

const sportLabels: Record<ItFactorSport, string> = {
  baseball: 'Baseball',
  football: 'Football',
  basketball: 'Basketball',
  hockey: 'Hockey',
}

const tierLabels: Record<ItFactorTier, string> = {
  icon: 'Icon',
  high: 'High IT',
  emerging: 'Emerging',
  watch: 'Watch',
}

const statusLabels: Record<ItFactorEntry['player']['status'], string> = {
  prospect: 'Prospect',
  rookie: 'Rookie',
  young_star: 'Young star',
  established_star: 'Established star',
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function marketLabel(entry: ItFactorEntry): string {
  if (entry.market.trailingTwelveMonthSalesUsd === null) {
    return entry.market.evidence === 'not_observed'
      ? 'No tracked market row yet'
      : 'Market identity held back'
  }
  const percentile = entry.market.sportPercentile === null
    ? ''
    : ` · P${entry.market.sportPercentile.toFixed(0)} in sport`
  return (
    `${compactCurrencyFormatter.format(
      entry.market.trailingTwelveMonthSalesUsd,
    )} TTM${percentile}`
  )
}

function teamKey(entry: ItFactorEntry): string {
  return `${entry.sport}:${entry.team.code}`
}

function boardHref(
  lens: 'market' | 'players',
  playerName: string,
): string {
  const parameters = new URLSearchParams({
    lens,
    q: playerName,
  })
  return `/hobby?${parameters.toString()}`
}

export function ItFactorBoard({
  response,
  loading,
  error,
  search,
  onResetSearch,
}: ItFactorBoardProps) {
  const [sport, setSport] = useState<ItFactorSport | 'all'>('all')
  const [tier, setTier] = useState<ItFactorTier | 'all'>('all')
  const [team, setTeam] = useState('all')
  const [sort, setSort] = useState<ItFactorSort>('team')
  const [visibleTeamCount, setVisibleTeamCount] =
    useState(INITIAL_TEAM_GROUPS)
  const allEntries = response?.entries ?? EMPTY_IT_ENTRIES
  const visibleEntries = useMemo(() => {
    const searchedEntries = filterItFactorEntries(allEntries, search)
    return searchedEntries
      .filter((entry) => sport === 'all' || entry.sport === sport)
      .filter((entry) => tier === 'all' || entry.tier === tier)
      .filter((entry) => team === 'all' || teamKey(entry) === team)
      .toSorted((left, right) => (
        sort === 'score'
          ? right.score - left.score ||
            left.player.name.localeCompare(right.player.name, 'en-US')
          : left.sport.localeCompare(right.sport, 'en-US') ||
            left.team.name.localeCompare(right.team.name, 'en-US') ||
            right.score - left.score
      ))
  }, [allEntries, search, sort, sport, team, tier])
  const teams = useMemo(() => (
    allEntries
      .filter((entry) => sport === 'all' || entry.sport === sport)
      .map((entry) => ({
        key: teamKey(entry),
        label: `${entry.team.name} · ${entry.league}`,
        sport: entry.sport,
      }))
      .filter((candidate, index, candidates) => (
        candidates.findIndex((item) => item.key === candidate.key) === index
      ))
      .toSorted((left, right) => (
        left.sport.localeCompare(right.sport, 'en-US') ||
        left.label.localeCompare(right.label, 'en-US')
      ))
  ), [allEntries, sport])
  const sourceById = useMemo(() => new Map(
    (response?.sources ?? []).map((source) => [source.id, source]),
  ), [response])
  const grouped = useMemo(() => visibleEntries.reduce<ItFactorTeamGroup[]>(
    (groups, entry) => {
      const key = teamKey(entry)
      const existing = groups.find((group) => group.key === key)
      if (existing) existing.entries.push(entry)
      else {
        groups.push({
          key,
          team: entry.team,
          league: entry.league,
          sport: entry.sport,
          entries: [entry],
        })
      }
      return groups
    },
    [],
  ), [visibleEntries])
  const visibleGroups = grouped.slice(0, visibleTeamCount)
  const hiddenTeamCount = Math.max(0, grouped.length - visibleGroups.length)

  useEffect(() => {
    setVisibleTeamCount(INITIAL_TEAM_GROUPS)
  }, [search])

  function resetFilters(): void {
    setSport('all')
    setTier('all')
    setTeam('all')
    setSort('team')
    setVisibleTeamCount(INITIAL_TEAM_GROUPS)
    onResetSearch()
  }

  return (
    <div className="it-board">
      <div className="it-board__intro">
        <div>
          <span className="it-board__eyebrow">
            <Sparkles size={14} aria-hidden="true" />
            CURATED NARRATIVE LAYER
          </span>
          <h2>Who the hobby already believes can be special</h2>
          <p>
            IT measures narrative lock-in, star ceiling, loud tools, pedigree,
            marketability, and hobby confirmation. It is deliberately separate
            from performance rank and is not a forecast of card returns.
          </p>
        </div>
        <dl>
          <div>
            <dt>Teams covered</dt>
            <dd>{response?.coverage.teamCount ?? '—'}</dd>
          </div>
          <div>
            <dt>Flagged players</dt>
            <dd>{response?.coverage.entryCount ?? '—'}</dd>
          </div>
          <div>
            <dt>Next full review</dt>
            <dd>{response?.snapshot.nextReviewBy ?? '—'}</dd>
          </div>
        </dl>
      </div>

      <fieldset className="it-board__controls">
        <legend className="iw-sr-only">IT Board filters</legend>
        <label>
          <span>Sport</span>
          <select
            value={sport}
            onChange={(event) => {
              setSport(event.currentTarget.value as ItFactorSport | 'all')
              setTeam('all')
              setVisibleTeamCount(INITIAL_TEAM_GROUPS)
            }}
          >
            <option value="all">All four sports</option>
            {IT_FACTOR_SPORTS.map((value) => (
              <option value={value} key={value}>{sportLabels[value]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>IT tier</span>
          <select
            value={tier}
            onChange={(event) => {
              setTier(event.currentTarget.value as ItFactorTier | 'all')
              setVisibleTeamCount(INITIAL_TEAM_GROUPS)
            }}
          >
            <option value="all">All tiers</option>
            {IT_FACTOR_TIERS.map((value) => (
              <option value={value} key={value}>{tierLabels[value]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Team</span>
          <select
            value={team}
            onChange={(event) => {
              setTeam(event.currentTarget.value)
              setVisibleTeamCount(INITIAL_TEAM_GROUPS)
            }}
          >
            <option value="all">All teams</option>
            {teams.map((option) => (
              <option value={option.key} key={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Order</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.currentTarget.value as ItFactorSort)
              setVisibleTeamCount(INITIAL_TEAM_GROUPS)
            }}
          >
            <option value="team">Team board</option>
            <option value="score">Highest IT first</option>
          </select>
        </label>
        <button type="button" onClick={resetFilters}>
          <RotateCcw size={14} aria-hidden="true" />
          Reset
        </button>
      </fieldset>

      <div className="it-board__status" role="status" aria-live="polite">
        <strong>{visibleEntries.length}</strong>{' '}
        {visibleEntries.length === 1 ? 'player' : 'players'} across{' '}
        <strong>{grouped.length}</strong>{' '}
        {grouped.length === 1 ? 'team' : 'teams'}
        {hiddenTeamCount > 0 ? (
          <> · showing <strong>{visibleGroups.length}</strong> teams</>
        ) : null}
        {response ? (
          <span>
            Editorial review {response.snapshot.asOf} · hobby market through{' '}
            {response.snapshot.marketDataThrough}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="it-board__message" role="status">
          Loading the current IT Board…
        </div>
      ) : null}

      {error ? (
        <div className="it-board__message it-board__message--error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>
            <strong>IT Board unavailable.</strong>
            {error}
          </span>
        </div>
      ) : null}

      {!loading && !error && grouped.length > 0 ? (
        <>
          <div className="it-team-grid">
            {visibleGroups.map((group) => (
              <section className="it-team" key={group.key}>
              <header>
                <span>{sportLabels[group.sport]} · {group.league}</span>
                <h3>{group.team.name}</h3>
                <small>{group.team.code} · {group.entries.length}/3 flags</small>
              </header>
              <div className="it-team__players">
                {group.entries.map((entry) => {
                  const evidenceSources = entry.sourceIds
                    .map((sourceId) => sourceById.get(sourceId))
                    .filter((source) => source !== undefined)
                  const additionalTriggers = entry.recheckTriggers.slice(1)
                  const additionalSources = evidenceSources.slice(3)
                  return (
                    <article
                      className={`it-player it-player--${entry.tier}`}
                      key={entry.id}
                    >
                    <div className="it-player__heading">
                      <div>
                        <div className="it-name-line">
                          <h4>{entry.player.name}</h4>
                          <ItFactorBadge entry={entry} />
                        </div>
                        <small>
                          {entry.player.position} ·{' '}
                          {statusLabels[entry.player.status]} ·{' '}
                          {entry.trajectory}
                        </small>
                      </div>
                      <div className="it-player__confidence">
                        <strong>{entry.confidence}%</strong>
                        <span>classification confidence</span>
                      </div>
                    </div>
                    <div className="it-player__meter" aria-hidden="true">
                      <span style={{ width: `${entry.score}%` }} />
                    </div>
                    <p>{entry.rationale}</p>
                    <div className="it-player__signals">
                      {entry.signals.slice(0, 4).map((signal) => (
                        <span key={signal}>{signal}</span>
                      ))}
                    </div>
                    <div className="it-player__recheck">
                      <strong>Recheck when</strong>
                      <span>{entry.recheckTriggers[0]}</span>
                    </div>
                    <div className="it-player__market">
                      <TrendingUp size={13} aria-hidden="true" />
                      <span>
                        <strong>{marketLabel(entry)}</strong>
                        {entry.market.evidence.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <nav
                      className="it-player__actions"
                      aria-label={`Open ${entry.player.name} on another board`}
                    >
                      <a href={boardHref('market', entry.player.name)}>
                        Market evidence
                        <ArrowUpRight size={10} aria-hidden="true" />
                      </a>
                      {entry.sport !== 'hockey' ? (
                        <a href={boardHref('players', entry.player.name)}>
                          Player path
                          <ArrowUpRight size={10} aria-hidden="true" />
                        </a>
                      ) : (
                        <span>Player path not modeled for NHL</span>
                      )}
                    </nav>
                    <div className="it-player__sources">
                      <BookOpenText size={13} aria-hidden="true" />
                      <span>Evidence</span>
                      {evidenceSources.slice(0, 3).map((source) => (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            key={source.id}
                            aria-label={`${source.publisher}: ${source.label}`}
                          >
                            {source.publisher}
                            <ArrowUpRight size={10} aria-hidden="true" />
                          </a>
                      ))}
                    </div>
                    {additionalTriggers.length > 0 ||
                    additionalSources.length > 0 ? (
                      <details className="it-player__more">
                        <summary>More evidence &amp; recheck cues</summary>
                        {additionalTriggers.length > 0 ? (
                          <div>
                            <strong>Additional recheck cues</strong>
                            <ul>
                              {additionalTriggers.map((trigger) => (
                                <li key={trigger}>{trigger}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {additionalSources.length > 0 ? (
                          <div>
                            <strong>Additional sources</strong>
                            <ul>
                              {additionalSources.map((source) => (
                                <li key={source.id}>
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {source.publisher}: {source.label}
                                    <ArrowUpRight
                                      size={10}
                                      aria-hidden="true"
                                    />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </details>
                    ) : null}
                    </article>
                  )
                })}
              </div>
              </section>
            ))}
          </div>
          {hiddenTeamCount > 0 ? (
            <div className="it-board__more">
              <button
                type="button"
                onClick={() => setVisibleTeamCount((current) => (
                  current + TEAM_GROUP_INCREMENT
                ))}
              >
                Show {Math.min(TEAM_GROUP_INCREMENT, hiddenTeamCount)} more
                teams
              </button>
              <span>
                {hiddenTeamCount} of {grouped.length} teams remain collapsed
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {!loading && !error && grouped.length === 0 ? (
        <div className="it-board__empty" role="status">
          <strong>No IT player matches these filters.</strong>
          <span>Clear the name, team, sport, or tier filter to reopen the board.</span>
          <button type="button" onClick={resetFilters}>Reset IT Board</button>
        </div>
      ) : null}

      {response ? (
        <aside className="it-board__rubric">
          <Sparkles size={16} aria-hidden="true" />
          <div>
            <strong>Read the number as narrative strength, not certainty.</strong>
            <p>{response.rubric.scoreInterpretation}</p>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
