# Modeling Contract

## Purpose

Baseball Oracle answers two related but distinct questions:

1. Given everything knowable at a prediction timestamp, what is the probability that a player who has not debuted will reach MLB within a stated horizon?
2. Given everything knowable after debut, what is the probability distribution over that player's remaining career path?

Every output is a point-in-time forecast, not a timeless player grade. The product should say "36% probability of an MLB debut within three years as of 2026-07-11," not merely "36% confidence." Model confidence is a separate concept represented by interval width, data completeness, model disagreement, and out-of-distribution warnings.

The baseball forecast must also remain separate from an investment forecast. Expected collectible or contract return additionally depends on price, liquidity, fees, popularity, and market behavior. Those belong in a later market model and must not be smuggled into the player-development target.

## Prediction Landmarks

Predictions are made from immutable snapshots at a declared `as_of` timestamp. Initial production landmarks should be:

- Weekly snapshots for every affiliated player who has not appeared in an MLB regular-season game.
- A debut snapshot for every new MLB player.
- End-of-day updates during an MLB season and end-of-season updates thereafter.
- Explicit development landmarks such as first 100 MLB plate appearances or batters faced, used for comparable backtests.

Hitters and pitchers require different performance models. Two-way players receive both component forecasts plus a joint playing-time model. All ages should be exact age at the snapshot or age-season midpoint, never a rounded age copied from a current profile.

Repeated snapshots from one player are correlated. Training and uncertainty estimation must cluster by player, and dense snapshot histories must not give long-tenured players disproportionate weight.

## Target 1: Reaching MLB

### Canonical event

`mlb_debut` is the player's first official appearance in an MLB regular-season game. Spring training, postseason-only activity, a 40-man roster assignment, and an MLB contract without a game appearance do not count. The official game and appearance records are the source of truth.

The model estimates the cumulative incidence

`P(T_debut <= as_of + horizon | history available at as_of)`

at 12, 24, 36, and 60 months. A probability of debut by age 30 can serve as a stable long-range endpoint. An undefined "ever" probability should not be the primary score because young careers are heavily right-censored and the endpoint changes with assumptions about retirement and foreign-league returns.

One-game call-ups and sustained MLB careers are economically different. Preserve debut as the clean primary event, then publish separately defined secondary endpoints such as:

- Probability of reaching a configurable MLB playing-time threshold.
- Probability of completing at least one full service-year equivalent.
- Probability of producing at least 1, 3, or 5 cumulative MLB WAR within five years of debut.

Thresholds must be versioned and position-aware. They must never be silently changed to make historical performance look better.

### Risk set and event process

The denominator is every player under an affiliated professional contract and observed in the roster census at the landmark, including players with no game statistics. Excluding complex-league players, injured players, released players, or players who never receive a durable public identifier creates survivorship bias.

Use a discrete-time survival model over calendar months or baseball-season intervals. Model debut, temporary inactivity/foreign play, re-entry, and confirmed terminal exit as a multi-state process. Release is not automatically terminal; players can return through independent or foreign leagues. Retirement is terminal only when supported by a reliable event or an explicit, versioned inactivity rule.

The first benchmark should be a regularized cause-specific logistic hazard model. A gradient-boosted survival model can then capture nonlinearities. Derive every horizon from the hazard curve so the 12-, 24-, and 60-month probabilities cannot contradict one another.

## Target 2: MLB Career Arc

### Forecast object

The career model should return a joint distribution, not a single career-WAR estimate. For each remaining age-season, project:

- Roster state: MLB active, MLB injured list, optioned/minors, foreign/independent, inactive, or retired.
- Role and playing time: plate appearances, batters faced, innings, starts, relief usage, and defensive position.
- Rate components appropriate to the role, with uncertainty.
- Replacement level, run environment, and WAR under a named, versioned WAR definition.
- Probability of terminal exit and probability of later re-entry.

From Monte Carlo career paths, derive median and 50%, 80%, and 95% intervals for seasonal and career WAR, peak seven-year WAR, best season, age of peak, career length, milestone probabilities, and seasons above useful star-level thresholds. Preserve simulated paths so derived quantities remain internally consistent.

Model playing opportunity separately from performance conditional on playing. A single regression on observed WAR conflates talent, health, roster decisions, and opportunity, and produces biased aging curves because only survivors accumulate late-career statistics.

### Recommended model stack

Use a transparent hierarchy before attempting a monolithic neural model:

1. A multi-state survival model for roster status, role transitions, injury absence, and exit.
2. A hurdle/count model for playing time conditional on roster state.
3. Hierarchical dynamic models for rate components, with partial pooling by age, level, league, role, position, handedness, and era.
4. Explicit minor-to-major translations learned only from players and seasons available at the training cutoff.
5. A versioned WAR calculator that consumes simulated components and run environment.
6. A forward-validated ensemble with gradient-boosted residual models where they add measurable value.

Empirical-Bayes shrinkage is essential for small samples. Raw rates from 20 plate appearances or batters faced must not be treated as equally precise to full-season rates. The model should carry denominator and measurement error through the forecast.

### Hall of Fame outcomes

Hall of Fame induction is rare, delayed by decades, affected by eligibility rules and voting behavior, and therefore a poor direct label for current prospects. Initially report objective, probabilistic "Hall-of-Fame-caliber" components:

- Career and peak-WAR threshold probabilities.
- Probability of ten or more MLB seasons.
- Position-specific career-value percentile.
- Milestone and award-value probabilities under versioned definitions.

A separate induction model can be trained on retired, eligible cohorts. It must condition on ballot era and eligibility rules and must not replace the underlying career distribution.

## Cohorting and Censoring

The system must distinguish the following mechanisms:

- **Right censoring:** an active player has not yet debuted or finished a career by the data cutoff. This player is not a negative example.
- **Delayed entry:** observation begins after a player's professional career started. The survival likelihood begins at the first reliable risk-set observation.
- **Interval censoring:** an event is only known to have occurred between two dated observations.
- **Competing transitions:** debut, confirmed retirement, death, foreign-league movement, and temporary inactivity have different meanings.
- **Structural missingness:** the canceled 2020 affiliated minor-league season and changes in league structure are not ordinary missing games.

Fit censored likelihoods directly. Use inverse-probability-of-censoring weighting only for metrics or estimands that cannot be expressed through the survival likelihood, and inspect the stability of those weights.

Report performance by signing/first-pro cohort, exact age, hitter/pitcher, position or role, domestic draft versus international signing, league level, organization, data-coverage tier, and era. Small-group calibration should use hierarchical estimates and uncertainty rather than noisy standalone corrections.

The post-debut model is conditional on debut and is therefore selected on success. It is valid for players who have debuted, but its estimates cannot be applied to all minor leaguers as though they were unconditional. A full pre-debut career-value product must combine the arrival probability and the conditional career distribution, preferably through a joint simulation.

## Leakage Prevention

All features must pass an as-of join: the source fact's `known_at` must be no later than the prediction timestamp. The following are common leakage paths:

- Full-season statistics in a midseason snapshot.
- A player's highest level for the year when the promotion occurred later.
- Prospect rankings attached to the season rather than their publication date.
- Transactions, injuries, roster status, option status, or signing information announced after the snapshot.
- Park, league, or run-environment factors computed using games after the snapshot.
- Retrospectively corrected measurements or scouting grades without a documented historical publication time.
- Normalization, imputation, feature selection, calibration, or target encoding fit on future cohorts.
- A historical training row labeled using an outcome that would not yet have been known at the simulated training date.
- A player universe reconstructed only from players who eventually debuted or retained identifiers.

Roster and transaction features are legitimate if they were known at prediction time, but they encode club judgment and can dominate performance discoveries. Maintain two feature sets: a performance-only model and an all-public-information model. Their difference is useful, and it prevents hidden front-office signals from being mistaken for novel player-development relationships.

Every training run must store the data cutoff, label-availability cutoff, feature manifest, transformation-fit window, code version, and immutable source snapshot identifiers.

## Calibration and Uncertainty

Discrimination is not calibration. A useful 30% group should debut about 30% of the time at the stated horizon.

Reserve a chronological calibration window after model fitting and before the untouched test period. Evaluate Platt/beta calibration and isotonic regression; choose only by forward validation. Calibration must be horizon-specific, and survival calibration must account for censoring. Do not calibrate on the training data or on pooled random folds.

For arrival forecasts, report:

- Calibration-in-the-large and calibration slope.
- Reliability curves with equal-count bins and confidence bands.
- Brier score and integrated Brier score with censoring adjustment.
- Log loss where outcomes are mature.
- Time-dependent ROC AUC, precision-recall AUC, concordance, and top-k lift.
- Calibration and error by the cohorts listed above.

For career distributions, report CRPS or an equivalent proper distributional score, weighted interval score, median absolute error, and empirical coverage of 50%, 80%, and 95% intervals. Check probability integral transform diagnostics and score playing time, rate performance, seasonal value, and cumulative value separately.

Each user-facing forecast should include:

- The calibrated probability or predictive quantiles.
- A calibration band estimated from comparable historical cases.
- A data-completeness grade.
- An out-of-distribution score for unusual age, league, role, or measurement coverage.
- Model or ensemble disagreement.
- The top contributing evidence, described as predictive rather than causal.

Use bootstrap or Bayesian posterior uncertainty clustered by player and cohort. Aleatoric career uncertainty, parameter uncertainty, and missing-data uncertainty should not be collapsed into an unexplained "confidence" badge.

## Evaluation Protocol

Use rolling-origin, point-in-time backtests. For every simulated origin:

1. Reconstruct the roster universe and all facts known at that origin.
2. Train transformations and models only on observations and labels available by that origin.
3. Calibrate on an earlier chronological window using only then-available outcomes.
4. Issue predictions for the next cohort without refitting.
5. Score matured outcomes; use censoring-aware metrics for unresolved outcomes.

Keep a final era-based holdout untouched until model and calibration choices are frozen. Random row splits are prohibited. Also publish a cold-start evaluation in which no earlier snapshot of the test player appears in training, alongside the realistic online-retraining evaluation where a player's historical observations may legitimately be available.

Compare against strong, frozen baselines:

- Cohort base rates by age, level, role, and era.
- A simple age, level, playing-time, performance, and acquisition-capital model.
- Public prospect grades or projection systems only when their historical as-of snapshots and licenses are valid.

Ranked-investment evaluation should include precision/recall and lift in the top 1%, 5%, and 10%, but rankings do not replace proper probability scores. Simulated financial return belongs only in an explicitly separate market backtest using prices actually available at the prediction timestamp, transaction costs, liquidity, and a predeclared strategy.

Before release, require:

- Better Brier score and log loss than the simple baseline across multiple forward folds.
- No material horizon-order violations.
- Acceptable calibration slope and interval coverage overall and in major cohorts.
- Stable results under alternate defensible debut and playing-time target definitions.
- Documented degradation tests for missing scouting, tracking, injury, and acquisition data.
- A model card describing population, exclusions, known blind spots, and last validation date.

## Discovery Discipline

Novel relationships are hypotheses until they survive time. Candidate features should be tested on forward holdouts, with transformations fit inside each fold. Large feature searches require false-discovery control, stability checks across eras and organizations, negative controls, and replication on a locked cohort. Feature importance and SHAP values explain model behavior; they do not establish that changing a feature would change a player's outcome.

