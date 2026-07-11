# Historical Backfill Strategy

## Objective

Build the largest defensible, point-in-time baseball history available, then use it to train calibrated models that can score every active professional player. The system must reconstruct what was knowable on any historical date, not merely attach current facts to old seasons.

The backfill supports three linked forecast objects:

1. **MLB arrival:** cumulative probability of an official regular-season debut within 12, 24, 36, and 60 months.
2. **Career arc conditional on debut:** distributions for playing time, rate performance, seasonal value, career value, peak, longevity, and exit or re-entry.
3. **Elite-career tail:** probabilities of objective Hall-of-Fame-caliber career and peak thresholds. Actual induction is a later, separate model for retired eligible players because voting rules and eras affect that label.

## Source Waves

Backfill in waves so each layer is independently reproducible and useful:

| Wave | Sources | Primary purpose |
| --- | --- | --- |
| 0 | Chadwick Persons Register | Identity spine and cross-source IDs; ingest revisions rather than treating mappings as permanent. |
| 1 | Retrosheet and Lahman | MLB games, appearances, rosters, careers, awards, and Hall of Fame history for outcomes and long-horizon validation. |
| 2 | Sports Reference | Authorized historical MLB/MiLB statistics, player histories, transactions, and reconciliation evidence. Preserve provider-specific definitions such as WAR. |
| 3 | FanGraphs | Authorized prospect boards, ranks, scouting grades, reports, and minor/major statistics. Preserve publication edition and grade scale. |
| 4 | Prospect Savant, primarily 2023+ | Authorized MiLB tracking-derived and prospect metrics. Keep proprietary metrics provider-namespaced and separate from raw Statcast measurements. |

For every source, the catalog must version permission scope, attribution, retrieval method, coverage, retention, ML rights, and raw redistribution rights. A user-attested permission is recorded as evidence; rights not explicitly granted are not inferred.

## Immutable Landing

Every retrieval lands before normalization. Store the exact payload, content hash, sanitized request, retrieval time, response metadata, schema fingerprint, parser version, and permission version. Parsed records remain linked to that payload. Corrections and repeat retrievals append new versions; they never overwrite an earlier observation.

A season parameter or historical label on a dynamic endpoint does **not** prove the response existed in that form during that season. Unless an archived publication timestamp is evidenced, set `known_at` to the retrieval timestamp and exclude the record from earlier strict backtests. Historical facts may still train outcome or retrospective models where appropriate, but they cannot masquerade as historical public information.

## Identity Before Features

Use an immutable internal `player_id`. External IDs are effective-dated assertions with namespace, confidence, evidence, `known_at`, review state, and revision lineage. Names are attributes, never join keys.

Resolution proceeds from strong crosswalks such as Chadwick and source IDs, then corroborated biography and roster evidence. Ambiguous matches are quarantined for review. Merges and splits create new identity assignments without rewriting old forecasts. Team, affiliate, league, level, position, and organization identities also need effective-dated mappings because baseball structures change.

## Complete Risk Sets

The arrival denominator is a dated census of all reliably observed affiliated professionals who had not debuted by `as_of`, including players with no recorded game statistics. Preserve injured, restricted, suspended, complex-league, recently signed, released, and temporarily inactive players with explicit coverage states.

An active player who has not debuted is right-censored, not a negative example. A release is not necessarily terminal. Confirmed retirement, death, or a versioned inactivity rule may end observation; foreign or independent play and data loss are separate competing states. Building the universe only from stat tables or eventual MLB identifiers would create survivorship bias and is prohibited.

## Point-In-Time Rules

Every observation carries:

- `effective_at`: when the baseball event or measurement applies.
- `known_at`: earliest auditable availability to the research system.
- `ingested_at`: when Baseball Oracle received it.
- Source record key, revision lineage, and immutable payload reference.

Features for `as_of` may use only records with `known_at <= as_of`. Publication-time ranks, transactions, injuries, roster states, park factors, league translations, imputation, normalization, embeddings, and target encodings all obey that rule. Transformations are fit inside each training window. Target tables are isolated from feature builders.

The 2020 canceled affiliated season, the 2021 MiLB reorganization, tracking-coverage changes, renamed levels, and evolving metric definitions are explicit era and coverage features, not silently imputed ordinary seasons.

## Backfill Manifest And Resume

Each source backfill is declared as a versioned manifest containing:

- Dataset, endpoint/file, date or season range, league/level scope, and parameter grid.
- Expected partitions or pages and a deterministic request fingerprint for each unit.
- Cursor/page state, attempt count, status, timestamps, response hash, row count, and schema fingerprint.
- Earliest/latest `effective_at` and `known_at`, parser/code version, permission version, and quality results.

Workers claim bounded manifest units, write payloads idempotently by request and content hash, checkpoint after every unit, and retry with capped exponential backoff. Failed or quarantined units remain visible and resumable. A run is complete only when expected coverage reconciles, not merely when every HTTP request returned successfully.

## Normalization And Quality Gates

Normalize raw facts into dated player, roster, transaction, game, appearance, scouting, tracking, and statistical observations while retaining provider-specific values and raw numerators/denominators. Never collapse sources into a single rate without preserving formula, provider, unit, and version.

Block downstream releases on:

- Identity collisions, orphaned records, duplicate natural keys, or unresolved high-impact matches.
- Missing expected partitions, implausible roster counts, or coverage gaps by season, league, level, team, role, and source.
- Aggregate totals that fail reconciliation within declared tolerances.
- Impossible units/ranges, unexplained cumulative decreases, or abrupt schema and missingness drift.
- Any feature with `known_at > as_of`, target lineage, or future-information leakage.
- Non-reproducible payload, feature, universe, or prediction hashes.

Coverage is itself data. Record why a metric is absent: no opportunity, source not covered, not yet published, structurally unavailable, or unknown. Run leakage canaries using future promotions, final-season totals, eventual debut dates, and later prospect ranks; the feature pipeline must reject them.

## Training And Validation

Use rolling-origin backtests. At each simulated origin, rebuild the then-observable universe, fit all transformations and models on prior available data, calibrate on a later but still prior window, issue untouched forward predictions, and score outcomes only as they mature. Random row splits are prohibited. Split assignment and uncertainty estimation must cluster repeated snapshots by player.

Maintain a final era-based holdout and a cold-start test in which the model has no earlier snapshot for the test player. Report censoring-aware calibration, Brier/log loss, ranking lift, and subgroup stability for arrival; use proper distributional scores and interval coverage for career paths. Evaluate by era, age, level, role, position, acquisition path, organization, and coverage tier. A complex model ships only when it beats frozen cohort and regularized baselines across multiple forward folds.

Initial model stack:

1. Discrete-time, competing-risk survival for arrival and career states.
2. Separate opportunity and performance models with empirical-Bayes shrinkage.
3. Hierarchical aging and level-translation components, plus boosted nonlinear residuals.
4. Monte Carlo career paths producing coherent seasonal, career, peak, longevity, and elite-tail distributions.
5. Forward-validated ensembles and horizon-specific calibration.

## Active-Player Scoring

Once the historical contract passes its gates, generate immutable feature snapshots and predictions for every active player in the current census. Run a full scheduled batch at least weekly, with event-driven refreshes after new games, promotions, transactions, injuries, scouting publications, or material source corrections.

Every score records `as_of`, universe and feature-set versions, model and calibration releases, source snapshot hashes, completeness grade, out-of-distribution score, predictive intervals, and explanation payload. Publish new batches atomically so users never see mixed model or data versions. Monitor source coverage, feature drift, calibration, cohort performance, and active-player reconciliation continuously; retraining and promotion require the same forward-validation gates as the first release.

The result is a single reproducible pipeline: historical evidence becomes point-in-time snapshots, snapshots become forward-tested models, and approved model releases score the full active-player universe without changing the meaning of past forecasts.
