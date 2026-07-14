# Prospect Score V2

Status: research-only stage ranking

Version: `prospect-score/v2`
Model family: `milb-impact-five-calendar-year-war-v1`

## Decision Contract

Prospect Score ranks pre-debut players on at least 5 total MLB WAR during the
2026-2030 calendar seasons. It is an ordinal score in one frozen 6,455-player
universe, not a probability, confidence estimate, card-price forecast, or Hall
of Fame probability. Exact rank is canonical; the 0-100 value is its display
percentile.

Career Index remains separate. It describes the conditional career ceiling if
the player reaches MLB and includes projected debut age and remaining runway.
For checklist ranking, use Career Index as the long-horizon ceiling guardrail
and exact Prospect Score rank to resolve players inside the same ceiling band.
This prevents both alphabetical ties and a late-age tiny sample from displacing
a materially younger player with a stronger career runway.

## Thin-Sample Policy

V1 suppressed the impact rank whenever the separate arrival model's completed-
season workload gate failed. That conflated two models and produced blanks for
players who were identity-resolved and already scoreable by the impact artifact.

V2 uses the tournament's pre-trained transparent hierarchical prior for those
players. The prior uses age, level, role, and a raw-performance band with
hierarchical shrinkage. The regularized model may resolve ordering only inside
an identical prior band; it cannot move a player across prior bands. Responses
are marked `mappingStatus=insufficient_sample`, and the score basis states that
the result is prior-led. Once the frozen workload gate clears, the regularized
full-model rank is used and the mapping becomes `scored`.

This is intentionally not a hand-tuned age penalty. For example, Carson Taylor's
eight-PA completed-season full-model rank was number 8, while his hierarchical
prior rank is number 1,052. The latter remains useful but no longer presents a
thin late-age sample as a top-of-universe full-model result. Matthew Ferrara's
young A-ball prior ranks number 563 with the same explicit low-evidence status.

## Coverage Semantics

- `scored`: the frozen full-model workload is supported.
- `insufficient_sample`: a prior-led Prospect Score is available.
- `coverage_gap`: identity is present but no frozen impact artifact exists.
- `withheld`: the baseball state or forecast contract does not support a claim.

Null always means unavailable and never means zero. Current statistics and
scouting remain separate evidence until a scheduled feature builder, scorer,
and atomic publisher pass the prospective validation gate.

## API

Request the compact contract with:

```text
GET /api/players?stage=Minors&sort=prospectScore&view=map
```

Read `assessment.scores.outcome` and validate
`meta.prospectScoreContract.version=prospect-score/v2`. The contract publishes
the full-model and thin-sample model names, the thin-sample policy, the mapping
status used for prior-led scores, and `careerIndex` as the runway guardrail.
Consumers must persist the exact rank, universe, target, as-of time, mapping
status, snapshot ID, and model contract with every downstream ranking.

## Checklist Ranking

For a MiLB-only checklist, use the product hierarchy:

1. Backstop Rank ascending, sourced from the exact Prospect Score rank.
2. Career Outlook descending, sourced from `careerIndex`.
3. Current Results as separate observed context.
4. Stable player identity as the final deterministic tie-breaker.

Show Backstop Rank and Career Outlook with their labels. Career Outlook answers
the conditional long-career question; Backstop Rank distinguishes near-term
impact paths. Do not average the two or compare a Minors Backstop Rank numerically
with Rookie Track or MLB ranks. A card application should add price, liquidity,
scarcity, grading population, and fees
in its own market-alpha layer rather than feeding those variables into Oracle's
baseball forecast.
