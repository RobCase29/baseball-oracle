# Model Readiness

Status as of July 12, 2026.

## Verdict

Baseball Oracle now has an executable, reproducible research baseline for MLB
arrival, a clean career-model landmark panel, and ten mature historical cohorts
drawn from the full population of recorded affiliated-season participants. It is
ready for feature research and honest forward backtests. It is not yet ready to
publish player probabilities.

There are now two distinct arrival research tracks. The original 2017-2026 track
is conditional on appearing on a FanGraphs prospect board. The primary population
benchmark covers every nonzero season from 2010 through 2019 and includes every
player with a recorded appearance on all reconciled affiliated team pages. It is
broader than a prospect list, but it is not a contract-roster census: players with
no recorded game appearance can be absent. Historical statistics are effective-time
safe, but their original knowledge time is not independently evidenced. These
limitations are stored as release blockers in the generated manifests.

## Acquired Data

`npm run data:acquire` acquired and verified 44 resources totaling
about 162 MB:

| Source | Pinned version | Local use |
| --- | --- | --- |
| Chadwick Register | `7e23e7dfaff51b3ae72c16393703eda7e5ecad27` | 16 identity shards, stable UUIDs, and provider crosswalks |
| SABR Lahman | 2025 release | People, batting, pitching, fielding, Hall of Fame, and source documentation through the 2025 MLB season |
| Retrosheet | `bf5af7d40e1f0c33026074705cda8ed1c5177f95` | Independent MLB debut-date validation |
| FanGraphs | 2017-2026 board editions | Independently acquired hitter and pitcher scouting reports plus prior-season statistics under the project's research permission |
| Baseball-Reference Register | Complete 2010-2019 affiliated seasons; structural-zero 2020 season | Full season-appearance risk sets, team and organization lineage, and minor-league performance under the project's research permission |

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

The separate Baseball-Reference backfill has locked 2,332 exact HTML responses
totaling 921,364,224 bytes for 2010-2019, plus deterministic season manifests and
a zero-page manifest for the canceled 2020 season. Details, digests, and recovery
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
| 2011 | 7,825 | 7,825 (100%) | 6,639 | 195 | 886 |
| 2012 | 7,852 | 7,852 (100%) | 6,666 | 221 | 968 |
| 2013 | 7,970 | 7,970 (100%) | 6,764 | 223 | 1,017 |
| 2014 | 8,107 | 8,107 (100%) | 6,887 | 246 | 1,004 |
| 2015 | 8,111 | 8,111 (100%) | 6,870 | 244 | 964 |
| 2016 | 8,221 | 8,221 (100%) | 6,965 | 253 | 1,011 |
| 2017 | 8,346 | 8,346 (100%) | 7,051 | 243 | 1,048 |
| 2018 | 8,607 | 8,607 (100%) | 7,330 | 249 | 1,040 |
| 2019 | 8,816 | 8,816 (100%) | 7,531 | 197 | 1,028 |

Every 12, 24, 36, 48, and 60-month label in all ten cohorts is mature as of the
2025-12-31 outcome cutoff. Together they contain 81,632 player-season census rows
and 69,326 model-eligible snapshots. The shared-role feature contract
conservatively excludes genuine two-way snapshots while retaining their separate
batting and pitching domains in the census.

Model eligibility means MLB-naive at the season-end snapshot, exact outcome-linked,
and supported by the current role feature contract. Pre-snapshot MLB debuts,
independently detected source disagreements, and unsupported two-way rows are
quarantined with explicit reasons. No unresolved identity is silently dropped:
all ten manifests report 100% Chadwick crosswalk coverage. The combined analysis
population contains 24,406 players and 9,832 observed MLB debuts by 60 months.

The 2015 source season contains one affiliate whose page explicitly reports
`Record: N/A` and supplies no player tables. The parser preserves that page as
`declared_no_record`, requires it to contribute zero participant rows, and still
requires all other appearance-data teams to reconcile exactly. This avoids both
invented players and silent denominator shrinkage.

The combined corpus content digest is
`b9e50c7f1a8500c5dc7b4403b3a1d092d0ecce3c85232ef20b82d43abbedb2e8`.
These cohorts provide nine expanding-origin tests, but they are not yet a release
model. The source does not establish original publication timestamps, so the
manifests correctly set `effective_time_safe=true`,
`knowledge_time_verified=false`, and `strict_point_in_time_features=false`.

## Arrival Baseline

The population baseline is a role-specific regularized discrete-time logistic
hazard model. Separate hitter and pitcher annual hazards produce coherent 12, 24,
36, 48, and 60-month research estimates. Numeric imputation and scaling,
categorical encoding, feature selection, and the empirical-Bayes comparator are
fit inside each chronological fold. Repeated snapshots receive inverse player
snapshot weights; player-cluster bootstraps retain within-player dependence.

The final research fit uses 69,326 snapshots from 24,406 players, producing
324,417 at-risk person-periods and 9,832 observed debuts. Nine expanding-origin
folds test 2011 through 2019. Each fold restricts labels to its origin and scores
only fully mature horizons for which both role models have trained interval
support.

| Horizon | Eligible folds | Median ROC AUC | Median average precision | Median top-decile lift | Median Brier improvement vs age-level-role baseline |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12m | 9 | 0.937 | 0.376 | 7.49x | 14.3% |
| 24m | 8 | 0.925 | 0.513 | 6.49x | 21.6% |
| 36m | 7 | 0.909 | 0.567 | 5.43x | 23.7% |
| 48m | 6 | 0.892 | 0.586 | 4.83x | 23.2% |
| 60m | 5 | 0.879 | 0.594 | 4.45x | 22.4% |

The model beats the hierarchical age-level-role empirical-Bayes baseline on all
35 supported fold-horizons. Across those comparisons, median AUC is 0.918, median
top-decile lift is 5.9x, and median relative Brier improvement is 21.8%.
Calibration-in-the-large is within 0.02 on 34 of 35 comparisons and calibration
slope is within 0.8-1.2 on 28 of 35.

Those baseline wins are correlated point estimates, not 35 independent
experiments. The current empirical-Bayes comparator also uses fully mature rows
while the hazard likelihood can use partial follow-up. Release review therefore
requires a censoring-aware null hazard, paired player-cluster skill intervals,
and pooled out-of-fold calibration before treating the advantage as confirmed.

The failures are actionable. All five scored 60-month folds have slopes below
0.8, indicating over-dispersed long-horizon probabilities. Cold-start 60-month
risk is also underpredicted: in the 2019 test cohort the observed rate is 7.7%
versus a 5.5% mean prediction. A chronological calibration block, context
normalization, post-2020 regime stress test, and locked prospective holdout remain
mandatory. The artifact is marked
`research_population_benchmark_not_release_eligible`; no forecast is written to
product tables.

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
2. Add post-2020 cohorts for regime diagnostics. Preserve 2020 as a structural
   zero, use only mature horizons for ordinary binary metrics, and retain 2021 as
   a predeclared reorganization and pandemic-development stress test.
3. Register every historical season manifest in the Neon lineage catalog and add
   periodic remote digest reconciliation for both current and superseded evidence.
4. Normalize level, league, park, organization, era, workload, promotion, transaction,
   and explicit coverage features without collapsing pooled stints into a single
   context.
5. Evidence original publication/knowledge times or keep reconstructed historical
   features out of strict historical-information backtests.
6. Add provider-versioned Sports Reference or FanGraphs WAR to the prepared career
   landmarks. Lahman supports playing time, rate, longevity, awards, and Hall of
   Fame outcomes, but does not contain WAR.
7. Build monthly competing-risk arrival hazards, IPCW survival metrics,
   chronological calibration, organization and era diagnostics, missing-feature
   stress tests, paired baseline-skill intervals, cold-start observed/expected
   gates, and a content-locked prospective holdout.
8. Build post-debut opportunity, performance, exit/re-entry, and WAR components,
   then simulate joint career paths. Model Hall-of-Fame-caliber performance
   separately from the later voting process.
9. Normalize Prospect Savant's 2023+ tracking components and point-in-time
   FanGraphs scouting grades as separate challengers. Require coverage-aware
   missingness indicators and forward-fold incremental value over the
   performance-only baseline.

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
manifests, and reconciled manifest membership. Migration
`0007_fix_archive_manifest_trigger.sql` makes the shared deferred reconciliation
trigger safe across its two row types.
