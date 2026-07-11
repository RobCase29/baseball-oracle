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
    evaluation: string[]
  }
> = {
  arrival: {
    label: 'MLB arrival',
    question: 'Will this player record an MLB appearance within a specified horizon?',
    target: 'Competing-risk, discrete-time event probability at 12, 24, 36, and 60 months.',
    model: 'Hitter and pitcher hazard ensembles with cohort priors, calibrated after temporal holdout.',
    evaluation: ['Brier score by horizon', 'Calibration slope and intercept', 'Time-dependent AUC', 'Cohort fairness slices'],
  },
  career: {
    label: 'Career arc',
    question: 'What distribution of MLB value remains from this point forward?',
    target: 'Joint distribution of playing time and value by age, including zero and early-exit outcomes.',
    model: 'State-transition simulator with role, health, aging, and performance submodels.',
    evaluation: ['CRPS by age', 'Interval coverage', 'WAR and playing-time error', 'Trajectory shape error'],
  },
  hall: {
    label: 'HOF-caliber tail',
    question: 'How often does the simulated career reach a historically elite performance shape?',
    target: 'Performance-defined career tail, intentionally separate from eventual induction voting.',
    model: 'Career simulation tail probability with era, position, and role normalization.',
    evaluation: ['Tail calibration', 'Era and position stability', 'Precision at fixed review budget', 'Decade backtests'],
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
        <span className="build-badge"><CircleDashed size={14} aria-hidden="true" /> Foundation phase</span>
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
            {target.evaluation.map((item, index) => (
              <div key={item}>
                {index === 0 ? <CheckCircle2 size={17} aria-hidden="true" /> : <CircleDashed size={17} aria-hidden="true" />}
                <span>
                  <strong>{item}</strong>
                  <small>{index === 0 ? 'Metric contract drafted' : 'Awaiting historical backfill'}</small>
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
          <li className="is-current"><span>01</span><div><strong>Historical baseline</strong><small>Identity spine, outcomes, cohort priors</small></div></li>
          <li><span>02</span><div><strong>Arrival ensemble</strong><small>Rolling-origin validation and calibration</small></div></li>
          <li><span>03</span><div><strong>Career simulator</strong><small>Role, aging, attrition, and value paths</small></div></li>
          <li><span>04</span><div><strong>Decision layer</strong><small>Watch triggers and forecast revisions</small></div></li>
        </ol>
      </section>
    </main>
  )
}
