from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    mean_absolute_error,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler

try:
    from modeling.career_data import (
        CATEGORICAL_FEATURES,
        NUMERIC_FEATURES,
        CareerDataError,
        CareerSplit,
        assert_feature_frame,
        player_equal_weights,
    )
except ModuleNotFoundError:
    from career_data import (
        CATEGORICAL_FEATURES,
        NUMERIC_FEATURES,
        CareerDataError,
        CareerSplit,
        assert_feature_frame,
        player_equal_weights,
    )


RANDOM_SEED = 29
TOURNAMENT_SCHEMA_VERSION = "career-oracle-tournament/v1"
MODEL_VERSION = "career-oracle-jaws-tournament-v2"
TARGET_VERSION = "hof-caliber-point-in-time-jaws-v1"
QUANTILE_NAMES = ("p10", "p25", "p50", "p75", "p90")
QUANTILE_LEVELS = np.asarray((0.10, 0.25, 0.50, 0.75, 0.90), dtype=float)


def feature_frame(panel: pd.DataFrame) -> pd.DataFrame:
    frame = panel.loc[:, [*NUMERIC_FEATURES, *CATEGORICAL_FEATURES]].copy()
    assert_feature_frame(frame)
    return frame


def _age_bucket(age: object) -> str:
    numeric = pd.to_numeric(pd.Series([age]), errors="coerce").iloc[0]
    if pd.isna(numeric):
        return "missing"
    value = int(math.floor(float(numeric)))
    if value < 21:
        return "under_21"
    if value >= 38:
        return "38_plus"
    lower = 21 + ((value - 21) // 3) * 3
    return f"{lower}_{lower + 2}"


class AgePositionEmpiricalPrior(BaseEstimator, ClassifierMixin):
    """Smoothed point-in-time age/position prior with explicit fallback levels."""

    def __init__(self, smoothing: float = 20.0):
        self.smoothing = smoothing

    def fit(
        self,
        frame: pd.DataFrame,
        target: Sequence[int],
        sample_weight: Sequence[float] | None = None,
    ) -> "AgePositionEmpiricalPrior":
        required = {"age", "position", "role"}
        missing = sorted(required - set(frame.columns))
        if missing:
            raise CareerDataError(f"Empirical prior is missing fields: {missing}")
        y = np.asarray(target, dtype=float)
        if len(y) != len(frame) or not np.isin(y, [0.0, 1.0]).all():
            raise CareerDataError("Empirical prior target must be aligned binary values")
        weights = (
            np.ones(len(frame), dtype=float)
            if sample_weight is None
            else np.asarray(sample_weight, dtype=float)
        )
        if len(weights) != len(frame) or (weights <= 0).any():
            raise CareerDataError("Empirical prior weights must be aligned and positive")
        data = pd.DataFrame(
            {
                "age_bucket": frame["age"].map(_age_bucket).astype(str),
                "position": frame["position"].astype(str),
                "role": frame["role"].astype(str),
                "target": y,
                "weight": weights,
            }
        )
        self.global_rate_ = float(np.average(y, weights=weights))
        self.classes_ = np.asarray([0, 1], dtype=int)
        self.levels_: list[tuple[tuple[str, ...], dict[tuple[str, ...], float]]] = []
        for columns in (("position", "age_bucket"), ("role", "age_bucket"), ("role",)):
            rates: dict[tuple[str, ...], float] = {}
            for key, group in data.groupby(list(columns), sort=True):
                key_tuple = (str(key),) if isinstance(key, str) else tuple(map(str, key))
                weight = float(group["weight"].sum())
                events = float((group["target"] * group["weight"]).sum())
                rates[key_tuple] = (events + self.smoothing * self.global_rate_) / (
                    weight + self.smoothing
                )
            self.levels_.append((columns, rates))
        return self

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        if not hasattr(self, "levels_"):
            raise CareerDataError("Empirical prior is not fitted")
        data = frame.copy()
        data["age_bucket"] = data["age"].map(_age_bucket).astype(str)
        values: list[float] = []
        for row in data.to_dict("records"):
            probability = self.global_rate_
            for columns, rates in self.levels_:
                key = tuple(str(row[column]) for column in columns)
                if key in rates:
                    probability = rates[key]
                    break
            values.append(float(np.clip(probability, 1e-6, 1.0 - 1e-6)))
        positive = np.asarray(values, dtype=float)
        return np.column_stack([1.0 - positive, positive])


def _linear_preprocessor() -> ColumnTransformer:
    numeric = Pipeline(
        [
            ("impute", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
        ]
    )
    categorical = Pipeline(
        [
            ("impute", SimpleImputer(strategy="constant", fill_value="missing")),
            ("one_hot", OneHotEncoder(handle_unknown="ignore", min_frequency=5)),
        ]
    )
    return ColumnTransformer(
        [("numeric", numeric, list(NUMERIC_FEATURES)), ("categorical", categorical, list(CATEGORICAL_FEATURES))]
    )


def _tree_preprocessor() -> ColumnTransformer:
    numeric = Pipeline(
        [("impute", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True))]
    )
    categorical = Pipeline(
        [
            ("impute", SimpleImputer(strategy="constant", fill_value="missing")),
            (
                "ordinal",
                OrdinalEncoder(
                    handle_unknown="use_encoded_value",
                    unknown_value=-1,
                    encoded_missing_value=-1,
                ),
            ),
        ]
    )
    return ColumnTransformer(
        [("numeric", numeric, list(NUMERIC_FEATURES)), ("categorical", categorical, list(CATEGORICAL_FEATURES))]
    )


def make_logistic_model() -> Pipeline:
    return Pipeline(
        [
            ("features", _linear_preprocessor()),
            (
                "classifier",
                LogisticRegression(
                    C=0.35,
                    max_iter=2_000,
                    random_state=RANDOM_SEED,
                    solver="lbfgs",
                ),
            ),
        ]
    )


def make_nonlinear_model() -> Pipeline:
    return Pipeline(
        [
            ("features", _tree_preprocessor()),
            (
                "classifier",
                HistGradientBoostingClassifier(
                    learning_rate=0.05,
                    max_iter=120,
                    max_leaf_nodes=15,
                    min_samples_leaf=30,
                    l2_regularization=1.0,
                    early_stopping=False,
                    random_state=RANDOM_SEED,
                ),
            ),
        ]
    )


def make_war_regressor() -> Pipeline:
    return Pipeline(
        [
            ("features", _tree_preprocessor()),
            (
                "regressor",
                HistGradientBoostingRegressor(
                    loss="absolute_error",
                    learning_rate=0.05,
                    max_iter=120,
                    max_leaf_nodes=15,
                    min_samples_leaf=30,
                    l2_regularization=1.0,
                    early_stopping=False,
                    random_state=RANDOM_SEED,
                ),
            ),
        ]
    )


def _fit_classifier(model: Any, x: pd.DataFrame, y: np.ndarray, weights: np.ndarray) -> Any:
    if isinstance(model, AgePositionEmpiricalPrior):
        return model.fit(x, y, sample_weight=weights)
    step = "classifier__sample_weight"
    return model.fit(x, y, **{step: weights})


def _logit(probability: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(probability, dtype=float), 1e-6, 1.0 - 1e-6)
    return np.log(clipped / (1.0 - clipped))


class CalibratedStackedEnsemble:
    def __init__(self, base_models: Mapping[str, Any]):
        self.base_models = dict(base_models)

    def fit_calibrator(
        self,
        calibration_x: pd.DataFrame,
        calibration_y: Sequence[int],
        sample_weight: Sequence[float],
    ) -> "CalibratedStackedEnsemble":
        names = tuple(sorted(self.base_models))
        matrix = np.column_stack(
            [_logit(self.base_models[name].predict_proba(calibration_x)[:, 1]) for name in names]
        )
        y = np.asarray(calibration_y, dtype=int)
        if len(np.unique(y)) < 2:
            raise CareerDataError("Ensemble calibration cohort requires both target classes")
        self.base_names_ = names
        self.calibrator_ = LogisticRegression(
            C=0.5,
            max_iter=2_000,
            random_state=RANDOM_SEED,
            solver="lbfgs",
        ).fit(matrix, y, sample_weight=np.asarray(sample_weight, dtype=float))
        return self

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        if not hasattr(self, "calibrator_"):
            raise CareerDataError("Stacked ensemble calibrator is not fitted")
        matrix = np.column_stack(
            [
                _logit(self.base_models[name].predict_proba(frame)[:, 1])
                for name in self.base_names_
            ]
        )
        return self.calibrator_.predict_proba(matrix)


class SigmoidCalibratedClassifier:
    def __init__(self, base_model: Any):
        self.base_model = base_model

    def fit_calibrator(
        self,
        calibration_x: pd.DataFrame,
        calibration_y: Sequence[int],
        sample_weight: Sequence[float],
    ) -> "SigmoidCalibratedClassifier":
        raw_probability = self.base_model.predict_proba(calibration_x)[:, 1]
        y = np.asarray(calibration_y, dtype=int)
        if len(np.unique(y)) < 2:
            raise CareerDataError("Sigmoid calibration cohort requires both target classes")
        self.calibrator_ = LogisticRegression(
            C=1.0,
            max_iter=2_000,
            random_state=RANDOM_SEED,
            solver="lbfgs",
        ).fit(
            _logit(raw_probability).reshape(-1, 1),
            y,
            sample_weight=np.asarray(sample_weight, dtype=float),
        )
        return self

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        if not hasattr(self, "calibrator_"):
            raise CareerDataError("Sigmoid classifier is not calibrated")
        raw_probability = self.base_model.predict_proba(frame)[:, 1]
        return self.calibrator_.predict_proba(_logit(raw_probability).reshape(-1, 1))


def _weighted_quantile(
    values: np.ndarray, quantiles: np.ndarray, weights: np.ndarray
) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    weights = np.asarray(weights, dtype=float)
    if len(values) == 0 or len(values) != len(weights):
        raise CareerDataError("Weighted quantiles require aligned nonempty values and weights")
    order = np.argsort(values, kind="stable")
    sorted_values = values[order]
    sorted_weights = weights[order]
    cumulative = np.cumsum(sorted_weights) - 0.5 * sorted_weights
    cumulative /= sorted_weights.sum()
    return np.interp(quantiles, cumulative, sorted_values)


class ResidualQuantileRegressor:
    """Point model plus calibration-cohort residual quantiles, split by broad role."""

    def __init__(self, target_column: str, anchor_column: str):
        self.target_column = target_column
        self.anchor_column = anchor_column
        self.model = make_war_regressor()

    def fit(
        self,
        training: pd.DataFrame,
        calibration: pd.DataFrame,
        training_weights: np.ndarray,
        calibration_weights: np.ndarray,
    ) -> "ResidualQuantileRegressor":
        training_target = (
            training[self.target_column].to_numpy(dtype=float)
            - training[self.anchor_column].to_numpy(dtype=float)
        )
        self.model.fit(
            feature_frame(training),
            training_target,
            regressor__sample_weight=training_weights,
        )
        calibration_target = (
            calibration[self.target_column].to_numpy(dtype=float)
            - calibration[self.anchor_column].to_numpy(dtype=float)
        )
        predicted = self.model.predict(feature_frame(calibration))
        residuals = calibration_target - predicted
        self.residual_quantiles_: dict[str, np.ndarray] = {
            "global": _weighted_quantile(residuals, QUANTILE_LEVELS, calibration_weights)
        }
        for role in ("hitter", "pitcher"):
            role_mask = calibration["role"].eq(role).to_numpy()
            player_count = calibration.loc[role_mask, "bbref_id"].nunique()
            if player_count >= 20:
                self.residual_quantiles_[role] = _weighted_quantile(
                    residuals[role_mask], QUANTILE_LEVELS, calibration_weights[role_mask]
                )
        return self

    def predict_quantiles(self, frame: pd.DataFrame) -> np.ndarray:
        if not hasattr(self, "residual_quantiles_"):
            raise CareerDataError("Residual quantile regressor is not fitted")
        center = self.model.predict(feature_frame(frame))
        anchors = frame[self.anchor_column].to_numpy(dtype=float)
        rows: list[np.ndarray] = []
        for index, role in enumerate(frame["role"].astype(str)):
            residual = self.residual_quantiles_.get(role, self.residual_quantiles_["global"])
            values = anchors[index] + center[index] + residual
            if self.target_column == "final_peak_seven_war":
                values = np.maximum(values, anchors[index])
            rows.append(np.maximum.accumulate(values))
        return np.vstack(rows)


class JointResidualCareerDistribution:
    """Paired calibration-residual scenarios for coherent WAR, peak, JAWS, and tail risk."""

    def __init__(self, draws: int = 2_048):
        self.draws = draws
        self.final_model = make_war_regressor()
        self.peak_model = make_war_regressor()

    @staticmethod
    def _stage(value: object) -> str:
        season_number = int(value)
        if season_number == 1:
            return "first"
        if season_number <= 3:
            return "seasons_2_3"
        if season_number <= 6:
            return "seasons_4_6"
        if season_number <= 10:
            return "seasons_7_10"
        return "season_11_plus"

    def _draw_bank(
        self, role: str, season_number: object, career_war_to_date: float
    ) -> np.ndarray:
        stage = self._stage(season_number)
        base_key = f"{role}:{stage}"
        edges = self.performance_edges_.get(base_key)
        performance_key = None
        if edges is not None:
            performance = (
                "top_10"
                if career_war_to_date >= edges[1]
                else "upper_30"
                if career_war_to_date >= edges[0]
                else "base_70"
            )
            performance_key = f"{base_key}:{performance}"
        for key in (
            performance_key,
            base_key,
            f"stage:{stage}",
            role,
            "global",
        ):
            if key is None:
                continue
            if key in self.paired_residual_draws_:
                return self.paired_residual_draws_[key]
        return self.paired_residual_draws_["global"]

    @staticmethod
    def _paired_draws(
        final_residual: np.ndarray,
        peak_residual: np.ndarray,
        weights: np.ndarray,
        draws: int,
    ) -> np.ndarray:
        order = np.lexsort((peak_residual, final_residual))
        pairs = np.column_stack([final_residual[order], peak_residual[order]])
        ordered_weights = weights[order].astype(float)
        cumulative = np.cumsum(ordered_weights) / ordered_weights.sum()
        grid = (np.arange(draws, dtype=float) + 0.5) / draws
        indices = np.searchsorted(cumulative, grid, side="left")
        return pairs[np.minimum(indices, len(pairs) - 1)]

    def fit(
        self,
        training: pd.DataFrame,
        calibration: pd.DataFrame,
        training_weights: np.ndarray,
        calibration_weights: np.ndarray,
    ) -> "JointResidualCareerDistribution":
        final_target = (
            training["final_career_war"].to_numpy(dtype=float)
            - training["career_war_to_date"].to_numpy(dtype=float)
        )
        peak_target = (
            training["final_peak_seven_war"].to_numpy(dtype=float)
            - training["peak_seven_war_to_date"].to_numpy(dtype=float)
        )
        self.final_model.fit(
            feature_frame(training),
            final_target,
            regressor__sample_weight=training_weights,
        )
        self.peak_model.fit(
            feature_frame(training),
            peak_target,
            regressor__sample_weight=training_weights,
        )
        final_calibration_target = (
            calibration["final_career_war"].to_numpy(dtype=float)
            - calibration["career_war_to_date"].to_numpy(dtype=float)
        )
        peak_calibration_target = (
            calibration["final_peak_seven_war"].to_numpy(dtype=float)
            - calibration["peak_seven_war_to_date"].to_numpy(dtype=float)
        )
        final_residual = final_calibration_target - self.final_model.predict(
            feature_frame(calibration)
        )
        peak_residual = peak_calibration_target - self.peak_model.predict(
            feature_frame(calibration)
        )
        self.paired_residual_draws_: dict[str, np.ndarray] = {
            "global": self._paired_draws(
                final_residual,
                peak_residual,
                calibration_weights,
                self.draws,
            )
        }
        self.residual_bank_players_: dict[str, int] = {
            "global": int(calibration["bbref_id"].nunique())
        }
        self.performance_edges_: dict[str, tuple[float, float]] = {}
        for role in ("hitter", "pitcher"):
            mask = calibration["role"].eq(role).to_numpy()
            if calibration.loc[mask, "bbref_id"].nunique() >= 20:
                self.paired_residual_draws_[role] = self._paired_draws(
                    final_residual[mask],
                    peak_residual[mask],
                    player_equal_weights(calibration.loc[mask].reset_index(drop=True)),
                    self.draws,
                )
                self.residual_bank_players_[role] = int(
                    calibration.loc[mask, "bbref_id"].nunique()
                )
        stages = calibration["season_number"].map(self._stage)
        for stage in (
            "first",
            "seasons_2_3",
            "seasons_4_6",
            "seasons_7_10",
            "season_11_plus",
        ):
            stage_mask = stages.eq(stage).to_numpy()
            stage_players = int(calibration.loc[stage_mask, "bbref_id"].nunique())
            if stage_players >= 50:
                key = f"stage:{stage}"
                self.paired_residual_draws_[key] = self._paired_draws(
                    final_residual[stage_mask],
                    peak_residual[stage_mask],
                    player_equal_weights(
                        calibration.loc[stage_mask].reset_index(drop=True)
                    ),
                    self.draws,
                )
                self.residual_bank_players_[key] = stage_players
            for role in ("hitter", "pitcher"):
                mask = stage_mask & calibration["role"].eq(role).to_numpy()
                players = int(calibration.loc[mask, "bbref_id"].nunique())
                if players >= 50:
                    key = f"{role}:{stage}"
                    self.paired_residual_draws_[key] = self._paired_draws(
                        final_residual[mask],
                        peak_residual[mask],
                        player_equal_weights(
                            calibration.loc[mask].reset_index(drop=True)
                        ),
                        self.draws,
                    )
                    self.residual_bank_players_[key] = players
                    career_war = calibration.loc[mask, "career_war_to_date"].to_numpy(
                        dtype=float
                    )
                    edge_70, edge_90 = np.quantile(career_war, [0.7, 0.9])
                    self.performance_edges_[key] = (float(edge_70), float(edge_90))
                    for performance, performance_mask in (
                        ("base_70", career_war < edge_70),
                        (
                            "upper_30",
                            (career_war >= edge_70) & (career_war < edge_90),
                        ),
                        ("top_10", career_war >= edge_90),
                    ):
                        local_indices = np.flatnonzero(mask)[performance_mask]
                        local_mask = np.zeros(len(calibration), dtype=bool)
                        local_mask[local_indices] = True
                        local_players = int(
                            calibration.loc[local_mask, "bbref_id"].nunique()
                        )
                        if local_players < 50:
                            continue
                        local_key = f"{key}:{performance}"
                        self.paired_residual_draws_[local_key] = self._paired_draws(
                            final_residual[local_mask],
                            peak_residual[local_mask],
                            player_equal_weights(
                                calibration.loc[local_mask].reset_index(drop=True)
                            ),
                            self.draws,
                        )
                        self.residual_bank_players_[local_key] = local_players
        return self

    def refit_point_models(
        self, training: pd.DataFrame, training_weights: np.ndarray
    ) -> "JointResidualCareerDistribution":
        """Refresh scenario centers without replacing held-out residual banks."""

        if not hasattr(self, "paired_residual_draws_"):
            raise CareerDataError("Residual banks must be fitted before point-model refit")
        final_target = (
            training["final_career_war"].to_numpy(dtype=float)
            - training["career_war_to_date"].to_numpy(dtype=float)
        )
        peak_target = (
            training["final_peak_seven_war"].to_numpy(dtype=float)
            - training["peak_seven_war_to_date"].to_numpy(dtype=float)
        )
        final_model = make_war_regressor()
        peak_model = make_war_regressor()
        final_model.fit(
            feature_frame(training),
            final_target,
            regressor__sample_weight=training_weights,
        )
        peak_model.fit(
            feature_frame(training),
            peak_target,
            regressor__sample_weight=training_weights,
        )
        self.final_model = final_model
        self.peak_model = peak_model
        return self

    def predict_scenarios(
        self, frame: pd.DataFrame, peak_floor: np.ndarray | None = None
    ) -> tuple[np.ndarray, np.ndarray]:
        if not hasattr(self, "paired_residual_draws_"):
            raise CareerDataError("Joint career distribution is not fitted")
        features = feature_frame(frame)
        final_center = (
            frame["career_war_to_date"].to_numpy(dtype=float)
            + self.final_model.predict(features)
        )
        peak_anchor = frame["peak_seven_war_to_date"].to_numpy(dtype=float)
        floor = peak_anchor if peak_floor is None else np.maximum(
            peak_anchor, np.asarray(peak_floor, dtype=float)
        )
        peak_center = peak_anchor + self.peak_model.predict(features)
        final = np.empty((len(frame), self.draws), dtype=float)
        peak = np.empty((len(frame), self.draws), dtype=float)
        for index, (_, row) in enumerate(frame.iterrows()):
            residual = self._draw_bank(
                str(row["role"]),
                row["season_number"],
                float(row["career_war_to_date"]),
            )
            final[index] = final_center[index] + residual[:, 0]
            peak[index] = np.maximum(floor[index], peak_center[index] + residual[:, 1])
        return final, peak

    def predict_distribution(
        self, frame: pd.DataFrame, peak_floor: np.ndarray | None = None
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        features = feature_frame(frame)
        final_center = (
            frame["career_war_to_date"].to_numpy(dtype=float)
            + self.final_model.predict(features)
        )
        peak_anchor = frame["peak_seven_war_to_date"].to_numpy(dtype=float)
        floor = peak_anchor if peak_floor is None else np.maximum(
            peak_anchor, np.asarray(peak_floor, dtype=float)
        )
        peak_center = peak_anchor + self.peak_model.predict(features)
        standards = frame["standard_jaws"].to_numpy(dtype=float)
        probability = np.empty(len(frame), dtype=float)
        final_quantiles = np.empty((len(frame), len(QUANTILE_LEVELS)), dtype=float)
        peak_quantiles = np.empty_like(final_quantiles)
        jaws_quantiles = np.empty_like(final_quantiles)
        jaws_margin_quantiles = np.empty_like(final_quantiles)
        for index, (_, row) in enumerate(frame.iterrows()):
            residual = self._draw_bank(
                str(row["role"]),
                row["season_number"],
                float(row["career_war_to_date"]),
            )
            final = final_center[index] + residual[:, 0]
            peak = np.maximum(floor[index], peak_center[index] + residual[:, 1])
            jaws = (final + peak) / 2.0
            probability[index] = float(np.mean(jaws >= standards[index]))
            final_quantiles[index] = np.quantile(final, QUANTILE_LEVELS)
            peak_quantiles[index] = np.quantile(peak, QUANTILE_LEVELS)
            jaws_quantiles[index] = np.quantile(jaws, QUANTILE_LEVELS)
            jaws_margin_quantiles[index] = np.quantile(
                jaws - standards[index], QUANTILE_LEVELS
            )
        return (
            probability,
            final_quantiles,
            peak_quantiles,
            jaws_quantiles,
            jaws_margin_quantiles,
        )


class CalibratedScenarioTiltDistribution:
    """Reweight paired scenarios to a calibrated classifier tail probability."""

    def __init__(
        self,
        base_distribution: JointResidualCareerDistribution,
        probability_model: Any,
        probability_model_name: str,
    ):
        self.base_distribution = base_distribution
        self.probability_model = probability_model
        self.probability_model_name = probability_model_name

    @staticmethod
    def _ensure_tail_support(
        final: np.ndarray,
        peak: np.ndarray,
        peak_floor: float,
        standard: float,
        probability: float,
    ) -> tuple[np.ndarray, np.ndarray, float]:
        margin = (final + peak) / 2.0 - standard
        elite = margin >= 0.0
        if elite.any() and (~elite).any():
            return final, peak, 0.0
        shifted_final = final.copy()
        shifted_peak = peak.copy()
        epsilon = 1e-6
        if not elite.any():
            index = int(np.argmax(margin))
            jaws_extension = -float(margin[index]) + epsilon
            shifted_final[index] += 2.0 * jaws_extension
            return shifted_final, shifted_peak, jaws_extension
        index = int(np.argmin(margin))
        jaws_extension = -float(margin[index]) - epsilon
        shifted_final[index] += 2.0 * jaws_extension
        return shifted_final, shifted_peak, jaws_extension

    def predict_distribution(
        self,
        frame: pd.DataFrame,
        peak_floor: np.ndarray | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        source_probability = self.probability_model.predict_proba(feature_frame(frame))[:, 1]
        final_scenarios, peak_scenarios = self.base_distribution.predict_scenarios(
            frame, peak_floor=peak_floor
        )
        standards = frame["standard_jaws"].to_numpy(dtype=float)
        floors = (
            frame["peak_seven_war_to_date"].to_numpy(dtype=float)
            if peak_floor is None
            else np.maximum(
                frame["peak_seven_war_to_date"].to_numpy(dtype=float),
                np.asarray(peak_floor, dtype=float),
            )
        )
        outputs = [
            np.empty((len(frame), len(QUANTILE_LEVELS)), dtype=float)
            for _ in range(4)
        ]
        shifts = np.zeros(len(frame), dtype=float)
        for index in range(len(frame)):
            probability = float(np.clip(source_probability[index], 1e-6, 1.0 - 1e-6))
            final, peak, shift = self._ensure_tail_support(
                final_scenarios[index],
                peak_scenarios[index],
                floors[index],
                standards[index],
                probability,
            )
            jaws = (final + peak) / 2.0
            margin = jaws - standards[index]
            elite = margin >= 0.0
            elite_count = int(elite.sum())
            non_elite_count = len(elite) - elite_count
            if elite_count == 0 or non_elite_count == 0:
                raise CareerDataError("Scenario tilt could not establish both JAWS tail states")
            weights = np.where(
                elite,
                probability / elite_count,
                (1.0 - probability) / non_elite_count,
            )
            for output, values in zip(
                outputs, (final, peak, jaws, margin), strict=True
            ):
                output[index] = _weighted_quantile(values, QUANTILE_LEVELS, weights)
            shifts[index] = shift
        return (
            source_probability,
            outputs[0],
            outputs[1],
            outputs[2],
            outputs[3],
            shifts,
        )


class BlendedTailProbabilityModel:
    def __init__(
        self,
        base_distribution: JointResidualCareerDistribution,
        classifier: Any,
        classifier_name: str,
        classifier_weight: float,
    ):
        self.base_distribution = base_distribution
        self.classifier = classifier
        self.classifier_name = classifier_name
        self.classifier_weight = float(classifier_weight)

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        joint_probability = self.base_distribution.predict_distribution(frame)[0]
        classifier_probability = self.classifier.predict_proba(feature_frame(frame))[:, 1]
        positive = (
            (1.0 - self.classifier_weight) * joint_probability
            + self.classifier_weight * classifier_probability
        )
        positive = np.clip(positive, 1e-9, 1.0 - 1e-9)
        return np.column_stack([1.0 - positive, positive])


class JointDistributionWithShiftMetadata:
    def __init__(self, base_distribution: JointResidualCareerDistribution):
        self.base_distribution = base_distribution
        self.probability_model_name = "joint_residual_career_distribution"

    def predict_distribution(
        self, frame: pd.DataFrame, peak_floor: np.ndarray | None = None
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        values = self.base_distribution.predict_distribution(
            frame, peak_floor=peak_floor
        )
        return (*values, np.zeros(len(frame), dtype=float))


def expected_calibration_error(
    y_true: np.ndarray,
    probability: np.ndarray,
    sample_weight: np.ndarray,
    *,
    bins: int = 10,
) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    assignments = np.minimum(np.digitize(probability, edges[1:-1], right=False), bins - 1)
    total_weight = float(sample_weight.sum())
    value = 0.0
    for index in range(bins):
        mask = assignments == index
        if not mask.any():
            continue
        weight = sample_weight[mask]
        observed = float(np.average(y_true[mask], weights=weight))
        expected = float(np.average(probability[mask], weights=weight))
        value += float(weight.sum()) / total_weight * abs(observed - expected)
    return float(value)


def _calibration_line(
    y_true: np.ndarray, probability: np.ndarray, sample_weight: np.ndarray
) -> tuple[float | None, float | None]:
    if len(np.unique(y_true)) < 2 or len(np.unique(probability)) < 2:
        return None, None
    model = LogisticRegression(C=1e8, max_iter=2_000, solver="lbfgs").fit(
        _logit(probability).reshape(-1, 1), y_true, sample_weight=sample_weight
    )
    return float(model.intercept_[0]), float(model.coef_[0, 0])


def classification_metrics(
    y_true: Sequence[int], probability: Sequence[float], sample_weight: Sequence[float]
) -> dict[str, float | int | None]:
    y = np.asarray(y_true, dtype=int)
    p = np.clip(np.asarray(probability, dtype=float), 1e-9, 1.0 - 1e-9)
    weights = np.asarray(sample_weight, dtype=float)
    intercept, slope = _calibration_line(y, p, weights)
    result: dict[str, float | int | None] = {
        "rows": int(len(y)),
        "events": int(y.sum()),
        "weightedEventRate": float(np.average(y, weights=weights)),
        "brier": float(brier_score_loss(y, p, sample_weight=weights)),
        "logLoss": float(log_loss(y, p, labels=[0, 1], sample_weight=weights)),
        "averagePrecision": None,
        "rocAuc": None,
        "expectedCalibrationError": expected_calibration_error(y, p, weights),
        "calibrationIntercept": intercept,
        "calibrationSlope": slope,
    }
    if len(np.unique(y)) == 2:
        result["averagePrecision"] = float(average_precision_score(y, p, sample_weight=weights))
        result["rocAuc"] = float(roc_auc_score(y, p, sample_weight=weights))
    return result


def regression_metrics(
    truth: np.ndarray, quantiles: np.ndarray, sample_weight: np.ndarray
) -> dict[str, float | int]:
    truth = np.asarray(truth, dtype=float)
    quantiles = np.asarray(quantiles, dtype=float)
    weights = np.asarray(sample_weight, dtype=float)
    if quantiles.shape != (len(truth), len(QUANTILE_LEVELS)):
        raise CareerDataError("Regression quantiles have an invalid shape")
    return {
        "rows": int(len(truth)),
        "meanAbsoluteError": float(
            mean_absolute_error(truth, quantiles[:, 2], sample_weight=weights)
        ),
        "interval50Coverage": float(
            np.average(
                (truth >= quantiles[:, 1]) & (truth <= quantiles[:, 3]), weights=weights
            )
        ),
        "interval80Coverage": float(
            np.average(
                (truth >= quantiles[:, 0]) & (truth <= quantiles[:, 4]), weights=weights
            )
        ),
        "medianInterval50Width": float(np.median(quantiles[:, 3] - quantiles[:, 1])),
        "medianInterval80Width": float(np.median(quantiles[:, 4] - quantiles[:, 0])),
    }


def _add_player_counts(metrics: dict[str, Any], frame: pd.DataFrame) -> dict[str, Any]:
    outcomes = (
        frame.sort_values(["bbref_id", "season"], kind="mergesort")
        .groupby("bbref_id")["hof_caliber"]
        .last()
        .astype(int)
    )
    metrics["players"] = int(len(outcomes))
    metrics["eventPlayers"] = int(outcomes.sum())
    return metrics


def _stage_slice_metrics(
    test: pd.DataFrame, probability: np.ndarray
) -> dict[str, dict[str, Any]]:
    definitions = {
        "firstSeason": test["season_number"].eq(1).to_numpy(),
        "seasonsOneToThree": test["season_number"].le(3).to_numpy(),
        "seasonFourPlus": test["season_number"].ge(4).to_numpy(),
    }
    result: dict[str, dict[str, Any]] = {}
    for name, mask in definitions.items():
        subset = test.loc[mask].reset_index(drop=True)
        if subset.empty:
            continue
        metrics = classification_metrics(
            subset["hof_caliber"].astype(int).to_numpy(),
            probability[mask],
            player_equal_weights(subset),
        )
        result[name] = _add_player_counts(metrics, subset)
    return result


def _first_season_ranking_metrics(
    test: pd.DataFrame, probability: np.ndarray
) -> dict[str, Any]:
    mask = test["season_number"].eq(1).to_numpy()
    rows = test.loc[mask, ["bbref_id", "hof_caliber"]].copy()
    rows["probability"] = probability[mask]
    rows = rows.sort_values(
        ["probability", "bbref_id"], ascending=[False, True], kind="mergesort"
    )
    base_rate = float(rows["hof_caliber"].astype(float).mean())
    result: dict[str, Any] = {
        "unit": "one first-season landmark per player",
        "players": int(len(rows)),
        "eventPlayers": int(rows["hof_caliber"].astype(int).sum()),
        "baseRate": base_rate,
    }
    for fraction in (0.01, 0.05, 0.10):
        count = max(1, int(math.ceil(len(rows) * fraction)))
        precision = float(rows.iloc[:count]["hof_caliber"].astype(float).mean())
        result[f"top{int(fraction * 100)}Percent"] = {
            "players": count,
            "precision": precision,
            "lift": precision / base_rate if base_rate > 0 else None,
        }
    return result


def _support_extension_metrics(shifts: np.ndarray) -> dict[str, float | int]:
    values = np.asarray(shifts, dtype=float)
    used = np.abs(values) > 1e-12
    magnitudes = np.abs(values[used])
    return {
        "rows": int(len(values)),
        "extendedRows": int(used.sum()),
        "extensionRate": float(used.mean()) if len(values) else 0.0,
        "medianAbsoluteJawsExtension": float(np.median(magnitudes))
        if len(magnitudes)
        else 0.0,
        "p90AbsoluteJawsExtension": float(np.quantile(magnitudes, 0.9))
        if len(magnitudes)
        else 0.0,
        "maximumAbsoluteJawsExtension": float(magnitudes.max())
        if len(magnitudes)
        else 0.0,
    }


def _stage_distribution_metrics(
    frame: pd.DataFrame,
    final_quantiles: np.ndarray,
    peak_quantiles: np.ndarray,
    jaws_quantiles: np.ndarray,
) -> dict[str, Any]:
    definitions = {
        "firstSeason": frame["season_number"].eq(1).to_numpy(),
        "seasonsOneToThree": frame["season_number"].le(3).to_numpy(),
        "seasonsTwoToThree": frame["season_number"].between(2, 3).to_numpy(),
        "seasonsFourToSix": frame["season_number"].between(4, 6).to_numpy(),
        "seasonsSevenToTen": frame["season_number"].between(7, 10).to_numpy(),
        "seasonElevenPlus": frame["season_number"].ge(11).to_numpy(),
        "seasonFourPlus": frame["season_number"].ge(4).to_numpy(),
    }
    result: dict[str, Any] = {}
    for name, stage_mask in definitions.items():
        slices: dict[str, Any] = {}
        for outcome_name, outcome_mask in (
            ("all", np.ones(len(frame), dtype=bool)),
            ("hofCaliber", frame["hof_caliber"].astype(int).eq(1).to_numpy()),
            ("nonHofCaliber", frame["hof_caliber"].astype(int).eq(0).to_numpy()),
        ):
            mask = stage_mask & outcome_mask
            subset = frame.loc[mask].reset_index(drop=True)
            if subset.empty:
                continue
            weights = player_equal_weights(subset)
            slices[outcome_name] = {
                "players": int(subset["bbref_id"].nunique()),
                "finalCareerWar": regression_metrics(
                    subset["final_career_war"].to_numpy(dtype=float),
                    final_quantiles[mask],
                    weights,
                ),
                "peakSevenWar": regression_metrics(
                    subset["final_peak_seven_war"].to_numpy(dtype=float),
                    peak_quantiles[mask],
                    weights,
                ),
                "finalJaws": regression_metrics(
                    subset["final_jaws"].to_numpy(dtype=float),
                    jaws_quantiles[mask],
                    weights,
                ),
            }
        result[name] = slices
    return result


def _early_hall_event_tail_summary(
    stage_distribution: Mapping[str, Any],
) -> dict[str, Any]:
    stages: dict[str, Any] = {}
    coverages: list[float] = []
    errors: list[float] = []
    for stage in ("firstSeason", "seasonsOneToThree"):
        event_metrics = dict(stage_distribution.get(stage, {})).get("hofCaliber")
        if not event_metrics:
            stages[stage] = {"status": "no_hall_caliber_rows"}
            continue
        targets: dict[str, Any] = {}
        for target in ("finalCareerWar", "peakSevenWar", "finalJaws"):
            metrics = event_metrics[target]
            coverage = float(metrics["interval80Coverage"])
            error = float(metrics["meanAbsoluteError"])
            coverages.append(coverage)
            errors.append(error)
            targets[target] = {
                "interval80Coverage": coverage,
                "meanAbsoluteError": error,
                "rows": int(metrics["rows"]),
            }
        stages[stage] = {
            "status": "descriptive_only",
            "players": int(event_metrics["players"]),
            "targets": targets,
        }
    return {
        "stages": stages,
        "minimumDescriptiveInterval80Coverage": (
            min(coverages) if coverages else None
        ),
        "maximumMeanAbsoluteError": max(errors) if errors else None,
    }


def _high_performance_point_metrics(
    frame: pd.DataFrame, final_quantiles: np.ndarray
) -> dict[str, Any]:
    stage_definitions = {
        "firstSeason": frame["season_number"].eq(1).to_numpy(),
        "seasonsOneToThree": frame["season_number"].le(3).to_numpy(),
        "seasonsTwoToThree": frame["season_number"].between(2, 3).to_numpy(),
        "seasonsFourToSix": frame["season_number"].between(4, 6).to_numpy(),
        "seasonsSevenToTen": frame["season_number"].between(7, 10).to_numpy(),
    }
    definitions = dict(stage_definitions)
    for name, mask in stage_definitions.items():
        for role in ("hitter", "pitcher"):
            definitions[f"{name}:{role}"] = mask & frame["role"].eq(role).to_numpy()
    result: dict[str, Any] = {}
    for name, stage_mask in definitions.items():
        stage_values = frame.loc[stage_mask, "career_war_to_date"].to_numpy(dtype=float)
        if len(stage_values) == 0:
            continue
        cutoff = float(np.quantile(stage_values, 0.9))
        mask = stage_mask & frame["career_war_to_date"].ge(cutoff).to_numpy()
        subset = frame.loc[mask].reset_index(drop=True)
        weights = player_equal_weights(subset)
        error = (
            final_quantiles[mask, 2]
            - subset["final_career_war"].to_numpy(dtype=float)
        )
        result[name] = {
            "careerWarToDateCutoff": cutoff,
            "players": int(subset["bbref_id"].nunique()),
            "rows": int(len(subset)),
            "medianBiasP50MinusFinal": float(
                _weighted_quantile(error, np.asarray([0.5]), weights)[0]
            ),
            "meanAbsoluteError": float(np.average(np.abs(error), weights=weights)),
            "medianP10P90Width": float(
                np.median(final_quantiles[mask, 4] - final_quantiles[mask, 0])
            ),
        }
    return result


@dataclass
class CareerTournament:
    split: CareerSplit
    classifiers: dict[str, Any]
    ensemble: CalibratedStackedEnsemble
    joint_model: JointResidualCareerDistribution
    ranking_model: Any
    report: dict[str, Any]

    @property
    def champion_name(self) -> str:
        return str(self.report["champion"])

    @property
    def champion_model(self) -> Any:
        if self.champion_name == "calibrated_scenario_tilt":
            return self.ranking_model
        if self.champion_name == "joint_residual_career_distribution":
            return self.joint_model
        return self.ensemble if self.champion_name == "calibrated_ensemble" else self.classifiers[self.champion_name]

    def predict_hof_probability(self, panel: pd.DataFrame) -> np.ndarray:
        if self.champion_name == "calibrated_scenario_tilt":
            return self.ranking_model.predict_distribution(panel)[0]
        if self.champion_name == "joint_residual_career_distribution":
            return self.joint_model.predict_distribution(panel)[0]
        return self.champion_model.predict_proba(feature_frame(panel))[:, 1]


@dataclass
class CareerScoringBundle:
    selected_entrant: str
    classifier: Any
    joint_model: JointResidualCareerDistribution
    ranking_model: Any
    lineage: dict[str, Any]

    def predict_hof_probability(self, panel: pd.DataFrame) -> np.ndarray:
        return self.ranking_model.predict_distribution(panel)[0]

    def predict_distribution(
        self, panel: pd.DataFrame, peak_floor: np.ndarray | None = None
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        return self.ranking_model.predict_distribution(panel, peak_floor=peak_floor)


def _cohort(panel: pd.DataFrame, players: Sequence[str]) -> pd.DataFrame:
    player_set = set(players)
    return (
        panel.loc[panel["bbref_id"].isin(player_set)]
        .sort_values(["bbref_id", "season"], kind="mergesort")
        .reset_index(drop=True)
    )


def _distribution_subset(panel: pd.DataFrame) -> pd.DataFrame:
    return panel.loc[panel["role"].eq(panel["target_role"])].reset_index(drop=True)


def _split_stack_and_selection(calibration: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    outcomes = (
        calibration.sort_values(["bbref_id", "season"], kind="mergesort")
        .groupby("bbref_id", as_index=False)
        .agg(career_end_year=("career_end_year", "max"), hof_caliber=("hof_caliber", "last"))
        .sort_values(["career_end_year", "bbref_id"], kind="mergesort")
    )
    years = sorted(int(year) for year in outcomes["career_end_year"].unique())
    candidates = years[1:]
    valid: list[tuple[int, int]] = []
    minimum_event_players = 10 if len(outcomes) >= 500 else 1
    for cutoff in candidates:
        earlier = outcomes.loc[outcomes["career_end_year"] < cutoff]
        later = outcomes.loc[outcomes["career_end_year"] >= cutoff]
        earlier_events = int(earlier["hof_caliber"].astype(int).sum())
        later_events = int(later["hof_caliber"].astype(int).sum())
        if (
            len(earlier) >= 5
            and len(later) >= 5
            and earlier_events >= minimum_event_players
            and later_events >= minimum_event_players
            and earlier["hof_caliber"].nunique() == 2
            and later["hof_caliber"].nunique() == 2
        ):
            imbalance = abs(len(earlier) - len(later))
            valid.append((imbalance, cutoff))
    if not valid:
        raise CareerDataError(
            "Calibration cohort cannot support player-disjoint stack-calibration and selection subsets"
        )
    _, cutoff = min(valid)
    stack_players = set(
        outcomes.loc[outcomes["career_end_year"] < cutoff, "bbref_id"].astype(str)
    )
    selection_players = set(
        outcomes.loc[outcomes["career_end_year"] >= cutoff, "bbref_id"].astype(str)
    )
    stack = _cohort(calibration, tuple(stack_players))
    selection = _cohort(calibration, tuple(selection_players))
    return stack, selection, {
        "stackCalibrationPlayers": len(stack_players),
        "selectionPlayers": len(selection_players),
        "stackCalibrationEndYear": cutoff - 1,
        "selectionStartYear": cutoff,
        "minimumEventPlayersRequired": minimum_event_players,
        "stackCalibrationEventPlayers": int(
            outcomes.loc[outcomes["career_end_year"] < cutoff, "hof_caliber"]
            .astype(int)
            .sum()
        ),
        "selectionEventPlayers": int(
            outcomes.loc[outcomes["career_end_year"] >= cutoff, "hof_caliber"]
            .astype(int)
            .sum()
        ),
        "championStatus": "provisional_low_event_selection"
        if int(
            outcomes.loc[outcomes["career_end_year"] >= cutoff, "hof_caliber"]
            .astype(int)
            .sum()
        )
        < 20
        else "research_selection",
        "playerDisjoint": True,
    }


def _fit_calibrated_family(
    entrant: str,
    training: pd.DataFrame,
    calibration: pd.DataFrame,
) -> Any:
    x_training = feature_frame(training)
    x_calibration = feature_frame(calibration)
    y_training = training["hof_caliber"].astype(int).to_numpy()
    y_calibration = calibration["hof_caliber"].astype(int).to_numpy()
    training_weights = player_equal_weights(training)
    calibration_weights = player_equal_weights(calibration)
    raw_models = _fresh_raw_classifiers()
    if entrant == "calibrated_ensemble":
        for model in raw_models.values():
            _fit_classifier(model, x_training, y_training, training_weights)
        return CalibratedStackedEnsemble(raw_models).fit_calibrator(
            x_calibration, y_calibration, calibration_weights
        )
    if entrant not in raw_models:
        raise CareerDataError(f"Unknown tournament entrant: {entrant}")
    raw = raw_models[entrant]
    _fit_classifier(raw, x_training, y_training, training_weights)
    return SigmoidCalibratedClassifier(raw).fit_calibrator(
        x_calibration, y_calibration, calibration_weights
    )


def _refit_calibrated_base_models(
    calibrated_model: Any,
    entrant: str,
    training: pd.DataFrame,
) -> Any:
    """Refit raw learners on all resolved data while preserving frozen calibrators."""

    x = feature_frame(training)
    y = training["hof_caliber"].astype(int).to_numpy()
    weights = player_equal_weights(training)
    if entrant == "calibrated_ensemble":
        base_models = _fresh_raw_classifiers()
        for model in base_models.values():
            _fit_classifier(model, x, y, weights)
        calibrated_model.base_models = base_models
        return calibrated_model
    if not isinstance(calibrated_model, SigmoidCalibratedClassifier):
        raise CareerDataError("Expected a sigmoid-calibrated classifier for base refit")
    base_models = _fresh_raw_classifiers()
    if entrant not in base_models:
        raise CareerDataError(f"Unknown calibrated base entrant: {entrant}")
    base_model = base_models[entrant]
    _fit_classifier(base_model, x, y, weights)
    calibrated_model.base_model = base_model
    return calibrated_model


def _era_sensitivity(
    champion: str,
    training: pd.DataFrame,
    stack_calibration: pd.DataFrame,
    test: pd.DataFrame,
    development_holdout_metrics: Mapping[str, Mapping[str, Any]],
    *,
    tilt_source: str | None = None,
    tilt_classifier_weight: float | None = None,
) -> dict[str, Any]:
    y_test = test["hof_caliber"].astype(int).to_numpy()
    weights_test = player_equal_weights(test)
    result: dict[str, Any] = {
        "selectedEntrant": champion,
        "allHistory": {
            "trainingPlayers": int(training["bbref_id"].nunique()),
            "metrics": dict(development_holdout_metrics[champion]),
        },
        "restrictions": {},
        "decision": "descriptive_only_no_cutoff_promotion",
    }
    for cutoff in (1947, 1961):
        restricted = training.loc[training["debut_year"] >= cutoff].reset_index(drop=True)
        restricted_calibration = stack_calibration.loc[
            stack_calibration["debut_year"] >= cutoff
        ].reset_index(drop=True)
        players = int(restricted["bbref_id"].nunique())
        events = int(
            restricted.sort_values(["bbref_id", "season"])
            .groupby("bbref_id")["hof_caliber"]
            .last()
            .astype(int)
            .sum()
        )
        key = f"debutYearAtLeast{cutoff}"
        if (
            players < 50
            or events < 20
            or restricted["hof_caliber"].nunique() < 2
            or restricted_calibration["hof_caliber"].nunique() < 2
        ):
            result["restrictions"][key] = {
                "status": "insufficient_training_outcomes",
                "trainingPlayers": players,
                "eventPlayers": events,
            }
            continue
        if champion in {
            "joint_residual_career_distribution",
            "calibrated_scenario_tilt",
        }:
            restricted_distribution = _distribution_subset(restricted)
            restricted_calibration_distribution = _distribution_subset(
                restricted_calibration
            )
            test_distribution = _distribution_subset(test)
            joint = JointResidualCareerDistribution().fit(
                restricted_distribution,
                restricted_calibration_distribution,
                player_equal_weights(restricted_distribution),
                player_equal_weights(restricted_calibration_distribution),
            )
            if champion == "calibrated_scenario_tilt":
                if tilt_source is None:
                    raise CareerDataError("Scenario-tilt era sensitivity requires its source model")
                if tilt_classifier_weight is None:
                    raise CareerDataError("Scenario-tilt era sensitivity requires its blend weight")
                classifier_model = _fit_calibrated_family(
                    tilt_source, restricted, restricted_calibration
                )
                probability_model = BlendedTailProbabilityModel(
                    joint,
                    classifier_model,
                    tilt_source,
                    tilt_classifier_weight,
                )
                model = CalibratedScenarioTiltDistribution(
                    joint, probability_model, tilt_source
                )
            else:
                model = joint
            probability = model.predict_distribution(test_distribution)[0]
            metric_frame = test_distribution
        else:
            model = _fit_calibrated_family(champion, restricted, restricted_calibration)
            probability = model.predict_proba(feature_frame(test))[:, 1]
            metric_frame = test
        result["restrictions"][key] = {
            "status": "descriptive_development_holdout_sensitivity",
            "trainingPlayers": players,
            "eventPlayers": events,
            "metrics": classification_metrics(
                metric_frame["hof_caliber"].astype(int).to_numpy(),
                probability,
                player_equal_weights(metric_frame),
            ),
        }
    return result


def run_career_tournament(panel: pd.DataFrame, split: CareerSplit) -> CareerTournament:
    train = _cohort(panel, split.train_players)
    calibration = _cohort(panel, split.calibration_players)
    test = _cohort(panel, split.test_players)
    if min(len(train), len(calibration), len(test)) == 0:
        raise CareerDataError("Tournament split produced an empty landmark cohort")
    y_train = train["hof_caliber"].astype(int).to_numpy()
    stack_calibration, selection, inner_split = _split_stack_and_selection(calibration)
    y_stack_calibration = stack_calibration["hof_caliber"].astype(int).to_numpy()
    y_selection = selection["hof_caliber"].astype(int).to_numpy()
    y_test = test["hof_caliber"].astype(int).to_numpy()
    if any(
        len(np.unique(values)) < 2
        for values in (y_train, y_stack_calibration, y_selection, y_test)
    ):
        raise CareerDataError("Every tournament cohort requires Hall-caliber events and non-events")
    weights_train = player_equal_weights(train)
    weights_stack_calibration = player_equal_weights(stack_calibration)
    weights_selection = player_equal_weights(selection)
    weights_calibration = player_equal_weights(calibration)
    weights_test = player_equal_weights(test)
    x_train = feature_frame(train)
    x_stack_calibration = feature_frame(stack_calibration)
    x_selection = feature_frame(selection)
    x_test = feature_frame(test)

    raw_classifiers: dict[str, Any] = {
        "age_position_empirical_prior": AgePositionEmpiricalPrior(smoothing=20.0),
        "regularized_logistic": make_logistic_model(),
        "nonlinear_hist_gradient_boosting": make_nonlinear_model(),
    }
    for model in raw_classifiers.values():
        _fit_classifier(model, x_train, y_train, weights_train)
    classifiers = {
        name: SigmoidCalibratedClassifier(model).fit_calibrator(
            x_stack_calibration, y_stack_calibration, weights_stack_calibration
        )
        for name, model in raw_classifiers.items()
    }
    ensemble = CalibratedStackedEnsemble(raw_classifiers).fit_calibrator(
        x_stack_calibration, y_stack_calibration, weights_stack_calibration
    )

    train_distribution = _distribution_subset(train)
    stack_distribution = _distribution_subset(stack_calibration)
    selection_distribution = _distribution_subset(selection)
    test_distribution = _distribution_subset(test)
    distribution_train_weights = player_equal_weights(train_distribution)
    distribution_stack_weights = player_equal_weights(stack_distribution)
    distribution_selection_weights = player_equal_weights(selection_distribution)
    distribution_test_weights = player_equal_weights(test_distribution)
    joint_model = JointResidualCareerDistribution().fit(
        train_distribution,
        stack_distribution,
        distribution_train_weights,
        distribution_stack_weights,
    )
    (
        joint_selection_probability,
        joint_selection_final,
        joint_selection_peak,
        joint_selection_jaws,
        joint_selection_margin,
    ) = joint_model.predict_distribution(selection_distribution)
    (
        joint_test_probability,
        joint_test_final,
        joint_test_peak,
        joint_test_jaws,
        joint_test_margin,
    ) = joint_model.predict_distribution(test_distribution)

    y_selection_distribution = selection_distribution["hof_caliber"].astype(int).to_numpy()
    y_test_distribution = test_distribution["hof_caliber"].astype(int).to_numpy()
    x_selection_distribution = feature_frame(selection_distribution)
    x_test_distribution = feature_frame(test_distribution)
    pre_calibration_selection_metrics: dict[str, dict[str, float | int | None]] = {}
    selection_metrics: dict[str, dict[str, float | int | None]] = {}
    development_holdout_metrics: dict[str, dict[str, float | int | None]] = {}
    for name, model in classifiers.items():
        pre_calibration_selection_metrics[name] = classification_metrics(
            y_selection_distribution,
            raw_classifiers[name].predict_proba(x_selection_distribution)[:, 1],
            distribution_selection_weights,
        )
        selection_metrics[name] = classification_metrics(
            y_selection_distribution,
            model.predict_proba(x_selection_distribution)[:, 1],
            distribution_selection_weights,
        )
        development_holdout_metrics[name] = classification_metrics(
            y_test_distribution,
            model.predict_proba(x_test_distribution)[:, 1],
            distribution_test_weights,
        )
    selection_metrics["calibrated_ensemble"] = classification_metrics(
        y_selection_distribution,
        ensemble.predict_proba(x_selection_distribution)[:, 1],
        distribution_selection_weights,
    )
    development_holdout_metrics["calibrated_ensemble"] = classification_metrics(
        y_test_distribution,
        ensemble.predict_proba(x_test_distribution)[:, 1],
        distribution_test_weights,
    )
    calibrated_probability_models: dict[str, Any] = {
        **classifiers,
        "calibrated_ensemble": ensemble,
    }
    tilt_source = min(
        calibrated_probability_models,
        key=lambda name: (float(selection_metrics[name]["brier"]), name),
    )
    source_selection_probability = calibrated_probability_models[
        tilt_source
    ].predict_proba(x_selection_distribution)[:, 1]
    selection_metrics["joint_residual_career_distribution"] = classification_metrics(
        y_selection_distribution,
        joint_selection_probability,
        distribution_selection_weights,
    )
    development_holdout_metrics["joint_residual_career_distribution"] = classification_metrics(
        y_test_distribution,
        joint_test_probability,
        distribution_test_weights,
    )
    joint_selection_distribution_metrics = {
        "finalCareerWar": regression_metrics(
            selection_distribution["final_career_war"].to_numpy(dtype=float),
            joint_selection_final,
            distribution_selection_weights,
        ),
        "peakSevenWar": regression_metrics(
            selection_distribution["final_peak_seven_war"].to_numpy(dtype=float),
            joint_selection_peak,
            distribution_selection_weights,
        ),
        "finalJaws": regression_metrics(
            selection_distribution["final_jaws"].to_numpy(dtype=float),
            joint_selection_jaws,
            distribution_selection_weights,
        ),
    }
    joint_selection_stage_distribution = _stage_distribution_metrics(
        selection_distribution,
        joint_selection_final,
        joint_selection_peak,
        joint_selection_jaws,
    )
    joint_selection_stage_skill = _stage_slice_metrics(
        selection_distribution, joint_selection_probability
    )
    joint_selection_high_performance = _high_performance_point_metrics(
        selection_distribution, joint_selection_final
    )

    def evaluate_tilt_candidate(classifier_weight: float) -> dict[str, Any]:
        probability_model = BlendedTailProbabilityModel(
            joint_model,
            calibrated_probability_models[tilt_source],
            tilt_source,
            classifier_weight,
        )
        model = CalibratedScenarioTiltDistribution(
            joint_model,
            probability_model,
            f"joint+{tilt_source}",
        )
        (
            probability,
            final,
            peak,
            jaws,
            margin,
            shifts,
        ) = model.predict_distribution(selection_distribution)
        metrics = classification_metrics(
            y_selection_distribution,
            probability,
            distribution_selection_weights,
        )
        distribution_metrics = {
            "finalCareerWar": regression_metrics(
                selection_distribution["final_career_war"].to_numpy(dtype=float),
                final,
                distribution_selection_weights,
            ),
            "peakSevenWar": regression_metrics(
                selection_distribution["final_peak_seven_war"].to_numpy(dtype=float),
                peak,
                distribution_selection_weights,
            ),
            "finalJaws": regression_metrics(
                selection_distribution["final_jaws"].to_numpy(dtype=float),
                jaws,
                distribution_selection_weights,
            ),
        }
        stage_distribution = _stage_distribution_metrics(
            selection_distribution,
            final,
            peak,
            jaws,
        )
        stage_skill = _stage_slice_metrics(selection_distribution, probability)
        maximum_coverage_regression = max(
            joint_selection_distribution_metrics[target]["interval80Coverage"]
            - distribution_metrics[target]["interval80Coverage"]
            for target in ("finalCareerWar", "peakSevenWar", "finalJaws")
        )
        maximum_early_stage_coverage_regression = max(
            joint_selection_stage_distribution[stage]["all"][target][
                "interval80Coverage"
            ]
            - stage_distribution[stage]["all"][target]["interval80Coverage"]
            for stage in ("firstSeason", "seasonsOneToThree")
            for target in ("finalCareerWar", "peakSevenWar", "finalJaws")
        )
        minimum_early_stage_absolute_coverage = min(
            stage_distribution[stage]["all"][target]["interval80Coverage"]
            for stage in ("firstSeason", "seasonsOneToThree")
            for target in ("finalCareerWar", "peakSevenWar", "finalJaws")
        )
        maximum_early_event_coverage_regression = max(
            joint_selection_stage_distribution[stage]["hofCaliber"][target][
                "interval80Coverage"
            ]
            - stage_distribution[stage]["hofCaliber"][target]["interval80Coverage"]
            for stage in ("firstSeason", "seasonsOneToThree")
            for target in ("finalCareerWar", "peakSevenWar", "finalJaws")
            if "hofCaliber" in stage_distribution[stage]
        )
        brier_noninferiority = bool(
            metrics["brier"]
            <= selection_metrics["joint_residual_career_distribution"]["brier"]
            + 1e-6
        )
        early_brier_noninferiority = all(
            stage_skill[stage]["brier"]
            <= joint_selection_stage_skill[stage]["brier"] + 1e-6
            for stage in ("firstSeason", "seasonsOneToThree")
        )
        extension_metrics = _support_extension_metrics(shifts)
        support_extension_gate = bool(
            extension_metrics["p90AbsoluteJawsExtension"] <= 60.0
            and extension_metrics["maximumAbsoluteJawsExtension"] <= 100.0
        )
        admitted = bool(
            brier_noninferiority
            and early_brier_noninferiority
            and maximum_coverage_regression <= 0.05
            and maximum_early_stage_coverage_regression <= 0.10
            and maximum_early_event_coverage_regression <= 0.10
            and support_extension_gate
        )
        return {
            "classifierWeight": float(classifier_weight),
            "model": model,
            "probabilityModel": probability_model,
            "probability": probability,
            "final": final,
            "peak": peak,
            "jaws": jaws,
            "margin": margin,
            "shifts": shifts,
            "metrics": metrics,
            "distributionMetrics": distribution_metrics,
            "highPerformanceMetrics": _high_performance_point_metrics(
                selection_distribution, final
            ),
            "stageDistribution": stage_distribution,
            "stageSkill": stage_skill,
            "maximumCoverageRegression": float(maximum_coverage_regression),
            "maximumEarlyStageCoverageRegression": float(
                maximum_early_stage_coverage_regression
            ),
            "minimumEarlyStageAbsoluteCoverage": float(
                minimum_early_stage_absolute_coverage
            ),
            "maximumEarlyEventCoverageRegression": float(
                maximum_early_event_coverage_regression
            ),
            "extensionMetrics": extension_metrics,
            "supportExtensionGatePassed": support_extension_gate,
            "brierNoninferiorityPassed": brier_noninferiority,
            "earlyBrierNoninferiorityPassed": early_brier_noninferiority,
            "admitted": admitted,
        }

    blend_grid: list[dict[str, Any]] = []
    blend_objective: list[tuple[float, float]] = []
    for classifier_weight in np.linspace(0.0, 1.0, 21):
        blended = (
            (1.0 - classifier_weight) * joint_selection_probability
            + classifier_weight * source_selection_probability
        )
        metrics = classification_metrics(
            y_selection_distribution,
            blended,
            distribution_selection_weights,
        )
        stage_skill = _stage_slice_metrics(selection_distribution, blended)
        blend_grid.append(
            {
                "classifierWeight": float(classifier_weight),
                "selectionBrier": float(metrics["brier"]),
                "firstSeasonBrier": float(stage_skill["firstSeason"]["brier"]),
                "seasonsOneToThreeBrier": float(
                    stage_skill["seasonsOneToThree"]["brier"]
                ),
                "distributionGatesEvaluated": False,
                "admitted": False,
                "selected": False,
            }
        )
        if classifier_weight > 0.0:
            blend_objective.append((float(metrics["brier"]), float(classifier_weight)))

    evaluations: dict[float, dict[str, Any]] = {}
    selected_evaluation: dict[str, Any] | None = None
    for _, classifier_weight in sorted(blend_objective):
        evaluation = evaluate_tilt_candidate(classifier_weight)
        evaluations[classifier_weight] = evaluation
        grid_row = next(
            row
            for row in blend_grid
            if row["classifierWeight"] == classifier_weight
        )
        grid_row.update(
            {
                "distributionGatesEvaluated": True,
                "brierNoninferiorityPassed": evaluation[
                    "brierNoninferiorityPassed"
                ],
                "earlyBrierNoninferiorityPassed": evaluation[
                    "earlyBrierNoninferiorityPassed"
                ],
                "maximumCoverageRegression": evaluation[
                    "maximumCoverageRegression"
                ],
                "maximumEarlyStageCoverageRegression": evaluation[
                    "maximumEarlyStageCoverageRegression"
                ],
                "maximumEarlyEventCoverageRegression": evaluation[
                    "maximumEarlyEventCoverageRegression"
                ],
                "supportExtensionGatePassed": evaluation[
                    "supportExtensionGatePassed"
                ],
                "admitted": evaluation["admitted"],
            }
        )
        if evaluation["admitted"]:
            selected_evaluation = evaluation
            grid_row["selected"] = True
            break

    if selected_evaluation is None:
        representative_weight = min(blend_objective)[1]
        representative_evaluation = evaluations.get(representative_weight)
        if representative_evaluation is None:
            representative_evaluation = evaluate_tilt_candidate(representative_weight)
    else:
        representative_evaluation = selected_evaluation
    for grid_row in blend_grid:
        if grid_row["classifierWeight"] == 0.0:
            grid_row["searchStatus"] = "joint_baseline_not_a_tilt_entrant"
        elif grid_row["selected"]:
            grid_row["searchStatus"] = "lowest_brier_admissible"
        elif grid_row["distributionGatesEvaluated"]:
            grid_row["searchStatus"] = "rejected_before_selected_candidate"
        else:
            grid_row["searchStatus"] = (
                "not_needed_after_lower_brier_admissible"
                if selected_evaluation is not None
                else "not_evaluated"
            )
    tilt_admitted = selected_evaluation is not None
    tilt_classifier_weight = float(representative_evaluation["classifierWeight"])
    tilt_model = representative_evaluation["model"]
    tilt_probability_model = representative_evaluation["probabilityModel"]
    tilt_selection_probability = representative_evaluation["probability"]
    tilt_selection_final = representative_evaluation["final"]
    tilt_selection_peak = representative_evaluation["peak"]
    tilt_selection_jaws = representative_evaluation["jaws"]
    tilt_selection_margin = representative_evaluation["margin"]
    tilt_selection_shifts = representative_evaluation["shifts"]
    (
        tilt_test_probability,
        tilt_test_final,
        tilt_test_peak,
        tilt_test_jaws,
        tilt_test_margin,
        tilt_test_shifts,
    ) = tilt_model.predict_distribution(test_distribution)
    selection_metrics["calibrated_scenario_tilt"] = representative_evaluation[
        "metrics"
    ]
    development_holdout_metrics["calibrated_scenario_tilt"] = classification_metrics(
        y_test_distribution,
        tilt_test_probability,
        distribution_test_weights,
    )
    for metrics in selection_metrics.values():
        _add_player_counts(metrics, selection_distribution)
    for metrics in development_holdout_metrics.values():
        _add_player_counts(metrics, test_distribution)
    selection_distribution_metrics = {
        "joint": joint_selection_distribution_metrics,
        "tilt": representative_evaluation["distributionMetrics"],
    }
    selection_high_performance_metrics = {
        "joint": joint_selection_high_performance,
        "tilt": representative_evaluation["highPerformanceMetrics"],
    }
    maximum_coverage_regression = representative_evaluation[
        "maximumCoverageRegression"
    ]
    selection_stage_distribution = {
        "joint": joint_selection_stage_distribution,
        "tilt": representative_evaluation["stageDistribution"],
    }
    maximum_early_stage_coverage_regression = representative_evaluation[
        "maximumEarlyStageCoverageRegression"
    ]
    selection_stage_skill = {
        "joint": joint_selection_stage_skill,
        "tilt": representative_evaluation["stageSkill"],
    }
    brier_noninferiority = representative_evaluation["brierNoninferiorityPassed"]
    early_brier_noninferiority = representative_evaluation[
        "earlyBrierNoninferiorityPassed"
    ]
    minimum_early_stage_absolute_coverage = representative_evaluation[
        "minimumEarlyStageAbsoluteCoverage"
    ]
    maximum_early_event_coverage_regression = representative_evaluation[
        "maximumEarlyEventCoverageRegression"
    ]
    selection_extension_metrics = representative_evaluation["extensionMetrics"]
    support_extension_gate = representative_evaluation[
        "supportExtensionGatePassed"
    ]
    early_interval_release_gate = bool(
        minimum_early_stage_absolute_coverage >= 0.65
    )
    champion = (
        "calibrated_scenario_tilt"
        if tilt_admitted
        else "joint_residual_career_distribution"
    )
    if tilt_admitted:
        champion_probability = tilt_test_probability
        final_quantiles = tilt_test_final
        peak_quantiles = tilt_test_peak
        jaws_quantiles = tilt_test_jaws
        jaws_margin_quantiles = tilt_test_margin
    else:
        champion_probability = joint_test_probability
        final_quantiles = joint_test_final
        peak_quantiles = joint_test_peak
        jaws_quantiles = joint_test_jaws
        jaws_margin_quantiles = joint_test_margin
    chosen_selection_high_performance = selection_high_performance_metrics[
        "tilt" if champion == "calibrated_scenario_tilt" else "joint"
    ]
    performance_stage_metric_keys = {
        "first": "firstSeason",
        "seasons_2_3": "seasonsTwoToThree",
        "seasons_4_6": "seasonsFourToSix",
        "seasons_7_10": "seasonsSevenToTen",
    }
    high_performance_stage_gates: dict[str, Any] = {}
    for stage, metric_key in performance_stage_metric_keys.items():
        for role in ("hitter", "pitcher"):
            gate_key = f"{role}:{stage}"
            metrics = chosen_selection_high_performance.get(f"{metric_key}:{role}")
            passed = bool(
                metrics
                and abs(float(metrics["medianBiasP50MinusFinal"])) <= 10.0
                and float(metrics["meanAbsoluteError"]) <= 20.0
                and float(metrics["medianP10P90Width"]) >= 20.0
            )
            high_performance_stage_gates[gate_key] = {
                "passed": passed,
                "selectionMetrics": metrics,
            }
    failed_high_performance_stages = sorted(
        stage
        for stage, result in high_performance_stage_gates.items()
        if not result["passed"]
    )
    young_elite_distribution_gate = not failed_high_performance_stages
    era_sensitivity = _era_sensitivity(
        champion,
        train,
        stack_calibration,
        test,
        development_holdout_metrics,
        tilt_source=tilt_source,
        tilt_classifier_weight=tilt_classifier_weight,
    )
    development_holdout_stage_skill = _stage_slice_metrics(
        test_distribution, champion_probability
    )
    development_holdout_stage_distribution = _stage_distribution_metrics(
        test_distribution,
        final_quantiles,
        peak_quantiles,
        jaws_quantiles,
    )
    selected_selection_stage_distribution = selection_stage_distribution[
        "tilt" if champion == "calibrated_scenario_tilt" else "joint"
    ]
    early_hall_event_tail_diagnostic = {
        "status": "failed_research_diagnostic",
        "warningCode": "early_hall_tail_not_learned_research_only",
        "selection": _early_hall_event_tail_summary(
            selected_selection_stage_distribution
        ),
        "developmentHoldout": _early_hall_event_tail_summary(
            development_holdout_stage_distribution
        ),
        "centralIntervalCaveat": "P10-P90 coverage conditional on rare realized Hall-caliber outcomes is descriptive and is not expected to equal the nominal 80% unconditional rate",
        "publicationControl": "warning_only_not_rank_withholding",
        "requiredNextEvaluation": [
            "learned elite-tail component trained without outcome leakage",
            "P95 and P99 terminal-WAR and JAWS calibration",
            "expected-shortfall evaluation above Hall-caliber thresholds",
            "preregistered untouched forward/debut-cohort validation",
        ],
    }
    development_holdout_first_season_ranking = _first_season_ranking_metrics(
        test_distribution, champion_probability
    )
    first_season_skill = development_holdout_stage_skill["firstSeason"]
    top_one = development_holdout_first_season_ranking["top1Percent"]
    rookie_ranking_gate = bool(
        first_season_skill["rocAuc"] is not None
        and float(first_season_skill["rocAuc"]) >= 0.60
        and first_season_skill["averagePrecision"] is not None
        and float(first_season_skill["averagePrecision"])
        >= 2.0 * float(first_season_skill["weightedEventRate"])
        and float(top_one["precision"])
        > float(development_holdout_first_season_ranking["baseRate"])
    )

    report: dict[str, Any] = {
        "schemaVersion": TOURNAMENT_SCHEMA_VERSION,
        "modelVersion": MODEL_VERSION,
        "targetVersion": TARGET_VERSION,
        "publicationState": "research",
        "releaseEligible": False,
        "releaseGates": {
            "earlyInterval80Coverage": {
                "passed": early_interval_release_gate,
                "observedMinimum": float(
                    minimum_early_stage_absolute_coverage
                ),
                "requiredMinimum": 0.65,
                "scope": "first-season and seasons-one-to-three final-WAR, peak-seven, and JAWS intervals on the selection cohort",
                "selectionRole": "release_only_not_champion_selection",
            },
            "prospectiveValidation": {
                "passed": False,
                "reason": "no untouched forward debut-cohort evaluation has been completed",
            },
        },
        "developmentHoldoutIntegrity": {
            "humanReviewedDuringDevelopment": True,
            "pristine": False,
            "use": "retrospective architecture audit only",
            "selectionUse": "excluded_from_mechanical_champion_selection",
            "nextValidation": "freeze pipeline and register a new untouched forward/debut cohort before superiority or release claims",
        },
        "earlyHallEventTailDiagnostic": early_hall_event_tail_diagnostic,
        "split": split.as_dict(),
        "splitAxis": "completed_career_end_year",
        "calibrationSelectionSplit": inner_split,
        "evaluationUnit": "player-season landmarks weighted to equal total weight per player",
        "entrants": development_holdout_metrics,
        "preCalibrationSelectionMetrics": pre_calibration_selection_metrics,
        "selectionMetrics": selection_metrics,
        "developmentHoldoutMetrics": development_holdout_metrics,
        "rankingEligibility": {
            "joint_residual_career_distribution": True,
            "calibrated_scenario_tilt": tilt_admitted,
            "age_position_empirical_prior": False,
            "regularized_logistic": False,
            "nonlinear_hist_gradient_boosting": False,
            "calibrated_ensemble": False,
        },
        "champion": champion,
        "championStatus": inner_split["championStatus"],
        "championRule": "search nonzero classifier weights in ascending selection Brier order and admit the first candidate satisfying overall and early Brier noninferiority, relative overall/early/Hall-event interval-coverage noninferiority, and bounded one-scenario support extensions; absolute early interval coverage is a separate release gate",
        "jointScenarioSupport": {
            "pairedResidualDrawsPerRole": joint_model.draws,
            "probabilityResolution": 1.0 / joint_model.draws,
            "calibrationPlayers": int(stack_distribution["bbref_id"].nunique()),
            "residualBankPlayers": joint_model.residual_bank_players_,
            "performanceBankCareerWarEdges": {
                key: [float(value[0]), float(value[1])]
                for key, value in joint_model.performance_edges_.items()
            },
            "minimumPlayersPerStageBank": 50,
        },
        "scenarioTilt": {
            "sourceClassifier": tilt_source,
            "sourceClassifierWeight": tilt_classifier_weight,
            "jointProbabilityWeight": 1.0 - tilt_classifier_weight,
            "admitted": tilt_admitted,
            "maximumSelectionInterval80CoverageRegression": float(
                maximum_coverage_regression
            ),
            "maximumSelectionEarlyStageInterval80CoverageRegression": float(
                maximum_early_stage_coverage_regression
            ),
            "minimumSelectionEarlyStageAbsoluteInterval80Coverage": float(
                minimum_early_stage_absolute_coverage
            ),
            "maximumSelectionEarlyHofEventInterval80CoverageRegression": float(
                maximum_early_event_coverage_regression
            ),
            "supportExtensionGatePassed": bool(support_extension_gate),
            "supportExtensionP90JawsMaximum": 60.0,
            "supportExtensionAbsoluteJawsMaximum": 100.0,
            "selectionBrierNoninferiorityTolerance": 1e-6,
            "selectionBrierNoninferiorityPassed": bool(brier_noninferiority),
            "selectionEarlyStageBrierNoninferiorityPassed": bool(
                early_brier_noninferiority
            ),
            "blendGrid": blend_grid,
            "blendSelectionPolicy": "ascending selection Brier constrained search; stop at the first candidate passing all relative distribution gates",
            "absoluteEarlyIntervalCoverageRole": "release_gate_only_not_tournament_admission",
            "earlyIntervalReleaseGatePassed": early_interval_release_gate,
            "selectionEarlyStageDistributionMetrics": selection_stage_distribution,
            "selectionEarlyStageSkillMetrics": selection_stage_skill,
            "selectionHighPerformancePointMetrics": selection_high_performance_metrics,
            "selectionDistributionMetrics": selection_distribution_metrics,
            "selectionSupportExtensions": selection_extension_metrics,
            "developmentHoldoutSupportExtensions": _support_extension_metrics(
                tilt_test_shifts
            ),
            "supportExtensionPolicy": "when a paired scenario set has zero support on one side of the JAWS threshold, move only the nearest single scenario across the threshold, then assign calibrated tail mass by weights",
        },
        "youngEliteDistributionGate": {
            "passed": young_elite_distribution_gate,
            "stageGates": high_performance_stage_gates,
            "failedStages": failed_high_performance_stages,
            "rules": {
                "absoluteMedianBiasMaximum": 10.0,
                "meanAbsoluteErrorMaximum": 20.0,
                "medianP10P90WidthMinimum": 20.0,
            },
            "failurePolicy": "withhold top-decile terminal distribution and Hall rank in each failed tenure bank",
        },
        "distributionMetrics": {
            "finalCareerWar": regression_metrics(
                test_distribution["final_career_war"].to_numpy(dtype=float),
                final_quantiles,
                distribution_test_weights,
            ),
            "peakSevenWar": regression_metrics(
                test_distribution["final_peak_seven_war"].to_numpy(dtype=float),
                peak_quantiles,
                distribution_test_weights,
            ),
            "finalJaws": regression_metrics(
                test_distribution["final_jaws"].to_numpy(dtype=float),
                jaws_quantiles,
                distribution_test_weights,
            ),
            "jawsMarginOverPointInTimeStandard": regression_metrics(
                (
                    test_distribution["final_jaws"].to_numpy(dtype=float)
                    - test_distribution["standard_jaws"].to_numpy(dtype=float)
                ),
                jaws_margin_quantiles,
                distribution_test_weights,
            ),
        },
        "baseJointDevelopmentHoldoutDistributionMetrics": {
            "finalCareerWar": regression_metrics(
                test_distribution["final_career_war"].to_numpy(dtype=float),
                joint_test_final,
                distribution_test_weights,
            ),
            "peakSevenWar": regression_metrics(
                test_distribution["final_peak_seven_war"].to_numpy(dtype=float),
                joint_test_peak,
                distribution_test_weights,
            ),
            "finalJaws": regression_metrics(
                test_distribution["final_jaws"].to_numpy(dtype=float),
                joint_test_jaws,
                distribution_test_weights,
            )
        },
        "developmentHoldoutStageDistributionMetrics": development_holdout_stage_distribution,
        "developmentHoldoutTopDecileCareerWarPointMetrics": _high_performance_point_metrics(
            test_distribution, final_quantiles
        ),
        "eraSensitivity": era_sensitivity,
        "developmentHoldoutStageSlices": development_holdout_stage_skill,
        "developmentHoldoutFirstSeasonRanking": development_holdout_first_season_ranking,
        "rookieRankingGate": {
            "passed": rookie_ranking_gate,
            "rules": {
                "rocAucMinimum": 0.60,
                "averagePrecisionLiftMinimum": 2.0,
                "top1PercentPrecisionMustExceedBaseRate": True,
            },
            "failurePolicy": "withhold MLB season-1-to-3 Hall probability and MLB-census rank only if this discrimination gate fails",
            "tailDiagnosticIsSeparate": True,
        },
        "disclosures": [
            "This is a retrospective research tournament, not prospective validation.",
            "The chronological development holdout was inspected during model development and is no longer pristine; its metrics are retrospective architecture audits, not final validation.",
            "The player-disjoint chronological axis is completed-career end year, not a forward prediction origin; censoring-aware debut-cohort validation is still required for rookie claims.",
            "The ranking entrant is the only registered candidate that emits paired final-WAR and peak-seven scenarios; classifier-only models remain diagnostic comparators.",
            "Hall caliber is a provider-versioned statistical JAWS target, not induction probability.",
            "The primary target compares final career JAWS with the career-to-date position/role standard at each landmark and therefore rebaselines when that standard changes.",
            "Completed-career position/role Hall caliber is retained only as a diagnostic target.",
            "Paired residual scenarios are a coherent terminal-career baseline, not an annual career simulation.",
            "Early Hall-caliber outcome tail coverage and error are failed research diagnostics, not nominal conditional-coverage gates; P95/P99, expected-shortfall, and a learned elite-tail component are required next.",
            "Distribution evaluation excludes only broad hitter/pitcher role changes; P/RP and hitter-position standard changes remain in the point-in-time target.",
        ],
    }
    return CareerTournament(
        split=split,
        classifiers=classifiers,
        ensemble=ensemble,
        joint_model=joint_model,
        ranking_model=(
            tilt_model
            if champion == "calibrated_scenario_tilt"
            else JointDistributionWithShiftMetadata(joint_model)
        ),
        report=report,
    )


def _fresh_raw_classifiers() -> dict[str, Any]:
    return {
        "age_position_empirical_prior": AgePositionEmpiricalPrior(smoothing=20.0),
        "regularized_logistic": make_logistic_model(),
        "nonlinear_hist_gradient_boosting": make_nonlinear_model(),
    }


def _latest_calibration_cohorts(panel: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    resolved = panel.loc[panel["resolved_career"]].copy()
    outcomes = (
        resolved.sort_values(["bbref_id", "season"], kind="mergesort")
        .groupby("bbref_id", as_index=False)
        .agg(career_end_year=("career_end_year", "max"), hof_caliber=("hof_caliber", "last"))
        .sort_values(["career_end_year", "bbref_id"], kind="mergesort")
    )
    years = sorted(int(year) for year in outcomes["career_end_year"].unique())
    candidates: list[tuple[float, int]] = []
    target_cutoff = int(outcomes["career_end_year"].max()) - 3
    for cutoff in years[1:]:
        fit_players = outcomes.loc[outcomes["career_end_year"] < cutoff]
        calibration_players = outcomes.loc[outcomes["career_end_year"] >= cutoff]
        fit_events = int(fit_players["hof_caliber"].astype(int).sum())
        calibration_events = int(calibration_players["hof_caliber"].astype(int).sum())
        if (
            len(fit_players) >= 50
            and len(calibration_players) >= 20
            and fit_events >= 30
            and calibration_events >= 20
            and fit_players["hof_caliber"].nunique() == 2
            and calibration_players["hof_caliber"].nunique() == 2
        ):
            candidates.append((abs(cutoff - target_cutoff), cutoff))
    if not candidates:
        raise CareerDataError(
            "Resolved careers cannot support a latest chronological final-model calibration slice"
        )
    _, cutoff = min(candidates)
    fit_ids = tuple(
        outcomes.loc[outcomes["career_end_year"] < cutoff, "bbref_id"].astype(str)
    )
    calibration_ids = tuple(
        outcomes.loc[outcomes["career_end_year"] >= cutoff, "bbref_id"].astype(str)
    )
    fit = _cohort(resolved, fit_ids)
    calibration = _cohort(resolved, calibration_ids)
    lineage = {
        "trainingPlayers": len(fit_ids),
        "calibrationPlayers": len(calibration_ids),
        "trainingEventPlayers": int(
            outcomes.loc[outcomes["career_end_year"] < cutoff, "hof_caliber"]
            .astype(int)
            .sum()
        ),
        "calibrationEventPlayers": int(
            outcomes.loc[outcomes["career_end_year"] >= cutoff, "hof_caliber"]
            .astype(int)
            .sum()
        ),
        "trainingCareerEndYear": cutoff - 1,
        "calibrationStartYear": cutoff,
        "calibrationEndYear": int(outcomes["career_end_year"].max()),
        "playerDisjoint": True,
        "prospectiveValidation": False,
    }
    return fit, calibration, lineage


def fit_final_scoring_bundle(
    panel: pd.DataFrame,
    selected_entrant: str,
    *,
    tilt_source: str | None = None,
    tilt_classifier_weight: float | None = None,
    withheld_high_performance_stages: Sequence[str] = (),
    withhold_early_mlb: bool = False,
) -> CareerScoringBundle:
    fit, calibration, lineage = _latest_calibration_cohorts(panel)
    if selected_entrant not in {
        "joint_residual_career_distribution",
        "calibrated_scenario_tilt",
    }:
        raise CareerDataError(
            "Final ranking requires the coherent joint_residual_career_distribution entrant"
        )
    fit_distribution = _distribution_subset(fit)
    calibration_distribution = _distribution_subset(calibration)
    fit_distribution_weights = player_equal_weights(fit_distribution)
    calibration_distribution_weights = player_equal_weights(calibration_distribution)
    joint_model = JointResidualCareerDistribution().fit(
        fit_distribution,
        calibration_distribution,
        fit_distribution_weights,
        calibration_distribution_weights,
    )
    all_resolved_distribution = pd.concat(
        [fit_distribution, calibration_distribution], ignore_index=True
    ).sort_values(["bbref_id", "season"], kind="mergesort").reset_index(drop=True)
    joint_model.refit_point_models(
        all_resolved_distribution,
        player_equal_weights(all_resolved_distribution),
    )
    residual_point_fit_end_year = int(lineage["trainingCareerEndYear"])
    final_point_fit_end_year = int(lineage["calibrationEndYear"])
    lineage["residualPointModelTrainingCareerEndYear"] = residual_point_fit_end_year
    lineage["residualCalibrationStartYear"] = int(lineage["calibrationStartYear"])
    lineage["residualCalibrationEndYear"] = final_point_fit_end_year
    lineage["pointModelTrainingCareerEndYear"] = final_point_fit_end_year
    lineage["pointModelTrainingFeatureSeason"] = int(
        all_resolved_distribution["season"].max()
    )
    lineage["trainingCareerEndYear"] = final_point_fit_end_year
    lineage["finalScoringRefitMethod"] = (
        "held_out_residual_banks_then_point_models_refit_on_all_resolved_careers"
    )
    lineage["residualCalibrationPlayerDisjointFromResidualGeneratingPointFit"] = True
    lineage["fullPlayerCrossFit"] = False
    lineage["exactCurrentScoringRefitCrossFitted"] = False
    lineage["exactCurrentScoringRefitEvaluated"] = False
    lineage["currentScoringProbabilitiesInheritTournamentMetrics"] = False
    lineage["pairedResidualDrawsPerRole"] = joint_model.draws
    lineage["distributionTrainingLandmarks"] = len(fit_distribution)
    lineage["distributionCalibrationLandmarks"] = len(calibration_distribution)
    lineage["pointModelTrainingLandmarks"] = len(all_resolved_distribution)
    lineage["withheldHighPerformanceStages"] = sorted(
        str(value) for value in withheld_high_performance_stages
    )
    lineage["withholdEarlyMlbRanking"] = bool(withhold_early_mlb)
    lineage["performanceBankCareerWarEdges"] = {
        key: [float(value[0]), float(value[1])]
        for key, value in joint_model.performance_edges_.items()
    }
    if selected_entrant == "calibrated_scenario_tilt":
        if tilt_source is None:
            raise CareerDataError("Final scenario tilt requires its selected source classifier")
        if tilt_classifier_weight is None:
            raise CareerDataError("Final scenario tilt requires its frozen classifier weight")
        classifier_model = _fit_calibrated_family(tilt_source, fit, calibration)
        all_resolved = pd.concat(
            [fit, calibration], ignore_index=True
        ).sort_values(["bbref_id", "season"], kind="mergesort").reset_index(drop=True)
        classifier_model = _refit_calibrated_base_models(
            classifier_model, tilt_source, all_resolved
        )
        probability_model = BlendedTailProbabilityModel(
            joint_model,
            classifier_model,
            tilt_source,
            tilt_classifier_weight,
        )
        ranking_model = CalibratedScenarioTiltDistribution(
            joint_model, probability_model, f"joint+{tilt_source}"
        )
        lineage["scenarioTiltSourceClassifier"] = tilt_source
        lineage["scenarioTiltClassifierWeight"] = tilt_classifier_weight
        lineage["classifierBaseTrainingCareerEndYear"] = final_point_fit_end_year
        lineage["classifierBaseTrainingFeatureSeason"] = int(
            all_resolved["season"].max()
        )
        lineage["classifierCalibrationStartYear"] = int(
            lineage["calibrationStartYear"]
        )
        lineage["classifierCalibrationEndYear"] = final_point_fit_end_year
        lineage["classifierRefitMethod"] = (
            "freeze_held_out_sigmoid_or_stack_calibrator_then_refit_raw_base_on_all_resolved_careers"
        )
        lineage["classifierRefitCalibrationApproximate"] = True
    else:
        probability_model = None
        ranking_model = JointDistributionWithShiftMetadata(joint_model)
    return CareerScoringBundle(
        selected_entrant=selected_entrant,
        classifier=probability_model,
        joint_model=joint_model,
        ranking_model=ranking_model,
        lineage=lineage,
    )


def quantile_dict(values: Sequence[float], digits: int = 3) -> dict[str, float]:
    array = np.maximum.accumulate(np.asarray(values, dtype=float))
    return {
        name: round(float(value), digits)
        for name, value in zip(QUANTILE_NAMES, array, strict=True)
    }
