from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

try:
    from modeling.career_chapters import role_track
    from modeling.relative_standing import experience_band
except ModuleNotFoundError:
    from career_chapters import role_track
    from relative_standing import experience_band


ALPHA_SIGNAL_VERSION = "alpha-signal-v1"
BASELINE_MINIMUM_SEASON = 1961
MINIMUM_BASELINE_PLAYERS = 500
BASELINE_AGE_WINDOWS = (2, 3, 4, 5, 6)
MINIMUM_RUNWAY_YEARS = 2.0
MAXIMUM_EARLY_SEASON = 6
PRIORITY_DELTA = 0.10
MINIMUM_DIAGNOSTIC_SELECTION_PLAYERS = 30


class AlphaSignalError(ValueError):
    pass


@dataclass(frozen=True)
class HistoricalHallEstimate:
    probability: float
    players: int
    landmarks: int
    role_track: str
    experience_band: str
    season_number_min: int
    season_number_max: int
    age_min: int
    age_max: int
    age_window: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "probability": round(self.probability, 8),
            "minimumSeason": BASELINE_MINIMUM_SEASON,
            "players": self.players,
            "landmarks": self.landmarks,
            "roleTrack": self.role_track,
            "experienceBand": self.experience_band,
            "seasonNumberMin": self.season_number_min,
            "seasonNumberMax": self.season_number_max,
            "ageMin": self.age_min,
            "ageMax": self.age_max,
            "ageWindow": self.age_window,
            "resolvedOnly": True,
            "referenceSeasonsBeforeFeature": True,
            "playerEqualWeighted": True,
        }


class HistoricalHallBaseline:
    """Broad, prior-only Hall-caliber base rates with equal player influence."""

    required_columns = {
        "bbref_id",
        "season",
        "age",
        "season_number",
        "role",
        "starter_share",
        "resolved_career",
        "target_eligible",
        "hof_caliber",
    }

    def __init__(
        self,
        panel: pd.DataFrame,
        *,
        minimum_players: int = MINIMUM_BASELINE_PLAYERS,
        age_windows: Sequence[int] = BASELINE_AGE_WINDOWS,
    ) -> None:
        missing = sorted(self.required_columns - set(panel.columns))
        if missing:
            raise AlphaSignalError(
                f"Historical Hall baseline panel is missing columns: {missing}"
            )
        if minimum_players < 20:
            raise AlphaSignalError(
                "Historical Hall baseline requires at least 20 reference players"
            )
        windows = tuple(int(value) for value in age_windows)
        if (
            not windows
            or windows[0] < 2
            or tuple(sorted(set(windows))) != windows
            or any(value < 0 for value in windows)
        ):
            raise AlphaSignalError(
                "Historical Hall baseline age windows must be unique, ascending, "
                "and begin at two or wider"
            )

        reference = panel.loc[
            panel["resolved_career"].eq(True)
            & panel["target_eligible"].eq(True)
            & panel["hof_caliber"].notna()
            & pd.to_numeric(panel["season"], errors="coerce").ge(
                BASELINE_MINIMUM_SEASON
            )
        ].copy()
        for column in ("season", "age", "season_number", "starter_share"):
            reference[column] = pd.to_numeric(reference[column], errors="coerce")
        reference["hof_caliber"] = reference["hof_caliber"].astype(bool)
        reference = reference.loc[
            reference["bbref_id"].notna()
            & np.isfinite(reference["season"])
            & np.isfinite(reference["age"])
            & np.isfinite(reference["season_number"])
        ].copy()
        reference["bbref_id"] = reference["bbref_id"].astype(str)
        reference["track"] = [role_track(row) for row in reference.to_dict("records")]
        reference = reference.loc[
            reference["track"].isin(("hitter", "starter", "reliever"))
        ].copy()
        reference["age_floor"] = np.floor(reference["age"]).astype(int)
        reference["experience_band"] = reference["season_number"].map(
            lambda value: experience_band(value).key
        )
        self.minimum_players = int(minimum_players)
        self.age_windows = windows
        self.reference = reference.reset_index(drop=True)
        self.groups = {
            (str(track), str(band)): group.reset_index(drop=True)
            for (track, band), group in self.reference.groupby(
                ["track", "experience_band"], sort=True
            )
        }

    def estimate(
        self, feature: Mapping[str, Any] | pd.Series
    ) -> HistoricalHallEstimate | None:
        try:
            track = role_track(feature)
            band = experience_band(feature["season_number"])
            feature_season = int(feature["season"])
            feature_age = float(feature["age"])
            player_id = str(feature["bbref_id"])
        except (KeyError, TypeError, ValueError):
            return None
        if track is None or not math.isfinite(feature_age):
            return None
        group = self.groups.get((track, band.key))
        if group is None:
            return None
        prior = group.loc[
            group["season"].lt(feature_season)
            & group["bbref_id"].ne(player_id)
        ]
        age_floor = int(math.floor(feature_age))
        for window in self.age_windows:
            cohort = prior.loc[
                prior["age_floor"].between(age_floor - window, age_floor + window)
            ]
            players = int(cohort["bbref_id"].nunique())
            if players < self.minimum_players:
                continue
            row_counts = cohort.groupby("bbref_id")["bbref_id"].transform("size")
            weights = 1.0 / row_counts.to_numpy(dtype=float)
            probability = float(
                np.average(cohort["hof_caliber"].to_numpy(dtype=float), weights=weights)
            )
            return HistoricalHallEstimate(
                probability=probability,
                players=players,
                landmarks=int(len(cohort)),
                role_track=track,
                experience_band=band.key,
                season_number_min=band.minimum,
                season_number_max=band.maximum,
                age_min=age_floor - window,
                age_max=age_floor + window,
                age_window=window,
            )
        return None

    def report(self) -> dict[str, Any]:
        player_outcomes = self.reference.drop_duplicates("bbref_id")
        return {
            "version": ALPHA_SIGNAL_VERSION,
            "status": "research_only",
            "releaseEligible": False,
            "basis": "completed_seasons_only",
            "minimumSeason": BASELINE_MINIMUM_SEASON,
            "referencePlayers": int(self.reference["bbref_id"].nunique()),
            "referenceLandmarks": int(len(self.reference)),
            "hallCaliberPlayers": int(player_outcomes["hof_caliber"].sum()),
            "baselinePolicy": {
                "minimumPlayers": self.minimum_players,
                "ageWindows": list(self.age_windows),
                "matching": "role_track_experience_band_supported_age_window",
                "referenceSeasons": "strictly_before_feature_season",
                "weighting": "equal_total_weight_per_player",
            },
            "eligibilityPolicy": {
                "maximumCompletedMlbSeason": MAXIMUM_EARLY_SEASON,
                "minimumYearsBeforeLearnedTrackPrime": MINIMUM_RUNWAY_YEARS,
                "absoluteCeiling": "p90_jaws_margin_ge_zero",
                "ranking": "probability_delta_desc_then_three_year_impact_desc_then_age_asc",
            },
            "tierPolicy": {
                "priority": f"eligible_and_probability_delta_ge_{PRIORITY_DELTA:.2f}",
                "watch": "eligible_and_probability_delta_gt_zero",
                "none": "otherwise",
            },
            "disclosures": [
                "Alpha edge is modeled Hall-caliber probability minus an empirical "
                "historical base rate, not expected investment return.",
                "The baseline is descriptive and the current scoring refit has not "
                "been prospectively validated.",
                "No small current-player peer cohort enters eligibility or rank.",
            ],
        }


def _withheld_alpha(
    feature: Mapping[str, Any] | pd.Series,
    warning: str,
) -> dict[str, Any]:
    return {
        "version": ALPHA_SIGNAL_VERSION,
        "status": "withheld",
        "tier": "withheld",
        "basis": "completed_seasons_only",
        "featureSeason": int(feature.get("season", 0)),
        "eligible": False,
        "rank": None,
        "rankScope": None,
        "modeledProbability": None,
        "baseline": None,
        "edge": None,
        "ceiling": None,
        "runway": None,
        "nearTermImpact": None,
        "historicalPace": None,
        "gates": {
            "supportedBaseline": False,
            "completedEvidence": False,
            "earlyCareer": False,
            "prePrimeRunway": False,
            "absoluteCeiling": False,
        },
        "warnings": [warning, "research_only"],
    }


def build_alpha_signal(
    feature: Mapping[str, Any] | pd.Series,
    *,
    modeled_probability: float | None,
    jaws_margin: Mapping[str, Any] | None,
    career_chapter: Mapping[str, Any] | None,
    historical_signal: Mapping[str, Any] | None,
    baseline_reference: HistoricalHallBaseline,
    prime_start_age: float | None,
    partial_feature: bool = False,
) -> dict[str, Any]:
    if partial_feature:
        return _withheld_alpha(feature, "partial_season_feature_not_eligible_for_alpha")
    if modeled_probability is None or not math.isfinite(float(modeled_probability)):
        return _withheld_alpha(feature, "modeled_hall_probability_unavailable")
    if not isinstance(jaws_margin, Mapping) or jaws_margin.get("p90") is None:
        return _withheld_alpha(feature, "jaws_tail_ceiling_unavailable")
    if not isinstance(career_chapter, Mapping) or career_chapter.get("status") != "research":
        return _withheld_alpha(feature, "career_chapter_unavailable_for_alpha")
    baseline = baseline_reference.estimate(feature)
    if baseline is None:
        return _withheld_alpha(feature, "historical_hall_baseline_insufficient_support")

    modeled = float(np.clip(float(modeled_probability), 0.0, 1.0))
    delta = modeled - baseline.probability
    lift = None if baseline.probability <= 0.0 else modeled / baseline.probability
    p90_margin = float(jaws_margin["p90"])
    age = float(feature["age"])
    season_number = int(feature["season_number"])
    if prime_start_age is None or not math.isfinite(float(prime_start_age)):
        return _withheld_alpha(feature, "learned_prime_boundary_unavailable")
    prime_age = float(prime_start_age)
    runway_years = prime_age - age
    early_career = season_number <= MAXIMUM_EARLY_SEASON
    runway_gate = runway_years >= MINIMUM_RUNWAY_YEARS
    ceiling_gate = p90_margin >= 0.0
    eligible = bool(early_career and runway_gate and ceiling_gate and delta > 0.0)
    tier = (
        "priority"
        if eligible and delta >= PRIORITY_DELTA
        else "watch"
        if eligible
        else "none"
    )

    trajectory = career_chapter.get("exceptionalTrajectory")
    near_term = None
    if isinstance(trajectory, Mapping) and trajectory.get("probability") is not None:
        impact_probability = float(trajectory["probability"])
        base_rate = float(trajectory.get("referenceBaseRate", 0.0))
        near_term = {
            "probability": round(impact_probability, 8),
            "referenceBaseRate": round(base_rate, 8),
            "liftMultiple": (
                None if base_rate <= 0 else round(impact_probability / base_rate, 3)
            ),
            "target": trajectory.get("target"),
        }
    historical_pace = None
    pace = (
        historical_signal.get("historicalPace")
        if isinstance(historical_signal, Mapping)
        else None
    )
    if isinstance(pace, Mapping):
        historical_pace = {
            "percentile": pace.get("percentile"),
            "referencePlayers": pace.get("cohortSize"),
            "metric": pace.get("metric"),
        }

    return {
        "version": ALPHA_SIGNAL_VERSION,
        "status": "research",
        "tier": tier,
        "basis": "completed_seasons_only",
        "featureSeason": int(feature["season"]),
        "eligible": eligible,
        "rank": None,
        "rankScope": "current_mlb_eligible_absolute_alpha" if eligible else None,
        "modeledProbability": round(modeled, 8),
        "baseline": baseline.as_dict(),
        "edge": {
            "probabilityDelta": round(delta, 8),
            "liftMultiple": None if lift is None else round(lift, 3),
        },
        "ceiling": {
            "p90JawsMargin": round(p90_margin, 3),
            "gatePassed": ceiling_gate,
            "target": "final_jaws_minus_career_to_date_standard",
        },
        "runway": {
            "age": round(age, 2),
            "learnedTrackPrimeStartAge": round(prime_age, 2),
            "yearsToPrime": round(runway_years, 2),
            "minimumRequiredYears": MINIMUM_RUNWAY_YEARS,
            "gatePassed": runway_gate,
        },
        "nearTermImpact": near_term,
        "historicalPace": historical_pace,
        "gates": {
            "supportedBaseline": True,
            "completedEvidence": True,
            "earlyCareer": early_career,
            "prePrimeRunway": runway_gate,
            "absoluteCeiling": ceiling_gate,
        },
        "warnings": [
            "research_only",
            "alpha_edge_is_not_expected_investment_return",
            "current_scoring_refit_not_prospectively_validated",
            "p90_ceiling_is_tail_scenario_not_most_likely_outcome",
            "historical_baseline_is_descriptive_not_causal",
            "market_price_not_modeled",
        ],
    }


def rank_alpha_signals(players: list[dict[str, Any]]) -> None:
    eligible = [
        player
        for player in players
        if isinstance(player.get("alphaSignal"), Mapping)
        and player["alphaSignal"].get("status") == "research"
        and player["alphaSignal"].get("eligible") is True
    ]
    eligible.sort(
        key=lambda player: (
            -float(player["alphaSignal"]["edge"]["probabilityDelta"]),
            -float(
                (player["alphaSignal"].get("nearTermImpact") or {}).get(
                    "probability", 0.0
                )
            ),
            float(player["alphaSignal"]["runway"]["age"]),
            str(player.get("bbrefId", "")),
        )
    )
    for rank, player in enumerate(eligible, start=1):
        player["alphaSignal"]["rank"] = rank


def _outcome_summary(frame: pd.DataFrame) -> dict[str, float | int | None]:
    if frame.empty:
        return {
            "landmarks": 0,
            "players": 0,
            "eventPlayers": 0,
            "weightedEventRate": None,
        }
    counts = frame.groupby("bbref_id")["bbref_id"].transform("size").astype(float)
    weights = 1.0 / counts.to_numpy(dtype=float)
    player_outcomes = frame.drop_duplicates("bbref_id")
    return {
        "landmarks": int(len(frame)),
        "players": int(frame["bbref_id"].nunique()),
        "eventPlayers": int(player_outcomes["hof_caliber"].astype(bool).sum()),
        "weightedEventRate": float(
            np.average(frame["hof_caliber"].to_numpy(dtype=float), weights=weights)
        ),
    }


def retrospective_alpha_diagnostic(
    panel: pd.DataFrame,
    tournament: Any,
    boundaries: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Retrospective audit on the frozen player-disjoint development holdout."""

    split = tournament.split
    reference_ids = set(split.train_players) | set(split.calibration_players)
    reference_panel = panel.loc[panel["bbref_id"].isin(reference_ids)].copy()
    baseline_reference = HistoricalHallBaseline(reference_panel)
    test = panel.loc[
        panel["bbref_id"].isin(split.test_players)
        & panel["target_eligible"].eq(True)
        & panel["role"].astype(str).eq(panel["target_role"].astype(str))
        & pd.to_numeric(panel["season"], errors="coerce").ge(
            BASELINE_MINIMUM_SEASON
        )
        & pd.to_numeric(panel["season_number"], errors="coerce").le(
            MAXIMUM_EARLY_SEASON
        )
    ].copy()
    test = test.sort_values(["bbref_id", "season"], kind="mergesort").reset_index(
        drop=True
    )
    if test.empty:
        raise AlphaSignalError("Alpha diagnostic development holdout is empty")
    prediction = tournament.ranking_model.predict_distribution(test)
    probabilities = np.asarray(prediction[0], dtype=float)
    margin_quantiles = np.asarray(prediction[4], dtype=float)
    if margin_quantiles.shape != (len(test), 5):
        raise AlphaSignalError("Alpha diagnostic JAWS margins have invalid shape")

    records: list[dict[str, Any]] = []
    for index, feature in test.iterrows():
        track = role_track(feature)
        boundary = boundaries.get(str(track), {})
        prime_start = boundary.get("primeStartAge")
        baseline = baseline_reference.estimate(feature)
        if baseline is None or prime_start is None:
            continue
        age = float(feature["age"])
        runway = float(prime_start) - age
        modeled = float(np.clip(probabilities[index], 0.0, 1.0))
        delta = modeled - baseline.probability
        p90_margin = float(margin_quantiles[index, 4])
        records.append(
            {
                "bbref_id": str(feature["bbref_id"]),
                "season": int(feature["season"]),
                "season_number": int(feature["season_number"]),
                "hof_caliber": bool(feature["hof_caliber"]),
                "modeled_probability": modeled,
                "baseline_probability": baseline.probability,
                "probability_delta": delta,
                "p90_jaws_margin": p90_margin,
                "runway_years": runway,
                "eligible": bool(
                    runway >= MINIMUM_RUNWAY_YEARS
                    and p90_margin >= 0.0
                    and delta > 0.0
                ),
            }
        )
    evaluated = pd.DataFrame(records)
    if evaluated.empty:
        raise AlphaSignalError(
            "Alpha diagnostic lacks supported development-holdout landmarks"
        )
    candidate_landmarks = int(len(evaluated))
    evaluated = (
        evaluated.sort_values(
            ["bbref_id", "season_number", "season"],
            ascending=[True, True, True],
            kind="mergesort",
        )
        .drop_duplicates("bbref_id", keep="first")
        .reset_index(drop=True)
    )
    early = evaluated.loc[evaluated["runway_years"].ge(MINIMUM_RUNWAY_YEARS)]
    eligible = evaluated.loc[evaluated["eligible"]].copy()
    base = _outcome_summary(early)
    selected = _outcome_summary(eligible)
    base_rate = base["weightedEventRate"]
    selected_rate = selected["weightedEventRate"]
    enrichment = (
        None
        if (
            base_rate is None
            or selected_rate is None
            or float(base_rate) <= 0.0
            or int(selected["players"]) < MINIMUM_DIAGNOSTIC_SELECTION_PLAYERS
        )
        else float(selected_rate) / float(base_rate)
    )
    top = eligible.iloc[0:0].copy()
    if not eligible.empty:
        ordered = eligible.sort_values(
            ["probability_delta", "modeled_probability", "bbref_id", "season"],
            ascending=[False, False, True, True],
            kind="mergesort",
        )
        top_players = max(1, int(math.ceil(ordered["bbref_id"].nunique() * 0.20)))
        player_order = ordered.drop_duplicates("bbref_id").head(top_players)["bbref_id"]
        top = ordered.loc[ordered["bbref_id"].isin(set(player_order))]
    top_summary = _outcome_summary(top)
    top_rate = top_summary["weightedEventRate"]
    top_lift = (
        None
        if (
            base_rate is None
            or top_rate is None
            or float(base_rate) <= 0.0
            or int(top_summary["players"])
            < MINIMUM_DIAGNOSTIC_SELECTION_PLAYERS
        )
        else float(top_rate) / float(base_rate)
    )
    return {
        "status": "retrospective_architecture_audit_only",
        "split": "player_disjoint_development_holdout",
        "champion": tournament.champion_name,
        "reference": {
            "cohorts": "training_plus_calibration_only",
            "players": int(baseline_reference.reference["bbref_id"].nunique()),
            "minimumSeason": BASELINE_MINIMUM_SEASON,
        },
        "snapshotPolicy": {
            "selection": "earliest_supported_early_career_snapshot_per_player",
            "candidateLandmarks": candidate_landmarks,
            "evaluatedSnapshots": int(len(evaluated)),
            "maximumSnapshotsPerPlayer": 1,
            "minimumPlayersForLiftEstimate": MINIMUM_DIAGNOSTIC_SELECTION_PLAYERS,
        },
        "supportedEarly": base,
        "eligible": {
            **selected,
            "precisionLiftVsSupportedEarly": enrichment,
        },
        "topEligibleTwentyPercentByProbabilityDelta": {
            **top_summary,
            "precisionLiftVsSupportedEarly": top_lift,
        },
        "gates": {
            "maximumCompletedMlbSeason": MAXIMUM_EARLY_SEASON,
            "minimumYearsBeforeLearnedTrackPrime": MINIMUM_RUNWAY_YEARS,
            "absoluteCeiling": "p90_jaws_margin_ge_zero",
            "positiveProbabilityDelta": True,
        },
        "warnings": [
            "development_holdout_was_human_reviewed_during_model_development",
            "chapter_boundaries_were_learned_from_the_full_post_1961_panel",
            "not_prospective_validation",
        ],
    }
