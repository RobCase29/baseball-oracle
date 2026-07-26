import { useEffect, useId, useRef } from 'react'
import { Search, X } from 'lucide-react'
import type { HobbyResearchLens } from './ResearchLensTabs'
import './global-board-search.css'

interface GlobalBoardSearchProps {
  lens: HobbyResearchLens
  value: string
  loading: boolean
  resultCount: number | null
  onChange: (value: string) => void
}

export function GlobalBoardSearch({
  lens,
  value,
  loading,
  resultCount,
  onChange,
}: GlobalBoardSearchProps) {
  const inputId = useId()
  const helperId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const searching = value.trim().length > 0
  const market = lens === 'market'
  const accessibleLabel = market
    ? 'Search every subject'
    : 'Search every graduation candidate'

  useEffect(() => {
    function focusSearch(event: KeyboardEvent): void {
      const target = event.target
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (
          target instanceof HTMLElement &&
          target.isContentEditable
        )
      const slashShortcut =
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      const commandShortcut =
        event.key.toLocaleLowerCase('en-US') === 'k' &&
        (event.metaKey || event.ctrlKey)
      if (editing || (!slashShortcut && !commandShortcut)) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  return (
    <section
      className={`bbi-global-search${searching ? ' is-searching' : ''}`}
      role="search"
      aria-label="Binder Index global search"
      aria-busy={loading && searching}
    >
      <div className="bbi-global-search__heading">
        <span>Find anyone</span>
        <strong>
          {market ? 'Search the entire hobby' : 'Search the entire pipeline'}
        </strong>
      </div>

      <div className="bbi-global-search__field">
        <label className="iw-sr-only" htmlFor={inputId}>
          {accessibleLabel}
        </label>
        <Search size={19} aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={value}
          placeholder={
            market
              ? 'Search any player or Pokémon…'
              : 'Search any graduation candidate…'
          }
          aria-describedby={helperId}
          autoComplete="off"
          enterKeyHint="search"
          spellCheck={false}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {searching ? (
          <button
            type="button"
            className="bbi-global-search__clear"
            aria-label={`Clear ${accessibleLabel.toLocaleLowerCase('en-US')}`}
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : (
          <kbd aria-hidden="true">/</kbd>
        )}
      </div>

      <div className="bbi-global-search__context" id={helperId}>
        <span className="bbi-global-search__scope">
          {market ? 'All labels · all sports' : 'All paths · all sports'}
        </span>
        <span>
          {market
            ? 'Build, Near Build, Watch, Risk, Pass, and Unrated are searched together.'
            : 'Age, position, sport, and graduation-path screens clear automatically.'}
        </span>
        {searching ? (
          <strong role="status" aria-live="polite">
            {loading
              ? 'Searching…'
              : `${(resultCount ?? 0).toLocaleString()} ${
                  resultCount === 1 ? 'match' : 'matches'
                }`}
          </strong>
        ) : null}
      </div>
    </section>
  )
}
