# MiLB Alpha Model Card

## Decision Surface

Baseball Oracle keeps three pre-debut quantities separate:

1. `P(MLB within 36 months)`: a frozen arrival estimate.
2. `milb-alpha-signal-v1`: model arrival probability minus a broad historical path.
3. `milb-impact-five-calendar-year-war-v1`: a probability-withheld rank for reaching at least 5 MLB WAR in the next five calendar seasons.

None of these is Hall of Fame induction probability or expected investment return.
Market price, liquidity, fees, and external consensus are outside the baseball model.

## Arrival Alpha V1

The population reference contains 69,325 valid 2010-2019 affiliated season-end
snapshots from 24,405 players. The raw model inputs are age, role, level, workload,
and traditional minor-league performance available at the frozen snapshot.
Prospect Savant composite scores, provider percentiles, FanGraphs ranks, scouting
grades, and external prospect rankings are excluded.

The primary target is first MLB arrival within 36 months. The primary edge is:

`candidate P36 - hierarchical role-level-age baseline P36`

The 60-month edge is a positive-direction gate only. That horizon is not externally
mature and never supplies validated confidence.

### Eligibility

- Age percentile within historical role and level at or below 33.
- At least 75 prior PA for hitters or 20 prior IP for pitchers.
- Candidate P36 of at least 20%.
- P36 edge of at least +10 percentage points.
- Positive 60-month model edge.
- At least 400 age-context players.
- At least 100 baseline rows and five events at both 36 and 60 months.

Priority requires at least +25 percentage points of P36 edge and age percentile at
or below 25. Ranking uses P36 edge descending, age percentile ascending, P60 edge
descending, then stable identity. There is no composite score.

### Current Artifact

- Frozen as of: 2025-12-31.
- Eligible signals: 210.
- Priority signals: 105.
- Leading ranks: Jesus Made, Jhonny Level, Rainiel Rodriguez, Aidan Miller, Max Clark.

The artifact is matched to the live 2026 directory by exact MLBAM ID and role. It
does not infer identity from names. Players already present in the MLB census are
removed from the live minor-league surface.

### Evaluation State

The earliest-observed-snapshot retrospective diagnostic contains 8,826 players and
835 36-month arrivals. The gate selected 223 players with 110 arrivals: 49.33%
versus 9.46% overall, or 5.21x descriptive lift. The cold-start slice selected 69
players with 30 arrivals: 43.48% versus 5.71%, or 7.62x.

These thresholds were human-reviewed after retrospective outcomes existed. The
diagnostic is not prospective. The external evaluation improved Brier score over
the hierarchical comparator in every sufficient role-horizon cell, but failed the
population-shift admission and pooled calibration cell-fraction gates. Therefore:

- `releaseEligible` is false.
- No horizon is labeled externally validated.
- Near-one probabilities must not be presented as calibrated confidence.
- The public arrival surface emphasizes rank, support, and gates; the failed-calibration probability is not used as confidence.

## Early Ceiling Radar Contract

The deployed Minors Alpha ordering is a two-model confirmation, not a blended
score. A player must clear the Arrival Alpha eligibility gate and rank at or above
the 90th percentile in the direct five-year impact challenger. Eligible players
are ordered by direct impact rank, then arrival rank, age-for-level percentile,
and stable identity.

The ordinal research buckets are:

- Priority: impact top 1% and Arrival Alpha Priority.
- Strong: impact top 5% and Arrival Alpha eligible.
- Watch: impact top 10% and Arrival Alpha eligible.

The locked impact universe contains 6,455 completed-2025 MiLB snapshots. There
are 188 dual-gated current rows: 38 in the impact top 1%, 136 cumulatively in the
top 5%, and 188 cumulatively in the top 10%. These are rank buckets, not confidence
bands. Raw impact probability, baseline probability, and probability delta are
absent from the public impact artifact.

## Current Raw-Trait Evidence

Prospect Savant tracking is a separate descriptive layer. Hitters use damage,
contact, swing-decision, and expected-output pillars. Pitchers use arsenal,
bat-missing, command, and contact-management pillars. The evidence gate requires:

- At least 150 PA, 40 IP, or 600 pitches for sufficient opportunity.
- At least three of four pillars covered.
- At least two distinct pillars with a favorable provider percentile of 80 or more.

The UI publishes named measurements and never an aggregate trait score. PS Score
and aliases are excluded. K-BB percentile is withheld because all 951 non-null AAA
pitcher rows in the audited slice were exactly zero while raw K-BB ranged from
-66.7% to 71.4%.

Historical Prospect Savant inputs are not yet admitted to a predictive model. The
2023-2025 history has no mature career-ceiling cohort, and its stored historical age
is current-age leakage. Any future challenger must recompute age from birth date,
strip future profile fields, treat suspicious zeros as missing, and earn inclusion
through forward-fold ablation.

## Direct Impact Target

`milb-war5-impact-v1` defines future value as total Baseball-Reference MLB WAR in
snapshot year +1 through +5. A row is mature only when all five seasons are complete.
Exact `player_id` linkage is primary; trusted Baseball-Reference identity is a
fail-closed fallback. Mature non-arrivers and players with no WAR rows are explicit
zeros, not missing labels.

The 2010-2019 corpus contains 69,326 mature snapshots:

- 9,832 have MLB WAR within the five-season window.
- 707 snapshots from 385 players reach at least 5 WAR.
- 222 snapshots from 142 players reach at least 10 WAR.

The primary direct ceiling event is `WAR5 >= 5`. The 10-WAR event remains
exploratory. Hall induction cannot be trained from this prospect-era panel because
every linked non-inducted state remains censored.

The champion regularized logistic challenger was evaluated on 35,747
player-purged expanding-origin OOF rows from 15,326 players, including 197 event
players. It produced Brier 0.00883, 4.25% skill versus the transparent
age-level-role-performance prior, ROC AUC 0.934, average precision 0.177, and
8.10x top-decile lift. Fold top-decile lift ranged from 7.24x to 8.28x across
2015-2019 validation origins.

The overall and top-decile calibration were close, but the most extreme 1%
overpredicted: 31.2% mean prediction versus 21.9% observed. Every available
outcome window touches the shortened 2020 season, historical archives have
unverified knowledge time, and model selection shares the retrospective OOF
panel. The model therefore passes the architecture/performance gate but fails the
release gate. It is published only as an ordinal research rank.

## Promotion Requirements

Arrival Alpha remains research-only until a newly frozen prospective cohort clears
identity, population-shift, Brier/log-loss improvement, calibration, and cohort
stability gates. The direct impact model already has purged forward folds,
player-cluster uncertainty, a transparent age-level-role-performance baseline,
and a locked current scoring artifact. Promotion still requires a newly frozen
prospective cohort, verified knowledge time, and extreme-tail recalibration.
Tracking and scouting challengers enter only after point-in-time provenance and
forward ablation.
