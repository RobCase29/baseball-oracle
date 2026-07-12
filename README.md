# Baseball Oracle

Baseball Oracle is a point-in-time research platform for two prediction problems:

1. The probability that a professional minor-league player reaches MLB.
2. The distribution of that player's remaining career outcomes, updated as new minor- and major-league evidence arrives.

The current repository is the product and data foundation. It ships a working React decision cockpit backed by authorized Prospect Savant observations stored in Neon. The player directory is real; Baseball Oracle forecasts remain unpublished until the historical backfill, temporal validation, and calibration gates pass.

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

The current verified corpus covers every nonzero affiliated season from 2010
through 2019: 69,326 eligible player-season snapshots, 24,406 players, and 9,832
MLB debuts within 60 months. The research benchmark beats its hierarchical
age-level-role comparator on all 35 supported forward fold-horizons, but remains
unpublished because long-horizon and cold-start calibration, context normalization,
and a locked prospective holdout are still pending. A locked 2021-2025 external
regime evaluation is complete and improves the censoring-aware baseline across
eight sufficient role-horizon cells, but fails preregistered population-shift and
calibration cell-fraction gates, so it is not release-eligible.

Raw data, derived Parquet files, and model artifacts stay local and are ignored by
Git. Their source URLs and SHA-256 hashes live in `data/source-lock.json`; the code,
environment lock, and database lineage schema are versioned. Preparation verifies
every raw byte against a matching acquisition manifest, then archives each table,
build manifest, validation report, and model under a content digest.
The current model is a research baseline and is not served by the application.
See [Model readiness](docs/MODEL_READINESS.md) for measured coverage, validation
results, and the gates that remain before forecasts can be published.

Local Vite development proxies the public `/api/health` and `/api/players`
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

The allowlisted public endpoint supports server-side search, role and level
filters, source-score sorting, and pagination:

```text
GET /api/players?q=jenkins&playerType=Hitter&level=AAA&sort=psScore&page=1&limit=50
```

Raw provider JSON and scouting prose are never returned by the public API.

## Current surfaces

- **Prospect board:** real-player search, role and level filtering, Prospect Savant score/percentile sorting, pagination, and a browser-local watchlist.
- **Player dossier:** observed metrics, source coverage, identity provenance, and an explicit unpublished-model state.
- **Model lab:** explicit targets, release gates, point-in-time rules, and model sequence.
- **Data health:** proposed source stack, rights posture, and production-readiness state.

Every returned player has `forecast: null` until a validated model release is published. Provider scores and percentiles are labeled as source evidence and never presented as Baseball Oracle predictions. The domain contracts live in `src/domain/forecast.ts`.

## Design documents

- [Product workflow](docs/PRODUCT.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Modeling strategy](docs/MODELING.md)
- [Research program and execution ladder](docs/RESEARCH_PROGRAM.md)
- [Point-in-time data contract](docs/DATA_CONTRACT.md)
- [Data sources and licensing](docs/DATA_SOURCES.md)
- [Historical backfill strategy](docs/HISTORICAL_BACKFILL.md)
- [Model readiness and baseline](docs/MODEL_READINESS.md)

## Core principle

Baseball Oracle never publishes a naked score. Every forecast is a versioned snapshot with a horizon, uncertainty range, evidence date, data-completeness signal, calibration context, and reproducible feature lineage.
