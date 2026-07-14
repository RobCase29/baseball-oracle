# Data refresh and serving audit

Audited July 13, 2026.

## What production did before this change

Production had authenticated, manual `POST` ingestion endpoints for one FanGraphs
snapshot and one Prospect Savant slice. `vercel.json` defined no Cron Jobs, so no
source refreshed automatically. The build ran migrations and source-catalog seeds,
but it did not acquire data, score players, validate a prediction batch, or publish
a model snapshot.

The live player response combined clocks that must not be confused:

| Layer | Previous production state | Product effect |
| --- | --- | --- |
| Prospect Savant directory | Live 2026 source rows in Neon | Current MiLB identity, level, organization, workload, and descriptive traits |
| MiLB arrival and impact | Frozen at December 31, 2025 in committed JSON | The displayed MiLB outcome rank did not react to refreshed 2026 statistics |
| MLB roster census | Baseball-Reference roster artifact retrieved July 12, 2026 | Determined which MLB players appeared |
| MLB career model features | Latest complete season was 2025 | The career outcome rank did not react to 2026 performance |
| MLB current statistics | Present only inside a local ignored corpus | No current MLB performance reached `PlayerRecord.metrics` |

`meta.dataAsOf` previously selected the newest date across these layers. A fresh
roster timestamp could therefore make a completed-season model rank look freshly
scored. The health contract now reports artifact, feature, roster, raw-source, and
read-model clocks separately.

## Automatic refresh now defined

Vercel invokes `GET /api/cron/refresh-current` twice daily, at 10:17 and 22:17
UTC. The second window is both a fresher in-season update and an idempotent recovery
opportunity when an upstream source was unavailable in the first window. The endpoint:

1. Fails closed unless the request bears the exact `CRON_SECRET` value.
2. Claims one job-level operational run so overlapping invocations do not duplicate
   work.
3. Fetches all ten current Prospect Savant role and level slices in parallel with
   the ten official MLB StatsAPI MiLB hitter/pitcher level slices.
4. Rejects every Prospect Savant payload unless at least 95% of rows retain a
   supported player identifier, the requested cohort, and role-specific core
   fields. Scheduled slices must also keep at least 60% of their prior row count
   and contain at least 100 rows.
5. Refreshes `app.player_directory_snapshot` only after every Prospect Savant
   slice succeeds. Complete official level cohorts publish independently, so one
   unavailable Rookie slice cannot stale valid A through AAA data.
6. Fetches the authorized Baseball-Reference current value batting and pitching
   pages serially with the registered user agent, 3.2-second crawl delay, and at
   most two attempts per page for transient HTTP or network failures.
7. Strictly parses both pages before landing immutable response bytes and rows.
8. Refreshes `app.current_mlb_value_snapshot` only after both sides succeed.
9. Fetches and validates both current FanGraphs prospect-board sides, then
   publishes the newest season only when both hitters and pitchers are present.
10. Enforces a 270-second request deadline below Vercel's 300-second function
    limit. Prospect Savant, MLB StatsAPI, Baseball-Reference, and FanGraphs receive
    bounded 130-, 130-, 80-, and 40-second windows. The first two run in parallel,
    keeping the declared critical path at 250 seconds. HTTP work and crawl delays stop on
    abort, while PostgreSQL statements, lock waits, and idle transactions have
    server-side limits. One stalled provider therefore cannot consume the other
    required provider's opportunity or strand the operational receipt.
11. Treats all four current sources as required and reports sanitized per-source
    failure messages through the health endpoint.
12. Records success, failure, partial results, code commit, season, and timestamps in
   `ops.refresh_run` even when source bytes have not changed.

The two required sources use separate season clocks. Baseball-Reference current MLB
value rolls over on April 1 UTC. Prospect Savant's A, A+, AA, and AAA hitter and
pitcher slices also roll on April 1. Its two Rookie slices retain and recheck the
prior season until June 1, after affiliated Rookie schedules begin. During that
window, publication selects the latest valid season independently for each level,
but only after both its hitter and pitcher slices pass. The eight available
current-year slices therefore stay fresh without inventing two unavailable Rookie
cohorts or combining roles from different seasons. Health preserves
`currentCoverage.prospectSavant.season` as the maximum selected season and exposes
`minimumSeason` when the ten-slice set spans two seasons. Each receipt records the
standard-level and Rookie-level source seasons separately. A running receipt older
than six minutes is closed as failed before the next invocation claims the job.

Vercel does not retry failed Cron invocations. The collectors make only bounded
request-level retries, are content idempotent, and the next twice-daily invocation
resumes safely. Source evidence remains
immutable in `raw.ingestion_run`, `raw.fetch`, `raw.blob`, and `raw.record`; the
operational receipt is deliberately separate.

## Serving behavior

`app.current_mlb_value_snapshot` selects the latest season for which both current
value pages exist, merges two-way rows by exact Baseball-Reference ID, and exposes
current WAR, PA, IP, starts, retrieval time, and a descriptive within-role WAR
percentile. `/api/players` also treats every row in that complete current snapshot
as active MLB evidence, so a player can enter Rookie Track before the next frozen
model census is trained. These values are current evidence, not model inputs, until
a new point-in-time feature and scoring pipeline is promoted.

For an exact modeled-player match, the current row is authoritative for team,
position, age, workload, and current role. Multi-team aggregate codes such as
`2TM` never overwrite a known roster-census assignment; an unmatched aggregate
is labeled `Multiple teams` rather than treated as a club. A current role change must clear a
substantive 60-PA or 20-IP evidence gate; token usage cannot trigger it, and a
completed-season two-way classification is not downgraded because one side is
temporarily absent. When a supported single-role model and substantive current
role disagree, the old Career Index and terminal forecast are removed from ranks
instead of being relabeled. Live statistics stay visible under an explicit role-
transition treatment until a completed-season model supports the new role.

Cross-source lifecycle transitions are exact-ID only. The build includes a pinned
Chadwick/Baseball-Reference identity artifact with unique MLBAM and Baseball-
Reference keys plus source hashes, along with a source-hash-validated
`key_person`-to-MLBAM lookup from the same pinned Chadwick release. When a new
Baseball-Reference ID is absent from the committed crosswalk, the scheduled refresh
may retrieve only that canonical player page. The requested ID, canonical URL,
unique `sr-bbref-id`, and unique `sr-chadwick-id` metadata must agree before the
Chadwick key can resolve to MLBAM. The raw page and response hash are retained, and
the exact BRef/Chadwick/MLBAM triple is recorded in
`core.mlb_exact_identity_overlay` with one-to-one database constraints. Identical
observations may refresh the evidence clock; any provider-ID disagreement fails
closed. Names are never part of that promotion. A current-season debut enters Rookie Track only
when a complete current MLB row is present; its frozen prospect prior is retained
only when the MLB record resolves to that prior through an exact identifier. A
minor row with exact debut history remains searchable outside prospect ranks until
that MLB evidence arrives. A player
with earlier MLB experience who has current-season minor-league data is kept
searchable as `MLB experience · current minor data`, but is excluded from both the
prospect ranking and active-MLB ranking. Names, accents, and approximate matches are
never used to manufacture a lifecycle join or score.

Regenerate the identity artifacts with `npm run data:mlb-identity:export` and
`npm run data:chadwick-mlbam:export` only after updating their pinned source inputs.
The corresponding test commands verify source hashes, one-to-one exact links,
identifier uniqueness, and loader behavior. Health composes the committed map with
the durable overlay, validates every overlay row again against the pinned Chadwick
lookup, and degrades immediately for an unresolved current BRef row, a static/live
conflict, or ambiguous evidence. The bundled artifact age remains visible metadata,
but it does not make otherwise complete live exact-ID coverage stale. An auxiliary
identity-page failure does not suppress valid current statistics; it leaves that
player explicitly unlinked and health degraded until a later refresh resolves it.

The expanded `/api/health` response reads latest attempts and successful fetches
from Neon, reports the latest valid 10-slice MiLB role-level set and two-side MLB
coverage, includes scheduled and manual job receipts, and publishes a small
build-generated manifest for all three committed model artifacts. It intentionally
separates two clocks:

- `statsChangedAt` is when new source bytes were stored. It may remain old when a
  source is checked successfully but its content is unchanged.
- `lastCheckedAt` is operational proof that the source was checked, including an
  idempotent duplicate response. This clock determines current-data freshness.

Health is `ok`, `degraded`, or `stale` and includes machine-readable reason codes.
`CRON_SECRET` being configured is not treated as proof that scheduling works;
`scheduledRefresh.cronProof` becomes true only after `ops.refresh_run` contains a
receipt whose `trigger_kind` is `vercel_cron`. The response also identifies the
latest scheduled success, latest authenticated-manual success, and the next due
time. A successful scheduled check is considered stale after 26 hours, which gives
the two daily windows room for normal execution delay while detecting two missed
opportunities.

## Completed-season FanGraphs identity bridge

The 2026 board's locked completed-2025 responses provide exact identity evidence
for current scouting rows that temporarily disappear from the in-season statistics
side. The bridge is generated from the full conflict-free intersection of scout and
statistics records on `(UPID, MinorMasterId, role)`, requiring a positive
`xMLBAMID` and `Season = 2025`. Names are neither stored nor used for matching.

- Hitter source SHA-256: `0053540e097f355e113d9a1733ac25bbf7faae3f4761660a83a821bf616fbbb0`
- Pitcher source SHA-256: `88890ba8c075b686dc651057e3ca36580e9ed1e7906e2f21bc9cec5b396966ac`
- Locked output: 1,093 exact records, 533 hitters and 560 pitchers
- Records SHA-256: `cd305a89b93c10e98fe12560abd789e8d94feefd807427cbf7699cca324afe90`

Run `npm run data:fangraphs-identity:check` after source acquisition. The serving
overlay combines this evidence with current and historical observations. Any
tuple, current-versus-history, or census disagreement withholds the MLBAM identity.

## Remaining blockers to genuinely live forecasts

1. **No online feature builder.** New raw records do not create versioned
   `ml.feature_snapshot` rows.
2. **No scheduled scorer or atomic publisher.** The `ml.prediction_batch` and
   prediction tables exist, but the product still imports committed JSON artifacts.
3. **MiLB ranks are frozen.** Prospect Savant 2026 traits update descriptively, but
   the arrival and five-year impact ranks remain completed-2025 estimates.
4. **MLB ranks are completed-season models.** Current Baseball-Reference WAR now
   reaches the dossier, but it does not change Career Oracle output.
5. **FanGraphs is raw-only.** Its original default URL requests a 2021 season and
   2022 prospect-board edition. Scheduled collection is disabled until an explicit
   current URL is configured, and no normalized scouting-grade join exists yet.
6. **The separate roster artifact is not scheduled.** Complete current value pages
   now bridge newly active MLB players into the product twice daily, but a durable
   30-team transaction/roster snapshot is still needed for authoritative assignment
   changes before a player records new value-page statistics.
7. **No freshness alert destination.** Health is observable by API, but failures do
   not yet page, email, or open an incident.
8. **No prospective evaluation stream.** Predictions are not persisted before new
   games, so real forward calibration and rank-stability monitoring cannot start.

## Recommended operating cadence

| Process | In season | Offseason | Publication rule |
| --- | --- | --- | --- |
| Prospect Savant current slices | Twice daily | Weekly | Publish the latest valid complete role pair per level only with 10/10 slices |
| Baseball-Reference current value pair | Twice daily | Weekly | Publish current MLB evidence only with 2/2 sides |
| MLB roster census | Daily | Weekly and after transaction bursts | Atomic complete 30-team snapshot |
| FanGraphs board and grades | Weekly and after known board releases | Weekly | Normalize and reconcile identities before serving |
| Exact MLB identity bridge | Every current refresh, plus weekly pinned-source review | Monthly pinned-source review | Auto-publish only exact page metadata that resolves through the pinned Chadwick lookup; conflicts stay unlinked |
| Point-in-time feature build and score | Weekly | Monthly | Atomic batch after coverage, leakage, drift, and movement checks |
| Champion retraining tournament | Monthly challenger run | Full annual run after season close | Promotion only on untouched temporal gates |
| Prospective scorecard | After every completed scoring window | Monthly summary | Never overwrite the prediction that preceded the outcome |

## Required production setup

Create a random `CRON_SECRET` of at least 16 characters in the Vercel Production
environment before deploying the cron configuration. Verify the first production
run through `/api/health`; environment configuration alone is not cron proof. Do not reuse
`INGESTION_SECRET`. Configure `FANGRAPHS_CURRENT_PROSPECTS_URL` only after verifying
the current board request; the historical `FANGRAPHS_PROSPECTS_URL` is not used by
the scheduled current-data job.
