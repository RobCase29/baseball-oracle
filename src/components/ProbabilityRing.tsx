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
  return (
    <div
      className={`probability-ring probability-ring--${size}`}
      style={{ '--probability': `${value * 3.6}deg` } as React.CSSProperties}
      role="img"
      aria-label={`${label}: ${value}%`}
    >
      <div>
        <strong>{value}%</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}
