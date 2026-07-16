# Community Signals API v1

Status: public external-comparison contract

Endpoint:

```text
GET /api/v1/community-signals?ids=<comma-separated player identifiers>
```

This endpoint publishes attributed HarryKnowsBall dynasty sentiment alongside
Baseball Oracle players. The product label is **Dynasty Score**. The data is an
external crowd signal and is never an input to Oracle forecasts or ranks.

The normative JSON Schema is available at
`/schemas/community-signals.v1.schema.json`.

## Request

`ids` is required and accepts one to 100 unique identifiers. Prefer exact MLBAM
IDs from `player.externalIds.mlbam` in the Player Signals API:

```text
GET /api/v1/community-signals?ids=660271,691176
```

The forms `mlbam:660271` and route-qualified IDs such as
`mlbam:660271:hitter` are also normalized to the exact MLBAM identity. This
allows a board to request its visible 50 players plus a separately selected
player in one call.

Unsupported parameter names, duplicate `ids` parameters, empty IDs, and more
than 100 IDs return `400`. Valid IDs without an exact
HarryKnowsBall-to-MLBAM link do not fail the batch: they appear in
`meta.unmatchedIds` and do not produce an item.

Names are never used to join players.

## Response

```json
{
  "schemaVersion": "community-signals.v1",
  "contractVersion": "community-signals-contract/v1",
  "snapshot": {
    "id": "community-signals-snapshot/v1:<sha256>",
    "observedAt": "2026-07-16T17:00:00.000Z",
    "sourceUpdatedAt": "2026-07-16T16:56:45.455Z"
  },
  "items": [
    {
      "recordVersion": "sha256:<digest>",
      "player": {
        "oracleId": "mlbam:660271",
        "mlbamId": "660271",
        "hkbId": "<provider-id>",
        "name": "Shohei Ohtani"
      },
      "dynastyScore": {
        "label": "Dynasty Score",
        "value": 10000,
        "signalStatus": "ranked",
        "overallRank": 1,
        "overallUniverse": 1744,
        "prospectRank": null,
        "prospectUniverse": 728,
        "movement": {
          "rank7d": 1,
          "rank30d": 2,
          "value7d": 35,
          "value30d": 80
        },
        "attention": {
          "views30d": 120,
          "rank30d": 2,
          "prospectViews30d": null,
          "prospectRank30d": null
        },
        "history": {
          "rank30d": [2, 1, 1],
          "value30d": [9950, 9980, 10000]
        }
      },
      "source": {
        "name": "HarryKnowsBall",
        "url": "https://harryknowsball.com/rankings",
        "capturedAt": "2026-07-16T17:00:00.000Z",
        "updatedAt": "2026-07-16T16:56:45.455Z"
      }
    }
  ],
  "meta": {
    "excludedFromOracleModel": true,
    "nullMeans": "unavailable_not_zero",
    "nullMeansUnavailableNotZero": true,
    "identityPolicy": "exact_mlbam_join_no_name_matching",
    "signalType": "crowdsourced_dynasty_sentiment",
    "requestedIds": ["660271"],
    "unmatchedIds": []
  }
}
```

The response preserves request order. Semantically duplicate forms such as
`660271,mlbam:660271` are rejected instead of returning an ambiguous batch.

## Dynasty Score

Dynasty Score is HarryKnowsBall's raw dynasty value on a 10–10,000 scale. It is
not a probability, confidence level, Oracle rank, projected WAR, or investment
return.

HarryKnowsBall assigns an inactive or not-yet-established player its default
value of 10. Those rows publish `signalStatus=default_floor`. Consumers must not
treat the associated tied ordinal as precise evidence. Values above 10 publish
`signalStatus=ranked`.

Overall rank and prospect rank are provider cohorts. The HarryKnowsBall prospect
flag or prospect rank never changes Oracle's Minors, Rookie Track, or MLB route.

## Movement And Attention

Positive `rank7d` and `rank30d` values mean the player moved toward rank number
one over that interval; negative values mean the player fell. Value changes use
the same signed convention for gains and losses in Dynasty Score.

Attention is sourced from HarryKnowsBall's most-viewed lists. Absence from a
finite most-viewed list is represented as `null`, not zero views. Overall and
prospect attention remain separate because their source cohorts differ.

History arrays are the provider's ordered daily observations for the trailing
30-day display window. Leading null entries are retained for days before a newly
listed player had an observation. A missing or malformed history is `null`; it
is never fabricated from the current value.

## Identity And Coverage

Only rows with an exact MLBAM link are served. The crosswalk is learned from the
provider-published MLB ID on an individual player page and is fail-closed if an
HKB identity ever changes its MLBAM association. Display names are retained for
audit and presentation only.

Until the exact-identity backfill reaches every HarryKnowsBall player, a valid
MLBAM ID can be listed in `meta.unmatchedIds`. That means external comparison is
unavailable, not that Dynasty Score is zero.

## Independence From Oracle

The response declares:

```text
excludedFromOracleModel=true
signalType=crowdsourced_dynasty_sentiment
```

`/api/v1/player-signals` remains unchanged and market-independent. Consumers may
compare Dynasty Score with Oracle output in their own presentation layer, but
must not relabel the crowd score as a forecast or silently blend it into Career
Outlook, Prospect Rank, or MLB Career Rank.

## Freshness And Caching

`source.updatedAt` is the update timestamp published with the rankings page.
`source.capturedAt` is when Oracle retained the complete atomic capture.
`snapshot.observedAt` is the latest capture time among returned items.

A capture is eligible only when rankings, overall most-viewed, and prospect
most-viewed payloads all land successfully under the same capture ID. A partial
refresh never replaces the current comparison snapshot.

The endpoint supports GET, HEAD, ETag, `If-None-Match`, and a five-minute shared
cache with stale-while-revalidate. Store both `snapshot.id` and each item's
`recordVersion` when maintaining downstream history.
