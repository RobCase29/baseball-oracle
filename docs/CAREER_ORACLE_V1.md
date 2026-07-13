# Career Oracle Research Contract

Status: implemented research MVP, not release eligible  
Revised: 2026-07-13
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
separate MiLB and MLB ranks because the minor-league bridge and the MLB landmark
model do not estimate directly comparable endpoints. Directory defaults to player
name, permits a noncompetitive age sort, and is explicitly non-ranking.

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

## Career Index Presentation Layer

`career-index-war-v1` is a product presentation transform over the forecast
distribution, not a new model target or calibrated learner. It maps final-career
WAR to fixed values at 0, 5, 20, 40, 60, 80, and 100 WAR, corresponding to index
values 0, 20, 45, 65, 80, 92, and 100. Linear interpolation is used between
anchors. The final index weights transformed P50, P75, and P90 at 50%, 30%, and
20%, then rounds to one decimal.

The Career Index is not a probability, percentile, expected-WAR estimate,
confidence score, or Hall induction forecast. It does not use current roster
size, another player's score, current market data, or evidence coverage. Its
definition is frozen in [`CAREER_INDEX_V1.md`](./CAREER_INDEX_V1.md).

Stage standing remains separate. It publishes exact rank, universe, rank share,
and tail band for the declared modeling route. The prospect reference universe is
the frozen 6,455-player forecast artifact. Removing graduated, inactive, or
unmatched players from the current directory cannot improve another prospect's
standing. Directory itself is an identity and coverage union with name and age
sorts, not a combined ranking.

Rookie Track preserves the exact prospect distribution, Career Index, rank, and
6,455-player universe through the first partial MLB season. Current MLB WAR and
opportunity are displayed as separate evidence and cannot update the frozen
prior. The player moves to the MLB Career Index only when a supported
completed-season MLB forecast exists. If no exact prospect prior is available,
both Career Index and stage standing remain null.

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
- Rank current MLB players only against the declared current-MLB scoring census.
- Preserve prospect ranks from the frozen 6,455-player research forecast
  artifact; the active directory is a coverage subset, not a new rank universe.
- Keep Directory name and age sorts explicitly non-ranking; player name is the
  default. Ranked surfaces remain stage-specific rather than presenting one
  combined leaderboard.
- Keep Career Index, stage standing, and evidence separate. Evidence never
  changes either score.
- Keep Rookie Track on its frozen prospect prior until a supported
  completed-season MLB route exists.
- Confidence is a coverage/support heuristic, not a frequentist coverage
  probability and never changes rank.

## Career Chapters And Near-Term Impact

`career-chapter-v1` separates lifecycle context from both the terminal outcome
model and the statistical Hall-caliber tail. It is never multiplied into or
substituted for the Hall-caliber probability.

Career chapters are learned separately for hitters, starters, and relievers from
post-1961 completed-season landmarks. The reference curves use unconditional
next-season WAR change and the probability of recording a following MLB season,
so non-return seasons contribute zero rather than disappearing through survivor
selection. The learned prime/decline/late boundaries are ages 28/33/38 for
hitters, 26/33/37 for starters, and 30/34/38 for relievers. The exported chapter
describes launch, development, prime/plateau, decline, late-career, or an
unsupported uncertain state. It also records expected next-WAR change,
continuation, reference support, evidence season, and warnings.

The MLB ranking endpoint is a distinct calibrated event:

`P(next 3 completed MLB seasons total WAR >= 4.68)`

The 4.68-WAR threshold is the global player-weighted training-fold 90th
percentile, learned once and applied across current MLB players. This makes the
event globally comparable and prevents a player from looking exceptional merely
by leading a small age-role cohort. It is a near-term impact probability, not a
Hall-caliber probability, induction probability, or claim that an annual career
path has been simulated.

The research split trains through 2011, calibrates with sigmoid scaling on
2012-2017, and tests chronological prediction origins from 2018-2022. The
calibrated test includes 7,076 landmarks and 932 events; player-weighted event
rate is 9.745%, ROC AUC 0.87516, average precision 0.54871, Brier score 0.06145,
and log loss 0.21669. These are retrospective diagnostics, not release or
prospective superiority evidence.

Completed-season historical WAR pace remains available as descriptive context
against resolved historical landmarks. It reads only the forecast feature
landmark, so current partial-season WAR cannot change the comparison. It is not
a second outcome probability and does not change the career chapter or any
forecast.

For minor leaguers, `nearTermImpact` sorts by the separately defined 36-month MLB
arrival probability. The product labels that endpoint explicitly and does not
reinterpret it as the MLB three-season impact event.

## Alpha Radar

`alpha-signal-v1` asks a narrower decision question: which supported current MLB
players have an unusually strong absolute Hall-caliber ceiling while there is
still time to identify them early? It is deliberately not another probability
model or a weighted composite score.

The historical base rate uses prior, resolved, target-eligible careers from 1961
forward. It matches the player's hitter/starter/reliever track and broad
experience band, begins with a plus-or-minus two-year age window, expands only
for support, and requires at least 500 distinct players. Every player has equal
total weight even if multiple landmarks enter the reference.

A current player is eligible only when all registered gates pass:

- no more than six completed MLB seasons;
- at least two years before the role track's learned prime boundary;
- a supported completed-season historical base rate;
- positive modeled Hall-caliber probability minus that base rate;
- P90 final JAWS margin at or above the career-to-date Hall standard.

Eligible players rank by probability-point delta, then absolute three-year
impact probability, then age. `Priority` requires a delta of at least 10
percentage points; other eligible players are `Watch`. Historical WAR pace and
the three-year impact endpoint explain the signal but do not independently make
a player eligible.

The player-disjoint development audit now preregisters exactly one decision
point per player: the earliest supported early-career snapshot. Among 3,189
supported pre-prime players, 29 eventually reached the Hall-caliber endpoint.
Only four cleared every Alpha gate, and one was an event. That 25% observed rate
is directionally encouraging but far too small to support a lift or performance
claim. The cohort was also human-reviewed and the chapter boundaries used the
full post-1961 panel. A newly frozen prospective cohort is required before this
can be called early-identification evidence, expected investment return, or
market mispricing.

Minor leaguers remain on a separate `Discovery only` track. Prospect alpha is
withheld until a direct, validated MiLB-to-career-ceiling model exists. Market
alpha additionally requires price history, liquidity, transaction costs, and an
external-consensus or market-implied baseline; none enters `alpha-signal-v1`.

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
- learned career chapter, role track, trajectory state, evidence season,
  reference support, continuation, expected next-WAR change, and warnings;
- calibrated absolute three-completed-season impact probability and its frozen
  global training-fold threshold where supported;
- completed-season historical WAR-pace percentile for MLB players where its
  resolved landmark cohort meets the registered support floor.
- Alpha eligibility, rank scope, modeled and historical probabilities,
  probability-point delta and lift, reference support, P90 JAWS margin, learned
  runway, gate results, and market-data warning.

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
- Validate the career-chapter and absolute near-term-impact layer on a newly
  frozen prediction-origin cohort before making an early-identification claim.
- Freeze Alpha Radar without further tuning and score a new prospective cohort;
  then add a separately evaluated market-residual layer using time-aligned price
  and external-consensus data.
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
