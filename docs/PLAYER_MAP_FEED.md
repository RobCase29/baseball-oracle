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

## Canonical Endpoint

New integrations should use:

```http
GET /api/v1/player-signals?stage=All&sort=name&limit=100&page=1
```

The normative contract and migration guide are in
[`PLAYER_SIGNALS_API_V1.md`](./PLAYER_SIGNALS_API_V1.md). It publishes honest
route-specific ranks, normalized Career Outlook and Current Results, fixed
external-ID keys, per-record versions, and an explicit snapshot.

## Legacy v4 Endpoint

Existing consumers may continue to request the compact v4 representation:

```http
GET /api/players?view=map&stage=All&sort=name&limit=100&page=1
```

Continue until `page.totalPages` is reached. The full product response remains the
default when `view` is omitted. This MVP feed is intended for a daily server-to-
server pull. It does not yet provide immutable cursors or incremental changes.
Compact responses use schema version `player-map-feed.v4`; the normative schema
is published at
[`/schemas/player-map-feed.v4.schema.json`](https://baseball-oracle.vercel.app/schemas/player-map-feed.v4.schema.json).
The v3 schema remains published for existing consumers, but new responses use v4.

For an explicit cross-stage Career Index order, request:

```http
GET /api/players?view=map&stage=All&sort=careerIndex&limit=100&page=1
```

For the primary prospect leaderboard, request:

```http
GET /api/players?view=map&stage=Minors&sort=prospectScore&limit=100&page=1
```

`stage=All` without `sort` remains an alphabetical directory. An explicit
`sort=careerIndex` is ordered descending across all scored routes, with nulls
last and display name, player ID, and Player Map route as deterministic
tie-breakers. The response declares the applied metric, direction, scope, null
policy, field exposure, and ordered tie-breakers in
`meta.ordering`; consumers should validate that object before trusting row order.

The legacy v4 fields map to this product-facing decision order:

1. **Stage Rank:** Prospect Rank, Pre-Debut Rank, or MLB Career Rank; lower is
   better within the declared route only.
2. **Career Outlook:** the existing `careerIndex` on its fixed 0-100 scale.
3. **Current Results:** observed current-season evidence, kept separate from rank.

`meta.decisionHierarchy` (`backstop-decision-hierarchy/v1`) publishes the exact
full and compact field paths for that order. The name **Career Outlook** is
intentional: Career Index is an absolute modeled career-value scale, not a peer
percentile, so labeling it “Relative Outlook” would be misleading.

The compact feed contains:

- `playerId`: the current Oracle record identifier.
- `externalIds`: exact provider identifiers serialized consistently as strings.
  Unsafe or fractional numeric inputs are rejected as unavailable rather than
  emitting a potentially rounded identifier. MLBAM is the preferred cross-
  product join key.
- `context`: active career stage, role, organization, position, level, and age.
- `currentEvidence`: exact-ID official MiLB season totals and current FanGraphs
  scouting evidence. These fields remain separate from model scores.
- `assessment`: the universal Player Map vector, state, evidence, flags, target,
  comparison universe, version, and as-of dates.
- `assessment.scores.outcome` on the MiLB route: the primary Prospect Score,
  exact impact rank, universe, target, status, and model as-of date. It ranks the
  target of at least 5 MLB WAR during 2026-2030 and is not a
  probability.
- `assessment.careerIndex`: the secondary fixed-scale Career Outlook
  signal for MLB and the prospect **Ceiling if MLB**, including version, route,
  basis, research status, definition, forecast
  model/target/data/provider lineage, and as-of date. Prospect and Rookie Track
  values are conditional on MLB arrival; arrival confidence remains separate.
- `assessment.stageStanding`: versioned exact stage rank, metric, target,
  methodology, direction, declared comparison universe, top-share percentage,
  tail band, cohort, scope, and as-of date. It explicitly declares that it is not
  a filtered-result ordinal.
- `assessment.careerIndexComparableAcrossRoutes`: confirms that the fixed index
  scale is numerically shared across prospect, Rookie Track, and MLB routes.
- `assessment.stageStandingComparableWithinStageOnly`: prevents ordinal ranks
  from being compared across those route-specific cohorts.
- `assessment.oracleScore`: the legacy rounded stage-rank percentile retained
  during the Player Map v2 migration. Its `deprecated` flag is always `true` and
  its replacement is `careerIndex`.
- `meta`: feed and scorecard versions, a stable snapshot fingerprint, the
  machine-readable product hierarchy and ranking contract, applied ordering,
  and explicit market-independence flags.

`meta.matchingMappedCount` is the number of matching records whose
`assessment.careerIndex.value` is non-null. It is not generic profile coverage or
five-year-impact-rank coverage.

Names are display fields, not identity keys. Never auto-merge two records only by
normalized player name. Use MLBAM first, another exact provider ID second, and the
durable BRef/Chadwick/MLBAM evidence overlay only when all three identifiers agree.
Unresolved or conflicting evidence stays separate for review.

## Legacy v4 Decision Semantics

V4 historically exposed “Backstop Rank” as a label over three route-specific
ordinals. New consumers must use the v1 labels below instead:

- **Minors:** `assessment.scores.outcome.rank`, the five-year MLB-impact rank.
- **Rookie Track:** `assessment.stageStanding.rank`, carrying the exact frozen
  pre-debut impact rank while current MLB evidence accumulates.
- **MLB:** `assessment.stageStanding.rank`, the active MLB Career Outlook standing.

For v4 compatibility, Rookie Track's `assessment.stageStanding.metric` retains
the legacy `prospect_career_outcome_rank` identifier. Its `target` plus
`meta.decisionHierarchy.backstopRank.routes.rookie.sourceMetric` are authoritative:
the carried rank is the frozen five-year impact rank, not the Career Outlook rank.

These ranks answer different questions against different universes. Do not compare
a prospect #20 with an MLB #20 as though they share one leaderboard. A null rank
means unavailable, never zero.

`assessment.scores.outcome.value` is the primary prospect score on the MiLB
route. Its exact contract and audit are defined in
[`PROSPECT_SCORE_V1.md`](./PROSPECT_SCORE_V1.md). `sort=prospectScore` orders by
the exact rank, not the rounded display value.

`assessment.careerIndex.value`, presented as **Career Outlook**, is the fixed
career-magnitude score. It is
the weighted P50/P75/P90 summary of the player's final-career WAR distribution
mapped onto frozen career-value anchors. It is not a probability, percentile,
confidence score, expected WAR, or investment-return estimate. The exact formula,
anchors, missing-value policy, and stage transitions are defined in
[`CAREER_INDEX_V1.md`](./CAREER_INDEX_V1.md).

`assessment.stageStanding` carries relative rarity separately. `topPercent` is
the player's rank divided by the declared universe, expressed as a percentage;
lower is better. `tailBand` is one of Top 0.1%, Top 1%, Top 5%, Top 10%, Top 25%,
or Outside top 25%. The frozen prospect census contains 6,455 records; 6,412 have
a supported career forecast and 43 are retained as explicit unscored coverage
cases. Prospect standing uses the 6,412-player supported rank universe, not the
changing number of active directory matches or the total artifact census. Rookie
Track carries that exact frozen supported-prospect standing until a completed-
season MLB forecast is available.
`scope=declared_model_cohort` means search, team, position, and active-stage
filters do not renumber it. Gaps such as prospect ranks #1, #4, and #5 are valid
when intervening frozen-cohort players have graduated to Rookie Track or are no
longer in the current result.

Current Results come from `currentEvidence.minorStats` in compact MiLB records.
Full records also expose current MLB observations through `metrics`; compact v4
does not yet publish a normalized MLB Current Results field. The hierarchy
contract declares that limitation as `compactMlbAvailability=not_normalized_in_v4`
instead of inviting consumers to infer missing results from forecast values.

The Directory union defaults to `stage=All&sort=name`; `sort=age` is also
available. Neither directory order is baseball standing. Career Index is the
only supported cross-stage score ordering, requested explicitly with
`stage=All&sort=careerIndex`. It does not create a shared rank target or universe.
Consumers must never compare `stageStanding` ranks across prospect, Rookie Track,
and MLB cohorts.

`assessment.oracleScore.value` remains available during migration. It is the old
rounded stage-specific outcome rank percentile. For example, a legacy value of 96
means the player ranked above approximately 96% of its declared route universe;
it does not mean 96% confidence. Do not relabel it as Career Index. A `null` value
in any score object means unavailable; it never means zero.

Every compact response includes the legacy `meta.decisionHierarchy` with version
`backstop-decision-hierarchy/v1`. Existing clients may use it during migration,
but new clients should read `signals.stageRank` from `player-signals.v1`, where
the label is Prospect Rank, Pre-Debut Rank, or MLB Career Rank. Career Outlook
and Current Results remain separate.

The older additive `meta.rankingContract` remains unchanged at
`player-ranking-contract/v1` for v4 compatibility. Its `careerIndex` primary
metric means the canonical **cross-route numeric sort**, not the first score a
person should read. It confirms that Career Index is comparable across routes,
restricts stage standing to within-stage comparison, and marks `oracleScore`
deprecated. The additive markers `scope=cross_route_numeric_sort` and
`productPrimary=false` make that boundary machine-readable;
`meta.decisionHierarchy` is authoritative for product display order.

The unparameterized `stage=Minors` API now defaults to `prospectScore`. Minors
responses include `meta.prospectScoreContract` (`prospect-score/v2`), which
declares the full and compact value, rank,
universe, target, status, and as-of field paths; the fixed 2026-2030 target
window; the 2025-12-31 feature cutoff; the exact percentile formula; comparison
scope; and research status. It also confirms that the score is neither a
calibrated probability nor blended with current-season evidence. V2 also declares
the transparent hierarchical prior used below the frozen workload threshold,
the `insufficient_sample` marker for those prior-led rows, and Career Index as the
separate age/runway guardrail. The historical `activation` and
`legacyDefaultSort` fields remain in v4 for compatibility and are explicitly
deprecated; use `defaultStage=Minors` and `defaultSort=prospectScore` for current
behavior. Consumers must validate the score-contract version and `meta.ordering`
before using its ordering semantics.

`meta.ordering.requestedSort` records the accepted query, while
`meta.ordering.appliedSort` resolves legacy `alphaOpportunity` requests to the
canonical `stageStanding` name and sets `legacyAliasUsed=true` in stage-specific
queries. Unsupported cross-stage competitive sorts, including the legacy alias
with `stage=All`, return HTTP 400 instead of silently falling back to name order.
`fieldExposed=false` means the selected internal metric controls row order but is
not present in that response view. A consumer should fail closed if the schema,
ranking-contract version, primary metric, ranking snapshot, or applied ordering
differs from what it supports. `meta.snapshotId` must be identical across every
page in one census pull; restart ingestion if it changes.

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
- Stage Rank, its published route label, exact rank, universe, target, and as-of date;
- Career Outlook (`careerIndex`) value, version, route, status, and as-of date;
- Current Results source, season, observation time, and workload where present;
- Prospect Score value, exact rank, universe, target, status, and as-of date for
  MiLB records;
- stage rank, universe, top-share percentage, tail band, cohort, and as-of date;
- legacy Oracle Score only where migration compatibility requires it;
- mapping and evidence state.

Backstop should calculate card opportunity independently. A useful first design is
to retain Stage Rank, Career Outlook, Current Results, readiness, trajectory,
and evidence as separate features, then combine them with market price percentile,
recent comparable sales, bid/ask depth, sell-through, population, card scarcity,
condition, and total transaction cost. Do not collapse the Oracle vector into an
unexplained talent number before testing which dimensions add out-of-sample
market value.

## Durable Feed Contract

`/api/v1/player-signals` is now the canonical normalized integration surface.
It publishes fixed external-ID keys, per-record SHA-256 versions, a signals
snapshot, route and lifecycle classification, numeric Current Results for MiLB
and MLB, and explicit signal availability. It honestly describes the current
Oracle profile ID as provider/model scoped until `core.player` UUID coverage is
complete.

The normative contract and migration guide live in
[`PLAYER_SIGNALS_API_V1.md`](./PLAYER_SIGNALS_API_V1.md). Remaining infrastructure
work for a later compatible version includes:

- cursor pagination bound to one immutable snapshot;
- a gzipped NDJSON census snapshot;
- monotonic changes with `upsert`, `inactive`, and `identity_redirect`;
- effective-dated core identity redirects;
- scoped server-to-server API keys.

The current endpoint emits a deterministic per-page `ETag`, honors weak or
strong `If-None-Match` validators, and includes a content-derived
`meta.snapshotId` with `snapshotScope=ranking_and_census`. The hosting layer may
surface the entity tag in weak form after transfer encoding. The fingerprint
hashes canonical player identity, every ranking input, forecast lineage, and
score-contract versions, so
it detects ranking or census drift during a paginated pull. It does not freeze
explanatory detail rows; immutable snapshot-bound cursors remain future work.

Breaking semantic changes require a new feed version. A Career Index delta is
comparable only when its index version, forecast route, target, and model version
are unchanged. A stage-standing delta also requires an unchanged cohort and
universe definition. `oracle-player-map/v1` consumers may read the legacy
`oracleScore` during migration, but new Backstop ingestion should bind to
`player-signals.v1`. The v4 route-specific “Backstop Rank” mapping is retained
only for compatibility; v1 names those ordinals Prospect Rank, Pre-Debut Rank,
and MLB Career Rank and reserves Backstop Rank for a future unified model.
Provider-derived fields should be included externally only when redistribution
rights cover the intended integration.

The current endpoint is intended for server-to-server use. It does not expose a
public browser CORS policy; browser products should call it through their own
server route.
