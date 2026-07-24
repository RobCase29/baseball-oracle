# Hobby Oracle Player Rankings v1

## Decision supported

Player Rankings v1 answers a narrow question:

> Which active football or basketball players have both a strong long-horizon
> player outlook and durable collector demand?

The score is a **collection-thesis screen**, not a forecast of card returns.
GemRate measures completed eBay singles sales dollars at the player level. It
does not provide exact-card prices, transaction counts, population growth,
spreads, fees, or time-to-sale. Those missing inputs prevent an honest expected
appreciation or buy-price claim.

## Evidence boundary

The initial ranked universe requires an unambiguous, same-sport,
normalized-name intersection between:

- GemRate's 18-month athlete sales history; and
- KeepTradeCut's NFL dynasty ranks, or Hashtag Basketball's five-season and
  keeper ranks.

Joins are exact and unique after normalization. Fuzzy matches, duplicate names,
missing age, incomplete provider ranks, stale snapshots, and source-schema
changes fail closed. Provider IDs and source spellings remain attached to every
row. A normalized name is a reviewable bridge, not a universal athlete ID.

Ranks are published **within sport only**. Football and basketball providers
use different scoring systems and forecast semantics, so a combined ordinal
would create false precision.

## Player outlook

Every provider rank is converted to an empirical midrank percentile within its
captured format cohort, where 100 is strongest and tied ranks share their
average percentile. Superflex and one-QB ranks are normalized independently;
so are five-season and keeper ranks. This avoids pretending that the primary
list's declared universe is also the universe of a supplemental rank whose
values extend beyond that list.

Football weakens single-format distortion:

```text
P1 = KTC 1QB overall-rank percentile
PS = KTC Superflex overall-rank percentile

Player Outlook =
  0.60 × min(P1, PS)
  + 0.40 × sqrt(P1 × PS)
```

Basketball emphasizes the explicitly five-season view while retaining keeper
consensus:

```text
P5 = Hashtag five-season overall-rank percentile
PK = Hashtag keeper-rank percentile

Player Outlook =
  0.75 × P5
  + 0.25 × PK
```

Age is required, displayed, and filterable. It does not add points: both
dynasty sources already incorporate career runway, so another youth bonus
would double-count prospect enthusiasm. An age screen receives a new
screen-relative rank while retaining the immutable rank for the full sport.

## Demand durability

Trailing-12-month sales dollars are converted to a midrank percentile within
the complete GemRate sport cohort.

Sales resilience rewards recurring observations and a durable monthly floor:

```text
Sales Resilience =
  100 × (
    0.50 × positive-month ratio
    + 0.30 × observed-history ratio
    + 0.20 × lower-quartile volume / median volume
  )
```

Market durability is deliberately dominated by scale and resilience:

```text
Market Durability =
  0.70 × trailing-12 demand percentile
  + 0.25 × Sales Resilience
  + 0.05 × clipped long-trend context
```

Trend is clipped to a narrow 35–65 range and capped at neutral (50) when it
enters Market Durability. Deterioration can reduce the score; positive
short-term momentum cannot add points or create a high-conviction player.

## Build Score

The score uses a weak-link/geometric blend so neither fantasy enthusiasm nor
collector enthusiasm can carry the result:

```text
Hype Penalty =
  min(
    12,
    0.25 × max(0, demand percentile − Player Outlook − 15)
    + 0.10 × max(0, acceleration context − 80)
  )

Build Score =
  0.60 × min(Player Outlook, Market Durability)
  + 0.40 × sqrt(Player Outlook × Market Durability)
  − Hype Penalty
```

The published score is bounded to 0–100.

## Action gates

A numeric score alone cannot produce the strongest label. `Build` means
**Build candidate for further card-level research**, not a portfolio action or
buy recommendation. It additionally requires:

- Build Score of at least 82;
- Player Outlook of at least 80;
- Market Durability of at least 75;
- trailing-12 demand percentile of at least 65;
- Sales Resilience of at least 70;
- Hype Penalty below 4;
- top-five-percent placement within the sport;
- all required source snapshots current;
- complete 18-month market history;
- a unique provider-to-GemRate identity bridge;
- explicit review of that identity pair; and
- top-decile placement under conservative outlook-heavy, balanced, and
  market-heavy sensitivity variants.

Rows that do not clear every gate can remain useful as `Hold`, `Watch`, or
`Deprioritize` research, but they do not inherit a Build label. Missing or stale
required evidence is unranked rather than filled with a neutral score. A
top-five-percent row blocked only by manual identity review is shown as
`Review pending` in the workbench and remains `Watch` in the API.

## Freshness and refresh contract

The API recomputes freshness on every uncached request. GemRate follows its
monthly publication deadline, KeepTradeCut must have been captured within the
last 14 days, and Hashtag Basketball must remain within 45 days of its stated
source update. If either the market or sport-fundamentals deadline expires, the
affected sport publishes zero ranked rows and returns an explicit
`ranking_publication_suspended` reason.

Checklist.BackstopCards.com owns source acquisition and exports the attributed,
hashed player-signal exchange. Hobby Oracle verifies that content hash and
source contract before importing it, then owns identity review, scoring,
ranking, filtering, and publication.

## Evidence kept outside the score

- Topps checklist appearances, rookie labels, and autograph sections describe
  collectible product exposure. More appearances can also mean more supply, so
  they do not boost player quality.
- Fanatics Live break asks describe a current release entry. They are not
  completed card sales and do not alter the durable player thesis.
- Retired icons require a separate Durable Demand lane. Applying active-player
  fantasy ranks would wrongly exclude or penalize them.

## Validation still required for an investment-return model

The future target should be a predefined canonical-card basket's five-year net
excess return versus its sport benchmark. Validation must retain illiquid and
delisted cards, include spreads, fees, and population growth, use rolling-origin
holdouts, and report top-decile lift with athlete-clustered uncertainty.

Until those outcome labels exist, Hobby Oracle intentionally publishes a
transparent durable-growth research rank instead of claiming expected return.
