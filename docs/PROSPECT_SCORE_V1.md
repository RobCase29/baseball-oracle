# Prospect Score V1

Status: research-only ordinal ranking

Version: `prospect-score/v1`
Model: `milb-impact-five-calendar-year-war-v1`

## What It Answers

Prospect Score ranks supported pre-debut players on one explicit frozen target:
at least 5 total MLB WAR during the 2026-2030 calendar seasons. Features are
cut off at 2025-12-31. It is an individualized
rank from the completed-season impact model, which uses performance, age, level,
and role together. It is not a probability, confidence estimate, Hall of Fame
probability, card-value estimate, or expected investment return.

The displayed 0-100 value is the player's exact ordinal percentile in the frozen
6,455-player impact universe. Higher is better. Exact rank and universe remain
canonical so a rounded display cannot create false ties. A null score means
unavailable or withheld, never zero.

## Product Policy

For prospects, Prospect Score is the primary board and dossier ranking. Three
other readings stay separate:

1. **Ceiling if MLB:** the Career Index built from conditional terminal-career
   WAR scenarios. The current bridge is driven primarily by role and projected
   debut age, so it is context, not the prospect leaderboard.
2. **Long-term potential rank:** the frozen career-outcome standing. It remains
   available for research but does not replace the direct impact rank.
3. **Current evidence:** live statistics, scouting, sample depth, and trait
   coverage. These show whether fresh evidence agrees with the frozen score; they
   do not silently rewrite it.

The score is comparable only within its declared frozen prospect universe. It is
not comparable with Rookie Track or MLB scores.

## July 2026 Audit

The audit reproduced the concern that many young players shared a 20.1 Career
Index. That tie came from the conditional terminal bridge, not the individualized
impact model. The impact rank separated the reviewed players as follows:

| Player | Impact rank | Prospect Score |
| --- | ---: | ---: |
| Edward Florentino | 34 | 99.49 |
| Dauri Fernandez | 163 | 97.49 |
| Jorge Quintana | 329 | 94.92 |
| Anderson Araujo | 2,280 | 64.69 |
| Daniel Hernandez | 4,585 | 28.97 |

Age was ablated rather than manually discounted. In player-purged,
expanding-origin out-of-fold evaluation, the full impact model achieved AP
0.1766, AUC 0.9342, and Brier score 0.00883. Removing age reduced AP to 0.1424,
AUC to 0.9239, and worsened Brier score to 0.00905. The full model beat the
no-age model in all 500 seeded player-cluster bootstrap samples; the AP improvement had
a 95% interval of +0.0144 to +0.0525. An age/role/level-only model was materially
weaker at AP 0.1052 and AUC 0.8750. Age adds real information, but performance is
the larger driver of the reviewed players' rankings.

Young low-level calibration is not uniform. Among players age 19 or younger, the
weighted prediction was 0.00694 against a 0.00390 observed rate. Foreign Rookie
players were mildly overpredicted (3,310 rows but only two events), while the
small A-ball cohort was underpredicted (37 rows and two events). The correct next
challenger is level- and evidence-aware shrinkage, not a blanket age penalty.

## Rejected Terminal Challenger

No new direct minor-to-terminal-career model was promoted. The strict resolved
sample contained 10,014 players but only 756 resolved MLB careers, one resolved
career at or above 5 WAR, and none at or above 10 WAR. Another 1,414 careers were
censored, including 270 players already above 5 WAR and 35 above 20 WAR. Training
on resolved careers would therefore learn survivorship in the wrong direction.

A terminal challenger requires older point-in-time MiLB cohorts or a properly
censored multi-state survival model. Until then, Prospect Score is the supported
near-term ranking and Ceiling if MLB remains visibly conditional.

## Reproduction

Run the checked-in audit from the repository root:

```bash
PYTHONPATH=. .venv/bin/python scripts/audits/audit_prospect_score_challenger.py
```

It reads the locked historical prospect panel, mature five-year outcomes, OOF
predictions, current completed-2025 scores, career-resolution data, and complete
2025 MLB WAR corpus. The expanding-origin folds, player purge, player-equal
weights, bootstrap seeds, and challenger definitions are fixed in the script.

## API Contract

The legacy `stage=Minors` request still defaults to `sort=careerIndex` for API
compatibility. Opt in with `stage=Minors&sort=prospectScore`. In the full
response, read:

```text
playerMap.scores.outcome.value
playerMap.scores.outcome.rank
playerMap.scores.outcome.universe
playerMap.scores.outcome.target
playerMap.scores.outcome.asOf
playerMap.scores.outcome.status
```

For `view=map`, replace `playerMap` with `assessment`. The opt-in response adds
`meta.prospectScoreContract`, including every canonical field path, the fixed
2026-2030 window, feature cutoff, and percentile formula. Validate that contract
and `meta.ordering` before trusting row order.
