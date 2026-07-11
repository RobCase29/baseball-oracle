# Point-in-Time Data Contract

## Non-Negotiable Guarantee

For a prediction with timestamp `as_of`, every input must have been publicly knowable no later than `as_of`. Baseball Oracle must be able to reproduce the exact player universe, raw facts, derived features, model version, and output for any historical prediction.

Use append-only, bitemporal records. Each source observation should carry:

- `effective_at`: when the baseball event or measurement applies.
- `known_at`: earliest auditable time the source made the value available.
- `ingested_at`: when Baseball Oracle received it.
- `revision_id` and `supersedes_id`: lineage for corrections without overwriting history.
- `source_id`, source record key, license, and retrieval metadata.

An as-of join requires `known_at <= as_of` and chooses the latest eligible revision. If a historical publication time cannot be audited, `known_at` is unknown and the record is excluded from strict backtests. Current knowledge must never be backdated merely because it describes an old game.

## Storage Layers

### Raw

Store immutable source payloads exactly as received, including request parameters, response checksum, retrieval time, source version, and license metadata. Corrections create new objects.

### Canonical

Normalize identifiers, games, appearances, rosters, transactions, injuries, leagues, parks, levels, and statistical definitions. Preserve raw numerators and denominators; do not store only rates. Canonical tables retain source lineage and time semantics.

### Feature snapshots

Materialize features by `player_id`, `as_of`, and `feature_set_version`. Each feature definition declares its source columns, lookback window, minimum sample, missing-value meaning, transformation-fit window, and availability rule. Training and serving use the same definitions.

### Predictions

Persist predictions with `player_id`, `as_of`, target and horizon version, model and calibration versions, feature snapshot identifier, point estimate, distribution or interval, data-quality grade, out-of-distribution score, and explanation payload.

## Core Entities

### Player identity

Create an internal immutable `player_id`. External identifiers live in an effective-dated crosswalk with source namespace, external ID, confidence, evidence, and review status. Names are attributes, not keys. Never merge players solely on normalized name and birth date; ambiguous matches require review. Splits and merges are append-only identity events so historical forecasts remain reproducible.

### Roster census

A dated roster census defines the risk-set denominator. It must include players without statistics and record organization, affiliate, league, level, roster/list status, and coverage status. Preserve injured, restricted, suspended, complex-league, and recently inactive players rather than dropping them from the universe.

### Events and appearances

Represent games, player appearances, plate appearances or pitches where licensed, roster moves, injuries, signings, releases, options, and retirements as dated events. Link aggregates back to their constituent events and definition version. Official MLB appearance records determine debut.

### Context

League and level classification, park factors, run environment, rules, schedule length, organization, and minor-league structure must be effective-dated. The 2020 canceled affiliated season and the 2021 reorganization need explicit era markers. Context estimates used midseason must be computed only from prior data or from games completed by the snapshot.

## Required Snapshot Fields

Every player snapshot should contain at least:

- Stable player identity and identity-confidence status.
- `as_of`, exact age, handedness, primary role, and two-way status.
- Current organization, affiliate, level, roster status, and status start date.
- Acquisition channel and only the draft/signing facts known by `as_of`.
- Raw cumulative and rolling-window numerators and denominators through `as_of`.
- League-, park-, age-, role-, and era-relative features computed point in time.
- Promotion/demotion and workload histories through `as_of`.
- Injury and transaction history with source availability times.
- Measurement coverage indicators for pitch, batted-ball, tracking, and scouting data.
- Explicit missingness reason: no opportunity, source not covered, not yet published, structurally unavailable, or unknown.

Scouting ranks and grades require publisher, list name, publication timestamp, scale, rank universe, and edition. A year label is not an adequate timestamp.

## Universe and Outcome Rules

The pre-debut universe is all reliably observed affiliated professionals who have not made an official MLB regular-season appearance by the snapshot. Eligibility rules and exceptions are versioned. Players may enter late and can leave and re-enter.

Outcome tables distinguish:

- Event observed.
- Active and right-censored at the data cutoff.
- Temporarily inactive or outside covered leagues.
- Confirmed terminal exit.
- Lost to source coverage.

Missing future data is never automatically a zero or retirement. For post-debut forecasts, zero playing time after a confirmed terminal exit is distinct from an unobserved season.

## Feature Rules

- Retain count denominators and uncertainty for all rates.
- Fit league translations, park factors, normalization, imputation, embeddings, and target encodings inside each training window.
- Store both performance-only and all-public-information feature manifests.
- Do not use end-of-season level, awards, rankings, or aggregates for an earlier snapshot.
- Do not forward-fill injuries, transactions, roster states, or measurements across a time when their status was unknown.
- Include source-coverage flags so absence of tracking data is not interpreted as poor skill.
- Version statistical definitions; a column named `WAR` is invalid without provider/formula and version.
- Keep target construction in a separate namespace that feature builders cannot read.

## Quality Gates

Block a feature snapshot or training release when any of these fail:

- Unique keys and referential integrity for players, games, appearances, and rosters.
- No feature dependency with `known_at > as_of`.
- No target or post-snapshot field in the feature graph.
- Aggregate reconciliation to licensed source totals within declared tolerances.
- Plausible roster-universe counts by league, level, organization, and date.
- Duplicate-player and identity-collision checks.
- Monotonic cumulative counters unless a sourced correction event exists.
- Missingness and coverage drift checks by source, league, era, and cohort.
- Unit and range validation for age, velocity, distance, playing time, and rates.
- Reproducible feature hashes for identical raw snapshot and code versions.

Run explicit leakage canaries: future promotion, final-season statistics, eventual debut date, final career totals, and post-publication prospect ranks should be inserted into a test fixture and must be rejected by the feature pipeline.

## Reproducibility Manifest

Every training and prediction run records:

- Raw snapshot/content hashes and source licenses.
- Player-universe query and eligibility version.
- Feature definitions and code commit.
- `as_of`, training cutoff, label-availability cutoff, and evaluation cutoff.
- Split assignments and player-cluster identifiers.
- Model, hyperparameter, random-seed, and calibration versions.
- Target and metric definitions.
- Data-quality test results and approved exceptions.

Historical public data can still have restrictive commercial terms. Source licensing, redistribution rights, rate limits, and attribution requirements are fields in the data catalog and release gates, not an afterthought.
