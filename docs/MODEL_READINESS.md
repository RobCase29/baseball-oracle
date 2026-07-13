# Model Readiness

Status as of July 12, 2026.

## Verdict

Baseball Oracle now has executable, reproducible research baselines for MLB
arrival and terminal MLB career outcomes, plus ten mature affiliated-season
arrival cohorts. The application displays real players and explicitly
research-only estimates, including withheld states. It is ready for model
research and retrospective chronological audits. It is not ready to mark any
player probability as released or to claim superiority on prospective evidence.

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
| Baseball-Reference Register | Complete 2010-2019 affiliated seasons; locked 2021-2025 external cohorts; structural-zero 2020 season | Full season-appearance risk sets, team and organization lineage, and minor-league performance under the project's research permission |
| Baseball-Reference MLB WAR/JAWS | 1871-2026 player-season census; 2025 latest complete scoring season | Career WAR, peak-seven WAR, exact position/role JAWS standards, current MLB census, and terminal career research targets |

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

## Post-2020 External Evaluation

The post-pandemic regime test is now captured and scored, but it is not a
prospective product release. The locked Baseball-Reference archive contains
1,010 reconciled affiliated team pages across 2021-2025 with zero capture
failures. The content-addressed external corpus contains 33,559 snapshots for
13,976 players (15,476 hitters, 18,083 pitchers, and 9,701 repeat players).
The five season labels contain 8,187/6,874, 8,347/6,927, 8,281/6,866,
7,789/6,437, and 7,812/6,455 census/model-eligible rows respectively.

The amended, create-only evaluation lock is
`2a6f2b237b03045fa7b16f8d759da8bd35cd974636f1b9536bf96fe70f8587e3`.
Predictions were archived before outcomes were read: 167,795 rows,
`5424feaab1473d9680a966a0a2dad7066c068f25261413c73f247abf308f862d`, with
prediction content digest
`8dda7eb4fe18841c2ac24960d0e225f3498c3f4f5ea4a6c8d76f2dc34fb443b2`.
The scored report is `dbdf644d4b3e8b7fecc81fc0cc568a8554d073388196e1ea94e273e78f259c69`.

Across eight sufficient 12-48 month role-horizon cells, the candidate improved
the censoring-aware baseline Brier score in all eight cells. The paired Brier
improvement estimate was 0.01527 (95% CI 0.01330-0.01727); calibration slope
passed all eight cells and O/E passed seven. This is useful evidence, not a
release claim: the report status is `external_validation_fail_not_release_eligible`.
The external admission failed its preregistered population-shift gates, and the
cell-fraction ECE gate passed only 5/8 cells (required 6/8). The 60-month
external labels are not mature for this evaluation; 2025 rows remain
prediction-only. A technical monotonicity amendment was made before scoring and
is fully bound by the successor lock; the original failed admission remains
preserved. Because aggregate outcome QA had been inspected before the failed
attempt, this evaluation is retrospective rather than researcher-blind.

## Career Oracle Terminal Baseline

The authorized Baseball-Reference MLB WAR backfill is complete across all 324
registered acquisition units from 1871 through 2026 with zero failures. It
contains 117,033 player-seasons for 23,711 Baseball-Reference identities. The
2026 rows are an in-season census and actual-evidence layer; 2025 is the latest
complete feature season. Exact Hall JAWS standards are locked for eight hitter
positions, starting pitchers, and relief pitchers.

The current scoring census reconciles all 1,291 Baseball-Reference identities on
2026 40-man rosters to the WAR corpus. Exact Chadwick keys add MLBAM identities
for 1,278 players; the 13 unresolved external IDs remain in the MLB census without
a guessed name join. An additional 46 MLBAM-only pre-debut roster players remain
in the minor-league universe rather than being fabricated into the MLB WAR panel.

The implemented target is `hof-caliber-point-in-time-jaws-v1`: final JAWS clears
the exact standard attached to the player's career-to-date role/position at each
landmark. A later role or position change therefore rebaselines the threshold.
Completed-career classification is diagnostic only, actual induction is
descriptive only, and unsupported two-way careers are withheld.

The terminal distribution model draws paired final-WAR and peak-seven-WAR
residual scenarios by role, career stage, and performance band, then recomputes
JAWS. It is a terminal landmark baseline, not an annual aging-path simulation.
The final scorer preserves held-out residual/calibration layers while refitting
the point and raw probability learners through resolved 2022 careers. Full
player-disjoint cross-fitting is still required in the next registered version.

Mechanical champion selection uses a chronological selection cohort. The later
historical cohort was inspected during iterative development, so it is labeled a
development holdout and cannot support a blind or prospective superiority claim.
The release decision remains false independently of the selected tournament
entrant. Early-career interval coverage, high-performance subgroup behavior, a
new untouched forward cohort, and operational lineage all remain release gates.

The current chronological selection chose the calibrated scenario-tilt entrant
at classifier weight `0.60`. Its player-equal Brier score was `0.00313` versus
`0.00635` for the age-position empirical prior. On the retrospective development
holdout those values were `0.00314` and `0.00658`, respectively, across only 24
Hall-caliber event players. These are useful architecture diagnostics, not an
external superiority claim. The early-career interval release floor failed at
`61.3%` observed minimum coverage versus `65%` required, and the top-decile
pitcher distribution gates failed for first-season and seasons 7-10 landmarks.

Those tournament metrics do not validate the exact current-player scorer. The
deployed research bundle refits its point and raw probability learners through
2022 while retaining earlier residual/calibration layers; the artifact records
`classifierRefitCalibrationApproximate=true` and `fullPlayerCrossFit=false`.
Current-player probabilities therefore remain unvalidated research estimates and
must not inherit the tournament Brier, AUC, or interval-coverage claims.

Early Hall-tail behavior is also unresolved. On the retrospective development
holdout, central P80 coverage among the 29 actual first-season Hall-caliber cases
is zero and final-WAR MAE is 73.2. Because Hall cases are a rare upper tail, that
conditional slice is a tail-detection diagnostic rather than a conventional
central-interval calibration target. It nevertheless shows why the current
single-scenario JAWS support adjustment cannot be considered an elite-career
model. The next entrant must learn an elite-tail distribution and report P95/P99,
tail-weighted scores, and expected shortfall before early-career confidence can
be promoted.

Finally, the outcome split is based on completed career end year, not prediction
origin. It is player-disjoint but conditions cohort membership on future career
length, and some early landmarks predate the calibration cutoff. A rolling debut
or prediction-origin design with censoring-aware outcomes is required for the
prospective track.

The MiLB result remains a distinct bridge: the externally failed 60-month arrival
candidate is combined with a debut-age career baseline. It is a lower-bound proxy,
not eventual arrival probability and not direct MiLB-to-Hall training. Accordingly,
the product assigns stage-specific MLB and MiLB ranks and excludes Prospect
Savant's composite from the default model and sort.

## Career Chapter Research Layer

The deployed `career-chapter-v1` layer is intentionally separate from the
terminal outcome and statistical Hall-caliber models. It learns hitter, starter,
and reliever lifecycle curves from post-1961 completed-season landmarks. The
curves combine unconditional next-season WAR change, with a non-return season
recorded as zero, and continuation probability. This design preserves attrition
instead of estimating development only among survivors. Learned
prime/decline/late boundaries are ages 28/33/38 for hitters, 26/33/37 for
starters, and 30/34/38 for relievers.

The accompanying MLB endpoint is the calibrated probability that the next three
completed MLB seasons total at least 4.68 WAR, the global player-weighted
training-fold 90th-percentile threshold. The fixed absolute threshold supports
comparison across ages, roles, and career chapters. It is not a Hall-caliber
probability and does not imply that the terminal career model simulates annual
WAR paths.

The prediction-origin split trains through 2011, calibrates with sigmoid scaling
on 2012-2017, and tests 2018-2022. The calibrated test contains 7,076 landmarks
and 932 events with a player-weighted event rate of 9.745%. ROC AUC is 0.87516,
average precision is 0.54871, Brier score is 0.06145, and log loss is 0.21669.
Current scoring publishes 1,134 research chapters and withholds 157 unsupported
states. These are retrospective research diagnostics; release still requires a
newly frozen prospective prediction-origin cohort and cohort calibration review.

Historical MLB pace remains a completed-season descriptive percentile against
resolved landmarks. The historical reference never reads the current 2026
partial-season value and never modifies the chapter or an outcome probability.
For minor leaguers, `nearTermImpact` uses the separately defined 36-month arrival
endpoint; it does not use Prospect Savant's composite or reinterpret the
debut-age Hall bridge as a trained minor-league career model.

## Alpha Radar Research Layer

`alpha-signal-v1` is the default decision view for supported MLB players. It
publishes no opaque score. The edge is the modeled Hall-caliber probability
minus a player-equal post-1961 base rate from at least 500 prior resolved players
on the same role track and broad experience/age band. Eligibility additionally
requires six or fewer completed MLB seasons, two or more learned pre-prime years,
and a P90 JAWS margin at or above the applicable Hall-caliber standard.

The corrected player-disjoint development audit allows exactly one preregistered
decision point per player: the earliest supported early-career snapshot. It
evaluated 3,189 supported pre-prime players with 29 Hall-caliber events. Four
players cleared every gate and one was an event. The observed 25% rate is based
on too few selections to support a lift or performance claim. The development
cohort was human-reviewed, chapter boundaries used the full post-1961 panel, and
the exact current scoring refit is not cross-fitted. These results justify
continued research and prospective tracking, not release or an edge claim.

The current layer measures model abnormality against baseball history. It does
not include memorabilia prices, external rankings, liquidity, fees, or market
implied probabilities. Minor leaguers are labeled `Discovery only` and excluded
from Alpha rank until a validated direct career-ceiling bridge is available.

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
2. The 2021-2025 post-2020 cohorts are captured and externally evaluated. Preserve
   the locked evidence, but do not promote it: distribution-shift admission and
   pooled ECE cell-fraction gates failed. Preserve 2020 as a structural zero and
   use only mature horizons for ordinary binary metrics.
3. Register every historical season manifest in the Neon lineage catalog and add
   periodic remote digest reconciliation for both current and superseded evidence.
4. Normalize level, league, park, organization, era, workload, promotion, transaction,
   and explicit coverage features without collapsing pooled stints into a single
   context.
5. Evidence original publication/knowledge times or keep reconstructed historical
   features out of strict historical-information backtests.
6. Extend the locked Baseball-Reference WAR landmark baseline with normalized
   era, league, park, position, workload, and opportunity features. Raw calendar
   year is excluded until an era transformation is preregistered and tested.
7. Build monthly competing-risk arrival hazards, IPCW survival metrics,
   chronological calibration, organization and era diagnostics, missing-feature
   stress tests, paired baseline-skill intervals, cold-start observed/expected
   gates, and a content-locked prospective 2026 holdout; the external 2021-2025
   test is retrospective and does not satisfy this gate.
8. Replace the terminal landmark baseline with cross-fitted post-debut
   opportunity, performance, exit/re-entry, aging, injury, and WAR components,
   then simulate coherent annual career paths. Keep statistical Hall caliber
   separate from the later voting process.
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
