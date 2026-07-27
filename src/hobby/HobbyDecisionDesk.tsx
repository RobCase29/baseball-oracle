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

const INITIAL_QUEUE_ITEMS = 5

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
  const [search, setSearch] = useState('')
  const [expandedQueueIds, setExpandedQueueIds] = useState<Set<string>>(
    () => new Set(),
  )
  const normalizedSearch = search.trim().toLocaleLowerCase('en-US')
  const queues = useMemo(
    () => desk?.queues.map((queue) => (
      queueMatches(queue, normalizedSearch)
    )) ?? [],
    [desk, normalizedSearch],
  )
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
        Connecting Market, Path, Narrative, Momentum, and Risk…
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
            CROSS-SIGNAL RESEARCH
          </span>
          <h2>See where the app agrees—and where it doesn’t</h2>
          <p>
            Every queue is a transparent intersection of existing models.
            Native ranks stay native: no blended score, hidden weighting, or
            implied buy/sell recommendation.
          </p>
        </div>
        <dl>
          <div>
            <dt>Signal matches</dt>
            <dd>{desk.intersectionCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Decision queues</dt>
            <dd>{desk.queues.length}</dd>
          </div>
        </dl>
      </section>

      <div className="decision-desk__command">
        <label>
          <Search size={16} aria-hidden="true" />
          <span className="iw-sr-only">Search surfaced intersections</span>
          <input
            type="search"
            value={search}
            placeholder="Filter surfaced players, teams, or signals…"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear intersection search"
              onClick={() => setSearch('')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <span role="status" aria-live="polite">
          {normalizedSearch
            ? `${visibleMatches} matching signal ${
                visibleMatches === 1 ? 'intersection' : 'intersections'
              }`
            : 'Select a player to inspect the evidence on its source board.'}
        </span>
      </div>

      <div className="decision-desk__queues">
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
                          <span
                            className={`decision-it decision-it--${item.it.tier}`}
                            aria-label={`${titleLabel(item.it.tier)} IT, score ${item.it.score}`}
                          >
                            <Sparkles size={10} aria-hidden="true" />
                            IT {item.it.score}
                          </span>
                          <span className="decision-native">
                            <strong>{item.nativeSignal.value}</strong>
                            <small>{item.nativeSignal.detail}</small>
                          </span>
                        </span>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="decision-queue__empty">
                  {normalizedSearch
                    ? 'No surfaced player in this queue matches the filter.'
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
                      ? 'Show top five'
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
            <summary>Coverage notes</summary>
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
