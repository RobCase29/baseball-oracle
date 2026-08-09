import { Sparkles } from 'lucide-react'
import type { ItFactorBadgeEntry } from '../domain/itFactor'
import './it-factor-badge.css'

interface ItFactorBadgeProps {
  entry: ItFactorBadgeEntry | null
  compact?: boolean
  href?: string
}

const tierLabels: Record<ItFactorBadgeEntry['tier'], string> = {
  icon: 'Icon',
  high: 'High IT',
  emerging: 'Emerging IT',
  watch: 'IT Watch',
}

export function ItFactorBadge({
  entry,
  compact = false,
  href,
}: ItFactorBadgeProps) {
  if (!entry) return null
  const label =
    `${tierLabels[entry.tier]} · IT ${entry.score} · ` +
    `${entry.confidence}% classification confidence`
  const className = `it-badge it-badge--${entry.tier}${
    compact ? ' it-badge--compact' : ''
  }`
  const content = (
    <>
      <Sparkles size={11} aria-hidden="true" />
      <span aria-hidden="true">IT</span>
      {!compact ? <strong aria-hidden="true">{entry.score}</strong> : null}
    </>
  )
  if (href) {
    return (
      <a
        className={className}
        href={href}
        title={label}
        aria-label={`Open IT Board for ${entry.player.name}. ${label}.`}
      >
        {content}
      </a>
    )
  }
  return (
    <span
      className={className}
      title={label}
      role="img"
      aria-label={label}
    >
      {content}
    </span>
  )
}
