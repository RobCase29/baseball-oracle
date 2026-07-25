import type { MagnificentXResearchPosture } from '../domain/hobbyMasterRanking'
import type { BinderGraduationSport } from '../domain/binderGraduationIndexV2'

export type HobbyResearchLens = 'market' | 'players'
export type PlayerRankingSport = BinderGraduationSport | 'all'

interface ResearchLensTabsProps {
  lens: HobbyResearchLens
  posture: MagnificentXResearchPosture | 'all'
  playerSport: PlayerRankingSport
  showRefresh: boolean
  onMarketSelect: () => void
  onPlayerRankingsSelect: () => void
  onPlayerSportSelect: (value: PlayerRankingSport) => void
  onPostureSelect: (value: MagnificentXResearchPosture | 'all') => void
}

const postureOptions: ReadonlyArray<{
  value: MagnificentXResearchPosture | 'all'
  shortLabel: string
  label: string
}> = [
  {
    value: 'build_candidate',
    shortLabel: 'Build',
    label: 'Build Board qualifiers',
  },
  {
    value: 'hold_candidate',
    shortLabel: 'Near Build',
    label: 'Near-Build candidates',
  },
  { value: 'watch', shortLabel: 'Watch', label: 'Watch' },
  { value: 'risk_review', shortLabel: 'Risk', label: 'Risk review' },
  { value: 'pass', shortLabel: 'Pass', label: 'Pass' },
  { value: 'unrated', shortLabel: 'Unrated', label: 'Unrated' },
  { value: 'all', shortLabel: 'All', label: 'All evidence' },
]

export function ResearchLensTabs({
  lens,
  posture,
  playerSport,
  showRefresh,
  onMarketSelect,
  onPlayerRankingsSelect,
  onPlayerSportSelect,
  onPostureSelect,
}: ResearchLensTabsProps) {
  return (
    <div
      className="iw-research-nav"
      aria-label="Backstop Binder Index views"
    >
      <div
        className="iw-mode-tabs"
        role="group"
        aria-label="Binder Index board"
      >
        <button
          type="button"
          aria-pressed={lens === 'market'}
          aria-label="Build Board. Subjects that cleared the standard."
          onClick={onMarketSelect}
        >
          <span className="iw-mode-title">Build Board</span>
          <br />
          <small className="iw-mode-description">
            Cleared the standard
          </small>
        </button>
        <button
          type="button"
          aria-pressed={lens === 'players'}
          aria-label="Graduation Board. Players projected to earn Build."
          onClick={onPlayerRankingsSelect}
        >
          <span className="iw-mode-title">Graduation Board</span>
          <br />
          <small className="iw-mode-description">
            Projected path to Build
          </small>
        </button>
      </div>

      {lens === 'market' ? (
        <div
          className="iw-posture-tabs"
          role="group"
          aria-label="Build Board status"
        >
          {postureOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={posture === option.value}
              aria-label={option.label}
              title={option.label}
              onClick={() => onPostureSelect(option.value)}
            >
              {option.shortLabel}
            </button>
          ))}
          {showRefresh ? (
            <span className="iw-tab-status" role="status">
              Build Board suspended · refresh queue shown
            </span>
          ) : null}
        </div>
      ) : (
        <div
          className="iw-sport-tabs"
          role="group"
          aria-label="Graduation Board sport"
        >
          <button
            type="button"
            aria-pressed={playerSport === 'all'}
            aria-label="Show the global baseball, football, and basketball graduation ranking"
            onClick={() => onPlayerSportSelect('all')}
          >
            All sports
          </button>
          <button
            type="button"
            aria-pressed={playerSport === 'baseball'}
            aria-label="Show baseball graduation candidates"
            onClick={() => onPlayerSportSelect('baseball')}
          >
            Baseball
          </button>
          <button
            type="button"
            aria-pressed={playerSport === 'football'}
            aria-label="Show football graduation candidates"
            onClick={() => onPlayerSportSelect('football')}
          >
            Football
          </button>
          <button
            type="button"
            aria-pressed={playerSport === 'basketball'}
            aria-label="Show basketball graduation candidates"
            onClick={() => onPlayerSportSelect('basketball')}
          >
            Basketball
          </button>
        </div>
      )}
    </div>
  )
}
