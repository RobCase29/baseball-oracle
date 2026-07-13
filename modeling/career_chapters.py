from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)


CAREER_CHAPTER_VERSION = "career-chapter-v1"
CHAPTER_MINIMUM_SEASON = 1961
CHAPTER_SMOOTHING_BANDWIDTH = 2
CHAPTER_MINIMUM_CURVE_PLAYERS = 100
TRAJECTORY_HORIZON_SEASONS = 3
TRAJECTORY_QUANTILE = 0.90
TRACKS = ("hitter", "starter", "reliever")
MODEL_FEATURES = (
    "age",
    "season_number",
    "season_war",
    "career_war_to_date",
    "war_last_three",
    "war_best_to_date",
    "career_war_per_season",
    "prior_war_per_season",
    "war_trend",
    "starter_share",
    "track_code",
)


class CareerChapterError(ValueError):
    pass


@dataclass(frozen=True)
class OriginSplit:
    train_end: int
    calibration_start: int
    calibration_end: int
    test_start: int
    test_end: int

    def as_dict(self) -> dict[str, int | bool]:
        return {
            "trainEndYear": self.train_end,
            "calibrationStartYear": self.calibration_start,
            "calibrationEndYear": self.calibration_end,
            "testStartYear": self.test_start,
            "testEndYear": self.test_end,
            "chronologicalPredictionOrigin": True,
        }


def _required_panel_columns() -> set[str]:
    return {
        "bbref_id",
        "season",
        "age",
        "season_number",
        "role",
        "season_war",
        "career_war_to_date",
        "war_last_three",
        "war_best_to_date",
        "career_war_per_season",
        "starter_share",
    }


def role_track(feature: Mapping[str, Any] | pd.Series) -> str | None:
    role = str(feature.get("role", ""))
    if role == "hitter":
        return "hitter"
    if role != "pitcher":
        return None
    share = pd.to_numeric(
        pd.Series([feature.get("starter_share")]), errors="coerce"
    ).iloc[0]
    return "starter" if pd.notna(share) and float(share) >= 0.4 else "reliever"


def _player_equal_weights(frame: pd.DataFrame) -> np.ndarray:
    counts = frame.groupby("bbref_id")["bbref_id"].transform("size").astype(float)
    weights = 1.0 / counts.to_numpy(dtype=float)
    return weights / weights.mean()


def _weighted_quantile(
    values: Sequence[float], quantile: float, weights: Sequence[float]
) -> float:
    array = np.asarray(values, dtype=float)
    weight = np.asarray(weights, dtype=float)
    if (
        len(array) == 0
        or len(array) != len(weight)
        or not np.isfinite(array).all()
        or not np.isfinite(weight).all()
        or (weight <= 0).any()
        or not 0.0 <= quantile <= 1.0
    ):
        raise CareerChapterError("Weighted quantile inputs are invalid")
    order = np.argsort(array, kind="stable")
    ordered = array[order]
    ordered_weights = weight[order]
    cumulative = np.cumsum(ordered_weights) - 0.5 * ordered_weights
    cumulative /= ordered_weights.sum()
    return float(np.interp(quantile, cumulative, ordered))


def _absolute_training_threshold(training: pd.DataFrame) -> float:
    if "future_three_war" not in training.columns:
        raise CareerChapterError(
            "Absolute trajectory training rows require future_three_war"
        )
    return _weighted_quantile(
        training["future_three_war"],
        TRAJECTORY_QUANTILE,
        _player_equal_weights(training),
    )


def _prepare_landmarks(panel: pd.DataFrame) -> pd.DataFrame:
    missing = sorted(_required_panel_columns() - set(panel.columns))
    if missing:
        raise CareerChapterError(f"Career chapter panel is missing columns: {missing}")
    frame = panel.copy().sort_values(["bbref_id", "season"], kind="mergesort")
    for column in (
        "season",
        "age",
        "season_number",
        "season_war",
        "career_war_to_date",
        "war_last_three",
        "war_best_to_date",
        "career_war_per_season",
        "starter_share",
    ):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.loc[
        frame["bbref_id"].notna()
        & frame["role"].isin(["hitter", "pitcher"])
        & np.isfinite(frame["season"])
        & np.isfinite(frame["age"])
        & np.isfinite(frame["season_number"])
        & np.isfinite(frame["season_war"])
    ].copy()
    frame["bbref_id"] = frame["bbref_id"].astype(str)
    frame["track"] = [role_track(row) for row in frame.to_dict("records")]
    frame = frame.loc[frame["track"].isin(TRACKS)].copy()
    frame["age_floor"] = np.floor(frame["age"]).astype(int)
    grouped = frame.groupby("bbref_id", sort=False)
    frame["prior_war_per_season"] = grouped["season_war"].transform(
        lambda values: values.shift(1).rolling(3, min_periods=1).mean()
    )
    frame["war_trend"] = frame["season_war"] - frame["prior_war_per_season"]
    frame["track_code"] = frame["track"].map(
        {"hitter": 0.0, "starter": 1.0, "reliever": 2.0}
    )
    return frame.reset_index(drop=True)


def _one_year_observations(
    frame: pd.DataFrame, latest_complete_season: int
) -> pd.DataFrame:
    eligible = frame.loc[
        frame["season"].between(CHAPTER_MINIMUM_SEASON, latest_complete_season - 1)
    ].copy()
    next_rows = frame[["bbref_id", "season", "season_war"]].copy()
    next_rows["season"] = next_rows["season"] - 1
    next_rows = next_rows.rename(columns={"season_war": "next_season_war"})
    eligible = eligible.merge(
        next_rows,
        on=["bbref_id", "season"],
        how="left",
        validate="one_to_one",
    )
    eligible["continuation"] = eligible["next_season_war"].notna().astype(float)
    eligible["next_season_war"] = eligible["next_season_war"].fillna(0.0)
    eligible["unconditional_war_change"] = (
        eligible["next_season_war"] - eligible["season_war"]
    )
    return eligible


def _smooth_track_curve(
    observations: pd.DataFrame,
    track: str,
    *,
    bandwidth: int = CHAPTER_SMOOTHING_BANDWIDTH,
    minimum_players: int = CHAPTER_MINIMUM_CURVE_PLAYERS,
) -> list[dict[str, float | int]]:
    subset = observations.loc[observations["track"].eq(track)].copy()
    if subset.empty:
        raise CareerChapterError(f"Career chapter track has no observations: {track}")
    subset["player_weight"] = _player_equal_weights(subset)
    ages = range(int(subset["age_floor"].min()), int(subset["age_floor"].max()) + 1)
    curve: list[dict[str, float | int]] = []
    for age in ages:
        distance = (subset["age_floor"] - age).abs()
        kernel = (bandwidth + 1 - distance).clip(lower=0).astype(float)
        local = subset.loc[kernel.gt(0)].copy()
        local_kernel = kernel.loc[kernel.gt(0)].to_numpy(dtype=float)
        players = int(local["bbref_id"].nunique())
        if players < minimum_players:
            continue
        weights = local["player_weight"].to_numpy(dtype=float) * local_kernel
        curve.append(
            {
                "age": age,
                "players": players,
                "landmarks": int(len(local)),
                "expectedNextWarChange": float(
                    np.average(local["unconditional_war_change"], weights=weights)
                ),
                "continuationRate": float(
                    np.average(local["continuation"], weights=weights)
                ),
            }
        )
    if len(curve) < 8:
        raise CareerChapterError(f"Career chapter curve is too sparse: {track}")
    return curve


def _first_sustained_nonpositive(curve: pd.DataFrame) -> int:
    values = curve["expectedNextWarChange"].to_numpy(dtype=float)
    ages = curve["age"].to_numpy(dtype=int)
    for index in range(len(curve) - 1):
        if values[index] <= 0.0 and values[index + 1] <= 0.0:
            return int(ages[index])
    return int(ages[np.argmin(np.abs(values))])


def _learn_boundaries(curve_rows: Sequence[Mapping[str, Any]]) -> dict[str, int | float]:
    curve = pd.DataFrame(curve_rows).sort_values("age", kind="mergesort")
    prime_start = _first_sustained_nonpositive(curve)
    after_prime = curve.loc[curve["age"].ge(prime_start)]
    negative = after_prime.loc[after_prime["expectedNextWarChange"].lt(0.0)]
    decline_threshold = float(
        negative["expectedNextWarChange"].median()
        if not negative.empty
        else after_prime["expectedNextWarChange"].median()
    )
    decline_candidates = after_prime.loc[
        after_prime["expectedNextWarChange"].le(decline_threshold)
        & after_prime["age"].ge(prime_start + 2)
    ]
    decline_start = int(
        decline_candidates["age"].min()
        if not decline_candidates.empty
        else min(int(curve["age"].max()), prime_start + 3)
    )
    after_decline = curve.loc[curve["age"].ge(decline_start)]
    continuation_threshold = float(after_decline["continuationRate"].median())
    late_candidates = after_decline.loc[
        after_decline["continuationRate"].le(continuation_threshold)
        & after_decline["age"].ge(decline_start + 2)
    ]
    late_start = int(
        late_candidates["age"].min()
        if not late_candidates.empty
        else min(int(curve["age"].max()), decline_start + 3)
    )
    decline_start = max(decline_start, prime_start + 2)
    late_start = max(late_start, decline_start + 2)
    return {
        "primeStartAge": prime_start,
        "declineStartAge": decline_start,
        "lateStartAge": late_start,
        "declineChangeThreshold": decline_threshold,
        "lateContinuationThreshold": continuation_threshold,
    }


def _future_three_outcomes(
    frame: pd.DataFrame, latest_complete_season: int
) -> pd.DataFrame:
    outcome_end = latest_complete_season - TRAJECTORY_HORIZON_SEASONS
    eligible = frame.loc[
        frame["season"].between(CHAPTER_MINIMUM_SEASON, outcome_end)
    ].copy()
    lookup = {
        (str(row.bbref_id), int(row.season)): float(row.season_war)
        for row in frame.itertuples()
    }
    eligible["future_three_war"] = [
        sum(
            lookup.get((str(player_id), int(season) + offset), 0.0)
            for offset in range(1, TRAJECTORY_HORIZON_SEASONS + 1)
        )
        for player_id, season in zip(
            eligible["bbref_id"], eligible["season"], strict=True
        )
    ]
    return eligible.reset_index(drop=True)


def _origin_split(frame: pd.DataFrame) -> OriginSplit:
    years = sorted(int(value) for value in frame["season"].unique())
    if len(years) < 9:
        raise CareerChapterError(
            "Absolute trajectory model requires at least nine prediction-origin years"
        )
    if len(years) >= 15:
        test_start_index = len(years) - 5
        calibration_start_index = max(1, test_start_index - 6)
    else:
        calibration_start_index = max(1, int(math.floor(len(years) * 0.60)))
        test_start_index = max(
            calibration_start_index + 1, int(math.floor(len(years) * 0.80))
        )
    return OriginSplit(
        train_end=years[calibration_start_index] - 1,
        calibration_start=years[calibration_start_index],
        calibration_end=years[test_start_index] - 1,
        test_start=years[test_start_index],
        test_end=years[-1],
    )


def _model_matrix(frame: pd.DataFrame, medians: Mapping[str, float]) -> np.ndarray:
    values: list[np.ndarray] = []
    for column in MODEL_FEATURES:
        numeric = pd.to_numeric(frame[column], errors="coerce").to_numpy(dtype=float)
        fill = float(medians[column])
        numeric[~np.isfinite(numeric)] = fill
        values.append(numeric)
    return np.column_stack(values)


def _logit(probability: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(probability, dtype=float), 1e-6, 1.0 - 1e-6)
    return np.log(clipped / (1.0 - clipped))


def _classification_metrics(
    target: np.ndarray, probability: np.ndarray, weights: np.ndarray
) -> dict[str, float | int | None]:
    y = np.asarray(target, dtype=int)
    p = np.clip(np.asarray(probability, dtype=float), 1e-6, 1.0 - 1e-6)
    result: dict[str, float | int | None] = {
        "landmarks": int(len(y)),
        "events": int(y.sum()),
        "eventRate": float(np.average(y, weights=weights)),
        "brier": float(brier_score_loss(y, p, sample_weight=weights)),
        "logLoss": float(log_loss(y, p, sample_weight=weights, labels=[0, 1])),
        "rocAuc": None,
        "averagePrecision": None,
    }
    if len(np.unique(y)) == 2:
        result["rocAuc"] = float(roc_auc_score(y, p, sample_weight=weights))
        result["averagePrecision"] = float(
            average_precision_score(y, p, sample_weight=weights)
        )
    return result


def _track_thresholds(observations: pd.DataFrame) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for track in TRACKS:
        subset = observations.loc[observations["track"].eq(track)]
        weights = _player_equal_weights(subset)
        launch = subset.loc[subset["season_number"].eq(1)]
        launch_weights = _player_equal_weights(launch)
        residual = subset["unconditional_war_change"].to_numpy(dtype=float)
        residual_center = _weighted_quantile(residual, 0.50, weights)
        tolerance = _weighted_quantile(
            np.abs(residual - residual_center), 0.50, weights
        )
        result[track] = {
            "seasonWarMedian": _weighted_quantile(
                subset["season_war"], 0.50, weights
            ),
            "seasonWarUpperQuartile": _weighted_quantile(
                subset["season_war"], 0.75, weights
            ),
            "launchWarMedian": _weighted_quantile(
                launch["season_war"], 0.50, launch_weights
            ),
            "launchWarQ90": _weighted_quantile(
                launch["season_war"], 0.90, launch_weights
            ),
            "trendTolerance": max(float(tolerance), 0.05),
        }
    return result


def trajectory_state(
    *,
    season_number: int,
    season_war: float,
    war_trend: float | None,
    exceptional_probability: float | None,
    expected_next_war_change: float,
    thresholds: Mapping[str, float],
) -> str:
    if season_number == 1:
        if season_war >= float(thresholds["launchWarQ90"]):
            return "breakout"
        if season_war >= float(thresholds["launchWarMedian"]):
            return "rising"
        return "uncertain"
    if (
        exceptional_probability is not None
        and exceptional_probability >= 0.50
        and season_war >= float(thresholds["seasonWarUpperQuartile"])
        and war_trend is not None
        and war_trend
        > expected_next_war_change + float(thresholds["trendTolerance"])
    ):
        return "breakout"
    if war_trend is None or not math.isfinite(float(war_trend)):
        return "uncertain"
    tolerance = float(thresholds["trendTolerance"])
    if war_trend > expected_next_war_change + tolerance:
        return "rising"
    if war_trend < expected_next_war_change - tolerance:
        return "declining"
    if season_war >= float(thresholds["seasonWarMedian"]):
        return "maintaining"
    return "plateau"


def _chapter_for_feature(
    age: float, season_number: int, boundaries: Mapping[str, int | float]
) -> str:
    if season_number == 1:
        return "launch"
    if age < float(boundaries["primeStartAge"]):
        return "development"
    if age < float(boundaries["declineStartAge"]):
        return "prime_plateau"
    if age < float(boundaries["lateStartAge"]):
        return "decline"
    return "late_career"


def _chapter_label(chapter: str) -> str:
    return {
        "launch": "Launch",
        "development": "Development",
        "prime_plateau": "Prime / plateau",
        "decline": "Decline",
        "late_career": "Late career",
        "uncertain": "Uncertain",
    }[chapter]


def _base_evidence(
    feature: Mapping[str, Any] | pd.Series,
    historical_pace_percentile: float | None,
    prior_war_per_season: float | None,
) -> dict[str, float | int | None]:
    age = float(feature.get("age", math.nan))
    season_number = int(feature.get("season_number", 0))
    season_war = float(feature.get("season_war", math.nan))
    recent = float(feature.get("war_last_three", math.nan))
    prior = (
        float(prior_war_per_season)
        if prior_war_per_season is not None
        and math.isfinite(float(prior_war_per_season))
        else None
    )
    trend = season_war - prior if prior is not None else None
    return {
        "age": round(age, 2),
        "mlbSeasonNumber": season_number,
        "seasonWar": round(season_war, 3),
        "recentWarPerSeason": round(recent, 3),
        "priorWarPerSeason": None if prior is None else round(prior, 3),
        "warTrend": None if trend is None else round(trend, 3),
        "historicalPacePercentile": (
            None
            if historical_pace_percentile is None
            else round(float(historical_pace_percentile), 1)
        ),
    }


def withheld_career_chapter(
    feature: Mapping[str, Any] | pd.Series,
    *,
    historical_pace_percentile: float | None = None,
    prior_war_per_season: float | None = None,
    warning: str = "career_chapter_model_unavailable",
) -> dict[str, Any]:
    track = role_track(feature) or "hitter"
    return {
        "version": CAREER_CHAPTER_VERSION,
        "status": "withheld",
        "chapter": "uncertain",
        "label": "Uncertain",
        "trajectoryState": "uncertain",
        "roleTrack": track,
        "basis": "completed_seasons_only",
        "featureSeason": int(feature.get("season", 0)),
        "evidence": _base_evidence(
            feature, historical_pace_percentile, prior_war_per_season
        ),
        "exceptionalTrajectory": None,
        "support": {
            "referencePlayers": 0,
            "referenceLandmarks": 0,
            "expectedNextWarChange": 0.0,
            "continuationRate": 0.0,
        },
        "warnings": [warning, "research_only"],
    }


class CareerChapterModel:
    def __init__(
        self,
        *,
        curves: Mapping[str, Sequence[Mapping[str, Any]]],
        boundaries: Mapping[str, Mapping[str, int | float]],
        track_thresholds: Mapping[str, Mapping[str, float]],
        classifier: HistGradientBoostingClassifier,
        calibrator: LogisticRegression,
        feature_medians: Mapping[str, float],
        threshold_war: float,
        reference_base_rate: float,
        report: Mapping[str, Any],
    ) -> None:
        self.curves = {key: [dict(row) for row in value] for key, value in curves.items()}
        self.boundaries = {key: dict(value) for key, value in boundaries.items()}
        self.track_thresholds = {
            key: dict(value) for key, value in track_thresholds.items()
        }
        self.classifier = classifier
        self.calibrator = calibrator
        self.feature_medians = dict(feature_medians)
        self.threshold_war = float(threshold_war)
        self.reference_base_rate = float(reference_base_rate)
        self.report = dict(report)

    def _curve_point(self, track: str, age: float) -> dict[str, Any] | None:
        curve = self.curves.get(track, [])
        if not curve:
            return None
        return min(curve, key=lambda row: (abs(float(row["age"]) - age), int(row["age"])))

    def _probability(
        self,
        feature: Mapping[str, Any] | pd.Series,
        track: str,
        prior_war_per_season: float | None,
    ) -> float:
        row = dict(feature)
        row["track_code"] = {"hitter": 0.0, "starter": 1.0, "reliever": 2.0}[track]
        row["prior_war_per_season"] = prior_war_per_season
        row["war_trend"] = (
            None
            if prior_war_per_season is None
            else float(row["season_war"]) - float(prior_war_per_season)
        )
        matrix = _model_matrix(pd.DataFrame([row]), self.feature_medians)
        raw = self.classifier.predict_proba(matrix)[:, 1]
        calibrated = self.calibrator.predict_proba(_logit(raw).reshape(-1, 1))[:, 1]
        return float(np.clip(calibrated[0], 0.0, 1.0))

    def forecast(
        self,
        feature: Mapping[str, Any] | pd.Series,
        *,
        historical_pace_percentile: float | None = None,
        prior_war_per_season: float | None = None,
        partial_feature: bool = False,
    ) -> dict[str, Any]:
        if partial_feature:
            return withheld_career_chapter(
                feature,
                historical_pace_percentile=historical_pace_percentile,
                prior_war_per_season=prior_war_per_season,
                warning="partial_season_feature_not_eligible_for_career_chapter",
            )
        track = role_track(feature)
        evidence = _base_evidence(
            feature, historical_pace_percentile, prior_war_per_season
        )
        if track is None or track not in self.boundaries:
            return withheld_career_chapter(
                feature,
                historical_pace_percentile=historical_pace_percentile,
                prior_war_per_season=prior_war_per_season,
                warning="career_chapter_role_not_supported",
            )
        age = float(evidence["age"])
        season_number = int(evidence["mlbSeasonNumber"])
        curve_point = self._curve_point(track, age)
        if curve_point is None:
            return withheld_career_chapter(
                feature,
                historical_pace_percentile=historical_pace_percentile,
                prior_war_per_season=prior_war_per_season,
                warning="career_chapter_reference_support_missing",
            )
        probability = self._probability(feature, track, prior_war_per_season)
        chapter = _chapter_for_feature(age, season_number, self.boundaries[track])
        state = trajectory_state(
            season_number=season_number,
            season_war=float(evidence["seasonWar"]),
            war_trend=(
                None if evidence["warTrend"] is None else float(evidence["warTrend"])
            ),
            exceptional_probability=probability,
            expected_next_war_change=float(curve_point["expectedNextWarChange"]),
            thresholds=self.track_thresholds[track],
        )
        return {
            "version": CAREER_CHAPTER_VERSION,
            "status": "research",
            "chapter": chapter,
            "label": _chapter_label(chapter),
            "trajectoryState": state,
            "roleTrack": track,
            "basis": "completed_seasons_only",
            "featureSeason": int(feature["season"]),
            "evidence": evidence,
            "exceptionalTrajectory": {
                "probability": round(probability, 8),
                "target": "next_three_war_ge_global_training_q90",
                "thresholdWar": round(self.threshold_war, 3),
                "horizonSeasons": TRAJECTORY_HORIZON_SEASONS,
                "referenceBaseRate": round(self.reference_base_rate, 8),
                "rankScope": "current_mlb_absolute_trajectory",
            },
            "support": {
                "referencePlayers": int(curve_point["players"]),
                "referenceLandmarks": int(curve_point["landmarks"]),
                "expectedNextWarChange": round(
                    float(curve_point["expectedNextWarChange"]), 4
                ),
                "continuationRate": round(float(curve_point["continuationRate"]), 4),
            },
            "warnings": [
                "career_chapter_retrospective_origin_validation_only",
                "chapter_boundaries_learned_post_1961",
                "exceptional_trajectory_is_not_hof_probability",
                "research_only",
            ],
        }


def fit_career_chapter_model(
    panel: pd.DataFrame,
    *,
    latest_complete_season: int,
) -> CareerChapterModel:
    frame = _prepare_landmarks(panel)
    one_year = _one_year_observations(frame, latest_complete_season)
    curves = {track: _smooth_track_curve(one_year, track) for track in TRACKS}
    boundaries = {track: _learn_boundaries(curves[track]) for track in TRACKS}
    thresholds = _track_thresholds(one_year)

    outcomes = _future_three_outcomes(frame, latest_complete_season)
    split = _origin_split(outcomes)
    train = outcomes.loc[outcomes["season"].le(split.train_end)].copy()
    calibration = outcomes.loc[
        outcomes["season"].between(split.calibration_start, split.calibration_end)
    ].copy()
    test = outcomes.loc[outcomes["season"].ge(split.test_start)].copy()
    split_players = (
        train["bbref_id"].nunique(),
        calibration["bbref_id"].nunique(),
        test["bbref_id"].nunique(),
    )
    if min(split_players) < 20:
        raise CareerChapterError("Absolute trajectory origin splits require 20 players each")
    train_weights = _player_equal_weights(train)
    calibration_weights = _player_equal_weights(calibration)
    test_weights = _player_equal_weights(test)
    threshold_war = _absolute_training_threshold(train)
    for cohort in (train, calibration, test):
        cohort["exceptional_trajectory"] = cohort["future_three_war"].ge(
            threshold_war
        ).astype(int)
        if cohort["exceptional_trajectory"].nunique() != 2:
            raise CareerChapterError(
                "Absolute trajectory origin split requires both target classes"
            )

    medians = {
        column: float(pd.to_numeric(train[column], errors="coerce").median())
        for column in MODEL_FEATURES
    }
    x_train = _model_matrix(train, medians)
    x_calibration = _model_matrix(calibration, medians)
    x_test = _model_matrix(test, medians)
    y_train = train["exceptional_trajectory"].to_numpy(dtype=int)
    y_calibration = calibration["exceptional_trajectory"].to_numpy(dtype=int)
    y_test = test["exceptional_trajectory"].to_numpy(dtype=int)
    classifier = HistGradientBoostingClassifier(
        learning_rate=0.05,
        max_iter=120,
        max_leaf_nodes=15,
        min_samples_leaf=40,
        l2_regularization=1.0,
        early_stopping=False,
        random_state=29,
    ).fit(x_train, y_train, sample_weight=train_weights)
    raw_calibration = classifier.predict_proba(x_calibration)[:, 1]
    calibrator = LogisticRegression(
        C=1.0,
        max_iter=2_000,
        random_state=29,
        solver="lbfgs",
    ).fit(
        _logit(raw_calibration).reshape(-1, 1),
        y_calibration,
        sample_weight=calibration_weights,
    )
    calibrated_probability = calibrator.predict_proba(
        _logit(classifier.predict_proba(x_test)[:, 1]).reshape(-1, 1)
    )[:, 1]
    raw_probability = classifier.predict_proba(x_test)[:, 1]
    reference_base_rate = float(np.average(y_train, weights=train_weights))
    report = {
        "version": CAREER_CHAPTER_VERSION,
        "status": "research_only",
        "releaseEligible": False,
        "basis": "completed_seasons_only",
        "chapterTraining": {
            "minimumSeason": CHAPTER_MINIMUM_SEASON,
            "latestOneYearFeatureSeason": latest_complete_season - 1,
            "playerWeighted": True,
            "smoothingBandwidthYears": CHAPTER_SMOOTHING_BANDWIDTH,
            "boundaries": boundaries,
            "tracks": {
                track: {
                    "players": int(
                        one_year.loc[
                            one_year["track"].eq(track), "bbref_id"
                        ].nunique()
                    ),
                    "landmarks": int(one_year["track"].eq(track).sum()),
                }
                for track in TRACKS
            },
        },
        "exceptionalTrajectory": {
            "target": "next_three_war_ge_global_training_q90",
            "thresholdWar": float(threshold_war),
            "trainingQuantile": TRAJECTORY_QUANTILE,
            "horizonSeasons": TRAJECTORY_HORIZON_SEASONS,
            "latestFullyObservedFeatureSeason": latest_complete_season
            - TRAJECTORY_HORIZON_SEASONS,
            "missingSeasonWar": 0.0,
            "referenceBaseRate": reference_base_rate,
            "split": split.as_dict(),
            "calibration": "held_out_sigmoid",
            "rawDevelopmentHoldout": _classification_metrics(
                y_test, raw_probability, test_weights
            ),
            "calibratedDevelopmentHoldout": _classification_metrics(
                y_test, calibrated_probability, test_weights
            ),
        },
        "disclosures": [
            "Career chapters are retrospective empirical states, not career guarantees.",
            "The exceptional-trajectory target is absolute three-season WAR, "
            "not Hall probability.",
            "The development holdout is chronological by prediction origin and "
            "remains research-only.",
        ],
    }
    return CareerChapterModel(
        curves=curves,
        boundaries=boundaries,
        track_thresholds=thresholds,
        classifier=classifier,
        calibrator=calibrator,
        feature_medians=medians,
        threshold_war=threshold_war,
        reference_base_rate=reference_base_rate,
        report=report,
    )
