# Baseball Oracle

Baseball Oracle is a point-in-time research platform for two prediction problems:

1. The probability that a professional minor-league player reaches MLB.
2. The distribution of that player's remaining career outcomes, updated as new minor- and major-league evidence arrives.

The current repository is the product foundation. It ships a working React decision cockpit backed by typed, fictional demo forecasts. It does **not** contain trained models or licensed production baseball data yet.

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

## Neon and Vercel

The Vercel project is connected to Neon. Database credentials remain server-only and are never exposed through `VITE_*` variables.

After linking a fresh checkout to Vercel, pull its Preview environment and initialize the research schemas:

```bash
npx vercel env pull .env.local --yes --environment=preview
npm run db:setup
```

Neon integration credentials may be configured as write-only Vercel secrets. In that case, the local pull contains empty placeholders; the Vercel build runs the same idempotent migrations with the real server-side values. For local ingestion, copy the pooled and direct connection strings from the Neon dashboard into `.env.local` without committing that file.

The database uses separate `catalog`, `raw`, `core`, `ml`, and `app` schemas. Raw source responses and parsed records are append-only; normalized observations retain both effective time and the earliest evidenced `known_at` time.

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

## Current surfaces

- **Prospect board:** search, cohort filtering, decision-oriented ranking, movement, and watchlist actions.
- **Player dossier:** MLB arrival probability, career WAR distribution, HOF-caliber tail, career arc, evidence drivers, and data/model confidence.
- **Model lab:** explicit targets, release gates, point-in-time rules, and model sequence.
- **Data health:** proposed source stack, rights posture, and production-readiness state.

All player records and forecasts in the UI are simulated. The demo adapter lives in `src/data/demoPlayers.ts`; domain contracts live in `src/domain/forecast.ts`.

## Design documents

- [Product workflow](docs/PRODUCT.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Modeling strategy](docs/MODELING.md)
- [Point-in-time data contract](docs/DATA_CONTRACT.md)
- [Data sources and licensing](docs/DATA_SOURCES.md)
- [Historical backfill strategy](docs/HISTORICAL_BACKFILL.md)

## Core principle

Baseball Oracle never publishes a naked score. Every forecast is a versioned snapshot with a horizon, uncertainty range, evidence date, data-completeness signal, calibration context, and reproducible feature lineage.
