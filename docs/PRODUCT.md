# Baseball Oracle Product Definition

## Purpose

Baseball Oracle is a decision-support platform for two linked questions:

1. What is the probability that a minor league player reaches Major League Baseball, and on what timeline?
2. If the player reaches MLB, what range of career outcomes is plausible as new minor and major league evidence arrives?

The product should help a researcher move from the full player universe to a defensible shortlist, understand why the model has an opinion, and preserve the exact information state behind each decision.

Baseball Oracle forecasts baseball outcomes. A later market layer can compare those forecasts with collectible prices and liquidity. Player quality and investment value must remain separate concepts until market data exists.

## Current MVP Checkpoint

The July 2026 MVP is a three-state research cockpit across two modeling regimes:
pre-debut prospects, Rookie Track transitions, and supported MLB careers. It
combines a live directory
of 6,179 canonical minor-league players with a locked 2026 40-man-roster census
covering 1,291 canonical Baseball-Reference MLB identities, for 7,470 active
player records. The career evidence
base contains 117,033 player-seasons from 1871 through the in-season 2026 census;
2025 is the latest complete season used for scoring features.

For MLB players, the MVP reports a paired terminal distribution for final career
WAR, peak-seven WAR, and JAWS, plus `P(final JAWS clears the career-to-date
role/position standard)`. For minor leaguers, it composes a separately evaluated
60-month arrival lower-bound proxy with a debut-age career bridge. Those are
different endpoints, so MLB and MiLB ranks are stage-specific. Directory defaults
to player-name order, also supports an age sort, and never implies a combined rank.

Player Map v2 presents three separate decision signals. Career Index measures the
absolute magnitude of the final-career WAR distribution on frozen career-value
anchors. Stage standing reports rank and tail band inside the declared prospect
or MLB universe. Evidence reports sample and coverage strength. The first two are
not blended, and evidence changes trust rather than score. The exact contract is
defined in [`CAREER_INDEX_V1.md`](./CAREER_INDEX_V1.md).

Rookie Track preserves the frozen prospect Career Index and stage standing during
the first partial MLB season while current MLB opportunity and WAR arrive as
separate confirmation evidence. A supported completed-season MLB forecast, not a
daily partial-season statistic, triggers the later route transition.

Minor-league performance currently affects the arrival component but does not yet
shape the conditional terminal career distribution, which uses role and estimated
debut age. A direct cross-level entry-state model is a required next component.

All outputs remain research-only. The inspected historical test was reviewed
during model development and is therefore a development holdout, not prospective
validation. The external arrival evaluation failed registered admission gates;
the career intervals also retain failed release gates. Current 2026 statistics
are context only, and unsupported partial-season, stale-return, no-appearance,
two-way, and failed-distribution cases are withheld instead of filled with a
plausible-looking heuristic.

## Product Principles

- **Probabilities, not promises.** Every released forecast is a calibrated probability or distribution with a defined horizon.
- **Research is not release.** Candidate estimates may expose model behavior, but only a released forecast may claim validated calibration for its exact scoring procedure.
- **Probability is not confidence.** `P(reaches MLB in three years)` is the modeled outcome probability. Forecast confidence describes data coverage, sample size, stability, and uncertainty.
- **Point-in-time by default.** Every board, profile, comparison, and backtest is reproducible as of a named date and model version.
- **Evidence earns trust.** Surface normalized performance, development trends, comparable cohorts, key positive and negative drivers, and model validation next to the forecast.
- **Separate populations.** Hitters and pitchers require different features, outcome dynamics, and models. Role and level transitions also matter.
- **No hidden target changes.** A debut probability, a regular-player probability, a star-outcome probability, and a Hall of Fame path are distinct targets.
- **Research cockpit first.** The first screen is the usable player board, not a marketing landing page.

## Universal Player Map

Every active player receives a Player Map profile even when no release-grade
probability exists. Player Map v2 leads with three intentionally separate fields:

- **Career Index:** fixed-scale career-value magnitude from final WAR P50, P75,
  and P90. It is not a probability, percentile, or expected WAR.
- **Stage standing:** exact rank, universe, top-share percentage, and tail band
  for the declared stage cohort. Prospect ranks retain the frozen 6,455-player
  universe rather than changing with the active directory.
- **Evidence:** sample and source coverage that governs how much trust to place
  in the output without changing either value.

The explanatory map remains a fixed vector, not a blended score:

- **Outcome:** stage-specific standing on the strongest supported value target.
- **Readiness:** arrival confirmation for MiLB or near-term impact for MLB.
- **Trajectory:** age/level runway for MiLB or historical career pace for MLB.
- **Current traits:** the strongest observed skill plus material weaknesses.
- **Evidence:** sample and source coverage. Evidence changes how much to trust an
  outcome rank; it does not raise or lower the outcome rank itself.

Each dimension carries its scale, comparison universe, target, model vintage, and
claim state. MiLB and MLB stage standings are not directly interchangeable.
Career Index uses one fixed numerical scale, but that does not make the forecast
routes equally mature or reliable. Missing dimensions are `withheld` or
`evidence building`, never zero.

The map assigns a readable research state such as `Conviction`, `Discovery`,
`Rising`, `Monitor`, `Mapped`, or `Evidence building`. Sparse Alpha Radar alerts
remain a separate layer. For example, a player can be a top-decile direct-impact
`Discovery` while the separate arrival gate is unconfirmed. That disagreement is
the finding, not a reason to erase the player from the board.

The Player Map is designed to cover the complete active census. Directory is the
identity and coverage surface, not a cross-stage leaderboard. Ranked surfaces
remain grouped by stage and retain their declared cohorts. Its dimensions
can be upgraded independently as point-in-time Statcast, minor-league performance,
scouting, and snapshot-to-snapshot development challengers pass forward tests.

## Core Forecasts

### MLB Arrival

For an eligible minor league player, report:

- Probability of an MLB appearance within one, three, and five years
- Estimated debut window, expressed as a distribution rather than a single date
- Probability of never reaching MLB before the defined eligibility horizon
- Forecast confidence and data-quality status
- Change since the previous point-in-time prediction snapshot

The primary label is an official MLB appearance. Later releases can add stronger milestones such as 100 plate appearances, 50 innings pitched, or a full season on an active roster.

### Career Arc

For a player who has debuted, and for a prospect conditional on debut, report:

- Seasonal WAR quantiles by future age or season
- Career WAR and career length quantiles
- Probability of becoming a regular, producing an All-Star-caliber season, and reaching longevity milestones
- Development trajectory or archetype
- Comparable historical players selected from information available at the same career stage
- Change in outlook as new MLB evidence arrives

The interface must clearly label conditional forecasts. For example, a prospect's career arc is `conditional on reaching MLB`; the unconditional star probability also includes the risk of never arriving.

The MVP Hall target is a statistical career threshold, not induction probability.
It is derived from final WAR and peak-seven WAR through JAWS and compared with an
exact position/role standard. Actual induction remains descriptive only because
voting rules, eligibility, era, and committee paths are separate mechanisms. The
positive class is rare, so the research probability and ranking remain unreleased
until a newly frozen forward cohort and all distribution/calibration gates pass.

The career chapter is a separate lifecycle description learned for hitters,
starters, and relievers from post-1961 unconditional next-season WAR change and
continuation curves. Its near-term MLB endpoint is the calibrated probability
that the next three completed seasons total at least the global training-fold
90th-percentile WAR threshold. That probability is globally comparable and is
not another Hall-caliber probability. Historical completed-season WAR pace is
descriptive context only.

Alpha Radar remains a separate sparse research alert. It only ranks players who
clear the early-career, learned-runway, broad historical-support, positive-edge,
and absolute P90 JAWS ceiling gates. The alert value is the percentage-point gap
between the modeled Hall-caliber probability and the supported post-1961 base
rate. It is model alpha, not market alpha; price is explicitly shown as missing.

## First Shippable Workflow

The first release supports one complete loop:

1. **Scan:** Open a stage ranking and compare Career Index, stage standing, and
   evidence without conflating them.
2. **Narrow:** Search and filter by player type, organization, position, and minor-league level; every filter is reflected in the shareable URL.
3. **Compare:** Move among players on the same filtered stage while keeping rank definitions, evidence scales, and uncertainty marks consistent.
4. **Investigate:** Open a Player Dossier to inspect development, career arc, comparable players, and the evidence behind the score.
5. **Cross-check:** Use Directory to locate any covered player without treating its cross-stage row order as a ranking.
6. **Revisit:** See what changed between prediction snapshots and whether the original thesis strengthened or weakened.

The current build uses real players and real source evidence; missing or unsupported model outputs remain visibly withheld.

The decision surface separates prospects, Rookie Track, and MLB visually. The
MiLB board pairs team, position, role, level, and search filters with a prospect
landscape that plots Career Index against current data coverage. The player
dossier keeps stage standing, age context, and current raw-trait evidence on separate
scales. For MLB players, recorded cumulative WAR is connected through the latest
completed season, while future uncertainty is rendered only as a discrete
terminal distribution. The product does not imply an unsupported annual path.

## Product Views

### Rankings Table

This is the default view and the primary work surface.

Required controls:

- Player search
- Hitter/pitcher segmented control
- Organization, position, level, age, and data-quality filters
- Sort by Career Index, stage standing, near-term impact, terminal outcome, or arrival horizon
- Compare selection

Required row fields:

- Player, organization, position, age, and current level
- Career Index, exact stage rank, tail band, and evidence state
- Three-year MLB probability and expected debut window
- Median and upper-quantile career outcome, explicitly marked conditional where needed
- Forecast confidence/data quality
- Career chapter and its explicitly named near-term endpoint where supported
- Change since prior snapshot
- Data freshness and as-of date

Dense, sortable table behavior is more useful here than a grid of decorative cards. On smaller screens, preserve player identity and the two primary forecasts, then expose secondary fields in a detail drawer.

### Player Dossier

The dossier answers four questions in order:

1. What does the model expect?
2. How broad is the plausible range?
3. What evidence drives the forecast?
4. What has changed?

The overview should include:

- Identity, organization, role, age, level, handedness, and roster status
- As-of date, model version, prediction age, and data coverage
- MLB arrival probabilities across multiple horizons
- Recorded cumulative WAR with a discrete terminal career distribution and named uncertainty intervals
- Milestone probabilities and development archetype
- Positive and negative drivers with direction and magnitude
- Historical comparable cohort with stage-matched context
- Learned career chapter, absolute three-season impact probability, and
  completed-season historical WAR-pace percentile; each is labeled as a distinct
  concept
- Snapshot-to-snapshot change log

Supporting tabs can group normalized minor/major statistics, development trends, comparable players, and model evidence. Raw statistics should always show league, park, age, and level context where available.

### Compare

Comparison uses shared axes and definitions. It should show:

- Arrival-probability curves
- Career WAR distributions
- Ceiling versus floor
- Risk and missing-data flags
- Development trend differences
- Common and divergent comparables
- Rookie Track status and the separation between the frozen prospect prior and
  current MLB evidence

### Rookie Track

The first partial MLB season is a distinct transition state. Rookie Track keeps
the player visible while the major-league sample is still too small for the
established-player career model:

- Preserve the last matched prospect rank and high-case outcome as a frozen prior.
- Show current MLB opportunity, WAR, and role-relative standing as separate evidence.
- Label evidence depth so a hot first month is not presented as a settled forecast.
- Never manufacture a prospect score when the player cannot be matched to an exact prior.
- Move the player into the established MLB cohort only after the release-gated career model has sufficient evidence.

### Model Lab

Trust is a product feature. A compact model view should expose:

- Model and feature-set versions
- Training and evaluation windows
- Calibration by horizon
- Brier score, log loss, ranking quality, and precision at the researcher's shortlist size
- Performance by hitter/pitcher, level, age band, and data-coverage cohort
- Known limitations and current data gaps

## Forecast Language

Use labels that make statistical meaning explicit:

- `MLB probability`: calibrated probability of the defined outcome by a named horizon
- `Career arc`: a distribution of future outcomes, not a point estimate
- `Career chapter`: a learned lifecycle state, not an outcome probability
- `Near-term impact`: calibrated probability that the next three completed MLB
  seasons clear the frozen global training-fold WAR threshold
- `Historical WAR pace`: completed-season descriptive context, not a forecast
- `Alpha opportunity`: modeled Hall-caliber probability minus a supported broad
  historical base rate, gated by early runway and absolute P90 JAWS ceiling
- `Model alpha`: abnormality versus baseball history; not market mispricing or
  expected investment return
- `Discovery only`: MiLB arrival research that is excluded from Alpha rank
- `Forecast confidence`: High, Medium, or Low based on data sufficiency and stability
- `Data quality`: coverage, freshness, missingness, and source reliability
- `Ceiling`: a named upper quantile such as P90, not a best-case story
- `Risk`: distribution width and downside probability, not merely low MLB probability
- `As of`: the latest event time eligible for the prediction

Never use a single unexplained score as a substitute for these components.

## Release Plan

### Phase 0: Interactive Product Prototype

- Rankings Table and alphabetical Directory with search, filters, sort, and
  responsive behavior
- Rookie Track continuity between frozen prospect priors and partial-season MLB
  evidence
- Player Dossier with arrival forecast, career fan chart, drivers, and comparables
- Two-to-four-player comparison
- Shareable player and filter state
- Demonstration prediction snapshots behind typed interfaces
- Clear demo-data, as-of, and model-version labels

Exit criterion: a user can complete the scan-to-dossier workflow without dead
controls and can explain the reason, uncertainty, and vintage behind each forecast.

### Phase 1: Defensible Baseball Baseline

- Canonical player identity and source lineage
- Historical minor and major league data with league/park/age context
- Point-in-time feature generation and outcome labels
- Separate hitter and pitcher arrival baselines
- Conditional career-arc baseline
- Walk-forward backtests and calibration reports
- Materialized prediction snapshots served to the app

Exit criterion: every displayed historical prediction can be reproduced without future-data leakage, and validation is visible by relevant cohort.

### Phase 2: Continuous Research Platform

- Scheduled ingestion and prediction runs
- New-evidence and material-change alerts
- Account-backed research notes and saved screens
- Scouting, biomechanical, injury, transaction, and environmental feature families where lawful and reliable
- Cohort discovery and experiment tracking

Exit criterion: new data flows from source to validated forecast on a measured schedule, with failures and drift surfaced.

### Phase 3: Investment Layer

- Collectible transaction, population, grade, condition, fee, and liquidity data
- Market-implied player expectations
- Scenario-based return distributions and position sizing
- Portfolio exposure, correlation, and exit-liquidity views

Exit criterion: investment rankings are based on the gap between baseball forecasts and market prices, not on baseball upside alone.

## Success Measures

Model quality:

- Calibration error, Brier score, and log loss by horizon
- Precision and recall among the top-ranked research cohort
- Career-arc interval coverage and error by future horizon
- Stability and drift by source, level, player type, and model version

Product quality:

- Time from opening the board to a defensible shortlist
- Dossier and comparison usage before a shortlist decision
- Percentage of shortlist decisions with a written thesis and review date
- Ability to reproduce the exact forecast used for a past decision
- Alert usefulness and false-positive rate once continuous updates exist

## Explicit Non-Goals For The MVP

- Real-money trading, brokerage, or automated purchasing
- A definitive Hall of Fame classifier
- One universal score that mixes baseball quality, certainty, and market value
- Real-time online model inference for every page request
- Unlicensed scraping or data whose lineage cannot be audited
- Social feeds, gamification, or a marketing-heavy home page
