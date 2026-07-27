import type {
  BinderAction,
  BinderScoreFeedItem,
  BinderScoresResponse,
} from '../domain/binderScore'

export type BinderStageFilter = 'All' | 'Minors' | 'RC' | 'MLB'

export interface BinderBoardProps {
  items: BinderScoreFeedItem[]
  response: Pick<BinderScoresResponse, 'snapshot' | 'meta'> | null
  page: BinderScoresResponse['page']
  loading: boolean
  error: string | null
  query: string
  stage: BinderStageFilter
  selectedId: string | null
  openingPlayerId?: string | null
  selectionError?: string | null
  onQueryChange: (query: string) => void
  onStageChange: (stage: BinderStageFilter) => void
  onPageChange: (page: number) => void
  onSelect: (playerId: string) => void
}

const stageOptions: ReadonlyArray<{ value: BinderStageFilter; label: string }> = [
  { value: 'All', label: 'All stages' },
  { value: 'Minors', label: 'Prospects' },
  { value: 'RC', label: 'Rookie Track' },
  { value: 'MLB', label: 'MLB' },
]

const actionLabels: Record<BinderAction, string> = {
  build: 'Build',
  core_hold: 'Core hold',
  watch: 'Watch',
  trim_hype: 'Trim hype',
  pass: 'Pass',
  insufficient_evidence: 'Evidence needed',
}

function scoreLabel(value: number | null): string {
  return value === null ? '—' : Math.round(value).toString()
}

function percentLabel(value: number): string {
  return `${Math.round(value)}%`
}

function routeLabel(route: BinderScoreFeedItem['player']['stage']): string {
  const labels: Record<BinderScoreFeedItem['player']['stage'], string> = {
    pre_debut: 'Pre-debut',
    post_debut_minors: 'Post-debut minors',
    recent_callup: 'Recent call-up',
    early_mlb: 'Early MLB',
    established_mlb: 'Established MLB',
    inactive: 'Inactive',
  }
  return labels[route]
}

function dateLabel(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

function monthLabel(value: string): string {
  const yearMonth = /^(\d{4})-(\d{2})/u.exec(value)
  const parsed = yearMonth
    ? new Date(`${yearMonth[1]}-${yearMonth[2]}-01T00:00:00Z`)
    : new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parsed)
}

export function BinderBoard({
  items,
  response,
  page,
  loading,
  error,
  query,
  stage,
  selectedId,
  openingPlayerId = null,
  selectionError = null,
  onQueryChange,
  onStageChange,
  onPageChange,
  onSelect,
}: BinderBoardProps) {
  const hasPreviousPage = page.page > 1
  const hasNextPage = page.page < page.totalPages
  const snapshot = response?.snapshot ?? null

  return (
    <section
      id="binder-board"
      className="board-panel binder-board"
      aria-labelledby="binder-board-title"
      aria-busy={loading}
    >
      <div className="board-heading">
        <div>
          <span className="eyebrow">LONG-TERM COLLECTION RESEARCH</span>
          <h2 id="binder-board-title">Baseball Collection Thesis</h2>
        </div>
        <div className="board-heading-actions">
          <span className="record-count">
            {loading ? 'Refreshing · ' : ''}
            {page.total.toLocaleString()} players
          </span>
        </div>
      </div>

      <div
        className="board-filters"
        role="group"
        aria-label="Baseball Collection Thesis filters"
      >
        <label className="search-field">
          <span className="sr-only">Search players</span>
          <input
            type="search"
            value={query}
            placeholder="Search player"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
        </label>
        <div
          className="segmented-control stage-control"
          role="group"
          aria-label="Career stage"
        >
          {stageOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={stage === option.value ? 'is-active' : ''}
              aria-pressed={stage === option.value}
              onClick={() => onStageChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="directory-notice" role="note">
        <div>
          <strong>Research signal, not a price forecast.</strong>{' '}
          GemRate measures athlete-level completed eBay singles sales volume, not card
          appreciation or card-level scarcity/value. Unique name-only matches are
          provisional, and comparisons across career stages are heuristic.
          {snapshot ? (
            <>
              {' '}Market data runs through{' '}
              <time dateTime={snapshot.marketDataThrough}>
                {monthLabel(snapshot.marketDataThrough)}
              </time>
              {' '}and refreshes monthly. Published{' '}
              <time dateTime={snapshot.marketPublishedAt}>
                {dateLabel(snapshot.marketPublishedAt)}
              </time>
              {' '}· freshness {snapshot.marketFreshness.status}.
              {' '}The completed-season baseball model is{' '}
              {snapshot.baseballFreshness.status}.
              {' '}Next monthly update expected by{' '}
              <time dateTime={snapshot.marketFreshness.nextExpectedBy}>
                {dateLabel(snapshot.marketFreshness.nextExpectedBy)}
              </time>
              .
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="board-inline-error" role="alert">
          <strong>Binder rankings unavailable.</strong> {error}
        </div>
      ) : null}
      {selectionError ? (
        <div className="board-inline-error" role="alert">
          <strong>Player detail unavailable.</strong> {selectionError}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="board-table-wrap">
          <table className="board-table binder-board-table">
            <caption className="sr-only">
              Baseball Collection Thesis player rankings. Higher scores indicate a stronger long-term
              collection research thesis within this model version and market cohort.
            </caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Thesis Score</th>
                <th scope="col">Guidance</th>
                <th scope="col">Baseball Thesis</th>
                <th scope="col">Collector Demand</th>
                <th scope="col">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const assessment = item.assessment
                const isOpening = openingPlayerId === item.player.id
                return (
                  <tr
                    key={item.player.id}
                    className={selectedId === item.player.id ? 'is-selected' : ''}
                  >
                    <td>
                      <button
                        type="button"
                        className="player-cell"
                        aria-label={
                          isOpening
                            ? `Opening Baseball Collection Thesis research for ${item.player.name}`
                            : `Open Baseball Collection Thesis research for ${item.player.name}`
                        }
                        aria-current={selectedId === item.player.id ? 'true' : undefined}
                        disabled={isOpening}
                        onClick={() => onSelect(item.player.id)}
                      >
                        <span>
                          <strong>{item.player.name}</strong>
                          <small>
                            {[
                              item.player.position,
                              item.player.organizationCode ?? item.player.organization,
                              item.player.age === null ? null : `Age ${item.player.age}`,
                              routeLabel(item.player.stage),
                            ].filter(Boolean).join(' · ')}
                          </small>
                        </span>
                        <span aria-hidden="true">{isOpening ? '…' : '›'}</span>
                      </button>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {scoreLabel(assessment.score)}
                      </strong>
                      <small>out of 100</small>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {actionLabels[assessment.action]}
                      </strong>
                      <small>research guidance</small>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {scoreLabel(assessment.components.baseballThesis.score)}
                      </strong>
                      <small>75% of score</small>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {scoreLabel(assessment.components.collectorDemand.score)}
                      </strong>
                      <small>25% of score</small>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {percentLabel(assessment.confidence.score)}
                      </strong>
                      <small>{assessment.confidence.band}</small>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="empty-state" role="status">
          <strong>No matching Binder candidates</strong>
          <span>Adjust the player search or career-stage filter.</span>
        </div>
      ) : null}
      {loading && items.length === 0 ? (
        <div className="empty-state" role="status">
          <strong>Refreshing Binder research</strong>
          <span>Loading the latest baseball and collector-demand evidence.</span>
        </div>
      ) : null}

      {page.totalPages > 1 ? (
        <nav
          className="board-pagination"
          aria-label="Baseball Collection Thesis results pages"
        >
          <button
            type="button"
            className="icon-button"
            disabled={!hasPreviousPage || loading}
            onClick={() => onPageChange(page.page - 1)}
          >
            Previous
          </button>
          <span>
            Page <strong>{page.page}</strong> of {page.totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            className="icon-button"
            disabled={!hasNextPage || loading}
            onClick={() => onPageChange(page.page + 1)}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  )
}
