# Player Map Feed

## Purpose

The Player Map feed is the machine-facing baseball intelligence boundary for
products such as Backstop Cards. It publishes player identity, current baseball
context, stage-specific Oracle assessments, evidence depth, and model lineage.
It deliberately excludes card prices, sales, listings, population reports,
liquidity, grading, scarcity, fees, and expected investment return.

```text
Oracle baseball evidence
  + Backstop market dislocation, liquidity, scarcity, and transaction costs
  = Backstop card opportunity
```

## MVP Endpoint

Request the compact representation from the player census endpoint:

```http
GET /api/players?view=map&stage=All&sort=name&limit=100&page=1
```

Continue until `page.totalPages` is reached. The full product response remains the
default when `view` is omitted. This MVP feed is intended for a daily server-to-
server pull. It does not yet provide immutable cursors or incremental changes.

The compact feed contains:

- `playerId`: the current Oracle record identifier.
- `identity.externalIds`: exact provider identifiers. MLBAM is the preferred
  cross-product join key.
- `context`: active career stage, role, organization, position, level, and age.
- `assessment`: the universal Player Map vector, state, evidence, flags, target,
  comparison universe, version, and as-of dates.
- `meta`: feed and scorecard versions plus explicit market-independence flags.

Names are display fields, not identity keys. Never auto-merge two records only by
normalized player name. Use MLBAM first, another exact provider ID second, and a
reviewed identity-resolution queue otherwise.

## Score Semantics

The Player Map has five independent dimensions: outcome, readiness, trajectory,
best current trait, and evidence. Every numeric value carries a scale and basis.
`null` means the dimension is withheld or unavailable; it never means zero.

Ordinal percentiles are comparable only inside their declared stage and universe.
For example, MiLB five-year impact percentile 96 means top 4% of the frozen MiLB
impact universe. It does not mean a 96% probability, and it should not be compared
directly with an MLB terminal-outcome percentile.

The compact MiLB assessment exposes the direct impact rank and arrival gate state,
but omits the failed-calibration raw arrival probabilities. Current descriptive
traits remain labeled as observed evidence rather than validated outcome signals.

## Backstop Join

Backstop should persist this lineage with every derived card recommendation:

- exact player identity key used for the join;
- Oracle record ID;
- Player Map version;
- signal target and model as-of timestamp;
- ordinal value, rank, and comparison-universe size;
- mapping and evidence state.

Backstop should calculate card opportunity independently. A useful first design is
to retain Oracle outcome, readiness, trajectory, and evidence as separate features,
then combine them with market price percentile, recent comparable sales, bid/ask
depth, sell-through, population, card scarcity, condition, and total transaction
cost. Do not collapse the Oracle vector into an unexplained talent number before
testing which dimensions add out-of-sample market value.

## Durable V1 Contract

The production integration should graduate to `/api/v1/player-signals` after the
canonical `core.player` UUID is populated for the complete active census. That
contract should add:

- immutable `snapshot_id` and canonical ordering;
- cursor pagination bound to one snapshot;
- `ETag` and `If-None-Match` support;
- a versioned JSON Schema and gzipped NDJSON snapshot;
- monotonic change sequence with `upsert`, `inactive`, and `identity_redirect`;
- idempotent record versions and effective-dated identity redirects;
- scoped server-to-server API keys.

Breaking semantic changes require a new feed version. A score delta is comparable
only when its target, definition, model, and universe versions are unchanged.
Provider-derived fields should be included externally only when redistribution
rights cover the intended integration.
