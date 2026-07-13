# Oracle Career Index V1

Status: research-only product index
Version: `career-index-war-v1`
Player Map version: `oracle-player-map/v2`

## Purpose

The Oracle Career Index is a fixed 0-100 summary of the magnitude of a player's
terminal career-WAR distribution. It answers a different question from stage
rank: how much career value is present in the modeled middle and upside
scenarios, measured against the same fixed baseball milestones for every player?

The index is not a probability, percentile, confidence score, expected WAR,
Hall of Fame induction estimate, or investment-return forecast.

## Formula

Each final-career WAR scenario is mapped by piecewise-linear interpolation through
these frozen anchors:

| Final career WAR | Index value | Descriptive territory |
| ---: | ---: | --- |
| 0 | 0 | No positive career value |
| 5 | 20 | Useful MLB contribution |
| 20 | 45 | Durable regular career |
| 40 | 65 | Star-level career value |
| 60 | 80 | Hall-stat neighborhood |
| 80 | 92 | Clear Hall-caliber statistical value |
| 100 | 100 | Inner-circle career value |

Values below zero map to zero and values above 100 WAR map to 100. If `T(w)` is
that transform, the index is:

```text
Career Index = 0.50 * T(final WAR P50)
             + 0.30 * T(final WAR P75)
             + 0.20 * T(final WAR P90)
```

The result is rounded to one decimal. P50, P75, and P90 must be finite and
ordered. A missing, withheld, or malformed distribution produces `null`, never
zero. Anchors and weights are part of the versioned contract and cannot change
without a new index version.

## Three Separate Signals

Player Map v2 keeps three concepts separate:

1. `careerIndex`: absolute modeled career-value magnitude on the fixed scale.
2. `stageStanding`: exact rank, universe, top-share percentage, and tail band
   inside the player's declared stage cohort.
3. Evidence: sample depth, source coverage, and confidence context that describes
   how much trust to place in the output.

Evidence never raises or lowers the Career Index. Stage standing never enters the
Career Index formula. A player can therefore have a modest absolute index and an
exceptional stage rank; that is expected for rare but highly uncertain prospects.

## Stage Policy

- **Prospects:** use the unconditional terminal WAR distribution. The zero-value
  no-arrival component remains in the forecast. Stage standing uses the frozen
  6,455-player prospect artifact, even when the active directory contains fewer
  matched players.
- **Rookie Track:** carry the exact frozen prospect Career Index and prospect
  stage standing through the first partial MLB season. Current MLB WAR, playing
  opportunity, and role-relative evidence are separate confirmation signals and
  do not alter the frozen prior.
- **MLB:** use the supported completed-season terminal WAR distribution and the
  declared current-MLB rank universe.
- **Unmatched Rookie Track records:** publish `careerIndex.value = null` and a
  null stage standing rather than inventing a prospect prior.
- **Two-way or unsupported forecasts:** remain withheld until a supported route
  exists.

Rookie Track graduates only when a supported completed-season MLB Career Oracle
forecast replaces the prospect route. That route transition can change the
index because MLB arrival and new completed-season evidence are then part of the
forecast. Daily partial-season statistics cannot change it.

## Directory Policy

Directory is an identity and coverage surface, not a combined stage ranking. It
defaults to player-name order and permits a noncompetitive age sort. The API can
explicitly order all routes by `sort=careerIndex` because Career Index values
share a fixed numerical scale. That ordering does not create a shared rank target
or universe: `stageStanding` remains stage-specific, and forecast maturity and
reliability still differ by route.

## Research Limitations

The current prospect bridge is not a directly trained MiLB-to-career model.
Minor-league performance shapes the arrival component, while the conditional
career distribution is primarily role and projected-debut-age based. Its arrival
model failed registered external release gates. Low absolute prospect index
values are therefore an honest consequence of the unconditional distribution,
not a reason to stretch the scale.

The MLB model is a terminal landmark distribution, not a simulated annual aging,
injury, playing-time, or exit path. Position-specific JAWS proximity remains a
separate MLB research output. It is not folded into Career Index v1 because the
prospect bridge does not export a coherent position-specific JAWS distribution.

## Partner Contract

Player Map v2 publishes:

```text
assessment.careerIndex.version
assessment.careerIndex.value
assessment.careerIndex.scale
assessment.careerIndex.route
assessment.careerIndex.status
assessment.careerIndex.asOf
assessment.careerIndex.definition
assessment.careerIndex.forecastLineage.modelVersion
assessment.careerIndex.forecastLineage.targetVersion
assessment.careerIndex.forecastLineage.dataVersion
assessment.careerIndex.forecastLineage.providerVersion

assessment.stageStanding.rank
assessment.stageStanding.universe
assessment.stageStanding.topPercent
assessment.stageStanding.tailBand
assessment.stageStanding.cohort
assessment.stageStanding.version
assessment.stageStanding.metric
assessment.stageStanding.target
assessment.stageStanding.method
assessment.stageStanding.direction
assessment.stageStanding.scope
assessment.stageStanding.isFilteredResultOrdinal
assessment.stageStanding.asOf

assessment.careerIndexComparableAcrossRoutes = true
assessment.stageStandingComparableWithinStageOnly = true
```

Backstop should persist the full objects and their versions with any derived card
signal. During migration, `assessment.oracleScore` remains available as the
legacy rounded stage-rank percentile. It must not be relabeled as Career Index or
compared across stages. Backstop should combine Oracle baseball signals with
independently modeled price, liquidity, scarcity, grading, and transaction-cost
evidence; Career Index is not market alpha by itself.
