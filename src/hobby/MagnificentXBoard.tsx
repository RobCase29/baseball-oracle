import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
  Search,
} from 'lucide-react'
import type {
  MagnificentXDomain,
  MagnificentXFeedResponse,
  MagnificentXResearchTier,
} from '../domain/magnificentX'
import { SubjectCard } from './SubjectCard'

export type MagnificentXDomainFilter = MagnificentXDomain | 'all'
export type MagnificentXTierFilter = MagnificentXResearchTier | 'all'

interface MagnificentXBoardProps {
  response: MagnificentXFeedResponse | null
  loading: boolean
  error: string | null
  search: string
  domain: MagnificentXDomainFilter
  tier: MagnificentXTierFilter
  page: number
  onSearchChange: (value: string) => void
  onDomainChange: (value: MagnificentXDomainFilter) => void
  onTierChange: (value: MagnificentXTierFilter) => void
  onPageChange: (value: number) => void
  onReset: () => void
}

const domainOptions: ReadonlyArray<{
  value: MagnificentXDomainFilter
  label: string
}> = [
  { value: 'all', label: 'All provider cohorts' },
  { value: 'baseball', label: 'Baseball' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'football', label: 'Football' },
  { value: 'soccer', label: 'Soccer' },
  { value: 'hockey', label: 'Hockey' },
  { value: 'combat', label: 'Combat & wrestling' },
  { value: 'golf', label: 'Golf' },
  { value: 'other_sport', label: 'Other sports' },
  { value: 'mixed_sport', label: 'Mixed sports' },
  { value: 'pokemon', label: 'Pokémon characters' },
  { value: 'culture', label: 'Culture · outside scope' },
]

const tierOptions: ReadonlyArray<{
  value: MagnificentXTierFilter
  label: string
}> = [
  { value: 'all', label: 'All research tiers' },
  { value: 'market_leader', label: 'Market leader' },
  { value: 'durable_demand', label: 'Durable demand' },
  { value: 'watch', label: 'Watch' },
  { value: 'noise_risk', label: 'Noise risk' },
  { value: 'long_tail', label: 'Long tail' },
  { value: 'evidence_needed', label: 'Evidence needed' },
]

function domainLabel(value: MagnificentXDomain): string {
  return domainOptions.find((option) => option.value === value)?.label ?? value
}

export function MagnificentXBoard({
  response,
  loading,
  error,
  search,
  domain,
  tier,
  page,
  onSearchChange,
  onDomainChange,
  onTierChange,
  onPageChange,
  onReset,
}: MagnificentXBoardProps) {
  const items = response?.items ?? []
  const pagination = response?.page ?? {
    page,
    limit: 24,
    total: 0,
    totalPages: 0,
  }
  const visibleCohorts = (response?.cohorts ?? []).filter(
    (cohort) => domain === 'all' || cohort.domain === domain,
  )
  const filtersActive = search.length > 0 || domain !== 'all' || tier !== 'all'

  return (
    <section
      className="mx-board"
      aria-labelledby="mx-board-title"
      aria-busy={loading}
    >
      <header className="mx-board-header">
        <div>
          <span className="mx-kicker">CROSS-HOBBY RESEARCH QUEUE</span>
          <h2 id="mx-board-title">Provisional market signals</h2>
          <p>
            {domain === 'all'
              ? 'The All view interleaves subjects using their within-cohort ranks; it is not a cross-hobby global ordering.'
              : 'Ranked by signal strength only inside this provider-defined cohort. Cross-hobby global ranking remains unavailable.'}
          </p>
        </div>
        <div className="mx-result-count" aria-live="polite">
          <span>{pagination.total.toLocaleString()}</span>
          matching subjects
        </div>
      </header>

      <div className="mx-filters" role="group" aria-label="Magnificent X filters">
        <label className="mx-search-field">
          <span>Search subjects</span>
          <span className="mx-input-shell">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              placeholder="Athlete or Pokémon"
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
          </span>
        </label>
        <label>
          <span>Provider cohort</span>
          <select
            value={domain}
            onChange={(event) => {
              onDomainChange(event.currentTarget.value as MagnificentXDomainFilter)
            }}
          >
            {domainOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Research tier</span>
          <select
            value={tier}
            onChange={(event) => {
              onTierChange(event.currentTarget.value as MagnificentXTierFilter)
            }}
          >
            {tierOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="mx-reset-button"
          disabled={!filtersActive}
          onClick={onReset}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset
        </button>
      </div>

      {visibleCohorts.length > 0 ? (
        <div className="mx-cohort-ledger" aria-label="Provider cohort coverage">
          {visibleCohorts.map((cohort) => (
            <div key={`${cohort.domain}:${cohort.taxonomyStatus}`}>
              <span>{domainLabel(cohort.domain)}</span>
              <strong>{cohort.subjectCount.toLocaleString()}</strong>
              <small>
                {cohort.marketLeaderCount} provisional market leader
                {cohort.marketLeaderCount === 1 ? '' : 's'} · 0 designated
              </small>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mx-message mx-message--error" role="alert">
          <AlertTriangle size={19} aria-hidden="true" />
          <div>
            <strong>Research feed unavailable</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="mx-message" role="status">
          <LoaderCircle className="mx-spin" size={20} aria-hidden="true" />
          <div>
            <strong>Separating signal from noise</strong>
            <span>Loading current cohort evidence and withholding gates.</span>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className={`mx-card-grid${loading ? ' is-refreshing' : ''}`}>
          {items.map((item) => (
            <SubjectCard key={item.subject.id} item={item} />
          ))}
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="mx-empty-state" role="status">
          <span aria-hidden="true">∅</span>
          <strong>No subjects match this evidence screen</strong>
          <p>Broaden the cohort, tier, or search term. No missing row is treated as zero.</p>
          {filtersActive ? (
            <button type="button" onClick={onReset}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {pagination.totalPages > 1 ? (
        <nav className="mx-pagination" aria-label="Magnificent X results pages">
          <button
            type="button"
            disabled={loading || pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Previous
          </button>
          <span>
            Page <strong>{pagination.page}</strong> of{' '}
            {pagination.totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
          >
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  )
}
