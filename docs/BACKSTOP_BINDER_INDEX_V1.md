# Backstop Binder Index v1

## Purpose

Backstop Binder Index v1 ranks active football and basketball players by their
current readiness to reach the Hobby Oracle Master Build board. It is a
transparent research-prioritization screen for the question:

> Which active players have the strongest current combination of player outlook
> and measurable progress toward the absolute demand and durability requirements
> of Master Build v2?

The public route is:

```http
GET /api/v1/backstop-binder-index
```

The public contract and model versions are:

```text
schemaVersion   = backstop-binder-index.v1
contractVersion = backstop-binder-index-contract/v1
modelVersion    = binder-graduation-readiness/master-build-v2.0.0
recordVersion   = backstop-binder-graduation-item/v1
horizonMonths   = 24
```

The 24-month horizon defines the intended future observation window. It is not
evidence that the Index has been validated over 24 months. No longitudinal
Master Build transition history or prospective holdout currently exists.

## The Index is not a probability

The Graduation Index is a deterministic 0–100 readiness index. It measures
proximity to the current target and support from the current player outlook. It
does not estimate the chance that a player will graduate.

An Index of `85` must be read as an `85 / 100 readiness index`, never as an 85%
probability. The API enforces that distinction:

```text
probability       = null
probabilityStatus = withheld_no_longitudinal_build_transitions
```

Response metadata also declares:

```text
probabilityAvailable = false
probabilityReason =
  no_longitudinal_master_build_transitions_or_prospective_holdout
```

The Index is not an expected card return, appreciation probability, Hall of
Fame probability, investment-confidence percentage, price target, or buy/sell
instruction.

## Candidate universe

The candidate universe is the identity-safe intersection of:

- the current Hobby Oracle football and basketball player-ranking catalogs; and
- the matching subject rows in Hobby Oracle Master Ranking v2.

The Index does not currently rank baseball, hockey, soccer, combat, golf, or
Pokémon candidates. Its phrase `global rank` means one order across the complete
eligible football-and-basketball player catalog, not an order across every
subject in the 6,022-row GemRate snapshot.

The Master Build target remains global across all eligible Hobby Oracle
subjects. In particular, the observed global P99 demand floor used by the Index
is calculated from every rank-eligible Master Ranking v2 row, not separately
inside football or basketball.

## Exact graduation target

The target designation is the `Build` result from:

```text
schemaVersion   = hobby-oracle-master-ranking.v2
contractVersion = hobby-oracle-master-ranking-contract/v2
modelVersion    = hobby-oracle-absolute-demand-durability/18m-v2.0.0
```

The Index does not target the older baseball Binder Score `build` action or the
within-sport Player Rankings v2 `Build` posture. Those are different research
constructs and cannot be used interchangeably as outcome labels.

For eventual longitudinal calibration, durable graduation is defined as:

```text
enter Master Build and remain Build in two of three monthly snapshots
```

The future event must occur within 24 months of the feature snapshot. A
publishable player who is already a current Master Build is displayed as
`graduated`, with Index `100`, but that current state is not counted as an
observed historical transition. The current transition count remains zero.

## Master Build v2 requirements

Master Build v2 first requires every common gate:

1. observed-universe comparison eligibility;
2. a current source snapshot;
3. all 18 history months;
4. observed global TTM-demand percentile of at least 99;
5. persistence of at least 90;
6. shock resistance of at least 90;
7. downside protection of at least 90; and
8. one absolute Build route.

The durable-scale route requires:

```text
TTM demand            >= $20,000,000
current 6M annualized >= $15,000,000
Master Score          >= 75
```

The escape-velocity route requires:

```text
TTM demand                       >= $15,000,000
current 6M annualized            >= $20,000,000
Master Score                     >= 70
current 6M / prior-year 6M       >= 2.5×
recent 3M / prior-year recent 3M >= 2.0×
```

Master Build v2 has no sport quota. The Index measures progress toward these
same global rules and does not manufacture a football or basketball Build.

## Progress factors

For a value `v` and target `t`, every progress factor is:

```text
Progress(v, t) = clamp(v / t, 0, 1)
```

Every factor is therefore bounded from zero to one. Exceeding a gate does not
create extra credit.

For factors `v` and weights `w` that sum to one, the implemented weighted
geometric mean is:

```text
Weighted geometric mean = exp(sum(w × ln(v)))
```

If any input factor is zero, the result is zero.

The two growth multiples are reconstructed from the Master Ranking v2
diagnostics:

```text
Six-month growth multiple   = exp(6M year-over-year log growth)
Three-month growth multiple = exp(3M year-over-year log growth)
```

### Durable-scale readiness

Let:

```text
E1 = Progress(TTM demand, $20,000,000)
E2 = Progress(current 6M annualized, $15,000,000)
E3 = Progress(Master Score, 75)
```

Then:

```text
Durable-scale readiness =
  weighted geometric mean(
    45% × E1,
    35% × E2,
    20% × E3
  )
```

### Escape-velocity readiness

Let:

```text
X1 = Progress(TTM demand, $15,000,000)
X2 = Progress(current 6M annualized, $20,000,000)
X3 = Progress(Master Score, 70)
X4 = Progress(six-month growth multiple, 2.5)
X5 = Progress(three-month growth multiple, 2.0)
```

Then:

```text
Escape-velocity readiness =
  weighted geometric mean(
    30% × X1,
    25% × X2,
    15% × X3,
    15% × X4,
    15% × X5
  )
```

The projected route is whichever route has the higher unrounded readiness.
Exact ties select `durable_scale`.

### Common-gate readiness

The API calculates the observed P99 TTM-demand floor from all Master Ranking v2
rows that have a non-null master rank. Let that fixed snapshot value be
`Global P99 TTM`.

```text
C1 = Progress(TTM demand, Global P99 TTM)
C2 = Progress(Persistence, 90)
C3 = Progress(Shock Resistance, 90)
C4 = Progress(Downside Protection, 90)

Common-gate readiness =
  geometric mean(C1, C2, C3, C4)
```

Each common factor receives equal 25% weight.

## Market Path Readiness

The Index uses the better of the two route-readiness values, then blends it
geometrically with the common gates:

```text
Best route = max(
  Durable-scale readiness,
  Escape-velocity readiness
)

Market Path Readiness =
  100 × weighted geometric mean(
    65% × Best route,
    35% × Common-gate readiness
  )
```

Market Path Readiness is also a deterministic 0–100 proximity score. It is not
a market probability.

## Player trajectory support

Trajectory Support is the current Player Rankings v2 `Player Outlook`, rounded
to one decimal place:

```text
Trajectory Support = Player Outlook
```

For football, Player Outlook derives from the current KeepTradeCut one-QB and
Superflex rank percentiles. For basketball, it derives from the current Hashtag
Basketball five-season and keeper rank percentiles. These are attributed
comparison signals, not independent career-outcome forecasts.

The displayed trajectory label is descriptive:

```text
current run rate / TTM demand >= 1.15 → rising
current run rate / TTM demand <= 0.85 → fading
otherwise                              → steady
```

When TTM demand is zero, a positive current run rate is `rising`; otherwise it
is `steady`. The trajectory label does not enter the Graduation Index formula.

## Graduation Index formula

For a publishable, non-graduated player:

```text
O = Trajectory Support
M = Market Path Readiness

Graduation Index =
  60% × min(O, M)
  + 40% × sqrt(O × M)
```

The result is clamped to `0–99.9` and rounded to one decimal place. The weak-link
term prevents either player enthusiasm or market readiness from carrying the
Index alone.

Publishable current Master Builds receive:

```text
status               = graduated
index                = 100
band                 = graduated
globalRank           = null
projectedRoute       = graduated
marketPathReadiness  = 100
```

Evidence-withheld rows receive null Index, Market Path Readiness, Trajectory
Support, and global rank.

## Bands

Non-graduated, ranked players receive these deterministic bands:

| Graduation Index | Band |
| ---: | --- |
| 85.0–99.9 | `on_deck` |
| 70.0–84.9 | `approaching` |
| 50.0–69.9 | `developing` |
| 0.0–49.9 | `long_range` |

`graduated` and `withheld` are separate states, not numeric bands.

## Primary blocker and distance fields

The primary blocker is the lowest progress factor among:

- all four common-gate factors; and
- the factors from the selected projected route.

Ties break by blocker code. The API also publishes non-negative distance to the
selected route's demand, run-rate, Master Score, growth, and common-gate
targets. Distance describes what is currently missing; it does not predict that
the gap will close.

## One global pre-filter rank

Graduation rank is assigned once across every row whose graduation status is
`ranked`, before sport, age, position, band, search, display sort, or pagination
filters.

The canonical rank order is:

1. Graduation Index descending;
2. Market Path Readiness descending;
3. Player Outlook descending; and
4. player name ascending.

Graduated and evidence-withheld rows do not receive a graduation rank. Filtering
to one sport or a maximum age preserves the original global rank and may
therefore begin with a number other than one. Other sort choices change only
the returned display order; they do not rewrite `globalRank`.

## Age policy

Age is a display and filter field only. It never enters route readiness, common
gates, Market Path Readiness, Trajectory Support, Graduation Index, band, or
global rank.

This avoids adding a second youth premium because the external dynasty outlook
already incorporates expected career runway. An age-filtered request excludes a
row whose age is null. The API supports `maxAge` from 15 through 60.

The Index does not claim that a football player's age has the same career
meaning as a basketball player's age.

## Evidence grades and row withholding

Every row evaluates:

- `sourceCurrent`: the Master snapshot and every player source are current;
- `completeHistory`: Master has 18 observed months and the player signal has a
  complete-history ratio of one;
- `identityBridgeValid`: the Player Rankings v2 identity bridge passed; and
- `manualIdentityReviewed`: the bridge has explicit manual approval.

Evidence grades are:

```text
withheld =
  source not current
  OR incomplete history
  OR invalid identity bridge

A = publishable and manually reviewed
B = publishable but not manually reviewed
```

Grade B remains rankable; manual review is disclosed rather than converted into
score. A withheld row receives:

```text
status         = withheld
index          = null
globalRank     = null
band           = withheld
projectedRoute = withheld
primaryBlocker = evidence_not_publishable
```

## Feed-level freshness suspension

Row evidence withholding is separate from feed publication. The selected feed
combines:

- Master Ranking v2 freshness; and
- the selected football and/or basketball player-source freshness.

If any selected source is stale, feed status is `stale`. If none is stale but
any is unknown, feed status is `unknown`. Only `current` feeds publish items.
A stale or unknown feed returns an empty item list and includes
`graduation_ranking_suspended` in its freshness reasons.

Freshness cannot increase the Index. It either permits publication or suspends
it.

## Filters and display sorts

The endpoint supports:

```text
sport   = all | football | basketball
q       = player-name search
maxAge  = integer from 15 through 60
position
band    = all | graduated | on_deck | approaching
          | developing | long_range | withheld
sort    = graduation_rank | graduation_index | market_readiness
          | player_outlook | ttm_sales | current_run_rate | age | name
page
limit   = 1 through 100
```

These parameters screen or reorder an already-ranked catalog. They never
recalculate the Graduation Index or global rank.

## Source-rights boundary

The Index uses the same bounded sources and identity controls as Player
Rankings v2 and Master Ranking v2.

- GemRate use rests on the project owner's recorded permission statement for
  the referenced Athlete and Pokémon Sales Trends data. Raw source
  redistribution, unrestricted scraping, and use beyond the attested scope are
  not implied.
- KeepTradeCut permission covers attributed normalized comparison and derived
  display, but the recorded attestation does not include model training.
- Hashtag Basketball remains under a provisional public-use boundary that
  explicitly prohibits model training or fitted optimization on its provider
  rankings.
- Raw provider payloads are not published or resold.

Accordingly, v1 is a fixed deterministic formula. It does not fit, optimize, or
calibrate coefficients on KeepTradeCut or Hashtag Basketball data. A future
probability model may not train on those provider ranks unless the applicable
rights scope is expanded and recorded first.

## Monthly archive and calibration path

The current release has:

```text
currentObservedTransitions = 0
minimumObservedTransitionsBeforeProbability = 100
```

The minimum of 100 observed transitions is necessary but not sufficient for a
probability release. The product must first build a point-in-time longitudinal
record:

1. archive each monthly Master Ranking v2 and Backstop Binder Index snapshot
   immutably, including snapshot ID, data-through date, source timestamps,
   source hashes, contract versions, model versions, full candidate universe,
   evidence state, Index inputs, and Build state;
2. preserve players who disappear from a later provider export as censored or
   lost-to-coverage observations rather than deleting them;
3. for each non-Build feature snapshot, observe whether the player enters Master
   Build within 24 months and then remains Build in two of three monthly
   snapshots;
4. keep unresolved 24-month windows right-censored rather than labeling them
   failures;
5. use rolling-origin or expanding-window temporal evaluation with a genuinely
   prospective holdout; random row splits are not acceptable;
6. evaluate calibration and discrimination with event counts, Brier score,
   reliability curves, log loss, precision, recall, and rank lift, including
   sport-level diagnostics; and
7. retain `probability = null` until at least 100 durable observed transitions
   exist, the prospective holdout passes, and source rights permit every fitted
   feature.

Repeated monthly observations of one player are not independent transition
events. The 100-event gate counts observed durable graduation events, not rows
or snapshots. Passing that count does not guarantee adequate basketball and
football subgroup calibration.

## Deliberate limitations

Backstop Binder Index v1 does not model:

- exact card, set, parallel, autograph, grade, or condition;
- card price, entry valuation, spreads, fees, liquidity, or expected return;
- graded population, population growth, supply, scarcity, or reprint risk;
- injury probability or a sport-specific career simulation;
- Hall of Fame or award probability;
- a causal relationship between player outlook and future collector demand; or
- a validated 24-month Build-transition probability.

GemRate measures subject-level completed eBay singles sales dollars. A player
can rank highly while particular cards remain overpriced, overproduced, or
illiquid. Graduation to Master Build is a subject-level research milestone for
later exact-card underwriting, not proof of a durable investment.
