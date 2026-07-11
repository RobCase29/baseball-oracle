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

## Core principle

Baseball Oracle never publishes a naked score. Every forecast is a versioned snapshot with a horizon, uncertainty range, evidence date, data-completeness signal, calibration context, and reproducible feature lineage.
