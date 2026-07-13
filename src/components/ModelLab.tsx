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
    question: 'Will this player reach MLB within the next one to five years?',
    target: 'Chance of reaching MLB within one, two, three, four, or five years.',
    model: 'Separate hitter and pitcher models trained on earlier seasons and checked against later players.',
    evaluation: [
      { label: 'Later-player test', status: 'The model beat the comparison model in every large enough test group', measured: true },
      { label: 'Probability accuracy', status: 'Predicted chances did not match real outcome rates consistently enough for release', measured: false },
      { label: 'Changing player population', status: 'The newer player pool differs too much from the training years', measured: false },
      { label: 'Five-year follow-up', status: 'The newest five-year outcomes are not complete yet', measured: false },
    ],
  },
  career: {
    label: 'Career arc',
    question: 'How much MLB value could this player produce from here?',
    target: 'A range of remaining career WAR, the player’s current career phase, and the chance of a standout next three seasons.',
    model: 'MLB careers use age, role, playing time, and WAR history. Prospect ranks connect MLB arrival and projected debut age to historical career outcomes.',
    evaluation: [
      { label: 'Historical data', status: 'We save the exact MLB seasons and Hall-level standards used in every test', measured: true },
      { label: 'No future data', status: 'The model cannot see statistics that happened after the date being predicted', measured: true },
      { label: 'Career phases', status: 'Hitters, starters, and relievers have separate development, peak, and decline patterns', measured: true },
      { label: 'Prospect career runway', status: 'Projected MLB debut age shapes the Career Index and separate prospect stage standing', measured: true },
      { label: 'Prospect quality after arrival', status: 'A direct minor-league to early-MLB quality model is still required', measured: false },
      { label: 'Three-year upside', status: 'A separate model estimates a standout next three seasons; it is not a Hall probability', measured: true },
      { label: 'Standout-player test', status: 'The historical screen found only four qualifying players, too few for a reliable edge claim', measured: true },
      { label: 'New forward test', status: 'A newly frozen group is required before claiming early identification or market edge', measured: false },
      { label: 'Historical test', status: 'Later historical players provide useful evidence, but this was not a live forward test', measured: true },
      { label: 'Current player version', status: 'The version scoring today’s players has not been independently tested', measured: false },
      { label: 'Career range accuracy', status: 'The model still misses too many rare Hall-level endings', measured: false },
      { label: 'Season-by-season path', status: 'A full playing-time, aging, health, and retirement simulator is still needed', measured: false },
    ],
  },
  hall: {
    label: 'Hall-level careers',
    question: 'Could this player finish with Hall of Fame caliber statistics?',
    target: 'A position-specific benchmark based on career WAR and the player’s best seven seasons; Hall voting is separate.',
    model: 'A career outcome range plus a separate rare-outcome ranking model. Too few elite examples remain a major limitation.',
    evaluation: [
      { label: 'Hall benchmarks', status: 'Ten exact standards cover different positions and pitcher roles', measured: true },
      { label: 'Early model selection', status: 'Too few Hall-level events were available to declare a final winner', measured: false },
      { label: 'Historical test', status: 'Retrospective results do not support a superiority claim', measured: false },
      { label: 'Early Hall careers', status: 'Rare-outcome checks failed; the model still needs better extreme-career ranges', measured: false },
      { label: 'Young standout pitchers', status: 'Two development groups did not pass, so affected forecasts are withheld', measured: false },
      { label: 'Forward track record', status: 'Required before any superiority or release claim', measured: false },
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
          <span className="eyebrow">MODEL REVIEW</span>
          <h1>How good is the model?</h1>
          <p>What the current model does well, where it misses, and the larger test required before we call it a champion.</p>
        </div>
        <span className="build-badge build-badge--warning"><CircleDashed size={14} aria-hidden="true" /> More testing required</span>
      </header>

      <section className="model-verdict" aria-label="Current model verdict">
        <div>
          <span>CURRENT VERDICT</span>
          <strong>Useful ranking signal, not the final model</strong>
        </div>
        <p>The prospect impact model identifies candidates well in historical tests, but tiny samples can distort its highest ranks. The minor-league Career Index therefore uses a separate forecast built from arrival odds and projected debut age, while fragile impact ranks stay hidden. The full career model still misses too many rare Hall-level endings.</p>
      </section>

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
          <span className="eyebrow">QUESTION</span>
          <h2 id="target-question">{target.question}</h2>
          <dl className="contract-definitions">
            <div>
              <dt>What it predicts</dt>
              <dd>{target.target}</dd>
            </div>
            <div>
              <dt>How it works</dt>
              <dd>{target.model}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="lab-grid">
        <section className="lab-section" aria-labelledby="validation-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">TEST RESULTS</span>
              <h2 id="validation-title">What the evidence says</h2>
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
              <span className="eyebrow">RULES</span>
              <h2 id="leakage-title">How we keep the test honest</h2>
            </div>
            <LockKeyhole size={19} aria-hidden="true" />
          </div>
          <div className="integrity-rules">
            <p><strong>Use only information available that day.</strong> Future stats cannot leak into an earlier prediction.</p>
            <p><strong>Do not count active careers as failures.</strong> Their final outcomes are still unknown.</p>
            <p><strong>Keep every published version.</strong> Old forecasts remain reproducible after data corrections.</p>
            <p><strong>Test every probability against reality.</strong> A displayed percentage must match real-world outcome rates.</p>
            <p><strong>Separate player talent from card value.</strong> Card price, liquidity, costs, and market expectations require their own model.</p>
          </div>
        </section>
      </div>

      <section className="model-roadmap" aria-labelledby="roadmap-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">NEXT EXPERIMENT</span>
            <h2 id="roadmap-title">Path to a champion model</h2>
          </div>
          <FlaskConical size={19} aria-hidden="true" />
        </div>
        <ol>
          <li className="is-complete"><span>01</span><div><strong>Historical comparison</strong><small>Keep the current model as the score every new contender must beat</small></div></li>
          <li className="is-current"><span>02</span><div><strong>MLB arrival test</strong><small>Make high scores more trustworthy and account for how today’s players differ</small></div></li>
          <li className="is-current"><span>03</span><div><strong>Career and Hall test</strong><small>Check projected career ranges against what actually happened</small></div></li>
          <li><span>04</span><div><strong>Season-by-season careers</strong><small>Model playing time, aging, injury risk, performance, and retirement each year</small></div></li>
          <li className="is-current"><span>05</span><div><strong>Standout alerts</strong><small>Flag unusual young players only when both upside and supporting evidence are strong</small></div></li>
          <li><span>06</span><div><strong>Card value model</strong><small>Compare player outlook with card prices, demand, selling costs, and future returns</small></div></li>
        </ol>
      </section>
    </main>
  )
}
