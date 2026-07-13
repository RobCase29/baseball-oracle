import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PlayerRecord } from '../domain/forecast'
import {
  buildMilbEvidenceRows,
  type EvidenceKind,
  type MilbEvidenceRow,
} from './milbVisualizationData'

interface MilbEvidenceProfileProps {
  player: PlayerRecord
}

interface EvidenceTooltipProps {
  active?: boolean
  payload?: Array<{ payload?: MilbEvidenceRow }>
}

const evidenceColor: Record<EvidenceKind, string> = {
  model_rank: 'var(--green)',
  age_context: 'var(--orange)',
  descriptive_trait: 'var(--ink-soft)',
}

function EvidenceTooltip({ active, payload }: EvidenceTooltipProps) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null

  return (
    <div className="chart-tooltip evidence-profile-tooltip">
      <strong>{row.label}</strong>
      <span>P{row.value.toFixed(row.value >= 99 ? 1 : 0)}</span>
      <small>{row.detail}</small>
    </div>
  )
}

function compactLabel(value: string): string {
  return value.length > 24 ? `${value.slice(0, 23)}…` : value
}

export function MilbEvidenceProfile({ player }: MilbEvidenceProfileProps) {
  const rows = buildMilbEvidenceRows(player)
  if (player.stage !== 'pre_debut') return null

  return (
    <section className="evidence-profile" aria-labelledby="evidence-profile-title">
      <div className="evidence-profile-heading">
        <div>
          <span className="eyebrow">SEPARATE PERCENTILE REFERENCES</span>
          <h3 id="evidence-profile-title">Evidence profile</h3>
        </div>
        <div className="evidence-profile-legend" aria-label="Evidence legend">
          <span><i className="legend-bar legend-bar--rank" aria-hidden="true" />Stage rank</span>
          <span><i className="legend-bar legend-bar--age" aria-hidden="true" />Age context</span>
          <span><i className="legend-bar legend-bar--trait" aria-hidden="true" />Raw trait</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="evidence-profile-empty" role="status">
          <strong>No aligned percentile evidence</strong>
          <span>Stage standing, age context, and raw-trait sources remain unavailable for this player.</span>
        </div>
      ) : (
        <div
          className="evidence-profile-chart"
          role="img"
          aria-label={`${player.name} percentile evidence profile; each measure retains its own reference cohort and is not blended`}
          style={{ width: '100%', height: Math.max(190, rows.length * 39 + 54) }}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={190}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 12, right: 18, bottom: 18, left: 4 }}
              barCategoryGap="28%"
            >
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" horizontal={false} />
              <ReferenceLine
                x={90}
                stroke="var(--line-strong)"
                strokeDasharray="4 4"
                label={{ value: 'P90', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 9 }}
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={146}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--ink-soft)', fontSize: 10 }}
                tickFormatter={compactLabel}
              />
              <Tooltip content={<EvidenceTooltip />} cursor={{ fill: 'var(--paper-soft)' }} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                {rows.map((row) => (
                  <Cell key={row.id} fill={evidenceColor[row.kind]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="evidence-profile-note">
        Percentile axes are aligned for inspection; reference cohorts differ and the measures are never blended into a composite.
      </p>
    </section>
  )
}
