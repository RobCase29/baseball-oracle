# Hobby Oracle Master Ranking v2

## Purpose

Hobby Oracle Master Ranking v2 creates one observed-universe order across the
permissioned GemRate athlete and Pokémon subject rows. It fixes the central v1
failure: a subject no longer becomes a cross-hobby Build merely because it is
near the top of a small provider cohort.

The public route is:

```http
GET /api/v2/hobby-oracle
```

The contract and model versions are:

```text
schemaVersion   = hobby-oracle-master-ranking.v2
contractVersion = hobby-oracle-master-ranking-contract/v2
modelVersion    = hobby-oracle-absolute-demand-durability/18m-v2.0.0
```

The original `/api/v1/hobby-oracle` and `/api/v1/magnificent-x` contracts remain
frozen. They continue to expose only within-cohort research signals.

## Evidence universe

The v2 rank uses the same reconciled 18 complete monthly observations documented
in [Magnificent X v1](MAGNIFICENT_X_V1.md). A row is master-rank eligible only
when:

- its provider taxonomy is a coherent cohort;
- the cohort contains at least 100 subjects; and
- its normalized name is not ambiguous inside that cohort.

The current snapshot contains 6,022 source rows and 5,866 rank-eligible rows.
Master rank is computed once over that complete eligible universe before search,
cohort, posture, sorting, or pagination filters. Filtering to football can
therefore begin at master rank 13 rather than manufacturing a new number one.

This is an observed-snapshot comparison, not a canonical hobby census. Provider
export caps, source-name identity, and incomplete cross-provider identity work
remain explicit limitations.

## Absolute demand magnitude

Dollar magnitude enters the score directly. A fixed log scale prevents a
$1 million cohort leader from looking equivalent to a $100 million subject.
The anchors are locked to this model version:

```text
floor   = $100,000
ceiling = $250,000,000

Magnitude(v) =
  100 × clamp(
    ln(v / floor) / ln(ceiling / floor),
    0,
    1
  )
```

The demand-magnitude component is a geometric blend:

```text
Demand Magnitude =
  geometric mean(
    75% × TTM Magnitude,
    25% × annualized-current-6M Magnitude
  )
```

Fixed anchors mean a cohort's size or strength cannot give its leader a free
scale advantage.

## Durability

Persistence and shock resistance retain the audited v1 definitions.

```text
Persistence =
  50% × positive-month ratio
+ 30% × observed-month completeness
+ 20% × lower-quartile / median monthly demand
```

Shock resistance converts the latest-12-month sales-share HHI onto a 0-100
scale. Even monthly demand approaches 100; one-month concentration approaches
zero.

Trend is downside-only:

```text
Downside Protection =
  clamp(
    100 + 50 × 6M YoY log growth / ln(2),
    50,
    100
  )
```

Flat and positive growth both receive 100. Positive momentum never adds score.
It may only clear the separate escape-velocity route after absolute demand and
durability thresholds already pass.

```text
Durability =
  geometric mean(
    45% × Persistence,
    35% × Shock Resistance,
    20% × Downside Protection
  )
```

## Master score and sensitivity

```text
Master Score =
  geometric mean(
    72% × Demand Magnitude,
    28% × Durability
  )
```

Two companion scenarios use 82/18 demand-heavy and 60/40 durability-heavy
weights. The API publishes all three scores and their worst value. The order is
descending balanced Master Score, then TTM demand, domain, and subject name.
Cohort rank remains secondary context and never affects Master Score or Build.

## Build qualification

`Build` means a subject-level candidate for exact-card underwriting. It is not a
buy instruction, expected-return forecast, or claim that every card for the
subject will appreciate.

Every Build must pass these common checks:

1. observed-universe comparison eligibility;
2. current monthly source snapshot;
3. all 18 history months;
4. observed global TTM-demand percentile of at least 99;
5. persistence of at least 90;
6. shock resistance of at least 90;
7. downside protection of at least 90; and
8. one absolute Build route.

The durable-scale route requires:

```text
TTM demand                 >= $20,000,000
annualized current 6M      >= $15,000,000
Master Score               >= 75
```

The escape-velocity route is deliberately narrow:

```text
TTM demand                 >= $15,000,000
annualized current 6M      >= $20,000,000
Master Score               >= 70
current 6M / prior-year 6M >= 2.5×
recent 3M / prior-year 3M  >= 2.0×
```

No sport receives a Build quota. A sport may have zero Builds.

At the current snapshot, the v1 cohort-relative screen's 112 Build candidates
become 23 v2 Build candidates:

| Cohort | Builds |
| --- | ---: |
| Pokémon | 9 |
| Basketball | 6 |
| Baseball | 4 |
| Football | 3 |
| Soccer | 1 |
| Combat | 0 |
| Hockey | 0 |
| Golf | 0 |
| Mixed / other sport | 0 |
| Culture | 0 |

The first five master ranks are Charizard, Pikachu, Shohei Ohtani, Michael
Jordan, and Victor Wembanyama. Conor McGregor remains useful combat-cohort
context but no longer qualifies as a cross-hobby Build.

## Withheld evidence

The model still lacks exact-card identity, grade, population growth, reprint or
dilution evidence, transaction-level liquidity, entry price, cost basis, and
validated future-return outcomes. Pokémon rows are character demand, not a
set/card/language recommendation. Athlete rows are subject demand, not a rookie
card or autograph recommendation.

The UI therefore keeps exact-card action withheld even when the subject earns a
Build research label.
