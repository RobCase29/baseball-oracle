# Baseball Oracle Research Program

Status: active research plan as of July 12, 2026.

## North Star

Baseball Oracle will estimate two linked distributions from information available
at a declared timestamp:

1. `P(MLB debut by horizon | affiliated history through as_of)` for 12, 24, 36,
   48, and 60 months.
2. The joint distribution of playing opportunity, performance, durability, WAR,
   peak value, and career length after debut.

Pre-debut elite-career probabilities will integrate the arrival distribution with
the conditional career distribution. Hall-of-Fame-caliber performance will be an
objective, position- and era-versioned career outcome. Actual induction will be a
separate voting and eligibility model. Baseball value will remain separate from a
later market-return model containing price, liquidity, fees, and popularity.

## Non-Negotiable Contracts

- The denominator must be explicit. The current estimand is conditional on a
  recorded affiliated-season appearance; it is not yet a complete contract-roster
  estimand because zero-appearance players may be absent.
- Every feature is joined through a stable source ID and bounded by `as_of`.
  Names are display fields, never silent identity keys.
- Effective time and knowledge time are separate. Reconstructed historical values
  stay out of strict knowledge-time claims until their original publication time
  is evidenced.
- Active or unresolved careers are censored, not labeled as failures.
- Transformations, normalizers, feature selection, imputation, models, and
  calibrators are fit inside each chronological fold.
- Raw inputs, prepared tables, splits, models, and reports are content-addressed.
- No player probability reaches the product until a candidate passes frozen
  release gates. Provider scores remain labeled source observations.

## Data Backbone

| Layer | Current source | Role | Next action |
| --- | --- | --- | --- |
| Identity | [Chadwick Register](https://github.com/chadwickbureau/register) | Stable UUID and provider crosswalks | Snapshot every release and preserve merge/split history |
| MLB outcomes | [SABR Lahman](https://sabr.org/lahman-database/) | Debut, annual performance, awards, Hall voting | Add provider-versioned WAR and newer releases |
| Event validation | [Retrosheet](https://www.retrosheet.org/downloads/csvoverview.html) | Debut validation, daily/game history, career dynamics | Build daily opportunity and re-entry states |
| Affiliated population | Permitted Baseball-Reference Register | Full recorded season-appearance population | Add post-2020 cohorts and a contract-roster sensitivity source |
| Scouting | Permitted FanGraphs Board | Contemporaneous grades, ranks, acquisition context | Preserve report/update timestamps; use only as an ablation |
| Recent tracking | Permitted Prospect Savant | Component metrics and coverage-aware challenger | Obtain a versioned feed/data dictionary; never impute untracked as zero |
| Official MLB/MiLB | MLB Stats API and Savant | Potential roster, transaction, game, and tracking backbone | Written MLB automation, storage, ML, and output authorization required before ingestion |
| Production MiLB depth | SIS, Chadwick commercial, TrackMan/club partnerships | Contract rosters, injuries, defense, broader tracking | Evaluate rights, history, completeness, and cost |

Public endpoint access is not a license. MLB's current
[Terms of Use](https://www.mlb.com/official-information/terms-of-use) prohibit
automated collection, so Baseball Oracle will not run a bulk MLB/StatsAPI crawler
without written authorization. The project-authorized FanGraphs, Sports Reference,
and Prospect Savant sources remain bounded by their recorded research permissions.

## Signal Inventory and Coverage Gates

The model will not confuse a long feature list with a complete dataset. Each
signal family needs an explicit population, timestamp, denominator, missingness
meaning, identity key, source version, and rights record before it can enter a
forward fold.

| Signal family | Required history | Admission gate | Model use |
| --- | --- | --- | --- |
| Membership and identity | Every team, level, organization stint and stable crosswalk | Declared pages reconcile; unresolved identities are quarantined; no name-only joins | Denominator, repeated landmarks, player clustering |
| Biographical and acquisition | Birth date, handedness, position, size, draft/signing route, round, bonus where licensed | Effective date known; source conflicts retained; missing is not zero | Age curves, role priors, acquisition-capital ablation |
| Minor-league performance | Raw batting, pitching, fielding numerators and denominators by stint | Stats end by `as_of`; innings are losslessly converted to outs; league coverage is measured | Shrunken skill components and workload |
| Environment | League, level, park, run environment, schedule, organization, rule era | Versioned season mappings; park/league factors fit inside each training fold | Context-neutral performance and era transfer |
| Development path | Promotions, demotions, repeats, days at level, role changes, workload deltas | Effective-dated events with no reconstructed future state | Development velocity and competing-risk states |
| Availability | Injured, restricted, inactive, released, retirement and return states | Licensed historical transactions or roster snapshots with measured gaps | Opportunity, attrition, exit and re-entry hazards |
| Scouting | Overall/FV, tool or pitch grades, rank, report date, evaluator/source | Original publication time evidenced; narrative rights respected; source-only missingness flags | Point-in-time scouting challenger and disagreement features |
| Tracking | Contact quality, swing decisions, batted-ball shape, pitch shape, velocity, command proxies | Coverage denominator retained by season/level/player; untracked never becomes zero | Recent component-skill challenger |
| MLB opportunity and value | Roster state, PA/BF/IP, position, defense, baserunning, run prevention and provider-versioned WAR | Daily or seasonal data reconcile to provider totals; WAR definition is named and frozen | Career-state, playing-time and value paths |
| Hall outcomes | Eligibility, ballot year, vote share, induction route, career and peak value | Only retired/eligible players enter induction labels; rules and eras are versioned | Separate caliber and actual-induction probabilities |
| Market evidence | Timestamped transactions, price, grade, venue, fees, liquidity and survivorship | Point-in-time holdings universe and delisted/unsold outcomes are retained | Separate expected-return and portfolio model |

Before a new family is admitted, its coverage ledger must report rows, players,
teams, seasons, levels, event denominators, identity resolution, missingness by
outcome and era, earliest evidenced `known_at`, archive digest, and permission
evidence. It must then pass a forward-fold ablation, a coverage-aware missingness
stress test, and subgroup calibration review. Features that fail add no hidden
fallback; they remain source observations outside the released model.

## Execution Ladder

### P0: Coverage and lineage

- Keep the completed, archived 2010-2019 affiliated appearance cohorts immutable.
- Add post-2020 cohorts for regime diagnostics. Preserve 2020 as a structural
  zero. Freeze 2021 long-horizon labels until they mature.
- Maintain a season-by-source coverage ledger containing teams, leagues, levels,
  players, events, missingness, identity resolution, and archive receipts.
- Obtain a dated contract-roster census or commercial equivalent for a sensitivity
  study that includes inactive and zero-appearance players.

### P1: Longitudinal arrival corpus

- Union every eligible season through `modeling/arrival_corpus.py`.
- Verify the dataset content address, exact schema, label censoring semantics,
  supported parser run, permission evidence, four prepared inputs, and private archive
  lock before admitting a season.
- Preserve raw numerators, denominators, every team/organization/level stint,
  coverage indicators, and a player-cluster key.
- Add effective-dated league, level, park, organization, workload, promotion,
  transaction, and acquisition-capital features.

### P2: Arrival model ladder

1. Empirical-Bayes age x level x role x era base rates.
2. Separate hitter and pitcher regularized discrete-time hazards.
3. Monthly cause-specific or competing-risk hazards when transaction states are
   complete enough.
4. A nonlinear boosted survival challenger.
5. A nonnegative ensemble fit only to out-of-fold predictions.

Feature families enter in order: demographics/context, shrunken performance,
development trajectories, acquisition/scouting, then tracking. Every added family
requires a forward-fold ablation, missingness stress test, and era/organization
stability report.

### P3: Temporal evaluation and calibration

- Use expanding chronological train/calibration/test blocks. At every origin, use
  only labels available by that origin.
- Score ordinary Brier, log loss, AUC, average precision, and calibration only on
  fully mature binary horizons. Add IPCW/integrated survival metrics before using
  partially followed cohorts in horizon metrics.
- Report online and cold-start results, player-cluster bootstrap intervals,
  top-1/5/10% lift, calibration intercept/slope, reliability bands, and subgroup
  results by role, age, level, organization, coverage tier, and era.
- Report paired player-cluster intervals for every baseline comparison and pooled
  out-of-fold observed/expected ratios; correlated fold point estimates are not
  independent release evidence.
- Fit Platt/beta/isotonic alternatives on a chronological calibration block while
  preserving horizon monotonicity.
- Lock a prospective holdout digest before feature or model selection.

### P4: Career arc

- Forecast at debut, fixed opportunity landmarks, and each season end.
- Model roster state and exit/re-entry, then playing time conditional on state,
  then denominator-aware skill components.
- Build separate hitter and pitcher dynamic aging models with partial pooling by
  role, position, handedness, era, and prior opportunity.
- Feed simulated components into a named, provider-versioned WAR calculator.
- Retain joint Monte Carlo paths and derive seasonal/career WAR, peak seven-year
  WAR, career length, age of peak, milestone probabilities, and uncertainty bands.

### P5: Hall-of-Fame-caliber and investment layers

- Define objective position/era thresholds over career and peak value; publish the
  probability of reaching them from joint career simulations.
- Train actual induction only on retired, eligible cohorts with ballot-era and
  rule covariates. Current non-inductees remain censored.
- Build a separate point-in-time market model before describing any player score as
  expected investment return. Evaluate portfolio lift, expected value, liquidity,
  fees, and downside/CVaR at predeclared budgets.

## Candidate Promotion Gates

Thresholds are frozen before the locked holdout is opened:

- Positive Brier skill against both global and censoring-aware age-level-role
  hazard baselines overall, with a paired player-cluster 95% lower bound above
  zero, and point improvement in at least 75% of eligible forward folds.
- Absolute calibration-in-the-large at most 0.02 and calibration slope from 0.8
  through 1.2 on the locked evaluation block.
- Observed/expected event ratio from 0.8 through 1.25 for rare horizons and
  cold-start strata when event counts support a stable estimate.
- No cumulative-probability horizon violations.
- No critical cohort regression worse than 0.01 Brier; 2021 and missing-feature
  stress tests must be reported explicitly.
- Major subgroup absolute calibration error at most 0.05 when sample and event
  counts support a stable estimate.
- Complete current-universe scoring, source freshness, lineage, OOD, and missingness
  checks before atomic publication.

Passing these gates makes a candidate eligible for release review. It does not
automatically publish it.

## Current Checkpoint

The verified population corpus now contains every nonzero affiliated season from
2010 through 2019: 69,326 eligible player-season snapshots, 24,406 players, and
9,832 MLB debuts within 60 months. All rows are mature through the five-year
horizon. The 2015 source census explicitly preserves one declared `Record: N/A`
affiliate with no player tables; it contributes zero synthetic players while
remaining visible in coverage provenance.

The first role-aware annual-hazard benchmark completed nine expanding-origin
folds and 35 supported fold-horizons. It beat the hierarchical age-level-role
baseline on all 35 Brier comparisons. Median AUC is 0.918 and median top-decile
lift is 5.9x. Calibration-in-the-large is within 0.02 on 34 of 35 comparisons,
but five-year calibration slopes are below the 0.8 gate and cold-start five-year
risk is underpredicted. The Brier wins are correlated point estimates and do not
yet have paired skill intervals. The model remains research-only.

The immediate queue is:

1. Freeze chronological calibration and prospective holdout manifests before
   selecting the next model.
2. Add effective-dated league, park, level, organization, era, workload, and
   promotion-trajectory normalization, then rerun ablations.
3. Add IPCW survival metrics, monthly competing-risk states, and missing-feature,
   cold-start, post-2020, and organization-shift stress tests. Replace the current
   mature-row empirical-Bayes comparator with a censoring-aware null hazard and
   add paired player-cluster skill intervals.
4. Add permitted scouting and tracking sources only through versioned coverage
   contracts, then evaluate them as challengers to the performance-only model.
5. Begin post-debut opportunity, component-skill, WAR, aging, and exit/re-entry
   models while the arrival challengers are evaluated in parallel.
