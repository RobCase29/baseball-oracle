# Model Readiness

Status as of July 11, 2026.

## Verdict

Baseball Oracle now has an executable, reproducible research baseline for MLB
arrival, a clean career-model landmark panel, and four mature historical cohorts
drawn from the full population of recorded affiliated-season participants. It is
ready for feature research and honest forward backtests. It is not yet ready to
publish player probabilities.

There are now two distinct arrival research tracks. The original 2017-2026 track
is conditional on appearing on a FanGraphs prospect board. The new 2010 and
2017-2019 Baseball-Reference tracks include every player with a recorded appearance
on all reconciled affiliated team pages for the season. They are broader than a
prospect list, but they are not contract-roster censuses: players with no recorded
game appearance can be absent. The historical statistics are effective-time safe,
but their original knowledge time is not independently evidenced. These
limitations are stored as release blockers in the generated dataset manifests.

## Acquired Data

`npm run data:acquire` acquired and verified 44 resources totaling
about 162 MB:

| Source | Pinned version | Local use |
| --- | --- | --- |
| Chadwick Register | `7e23e7dfaff51b3ae72c16393703eda7e5ecad27` | 16 identity shards, stable UUIDs, and provider crosswalks |
| SABR Lahman | 2025 release | People, batting, pitching, fielding, Hall of Fame, and source documentation through the 2025 MLB season |
| Retrosheet | `bf5af7d40e1f0c33026074705cda8ed1c5177f95` | Independent MLB debut-date validation |
| FanGraphs | 2017-2026 board editions | Independently acquired hitter and pitcher scouting reports plus prior-season statistics under the project's research permission |
| Baseball-Reference Register | Complete 2010 and 2017-2019 affiliated seasons; structural-zero 2020 season | Full season-appearance risk sets, team and organization lineage, and minor-league performance under the project's research permission |

For the original 44-resource acquisition, every URL, byte count, license
reference, and SHA-256 digest is pinned in `data/source-lock.json`. Requests for
FanGraphs editions are rejected when the returned report year differs from the
requested year; the endpoint silently falls back for some unsupported older
editions, so this is a required guard. Baseball-Reference lineage is pinned
separately in the committed season archive locks. Both paths fail closed on
upstream drift, and all permitted locked bytes are stored in the private,
content-addressed Vercel Blob archive described in
`docs/IMMUTABLE_RAW_ARCHIVE.md`; a rebuild therefore does not depend on a mutable
provider URL. Vercel Blob is not a compliance WORM vault, so a future regulated
retention requirement would still require an independent Object Lock mirror.

Dataset preparation requires a complete acquisition manifest for the current
source-lock digest and re-hashes all 44 local inputs before parsing. A raw file
changed after acquisition therefore fails the build instead of inheriting trusted
lineage from an earlier run.

The separate Baseball-Reference backfill has archived 948 exact HTML responses
totaling 380,489,051 bytes for 2010 and 2017-2019, plus deterministic season
manifests and a zero-page manifest for the canceled 2020 season. Across all
sources and preserved manifest versions, the private archive currently holds
1,010 objects totaling 545,732,908 bytes. Details, digests, and recovery
procedures are recorded in
[`IMMUTABLE_RAW_ARCHIVE.md`](IMMUTABLE_RAW_ARCHIVE.md).

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

## Affiliated Appearance Cohorts

The Baseball-Reference adapter requires complete team-page reconciliation before
admitting a season. It keeps every appearance-qualified provider ID in the
denominator, uses only the provider's minor-league ID for Chadwick crosswalks,
preserves every team and organization stint, and never joins on a name. Multi-level
and multi-organization statistics are explicitly labeled as pooled; they are not
mislabeled as the last observed level. Edition-only FanGraphs fields are excluded
from this contract.

| Season | Appearance census | Identity linked | Model eligible | 12m debuts | 60m debuts |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2010 | 7,777 | 7,777 (100%) | 6,623 | 229 | 866 |
| 2017 | 8,346 | 8,346 (100%) | 7,051 | 243 | 1,048 |
| 2018 | 8,607 | 8,607 (100%) | 7,330 | 249 | 1,040 |
| 2019 | 8,816 | 8,816 (100%) | 7,531 | 197 | 1,028 |

Every 12, 24, 36, 48, and 60-month label in all four cohorts is mature as of the
2025-12-31 outcome cutoff. Together they contain 33,546 player-season census rows:
17,673 pitchers, 15,863 hitters, and ten genuine two-way players. The shared-role
feature contract conservatively excludes those ten two-way snapshots while
retaining their separate batting and pitching domains in the census.

Model eligibility means MLB-naive at the season-end snapshot, exact outcome-linked,
and supported by the current role feature contract. The adapter removed 1,151
pre-snapshot MLB debuts and three unsupported two-way rows in 2010. It removed
1,289 pre-snapshot debuts, five independently detected debut-source disagreements,
and one unsupported two-way row in 2017. The 2018 exclusions are 1,264 prior MLB
debuts, nine source disagreements, and four two-way rows; the 2019 exclusions are
1,275 prior debuts, eight source disagreements, and two two-way rows. No unresolved
identity is silently dropped: all four dataset manifests report 100% Chadwick
crosswalk coverage. The combined model-analysis population is 28,535 rows with
3,982 observed MLB debuts by 60 months.

The content-addressed dataset digests are:

```text
2010  6da657a1abf2710359b735c5cb61d8460d2d5769cbf8b5aca8e514107becf3b3
2017  1be26f899e4109cdd6a1ffddb4f7562c117498d2dcfd822f87390d50ba2d107f
2018  345dd52c5ff9ff601ed9baa299f9e0c91299d72afaf1a4db03d02f455b706fa0
2019  9b0ff4fd46632a62b714e955eafad82b277c5102f5da84fbd633d0b0fd506616
```

These cohorts validate the data contract and provide three consecutive
pre-pandemic test years; they are not yet a release model. More seasons are needed
for robust rolling folds, era diagnostics, and locked calibration. The source also
does not establish original publication timestamps, so the manifests correctly
set `effective_time_safe=true`, `knowledge_time_verified=false`, and
`strict_point_in_time_features=false`.

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

1. Acquire a dated, complete affiliated-player contract-roster census, including
   inactive and zero-appearance players. The Baseball-Reference appearance census
   is the broad research denominator; SIS or a Chadwick commercial history remains
   the production path for complete roster membership.
2. Fill the 2011-2016 history and add post-2020 cohorts for deeper rolling temporal
   folds and regime diagnostics. Preserve 2020 as a structural zero rather than
   inventing observations for the canceled season.
3. Register historical season manifests in the Neon lineage catalog and add
   periodic remote digest reconciliation. Migration `0006` and the deployment
   registrar now catalog the original 47-member locked corpus.
4. Normalize level, league, park, organization, workload, promotion, transaction,
   and explicit coverage features without collapsing pooled stints into a single
   context.
5. Evidence original publication/knowledge times or keep reconstructed historical
   features out of strict historical-information backtests.
6. Add provider-versioned Sports Reference or FanGraphs WAR to the prepared career
   landmarks. Lahman supports playing time, rate, longevity, awards, and Hall of
   Fame outcomes, but does not contain WAR.
7. Build monthly competing-risk arrival hazards, time-specific calibration,
   confidence intervals, organization and era diagnostics, and a locked holdout.
8. Build post-debut opportunity, performance, exit/re-entry, and WAR components,
   then simulate joint career paths. Model Hall-of-Fame-caliber performance
   separately from the later voting process.
9. Normalize Prospect Savant's 2023+ tracking components as a challenger and test
   incremental value over the performance-only baseline.

Only a candidate that beats the frozen baseline across multiple forward folds,
passes calibration and subgroup gates, and scores the complete risk set can be
promoted to `ml.model_release` and published.

## Reproduction

```bash
npm run data:acquire
npm run model:setup
npm run model:all
npm run backfill:sports-reference -- --execute --season=2017 --max-teams=250
npm run archive:sports-reference -- --season=2017
.venv/bin/python modeling/prepare_dataset.py \
  --output-dir data/processed/model-v1-bref-2017 \
  --bref-player-team-seasons data/processed/baseball-reference-register/2017/player_team_seasons.csv \
  --bref-quality data/processed/baseball-reference-register/2017/quality.json \
  --bref-teams data/processed/baseball-reference-register/2017/teams.csv \
  --bref-team-organizations data/processed/baseball-reference-register/2017/team_organizations.csv
```

Each default rebuild records a stable digest over the five core table hashes;
affiliated-risk-set builds add three content-addressed tables for the census,
eligible snapshots, and censored labels. Training resolves archived files and
checks their hashes and row counts before fitting. Database migration
`0005_ml_training_lineage.sql` adds immutable dataset
manifests, feature snapshots, censored labels, temporal folds and player-cluster
assignments, training runs, artifacts, and links from releases and predictions
back to their exact training evidence. Migration
`0006_private_raw_archive_catalog.sql` adds append-only private archive objects,
manifests, and reconciled manifest membership.
