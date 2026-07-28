import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Layers3,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import type {
  HobbyDecisionDesk,
  HobbyDecisionQueue,
  HobbyDecisionQueueId,
} from '../domain/hobbyDecisionDesk'
import './hobby-decision-desk.css'

interface HobbyDecisionDeskProps {
  desk: HobbyDecisionDesk | null
  loading: boolean
  error: string | null
  marketDataThrough: string | null
  graduationDataThrough: string | null
  itReviewedAsOf: string | null
  coverageLimitations: readonly string[]
}

type DecisionFocus =
  | 'compounding_now'
  | 'narrative_momentum'
  | 'noise_check'
  | 'narrative_pressure'
  | 'all'

const INITIAL_QUEUE_ITEMS = 6

const FOCUS_OPTIONS: ReadonlyArray<{
  id: DecisionFocus
  label: string
  queueId: HobbyDecisionQueueId | null
}> = [
  {
    id: 'compounding_now',
    label: 'Compounding now',
    queueId: 'compounding_now',
  },
  {
    id: 'narrative_momentum',
    label: 'Inflecting',
    queueId: 'narrative_momentum',
  },
  {
    id: 'noise_check',
    label: 'Noise check',
    queueId: 'noise_check',
  },
  {
    id: 'narrative_pressure',
    label: 'At risk',
    queueId: 'narrative_pressure',
  },
  { id: 'all', label: 'All signals', queueId: null },
] as const

function titleLabel(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase('en-US'))
}

function queueMatches(
  queue: HobbyDecisionQueue,
  normalizedSearch: string,
): HobbyDecisionQueue {
  if (!normalizedSearch) return queue
  return {
    ...queue,
    items: queue.items.filter((item) => (
      [
        item.playerName,
        item.teamName,
        item.position,
        item.sport,
        item.nativeSignal.label,
        item.nativeSignal.value,
        ...item.evidence,
      ].some((value) => (
        value.toLocaleLowerCase('en-US').includes(normalizedSearch)
      ))
    )),
  }
}

export function HobbyDecisionDesk({
  desk,
  loading,
  error,
  marketDataThrough,
  graduationDataThrough,
  itReviewedAsOf,
  coverageLimitations,
}: HobbyDecisionDeskProps) {
  const [focus, setFocus] = useState<DecisionFocus>('compounding_now')
  const [search, setSearch] = useState('')
  const [expandedQueueIds, setExpandedQueueIds] = useState<Set<string>>(
    () => new Set(),
  )
  const normalizedSearch = search.trim().toLocaleLowerCase('en-US')
  const queues = useMemo(() => {
    const focusedQueues = focus === 'all' || normalizedSearch
      ? desk?.queues ?? []
      : desk?.queues.filter((queue) => queue.id === focus) ?? []
    return focusedQueues.map((queue) => (
      queueMatches(queue, normalizedSearch)
    ))
  }, [desk, focus, normalizedSearch])
  const visibleMatches = queues.reduce(
    (total, queue) => total + queue.items.length,
    0,
  )

  function toggleQueue(queueId: string): void {
    setExpandedQueueIds((current) => {
      const next = new Set(current)
      if (next.has(queueId)) next.delete(queueId)
      else next.add(queueId)
      return next
    })
  }

  if (loading) {
    return (
      <div className="decision-desk__message" role="status">
        <span className="decision-desk__loader" aria-hidden="true" />
        Connecting scale, repeatability, narrative, path, and risk…
      </div>
    )
  }

  if (error || !desk) {
    return (
      <div className="decision-desk__message decision-desk__message--error">
        <strong>Decision Desk unavailable.</strong>
        <span>{error ?? 'The signal intersections could not be built.'}</span>
        <a href="/hobby?lens=market">Open the Build Board</a>
      </div>
    )
  }

  return (
    <div className="decision-desk">
      <section className="decision-desk__intro">
        <div>
          <span className="decision-desk__eyebrow">
            <Layers3 size={14} aria-hidden="true" />
            POWER-LAW FOCUS
          </span>
          <h2>Find demand that can keep compounding</h2>
          <p>
            Start with scale, then require repeated completed-sales growth,
            breadth, durable hobby belief, and enough runway for the story to
            keep earning attention. This describes subject-level demand—not
            card appreciation or a return forecast.
          </p>
        </div>
        <dl aria-label="Observed demand concentration">
          <div>
            <dt>Top 1% demand</dt>
            <dd>{desk.powerLaw.topOnePercent.demandSharePct.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Tail retained</dt>
            <dd>{desk.powerLaw.priorTail.retentionPct.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Confirmed entrants</dt>
            <dd>{desk.powerLaw.confirmedTailEntrantCount}</dd>
          </div>
        </dl>
        <p className="decision-desk__helper">
          Power law is a market shape, not a buy signal. These lanes favor
          repeatable demand capture over percentage spikes. Top 10% accounts
          for {` ${desk.powerLaw.topTenPercent.demandSharePct.toFixed(1)}% `}
          of observed TTM demand across
          {` ${desk.powerLaw.observedUniverseCount.toLocaleString()} `}
          comparable subjects.
        </p>
      </section>

      <nav
        className="decision-desk__focus"
        aria-label="Power-law focus"
      >
        {FOCUS_OPTIONS.map((option) => {
          const count = option.queueId === null
            ? desk.intersectionCount
            : desk.queues.find((queue) => queue.id === option.queueId)
                ?.items.length ?? 0
          return (
            <button
              type="button"
              key={option.id}
              aria-pressed={focus === option.id}
              onClick={() => setFocus(option.id)}
            >
              <span>{option.label}</span>
              <strong>{count}</strong>
            </button>
          )
        })}
      </nav>

      <div className="decision-desk__command">
        <label>
          <Search size={16} aria-hidden="true" />
          <span className="iw-sr-only">Search surfaced signals</span>
          <input
            type="search"
            value={search}
            placeholder="Filter players, teams, or evidence…"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear signal search"
              onClick={() => setSearch('')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <span role="status" aria-live="polite">
          {normalizedSearch
            ? `${visibleMatches} matching ${
                visibleMatches === 1 ? 'signal' : 'signals'
              }`
            : 'Select a subject to inspect its native evidence.'}
        </span>
      </div>

      <div
        className={
          `decision-desk__queues ${
            focus === 'all' || normalizedSearch
              ? ''
              : 'decision-desk__queues--focused'
          }`
        }
      >
        {queues.map((queue) => {
          const expanded = expandedQueueIds.has(queue.id)
          const displayedItems = expanded || normalizedSearch
            ? queue.items
            : queue.items.slice(0, INITIAL_QUEUE_ITEMS)
          return (
            <section
              className={`decision-queue decision-queue--${queue.id}`}
              key={queue.id}
              aria-labelledby={`decision-queue-${queue.id}`}
            >
              <header>
                <div>
                  <span>{queue.eyebrow}</span>
                  <h3 id={`decision-queue-${queue.id}`}>
                    {queue.title}
                  </h3>
                </div>
                <strong aria-label={`${queue.items.length} matches`}>
                  {queue.items.length}
                </strong>
              </header>
              <div className="decision-queue__rule">
                <strong>Rule</strong>
                <span>{queue.rule}</span>
                <p>{queue.interpretation}</p>
              </div>

              {displayedItems.length > 0 ? (
                <ol className="decision-queue__items">
                  {displayedItems.map((item) => (
                    <li key={item.id}>
                      <a href={item.href}>
                        <span className="decision-queue__identity">
                          <strong>{item.playerName}</strong>
                          <small>
                            {titleLabel(item.sport)} · {item.position} ·{' '}
                            {item.teamName}
                          </small>
                        </span>
                        <span className="decision-queue__signals">
                          {item.it ? (
                            <span
                              className={`decision-it decision-it--${item.it.tier}`}
                              aria-label={`${titleLabel(item.it.tier)} IT, score ${item.it.score}`}
                            >
                              <Sparkles size={10} aria-hidden="true" />
                              IT {item.it.score}
                            </span>
                          ) : (
                            <span className="decision-it decision-it--market">
                              MARKET
                            </span>
                          )}
                          <span className="decision-native">
                            <strong>{item.nativeSignal.value}</strong>
                            <small>{item.nativeSignal.detail}</small>
                          </span>
                        </span>
                        <span
                          className="decision-queue__evidence"
                          aria-label="Signal evidence"
                        >
                          {item.evidence.map((evidence) => (
                            <small key={evidence}>{evidence}</small>
                          ))}
                        </span>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="decision-queue__empty">
                  {normalizedSearch
                    ? 'No surfaced subject in this lane matches the filter.'
                    : 'No current subjects satisfy this rule.'}
                </p>
              )}

              <footer>
                {!normalizedSearch &&
                queue.items.length > INITIAL_QUEUE_ITEMS ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleQueue(queue.id)}
                  >
                    {expanded
                      ? 'Show top six'
                      : `Show all ${queue.items.length}`}
                  </button>
                ) : <span />}
                <a href={queue.sourceBoardHref}>
                  {queue.sourceBoardLabel}
                  <ArrowUpRight size={11} aria-hidden="true" />
                </a>
              </footer>
            </section>
          )
        })}
      </div>

      <aside className="decision-desk__freshness">
        <strong>Independent evidence clocks</strong>
        <span>Market through {marketDataThrough ?? '—'}</span>
        <span>Path through {graduationDataThrough ?? '—'}</span>
        <span>IT reviewed {itReviewedAsOf ?? '—'}</span>
        {coverageLimitations.length > 0 ? (
          <details>
            <summary>Method &amp; coverage notes</summary>
            <ul>
              {coverageLimitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </div>
  )
}
