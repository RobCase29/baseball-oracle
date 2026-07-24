# Magnificent X v1

## Purpose and publication state

Magnificent X is intended to identify the very small, variable set of hobby
subjects that may have a durable long-term collection thesis. `X` is not a
fixed top-N quota. A future release may designate zero subjects if none pass
every evidence gate.

The currently shipped model is **not** that designation model. It is a
research-only, subject-level market signal built from 18 complete months of
GemRate completed eBay singles sales-volume dollars:

```text
modelVersion = magnificent-x-market-signal/18m-provisional-v1.0.0
schemaVersion = magnificent-x-market-signal.v1
contractVersion = magnificent-x-contract/v1
feedSchemaVersion = magnificent-x-feed.v1
```

The versioned feed is:

```http
GET /api/v1/magnificent-x
```

The machine-readable response contract is
`/schemas/magnificent-x-feed.v1.schema.json`.

It supports `q`, `domain`, `tier`, `posture`, `sort`, `direction`, `page`, and
`limit` controls. Sorting and pagination are applied across the complete
filtered universe before rows are returned. The shipped score measures
relative subject-level demand durability within a provider cohort. It does not
measure an exact card, price appreciation, liquidity, expected return, or
investment merit.

Every shipped record therefore has:

```text
magnificentX.score = null
magnificentX.eligible = false
magnificentX.designation = withheld
flags.cardLevelActionable = false
```

The feed and every cohort report `magnificentEligibleCount = 0`.

## Investor workbench research postures

The table-first investor workbench translates each existing research tier into
a deterministic subject-level queue. This translation changes presentation,
not the model, score, or designation:

| Model research tier | Workbench posture | Intended use |
| --- | --- | --- |
| `market_leader` | Build candidate / core hold | Prioritize exact-card underwriting |
| `durable_demand` | Hold candidate / selective add | Review existing exposure and selective additions |
| `watch` | Watch | Monitor for stronger durability evidence |
| `noise_risk` | Risk review / no new capital | Review concentrated or weakening demand before adding |
| `long_tail` | Pass | Deprioritize at the subject-demand layer |
| `evidence_needed` | Unrated | Resolve cohort or identity evidence first |

Freshness failure overrides every tier to `needs_refresh`. Failed cohort quality
or an ambiguous normalized identity overrides it to `unrated`. A
`market_leader` that does not also have a passing market-strength gate is
treated as contract drift and becomes `unrated`.

The posture is not a card action. Exact-card buy, hold, trim, and sell actions
remain withheld because the feed lacks card identity, price and cost basis,
supply/population growth, dilution or reprint risk, liquidity, condition, and
validated return outcomes. In particular, low subject-level sales volume is
not evidence that a scarce card should be sold.

Supported workbench posture values are:

```text
build_candidate
hold_candidate
watch
risk_review
pass
unrated
needs_refresh
```

Supported sort keys are:

```text
cohort_rank
signal
ttm_sales
trend
persistence
shock_resistance
cohort_percentile
name
```

Cross-hobby sorting is a screen, not a validated global ranking. Cohort rank
and percentile remain the authoritative relative-standing fields.

## Source snapshot

The committed snapshot combines four permissioned GemRate CSV editions:

- Athlete Sales Trends for 2025 and 2026;
- Pokémon Character Sales Trends for 2025 and 2026.

The two 2025 editions provide January through December 2025. The two 2026
editions provide January through June 2026. The builder requires the subject
sets and source category markers to be identical between editions. It also
checks, for every subject, that July through December 2025 agree with the first
six values in the 2026 trailing-twelve-month series. Athlete first-graded and
most-graded years must also remain unchanged across editions.

The resulting evidence window is exactly:

```text
historyStart = 2025-01-01
historyMonths = 18
dataThrough = 2026-06-30
publishedAt = 2026-07-12T00:00:00.000Z
acquiredAt = 2026-07-24T18:16:29.000Z
```

The committed artifact contains 5,000 athlete rows and 1,022 Pokémon character
rows, for 6,022 source subjects. Its provider cohorts are:

| Domain | Provider category | Taxonomy status | Subjects |
| --- | --- | --- | ---: |
| Baseball | `⚾` | coherent | 2,064 |
| Basketball | `🏀` | coherent | 839 |
| Football | `🏈` | coherent | 1,084 |
| Soccer | `⚽` | coherent | 275 |
| Hockey | `🏒` | coherent | 426 |
| Combat | `🤼` | coherent | 168 |
| Golf | `⛳` | small | 14 |
| Mixed sport | `🏆` | mixed | 100 |
| Other sport | `🏅` | mixed | 26 |
| Culture | `🎬` | outside sports scope | 4 |
| Pokémon | `pokemon_character` | coherent | 1,022 |

The exact 5,000-row athlete total may represent a provider export cap.
Cross-sport duplicates, mixed-sport overlap, and Pokémon/athlete overlap have
not been independently resolved. Consequently, raw exports are not published
and a global cross-hobby ranking is unavailable.

An authorized owner can reproduce the compact artifact without committing the
raw exports:

```bash
npm run data:gemrate-hobby:build -- \
  --athlete-2025 /private/path/athlete-2025.csv \
  --athlete-2026 /private/path/athlete-2026.csv \
  --pokemon-2025 /private/path/pokemon-2025.csv \
  --pokemon-2026 /private/path/pokemon-2026.csv
```

The builder hashes every source, records each file acquisition time, enforces
row-count floors and edition schemas, checks all 36,132 overlap cells, then
hashes the deterministically sorted derived rows.

## Shipped 18-month provisional formula

All component and final scores are on a 0-100 scale and are rounded to one
decimal place unless otherwise stated.

### Input contract

Each subject must have exactly 18 non-negative, safe-integer monthly sales
values. A blank source monthly cell is converted to zero only under the
snapshot parser's source-summary and overlap reconciliation rules. It is not
treated as missing after the snapshot passes validation.

For monthly values `m[0] ... m[17]`:

```text
latest 12 months = m[6]  ... m[17]  (July 2025-June 2026)
current 6 months = m[12] ... m[17]  (January-June 2026)
prior-year 6     = m[0]  ... m[5]   (January-June 2025)
current recent 3 = m[15] ... m[17]  (April-June 2026)
prior recent 3   = m[3]  ... m[5]   (April-June 2025)
```

### Within-cohort demand percentile

Trailing-twelve-month sales are summed for every unambiguous subject in the
same provider domain. Subjects are sorted by that dollar total. Ties receive
the average zero-based rank:

```text
withinCohortPercentile =
  100 × averageZeroBasedRank / (cohortRows - 1)
```

The percentile is rounded to four decimals during cohort construction and to
one decimal in the public assessment. A one-row cohort receives 100.
Ambiguous normalized names are excluded from percentile construction and
receive the fixed prior of 50.

Small-cohort extremes are shrunk toward the fixed prior:

```text
shrinkage = cohortSize / (cohortSize + 200)

shrunkWithinCohortPercentile =
  50 + shrinkage × (withinCohortPercentile - 50)
```

### Scale

The intended scale blend is 65% shrunk within-cohort percentile and 35% global
percentile:

```text
Scale =
  0.65 × shrunkWithinCohortPercentile
+ 0.35 × effectiveGlobalScalePercentile
```

Global overlap and export completeness are not verified, so the shipped feed
always exposes `globalScalePercentile = null` and uses the fixed prior:

```text
effectiveGlobalScalePercentile = 50
```

The missing global input does not increase the within-cohort weight.

### Persistence

Let `positiveMonthRatio` be the fraction of all 18 months with sales greater
than zero. The snapshot requires all 18 months, so the observed-month ratio is
always 100%.

The lower quartile and median use linearly interpolated quantiles over the 18
monthly values. The resilience ratio is:

```text
lowerQuartileToMedianRatio =
  clamp(lowerQuartile / median, 0, 1)        when median > 0
  0                                          when median <= 0 and Q1 <= 0
  1                                          when median <= 0 and Q1 > 0
```

The shipped persistence component is:

```text
Persistence =
  0.50 × positiveMonthRatio × 100
+ 0.30 × 100
+ 0.20 × lowerQuartileToMedianRatio × 100
```

### Shock resistance

Shock resistance measures whether the latest twelve months are distributed
across months instead of being dominated by one event. For latest-twelve-month
sales shares `s[t]`:

```text
HHI = sum(s[t]²)

ShockResistance =
  100 × (
    1 - clamp(
      (HHI - 1/12) / (1 - 1/12),
      0,
      1
    )
  )
```

If latest-twelve-month sales are zero, `HHI = 1` and shock resistance is zero.
A perfectly even twelve-month distribution maps to 100; one month containing
all sales maps to zero.

### Trend context

The score compares like-for-like calendar periods rather than adjacent
three-month windows:

```text
sixMonthLogGrowth =
  log((currentSixMonthSalesUsd + 1) / (priorYearSixMonthSalesUsd + 1))

TrendContext =
  50 + 25 × clamp(sixMonthLogGrowth / log(2), -1, 1)
```

This bounds trend context from 25 to 75. A halving maps to 25, flat sales to
50, and a doubling to 75.

The same transformation is applied to April-June 2026 versus April-June 2025
to produce `recentThreeMonthAccelerationContext`. That diagnostic does not
enter the numeric market score, but it can trigger the `noise_risk` research
tier.

### Provisional market score

```text
Provisional Market Signal =
  0.40 × Scale
+ 0.25 × Persistence
+ 0.15 × ShockResistance
+ 0.20 × TrendContext
```

The score is always marked `provisional: true`.

## Shipped research tiers

Research tiers summarize the provisional market evidence. They are neither
Magnificent X designations nor buy, hold, trim, or sell actions. Rules are
evaluated in this order:

| Tier | Rule |
| --- | --- |
| `evidence_needed` | Taxonomy is not `coherent_provider_cohort`, cohort has fewer than 100 subjects, or normalized identity is ambiguous |
| `noise_risk` | Within-cohort percentile is at least 85 and any of: shock resistance below 60, trend context below 40, or recent three-month acceleration context below 35 |
| `market_leader` | Score at least 70, within-cohort percentile at least 98, shock resistance at least 60, and trend context at least 45 |
| `durable_demand` | Score at least 64, within-cohort percentile at least 90, and shock resistance at least 55 |
| `watch` | Score at least 60 and within-cohort percentile at least 60 |
| `long_tail` | No earlier tier rule passes |

Within each domain, rank is assigned by descending provisional market score,
then descending within-cohort percentile, then subject name. A one-domain feed
uses that order. The all-domain view interleaves equal within-cohort ranks,
then orders by domain and name; it does not sort different domains against one
another. These ordering rules do not make different domains economically
comparable.

## Current designation gates

The response exposes ten fail-closed gates so consumers can see what is
missing:

| Gate | Shipped rule or state |
| --- | --- |
| `marketStrength` | Score at least 70, within-cohort percentile at least 98, shock resistance at least 60, and trend context at least 45 |
| `cohortQuality` | Coherent provider cohort with at least 100 subjects |
| `historyDepth` | Always false: 18 months is below the required 36 |
| `canonicalIdentity` | Always false |
| `domainFundamentals` | Always false |
| `globalScale` | Always false |
| `supplyDilution` | Always false |
| `exactCardEvidence` | Always false |
| `modelValidation` | Always false |
| `currentFreshness` | True only while the monthly snapshot is current |

`passedGateCount` reports how many of these ten gates pass. Passing the
provisional market-strength or cohort gates cannot overcome a closed core
gate.

The main reason codes are:

```text
history_below_36_complete_months
canonical_subject_identity_missing
domain_fundamentals_missing
global_scale_overlap_not_verified
supply_dilution_evidence_missing
exact_card_evidence_missing
outcome_validation_missing
```

Athletes additionally report `athlete_sport_era_identity_unverified`.
Pokémon rows report `pokemon_character_bucket_not_exact_card` and
`national_dex_identity_missing`.

## Confidence

Confidence measures evidence quality, not a statistical confidence interval:

```text
Confidence =
  0.40 × evidenceCompleteness
+ 0.20 × identityStrength
+ 0.15 × freshness
+ 0.15 × historyDepth
+ 0.10 × modelValidation
```

The shipped effective inputs are:

```text
evidenceCompleteness = 40 for a coherent provider cohort, otherwise 25
identityStrength     = 0 for an ambiguous normalized name, otherwise 25
freshness            = 100 current, 0 stale, 25 unknown
historyDepth         = 100 × min(1, 18 / 36) = 50
modelValidation      = 25
```

The result is capped at 50 because every current identity is source-name-only
and the model is provisional. Ambiguous identities receive the `withheld`
confidence band. Other rows are `provisional` at 40 or above and `low` below
40. No current row can reach the future designation confidence threshold.

## Target 36-month Magnificent X methodology

This section specifies the intended full-gate methodology. It is a design
target, not a claim about the shipped feed. It requires a new versioned model,
contract tests, out-of-time validation, and release review before it can emit
a designation.

### Full market durability

The full model requires at least 36 complete monthly observations.

```text
TTM Spend = sum(latest 12 months)

WithinCohort =
  midrank percentile of log1p(TTM Spend)
  inside the exact, verified provider domain

ShrunkWithin =
  50 + cohortSize / (cohortSize + 200) × (WithinCohort - 50)

GlobalScale =
  verified midrank percentile of log1p(TTM Spend)
  across non-overlapping hobby subjects

Scale = 0.65 × ShrunkWithin + 0.35 × GlobalScale
```

The monotonic `log1p` transformation does not change rank; it declares the
heavy-tailed dollar scale explicitly.

Over 36 months:

```text
Persistence =
  0.50 × positive-month ratio × 100
+ 0.30 × observed-month ratio × 100
+ 0.20 × clamp(lower quartile / median, 0, 1) × 100
```

Shock resistance retains the shipped normalized-HHI calculation over the
latest twelve months.

For eligible rolling twelve-month windows, compare each TTM total with the TTM
total ending twelve months earlier:

```text
g = median(log((TTM[t] + 1) / (TTM[t-12] + 1)))

SecularTrend =
  50 + 25 × clamp(g / log(2), -1, 1)
```

The full market-durability score keeps the shipped component weights:

```text
Market Durability =
  0.40 × Scale
+ 0.25 × Persistence
+ 0.15 × ShockResistance
+ 0.20 × SecularTrend
```

Recent acceleration is calculated against the same calendar months one year
earlier and is used only as hype context.

### Domain fundamentals

Each sport requires its own position-, role-, stage-, and era-adjusted adapter
that emits common 0-100 semantics:

```text
Athlete Fundamentals =
  0.60 × Career Legacy Index
+ 0.25 × completed-season route/peak outcome percentile
+ 0.15 × age/runway
```

`Career Legacy Index` is a validated statistical Hall-caliber or lasting-elite
trajectory, not an estimate of election or induction. Current-season
volatility cannot silently replace completed-season evidence. Retired or
inactive athletes use neutral runway 50 so age does not penalize an established
legacy.

Pokémon requires an independently sourced and reviewed character/IP adapter:

```text
Pokémon Character Fundamentals =
  0.40 × official cross-generation franchise recurrence
+ 0.25 × pre-registered character-role centrality
+ 0.20 × TCG longevity
+ 0.15 × cross-era official-card presence
```

Subjective centrality or canonical-status inputs must use a published rubric
and retain manual-review provenance.

### Overall subject score and hype

```text
Magnificent X Score =
  0.75 × Domain Fundamentals
+ 0.25 × Market Durability
- Hype Penalty
```

Let:

- `A` be same-calendar-period recent acceleration on the bounded 25-75 scale;
- `E = 100 - ShockResistance`;
- `D` be a verified 0-100 supply/dilution risk score.

```text
Hype Penalty = min(
  15,
  0.15 × max(0, Market Durability - Domain Fundamentals - 15)
+ 0.08 × max(0, A - 70)
+ 0.06 × max(0, E - 60)
+ 0.08 × max(0, D - 50)
)
```

Supply/dilution evidence requires card-level population, SKU, and
fragmentation evidence:

```text
Sports D =
  0.45 × percentile(population growth minus demand growth)
+ 0.30 × new-SKU velocity percentile
+ 0.25 × card-market fragmentation

Pokémon D =
  0.35 × population-versus-demand gap
+ 0.30 × new-card/SKU velocity
+ 0.20 × confirmed reprint/variant exposure
+ 0.15 × card-market fragmentation
```

If dilution or reprint evidence is unknown, a provisional calculation may use
the fixed prior 50, but designation remains withheld.

### Full designation gate

`Magnificent X` remains a variable-size set. A subject enters it only when all
of these conditions pass:

```text
Magnificent X Score >= 82
Domain Fundamentals >= 80
Market Durability >= 70
raw within-cohort percentile >= 98
verified global percentile >= 90
SecularTrend >= 45
ShockResistance >= 60
Supply/Dilution Risk <= 35
Hype Penalty <= 4
Confidence >= 85
at least 36 complete monthly observations
no core imputation
current market and domain freshness
externally or manually verified canonical identity
coherent cohort with at least 100 subjects
verified export completeness and cross-subject overlap
out-of-time model validation
```

The designation must also survive leave-one-quarter-out market tests and
plus-or-minus-five-point component sensitivity with a score of at least 78 in
at least 90% of scenarios. Entry requires three consecutive qualifying monthly
releases. Exit requires two releases below 78, unless a critical identity,
freshness, or integrity failure causes immediate removal.

No subject is inserted merely to fill a target count.

## Exact-card qualification

Athlete and Pokémon subject demand cannot identify the card to own. A future
exact-card layer is required for any collection action:

```text
Card Fundamentals =
  0.30 × canonical or landmark status
+ 0.25 × exact-card supply integrity
+ 0.20 × set significance
+ 0.15 × condition scarcity
+ 0.10 × reprint or variant clarity
```

An exact card must have Card Fundamentals of at least 80 plus:

- a verified durable card identity, including year, set, card number,
  parallel or variant, language, and grader mapping where applicable;
- current population level and population-growth evidence;
- known reprint, reissue, and variant status;
- transaction-count and liquidity evidence, not dollar volume alone; and
- card-level sales evidence that does not duplicate the subject-level signal.

For Pokémon, the current source row is a character bucket. It is not a National
Pokédex identity, form identity, set, artwork, language, or exact card.
Character demand cannot distinguish a scarce historical printing from a
high-supply modern reprint. The same limitation applies to a sports athlete
whose cards span many years, products, parallels, and population profiles.

## Cohort and identity policy

Source category and exact source spelling are retained in every row.
Normalization removes case, diacritic, punctuation, apostrophe, and whitespace
variance only to detect collisions. It is not identity proof.

The response contract recognizes:

- `source_name_only`;
- `ambiguous_normalized_name`; and
- `canonical_identity_missing`.

The shipped catalog currently emits `source_name_only` or
`ambiguous_normalized_name`; it has no canonical mappings. There is no fuzzy
matching. Ambiguous names are quarantined from percentile construction and
research tiers. Even a unique source name does not pass the canonical-identity
gate.

Future athlete designations require a durable sport identity, chronology
checks, and explicit sport/era resolution. Age is not inferred from a name and
is absent from the shipped feed. Future Pokémon designations require National
Pokédex and form resolution. Mixed-sport, other-sport, culture, and
multi-subject rows remain non-designatable until their boundaries and overlap
are independently resolved.

Scores should be compared only within the same model version and declared
provider cohort. The current UI may sort all returned rows for navigation, but
the API explicitly reports:

```text
globalRankingAvailable = false
globalRankingReason =
  provider_export_cap_and_cross_subject_overlap_not_independently_verified
```

## Missing-data policy

The full methodology uses the fixed prior of 50 for optional missing
components. Weights never expand to compensate for missing evidence. Any
imputation is surfaced by a reason code.

Missing core domain fundamentals makes the overall Magnificent X score `null`.
Missing or incomplete market, identity, supply, reprint, card, freshness, or
validation evidence withholds designation even if a provisional component
score can be displayed. Unknown is never treated as favorable.

## Freshness and reproducibility

GemRate evidence is monthly. The next expected date is calculated as the 20th
day of the second calendar month after the data-through month. For data through
June 30, 2026:

```text
nextExpectedBy = 2026-08-20T00:00:00.000Z
```

The snapshot is `current` through that instant and `stale` afterward. Stale
evidence adds `gemrate_monthly_snapshot_overdue` and closes the
`currentFreshness` gate. An invalid evaluation time produces `unknown` with
`current_time_invalid`.

Snapshot ingestion fails closed unless:

- exactly four athlete/Pokémon 2025/2026 inputs are present;
- the complete January 2025-June 2026 month sequence is present;
- monthly sums reconcile to source summaries and overlapping periods agree;
- athlete and Pokémon row counts are at least 4,000 and 750 respectively;
- every amount is a non-negative safe integer;
- exact source keys are unique;
- cohort counts reconcile to the subject count;
- athlete chronology fields are valid and stable across editions;
- `dataThrough <= publishedAt <= acquiredAt`; and
- the deterministic SHA-256 of serialized rows matches `rowsSha256`.

The feed snapshot ID hashes:

- the committed rows hash;
- the model version;
- evaluated freshness status; and
- each subject ID, provisional score, and research tier.

Consumers should persist the snapshot ID, model version, source dates, and
cohort with any saved research view. A freshness transition can intentionally
change the snapshot ID even when the underlying rows do not.

## Why durable-investment designations are withheld

All durable-investment or collection-action designations are withheld because
the current evidence has only 18 of the required 36 months and lacks:

- canonical athlete and National Pokédex/form identities;
- validated domain-fundamental adapters outside the existing separate
  baseball research;
- verified global cross-hobby scale and non-overlapping subject coverage;
- card-level population, SKU dilution, reprint, and fragmentation evidence;
- exact-card identity, transaction breadth, and liquidity evidence;
- outcome validation and sensitivity history; and
- the confidence required by the full gate.

GemRate subject sales are a directional view of completed eBay singles spend.
They may reflect more products or a small number of exceptional transactions
and do not establish price appreciation or future value. Magnificent X v1 is
therefore a signal-to-noise research tool, not financial, investment, tax, or
legal advice.

Source context:

- <https://www.gemrate.com/sales-trends>
- <https://www.gemrate.com/sales-trends-pokemon>
- <https://www.gemrate.com/sales-trends-context>
- `docs/permissions/GEMRATE_ATTESTATION.md`
