import type { KeyboardEvent } from 'react'
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PlayerRecord } from '../domain/forecast'
import {
  buildMilbOpportunityPoints,
  type MilbOpportunityPoint,
} from './milbVisualizationData'

interface MilbOpportunityMapProps {
  players: PlayerRecord[]
  selectedId: string | null
  onSelect: (playerId: string) => void
}

interface OpportunityTooltipProps {
  active?: boolean
  payload?: Array<{ payload?: MilbOpportunityPoint }>
}

interface OpportunityDotProps {
  cx?: number
  cy?: number
  payload?: MilbOpportunityPoint
  selectedId: string | null
  onSelect: (playerId: string) => void
}

function formatPercentile(value: number): string {
  const digits = value >= 99.9 ? 2 : value >= 99 ? 1 : 0
  return `P${value.toFixed(digits)}`
}

function OpportunityTooltip({ active, payload }: OpportunityTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="chart-tooltip opportunity-map-tooltip">
      <strong>{point.name}</strong>
      <span>{point.organization} · {point.position} · {point.playerType} · {point.level}</span>
      <span>Impact: #{point.impactRank.toLocaleString()} of {point.impactUniverse.toLocaleString()} ({formatPercentile(point.impactPercentile)})</span>
      <span>Younger than {point.ageAdvantage.toFixed(0)}% of historical role/level peers</span>
      <span>Frozen arrival gate: {point.arrivalGateCleared ? 'cleared' : 'not cleared'}</span>
      <span>Current trait corroboration: {point.traitCorroborated ? 'cleared' : 'not cleared'}</span>
      {point.tier === 'context' ? null : <span>Dual-gate tier: {point.tier}</span>}
      <small>Ordinal research evidence · raw impact probability withheld</small>
    </div>
  )
}

function OpportunityDot({
  cx,
  cy,
  payload,
  selectedId,
  onSelect,
}: OpportunityDotProps) {
  if (cx === undefined || cy === undefined || !payload) return null
  const selected = payload.playerId === selectedId
  const cleared = payload.tier !== 'context'

  const selectPoint = () => onSelect(payload.playerId)
  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectPoint()
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${payload.name}, ${payload.playerType}, impact ${formatPercentile(payload.impactPercentile)}, younger than ${payload.ageAdvantage.toFixed(0)} percent of historical role and level peers`}
      onClick={selectPoint}
      onKeyDown={handleKeyDown}
      style={{ cursor: 'pointer' }}
    >
      {selected ? (
        <circle cx={cx} cy={cy} r={10} fill="none" stroke="var(--orange)" strokeWidth={2} />
      ) : null}
      {payload.playerType === 'Pitcher' ? (
        <rect
          x={cx - 4}
          y={cy - 4}
          width={8}
          height={8}
          rx={1}
          fill={cleared ? 'var(--gold)' : 'var(--line-strong)'}
          fillOpacity={cleared ? 0.94 : 0.65}
          stroke={payload.traitCorroborated ? 'var(--ink)' : 'var(--paper)'}
          strokeWidth={payload.traitCorroborated ? 2 : 1.5}
          transform={`rotate(45 ${cx} ${cy})`}
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={selected ? 6 : 5}
          fill={cleared ? 'var(--green)' : 'var(--line-strong)'}
          fillOpacity={cleared ? 0.92 : 0.65}
          stroke={payload.traitCorroborated ? 'var(--ink)' : 'var(--paper)'}
          strokeWidth={payload.traitCorroborated ? 2 : 1.5}
        />
      )}
    </g>
  )
}

export function MilbOpportunityMap({ players, selectedId, onSelect }: MilbOpportunityMapProps) {
  const points = buildMilbOpportunityPoints(players)
  const minorCount = players.filter((player) => player.stage === 'pre_debut').length
  const omittedCount = Math.max(0, minorCount - points.length)
  const selectedPoint = points.find((point) => point.playerId === selectedId) ?? null
  const minimumImpact = points.length > 0
    ? Math.min(...points.map((point) => point.impactPercentile))
    : 0
  const minimumAgeAdvantage = points.length > 0
    ? Math.min(...points.map((point) => point.ageAdvantage))
    : 0
  const impactDomainMinimum = minimumImpact >= 95
    ? Math.max(90, Math.floor(minimumImpact) - 1)
    : minimumImpact >= 90
      ? 90
      : Math.max(0, Math.floor(minimumImpact / 10) * 10)
  const ageDomainMinimum = minimumAgeAdvantage >= 60
    ? Math.max(0, Math.floor(minimumAgeAdvantage / 10) * 10 - 10)
    : 0
  const impactTicks = [
    impactDomainMinimum,
    impactDomainMinimum + (100 - impactDomainMinimum) / 3,
    impactDomainMinimum + (100 - impactDomainMinimum) * 2 / 3,
    100,
  ]
  const ageTicks = [
    ageDomainMinimum,
    ageDomainMinimum + (100 - ageDomainMinimum) / 2,
    100,
  ]

  return (
    <section className="opportunity-map" aria-labelledby="opportunity-map-title">
      <div className="opportunity-map-heading">
        <div>
          <span className="eyebrow">DEVELOPMENT CONTEXT × DIRECT IMPACT RANK</span>
          <h3 id="opportunity-map-title">Ceiling landscape</h3>
        </div>
        <div className="opportunity-map-legend" aria-label="Plot legend">
          <span><i className="legend-dot legend-dot--hitter" aria-hidden="true" />Hitter</span>
          <span><i className="legend-diamond" aria-hidden="true" />Pitcher</span>
          <span><i className="legend-trait-ring" aria-hidden="true" />Trait corroboration</span>
          <span><i className="legend-ring" aria-hidden="true" />Selected</span>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="opportunity-map-empty" role="status">
          <strong>No comparable minor-league points</strong>
          <span>An exact frozen five-year impact rank and role/level age context are both required.</span>
        </div>
      ) : (
        <div
          className="opportunity-map-chart"
          role="group"
          aria-label="Minor-league five-year impact rank percentile plotted against level-relative age advantage"
          style={{ width: '100%', height: 330 }}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={260}>
            <ScatterChart margin={{ top: 16, right: 18, bottom: 32, left: 2 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" />
              <ReferenceArea y1={Math.max(90, impactDomainMinimum)} y2={100} fill="var(--green-soft)" fillOpacity={0.52} />
              {impactDomainMinimum <= 90 ? (
                <ReferenceLine
                  y={90}
                  stroke="var(--green)"
                  strokeDasharray="4 4"
                  label={{ value: 'IMPACT TOP DECILE', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 9 }}
                />
              ) : null}
              <XAxis
                type="number"
                dataKey="ageAdvantage"
                domain={[ageDomainMinimum, 100]}
                ticks={ageTicks}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                label={{
                  value: 'YOUNGER THAN HISTORICAL ROLE/LEVEL PEERS (%)',
                  position: 'insideBottom',
                  offset: -20,
                  fill: 'var(--muted)',
                  fontSize: 9,
                }}
              />
              <YAxis
                type="number"
                dataKey="impactPercentile"
                domain={[impactDomainMinimum, 100]}
                ticks={impactTicks}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                width={35}
                tickFormatter={(value: number) => value >= 99 ? value.toFixed(1) : `${Math.round(value)}`}
              />
              <Tooltip content={<OpportunityTooltip />} cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '3 3' }} />
              <Scatter
                data={points}
                isAnimationActive={false}
                shape={<OpportunityDot selectedId={selectedId} onSelect={onSelect} />}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="opportunity-map-footer">
        <span>{points.length.toLocaleString()} exact matches in loaded results{omittedCount > 0 ? ` · ${omittedCount.toLocaleString()} missing rank or age context` : ''}</span>
        <strong>Tail view P{impactDomainMinimum.toFixed(0)}–P100 · no probabilities blended</strong>
      </div>

      {selectedPoint ? (
        <div className="opportunity-map-selection" aria-live="polite">
          <strong>{selectedPoint.name}</strong>
          <span>
            #{selectedPoint.impactRank.toLocaleString()} impact · {formatPercentile(selectedPoint.impactPercentile)} · younger than {selectedPoint.ageAdvantage.toFixed(0)}% at {selectedPoint.level}
          </span>
        </div>
      ) : null}
    </section>
  )
}
