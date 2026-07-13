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

Vercel invokes `GET /api/cron/refresh-current` daily at 10:17 UTC. The endpoint:

1. Fails closed unless the request bears the exact `CRON_SECRET` value.
2. Claims one job-level operational run so overlapping invocations do not duplicate
   work.
3. Fetches all ten current Prospect Savant role and level slices.
4. Rejects every Prospect Savant payload unless at least 95% of rows retain a
   supported player identifier, the requested cohort, and role-specific core
   fields. Scheduled slices must also keep at least 60% of their prior row count
   and contain at least 100 rows.
5. Refreshes `app.player_directory_snapshot` only after every slice succeeds.
6. Fetches the authorized Baseball-Reference current value batting and pitching
   pages serially with the registered user agent and 3.2-second crawl delay.
7. Strictly parses both pages before landing immutable response bytes and rows.
8. Refreshes `app.current_mlb_value_snapshot` only after both sides succeed.
9. Optionally lands a current FanGraphs board when
   `FANGRAPHS_CURRENT_PROSPECTS_URL` is explicitly configured.
10. Attempts each source independently, so one upstream outage cannot suppress the
   other current-source refreshes.
11. Records success, failure, partial results, code commit, season, and timestamps in
   `ops.refresh_run` even when source bytes have not changed.

Vercel does not retry failed Cron invocations. The raw collectors are content
idempotent, and the next daily invocation resumes safely. Source evidence remains
immutable in `raw.ingestion_run`, `raw.fetch`, `raw.blob`, and `raw.record`; the
operational receipt is deliberately separate.

## Serving behavior

`app.current_mlb_value_snapshot` selects the latest season for which both current
value pages exist, merges two-way rows by exact Baseball-Reference ID, and exposes
current WAR, PA, IP, starts, retrieval time, and a descriptive within-role WAR
percentile. `/api/players` joins only the requested MLB page against that identifier.
These values are current evidence, not model inputs, until a new point-in-time
feature and scoring pipeline is promoted.

The expanded `/api/health` response reads latest attempts and successful fetches
from Neon, reports 10-slice MiLB and two-side MLB coverage, includes the most recent
scheduled-job receipt, and publishes a small build-generated manifest for all three
committed model artifacts.

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
6. **Roster refresh is not scheduled.** The current Baseball-Reference roster
   collector writes a local ignored artifact and must move to durable object storage
   or Neon before it can safely run outside a deployment build.
7. **No freshness alert destination.** Health is observable by API, but failures do
   not yet page, email, or open an incident.
8. **No prospective evaluation stream.** Predictions are not persisted before new
   games, so real forward calibration and rank-stability monitoring cannot start.

## Recommended operating cadence

| Process | In season | Offseason | Publication rule |
| --- | --- | --- | --- |
| Prospect Savant current slices | Daily | Weekly | Publish directory only with 10/10 slices |
| Baseball-Reference current value pair | Daily | Weekly | Publish current MLB evidence only with 2/2 sides |
| MLB roster census | Daily | Weekly and after transaction bursts | Atomic complete 30-team snapshot |
| FanGraphs board and grades | Weekly and after known board releases | Weekly | Normalize and reconcile identities before serving |
| Point-in-time feature build and score | Weekly | Monthly | Atomic batch after coverage, leakage, drift, and movement checks |
| Champion retraining tournament | Monthly challenger run | Full annual run after season close | Promotion only on untouched temporal gates |
| Prospective scorecard | After every completed scoring window | Monthly summary | Never overwrite the prediction that preceded the outcome |

## Required production setup

Create a random `CRON_SECRET` of at least 16 characters in the Vercel Production
environment before deploying the cron configuration. Do not reuse
`INGESTION_SECRET`. Configure `FANGRAPHS_CURRENT_PROSPECTS_URL` only after verifying
the current board request; the historical `FANGRAPHS_PROSPECTS_URL` is not used by
the scheduled current-data job.
