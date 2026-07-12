interface ProbabilityRingProps {
  value: number
  label: string
  size?: 'small' | 'large'
}

export function ProbabilityRing({
  value,
  label,
  size = 'large',
}: ProbabilityRingProps) {
  const boundedValue = Math.min(100, Math.max(0, value))
  const displayValue = Number.isInteger(boundedValue)
    ? boundedValue.toFixed(0)
    : boundedValue.toFixed(1)

  return (
    <div
      className={`probability-ring probability-ring--${size}`}
      style={{ '--probability': `${boundedValue * 3.6}deg` } as React.CSSProperties}
      role="img"
      aria-label={`${label}: ${displayValue}%`}
    >
      <div>
        <strong>{displayValue}%</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}
