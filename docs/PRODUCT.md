# Baseball Oracle Product Definition

## Purpose

Baseball Oracle is a decision-support platform for two linked questions:

1. What is the probability that a minor league player reaches Major League Baseball, and on what timeline?
2. If the player reaches MLB, what range of career outcomes is plausible as new minor and major league evidence arrives?

The product should help a researcher move from the full player universe to a defensible shortlist, understand why the model has an opinion, and preserve the exact information state behind each decision.

Baseball Oracle forecasts baseball outcomes. A later market layer can compare those forecasts with collectible prices and liquidity. Player quality and investment value must remain separate concepts until market data exists.

## Product Principles

- **Probabilities, not promises.** Every forecast is a calibrated probability or distribution with a defined horizon.
- **Probability is not confidence.** `P(reaches MLB in three years)` is the modeled outcome probability. Forecast confidence describes data coverage, sample size, stability, and uncertainty.
- **Point-in-time by default.** Every board, profile, comparison, and backtest is reproducible as of a named date and model version.
- **Evidence earns trust.** Surface normalized performance, development trends, comparable cohorts, key positive and negative drivers, and model validation next to the forecast.
- **Separate populations.** Hitters and pitchers require different features, outcome dynamics, and models. Role and level transitions also matter.
- **No hidden target changes.** A debut probability, a regular-player probability, a star-outcome probability, and a Hall of Fame path are distinct targets.
- **Research cockpit first.** The first screen is the usable player board, not a marketing landing page.

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

Hall of Fame probability is not an MVP target. The historical positive class is tiny, careers are heavily right-censored, and voting standards change. The platform should first model observable stepping stones such as peak WAR, productive longevity, awards-level seasons, and aging. A Hall of Fame path score can later be derived from those components with prominent caveats.

## First Shippable Workflow

The first release supports one complete loop:

1. **Scan:** Open the Prospect Board and rank the universe by MLB arrival probability, career ceiling, or recent change.
2. **Narrow:** Search and filter by player type, organization, position, level, age, and forecast confidence.
3. **Compare:** Select two to four players and compare outcome distributions, timelines, drivers, and data coverage on the same scale.
4. **Investigate:** Open a Player Dossier to inspect development, career arc, comparable players, and the evidence behind the score.
5. **Commit:** Add a player to a watchlist with a thesis, target milestone, and review date.
6. **Revisit:** See what changed between prediction snapshots and whether the original thesis strengthened or weakened.

The initial build may use clearly labeled demonstration data, but every interaction should behave as it will with production prediction snapshots.

## Product Views

### Prospect Board

This is the default view and the primary work surface.

Required controls:

- Player search
- Hitter/pitcher segmented control
- Organization, position, level, age, and data-quality filters
- Sort by MLB probability, ETA, ceiling, risk, or forecast change
- Compare selection
- Add-to-watchlist action

Required row fields:

- Player, organization, position, age, and current level
- Three-year MLB probability and expected debut window
- Median and upper-quantile career outcome, explicitly marked conditional where needed
- Forecast confidence/data quality
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
- Career-arc fan chart with median and uncertainty bands
- Milestone probabilities and development archetype
- Positive and negative drivers with direction and magnitude
- Historical comparable cohort with stage-matched context
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
- Current watchlist thesis, when present

### Watchlist

The MVP watchlist stores:

- Player
- Research status such as `Watching`, `Priority`, or `Pass`
- Thesis and primary risk
- Target milestone and review date
- Prediction snapshot at the time the player was added
- Change since that snapshot

Local persistence is acceptable for the prototype. Account-backed storage belongs in the first production phase.

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
- `Forecast confidence`: High, Medium, or Low based on data sufficiency and stability
- `Data quality`: coverage, freshness, missingness, and source reliability
- `Ceiling`: a named upper quantile such as P90, not a best-case story
- `Risk`: distribution width and downside probability, not merely low MLB probability
- `As of`: the latest event time eligible for the prediction

Never use a single unexplained score as a substitute for these components.

## Release Plan

### Phase 0: Interactive Product Prototype

- Prospect Board with search, filters, sort, and responsive behavior
- Player Dossier with arrival forecast, career fan chart, drivers, and comparables
- Two-to-four-player comparison
- Locally persisted watchlist and thesis
- Demonstration prediction snapshots behind typed interfaces
- Clear demo-data, as-of, and model-version labels

Exit criterion: a user can complete the scan-to-watchlist workflow without dead controls and can explain the reason, uncertainty, and vintage behind each forecast.

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
- Account-backed watchlists, notes, and saved screens
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
- Dossier and comparison usage before a watchlist decision
- Percentage of watchlist decisions with a written thesis and review date
- Ability to reproduce the exact forecast used for a past decision
- Alert usefulness and false-positive rate once continuous updates exist

## Explicit Non-Goals For The MVP

- Real-money trading, brokerage, or automated purchasing
- A definitive Hall of Fame classifier
- One universal score that mixes baseball quality, certainty, and market value
- Real-time online model inference for every page request
- Unlicensed scraping or data whose lineage cannot be audited
- Social feeds, gamification, or a marketing-heavy home page

