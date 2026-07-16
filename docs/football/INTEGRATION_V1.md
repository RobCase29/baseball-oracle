# Football Oracle integration v1

Status: live market beta
Route: `/football`
Parent product: Baseball Oracle

## Isolation boundary

Football Oracle is a second Vite HTML entry and bundle inside the existing
Baseball Oracle deployment. It does not share Baseball board state, filters,
data requests, model routes, or styles. Baseball links to the page with a normal
anchor; Football links back to `/`.

Future server routes and persistence remain under football-only namespaces:

```text
api/football/v1/*
data/football/*
modeling/football/*
```

## Player universes

The first page exposes two distinct same-position universes across QB, WR, RB,
and TE:

- `college`: active developmental candidates. Identity may be visible while
  model output is withheld pending a locked statistical feature feed and target.
- `nfl`: current professional players scored by the locked ordinal shadow
  baseline. Scores are research orderings, not calibrated probabilities.

The planned full lifecycle is:

```text
college -> draft_track -> rookie_track -> nfl
```

`expectedDraftYear` will remain separate from actual `entryClass`; underclassmen
must not be forced into a known draft class.

## Standout and market-divergence policy

The page distinguishes three concepts:

- **Oracle leader:** a high position-specific internal research rank.
- **Market divergence:** Oracle position rank materially exceeds a same-position
  external rank in the same lifecycle and fantasy format.
- **Dynasty edge:** a future, validated translation from expected production to
  above-replacement fantasy utility. v1 does not make this claim.

The page automatically requests normalized market rows from:

```text
GET /api/football/v1/market-rankings?universe=college|nfl&format=<exact KTC format>
```

KTC Devy and Dynasty rows retain one of eight exact 12-team, half-PPR format
identities: 1QB or Superflex crossed with no TEP, TE+, TE++, or TE+++. Dynasty
Daddy market 14 is a separate provider-default 1QB/Superflex directional lens;
it is displayed beside KTC but is not relabeled as an exact KTC format and is
not included in the exact-format consensus.

The optional browser import accepts only rights-attested, licensed or
self-authored rows:

```text
name,universe,position,source,format_id,position_rank,position_universe_size,as_of,rights_attested
```

Known KTC and Dynasty Daddy aliases are reserved for the verified automatic
feeds. Exact comparisons convert each source rank to a within-source position
percentile using its source universe size. The exact-format consensus is the
median eligible source percentile. A positive display gap means Oracle
percentile minus market percentile is positive. Imported data is session-local
and is not uploaded or persisted.

KTC states that Devy and Dynasty values use different scales. Raw values are
therefore never compared across college and NFL routes.

## Authorized source posture

- The project owner attested direct permission from KTC and Dynasty Daddy after
  the intended retrieval, caching, attributed display, and derived-comparison
  uses were stated. The evidence boundary is recorded in
  `docs/permissions/FOOTBALL_MARKET_SOURCE_ATTESTATION.md`.
- [KTC Dynasty](https://keeptradecut.com/dynasty-rankings) and
  [KTC Devy](https://keeptradecut.com/devy-rankings) are retrieved directly on
  the server. Their embedded JSON is bounded, balanced-scanned, parsed without
  executing page JavaScript, normalized, and schema-validated.
- [Dynasty Daddy](https://dynasty-daddy.com/fantasy-rankings) first-party market
  14 is retrieved directly and kept source-defined. ADP Daddy, Redraft Daddy,
  KTC-via-Dynasty-Daddy, and every other embedded market remain excluded.
- [CollegeFootballData](https://collegefootballdata.com/api-tiers) provides an
  official player-statistics API and recommends Tier 3+ for app builders. It is
  a college feature-source candidate once its terms are reviewed and an
  appropriate key and tier are configured.

The server response exposes normalized comparison fields only, never the raw
provider payload. Requests are bounded, time-limited, and cached for 15 minutes
with one hour of stale-while-revalidate. Each provider fails independently, so
the UI can report a partial snapshot without silently substituting another
market. `data/football/source-registry.json` is the machine-readable rights
gate, and market readings remain comparison signals rather than model-training
features.
