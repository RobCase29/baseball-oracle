# Backstop Ranking Engine Audit: July 13, 2026

## Executive decision

Baseball Oracle can be a useful ranking engine for Backstop today, but it is not
yet a live, universal alpha engine. The immediate product problem is not a lack of
one more blended score. It is the combination of incomplete player coverage,
coarse Career Index bands, a completed-2025 scoring artifact, and insufficiently
explicit evidence states.

The engine should publish three separate objects:

1. **Prospect Score:** a pre-debut, stage-specific rank for near-term MLB impact.
2. **Career Index:** a conditional long-career ceiling and runway guardrail.
3. **Evidence status:** whether the rank comes from the supported full model, a
   shrunken cold-start prior, or an unresolved coverage gap.

Backstop should use those baseball outputs without averaging them into a mystery
number. A later market model should estimate card return from price, scarcity,
liquidity, grading population, fees, and demand while preserving Oracle's baseball
forecast as an independent input.

## What the Bowman audit found

The active 2026 Bowman checklist contained 310 players: 178 minor leaguers, 107
major leaguers, and 25 rookies. Thirty-four players had no Career Index. Among the
minor leaguers, 154 had a Career Index, but those players occupied only 16 distinct
values. The five largest value bins contained 71.4% of the scored minor leaguers.
That compression made materially different prospects appear interchangeable and
left alphabetical order or another incidental stable key to resolve too many ties.

The production minor-league universe contained 6,207 players. Only 3,785, or
61.0%, exposed a Prospect Score. The missing group had two different causes:

- 741 players already existed in the frozen impact artifact, but the separate
  arrival workload gate suppressed their score.
- 1,681 players were absent from the frozen artifact entirely.

The second group is not simply a group of players with no evidence. At least 820
of the unscored players met the applicable 2026 workload thresholds. Their absence
is direct evidence that a completed-2025 artifact cannot serve as a current player
scorer.

Coverage also varied materially by role and level. Prospect Score coverage was
54.4% for pitchers, 69.1% for hitters, and only 43.2% at rookie level. Backstop
must expose those gaps rather than interpret a null as zero talent.

## Prospect Score V2 decision

V2 removes the unrelated arrival gate from the impact-ranking decision. It uses
one of two pre-trained paths:

| Evidence state | Ranking path | Product status |
| --- | --- | --- |
| Frozen workload supported | Regularized impact model | `scored` |
| Frozen workload below minimum | Hierarchical age-level-role-performance prior | `insufficient_sample` |
| No exact frozen artifact | No manufactured score | `coverage_gap` |

The thin-sample prior is not an age bonus. It pools players by age, level, role,
and a performance band, then shrinks sparse evidence toward a broader baseball
baseline. The regularized model resolves ties only inside an identical prior band.
This supplies a useful cold-start ordering without allowing a few plate appearances
to create a top-of-universe full-model claim.

Exact rank is canonical; the 0-100 value is display shorthand. Consumers must
persist the rank, universe, stage, target, mapping status, feature date, scored
date, snapshot ID, and model contract. Null means unavailable, never zero.

The current FanGraphs board is also admitted as a **census source** through exact
MLBAM identifiers. It can restore otherwise missing current prospects to the
directory and attach current descriptive/scouting context. Names are never used
to create an identity join, and a current board row does not manufacture a model
score when the exact player is absent from the frozen scoring artifact.

## Backstop ranking semantics

Backstop has more than one decision surface, so it should not force every workflow
through one universal sort:

| Surface | Primary order | Secondary order | Reason |
| --- | --- | --- | --- |
| Mixed-stage directory or checklist | Career Index descending | Exact MiLB Prospect Score rank ascending inside the ceiling band, then stable ID | Keeps career ceiling comparable while avoiding alphabetic ties among prospects |
| MiLB discovery and 1st Bowman lens | Exact Prospect Score rank ascending | Career Index descending, then stable ID | Surfaces the earliest impact signal while retaining an age/runway guardrail |
| Rookie Track | Rookie-stage model rank | Prospect prior as context only | Treats early MLB evidence as confirmation, not an abrupt prospect reset |
| Established MLB | MLB career-stage rank | Current evidence and uncertainty | Prevents prospect ranks from being compared numerically with veteran ranks |

The interface and export should show Prospect Score and Career Index separately,
along with a plain-language evidence label such as `Full model`, `Early estimate`,
or `Data gap`. An unmatched player stays in checklist order with an explicit reason;
it is never silently dropped or assigned zero.

## Freshness contract

Current source ingestion is scheduled twice daily, but current statistics and
current model predictions are not the same thing. The present Prospect Score and
Career Index artifacts use completed-2025 model features. A July 2026 source check
can update identity, assignment, workload, and descriptive evidence without
changing the frozen model rank.

Every API response therefore needs four independent clocks:

- `sourceObservedThrough`
- `featureAsOf`
- `scoredAt`
- `modelTrainedThrough`

Backstop should refresh only from a completely validated, immutable Oracle batch.
It should retain the previous good batch if a source group is incomplete, identity
resolution regresses, or the new prediction universe fails coverage and movement
gates.

## Honest gaps

1. There is no scheduled point-in-time feature builder for the current active
   universe.
2. There is no current scorer, batch validator, or atomic prediction publisher;
   twice-daily raw refreshes do not change the completed-2025 ranks.
3. The 1,681 players absent from the frozen artifact still require a new feature
   snapshot and scorer. A census overlay can make them discoverable, but it cannot
   infer their model output.
4. Current performance lacks full fold-fitted league, park, and level translation,
   effective-dated promotion velocity, injuries, transactions, and complete
   tracking coverage.
5. Current scouting can provide valuable disagreement evidence, but historical
   revisions need evidenced `known_at` timestamps before entering a strict
   point-in-time model.
6. The registered S-tier model tournament has not been executed. No current model
   should be described as ultimate, calibrated investment confidence, or a
   Hall-of-Fame probability.
7. Backstop does not yet have a trained market-return target. A baseball rank alone
   cannot establish that a card is underpriced.

## Prioritized path to a true alpha engine

### P0: Universal current census and scoreability

- Build an immutable daily active-player census across assignments, injured and
  inactive states, new signings, complex leagues, promotions, demotions, and MLB
  debuts.
- Resolve sources only through exact durable identifiers and publish quarantine
  counts for conflicts and missing crosswalks.
- Measure coverage by role, level, organization, age, source, and checklist after
  every refresh. Block publication on unexpected regressions.
- Preserve a prior-led cold-start score for every identity-resolved player whose
  minimum inputs exist; keep true source gaps null and explicit.

### P1: Point-in-time feature and scoring pipeline

- Materialize versioned weekly in-season feature snapshots using only information
  known at the scoring timestamp.
- Add fold-fitted league, park, level, and era translations; promotion velocity;
  role and workload history; age-to-level; availability; and coverage-aware
  tracking components.
- Run the full model only when its minimum evidence contract passes. Otherwise use
  the frozen hierarchical prior and publish an uncertainty/evidence tier.
- Validate row counts, identities, score movement, missingness, drift, and stage
  transitions before atomically publishing one signed prediction batch.
- Trigger Backstop ingestion from that published batch rather than rebuilding from
  an arbitrary live request.

### P2: Execute the registered model tournament

- Run `modeling/config/s-tier-tournament-v1.json` with player-clustered rolling
  prediction origins and every transformation fit inside its fold.
- Compare transparent hierarchical priors, elastic-net models, generalized
  additive models, boosted survival/classification models, random survival
  forests, joint state/value models, and nonnegative out-of-fold ensembles.
- Keep performance-only and all-public-information entrants separate. Require
  scouting, acquisition capital, tracking, and organization context to earn entry
  through registered forward ablations.
- Select on calibration and proper scores first, then top-1%, top-5%, and top-10%
  lift, cold-start performance, rare-tail precision, stability, and coverage.
- Freeze prospective weekly snapshots so future rank movement and outcomes can be
  evaluated without rewriting history.

### P3: Link arrival, early impact, and career arc

- Jointly model arrival timing, MLB opportunity, performance components,
  durability, exit/re-entry, annual WAR, peak value, and career length.
- Carry the prospect posterior into Rookie Track, then update it with early MLB
  evidence instead of hiding the player or resetting the forecast at debut.
- Simulate career paths with calibrated uncertainty and derive Hall-caliber career
  thresholds separately from actual Hall induction.
- Keep role-specific outputs comparable through a common terminal baseball-value
  distribution, not by comparing stage score numbers directly.

### P4: Build Backstop market alpha

- Archive point-in-time public prospect ranks and projections so Oracle can measure
  a `discoveryEdge`: the residual between Oracle's baseball distribution and public
  consensus on the same date.
- Build a separate card model using timestamped sold and unsold listings, card
  identity, parallel/serial, grade, population, price, fees, liquidity, demand,
  and holding horizon.
- Estimate expected net return, probability of loss, liquidity-adjusted return,
  and downside risk. Use Oracle distributions and discovery edge as inputs, not as
  the return label itself.
- Evaluate prospect selection and card selection independently, then together in a
  locked historical portfolio simulation with realistic availability and costs.

## Definition of first-class

The ranking engine becomes production-grade when it can score or explicitly
classify every active exact-ID player, publish a current immutable batch on schedule,
survive stage transitions without losing a player, beat registered baselines on
locked temporal evaluation, expose calibrated uncertainty and evidence quality,
and prove incremental portfolio value after price, fees, liquidity, and downside
risk. Until then, it should remain a transparent research rank with unusually good
lineage, not a promise of investment return.
