import type { MagnificentXResearchPosture } from '../domain/magnificentX'

export type HobbyResearchLens = 'market' | 'players'
export type PlayerRankingSport = 'baseball' | 'football' | 'basketball'

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
  { value: 'build_candidate', shortLabel: 'Build', label: 'Build candidates' },
  { value: 'hold_candidate', shortLabel: 'Core Hold', label: 'Core hold candidates' },
  { value: 'watch', shortLabel: 'Watch', label: 'Watch' },
  { value: 'risk_review', shortLabel: 'Risk Review', label: 'Risk review' },
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
    <div className="iw-research-nav" aria-label="Investor workbench views">
      <div className="iw-mode-tabs" role="group" aria-label="Research mode">
        <button
          type="button"
          aria-pressed={lens === 'market'}
          onClick={onMarketSelect}
        >
          Positions
        </button>
        <button
          type="button"
          aria-pressed={lens === 'players'}
          onClick={onPlayerRankingsSelect}
        >
          Player Rankings
        </button>
      </div>

      {lens === 'market' ? (
        <div
          className="iw-posture-tabs"
          role="group"
          aria-label="Research posture"
        >
          {postureOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={posture === option.value}
              title={option.label}
              onClick={() => onPostureSelect(option.value)}
            >
              {option.shortLabel}
            </button>
          ))}
          {showRefresh ? (
            <span className="iw-tab-status" role="status">
              Build rank suspended · refresh queue shown
            </span>
          ) : null}
        </div>
      ) : (
        <div
          className="iw-sport-tabs"
          role="group"
          aria-label="Player ranking sport"
        >
          <button
            type="button"
            aria-pressed={playerSport === 'baseball'}
            onClick={() => onPlayerSportSelect('baseball')}
          >
            Baseball
          </button>
          <button
            type="button"
            aria-pressed={playerSport === 'football'}
            onClick={() => onPlayerSportSelect('football')}
          >
            Football
          </button>
          <button
            type="button"
            aria-pressed={playerSport === 'basketball'}
            onClick={() => onPlayerSportSelect('basketball')}
          >
            Basketball
          </button>
        </div>
      )}
    </div>
  )
}
