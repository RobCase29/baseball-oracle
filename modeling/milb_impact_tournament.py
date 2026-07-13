from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd
from scipy.special import expit, logit
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler


TOURNAMENT_SCHEMA_VERSION = "milb-impact-tournament/v1"
MODEL_VERSION = "milb-impact-five-calendar-year-war-v1"
PRIMARY_TARGET_COLUMN = "mlb_war_next_5_ge_5"
EXPLORATORY_TARGET_COLUMN = "mlb_war_next_5_ge_10"
TARGET_WINDOW_SEASONS = 5
RANDOM_SEED = 29
BASELINE_MODEL_NAME = "age_level_role_performance_prior"
CHALLENGER_MODEL_NAMES = ("regularized_logistic", "nonlinear", "logit_blend")
MODEL_NAMES = (BASELINE_MODEL_NAME, *CHALLENGER_MODEL_NAMES)

NUMERIC_FEATURES = (
    "age",
    "height_inches",
    "weight_pounds",
    "membership_stint_count",
    "prior_bb_rate",
    "prior_k_rate",
    "prior_k_minus_bb_rate",
    "prior_iso",
    "prior_babip",
    "prior_batting_g",
    "prior_batting_pa",
    "prior_batting_ab",
    "prior_batting_hr",
    "prior_batting_bb",
    "prior_batting_so",
    "prior_batting_sb",
    "prior_era",
    "prior_whip",
    "prior_pitching_g",
    "prior_pitching_ip",
    "prior_pitching_tbf",
    "prior_pitching_hr",
    "prior_pitching_bb",
    "prior_pitching_so",
)

CATEGORICAL_FEATURES = (
    "role",
    "position",
    "prior_level",
    "last_observed_level",
    "bats",
    "throws",
    "pooled_stats_across_levels",
    "pooled_stats_across_organizations",
    "role_inference_basis",
)

REQUIRED_PANEL_COLUMNS = (
    "snapshot_id",
    "player_id",
    "edition",
    "effective_time_safe",
    "identity_resolved",
    "model_eligible",
    *NUMERIC_FEATURES,
    *CATEGORICAL_FEATURES,
)


class MilbImpactTournamentError(ValueError):
    pass


@dataclass(frozen=True)
class ImpactFold:
    validation_season: int
    training_label_available_through: int
    train_index: tuple[int, ...]
    validation_index: tuple[int, ...]
    purged_player_rows: int
    purged_players: int


def _require_columns(frame: pd.DataFrame, columns: Sequence[str], label: str) -> None:
    missing = sorted(set(columns) - set(frame.columns))
    if missing:
        raise MilbImpactTournamentError(f"{label} is missing columns: {', '.join(missing)}")


def prepare_labeled_panel(
    snapshots: pd.DataFrame,
    targets: pd.DataFrame,
    *,
    target_column: str = PRIMARY_TARGET_COLUMN,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    _require_columns(snapshots, REQUIRED_PANEL_COLUMNS, "MiLB snapshots")
    _require_columns(
        targets,
        (
            "snapshot_id",
            "player_id",
            "edition",
            "window_end_season",
            "target_mature",
            target_column,
        ),
        "MiLB impact targets",
    )
    if snapshots["snapshot_id"].isna().any() or snapshots["snapshot_id"].duplicated().any():
        raise MilbImpactTournamentError("MiLB snapshot IDs must be non-null and unique")
    if targets["snapshot_id"].isna().any() or targets["snapshot_id"].duplicated().any():
        raise MilbImpactTournamentError("MiLB target snapshot IDs must be non-null and unique")

    joined = snapshots.merge(
        targets[
            [
                "snapshot_id",
                "player_id",
                "edition",
                "window_end_season",
                "target_mature",
                target_column,
                *(
                    ["mlb_war_next_5_seasons"]
                    if "mlb_war_next_5_seasons" in targets
                    else []
                ),
                *(["identity_resolution"] if "identity_resolution" in targets else []),
                *(["label_status"] if "label_status" in targets else []),
            ]
        ],
        on=["snapshot_id", "player_id", "edition"],
        how="inner",
        validate="one_to_one",
    )
    if len(joined) != len(snapshots) or len(joined) != len(targets):
        raise MilbImpactTournamentError(
            "Snapshots and targets must have identical one-to-one coverage"
        )

    flags = {
        "effective_time_safe": joined["effective_time_safe"].fillna(False).astype(bool),
        "identity_resolved": joined["identity_resolved"].fillna(False).astype(bool),
        "model_eligible": joined["model_eligible"].fillna(False).astype(bool),
        "target_mature": joined["target_mature"].fillna(False).astype(bool),
    }
    eligible = np.logical_and.reduce([value.to_numpy() for value in flags.values()])
    exclusions = {
        name: int((~value).sum())
        for name, value in flags.items()
    }
    panel = joined.loc[eligible].copy()
    if panel.empty:
        raise MilbImpactTournamentError("No effective-time-safe mature impact rows remain")
    if panel[target_column].isna().any():
        raise MilbImpactTournamentError("Mature impact rows cannot have missing targets")
    numeric_target = panel[target_column].astype(int)
    if not numeric_target.isin([0, 1]).all():
        raise MilbImpactTournamentError("Impact target must be binary")
    panel[target_column] = numeric_target
    panel["edition"] = pd.to_numeric(panel["edition"], errors="raise").astype(int)
    panel["window_end_season"] = pd.to_numeric(
        panel["window_end_season"], errors="raise"
    ).astype(int)
    if not panel["window_end_season"].eq(panel["edition"] + TARGET_WINDOW_SEASONS).all():
        raise MilbImpactTournamentError(
            "Impact target window does not match the five-season contract"
        )
    panel = panel.sort_values(["edition", "player_id", "snapshot_id"], kind="mergesort")
    panel = panel.reset_index(drop=True)
    audit = {
        "inputRows": int(len(joined)),
        "eligibleRows": int(len(panel)),
        "eligiblePlayers": int(panel["player_id"].nunique()),
        "eventRows": int(panel[target_column].sum()),
        "eventPlayers": int(panel.loc[panel[target_column].eq(1), "player_id"].nunique()),
        "exclusions": exclusions,
        "effectiveTimeSafe": True,
        "knowledgeTimeVerified": bool(
            panel.get("knowledge_time_verified", pd.Series(False, index=panel.index))
            .fillna(False)
            .astype(bool)
            .all()
        ),
    }
    return panel, audit


def player_equal_weights(frame: pd.DataFrame) -> np.ndarray:
    _require_columns(frame, ("player_id",), "weight frame")
    counts = frame.groupby("player_id")["player_id"].transform("size").astype(float)
    weights = 1.0 / counts.clip(lower=1.0)
    return (weights / weights.mean()).to_numpy(dtype=float)


def make_expanding_origin_folds(
    panel: pd.DataFrame,
    *,
    target_column: str = PRIMARY_TARGET_COLUMN,
    minimum_training_rows: int = 1_000,
    minimum_training_events: int = 20,
    purge_validation_players: bool = True,
) -> list[ImpactFold]:
    _require_columns(
        panel,
        ("player_id", "edition", "window_end_season", target_column),
        "impact panel",
    )
    folds: list[ImpactFold] = []
    for validation_season in sorted(panel["edition"].astype(int).unique()):
        validation = panel.loc[panel["edition"].eq(validation_season)]
        training = panel.loc[panel["window_end_season"].le(validation_season)]
        before_purge = training
        purged_players = 0
        if purge_validation_players and not training.empty:
            validation_players = set(validation["player_id"].astype(str))
            purge = training["player_id"].astype(str).isin(validation_players)
            purged_players = int(training.loc[purge, "player_id"].nunique())
            training = training.loc[~purge]
        if (
            validation.empty
            or len(training) < minimum_training_rows
            or int(training[target_column].sum()) < minimum_training_events
            or training[target_column].nunique() < 2
        ):
            continue
        if int(training["window_end_season"].max()) > validation_season:
            raise MilbImpactTournamentError("Expanding-origin fold contains unavailable labels")
        if purge_validation_players and set(training["player_id"]) & set(validation["player_id"]):
            raise MilbImpactTournamentError("Validation-player purge failed")
        folds.append(
            ImpactFold(
                validation_season=int(validation_season),
                training_label_available_through=int(validation_season),
                train_index=tuple(int(value) for value in training.index),
                validation_index=tuple(int(value) for value in validation.index),
                purged_player_rows=int(len(before_purge) - len(training)),
                purged_players=purged_players,
            )
        )
    if not folds:
        raise MilbImpactTournamentError("No expanding-origin folds satisfy training support")
    return folds


def feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    _require_columns(frame, (*NUMERIC_FEATURES, *CATEGORICAL_FEATURES), "feature frame")
    result = pd.DataFrame(index=frame.index)
    for column in NUMERIC_FEATURES:
        result[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in CATEGORICAL_FEATURES:
        result[column] = frame[column].astype("string").fillna("missing").astype(str)
    return result


def _age_band(values: pd.Series) -> pd.Series:
    return pd.cut(
        pd.to_numeric(values, errors="coerce"),
        bins=[-np.inf, 19, 21, 23, 25, np.inf],
        labels=["19_or_younger", "20_21", "22_23", "24_25", "26_or_older"],
    ).astype("string").fillna("missing")


def _performance_signal(frame: pd.DataFrame) -> pd.Series:
    role = frame["role"].astype(str)
    bb_rate = pd.to_numeric(frame["prior_bb_rate"], errors="coerce")
    k_rate = pd.to_numeric(frame["prior_k_rate"], errors="coerce")
    iso = pd.to_numeric(frame["prior_iso"], errors="coerce")
    k_minus_bb = pd.to_numeric(frame["prior_k_minus_bb_rate"], errors="coerce")
    hitter = iso + bb_rate - k_rate
    pitcher = k_minus_bb.combine_first(k_rate - bb_rate)
    return pd.Series(np.where(role.eq("pitcher"), pitcher, hitter), index=frame.index, dtype=float)


def _weighted_quantiles(
    values: np.ndarray, weights: np.ndarray, quantiles: Sequence[float]
) -> np.ndarray:
    finite = np.isfinite(values) & np.isfinite(weights) & (weights > 0)
    if not finite.any():
        return np.asarray([], dtype=float)
    selected_values = values[finite]
    selected_weights = weights[finite]
    order = np.argsort(selected_values, kind="mergesort")
    selected_values = selected_values[order]
    selected_weights = selected_weights[order]
    cumulative = np.cumsum(selected_weights) - 0.5 * selected_weights
    cumulative /= selected_weights.sum()
    return np.interp(np.asarray(quantiles, dtype=float), cumulative, selected_values)


class AgeLevelRolePerformancePrior:
    """Hierarchically smoothed prior using only age, level, role, and a raw-stat band."""

    def __init__(self, smoothing: float = 50.0):
        self.smoothing = smoothing

    def _decorate(
        self,
        frame: pd.DataFrame,
        *,
        fit: bool,
        weights: np.ndarray | None = None,
    ) -> pd.DataFrame:
        decorated = pd.DataFrame(index=frame.index)
        decorated["role"] = frame["role"].astype("string").fillna("missing").astype(str)
        decorated["level"] = (
            frame["last_observed_level"].astype("string").fillna("missing").astype(str)
        )
        decorated["age_band"] = _age_band(frame["age"]).astype(str)
        decorated["performance"] = _performance_signal(frame)
        if fit:
            if weights is None:
                raise MilbImpactTournamentError("Baseline fit requires weights")
            self.performance_edges_: dict[str, tuple[float, ...]] = {}
            for role, indexes in decorated.groupby("role", sort=True).groups.items():
                positions = decorated.index.get_indexer(indexes)
                raw_edges = _weighted_quantiles(
                    decorated.loc[indexes, "performance"].to_numpy(dtype=float),
                    weights[positions],
                    (0.25, 0.50, 0.75),
                )
                self.performance_edges_[str(role)] = tuple(
                    float(value) for value in np.unique(raw_edges)
                )
        bands: list[str] = []
        for row in decorated.itertuples(index=False):
            if not np.isfinite(row.performance):
                bands.append("missing")
                continue
            edges = self.performance_edges_.get(str(row.role), ())
            bands.append(f"q{int(np.digitize(row.performance, edges, right=True)) + 1}")
        decorated["performance_band"] = bands
        return decorated.drop(columns="performance")

    def fit(
        self,
        frame: pd.DataFrame,
        target: Sequence[int],
        *,
        sample_weight: Sequence[float] | None = None,
    ) -> AgeLevelRolePerformancePrior:
        y = np.asarray(target, dtype=int)
        if len(y) != len(frame) or not np.isin(y, [0, 1]).all():
            raise MilbImpactTournamentError("Baseline target must be aligned and binary")
        weights = (
            np.ones(len(frame), dtype=float)
            if sample_weight is None
            else np.asarray(sample_weight, dtype=float)
        )
        if len(weights) != len(frame) or not np.isfinite(weights).all() or (weights <= 0).any():
            raise MilbImpactTournamentError(
                "Baseline weights must be aligned, finite, and positive"
            )
        data = self._decorate(frame, fit=True, weights=weights)
        data["target"] = y
        data["weight"] = weights
        self.global_rate_ = float(np.average(y, weights=weights))
        self.classes_ = np.asarray([0, 1], dtype=int)
        self.levels_: list[tuple[tuple[str, ...], dict[tuple[str, ...], float]]] = []
        hierarchy = (
            ("role",),
            ("role", "level"),
            ("role", "level", "age_band"),
            ("role", "level", "age_band", "performance_band"),
        )
        parent_rates: dict[tuple[str, ...], float] = {}
        for columns in hierarchy:
            rates: dict[tuple[str, ...], float] = {}
            for key, group in data.groupby(list(columns), sort=True, observed=True):
                key_tuple = (str(key),) if not isinstance(key, tuple) else tuple(map(str, key))
                if len(columns) == 1:
                    parent = self.global_rate_
                else:
                    parent = parent_rates.get(key_tuple[:-1], self.global_rate_)
                weight = float(group["weight"].sum())
                events = float((group["target"] * group["weight"]).sum())
                rates[key_tuple] = (events + self.smoothing * parent) / (
                    weight + self.smoothing
                )
            parent_rates.update(rates)
            self.levels_.append((columns, rates))
        return self

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        if not hasattr(self, "levels_"):
            raise MilbImpactTournamentError("Baseline is not fitted")
        data = self._decorate(frame, fit=False)
        probabilities: list[float] = []
        for row in data.to_dict("records"):
            probability = self.global_rate_
            for columns, rates in self.levels_:
                key = tuple(str(row[column]) for column in columns)
                if key in rates:
                    probability = rates[key]
            probabilities.append(float(np.clip(probability, 1e-6, 1.0 - 1e-6)))
        positive = np.asarray(probabilities, dtype=float)
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
            ("one_hot", OneHotEncoder(handle_unknown="ignore", min_frequency=20)),
        ]
    )
    return ColumnTransformer(
        [
            ("numeric", numeric, list(NUMERIC_FEATURES)),
            ("categorical", categorical, list(CATEGORICAL_FEATURES)),
        ]
    )


def _tree_preprocessor() -> ColumnTransformer:
    numeric = Pipeline(
        [
            (
                "impute",
                SimpleImputer(
                    strategy="median", add_indicator=True, keep_empty_features=True
                ),
            )
        ]
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
        [
            ("numeric", numeric, list(NUMERIC_FEATURES)),
            ("categorical", categorical, list(CATEGORICAL_FEATURES)),
        ]
    )


def make_regularized_logistic() -> Pipeline:
    return Pipeline(
        [
            ("features", _linear_preprocessor()),
            (
                "classifier",
                LogisticRegression(
                    C=0.25,
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
                    learning_rate=0.04,
                    max_iter=150,
                    max_leaf_nodes=15,
                    min_samples_leaf=100,
                    l2_regularization=2.0,
                    early_stopping=False,
                    random_state=RANDOM_SEED,
                ),
            ),
        ]
    )


def fit_models(
    frame: pd.DataFrame,
    target: Sequence[int],
    sample_weight: Sequence[float],
) -> dict[str, Any]:
    x = feature_frame(frame)
    y = np.asarray(target, dtype=int)
    weights = np.asarray(sample_weight, dtype=float)
    baseline = AgeLevelRolePerformancePrior().fit(x, y, sample_weight=weights)
    logistic = make_regularized_logistic().fit(
        x, y, classifier__sample_weight=weights
    )
    nonlinear = make_nonlinear_model().fit(
        x, y, classifier__sample_weight=weights
    )
    return {
        BASELINE_MODEL_NAME: baseline,
        "regularized_logistic": logistic,
        "nonlinear": nonlinear,
    }


def predict_models(models: Mapping[str, Any], frame: pd.DataFrame) -> dict[str, np.ndarray]:
    x = feature_frame(frame)
    predictions = {
        name: np.clip(model.predict_proba(x)[:, 1], 1e-6, 1.0 - 1e-6)
        for name, model in models.items()
    }
    if "regularized_logistic" in predictions and "nonlinear" in predictions:
        predictions["logit_blend"] = expit(
            0.5 * logit(predictions["regularized_logistic"])
            + 0.5 * logit(predictions["nonlinear"])
        )
    return predictions


def generate_expanding_origin_predictions(
    panel: pd.DataFrame,
    *,
    target_column: str = PRIMARY_TARGET_COLUMN,
    minimum_training_rows: int = 1_000,
    minimum_training_events: int = 20,
    purge_validation_players: bool = True,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    folds = make_expanding_origin_folds(
        panel,
        target_column=target_column,
        minimum_training_rows=minimum_training_rows,
        minimum_training_events=minimum_training_events,
        purge_validation_players=purge_validation_players,
    )
    prediction_frames: list[pd.DataFrame] = []
    fold_reports: list[dict[str, Any]] = []
    for fold in folds:
        train = panel.loc[list(fold.train_index)].copy()
        validation = panel.loc[list(fold.validation_index)].copy()
        weights = player_equal_weights(train)
        models = fit_models(train, train[target_column].to_numpy(), weights)
        predictions = predict_models(models, validation)
        output_columns = [
            "snapshot_id",
            "player_id",
            "edition",
            "role",
            "last_observed_level",
            "age",
            target_column,
        ]
        if "mlb_war_next_5_seasons" in validation:
            output_columns.append("mlb_war_next_5_seasons")
        output = validation[output_columns].copy()
        output["validation_season"] = fold.validation_season
        for name, values in predictions.items():
            output[f"probability__{name}"] = values
        prediction_frames.append(output)
        fold_reports.append(
            {
                "validationSeason": fold.validation_season,
                "trainingLabelAvailableThrough": fold.training_label_available_through,
                "trainingSnapshotSeasons": sorted(
                    int(value) for value in train["edition"].unique()
                ),
                "trainingRows": int(len(train)),
                "trainingPlayers": int(train["player_id"].nunique()),
                "trainingEventRows": int(train[target_column].sum()),
                "trainingEventPlayers": int(
                    train.loc[train[target_column].eq(1), "player_id"].nunique()
                ),
                "validationRows": int(len(validation)),
                "validationPlayers": int(validation["player_id"].nunique()),
                "validationEventRows": int(validation[target_column].sum()),
                "validationEventPlayers": int(
                    validation.loc[validation[target_column].eq(1), "player_id"].nunique()
                ),
                "purgedPlayerRows": fold.purged_player_rows,
                "purgedPlayers": fold.purged_players,
                "playerDisjoint": not bool(
                    set(train["player_id"]) & set(validation["player_id"])
                ),
                "pandemicWindowExposure": bool(
                    (validation["edition"] + 1).le(2020).any()
                    and (validation["edition"] + TARGET_WINDOW_SEASONS).ge(2020).any()
                ),
            }
        )
    predictions = pd.concat(prediction_frames, ignore_index=True)
    return predictions, fold_reports


def _weighted_binary_metrics(
    truth: np.ndarray,
    probability: np.ndarray,
    weights: np.ndarray,
    players: np.ndarray,
) -> dict[str, Any]:
    y = np.asarray(truth, dtype=int)
    p = np.clip(np.asarray(probability, dtype=float), 1e-6, 1.0 - 1e-6)
    w = np.asarray(weights, dtype=float)
    if len(y) == 0 or not (len(y) == len(p) == len(w) == len(players)):
        raise MilbImpactTournamentError("Metric arrays must be nonempty and aligned")
    if not np.isin(y, [0, 1]).all() or not np.isfinite(p).all():
        raise MilbImpactTournamentError("Metric truth/probability values are invalid")
    observed_rate = float(np.average(y, weights=w))
    mean_prediction = float(np.average(p, weights=w))
    result: dict[str, Any] = {
        "rows": int(len(y)),
        "players": int(len(np.unique(players))),
        "eventRows": int(y.sum()),
        "eventPlayers": int(len(np.unique(players[y == 1]))),
        "weightedEventRate": observed_rate,
        "meanPrediction": mean_prediction,
        "calibrationInTheLarge": mean_prediction - observed_rate,
        "brier": float(np.average((p - y) ** 2, weights=w)),
        "logLoss": float(log_loss(y, p, sample_weight=w, labels=[0, 1])),
        "rocAuc": None,
        "averagePrecision": None,
        "calibrationIntercept": None,
        "calibrationSlope": None,
    }
    if len(np.unique(y)) == 2:
        result["rocAuc"] = float(roc_auc_score(y, p, sample_weight=w))
        result["averagePrecision"] = float(
            average_precision_score(y, p, sample_weight=w)
        )
        calibration = LogisticRegression(C=1e6, solver="lbfgs", max_iter=2_000).fit(
            logit(p).reshape(-1, 1), y, sample_weight=w
        )
        result["calibrationIntercept"] = float(calibration.intercept_[0])
        result["calibrationSlope"] = float(calibration.coef_[0, 0])

    order = np.argsort(p, kind="mergesort")
    cumulative = np.cumsum(w[order])
    cut_points = np.linspace(0, float(w.sum()), 11)
    bin_ids = np.clip(np.searchsorted(cut_points[1:-1], cumulative, side="right"), 0, 9)
    gaps: list[tuple[float, float]] = []
    bins: list[dict[str, Any]] = []
    for bin_id in range(10):
        positions = order[bin_ids == bin_id]
        if len(positions) == 0:
            continue
        bin_weight = float(w[positions].sum())
        predicted = float(np.average(p[positions], weights=w[positions]))
        observed = float(np.average(y[positions], weights=w[positions]))
        gaps.append((bin_weight, abs(predicted - observed)))
        bins.append(
            {
                "rows": int(len(positions)),
                "weight": bin_weight,
                "predicted": predicted,
                "observed": observed,
            }
        )
    result["expectedCalibrationError"] = float(
        sum(weight * gap for weight, gap in gaps) / w.sum()
    )
    result["reliabilityBins"] = bins

    descending = np.argsort(-p, kind="mergesort")
    descending_weight = w[descending]
    for fraction, label in (
        (0.01, "topOnePercent"),
        (0.02, "topTwoPercent"),
        (0.05, "topFivePercent"),
        (0.10, "topDecile"),
    ):
        threshold = float(w.sum()) * fraction
        selected_count = max(1, int(np.searchsorted(np.cumsum(descending_weight), threshold)) + 1)
        selected = descending[:selected_count]
        selected_rate = float(np.average(y[selected], weights=w[selected]))
        selected_prediction = float(np.average(p[selected], weights=w[selected]))
        result[label] = {
            "rows": int(len(selected)),
            "players": int(len(np.unique(players[selected]))),
            "eventRows": int(y[selected].sum()),
            "eventPlayers": int(len(np.unique(players[selected][y[selected] == 1]))),
            "weightedEventRate": selected_rate,
            "meanPrediction": selected_prediction,
            "calibrationGap": selected_prediction - selected_rate,
            "lift": selected_rate / observed_rate if observed_rate > 0 else None,
        }
    return result


def _interval(values: Sequence[float]) -> list[float] | None:
    finite = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if len(finite) == 0:
        return None
    return [float(value) for value in np.quantile(finite, [0.025, 0.975])]


def player_cluster_bootstrap(
    predictions: pd.DataFrame,
    *,
    model_names: Sequence[str] = MODEL_NAMES,
    repetitions: int = 200,
    seed: int = RANDOM_SEED,
    target_column: str = PRIMARY_TARGET_COLUMN,
) -> dict[str, Any]:
    if repetitions <= 0:
        return {"repetitions": 0, "playerClusters": int(predictions["player_id"].nunique())}
    _require_columns(
        predictions,
        ("player_id", target_column, *[f"probability__{name}" for name in model_names]),
        "OOF predictions",
    )
    players = predictions["player_id"].astype(str).to_numpy()
    unique_players = np.unique(players)
    indexes = {player: np.flatnonzero(players == player) for player in unique_players}
    truth = predictions[target_column].astype(int).to_numpy()
    base_weights = player_equal_weights(predictions)
    probability = {
        name: predictions[f"probability__{name}"].to_numpy(dtype=float)
        for name in model_names
    }
    distributions: dict[str, dict[str, list[float]]] = {
        name: {
            "brier": [],
            "logLoss": [],
            "rocAuc": [],
            "averagePrecision": [],
            "topDecileLift": [],
        }
        for name in model_names
    }
    comparisons = {
        name: [] for name in model_names if name != BASELINE_MODEL_NAME
    }
    rng = np.random.default_rng(seed)
    for _ in range(repetitions):
        sampled_players = rng.choice(unique_players, size=len(unique_players), replace=True)
        selected = np.concatenate([indexes[player] for player in sampled_players])
        sample_truth = truth[selected]
        sample_players = players[selected]
        sample_weights = base_weights[selected]
        sample_brier: dict[str, float] = {}
        for name in model_names:
            metrics = _weighted_binary_metrics(
                sample_truth,
                probability[name][selected],
                sample_weights,
                sample_players,
            )
            sample_brier[name] = float(metrics["brier"])
            distributions[name]["brier"].append(float(metrics["brier"]))
            distributions[name]["logLoss"].append(float(metrics["logLoss"]))
            if metrics["rocAuc"] is not None:
                distributions[name]["rocAuc"].append(float(metrics["rocAuc"]))
            if metrics["averagePrecision"] is not None:
                distributions[name]["averagePrecision"].append(
                    float(metrics["averagePrecision"])
                )
            lift = metrics["topDecile"]["lift"]
            if lift is not None:
                distributions[name]["topDecileLift"].append(float(lift))
        for name in comparisons:
            comparisons[name].append(
                sample_brier[BASELINE_MODEL_NAME] - sample_brier[name]
            )
    return {
        "repetitions": int(repetitions),
        "playerClusters": int(len(unique_players)),
        "modelIntervals95": {
            name: {metric: _interval(values) for metric, values in values_by_metric.items()}
            for name, values_by_metric in distributions.items()
        },
        "pairedBrierImprovementVsBaseline95": {
            name: _interval(values) for name, values in comparisons.items()
        },
    }


def evaluate_oof_predictions(
    predictions: pd.DataFrame,
    *,
    target_column: str = PRIMARY_TARGET_COLUMN,
    bootstrap_repetitions: int = 200,
    bootstrap_seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    weights = player_equal_weights(predictions)
    truth = predictions[target_column].astype(int).to_numpy()
    players = predictions["player_id"].astype(str).to_numpy()
    metrics = {
        name: _weighted_binary_metrics(
            truth,
            predictions[f"probability__{name}"].to_numpy(dtype=float),
            weights,
            players,
        )
        for name in MODEL_NAMES
    }
    baseline_brier = float(metrics[BASELINE_MODEL_NAME]["brier"])
    for name, record in metrics.items():
        record["brierSkillVsTransparentBaseline"] = (
            0.0 if name == BASELINE_MODEL_NAME else 1.0 - float(record["brier"]) / baseline_brier
        )
    champion = min(
        MODEL_NAMES,
        key=lambda name: (float(metrics[name]["brier"]), float(metrics[name]["logLoss"]), name),
    )
    bootstrap = player_cluster_bootstrap(
        predictions,
        repetitions=bootstrap_repetitions,
        seed=bootstrap_seed,
        target_column=target_column,
    )
    champion_improvement = bootstrap.get("pairedBrierImprovementVsBaseline95", {}).get(
        champion
    )
    challenger_superiority_supported = bool(
        champion != BASELINE_MODEL_NAME
        and champion_improvement is not None
        and champion_improvement[0] > 0
    )
    return {
        "metrics": metrics,
        "selectedModel": champion,
        "selectionRule": "lowest equal-player-weighted OOF Brier, then log loss, then name",
        "challengerSuperioritySupported": challenger_superiority_supported,
        "bootstrap": bootstrap,
    }


def run_tournament(
    panel: pd.DataFrame,
    *,
    target_column: str = PRIMARY_TARGET_COLUMN,
    minimum_training_rows: int = 1_000,
    minimum_training_events: int = 20,
    bootstrap_repetitions: int = 200,
    bootstrap_seed: int = RANDOM_SEED,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    predictions, folds = generate_expanding_origin_predictions(
        panel,
        target_column=target_column,
        minimum_training_rows=minimum_training_rows,
        minimum_training_events=minimum_training_events,
        purge_validation_players=True,
    )
    evaluation = evaluate_oof_predictions(
        predictions,
        target_column=target_column,
        bootstrap_repetitions=bootstrap_repetitions,
        bootstrap_seed=bootstrap_seed,
    )
    for fold in folds:
        fold_predictions = predictions.loc[
            predictions["validation_season"].eq(fold["validationSeason"])
        ]
        fold_weights = player_equal_weights(fold_predictions)
        fold_truth = fold_predictions[target_column].astype(int).to_numpy()
        fold_players = fold_predictions["player_id"].astype(str).to_numpy()
        fold["metrics"] = {
            name: _weighted_binary_metrics(
                fold_truth,
                fold_predictions[f"probability__{name}"].to_numpy(dtype=float),
                fold_weights,
                fold_players,
            )
            for name in MODEL_NAMES
        }
    selected_model = str(evaluation["selectedModel"])
    selected_top_one = evaluation["metrics"][selected_model]["topOnePercent"]
    warnings = [
        "retrospective_challenger_selection_not_prospective_validation",
        "historical_archives_are_effective_time_safe_but_knowledge_time_unverified",
        "all_available_validation_target_windows_overlap_the_shortened_2020_season",
        "probability_is_not_a_hall_of_fame_probability_or_investment_return",
    ]
    if abs(float(selected_top_one["calibrationGap"])) >= 0.05:
        warnings.append("selected_model_top_one_percent_tail_is_materially_miscalibrated")
    report = {
        "schemaVersion": TOURNAMENT_SCHEMA_VERSION,
        "modelVersion": MODEL_VERSION,
        "targetColumn": target_column,
        "targetScope": "unconditional total MLB WAR in snapshot year + 1 through + 5",
        "foldPolicy": {
            "method": "expanding_prediction_origin",
            "labelAvailability": "training window_end_season <= validation snapshot season",
            "validationPlayerPurge": True,
            "equalTotalTrainingWeightPerPlayer": True,
            "validationMetrics": "equal total weight per player with player-cluster bootstrap",
        },
        "features": {
            "numeric": list(NUMERIC_FEATURES),
            "categorical": list(CATEGORICAL_FEATURES),
            "excluded": [
                "player identity",
                "organization identity",
                "future scouting grades",
                "public prospect rank",
                "Prospect Savant composite score",
            ],
        },
        "transparentBaseline": {
            "model": BASELINE_MODEL_NAME,
            "ageBands": ["19_or_younger", "20_21", "22_23", "24_25", "26_or_older"],
            "level": "last_observed_level",
            "hitterPerformance": "prior_iso + prior_bb_rate - prior_k_rate",
            "pitcherPerformance": "prior_k_minus_bb_rate",
            "performanceBands": "fold-training weighted quartiles within role",
            "hierarchy": "global -> role -> role-level -> role-level-age -> full cell",
            "empiricalBayesPriorStrength": 50.0,
        },
        "folds": folds,
        "evaluation": evaluation,
        "warnings": warnings,
        "releaseEligible": False,
        "status": "research_only",
    }
    return predictions, report


def fit_final_models(
    panel: pd.DataFrame,
    *,
    target_column: str = PRIMARY_TARGET_COLUMN,
) -> dict[str, Any]:
    weights = player_equal_weights(panel)
    models = fit_models(panel, panel[target_column].to_numpy(), weights)
    return {
        "schemaVersion": TOURNAMENT_SCHEMA_VERSION,
        "modelVersion": MODEL_VERSION,
        "targetColumn": target_column,
        "targetWindowSeasons": TARGET_WINDOW_SEASONS,
        "numericFeatures": NUMERIC_FEATURES,
        "categoricalFeatures": CATEGORICAL_FEATURES,
        "models": models,
        "blend": {
            "name": "logit_blend",
            "components": ("regularized_logistic", "nonlinear"),
            "weights": (0.5, 0.5),
        },
        "trainingRows": int(len(panel)),
        "trainingPlayers": int(panel["player_id"].nunique()),
        "trainingEventRows": int(panel[target_column].sum()),
        "trainingEventPlayers": int(
            panel.loc[panel[target_column].eq(1), "player_id"].nunique()
        ),
    }


def score_current_snapshots(
    final_bundle: Mapping[str, Any],
    snapshots: pd.DataFrame,
    *,
    selected_model: str,
) -> pd.DataFrame:
    _require_columns(
        snapshots,
        (
            "snapshot_id",
            "player_id",
            "edition",
            "effective_time_safe",
            "identity_resolved",
            "model_eligible",
            *NUMERIC_FEATURES,
            *CATEGORICAL_FEATURES,
        ),
        "current MiLB snapshots",
    )
    eligible = (
        snapshots["effective_time_safe"].fillna(False).astype(bool)
        & snapshots["identity_resolved"].fillna(False).astype(bool)
        & snapshots["model_eligible"].fillna(False).astype(bool)
    )
    scoring = snapshots.loc[eligible].copy()
    if scoring.empty:
        raise MilbImpactTournamentError("No current MiLB snapshots are scoreable")
    probabilities = predict_models(final_bundle["models"], scoring)
    if selected_model not in probabilities:
        raise MilbImpactTournamentError(f"Selected model is unavailable: {selected_model}")
    metadata_columns = [
        column
        for column in (
            "snapshot_id",
            "player_id",
            "mlbam_id",
            "bbref_id",
            "player_name",
            "edition",
            "as_of",
            "role",
            "position",
            "organization",
            "last_observed_organization",
            "last_observed_level",
            "age",
        )
        if column in scoring
    ]
    output = scoring[metadata_columns].copy()
    for name, values in probabilities.items():
        output[f"probability__{name}"] = values
    output["selected_model"] = selected_model
    output["impact_probability"] = probabilities[selected_model]
    output["target_window_start_season"] = scoring["edition"].astype(int) + 1
    output["target_window_end_season"] = (
        scoring["edition"].astype(int) + TARGET_WINDOW_SEASONS
    )
    output["target_scope"] = "unconditional_mlb_war_next_five_calendar_seasons_ge_5"
    output["model_version"] = MODEL_VERSION
    output["publication_state"] = "research"
    output["probability_interpretation"] = (
        "research_probability_for_ranking_not_release_calibrated_in_the_extreme_tail"
    )
    output = output.sort_values(
        ["impact_probability", "age", "player_id"],
        ascending=[False, True, True],
        kind="mergesort",
    ).reset_index(drop=True)
    output.insert(0, "rank", np.arange(1, len(output) + 1, dtype=int))
    return output
