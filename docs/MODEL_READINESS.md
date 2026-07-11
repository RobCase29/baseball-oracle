# Model Readiness

Status as of July 11, 2026.

## Verdict

Baseball Oracle now has an executable, reproducible research baseline for MLB
arrival and a clean career-model landmark panel. It is ready for feature research
and honest forward backtests. It is not yet ready to publish player probabilities.

The current arrival cohort is conditional on appearing on a FanGraphs prospect
board. It is not the complete population of affiliated minor-league players, and
the board editions lack evidenced exact publication timestamps. Those limitations
are stored as release blockers in the generated dataset and model manifests.

## Acquired Data

`npm run data:acquire` acquired and verified 44 resources totaling
about 162 MB:

| Source | Pinned version | Local use |
| --- | --- | --- |
| Chadwick Register | `7e23e7dfaff51b3ae72c16393703eda7e5ecad27` | 16 identity shards, stable UUIDs, and provider crosswalks |
| SABR Lahman | 2025 release | People, batting, pitching, fielding, Hall of Fame, and source documentation through the 2025 MLB season |
| Retrosheet | `bf5af7d40e1f0c33026074705cda8ed1c5177f95` | Independent MLB debut-date validation |
| FanGraphs | 2017-2026 board editions | Independently acquired hitter and pitcher scouting reports plus prior-season statistics under the project's research permission |

Every URL, byte count, license reference, and SHA-256 digest is pinned in
`data/source-lock.json`. Requests for FanGraphs editions are rejected when the
returned report year differs from the requested year; the endpoint silently
falls back for some unsupported older editions, so this is a required guard.
The lock currently proves local integrity and fails closed on upstream drift; it
cannot recover old bytes from a mutable provider URL. Before any production model
release, permitted raw objects must also be copied to immutable, access-controlled
object storage keyed by the locked digest.

Dataset preparation requires a complete acquisition manifest for the current
source-lock digest and re-hashes all 44 local inputs before parsing. A raw file
changed after acquisition therefore fails the build instead of inheriting trusted
lineage from an earlier run.

## Prepared Tables

The generated `data/processed/model-v1/dataset_manifest.json` currently records:

| Table | Rows | Purpose |
| --- | ---: | --- |
| Prospect snapshots | 7,175 | Pre-debut, player-role scouting and prior-season feature landmarks |
| Arrival labels | 7,175 | Censored 12, 24, 36, 48, and 60-month debut outcomes |
| Career outcomes | 24,270 | MLB career totals, debut/final dates, induction status, and censored Hall of Fame outcomes |
| Career landmarks | 118,184 | End-of-season MLB opportunity and performance features available through each season |
| Career labels | 118,184 | Isolated next-season, remaining-playing-time, longevity, and censoring targets |

The arrival rows cover 2017-2026 and are split into hitter and pitcher roles.
There are 9,672 row-level identity matches through cross-source IDs. Five unique
name-plus-birthdate candidates are quarantined because biography alone does not
satisfy the identity contract. Another 1,322 source rows remain unmatched and are
excluded rather than joined on a name guess. The pipeline also removes 2,462 board
rows for players who had already debuted at the conservative snapshot landmark.

Lahman and Retrosheet agree exactly on 4,973 row-level debut assertions. Thirty-one
source disagreements are quarantined rather than resolved by silent precedence.
Lahman's internal player ID and its separate Baseball-Reference ID remain distinct
namespaces throughout the label and career tables.

The career identity map now has a strict one-to-one contract: 23,400 outcome rows
and 116,919 season landmarks map to a unique Chadwick UUID, while 870 outcomes and
1,265 landmarks remain unmatched. Missing Baseball-Reference IDs may fall through
only to a genuine Retrosheet identifier; Lahman IDs are never queried in another
provider's namespace. Ambiguous many-to-one mappings are quarantined.

Hall of Fame membership is represented as 281 observed inductions. All 23,989
non-inducted careers remain nullable/censored until era-versioned eligibility and
ballot rules are implemented; inactivity alone is not treated as a negative label.

Features and outcomes are physically separate. The feature allowlist rejects
debut, final-career, service-time, label, and current-profile fields. A test canary
also proves that a rolling fold cannot observe a debut that occurs after its label
cutoff.

## Arrival Baseline

The baseline is a regularized discrete-time logistic hazard model. One coherent
annual hazard curve produces 12, 24, 36, 48, and 60-month research estimates.
Numeric values are median-imputed and standardized inside each fold; categories
are imputed and one-hot encoded inside each fold. Repeated snapshots are weighted
by player. There is no random split.

The final research fit uses 5,356 snapshots from 2,867 players, producing 14,086
person-period rows and 2,478 observed debuts. Each historical fold restricts its
training labels to outcomes available by that fold's origin, and a horizon is
scored only when the complete test cohort has matured.

| Test edition | Horizon | Brier | Base-rate Brier | Skill | ROC AUC |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2020 | 12m | 0.120 | 0.134 | +9.9% | 0.798 |
| 2020 | 24m | 0.178 | 0.222 | +19.8% | 0.788 |
| 2020 | 36m | 0.203 | 0.248 | +18.4% | 0.773 |
| 2020 | 48m | 0.228 | n/a | n/a | 0.750 |
| 2020 | 60m | 0.245 | n/a | n/a | 0.736 |
| 2021 | 12m | 0.260 | 0.229 | -13.4% | 0.548 |
| 2021 | 24m | 0.433 | 0.284 | -52.7% | 0.560 |
| 2021 | 36m | 0.518 | 0.244 | -112.2% | 0.607 |
| 2021 | 48m | 0.564 | 0.209 | -169.8% | 0.634 |
| 2022 | 12m | 0.139 | 0.153 | +9.3% | 0.736 |
| 2022 | 24m | 0.198 | 0.217 | +9.2% | 0.723 |
| 2022 | 36m | 0.224 | 0.249 | +9.9% | 0.709 |
| 2023 | 12m | 0.115 | 0.141 | +18.5% | 0.800 |
| 2023 | 24m | 0.168 | 0.216 | +22.2% | 0.777 |
| 2024 | 12m | 0.115 | 0.140 | +17.6% | 0.812 |

The 2020 48 and 60-month scores extrapolate beyond the longest interval observable
in that fold's training data, and no honest training-era base-rate comparator is
available for them. They are retained as diagnostics, not release evidence. The
2021 failure is also important. The canceled 2020 affiliated season, delayed
development, and 2021 league reorganization created a cohort unlike the earlier
training history. It is retained as a mandatory stress test, not post-hoc repaired.
The model is explicitly marked `research_baseline_not_release_eligible` and no
forecast is written to the product tables.

## Trouble With The Curve Audit

The referenced repository is a useful hypothesis source, not training truth. At
commit `99297bb145049082818125adf19423b2ef254734`, its CSV contains 9,175 scouting
profiles for 3,549 names from 2013-2019, but no minor-league performance statistics.
The pinned artifact hash and audit method are recorded in
[`docs/audits/TROUBLE_WITH_THE_CURVE.md`](audits/TROUBLE_WITH_THE_CURVE.md).

The committed workflow uses random row splits. Four hundred seventy players appear
in both train and test, covering 69.6% of test players. The test class balance makes
an all-negative classifier 73.52% accurate, exactly the reported accuracy of its
BCN model. More than one thousand committed negative labels belong to players who
did reach MLB, and unresolved young players were frozen before their careers
matured. The repository also has no project-wide license, so its MLB.com and
FanGraphs prose is quarantined rather than copied.

Reusable ideas are the 20-80 grade representation, longitudinal scouting changes,
and testing report language as an incremental signal. Any such signal must be
independently acquired under permission, relinked to current identities and
outcomes, entity-masked, and evaluated only as a forward-fold ablation.

## Remaining Gates

1. Acquire a dated, complete affiliated-player roster census, including inactive
   and zero-stat players. Authorized Sports Reference history is the immediate
   research path; SIS or a Chadwick commercial history is the production path if
   the census is incomplete.
2. Place every permitted locked raw payload in immutable object storage so a future
   rebuild does not depend on mutable provider URLs.
3. Acquire authorized historical MiLB player-season and transaction histories,
   then normalize level, league, park, organization, workload, promotion, and
   explicit coverage features.
4. Evidence exact scouting publication dates or keep scouting out of strict
   historical-information backtests.
5. Add provider-versioned Sports Reference or FanGraphs WAR to the prepared career
   landmarks. Lahman supports playing time, rate, longevity, awards, and Hall of
   Fame outcomes, but does not contain WAR.
6. Build monthly competing-risk arrival hazards, time-specific calibration,
   confidence intervals, organization and era diagnostics, and a locked holdout.
7. Build post-debut opportunity, performance, exit/re-entry, and WAR components,
   then simulate joint career paths. Model Hall-of-Fame-caliber performance
   separately from the later voting process.
8. Normalize Prospect Savant's 2023+ tracking components as a challenger and test
   incremental value over the performance-only baseline.

Only a candidate that beats the frozen baseline across multiple forward folds,
passes calibration and subgroup gates, and scores the complete risk set can be
promoted to `ml.model_release` and published.

## Reproduction

```bash
npm run data:acquire
npm run model:setup
npm run model:all
```

Each rebuild records a stable digest over the five table hashes, preserves all five
Parquet files under that digest, and separately addresses the build manifest,
validation report, and model bytes. Training resolves those archived files and
checks their hashes and row counts before fitting. The database migration
`0005_ml_training_lineage.sql` adds immutable dataset
manifests, feature snapshots, censored labels, temporal folds and player-cluster
assignments, training runs, artifacts, and links from releases and predictions
back to their exact training evidence.
