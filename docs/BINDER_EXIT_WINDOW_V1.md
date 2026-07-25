# Binder Exit Window v1

## Purpose

Binder Exit Window creates a liquidation-research queue for subjects whose
markets still show meaningful active demand while their longer-horizon
durability evidence is weakening.

It does not identify the “worst” subjects. A dead market cannot rank highly
because the model requires current resale heat. A hot, durable market cannot
rank highly because the model also requires measurable decline.

The printable board is:

```text
/hobby?view=exit100
```

The model version is:

```text
binder-exit-window/18m-v1.0.0
```

## Eligibility screen

Every Exit 100 subject must have:

1. a current GemRate snapshot and all 18 observed months;
2. an eligible coherent-cohort identity;
3. neither a Master Build nor Hold posture;
4. observed TTM demand at or above the global 85th percentile;
5. annualized current-six-month sales of at least $250,000;
6. monthly persistence of at least 80; and
7. a current-six-month year-over-year decline of at least 10%.

The current permissioned snapshot has 109 subjects clearing every screen. The
board publishes the highest-scoring 100 with no sport or Pokémon quota.

## Resale heat

Resale Heat is a subject-level active-demand proxy:

```text
Resale Heat =
  geometric mean(
    50% × current-run-rate magnitude,
    20% × TTM magnitude,
    18% × monthly persistence,
    12% × shock resistance
  )
```

The fixed magnitude scale is inherited from Master Ranking v2. Persistence
prevents a single hot month from standing in for an active market, while shock
resistance penalizes highly concentrated demand.

## Decline pressure

Six-month decline severity maps a 10% decline to zero incremental severity and
a decline of 50% or more to 100. Recent-three-month severity maps no decline to
zero and a 50% decline to 100. Downside fragility is twice the gap between 100
and the Master Ranking downside-protection score, capped at 100.

```text
Decline Pressure =
  55% × six-month decline severity
+ 25% × recent-three-month decline severity
+ 20% × downside fragility
```

The recent-three-month component distinguishes a market whose decline may be
stabilizing from one whose deterioration is still accelerating.

## Exit Window score

```text
Exit Window =
  65% × min(Resale Heat, Decline Pressure)
+ 35% × sqrt(Resale Heat × Decline Pressure)
```

The weak-link construction forces both sides of the thesis to be present. The
score is a deterministic prioritization tool, not a probability of sale,
expected return, or forecast of future price.

The Master Ranking endpoint supports `sort=exit_window`; descending order
places eligible Exit Window subjects first. The existing response contract
remains unchanged, and investment advice and exact-card recommendations remain
explicitly unavailable.

## Research boundary

GemRate provides subject-level completed eBay singles sales dollars. It does
not provide exact-card bids, bid/ask spread, transaction count, time-to-sale,
grade, population, population growth, cost basis, fees, taxes, or the user’s
position size.

“Resale heat” therefore cannot guarantee that a particular card is liquid.
Exit 100 is a queue for card-level and position-level underwriting—not an
instruction to sell.
