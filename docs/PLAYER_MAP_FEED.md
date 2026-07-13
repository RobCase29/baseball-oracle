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
- `externalIds`: exact provider identifiers. MLBAM is the preferred
  cross-product join key.
- `context`: active career stage, role, organization, position, level, and age.
- `assessment`: the universal Player Map vector, state, evidence, flags, target,
  comparison universe, version, and as-of dates.
- `assessment.careerIndex`: the primary fixed-scale career-value magnitude
  signal, including version, route, research status, definition, forecast
  model/target/data/provider lineage, and as-of date.
- `assessment.stageStanding`: exact stage rank, declared comparison universe,
  top-share percentage, tail band, cohort, and as-of date.
- `assessment.careerIndexComparableAcrossRoutes`: confirms that the fixed index
  scale is numerically shared across prospect, Rookie Track, and MLB routes.
- `assessment.stageStandingComparableWithinStageOnly`: prevents ordinal ranks
  from being compared across those route-specific cohorts.
- `assessment.oracleScore`: the legacy rounded stage-rank percentile retained
  during the Player Map v2 migration.
- `meta`: feed and scorecard versions plus explicit market-independence flags.

`meta.matchingMappedCount` is the number of matching records whose primary
`assessment.careerIndex.value` is non-null. It is not generic profile coverage or
five-year-impact-rank coverage.

Names are display fields, not identity keys. Never auto-merge two records only by
normalized player name. Use MLBAM first, another exact provider ID second, and a
reviewed identity-resolution queue otherwise.

## Score Semantics

`assessment.careerIndex.value` is the primary Player Map v2 product score. It is
the weighted P50/P75/P90 summary of the player's final-career WAR distribution
mapped onto frozen career-value anchors. It is not a probability, percentile,
confidence score, expected WAR, or investment-return estimate. The exact formula,
anchors, missing-value policy, and stage transitions are defined in
[`CAREER_INDEX_V1.md`](./CAREER_INDEX_V1.md).

`assessment.stageStanding` carries relative rarity separately. `topPercent` is
the player's rank divided by the declared universe, expressed as a percentage;
lower is better. `tailBand` is one of Top 0.1%, Top 1%, Top 5%, Top 10%, Top 25%,
or Outside top 25%. Prospect standing uses the frozen 6,455-player artifact, not
the changing number of active directory matches. Rookie Track carries that exact
frozen prospect standing until a supported completed-season MLB forecast exists.

The Directory union is an identity and coverage feed, not a combined ranking. It
defaults to `stage=All&sort=name`; `sort=age` is also available. Consumers must
not treat either row order as baseball standing or compare stage ranks across
prospect, Rookie Track, and MLB cohorts.

`assessment.oracleScore.value` remains available during migration. It is the old
rounded stage-specific outcome rank percentile. For example, a legacy value of 96
means the player ranked above approximately 96% of its declared route universe;
it does not mean 96% confidence. Do not relabel it as Career Index. A `null` value
in any score object means unavailable; it never means zero.

The supporting Player Map dimensions are readiness, trajectory, best current
trait, and evidence. They explain the forecast and how much trust to place in it;
they are not blended into Career Index or stage standing. Every numeric value
carries a scale and basis.

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
- Career Index value, version, route, status, and as-of date;
- stage rank, universe, top-share percentage, tail band, cohort, and as-of date;
- legacy Oracle Score only where migration compatibility requires it;
- mapping and evidence state.

Backstop should calculate card opportunity independently. A useful first design is
to retain Career Index, stage standing, readiness, trajectory, and evidence as
separate features, then combine them with market price percentile, recent
comparable sales, bid/ask depth, sell-through, population, card scarcity,
condition, and total transaction cost. Do not collapse the Oracle vector into an
unexplained talent number before testing which dimensions add out-of-sample
market value.

## Durable Feed Contract

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

Breaking semantic changes require a new feed version. A Career Index delta is
comparable only when its index version, forecast route, target, and model version
are unchanged. A stage-standing delta also requires an unchanged cohort and
universe definition. `oracle-player-map/v1` consumers may read the legacy
`oracleScore` during migration, but new Backstop ingestion should bind to
`oracle-player-map/v2` and persist `careerIndex` plus `stageStanding`.
Provider-derived fields should be included externally only when redistribution
rights cover the intended integration.
