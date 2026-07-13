import type { KeyboardEvent } from 'react'
import {
  CartesianGrid,
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
  careerIndexChartDomain,
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

function formatCareerIndex(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function formatTopPercent(value: number): string {
  const digits = value < 0.1 ? 2 : value < 10 ? 1 : 0
  const factor = 10 ** digits
  const conservativeValue = Math.ceil(value * factor) / factor
  return `Top ${conservativeValue.toFixed(digits)}%`
}

function OpportunityTooltip({ active, payload }: OpportunityTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="chart-tooltip opportunity-map-tooltip">
      <strong>{point.name}</strong>
      <span>{point.organization} · {point.position} · {point.playerType} · {point.level}</span>
      <span>Career Index: {formatCareerIndex(point.careerIndex)}</span>
      <span>Stage standing: #{point.stageRank.toLocaleString()} of {point.stageUniverse.toLocaleString()} · {formatTopPercent(point.stageTopPercent)} ({point.stageTailBand})</span>
      <span>Current data: {point.coveredPillars} of {point.totalPillars} areas ({point.evidenceCoverage.toFixed(0)}%)</span>
      <span>Playing time: {point.sampleSummary} · {point.sampleState}</span>
      {point.missingPillars.length > 0 ? <span>Data still needed: {point.missingPillars.join(', ')}</span> : null}
      {point.ageAdvantage === null
        ? <span>Age comparison is not available</span>
        : <span>Younger than {point.ageAdvantage.toFixed(0)}% of similar historical players</span>}
      <span>MLB readiness: {point.arrivalGateCleared ? 'confirmed by the separate model' : 'not yet confirmed'}</span>
      <span>Current stats support outlook: {point.traitCorroborated ? 'yes' : 'not yet'}</span>
      <small>Data coverage measures completeness and does not change the Career Index.</small>
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
  const ageContext = payload.ageAdvantage === null
    ? 'age comparison unavailable'
    : `younger than ${payload.ageAdvantage.toFixed(0)} percent of similar historical players`

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
      aria-label={`${payload.name}, ${payload.playerType}, Career Index ${formatCareerIndex(payload.careerIndex)}, ${payload.stageTailBand} stage standing, ${payload.evidenceCoverage.toFixed(0)} percent current data coverage, ${ageContext}`}
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
          fill="var(--gold)"
          fillOpacity={cleared ? 0.94 : 0.52}
          stroke={payload.traitCorroborated ? 'var(--ink)' : 'var(--paper)'}
          strokeWidth={payload.traitCorroborated ? 2 : 1.5}
          transform={`rotate(45 ${cx} ${cy})`}
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={selected ? 6 : 5}
          fill="var(--green)"
          fillOpacity={cleared ? 0.92 : 0.52}
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
  const careerIndexDomain = careerIndexChartDomain(points)
  const evidenceTicks = [0, 25, 50, 75, 100]

  return (
    <section className="opportunity-map" aria-labelledby="opportunity-map-title">
      <div className="opportunity-map-heading">
        <div>
          <span className="eyebrow">CAREER INDEX + CURRENT DATA</span>
          <h3 id="opportunity-map-title">Prospect landscape</h3>
        </div>
        <div className="opportunity-map-legend" aria-label="Plot legend">
          <span><i className="legend-dot legend-dot--hitter" aria-hidden="true" />Hitter</span>
          <span><i className="legend-diamond" aria-hidden="true" />Pitcher</span>
          <span><i className="legend-trait-ring" aria-hidden="true" />Stats support outlook</span>
          <span><i className="legend-ring" aria-hidden="true" />Selected</span>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="opportunity-map-empty" role="status">
          <strong>No prospects with a Career Index in these results</strong>
          <span>Adjust the filters or choose a player with a matched model record.</span>
        </div>
      ) : (
        <div
          className="opportunity-map-chart"
          role="group"
          aria-label="Prospect Career Index plotted against current data coverage in the loaded results"
          style={{ width: '100%', height: 330 }}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={260}>
            <ScatterChart margin={{ top: 16, right: 18, bottom: 32, left: 2 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" />
              <XAxis
                type="number"
                dataKey="evidenceCoverage"
                domain={[0, 100]}
                ticks={evidenceTicks}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                label={{
                  value: 'CURRENT DATA COVERAGE (%)',
                  position: 'insideBottom',
                  offset: -20,
                  fill: 'var(--muted)',
                  fontSize: 9,
                }}
              />
              <YAxis
                type="number"
                dataKey="careerIndex"
                domain={[careerIndexDomain.minimum, careerIndexDomain.maximum]}
                ticks={careerIndexDomain.ticks}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                width={42}
                tickFormatter={(value: number) => `${Math.round(value)}`}
                label={{
                  value: 'CAREER INDEX',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--muted)',
                  fontSize: 9,
                }}
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
        <span>{points.length.toLocaleString()} prospect{points.length === 1 ? '' : 's'} with a Career Index in these results{omittedCount > 0 ? ` · ${omittedCount.toLocaleString()} still need matched model data` : ''}</span>
        <strong>Career Index axis {careerIndexDomain.minimum}–{careerIndexDomain.maximum} · data coverage does not change the index</strong>
      </div>

      {selectedPoint ? (
        <div className="opportunity-map-selection" aria-live="polite">
          <strong>{selectedPoint.name}</strong>
          <span>
            Career Index {formatCareerIndex(selectedPoint.careerIndex)} · stage #{selectedPoint.stageRank.toLocaleString()} of {selectedPoint.stageUniverse.toLocaleString()} ({selectedPoint.stageTailBand}) · {selectedPoint.coveredPillars}/{selectedPoint.totalPillars} data areas
            {selectedPoint.ageAdvantage === null ? '' : ` · younger than ${selectedPoint.ageAdvantage.toFixed(0)}% of similar players at ${selectedPoint.level}`}
          </span>
        </div>
      ) : null}
    </section>
  )
}
