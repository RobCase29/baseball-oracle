# Football Oracle integration v1

Status: research preview
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

The browser import accepts only rights-attested, licensed or self-authored rows:

```text
name,universe,position,source,format_id,position_rank,position_universe_size,as_of,rights_attested
```

Known KTC and Dynasty Daddy aliases are rejected while their registry states are
blocked or pending. Comparisons require an exact `format_id`, then convert each
source rank to a within-source position percentile using its declared
`position_universe_size`. The market consensus is the median source percentile.
A positive display gap means Oracle percentile minus market percentile is
positive. Imported data is session-local and is not uploaded or persisted.

KTC states that Devy and Dynasty values use different scales. Raw values are
therefore never compared across college and NFL routes.

## External source posture

- [KTC FAQ](https://keeptradecut.com/frequently-asked-questions) says no API or
  CSV exists and prohibits scraping or reproducing full values in tools.
- [KTC Terms](https://keeptradecut.com/terms-and-conditions) prohibit automated
  extraction, derivative use, redistribution, and use on another website.
- [Dynasty Daddy](https://dynasty-daddy.com/fantasy-rankings) displays pro
  markets and download/upload controls but publishes no supported reuse API or
  downstream data license. It remains fail-closed pending written permission.
- [CollegeFootballData](https://collegefootballdata.com/api-tiers) provides an
  official player-statistics API and recommends Tier 3+ for app builders. It is
  a college feature-source candidate once its terms are reviewed and an
  appropriate key and tier are configured.

The page links to live market boards but does not automatically retrieve or
republish them. `data/football/source-registry.json` is the machine-readable
gate for future adapters.
