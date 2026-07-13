# Baseball Oracle

Baseball Oracle is a point-in-time research platform for two prediction problems:

1. Which professional minor-league players have the strongest path to meaningful MLB impact.
2. Which active major leaguers have the strongest remaining career path toward Hall of Fame-caliber statistics.

The prospect board leads with an individualized **Prospect Score** for meaningful
five-year MLB impact; the MLB board leads with the **Oracle Career Index**, a
fixed 0-100 summary of modeled final-career WAR magnitude. They are shown beside
the player's exact stage standing and evidence depth so absolute career value,
relative rarity, and forecast support never collapse into one claim. Career Index
is not a probability, percentile, confidence score, expected WAR, or
investment-return score. The legacy stage-percentile `oracleScore` remains in the
partner feed only for migration compatibility. See the
[Career Index contract](docs/CAREER_INDEX_V1.md).
The prospect ranking contract and July 2026 age audit are in
[Prospect Score v1](docs/PROSPECT_SCORE_V1.md).

The repository ships a working React research cockpit backed by authorized
Prospect Savant observations in Neon and a locked Baseball-Reference MLB WAR
corpus. The live minor-league directory contains 6,868 real 2026 player-role
profiles and 6,179 canonical pre-debut players after role and MLB-stage deduplication. The career artifact adds 1,291
current 40-man-roster MLB players and 6,455 frozen prospect research forecasts.
All career outputs are visibly research-only and use separate MLB and MiLB rank
universes because their targets are not directly comparable.

## Current data and model updates

Production defines twice-daily 10:17 and 22:17 UTC refreshes for all ten current
Prospect Savant minor-league slices and the authorized Baseball-Reference
current-season batting and pitching value pages. New MLB WAR, workload, and
role-relative WAR percentile reach player profiles without silently changing the
completed-season Career Index or a Rookie Track player's frozen prospect prior.
`/api/health` reports the last source attempts, complete-slice coverage, scheduled
job receipt, and separate current-data and model clocks.

Model scoring remains a tested release rather than an automatic side effect of a
source refresh. The current ranks use completed-2025 model features. The full
July 2026 audit concludes that these models contain useful ranking signal but are
not an ultimate champion; the registered larger tournament and data priorities are
linked below.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Other useful commands:

```bash
npm run lint
npm test
npm run build
npm run preview
```

## Reproduce the research baseline

The offline model workspace is deliberately separate from Vercel request handling.
It downloads pinned source files, verifies their hashes, builds feature and label
tables in separate Parquet files, and runs expanding-window backtests without a
random row split. The locked environment requires Python 3.13:

```bash
npm run data:acquire
npm run model:setup
npm run model:all
```

The broader affiliated-player benchmark discovers every prepared season with a
verified private-archive lock, builds one content-addressed population corpus, and
trains separate hitter and pitcher hazards:

```bash
npm run model:population:all
```

The career tournament verifies and consumes the locked 1871-2026 MLB WAR corpus,
builds player-season landmarks, runs its chronological tournament, and exports
the static research artifact used by the API:

```bash
npm run model:career:test
npm run model:career:train
```

The current verified corpus covers every nonzero affiliated season from 2010
through 2019: 69,326 eligible player-season snapshots, 24,406 players, and 9,832
MLB debuts within 60 months. The research benchmark beats its hierarchical
age-level-role comparator on all 35 supported forward fold-horizons, but remains
unpublished because long-horizon and cold-start calibration, context normalization,
and a locked prospective holdout are still pending. A content-locked 2021-2025
retrospective regime evaluation improves the censoring-aware baseline across
eight sufficient role-horizon cells, but fails preregistered population-shift and
calibration cell-fraction gates, so it is not release-eligible.

Raw data, derived Parquet files, and model artifacts stay local and are ignored by
Git. Their source URLs and SHA-256 hashes live in `data/source-lock.json`; the code,
environment lock, and database lineage schema are versioned. Preparation verifies
every raw byte against a matching acquisition manifest, then archives each table,
build manifest, validation report, and model under a content digest.
The application serves the frozen 2025 arrival candidate and the Career Oracle
artifact through explicitly research-only fields. No artifact is marked released.
The Hall target is statistical JAWS caliber, not induction probability, and the
prospect result is an arrival-horizon lower-bound proxy composed with a debut-age
career bridge rather than a directly trained MiLB-to-Hall model.
The board also publishes a separate `career-chapter-v1` research layer. Career
chapters are learned independently for hitters, starters, and relievers from
post-1961 unconditional next-season WAR change and continuation curves. For MLB
players, the chapter model estimates the calibrated probability that the next
three completed seasons total at least the global training-fold 90th-percentile
WAR threshold. That event is globally comparable; it is not a Hall-caliber
probability or a rank within a narrow current-player cohort. Completed-season
historical WAR pace remains descriptive context and never changes an outcome
probability. Minor-league near-term ranking continues to use the separately
defined 36-month MLB-arrival probability.

The separate `alpha-signal-v1` research alert is an early-career anomaly detector,
not a single opaque score. A player must have no more than six completed MLB seasons,
at least two years of runway to the learned role-track prime, a supported
post-1961 historical baseline of at least 500 resolved players, and a P90 JAWS
ceiling above the applicable Hall-caliber standard. Eligible players are ranked
by the percentage-point gap between the modeled Hall-caliber probability and
that broad historical base rate. Market price and external consensus are not yet
modeled, so this is model alpha rather than evidence of market mispricing.

The separate `milb-alpha-signal-v1` gate identifies frozen 2025 arrival anomalies.
It requires a young age percentile within role and level, minimum raw workload,
supported 2010-2019 historical context, a 36-month arrival estimate of at least
20%, at least a +10 percentage-point edge over the hierarchical baseline, and a
positive 60-month edge. It emits 210 research signals, of which 105 are Priority.
Prospect Savant composite scores, external ranks, and scouting grades are excluded.
Current raw tracking traits are shown only as named descriptive corroboration.
The post-hoc 36-month diagnostic selected 223 players with 110 arrivals, but the
external calibration and population-shift gates failed, so no probability is
presented as validated confidence.

The Minors board now leads with the probability-free
`milb-impact-five-calendar-year-war-v1` rank across its frozen 6,455-player
universe. Career Index is labeled Ceiling if MLB and remains separate.
The direct-impact target is
at least 5 total MLB WAR in 2026-2030. The champion produced 8.10x top-decile lift
across player-purged forward folds, but extreme-tail calibration failed, so the
public artifact exposes rank and comparison evidence while omitting player impact
probabilities. Current raw traits remain descriptive corroboration only. See
[MiLB Alpha model card](docs/MILB_ALPHA.md).
See [Model readiness](docs/MODEL_READINESS.md) for measured coverage, validation
results, and the gates that remain before forecasts can be published.

Local Vite development proxies the public `/api/health`, `/api/players`, and
`/api/model-status`
routes to the production Vercel deployment, keeping Neon credentials server-only.
Set `API_PROXY_TARGET` to point at another public deployment when needed.

## Neon and Vercel

The Vercel project is connected to Neon. Database credentials remain server-only and are never exposed through `VITE_*` variables.

After linking a fresh checkout to Vercel, pull its Preview environment and initialize the research schemas:

```bash
npx vercel env pull .env.local --yes --environment=preview
npm run db:setup
```

Neon integration credentials may be configured as write-only Vercel secrets. In that case, the local pull contains empty placeholders; the Vercel build runs the same idempotent migrations with the real server-side values. For local ingestion, copy the pooled and direct connection strings from the Neon dashboard into `.env.local` without committing that file.

The database uses separate `catalog`, `raw`, `core`, `ml`, and `app` schemas. Raw source responses and parsed records are append-only; normalized observations retain both effective time and the earliest evidenced `known_at` time.

Required open-data credits, including Retrosheet's specified attribution statement,
are preserved in [NOTICE.md](NOTICE.md).

The authorized research connectors land immutable FanGraphs prospect-board and
Prospect Savant snapshots:

```bash
npm run ingest:fangraphs
npm run ingest:prospect-savant
```

Repeated identical responses are no-ops. Changed responses create new ingestion runs instead of overwriting prior evidence. The connector logs only hashes and row counts, not scouting narratives.

The Prospect Savant command is a resumable 22-slice backfill over the empirically
available 2023-2026 season, level, and role matrix. It fixes the broad comparison
cohort at one tracked pitch and ages 16-40, waits between requests, and continues
past isolated failures so a rerun can fill only missing or changed snapshots.
Narrow runs are available without changing code:

```bash
npm run ingest:prospect-savant -- --seasons=2023-2025 --levels=A,AAA --roles=hitters
```

Prospect Savant leaderboard percentiles and composites depend on the selected
qualifier cohort. Baseball Oracle preserves them as provider-namespaced evidence
and will recompute training percentiles inside each historical fold from the raw
component statistics. Current age and organization fields returned on historical
rows are not treated as historical facts.

The latest complete Prospect Savant season is merged into
`app.player_directory`, then materialized as the indexed
`app.player_directory_snapshot` read model. A newly stored admin slice refreshes
the snapshot automatically; the CLI backfill refreshes once after a successful
run.

The allowlisted public endpoint supports stage-aware search, role and level
filters, research outcome sorting, and pagination:

```text
GET /api/players?view=map&stage=All&sort=careerIndex&page=1&limit=100
GET /api/players?view=map&stage=Minors&sort=prospectScore&page=1&limit=100
GET /api/players?q=jenkins&stage=Minors&playerType=Hitter&level=AAA&sort=arrival36&page=1&limit=50
GET /api/players?stage=Minors&sort=stageStanding&page=1&limit=50
GET /api/players?stage=MLB&sort=stageStanding&page=1&limit=50
GET /api/players?stage=MLB&playerType=Pitcher&sort=hofProbability&page=1&limit=50
GET /api/players?stage=MLB&playerType=Hitter&sort=nearTermImpact&page=1&limit=50
```

Prospect Score is the primary Minors product ranking; Career Index remains the
primary MLB and cross-route career-magnitude score. Existing API calls that omit
`sort` keep the legacy Minors default of `careerIndex`; consumers opt into the
new score and its machine contract with `sort=prospectScore`. Stage standing is a separate
declared-model-cohort rank and is never a filtered-result row number. In stage-
specific requests, the legacy `alphaOpportunity` sort remains an alias for
`stageStanding`; unsupported competitive sorts with `stage=All` return HTTP 400.
Compact `player-map-feed.v4` responses declare exact requested and applied
ordering in `meta.ordering`.

Raw provider JSON and scouting prose are never returned by the public API.

## Current surfaces

- **Rankings:** Prospect Score for MiLB, Career Index for MLB, exact ranks, real players,
  team/position/stage filters, and current evidence in a table-first workflow.
- **Directory:** an identity and coverage view across stages. It defaults to
  player name, also supports age, and neither order is a baseball ranking.
- **Rookie Track:** a frozen prospect Career Index and standing paired with
  separate, accumulating MLB confirmation evidence.
- **Player dossier:** index explanation, current strengths and risks, current
  stats, an MLB career arc where supported, and honest missing-evidence states.
- **Model review:** a plain-language verdict, target-by-target evidence, testing
  rules, and the path to a champion model.

Every model output remains lineage-bound and labeled with its publication state.
In-season 2026 evidence is context only; scoring defaults to the latest complete
season and withholds players without a valid completed-season feature state.
Provider scores and percentiles remain source evidence and do not determine the
default rank. The domain contracts live in `src/domain/forecast.ts`.

## Design documents

- [Product workflow](docs/PRODUCT.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Modeling strategy](docs/MODELING.md)
- [Research program and execution ladder](docs/RESEARCH_PROGRAM.md)
- [Point-in-time data contract](docs/DATA_CONTRACT.md)
- [Data sources and licensing](docs/DATA_SOURCES.md)
- [Historical backfill strategy](docs/HISTORICAL_BACKFILL.md)
- [Model readiness and baseline](docs/MODEL_READINESS.md)
- [MiLB Alpha model card](docs/MILB_ALPHA.md)
- [Career Oracle research contract](docs/CAREER_ORACLE_V1.md)
- [Oracle Career Index v1 contract](docs/CAREER_INDEX_V1.md)
- [Player Map partner feed](docs/PLAYER_MAP_FEED.md)
- [Daily data refresh and serving audit](docs/DATA_REFRESH.md)
- [July 2026 model and data review](docs/audits/MODEL_AND_DATA_REVIEW_2026-07-13.md)
- [Registered S-tier model tournament](modeling/config/s-tier-tournament-v1.json)

## Core principle

Baseball Oracle never publishes a naked score. Every forecast is a versioned snapshot with a horizon, uncertainty range, evidence date, data-completeness signal, calibration context, and reproducible feature lineage.
