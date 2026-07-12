import { useState } from 'react'
import { CheckCircle2, CircleDashed, FlaskConical, LockKeyhole, ShieldCheck } from 'lucide-react'

type ModelTarget = 'arrival' | 'career' | 'hall'

const targets: Record<
  ModelTarget,
  {
    label: string
    question: string
    target: string
    model: string
    evaluation: Array<{ label: string; status: string; measured: boolean }>
  }
> = {
  arrival: {
    label: 'MLB arrival',
    question: 'Will this player record an MLB appearance within a specified horizon?',
    target: 'Discrete-time event probability at 12, 24, 36, 48, and 60 months.',
    model: 'Separate hitter and pitcher annual hazards with chronological calibration and horizon-monotone probabilities.',
    evaluation: [
      { label: 'Frozen external evaluation', status: 'The candidate cleared the sufficient-cell predictive-skill comparison in the current retrospective report', measured: true },
      { label: 'Calibration release gate', status: 'Required cohort calibration coverage did not clear the release threshold', measured: false },
      { label: 'Population stability gate', status: 'Unseen-category and stability admission checks did not clear', measured: false },
      { label: 'Prospective horizon maturity', status: 'Long-horizon outcomes are not mature enough for a release claim', measured: false },
    ],
  },
  career: {
    label: 'Career arc',
    question: 'What distribution of MLB value remains from this point forward?',
    target: 'Final career WAR and peak-seven WAR distributions anchored to the value already recorded.',
    model: 'Point-in-time MLB landmarks with player-equal weighting and paired terminal WAR and peak-seven scenarios.',
    evaluation: [
      { label: 'Historical corpus', status: 'The provider-versioned MLB player-season corpus and positional standards are source-locked', measured: true },
      { label: 'Point-in-time integrity', status: 'Active careers are masked and 2026 is scoring-only', measured: true },
      { label: 'Development holdout', status: 'Player-disjoint chronological results are retrospective descriptive evidence, not a prospective test', measured: true },
      { label: 'Current scoring refit', status: 'The 2022 refit is not cross-fitted or evaluated and cannot inherit tournament metrics', measured: false },
      { label: 'Interval release gates', status: 'Final WAR, JAWS, and peak-seven interval gates have not all cleared for release', measured: false },
      { label: 'Annual path coherence', status: 'Awaiting the opportunity, aging, and attrition simulator', measured: false },
    ],
  },
  hall: {
    label: 'HOF-caliber tail',
    question: 'How likely is the final career to reach the frozen position-specific JAWS standard?',
    target: 'Statistical Hall caliber under Baseball-Reference career WAR, peak-seven WAR, and JAWS; induction voting is separate.',
    model: 'Paired terminal WAR and peak-seven scenarios reweighted by a calibrated ensemble probability head; sparse tail support remains a research limitation.',
    evaluation: [
      { label: 'Frozen statistical target', status: 'Ten exact positional JAWS references are source-locked', measured: true },
      { label: 'Provisional entrant selection', status: 'Selection used a low-event development split and is not promotion evidence', measured: false },
      { label: 'Development holdout', status: 'Retrospective holdout results are descriptive only and do not support a superiority claim', measured: false },
      { label: 'Early Hall tail', status: 'Rare-event diagnostics failed; a learned elite-tail model with P95/P99 validation is still required', measured: false },
      { label: 'Young high-performance gate', status: 'Two pitcher development slices did not clear; affected player forecasts are withheld', measured: false },
      { label: 'Prospective track record', status: 'Required before any superiority or release claim', measured: false },
    ],
  },
}

export function ModelLab() {
  const [activeTarget, setActiveTarget] = useState<ModelTarget>('arrival')
  const target = targets[activeTarget]

  return (
    <main className="workspace-page model-lab">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">FORECAST GOVERNANCE</span>
          <h1>Model lab</h1>
          <p>Targets, validation gates, and release readiness for every prediction surface.</p>
        </div>
        <span className="build-badge"><CircleDashed size={14} aria-hidden="true" /> Research baseline</span>
      </header>

      <div className="target-tabs" role="tablist" aria-label="Prediction target">
        {(Object.keys(targets) as ModelTarget[]).map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={activeTarget === key}
            className={activeTarget === key ? 'is-active' : ''}
            onClick={() => setActiveTarget(key)}
          >
            {targets[key].label}
          </button>
        ))}
      </div>

      <section className="target-contract" aria-labelledby="target-question">
        <div className="contract-number">0{(Object.keys(targets) as ModelTarget[]).indexOf(activeTarget) + 1}</div>
        <div>
          <span className="eyebrow">DECISION QUESTION</span>
          <h2 id="target-question">{target.question}</h2>
          <dl className="contract-definitions">
            <div>
              <dt>Prediction target</dt>
              <dd>{target.target}</dd>
            </div>
            <div>
              <dt>Model family</dt>
              <dd>{target.model}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="lab-grid">
        <section className="lab-section" aria-labelledby="validation-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">RELEASE GATES</span>
              <h2 id="validation-title">Validation contract</h2>
            </div>
            <ShieldCheck size={19} aria-hidden="true" />
          </div>
          <div className="validation-list">
            {target.evaluation.map((item) => (
              <div key={item.label} className={item.measured ? 'is-complete' : undefined}>
                {item.measured ? <CheckCircle2 size={17} aria-hidden="true" /> : <CircleDashed size={17} aria-hidden="true" />}
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.status}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="lab-section" aria-labelledby="leakage-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">NON-NEGOTIABLE</span>
              <h2 id="leakage-title">Point-in-time integrity</h2>
            </div>
            <LockKeyhole size={19} aria-hidden="true" />
          </div>
          <div className="integrity-rules">
            <p><strong>As-of joins only.</strong> Every feature must have been knowable at prediction time.</p>
            <p><strong>Unresolved outcomes stay censored.</strong> Active careers never become convenient negatives.</p>
            <p><strong>Snapshots are append-only.</strong> Published forecasts remain reproducible after corrections.</p>
            <p><strong>Calibration ships with the score.</strong> A probability without cohort reliability is incomplete.</p>
          </div>
        </section>
      </div>

      <section className="model-roadmap" aria-labelledby="roadmap-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">RELEASE SEQUENCE</span>
            <h2 id="roadmap-title">Model path</h2>
          </div>
          <FlaskConical size={19} aria-hidden="true" />
        </div>
        <ol>
          <li className="is-complete"><span>01</span><div><strong>Historical baseline</strong><small>Built and retained as the frozen benchmark</small></div></li>
          <li className="is-current"><span>02</span><div><strong>Arrival candidate</strong><small>Retrospective skill observed; calibration and drift remediation active</small></div></li>
          <li className="is-current"><span>03</span><div><strong>Career and JAWS baseline</strong><small>Paired terminal research distributions with active release gates</small></div></li>
          <li><span>04</span><div><strong>Annual path simulator</strong><small>Opportunity, aging, attrition, and correlated value paths</small></div></li>
          <li><span>05</span><div><strong>Decision layer</strong><small>Watch triggers and forecast revisions</small></div></li>
        </ol>
      </section>
    </main>
  )
}
