# Career Oracle Research Contract

Status: implemented research MVP, not release eligible  
Revised: 2026-07-12  
MLB target version: `hof-caliber-point-in-time-jaws-v1`  
MiLB bridge target version: `mlb-debut-age-mixed-final-standard-bridge-v1`

## Product Questions

Baseball Oracle addresses two linked questions without pretending they are one
training problem:

1. For a pre-debut player, what is the probability of an MLB appearance within a
   named horizon?
2. Given the information available at an MLB career landmark, what terminal
   career WAR, peak-seven WAR, JAWS, and Hall-caliber outcomes remain plausible?

The product shows both populations in one research cockpit, but it maintains
separate MiLB and MLB ranks. The All view groups those rank universes because the
minor-league bridge and the MLB landmark model do not estimate directly
comparable endpoints.

## Statistical Hall Target

Hall caliber is a statistical career outcome, not Hall of Fame induction
probability.

- `career WAR` is provider-versioned Baseball-Reference WAR accumulated through
  the final recorded season.
- `peak-seven WAR` is the sum of the seven highest seasonal WAR values, without
  requiring consecutive seasons.
- `JAWS = (career WAR + peak-seven WAR) / 2`.
- `hof_caliber = 1` when final JAWS meets or exceeds the exact standard attached
  to the player's career-to-date role or position at the scoring landmark.

The exact frozen standards are `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`,
`P`, and `RP`, sourced from Baseball-Reference's Hall of Fame JAWS tables. If a
player's career-to-date classification changes, the point-in-time target is
rebaselined to the new standard. The completed-career position target is retained
only as a diagnostic.

This policy prevents the training population from discarding ordinary
starter/reliever or defensive-position transitions. A player whose broad domain
changes between hitter and pitcher is excluded from v1 training. A true two-way
player is withheld until a preregistered two-way standard exists.

Actual induction is descriptive evidence only. Election rules, eligibility,
eras, character judgments, and committee paths are separate mechanisms.

## Implemented MLB Baseline

The current MLB entrant is a terminal landmark model rather than a full annual
career simulator:

1. Build player-season landmarks using only information available through that
   completed season.
2. Fit separate nonlinear point models for final career WAR and peak-seven WAR.
3. Preserve paired final/peak residuals within role, career stage, and
   performance banks.
4. Draw 2,048 paired scenarios and recompute JAWS for every scenario.
5. Optionally tilt scenario mass toward a calibrated classification probability
   when the candidate clears registered selection-cohort noninferiority and
   support-extension gates.
6. Export coherent P10/P25/P50/P75/P90 terminal outcomes and the implied
   Hall-caliber probability.

The final scoring fit freezes held-out residual and calibration layers, then
refits the point and raw probability learners through resolved 2022 careers. This
reduces stale-era extrapolation while preserving the held-out error distribution.
It is an approximate final-fit procedure, not full player-disjoint cross-fitting;
that stronger procedure is registered for the next model version. Tournament
Brier, ranking, and coverage metrics describe the evaluated tournament fits and
must not be inherited by the exact current-player refit.

The model does not yet generate future annual WAR paths, career length, age of
peak, injuries, exit/re-entry, or playing time. The dossier's current chart is an
actual-to-terminal timing baseline and must not be described as a simulated aging
curve.

## Implemented MiLB Bridge

The pre-debut output is compositional because the 2010+ MiLB cohort has not had
time to produce completed Hall-caliber careers:

`P(HOF-caliber proxy) = P(MLB within 60 months) * P(HOF caliber | estimated debut age)`

The no-arrival component contributes zero career value. The interface may also
show the conditional-on-arrival distribution, but the default prospect result is
unconditional. It is explicitly labeled as a 60-month arrival lower-bound proxy,
not eventual arrival probability and not a directly trained MiLB-to-Hall model.

The arrival model's external evaluation failed registered release gates. The
bridge therefore remains low-confidence research output even when a number is
available.

## Evidence and Ranking Rules

- Split by player, never by player-season row.
- Weight landmarks so each player contributes equal total evaluation weight.
- Use chronological completed-career-end-year cohorts.
- Fit preprocessing, calibrators, and champion weights inside the allowed
  development cohorts.
- Treat unresolved careers as censored rather than negative Hall labels.
- Keep source retrieval time, feature cutoff time, and actual-evidence time
  separate.
- Default scoring uses the latest complete season; 2026 partial data is context.
- Rank current MLB players only against the current MLB census.
- Rank prospects only against the live MiLB research-proxy universe.
- Confidence is a coverage/support heuristic, not a frequentist coverage
  probability and never changes rank.

Prospect Savant's composite score, FanGraphs FV, public rankings, and other
provider judgments are excluded from the default model and rank. Raw named
measurements can enter future preregistered ablation challengers after provenance,
coverage, temporal, and drift checks. A vendor composite may never silently
become the Oracle target.

## Tournament Integrity

The tournament includes named empirical, regularized, nonlinear, stacked,
joint-residual, and scenario-tilt entrants. Mechanical champion selection uses a
chronological selection cohort and registered Brier, interval-regression, and
support-extension rules.

The later historical cohort has been inspected repeatedly while the architecture
was developed. It is consequently labeled a `development holdout` and serves
only as retrospective sensitivity evidence. It is not pristine, blind, locked,
or prospective. Before any superiority or release claim, the pipeline must be
frozen and scored once on a newly registered forward or debut cohort.

Release remains false even when a tournament entrant wins. Absolute early-career
interval coverage, high-performance subgroup behavior, prospective validation,
arrival admission, lineage, and operational gates are evaluated separately from
champion selection.

The current split axis is completed career end year. It is player-disjoint and
chronological in outcome resolution, but it is not a rolling prediction-origin
test: cohort membership depends on future career length, and some early landmarks
predate the calibration cutoff. It cannot substitute for debut-cohort evaluation
with censoring-aware outcomes.

## Publication States

- `observed`: source evidence only.
- `research`: model output exists but release gates are incomplete.
- `released`: locked model, data, validation, calibration, and operational gates
  passed.
- `withheld`: no number is shown because the state is unsupported or a safety gate
  failed.

Current withholding includes partial-season-only rookies, stale completed-season
features after a return, no observed current opportunity, unsupported two-way
careers, and role-stage high-performance cells that fail distribution gates.
Missing results are never replaced with a heuristic that looks like a forecast.

## Required Artifact Fields

- stage and stage-specific rank universe;
- unconditional Hall-caliber probability where supported;
- 36/60-month arrival probability and scope for a prospect;
- terminal final WAR, peak-seven WAR, and JAWS quantiles;
- actual cumulative WAR and a clearly labeled terminal timing arc;
- exact Hall standard and automatic-rebaselining warning;
- confidence/support state and every withholding or release warning;
- model, target, data, provider, feature, and actual-evidence versions/timestamps;
- any scenario-support extension used to represent classifier tail mass.

## Known Limits and Next Model

- Register and freeze an untouched prospective cohort before further tuning.
- Replace the approximate final refit with full player-disjoint cross-fitted
  residuals and probability calibration.
- Replace sparse one-scenario JAWS support extensions with a learned elite-tail
  component evaluated at P95/P99, tail-weighted scoring rules, and expected
  shortfall. Early Hall-event slices are diagnostic, not central-interval
  coverage targets.
- Replace completed-career-end splits with rolling debut/prediction-origin cohorts
  and censoring-aware evaluation.
- Add preregistered normalized era/context features; raw calendar year is excluded
  from this version.
- Build annual opportunity, performance, exit/re-entry, aging, and injury
  components before calling the chart a career simulation.
- Validate a direct MiLB entry-state and career bridge on near-term MLB value;
  current minor-league performance does not yet shape the conditional career
  distribution beyond the arrival model.
- Add scouting and tracking components as named challengers, not default truths.
- Keep the eventual market-value layer separate until price, population,
  transaction-cost, and liquidity data can be modeled.

No Baseball Oracle result is investment advice. The current artifact is a
reproducible research ranking designed to earn stronger evidence over time.
