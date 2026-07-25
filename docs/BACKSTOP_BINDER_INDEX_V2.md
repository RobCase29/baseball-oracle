# Backstop Binder Index v2

## Purpose

Backstop Binder Index v2 puts baseball, football, and basketball on one
Graduation Board. It answers a narrow research question:

> Which active players are closest to earning the same absolute Master Build
> designation?

The board is a prioritization screen. It is not an expected-return model, a
recommendation to buy or sell, an exact-card valuation, or a calibrated
probability.

## Endpoint and contract

```text
GET /api/v2/backstop-binder-index

schemaVersion   = backstop-binder-index.v2
contractVersion = backstop-binder-index-contract/v2
modelVersion    = binder-graduation-readiness/master-build-v2.1.0
recordVersion   = backstop-binder-graduation-item/v2
```

JSON Schema:
`/schemas/backstop-binder-index.v2.schema.json`

The v1 endpoint remains frozen for football and basketball consumers.

Supported filters:

```text
sport   = all | baseball | football | basketball
maxAge  = 15..60
position
band    = all | graduated | on_deck | approaching
          | developing | long_range | withheld
sort    = graduation_rank | graduation_index | market_readiness
          | player_outlook | ttm_sales | current_run_rate | age | name
q
page
limit
```

## One global order

The global rank is assigned before sport, age, position, readiness-band, search,
or pagination filters. Selecting Baseball therefore preserves a player's
global rank; it cannot manufacture a new baseball number one.

There are no sport quotas, balancing weights, or guaranteed representatives.
A sport can dominate the board if its players clear more of the same absolute
standard.

## Sport-specific player evidence

The player-outlook input is deliberately sport-specific:

- Baseball: Career Index, route-outcome standing, and development runway from
  Career Oracle.
- Football: KeepTradeCut dynasty-market outlook.
- Basketball: Hashtag Basketball dynasty/keeper outlook.

These inputs are not claimed to be semantically identical. They measure the
best available long-horizon player outlook within each sport. The response
publishes the basis, model label, and age treatment on every row.

All three sports then face one shared market path:

- the same 18-month GemRate subject history;
- the same absolute TTM and current-run-rate thresholds;
- the same global observed P99 demand gate;
- the same persistence, shock-resistance, and downside-protection gates; and
- the same Master Build target and persistence rule.

## Graduation Index

The market-path calculation is unchanged from v1:

```text
market path readiness
  = geometric blend(
      best(durable-scale route, escape-velocity route),
      common durability gates
    )
```

The final score remains a weak-link construction:

```text
Graduation Index
  = 60% × min(player outlook, market path readiness)
  + 40% × geometric mean(player outlook, market path readiness)
```

A great player outlook cannot carry a small or fragile collector market, and a
large collector market cannot carry a weak player outlook.

## Baseball identity and evidence controls

Baseball candidates require:

- an MLBAM identity in Career Oracle;
- a unique Oracle display name inside the candidate universe;
- one unique, non-ambiguous GemRate baseball athlete match;
- plausible grading-year chronology;
- complete Career Index and route-outcome components; and
- current Career Oracle and Master Build source snapshots.

The production endpoint also requires the live prospect directory. If that
directory is missing or empty, v2 returns `503` instead of publishing a partial
global order.

## Age

Age is always a filter and never causes a filtered rerank.

Football and basketball dynasty outlooks already price development runway.
Baseball's Career Oracle outlook explicitly embeds its route-specific
development-runway component. The row-level `ageTreatment` field makes this
difference visible.

## Probability remains withheld

Every row continues to publish:

```json
{
  "probability": null,
  "probabilityStatus": "withheld_no_longitudinal_build_transitions"
}
```

A numerical probability remains blocked until at least 100 observed durable
Master Build transitions and a prospective holdout exist. Durable graduation
means entering Build and remaining there in at least two of the next three
monthly snapshots.
