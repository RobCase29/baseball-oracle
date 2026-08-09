# Hobby Oracle Player Rankings v2

## Status and decision supported

Player Rankings v2 is an active-player research-prioritization model for one
question:

> Which football or basketball players combine a strong long-horizon player
> outlook with broad, recurring collector demand?

The public contract is `hobby-player-rankings.v2`, the item contract is
`hobby-player-ranking-item/v2`, and the model version is
`hobby-player-durable-signal/18m-robust-core-v2.0.0`. Its strict public schema
is [hobby-player-rankings.v2.schema.json](../public/schemas/hobby-player-rankings.v2.schema.json).
The live endpoint is `/api/v2/hobby-player-rankings`; the v1 endpoint remains
on its original contract for compatibility.

Every score, rank, percentile, sensitivity scenario, and action posture is
computed **within one sport**. A response is scoped to either football or
basketball, and every returned item must match that scope. The model never
creates a football-versus-basketball ordinal.

`Build` means **Build candidate for further card-level research**. It is not a
buy instruction, a prediction that a card will appreciate, or a claim that the
player will reach the Hall of Fame.

## Evidence boundary

The active-player universe is the identity-safe intersection of:

- GemRate's 18 monthly athlete-level completed eBay singles sales-dollar
  observations; and
- KeepTradeCut one-QB and Superflex dynasty ranks for football, or Hashtag
  Basketball five-season and keeper ranks for basketball.

Checklist.BackstopCards.com owns the provider acquisition boundary and exports
the attributed, content-hashed `backstop-hobby-player-signals.v2` exchange
under contract `2.0.0`. Hobby Oracle verifies the schema, contract, content
hash, source rights, row counts, identities, and source freshness before
ranking.

Every exchange row contains a nullable `careerStartYear`:

- football maps the validated KeepTradeCut draft year; and
- basketball uses `null` because its source does not provide that fact.

The exchange contains provider facts, not GemRate rows, card prices, or Hobby
Oracle scores. Hobby Oracle joins it to the separate GemRate snapshot and owns
all identity controls, scoring, filtering, and publication.

## Identity controls and quarantine

Ordinary joins require a unique normalized name within the same sport. Provider
IDs and original display names remain attached to every row; normalization is a
reviewable bridge, not a universal athlete identifier.

V2 adds explicit identity controls:

- reviewed aliases map known spelling, initial-spacing, short-name, or suffix
  variants to one exact GemRate source key;
- reviewed blocks quarantine known same-sport namesake aggregation risks; and
- a separate manual-review registry records approved provider-to-GemRate pairs.

An alias or block must resolve back to the exact provider row and exact GemRate
row recorded in the control artifact. Aliases cannot target a declared
ambiguous market name. Published identity states distinguish
`reviewed_exact`, `reviewed_alias`, and `unique_normalized_name`; only a
manually approved bridge clears the Build review gate.

Rows also fail closed on impossible graded chronology. The first and most
graded years must be within the supported calendar range, the first cannot
follow the most-graded year, and—when age is known—neither may predate the
player's estimated birth year. Football rows with explicitly unknown age skip
the birth-year comparison but still require a valid draft year.

The feed reports selected-sport and global quarantine counts for:

- ambiguous provider identity;
- ambiguous market identity;
- missing market match;
- incomplete provider ranks;
- invalid age;
- explicit identity-control blocks; and
- impossible graded chronology.

## Player Outlook

Provider ranks are converted to empirical midrank percentiles within the
captured format cohort. Tied ranks share their average percentile. Supplemental
formats are normalized from the ranks actually observed in that format rather
than from an invented declared universe.

Football weakens one-format distortion:

```text
P1 = KeepTradeCut one-QB rank percentile
PS = KeepTradeCut Superflex rank percentile

Player Outlook =
  0.60 × min(P1, PS)
  + 0.40 × sqrt(P1 × PS)
```

Basketball emphasizes the explicit five-season view:

```text
P5 = Hashtag five-season rank percentile
PK = Hashtag keeper rank percentile

Player Outlook =
  0.75 × P5
  + 0.25 × PK
```

Outlook is a dynasty-consensus input, not a Hall-of-Fame probability or a
career-value forecast.

## Age and evidence depth

Age never adds points to the Build Score. Dynasty ranks already incorporate
career runway, so a positive youth coefficient would double-count prospect
enthusiasm.

V2 instead uses age or draft year conservatively to describe how much career
evidence exists:

```text
Football evidence years =
  max(0, data-through year − NFL draft year)

Basketball evidence years =
  max(0, floor(age − 19))
```

Evidence stages are:

- `new`: 0 years;
- `developing`: 1 year;
- `emerging`: 2–3 years; and
- `established`: 4 or more years.

Football may publish `age: null` when the player has a valid draft year. This
keeps a null-age rookie in the research universe without inventing an age; the
draft year still produces the `new` evidence stage. Basketball requires a
plausible age. An age-filtered screen excludes null-age rows because they
cannot honestly be proven to satisfy the threshold.

Build requires at least two evidence years. Evidence depth is a gate, not a
positive score bonus.

## Sales resilience and shock resistance

GemRate measures subject-level sales dollars, not exact-card prices or
transaction counts. Trailing-12-month sales dollars are converted to a
midrank percentile within the complete GemRate sport cohort.

Sales Resilience rewards recurring observations and a durable monthly floor:

```text
Sales Resilience =
  100 × (
    0.50 × positive-month ratio
    + 0.30 × observed-history ratio
    + 0.20 × lower-quartile volume / median volume
  )
```

V2 separately measures whether sales are concentrated in one or two temporary
months. For the trailing 12 months:

```text
month share m = month sales / trailing-12 sales
HHI = sum(month share m²)
effective sales months = 1 / HHI

Shock Resistance =
  100 × (
    1 − clamp(
      (HHI − 1/12) / (1 − 1/12),
      0,
      1
    )
  )
```

If trailing-12 sales are zero, HHI is conservatively set to 1. Higher Shock
Resistance means demand is distributed more evenly across the year.

The six-month trend context remains clipped to 35–65. Only its downside enters
the score:

```text
Market Durability =
  0.70 × trailing-12 sport-volume percentile
  + 0.15 × Sales Resilience
  + 0.10 × Shock Resistance
  + 0.05 × min(trend context, 50)
```

Positive short-term momentum cannot lift Market Durability above its neutral
trend contribution. Recent-six-month and full-18-month volume percentiles are
retained for sensitivity testing rather than added as more correlated score
components.

## Adjusted demand divergence

Raw attention gap is:

```text
Attention Gap =
  trailing-12 sport-volume percentile − Player Outlook
```

A large positive gap can reflect collector attention outrunning the player
outlook. V2 compares that gap with the same-position median when at least eight
candidates exist, or otherwise the full-sport median. Evidence stage is
deliberately excluded from this calculation so age and draft year cannot alter
the score through a hidden peer-group path.

```text
Adjusted Attention Gap =
  Attention Gap − peer median Attention Gap
```

Three-month acceleration is also contextualized:

```text
Acceleration Log =
  log((recent 3 months + 1) / (prior 3 months + 1))
  − log((prior 3 months + 1) / (earlier 3 months + 1))

Acceleration Context =
  clamp(50 + 50 × tanh(Acceleration Log), 0, 100)
```

The downside-only penalty is:

```text
Divergence Penalty =
  min(
    12,
    0.25 × max(0, Adjusted Attention Gap − 15)
    + 0.10 × max(0, Acceleration Context − 80)
  )
```

This avoids penalizing every popular quarterback merely because the position
normally carries more collector attention.

## Build Score

The score uses a weak-link/geometric blend so neither player enthusiasm nor
collector demand can carry the result alone:

```text
Build Score =
  0.60 × min(Player Outlook, Market Durability)
  + 0.40 × sqrt(Player Outlook × Market Durability)
  − Divergence Penalty
```

The published score is bounded to 0–100 and ranked only within its sport.

## Seven-scenario robustness

Every candidate is re-ranked within sport under seven scenarios:

1. balanced;
2. outlook-heavy;
3. market-heavy;
4. recent-six-month market volume;
5. full-18-month market volume;
6. primary provider-format emphasis; and
7. secondary provider-format emphasis.

The outlook-heavy and market-heavy variants retain the weak link and geometric
mean while adding a limited 15% tilt:

```text
Outlook-heavy =
  0.55 × weak link + 0.30 × geometric mean + 0.15 × outlook − penalty

Market-heavy =
  0.55 × weak link + 0.30 × geometric mean + 0.15 × market − penalty
```

The market-window scenarios substitute recent-six-month or full-18-month volume
percentiles into Market Durability. The provider-format scenarios shift the
football mix between Superflex and one-QB, or the basketball mix between
five-season and keeper ranks.

V2 publishes the seven ranks, seven scores, best-to-worst rank range, score
spread, and top-five-percent inclusion rate. A Build candidate must remain
inside the sport's top 5% in **all seven** scenarios.

## Concentration percentile

Trailing-12 HHI is ranked within sport from least concentrated to most
concentrated. A higher concentration percentile means more of the observed
demand came from fewer months.

Build requires a concentration percentile at or below the sport's 90th
percentile. Values above P90 are flagged for concentration review. This gate
does not prove that lower-concentration demand will persist; it prevents a
single spike from receiving the strongest posture without review.

## Build gates and postures

`Build` requires all 13 checks:

1. Build Score at least 82;
2. Player Outlook at least 80;
3. Market Durability at least 75;
4. trailing-12 sport-volume percentile at least 65;
5. Divergence Penalty below 4;
6. balanced rank inside the sport's top 5%;
7. market and fundamentals sources current;
8. all 18 market months observed;
9. a valid identity bridge;
10. manual identity approval;
11. top-5% placement in all seven sensitivity scenarios;
12. at least two evidence years; and
13. concentration percentile at or below sport P90.

The remaining postures are research triage, not investment actions:

- `Research` requires current sources, complete history, manual identity
  approval, at least two evidence years, concentration at or below P90, score
  at least 70, Outlook at least 65, Market Durability at least 65, and
  Divergence Penalty at most 8.
- `Watch` includes numerically strong Build candidates awaiting one or more
  manual-review, robustness, evidence-depth, or concentration gates, plus other
  rows with a score of at least 45.
- `Deprioritize` is the remaining current research universe.

No posture identifies which set, card, parallel, autograph, grade, or purchase
price is attractive.

## Input-integrity confidence

The confidence object measures **player-model input integrity**, not investment
confidence. It begins with 10 points and can add:

- 20 for manual identity approval;
- 15 for current sources;
- 15 for complete market history;
- 5 for at least two evidence years;
- 5 for seven-scenario top-5% robustness; and
- 5 for concentration at or below sport P90.

The result is capped at 75. Stale evidence caps it at 30; incomplete history
caps it at 45. A current score of at least 60 is `moderate`, at least 35 is
`low`, and lower values are `withheld`; stale evidence is always `withheld`.
Every row explicitly publishes:

```text
investmentConfidence = withheld
```

The model does not estimate an investment-confidence interval.

## Scoped publication and freshness

Every response declares:

- one sport and the applied age, position, and posture screen;
- screen-relative counts and ranks;
- immutable full-sport ranks;
- selected-sport quarantine and coverage;
- global quarantine context;
- available filters; and
- exact source provenance.

GemRate follows its monthly publication deadline. KeepTradeCut must have been
captured within 14 days, and Hashtag Basketball must remain within 45 days of
its stated source update.

If either the market snapshot or the selected sport's fundamentals are stale or
unknown—or a source, exchange, review, or identity-control timestamp is later
than the publication clock—publication fails closed. The response still returns
provenance, freshness, quarantine, and coverage metadata, but `items` is empty,
screen-summary counts are zero, and page totals are zero. The client also
rejects responses whose posture totals do not reconcile to their reported
screen or sport cohort. The response includes an explicit sport-specific
`ranking_publication_suspended` reason.

## Deliberate limitations

Player Rankings v2 is an **active-player collection-research screen**. It does
not provide:

- Hall-of-Fame odds, induction probability, or projected career WAR;
- expected card return, durable-appreciation probability, or a price target;
- exact-card, set, parallel, autograph, grade, or condition recommendations;
- card-level sales, transaction counts, bid-ask spreads, fees, or
  time-to-liquidate;
- graded-population totals, population growth, or supply-adjusted scarcity;
- portfolio sizing, cost basis, tax treatment, or a buy/sell instruction; or
- validated causal evidence that a higher Build Score produces superior future
  returns.

GemRate is subject-level completed-sales volume. A strong player-level signal
can coexist with overproduced or overpriced cards. Card-level underwriting
must therefore occur after—not inside—the Player Rankings model.

Retired icons also require a separate durable-demand methodology. Applying
active-player dynasty ranks to them would create a structurally invalid
comparison.

An investment-return model would require a predefined canonical-card basket,
net returns after spreads and fees, population and supply histories, retained
illiquid and delisted observations, rolling-origin holdouts, and uncertainty
clustered by athlete. Until that outcome data exists, v2 remains transparent
research prioritization rather than a return forecast.
