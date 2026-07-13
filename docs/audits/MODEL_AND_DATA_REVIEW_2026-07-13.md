# Model and Data Review: July 13, 2026

## Verdict

Baseball Oracle is a serious research platform, not an ultimate model. None of
the current model families is release-eligible. The MiLB impact rank has useful
retrospective discrimination, the arrival system has a disciplined temporal
evaluation design, and the MLB career classifier has promising ranking power.
Those strengths do not overcome failed external calibration, incomplete
knowledge-time provenance, an unevaluated current-player refit, a career split
conditioned on future career end, and a terminal distribution that misses the
rare Hall-caliber tail.

The correct product claim today is a stage-specific research rank. It is not a
calibrated confidence percentage, a Hall-of-Fame probability for prospects, or
an expected investment return.

## Findings, Ordered by Severity

### 1. The model does not learn the outcome the product most wants at the earliest stages

The prospect career output is a bridge:

`P(Hall-caliber proxy) = P(MLB within 60 months) * P(Hall caliber | estimated debut age)`

Minor-league performance affects the arrival term, but does not shape the
conditional career distribution beyond estimated debut age. The arrival term
itself failed external release gates. This is not a directly trained
MiLB-to-career-ceiling model and it cannot support an early Hall-caliber
probability claim.

The direct MiLB impact target is much more defensible, but narrower: at least 5
Baseball-Reference MLB WAR in the five calendar years after the snapshot. It is
a useful early-impact endpoint, not a Hall endpoint.

### 2. The MLB terminal distribution fails exactly where Hall-caliber discovery matters

The selected `calibrated_scenario_tilt` entrant looks strong on the full
development panel, but rare outcomes expose the weakness. On the human-reviewed
development holdout:

- 3,685 players and only 24 Hall-caliber event players informed the aggregate
  classifier diagnostics.
- First-season top-1% precision was 8.11% against a 0.79% base rate, a promising
  10.29x descriptive lift.
- Among the 29 first-season players who actually became Hall-caliber, P10-P90
  coverage was 0% for final WAR, peak-seven WAR, and JAWS.
- First-season Hall-event final-WAR MAE was 73.18 WAR.
- For seasons one through three, Hall-event P10-P90 coverage was only 11.11% for
  final WAR and JAWS and 8.89% for peak-seven WAR.

The model ranks some elite careers early, but its simulated terminal range does
not contain their realized elite outcomes. That is a direct blocker for calling
the displayed arc a Hall-caliber career forecast.

### 3. No current champion has untouched prospective confirmation

The career development holdout was repeatedly inspected during development and
is explicitly marked non-pristine. Its split axis is completed career end year,
which depends on future career length rather than a true rolling prediction
origin. The exact current-player refit is neither fully cross-fitted nor
independently evaluated, so it cannot inherit the tournament metrics.

The MiLB impact model selects and evaluates entrants on the same retrospective
out-of-fold panel. Every available five-year outcome window touches the shortened
2020 season. The artifact itself warns that model selection and evaluation share
the panel.

The arrival model has a frozen retrospective external regime test, which is a
meaningful strength. It still is not prospective, and the planned 2026 shadow
cohort has not yet been frozen or scored.

### 4. Arrival transfer and calibration failed in the post-2020 population

The 2010-2019 arrival corpus is substantial: 69,326 season-end snapshots, 24,406
players, and 9,832 five-year arrivals. The external 2021-2025 census contains
33,559 snapshots from 13,976 players. Integrity and source reconciliation passed,
but population shift did not:

- Maximum PSI was 0.549 versus a 0.20 gate.
- Maximum unseen-category fraction was 7.26% versus a 2% gate.
- Only 5 of 8 sufficient role-horizon cells passed the ECE threshold; 6 were
  required.
- The 60-month external outcome is not mature.

The external candidate still beat the hierarchical comparator in all eight
sufficient role-horizon cells. Pooled paired Brier improvement was 0.01527 with a
95% interval of 0.01330 to 0.01727. That is real evidence of signal, but the
failed shift and calibration gates correctly keep it research-only.

External horizon diagnostics were:

| Horizon | Rows | Events | Brier | ROC AUC | Average precision | Top-decile lift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 months | 27,104 | 1,017 | 0.02890 | 0.9225 | 0.3621 | 6.77x |
| 24 months | 20,667 | 1,465 | 0.04764 | 0.9123 | 0.4910 | 5.84x |
| 36 months | 13,801 | 1,388 | 0.06445 | 0.8927 | 0.5359 | 5.12x |
| 48 months | 6,874 | 867 | 0.07941 | 0.8764 | 0.5525 | 4.52x |

### 5. Historical effective time is guarded, but knowledge time is not proven

The pipelines have unusually good controls for immutable inputs, player-purged
folds, label availability, horizon maturity, and effective-time joins. However,
the MiLB target audit records `knowledgeTimeVerified: false`. Historical scouting
and reconstructed seasonal values were acquired later, and their original
publication timestamps are not independently evidenced. They must remain out of
strict point-in-time challengers until that provenance exists.

The season-appearance arrival denominator also omits some contracted players who
recorded no appearance. This can bias arrival estimates upward and prevents the
model from answering the probability for every signed player.

### 6. Predictive features are far behind the available baseball information

The arrival and direct-impact champions primarily use age, level, role, workload,
basic rate statistics, position, size, and limited context. They do not yet use
fold-fitted league and park translations, effective-dated promotion velocity,
injury and transaction histories, or historical tracking. The direct-impact
model intentionally excludes scouting and public rank.

The MLB career model is built almost entirely from annual WAR aggregates,
opportunity totals, age, tenure, role, and position. It does not simulate annual
offense, defense, baserunning, pitching components, health, playing time, or
exit/re-entry. Calling its current chart a career arc overstates the modeled
mechanism.

The repo has archived FanGraphs editions from 2017-2026 and live 2026 Prospect
Savant measurements, but neither has earned predictive admission through a
point-in-time forward ablation. This is good modeling discipline, but also means
the current models have not exhausted the available signal.

### 7. Current data is displayed, but current evidence does not update the core forecasts

Production currently covers 7,470 active players: 6,179 minor leaguers and 1,291
major leaguers. It maps all players and has a stage-specific research rank for
5,262. The active MLB roster census and career preview were built July 12, 2026.
The visible 2026 MiLB source rows sampled in production were retrieved July 11.

The predictive state is older:

- MiLB arrival and impact scores use completed 2025 features frozen at
  December 31, 2025.
- MLB forecasts use the latest completed 2025 season. In-season 2026 WAR can be
  shown as actual context but is deliberately prevented from changing the
  forecast.
- Partial-season-only 2026 rookies can be withheld because they have no completed
  MLB feature landmark.

The top-level `dataAsOf` can therefore look current while the model feature date
is not. Every result needs separate `sourceObservedThrough`, `featureAsOf`,
`scoredAt`, and `modelTrainedThrough` timestamps.

### 8. Refresh was manual at audit start

At the audited baseline before this review, there was no Vercel cron configuration
and no scheduled GitHub workflow. The repo contained good idempotent ingestion,
archive, preparation, training, export, and materialized-view refresh commands,
but they were manually invoked. Deployment ran migrations and archive-catalog
registration; it did not fetch the latest stats or produce a new atomic prediction
batch. Checked-in JSON artifacts served the core forecasts.

Any scheduler added after this audit still needs end-to-end verification of source
freshness gates, atomic publication, retries, overlapping-run exclusion, and
failure alerts before the platform can promise current scores.

### Post-audit implementation in this change

The product now defines a daily authenticated Vercel refresh with overlap
protection and an operational run ledger. It collects the ten current Prospect
Savant slices plus the paired Baseball-Reference batting and pitching value pages,
refreshes indexed read models only after complete source groups, and exposes source,
coverage, job, and model clocks through `/api/health`. Current MLB WAR, workload,
and within-role WAR percentile now reach player profiles by exact Baseball-Reference
ID.

This closes the current-stat display and scheduling gap; it does not close the
model-freshness gap. Oracle Scores remain completed-2025 stage ranks until the
registered tournament, point-in-time feature builder, scheduled scorer, validation
checks, and atomic prediction publisher are implemented and pass. See
`docs/DATA_REFRESH.md` for the operating contract and remaining infrastructure
blockers.

## Measured Strengths Worth Keeping

- Complete immutable 2010-2019 affiliated appearance corpus with 100% identity
  resolution and reconciled source pages.
- Player-level purging and player-equal evaluation weights.
- Horizon maturity and label-availability checks.
- Content-addressed datasets, predictions, models, and evaluation reports.
- A locked external arrival evaluation that publishes failed gates rather than
  hiding them.
- Direct MiLB impact rank with ROC AUC 0.9342, average precision 0.1766 against a
  0.98% event rate, and 8.10x top-decile lift on 35,747 purged OOF rows.
- A transparent direct-impact baseline and paired player-cluster intervals. The
  selected logistic model's Brier improvement over that baseline has a 95% lower
  bound above zero.
- Explicit separation of provider composite scores, baseball talent, and market
  return.

The direct-impact extreme tail still overpredicted: the top 1% averaged 31.17%
predicted versus 21.91% observed. Its raw probability should remain withheld
until a locked external recalibration succeeds.

## Registered Larger Experiment

The machine-readable contract is
`modeling/config/s-tier-tournament-v1.json`. It is registered but not executed
and it explicitly forbids an ultimate or release claim at registration.

The experiment will:

1. Build true point-in-time weekly and season-end landmarks with a full
   contract-roster denominator and zero-appearance players.
2. Run player-clustered rolling prediction-origin outer folds, with all
   transformations, feature selection, tuning, and calibration inside each fold.
3. Keep performance-only and all-public-information paths distinct.
4. Require every feature family to earn admission through a registered ablation:
   normalized performance, development path, availability, acquisition capital,
   dated scouting, MiLB tracking, MLB Statcast, and organization context.
5. Compare transparent priors, elastic-net models, generalized additive models,
   boosted survival and classification models, random survival forests, joint
   state/playing-time/value models, and nonnegative OOF ensembles.
6. Select on proper scores and calibration, not AUC alone. Ranking lift remains a
   secondary decision metric.
7. Evaluate top 1%, 5%, and 10% tails, P95/P99 terminal outcomes, early-career
   slices, cold starts, missing-feature stress, era shift, and organization shift.
8. Freeze a primary 2026 shadow cohort before labels are opened. Later weekly
   shadow snapshots may be added but may not replace the primary cohort.

The holdout cannot instantly validate a five-year or completed-career endpoint.
Arrival can first be scored in July 2027; five-calendar-year impact cannot be
fully scored until December 2031. Historical rolling-origin evidence remains
necessary, but it must be labeled retrospective.

## Data Acquisition Priority

1. **Current authorized MLB and MiLB game data:** daily cumulative and rolling
   numerators, denominators, league, park, level, and schedule context. Current
   Prospect Savant can be a tracking challenger, not the sole population source.
2. **A complete affiliated contract-roster census:** active, injured, restricted,
   suspended, complex-league, recently signed, released, and zero-appearance
   players at each prediction date.
3. **Effective-dated movement and availability:** promotions, demotions, roster
   status, transactions, injuries, role changes, and exit/re-entry.
4. **Original-time scouting snapshots:** FanGraphs FV and component grades with
   an evidenced publication timestamp. Preserve every revision and test raw
   grades separately from public rank.
5. **Historical tracking with coverage denominators:** MiLB contact quality,
   decisions, contact, pitch shape, velocity, and command; MLB Statcast components
   with authorized storage and model-training rights.
6. **Component MLB outcomes:** playing time, offense, defense, baserunning,
   pitching, durability, and provider-versioned WAR. Annual components are needed
   for a real simulated arc.
7. **Point-in-time public consensus baselines:** permitted historical projections
   and prospect rankings. Oracle cannot claim model superiority without beating
   credible alternatives on the same frozen players and dates.
8. **Market data only after the talent model:** timestamped sales, listings,
   unsold inventory, grading, population, fees, liquidity, and card identity for a
   separate Backstop expected-return experiment.

## Immediate Build Order

1. Implement scheduled source snapshots, freshness SLAs, quality gates, and
   atomic prediction-batch publication.
2. Freeze the 2026 primary shadow cohort before any new challenger is tuned.
3. Add the full roster denominator and point-in-time context normalization.
4. Run the registered feature-group tournament for arrival and five-year impact.
5. Replace the career-end-year career split with rolling debut and prediction
   origins, then build annual opportunity, component, durability, and exit models.
6. Promote a probability only after its exact endpoint passes calibration and
   prospective gates. Until then, publish a plainly named ordinal percentile with
   an evidence grade.
