import { useState, type KeyboardEvent } from 'react'
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
import type { PlayerMapFeedItem, PlayerRecord } from '../domain/forecast'
import { CAREER_INDEX_WAR_ANCHORS } from '../domain/playerMap'
import {
  buildMilbOpportunityPoints,
  buildMilbOpportunityPointsFromFeed,
  careerIndexChartDomain,
  type CareerIndexChartScale,
  type MilbOpportunityPoint,
} from './milbVisualizationData'

interface MilbOpportunityMapProps {
  players: PlayerRecord[]
  feedItems?: PlayerMapFeedItem[]
  totalCount?: number
  selectedId: string | null
  openingPlayerId?: string | null
  loadError?: string | null
  onSelect: (playerId: string) => void
}

type OpportunityPlotPoint = MilbOpportunityPoint

interface OpportunityTooltipProps {
  active?: boolean
  payload?: Array<{ payload?: OpportunityPlotPoint }>
}

interface OpportunityDotProps {
  cx?: number
  cy?: number
  payload?: OpportunityPlotPoint
  selectedId: string | null
  featuredIds: string[]
  pointCount: number
  onSelect: (playerId: string) => void
}

function formatCareerIndex(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function formatProspectScore(value: number): string {
  if (value === 100) return '100'
  return value >= 99 ? value.toFixed(2) : value.toFixed(1)
}

function percentile(values: number[], position: number): number {
  if (values.length === 0) return 0
  const ordered = values.toSorted((left, right) => left - right)
  const index = (ordered.length - 1) * position
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return ordered[lower]
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)
}

function OpportunityTooltip({ active, payload }: OpportunityTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  const ageDetail = point.ageAdvantage === null
    ? 'Historical age comparison unavailable'
    : `Younger than ${point.ageAdvantage.toFixed(0)}% of${point.ageReferencePlayers === null ? '' : ` ${point.ageReferencePlayers.toLocaleString()}`} comparable players${point.ageCohort ? ` at ${point.ageCohort}` : ''}`

  return (
    <div className="chart-tooltip opportunity-map-tooltip">
      <div className="opportunity-tooltip-heading">
        <div>
          <strong>{point.name}</strong>
          <span>{point.organization} · {point.position} · Age {point.age ?? '—'} · {point.level}</span>
        </div>
        <b aria-label={`Prospect Score ${formatProspectScore(point.prospectScore)}`}>
          {formatProspectScore(point.prospectScore)}
          <small>SCORE</small>
        </b>
      </div>
      <dl>
        <div>
          <dt>Five-year impact rank</dt>
          <dd>#{point.prospectRank.toLocaleString()} of {point.prospectUniverse.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Ceiling if MLB</dt>
          <dd>{formatCareerIndex(point.careerIndex)} Career Index · long-term rank #{point.stageRank.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Age advantage</dt>
          <dd>{ageDetail}</dd>
        </div>
        <div>
          <dt>Current evidence</dt>
          <dd>{point.coveredPillars}/{point.totalPillars} data areas · {point.sampleSummary}</dd>
        </div>
      </dl>
      <small>The Prospect Score is a research rank, not a probability. Current evidence shows how much to trust the read.</small>
    </div>
  )
}

function OpportunityDot({
  cx,
  cy,
  payload,
  selectedId,
  featuredIds,
  pointCount,
  onSelect,
}: OpportunityDotProps) {
  if (cx === undefined || cy === undefined || !payload) return null
  const selected = payload.playerId === selectedId
  const featuredIndex = featuredIds.indexOf(payload.playerId)
  const featured = featuredIndex >= 0
  const keyboardReachable = featured || selected || pointCount <= 10
  const markerRadius = payload.evidenceCoverage >= 75 ? 6.2 : 5.2
  const fillOpacity = Math.min(0.96, 0.42 + payload.evidenceCoverage / 100 * 0.54)
  const labelOnLeft = payload.prospectScore >= 99
  const labelOffsets = [-24, -4, 18]
  const labelY = cy + (labelOffsets[featuredIndex] ?? 0)
  const labelX = labelOnLeft ? cx - 12 : cx + 12
  const ageContext = payload.ageAdvantage === null
    ? 'historical age comparison unavailable'
    : `younger than ${payload.ageAdvantage.toFixed(0)} percent of comparable historical players`

  const selectPoint = () => onSelect(payload.playerId)
  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectPoint()
  }

  return (
    <g
      className={`opportunity-point${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={keyboardReachable ? 0 : -1}
      aria-label={`${payload.name}, ${payload.playerType}, Prospect Score ${formatProspectScore(payload.prospectScore)}, rank ${payload.prospectRank}, Ceiling if MLB ${formatCareerIndex(payload.careerIndex)}, ${ageContext}, ${payload.evidenceCoverage.toFixed(0)} percent current evidence coverage`}
      onClick={selectPoint}
      onKeyDown={handleKeyDown}
      style={{ cursor: 'pointer' }}
    >
      <circle className="opportunity-point-hit" cx={cx} cy={cy} r={14} fill="transparent" />
      <circle className="opportunity-point-focus" cx={cx} cy={cy} r={10.5} fill="none" />
      {selected ? (
        <circle cx={cx} cy={cy} r={10} fill="none" stroke="var(--orange)" strokeWidth={2.2} />
      ) : null}
      {payload.playerType === 'Pitcher' ? (
        <rect
          x={cx - markerRadius * 0.72}
          y={cy - markerRadius * 0.72}
          width={markerRadius * 1.44}
          height={markerRadius * 1.44}
          rx={1}
          fill="var(--gold)"
          fillOpacity={fillOpacity}
          stroke={payload.traitCorroborated ? 'var(--ink)' : 'var(--paper)'}
          strokeWidth={payload.traitCorroborated ? 2.2 : 1.5}
          transform={`rotate(45 ${cx} ${cy})`}
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={selected ? markerRadius + 0.8 : markerRadius}
          fill="var(--green)"
          fillOpacity={fillOpacity}
          stroke={payload.traitCorroborated ? 'var(--ink)' : 'var(--paper)'}
          strokeWidth={payload.traitCorroborated ? 2.2 : 1.5}
        />
      )}
      {featured ? (
        <g className="opportunity-point-label">
          <line
            x1={cx + (labelOnLeft ? -6 : 6)}
            y1={cy}
            x2={labelX + (labelOnLeft ? 3 : -3)}
            y2={labelY - 3}
            stroke="var(--line-strong)"
            strokeWidth={1}
          />
          <text
            x={labelX}
            y={labelY}
            textAnchor={labelOnLeft ? 'end' : 'start'}
            fill="var(--ink)"
            fontSize={10.5}
            fontWeight={750}
            style={{ paintOrder: 'stroke', stroke: 'var(--paper)', strokeWidth: 4, strokeLinejoin: 'round' }}
          >
            {payload.name}
          </text>
        </g>
      ) : null}
    </g>
  )
}

export function MilbOpportunityMap({
  players,
  feedItems,
  totalCount,
  selectedId,
  openingPlayerId = null,
  loadError = null,
  onSelect,
}: MilbOpportunityMapProps) {
  const [scale, setScale] = useState<CareerIndexChartScale>('focus')
  const usingCohortFeed = feedItems !== undefined && feedItems.length > 0
  const points = usingCohortFeed
    ? buildMilbOpportunityPointsFromFeed(feedItems)
    : buildMilbOpportunityPoints(players)
  const minorCount = players.filter((player) => player.stage === 'pre_debut').length
  const matchingCount = totalCount ?? minorCount
  const careerIndexDomain = careerIndexChartDomain(points, scale)
  const prospectScoreDomain = scale === 'full'
    ? { minimum: 0, maximum: 100, ticks: [0, 25, 50, 75, 100] }
    : careerIndexChartDomain(
        points.map((point) => ({ careerIndex: point.prospectScore })),
        'focus',
      )
  const fullEvidenceCount = points.filter((point) => point.evidenceCoverage >= 75).length
  const scoreThreshold = percentile(points.map((point) => point.prospectScore), 0.8)
  const ceilingThreshold = percentile(points.map((point) => point.careerIndex), 0.8)
  const earlyEdge = points.filter((point) => (
    point.prospectScore >= scoreThreshold && point.careerIndex >= ceilingThreshold
  ))
  const standouts = (earlyEdge.length > 0 ? earlyEdge : points)
    .toSorted((left, right) => left.prospectRank - right.prospectRank || right.careerIndex - left.careerIndex)
    .slice(0, 4)
  const featuredIds = (points.length <= 3 ? points : standouts.slice(0, 3)).map((point) => point.playerId)
  const plotPoints: OpportunityPlotPoint[] = points
  const referenceAnchors = CAREER_INDEX_WAR_ANCHORS.filter((anchor) => (
    anchor.value > careerIndexDomain.minimum && anchor.value < careerIndexDomain.maximum
  ))
  const selectedPoint = selectedId === null
    ? null
    : points.find((point) => point.playerId === selectedId) ?? null
  const plottedBeyondCount = Math.max(0, matchingCount - points.length)
  const scopeLabel = usingCohortFeed
    ? `Top ${points.length.toLocaleString()} by Prospect Score`
    : `${points.length.toLocaleString()} on this table page`

  return (
    <section className="opportunity-map" aria-labelledby="opportunity-map-title">
      <div className="opportunity-map-heading">
        <div className="opportunity-map-title">
          <span className="eyebrow">PROSPECT LANDSCAPE</span>
          <h3 id="opportunity-map-title">Impact &amp; career ceiling</h3>
          <p>Farther right means a stronger individualized five-year impact rank. Higher means more career value if MLB is reached.</p>
        </div>
        <div className="opportunity-map-controls">
          <label className="opportunity-player-picker">
            <span>Open plotted player</span>
            <select
              aria-label="Open a plotted prospect"
              value={selectedPoint?.playerId ?? ''}
              onChange={(event) => {
                if (event.target.value) onSelect(event.target.value)
              }}
            >
              <option value="">Select player</option>
              {points
                .toSorted((left, right) => left.prospectRank - right.prospectRank)
                .map((point) => (
                  <option key={point.playerId} value={point.playerId}>
                    #{point.prospectRank} {point.name} ({formatProspectScore(point.prospectScore)})
                  </option>
                ))}
            </select>
          </label>
          <div className="segmented-control chart-scale-control" aria-label="Prospect landscape chart scale">
            <button
              type="button"
              className={scale === 'focus' ? 'is-active' : ''}
              aria-pressed={scale === 'focus'}
              onClick={() => setScale('focus')}
            >
              Focus
            </button>
            <button
              type="button"
              className={scale === 'full' ? 'is-active' : ''}
              aria-pressed={scale === 'full'}
              onClick={() => setScale('full')}
            >
              Full scale
            </button>
          </div>
          <div className="opportunity-map-legend" aria-label="Plot legend">
            <span><i className="legend-dot legend-dot--hitter" aria-hidden="true" />Hitter</span>
            <span><i className="legend-diamond" aria-hidden="true" />Pitcher</span>
            <span><i className="legend-opacity" aria-hidden="true" />More current data</span>
            <span><i className="legend-trait-ring" aria-hidden="true" />Stats agree</span>
          </div>
        </div>
      </div>

      <div className="opportunity-map-summary" aria-label="Landscape summary">
        <div>
          <span>Plotted</span>
          <strong>{points.length.toLocaleString()}</strong>
          <small>{scopeLabel}</small>
        </div>
        <div>
          <span>Impact + ceiling leaders</span>
          <strong>{earlyEdge.length.toLocaleString()}</strong>
          <small>Upper-right standouts in this view</small>
        </div>
        <div>
          <span>Median Prospect Score</span>
          <strong>{points.length > 0 ? percentile(points.map((point) => point.prospectScore), 0.5).toFixed(1) : '—'}</strong>
          <small>Middle of the plotted group</small>
        </div>
        <div>
          <span>Fuller evidence</span>
          <strong>{fullEvidenceCount.toLocaleString()}</strong>
          <small>At least 3 of 4 current data areas</small>
        </div>
      </div>

      {loadError ? (
        <div className="opportunity-map-notice" role="status">
          {loadError} Showing the prospects already loaded in the table.
        </div>
      ) : null}

      {points.length === 0 ? (
        <div className="opportunity-map-empty" role="status">
          <strong>No prospects with both scores in these results</strong>
          <span>Adjust the filters or choose a player with a matched model record.</span>
        </div>
      ) : (
        <div className="opportunity-map-content">
          <div className="opportunity-map-plot">
            <div
              className="opportunity-map-chart"
              role="group"
              aria-label={`${points.length} prospects plotted by Prospect Score and Ceiling if MLB. Higher and farther right indicates stronger modeled five-year impact and career ceiling.`}
            >
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280}>
                <ScatterChart margin={{ top: 28, right: 28, bottom: 42, left: 4 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="2 6" />
                  <ReferenceArea
                    x1={scoreThreshold}
                    x2={prospectScoreDomain.maximum}
                    y1={ceilingThreshold}
                    y2={careerIndexDomain.maximum}
                    fill="var(--green-soft)"
                    fillOpacity={0.62}
                    stroke="none"
                  />
                  {referenceAnchors.map((anchor) => (
                    <ReferenceLine
                      key={anchor.value}
                      y={anchor.value}
                      stroke="var(--line-strong)"
                      strokeDasharray="5 5"
                      label={{
                        value: `Ceiling ${anchor.value}`,
                        position: 'insideBottomLeft',
                        fill: 'var(--muted)',
                        fontSize: 9,
                      }}
                    />
                  ))}
                  <XAxis
                    type="number"
                    dataKey="prospectScore"
                    domain={[prospectScoreDomain.minimum, prospectScoreDomain.maximum]}
                    ticks={prospectScoreDomain.ticks}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    tickFormatter={(value: number) => Number.isInteger(value) ? `${value}` : value.toFixed(1)}
                    label={{
                      value: 'PROSPECT SCORE (FIVE-YEAR IMPACT RANK)',
                      position: 'insideBottom',
                      offset: -28,
                      fill: 'var(--muted)',
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="careerIndex"
                    domain={[careerIndexDomain.minimum, careerIndexDomain.maximum]}
                    ticks={careerIndexDomain.ticks}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    width={48}
                    tickFormatter={(value: number) => `${Math.round(value)}`}
                    label={{
                      value: 'CEILING IF MLB',
                      angle: -90,
                      position: 'insideLeft',
                      fill: 'var(--muted)',
                      fontSize: 10,
                    }}
                  />
                  <Tooltip
                    content={<OpportunityTooltip />}
                    cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '3 3' }}
                  />
                  <Scatter
                    data={plotPoints}
                    isAnimationActive={false}
                    shape={(
                      <OpportunityDot
                        selectedId={selectedId}
                        featuredIds={featuredIds}
                        pointCount={points.length}
                        onSelect={onSelect}
                      />
                    )}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="opportunity-map-axis-note">
              <span>{scale === 'focus' ? `Focused view: score ${prospectScoreDomain.minimum}–${prospectScoreDomain.maximum} · ceiling ${careerIndexDomain.minimum}–${careerIndexDomain.maximum}` : 'Full Prospect Score and Ceiling if MLB scales: 0–100'}</span>
              <strong>Dot fill reflects current evidence depth</strong>
            </div>
          </div>

          <aside className="opportunity-standouts" aria-labelledby="opportunity-standouts-title">
            <div className="opportunity-standouts-heading">
              <span>PROSPECT LEADERS</span>
              <strong id="opportunity-standouts-title">Upper-right standouts</strong>
              <small>Strong five-year impact rank and conditional career ceiling</small>
            </div>
            <div className="opportunity-standout-list">
              {standouts.map((point) => (
                <button
                  key={point.playerId}
                  type="button"
                  className={point.playerId === selectedId ? 'is-selected' : ''}
                  onClick={() => onSelect(point.playerId)}
                >
                  <span className="opportunity-standout-rank">#{point.prospectRank.toLocaleString()}</span>
                  <span className="opportunity-standout-player">
                    <strong>{point.name}</strong>
                    <small>{point.organization} · {point.position} · Age {point.age ?? '—'}</small>
                  </span>
                  <span className="opportunity-standout-score">
                    <strong>{formatProspectScore(point.prospectScore)}</strong>
                    <small>SCORE</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      <div className="opportunity-map-footer">
        <span>
          {points.length.toLocaleString()} plotted
          {plottedBeyondCount > 0 ? ` · ${plottedBeyondCount.toLocaleString()} filtered prospects beyond this view` : ''}
        </span>
        <strong>Prospect Score is an ordinal research rank; Ceiling if MLB remains conditional on arrival</strong>
      </div>

      {openingPlayerId ? (
        <div className="opportunity-map-selection" aria-live="polite">
          <strong>Opening player</strong>
          <span>{selectedPoint?.name ?? 'Loading the full player outlook…'}</span>
        </div>
      ) : null}
    </section>
  )
}
