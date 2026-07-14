# Player Signals API v1

Status: public research contract

Endpoint:

```text
GET /api/v1/player-signals
```

The Player Signals API is the canonical downstream integration surface for
Baseball Oracle. It gives every player the same identity, classification, and
three-signal structure without asking a client to resolve route-specific paths.
The existing `/api/players?view=map` v4 feed remains available for compatibility.

## Request

The endpoint accepts the current player-directory filters:

```text
q, ids, stage, playerType, level, team, position, sort, page, limit
```

Examples:

```text
GET /api/v1/player-signals?stage=Minors&sort=prospectScore&page=1&limit=50
GET /api/v1/player-signals?stage=RC&sort=stageStanding&page=1&limit=50
GET /api/v1/player-signals?ids=mlbam:691176:hitter
```

`stage=All` is a directory and defaults to name order. Stage-rank sorting is
valid only within a declared stage. The response currently uses page-number
pagination and declares `paginationConsistency=page_number_not_snapshot_bound`.
Consumers performing a full census should restart when the snapshot ID changes.

## Response

```json
{
  "schemaVersion": "player-signals.v1",
  "contractVersion": "player-signals-contract/v1",
  "snapshot": {
    "id": "player-signals-snapshot/v1:<sha256>",
    "dataAsOf": "2026-07-13T22:19:18.402Z",
    "freshness": {}
  },
  "items": [],
  "page": {},
  "meta": {}
}
```

Each item contains:

```text
player
classification
transition
signals.backstopRank
signals.stageRank
signals.careerOutlook
signals.currentResults
```

`recordVersion` is a SHA-256 digest of the normalized record. The response also
returns an ETag and `X-Snapshot-Id`. A null value always means unavailable; it
never means zero.

## Rank Policy

There is not yet a scientifically valid universal Backstop Rank. The currently
available ranks use different targets:

| Route | Published label | Target |
| --- | --- | --- |
| Minors | Prospect Rank | At least 5 MLB WAR during the frozen five-year window |
| Rookie Track | Pre-Debut Rank | The exact frozen prospect-impact rank carried through the first partial MLB season |
| MLB | MLB Career Rank | Current MLB terminal-career outlook standing |

Therefore:

- `signals.backstopRank` is always explicitly withheld with reason
  `unified_unconditional_model_not_released`.
- `signals.stageRank` contains the available route-specific rank.
- Stage ranks are never comparable across stages.
- A ranked thin-sample prior uses `availability=insufficient_sample` and retains
  its numeric rank; it is not presented as fully supported evidence.

Backstop Rank is reserved for a future single, validated, unconditional
terminal-career model over all active players. The API will not manufacture that
rank by averaging incompatible signals.

## Career Outlook

Career Outlook is the fixed 0-100 career-value scale from final-career WAR
quantiles. The response publishes its plain-language band and P50/P75/P90 WAR
values when supported.

- Prospect and Rookie Track outlooks are conditional on reaching MLB.
- MLB outlooks are current terminal-career projections.
- The numerical scale is shared, but the estimands are not identical.
- Career Outlook is not a probability, percentile, confidence score, or rank.

These distinctions are machine-readable through
`scaleComparableAcrossStages=true` and
`estimandComparableAcrossStages=false`.

## Current Results

Current Results are normalized numeric observations, not formatted display
strings and not another score.

MiLB records include official MLB StatsAPI season totals such as PA, slash line,
home runs, stolen bases, innings, ERA, WHIP, and rate statistics. Rookie Track
and MLB records include Baseball-Reference workload and WAR evidence. Two-way
players are ranked on the hitter route while retaining both hitting and pitching
results.

When the relevant source snapshot is stale, an otherwise present Current Results
object uses `availability=stale` with `source_snapshot_stale`. Consumers should
also enforce the response-level freshness state before making downstream updates.

Pitching innings are derived from authoritative outs. Baseball notation such as
`12.2 IP` is never parsed as the decimal number `12.2`.

## Stage Transitions

Rookie Track is a lifecycle state, not a third universal rank.

1. The exact pre-debut impact rank is preserved with `carriedForward=true`.
2. Live MLB Current Results accumulate separately.
3. The prospect Career Outlook remains the prior during the partial debut season.
4. A supported completed-season MLB forecast changes the route, metric ID, and
   stage rank together.

The old and new ordinal are never represented as movement inside the same rank.

## Identity

`player.id` is the current Oracle profile/model record identifier. It is not
described as a core canonical UUID. `identityStatus=mlbam_linked` means an exact
MLBAM join is present; `profile_only` means the record remains provider-scoped.

External identifiers are normalized to four fixed keys:

```text
mlbam, baseballReference, prospectSavant, minorMaster
```

Use MLBAM as the preferred cross-product join when present. Never merge players
by normalized display name alone.

## Freshness And Caching

The snapshot publishes source freshness, reason codes, the latest observed data
time, the last refresh check, the next scheduled refresh, and cron proof. The
endpoint supports GET, HEAD, ETag, and `If-None-Match`.

The signals snapshot is versioned separately from the v4 ranking snapshot and
hashes the complete normalized MiLB and MLB result census in addition to source
timestamps, model lineage, and the material freshness state. Clients should store
both `snapshot.id` and each item's `recordVersion`.

## Backstop Cards

Baseball Oracle deliberately excludes card-market inputs. A consuming card app
should persist these baseball signals and build a separate Opportunity Rank from
price, scarcity, liquidity, grading population, fees, and demand.

Do not label a stage rank as investment return, and do not average Stage Rank,
Career Outlook, and Current Results into an unexplained composite.

## v4 Migration

| v4 field | Player Signals v1 |
| --- | --- |
| Route-specific paths under `assessment` | `signals.stageRank` |
| `assessment.careerIndex` | `signals.careerOutlook` |
| `currentEvidence.minorStats` | `signals.currentResults` |
| Full-response MLB `metrics` display strings | Numeric `signals.currentResults` |
| `meta.decisionHierarchy` path map | Direct first-class signal objects |

The normative JSON Schema is published at
`/schemas/player-signals.v1.schema.json`.
