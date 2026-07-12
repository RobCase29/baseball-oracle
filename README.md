# Baseball Oracle

Baseball Oracle is a point-in-time research platform for two prediction problems:

1. The probability that a professional minor-league player reaches MLB.
2. The distribution of that player's remaining career outcomes, updated as new minor- and major-league evidence arrives.

The repository ships a working React research cockpit backed by authorized
Prospect Savant observations in Neon and a locked Baseball-Reference MLB WAR
corpus. The live minor-league directory contains 6,868 real 2026 player-role
profiles (6,800 canonical MLBAM identities). The career artifact adds 1,291
current 40-man-roster MLB players and 6,455 frozen prospect research forecasts.
All career outputs are visibly research-only and use separate MLB and MiLB rank
universes because their targets are not directly comparable.

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
GET /api/players?q=jenkins&stage=Minors&playerType=Hitter&level=AAA&sort=arrival36&page=1&limit=50
GET /api/players?stage=MLB&playerType=Pitcher&sort=hofProbability&page=1&limit=50
```

Raw provider JSON and scouting prose are never returned by the public API.

## Current surfaces

- **Oracle board:** real minor and major leaguers, stage/role/level filters, stage-specific Hall-caliber and career-outcome ranks, pagination, and a browser-local watchlist.
- **Player dossier:** observed evidence, identity provenance, actual cumulative WAR, terminal career WAR/peak-seven/JAWS distributions, Hall standard, warnings, and model lineage.
- **Validation:** the eight external role-horizon comparisons, paired skill interval, failed calibration gate, and failed population-shift admission.
- **Model lab:** explicit targets, measured release gates, point-in-time rules, and model sequence.
- **Data health:** live Neon/player counts, corpus coverage, rights posture, and production-readiness state.

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
- [Career Oracle research contract](docs/CAREER_ORACLE_V1.md)

## Core principle

Baseball Oracle never publishes a naked score. Every forecast is a versioned snapshot with a horizon, uncertainty range, evidence date, data-completeness signal, calibration context, and reproducible feature lineage.
