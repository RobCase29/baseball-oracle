# Binder Score v1

## Purpose

Binder Score is a transparent, research-only heuristic for comparing players as
long-term collection subjects. It combines Baseball Oracle's career evidence
with a bounded collector-demand signal. A higher score means a stronger
collection thesis under this specific model version; it does not predict a
card's future price or investment return.

The versioned endpoint is:

```http
GET /api/v1/binder-scores
```

The machine-readable response contract is
`/schemas/binder-scores.v1.schema.json`.

The endpoint accepts the player-list filters `q`, `ids`, `stage`, `playerType`,
`level`, `team`, `position`, `minAge`, `maxAge`, `rankedOnly`, `page`, and
`limit`. `minAge` and `maxAge` are inclusive integers from 15 through 60;
players with unknown age are excluded whenever either bound is present.
`rankedOnly=true` keeps every player with a numeric Binder Score, regardless of
its action label, and excludes rows whose score is withheld. These three
controls are restricted to the Binder view.

Binder results are always ordered first by numeric `binderScore`, with nulls
last, then by confidence and stable identity. An `insufficient_evidence` action
does not move a higher provisional numeric score below a lower reviewed score;
the evidence and action fields remain visible so consumers cannot mistake
ordering for actionability. The endpoint rejects other sort modes. Scores
should only be compared within the same `modelVersion` and declared market
cohort.

The `/hobby` Young Players lens requests `maxAge=25&rankedOnly=true` by default
and offers age ceilings of 21, 23, 25, and 27 plus the existing `All`,
`Minors`, `RC`, and `MLB` stage scopes. It computes no new score or percentile.
It filters the current canonical player universe before sorting and pagination,
then presents the resulting order as a scoped ordinal. Search, ownership, and
action labels do not redefine that ordinal. The UI suppresses the ordinal when
fewer than 20 scored rows match or when either the baseball or market snapshot
is not current.

## Formula

All component scores use a 0-100 scale.

```text
Baseball Thesis
  = 0.60 × Career Index
  + 0.25 × route outcome percentile
  + 0.15 × age/runway

Collector Demand
  = 0.60 × trailing-12-month demand percentile
  + 0.25 × durability/resilience
  + 0.15 × recent momentum

Binder Score
  = 0.75 × Baseball Thesis
  + 0.25 × Collector Demand
  - hype penalty
```

`Career Index` is the Oracle career-outlook evidence available for the player's
route. `route outcome percentile` places the relevant completed-season outcome
standing into a 0-100 percentile for its declared universe. Volatile live-only
MiLB priors are intentionally excluded from Binder Score v1; current-season
results remain visible elsewhere in Oracle but cannot silently replace the
completed-season Binder evidence. These are statistical career signals, not
Hall of Fame election probabilities.

Age is intentionally limited to 15% of Baseball Thesis. Its route-specific
runway curve begins at 100 through age 19 for pre-debut players, 21 for
post-debut minor leaguers, 22 for recent callups, 23 for early MLB players, and
24 for established MLB players. It then declines by 10, 8, 7, 5, or 3.5 points
per additional year, respectively, bounded to 0-100. Inactive players receive
the neutral prior of 50.

Collector Demand uses completed eBay singles sales-volume dollars from the
GemRate Athlete Sales Trends baseball cohort:

- `trailingTwelveMonthDemandPercentile` ranks trailing-12-month sales volume
  within the unambiguous GemRate baseball cohort.
- `durabilityResilience` combines the share of active months (50%), observed
  month coverage (30%), and lower-quartile sales relative to median monthly
  sales (20%).
- `recentMomentum` compares the latest three-month average with the preceding
  three-month average. The rate contribution is capped to keep the resulting
  component between 25 and 75.

The hype penalty is:

```text
min(
  10,
  max(0, Collector Demand - Baseball Thesis - 15) × 0.20
  + max(0, recent momentum - 70) × 0.10
)
```

It reduces the overall score when collector demand materially outruns the
baseball thesis. It never adds points.

## Actions

Action assignment is deterministic and evaluated in this order:

| Action | Rule |
| --- | --- |
| `insufficient_evidence` | Core baseball or complete, current, identity-reviewed market evidence is unavailable |
| `trim_hype` | Hype penalty is at least 4, demand exceeds Baseball Thesis by at least 20, and demand is at least 70 |
| `build` | Binder Score is at least 78 and Baseball Thesis is at least 75 |
| `core_hold` | Binder Score is at least 65 |
| `watch` | Binder Score is at least 50 |
| `pass` | Binder Score is below 50 |

`trim_hype` is evaluated before the positive score tiers. Actions are collection
research labels, not instructions to buy, sell, or hold a security or
collectible.

## Missing Data and Confidence

Missing component values are replaced with the fixed cohort prior of 50. The
weights never expand to compensate for missing inputs, so a missing value cannot
silently make the remaining evidence more influential. Every component exposes
`rawValue`, `effectiveValue`, `imputedToPrior`, `weight`, and
`weightedContribution`.

Missing Career Index or route outcome evidence withholds both Baseball Thesis
and the overall Binder Score. Missing age can use the prior while preserving a
provisional overall score. Missing, incomplete, ambiguous, unmatched, or stale
market evidence can also leave a provisional numeric score, but it always
withholds the action as `insufficient_evidence`.

Market evidence is complete only when:

- identity is verified by an external ID or the explicit manual-review roster;
- all 12 months are observed;
- the demand percentile, durability, and momentum components are available.

An action is available only when that market evidence and the two core baseball
components are complete and neither the baseball nor market input is stale.

Confidence measures evidence coverage, identity strength, and freshness. It is
not a statistical confidence interval. Confidence is capped at 75 and therefore
at `moderate` while the underlying Oracle models remain research-only. The
response includes reason codes for missing evidence, normalized-name identity,
and non-current inputs.

## Identity and Quarantine

The current GemRate snapshot does not expose a documented durable player ID for
this feed. Oracle therefore requires a player to have a canonical Oracle MLBAM
identity, then permits a provisional join only when the conservative normalized
player name is unique in both the Oracle universe and the GemRate baseball
snapshot. Normalization removes case, diacritic, punctuation, apostrophe, and
repeated whitespace differences. It is a comparison key, not proof of identity.

There is no fuzzy matching. Any normalized name shared by multiple source rows
or multiple Oracle players is quarantined as `ambiguous`; mixed-era chronology
such as the current `Will Smith` row is also quarantined. Unmatched players are
left without market evidence. Unique normalized-name matches can contribute to
a provisional numeric score, but cannot emit `build`, `hold`, `watch`, `trim`,
or `pass` guidance.

Actionable identity is currently restricted to a small fail-closed manual roster
reviewed on 2026-07-24 against the exact Oracle MLBAM identity, exact GemRate
source spelling, and grading-year chronology: Aaron Judge, Bobby Witt Jr., Juan
Soto, Mike Trout, Mookie Betts, and Shohei Ohtani. Any row or identifier drift
automatically falls back to provisional status. The response reports
`ambiguousSourceKeys`, `matchedUniversePlayers`, and
`actionableUniversePlayers` so this coverage is visible.

## Freshness and Reproducibility

The market snapshot is monthly. Every response publishes:

- `marketDataThrough`: the final month represented by the snapshot;
- `baseballFreshness`: completed-season model status and reason codes;
- `marketPublishedAt`: when that source edition was published;
- `marketAcquiredAt`: when the permitted export was acquired;
- `marketFreshness.status` and any reason codes;
- `marketFreshness.nextExpectedBy`: the refresh deadline; and
- `snapshot.id`: a deterministic digest of the Oracle ranking snapshot, GemRate
  row snapshot, model version, and score outputs.

The market snapshot is `current` through `nextExpectedBy` and `stale` after that
instant. Stale market data withholds actions rather than silently presenting old
demand as current. `baseballDataAsOf` is reported separately because Oracle
baseball evidence and the monthly market snapshot have different cadences.
Completed-season baseball evidence remains current during the following season;
if a replacement model has not arrived by April 1 after that following season,
the baseball input becomes stale and actions are withheld. The field reports the
model's evidence date, not the date on which its artifact was generated.
Unknown freshness also withholds actions. Snapshot ingestion rejects materially
truncated cohorts and requires `dataThrough ≤ publishedAt ≤ acquiredAt`.

Consumers should persist the response `snapshot.id`, `modelVersion`, cohort ID,
and both data-as-of fields with any saved decision.

## Interpretation Limits

GemRate sales volume is used only as a directional collector-demand proxy. It
measures completed eBay singles sales-volume dollars represented by the
permitted snapshot. It does **not** measure price appreciation, future value,
investment return, card condition, population scarcity, transaction costs,
liquidity at a specific price, or the performance of any particular card.

The baseball side describes a statistical Hall-caliber career trajectory. It is
not an estimate of actual Hall of Fame induction odds and cannot account for
future health, performance, awards voting, off-field events, or changes in
collector taste.

Binder Score v1 is research-only and is not financial, investment, tax, or legal
advice. It is a prioritization aid for building a personal collection. The
GemRate permission statement recorded for this task is documented in
`docs/permissions/GEMRATE_ATTESTATION.md`; that attestation must not be read as a
broader license.
