import type { MagnificentXResearchPosture } from '../domain/magnificentX'

export type HobbyResearchLens = 'market' | 'young'

interface ResearchLensTabsProps {
  lens: HobbyResearchLens
  posture: MagnificentXResearchPosture | 'all'
  showRefresh: boolean
  onYoungSelect: () => void
  onPostureSelect: (value: MagnificentXResearchPosture | 'all') => void
}

const postureOptions: ReadonlyArray<{
  value: MagnificentXResearchPosture | 'all'
  shortLabel: string
  label: string
}> = [
  { value: 'build_candidate', shortLabel: 'Build', label: 'Build candidates' },
  { value: 'hold_candidate', shortLabel: 'Hold', label: 'Hold candidates' },
  { value: 'watch', shortLabel: 'Watch', label: 'Watch' },
  { value: 'risk_review', shortLabel: 'Risk', label: 'Risk review' },
  { value: 'pass', shortLabel: 'Pass', label: 'Pass' },
  { value: 'unrated', shortLabel: 'Unrated', label: 'Unrated' },
  { value: 'needs_refresh', shortLabel: 'Refresh', label: 'Needs refresh' },
  { value: 'all', shortLabel: 'All', label: 'All evidence' },
]

export function ResearchLensTabs({
  lens,
  posture,
  showRefresh,
  onYoungSelect,
  onPostureSelect,
}: ResearchLensTabsProps) {
  return (
    <div
      className="iw-posture-tabs"
      role="group"
      aria-label="Research lens and posture"
    >
      {postureOptions
        .filter((option) => (
          option.value !== 'needs_refresh' || showRefresh
        ))
        .flatMap((option) => {
          const postureButton = (
            <button
              type="button"
              key={option.value}
              aria-pressed={lens === 'market' && posture === option.value}
              title={option.label}
              onClick={() => onPostureSelect(option.value)}
            >
              {option.shortLabel}
            </button>
          )

          if (option.value !== 'build_candidate') return [postureButton]
          return [
            postureButton,
            <button
              type="button"
              className="iw-young-tab"
              key="young"
              aria-pressed={lens === 'young'}
              title="Re-rank Oracle-aged baseball players"
              onClick={onYoungSelect}
            >
              Young players
            </button>,
          ]
        })}
    </div>
  )
}
