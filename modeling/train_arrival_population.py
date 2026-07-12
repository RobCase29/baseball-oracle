from __future__ import annotations

import argparse
import json
import math
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

try:
    from modeling.arrival_corpus import CORPUS_SCHEMA_VERSION
    from modeling.contracts import SURVIVAL_HORIZON_MONTHS
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
except ModuleNotFoundError:
    from arrival_corpus import CORPUS_SCHEMA_VERSION
    from contracts import SURVIVAL_HORIZON_MONTHS
    from provenance import file_sha256, json_sha256, producer_metadata


ROOT = Path(__file__).resolve().parents[1]
RANDOM_SEED = 29
SUPPORTED_ROLES = ("hitter", "pitcher")
MIN_FEATURE_VALUES = 10
EMPIRICAL_BAYES_PRIOR_STRENGTH = 50.0

SHARED_NUMERIC_FEATURES = [
    "age",
    "height_inches",
    "weight_pounds",
    "membership_stint_count",
    "prior_bb_rate",
    "prior_k_rate",
    "prior_k_minus_bb_rate",
]

ROLE_NUMERIC_FEATURES = {
    "hitter": [
        "prior_iso",
        "prior_babip",
        "prior_batting_g",
        "prior_batting_pa",
        "prior_batting_ab",
        "prior_batting_hr",
        "prior_batting_bb",
        "prior_batting_so",
        "prior_batting_sb",
    ],
    "pitcher": [
        "prior_era",
        "prior_fip",
        "prior_xfip",
        "prior_whip",
        "prior_pitching_g",
        "prior_pitching_ip",
        "prior_pitching_tbf",
        "prior_pitching_hr",
        "prior_pitching_bb",
        "prior_pitching_so",
    ],
}

CATEGORICAL_FEATURES = [
    "prior_level",
    "last_observed_level",
    "organization",
    "last_observed_organization",
    "position",
    "bats",
    "throws",
    "has_prior_stats",
    "pooled_stats_across_levels",
    "pooled_stats_across_organizations",
    "role_inference_basis",
]


class PopulationTrainingError(ValueError):
    pass


def _portable_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return str(resolved)


def _resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def load_arrival_corpus(
    manifest_path: Path,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema_version") != CORPUS_SCHEMA_VERSION:
        raise PopulationTrainingError("Unsupported arrival corpus schema")
    manifest_address = manifest.get("manifest_sha256")
    if not isinstance(manifest_address, str):
        raise PopulationTrainingError("Arrival corpus manifest has no content address")
    canonical = dict(manifest)
    canonical.pop("manifest_sha256", None)
    if json_sha256(canonical) != manifest_address:
        raise PopulationTrainingError("Arrival corpus manifest content address is invalid")
    archived_manifest = manifest_path.parent / "manifests" / f"{manifest_address}.json"
    if (
        not archived_manifest.exists()
        or file_sha256(archived_manifest) != file_sha256(manifest_path)
    ):
        raise PopulationTrainingError("Arrival corpus manifest archive is missing or differs")

    inputs = manifest.get("inputs")
    outputs = manifest.get("outputs")
    if not isinstance(inputs, list) or not isinstance(outputs, dict):
        raise PopulationTrainingError("Arrival corpus manifest is incomplete")
    stable_content = {
        "schema_version": manifest["schema_version"],
        "data_cutoff": manifest["data_cutoff"],
        "snapshot_policy": manifest["snapshot_policy"],
        "input_dataset_content_sha256": [
            item["dataset_content_sha256"] for item in inputs
        ],
        "raw_archive_manifest_sha256": [
            item["archive"]["raw_archive_manifest_sha256"] for item in inputs
        ],
        "outputs": {
            name: {"rows": output["rows"], "sha256": output["sha256"]}
            for name, output in outputs.items()
        },
    }
    if json_sha256(stable_content) != manifest.get("corpus_content_sha256"):
        raise PopulationTrainingError("Arrival corpus stable content address is invalid")

    frames: dict[str, pd.DataFrame] = {}
    for name in ("snapshots", "labels"):
        output = outputs.get(name)
        if not isinstance(output, dict):
            raise PopulationTrainingError(f"Arrival corpus has no {name} output")
        path = _resolve_path(str(output.get("content_addressed_path")))
        if not path.exists() or file_sha256(path) != output.get("sha256"):
            raise PopulationTrainingError(f"Arrival corpus {name} archive is invalid")
        frame = pd.read_parquet(path)
        if len(frame) != int(output.get("rows", -1)):
            raise PopulationTrainingError(f"Arrival corpus {name} row count differs")
        frames[name] = frame

    snapshots = frames["snapshots"]
    labels = frames["labels"]
    snapshots["as_of"] = pd.to_datetime(snapshots["as_of"])
    labels["as_of"] = pd.to_datetime(labels["as_of"])
    labels["data_cutoff"] = pd.to_datetime(labels["data_cutoff"])
    roles = set(snapshots["role"].dropna().astype(str))
    if roles - set(SUPPORTED_ROLES):
        raise PopulationTrainingError(f"Unsupported population roles: {sorted(roles)}")
    return snapshots, labels, manifest


def build_person_period(
    snapshots: pd.DataFrame,
    labels: pd.DataFrame,
    evaluation_cutoff: pd.Timestamp,
) -> pd.DataFrame:
    merged = snapshots.merge(
        labels, on=["snapshot_id", "player_id", "as_of"], how="inner", validate="one_to_one"
    )
    feature_columns = list(
        dict.fromkeys(
            SHARED_NUMERIC_FEATURES
            + ROLE_NUMERIC_FEATURES["hitter"]
            + ROLE_NUMERIC_FEATURES["pitcher"]
            + CATEGORICAL_FEATURES
        )
    )
    periods: list[dict[str, Any]] = []
    for row in merged.to_dict("records"):
        as_of = pd.Timestamp(row["as_of"])
        row_cutoff = min(pd.Timestamp(row["data_cutoff"]), evaluation_cutoff)
        debut = pd.Timestamp(row["debut_date"]) if pd.notna(row["debut_date"]) else None
        for interval, months in enumerate(SURVIVAL_HORIZON_MONTHS, start=1):
            horizon_end = as_of + pd.DateOffset(months=months)
            event = debut is not None and debut <= min(horizon_end, row_cutoff)
            if horizon_end > row_cutoff and not event:
                break
            period = {column: row.get(column) for column in feature_columns}
            period.update(
                {
                    "snapshot_id": row["snapshot_id"],
                    "player_id": row["player_id"],
                    "edition": int(row["edition"]),
                    "role": row["role"],
                    "interval": interval,
                    "event": int(event),
                }
            )
            periods.append(period)
            if event:
                break
    return pd.DataFrame(periods)


def player_weights(periods: pd.DataFrame) -> np.ndarray:
    snapshot_count = periods.groupby("player_id")["snapshot_id"].transform("nunique")
    # Balance repeated player-season snapshots without changing the survival
    # likelihood's relative contribution from each at-risk interval.
    weights = 1.0 / snapshot_count.clip(lower=1)
    return (weights / weights.mean()).to_numpy()


def _available_features(
    periods: pd.DataFrame, role: str
) -> tuple[list[str], list[str]]:
    numeric_candidates = list(
        dict.fromkeys(SHARED_NUMERIC_FEATURES + ROLE_NUMERIC_FEATURES[role])
    )
    numeric = [
        column
        for column in numeric_candidates
        if column in periods
        and pd.to_numeric(periods[column], errors="coerce").notna().sum()
        >= MIN_FEATURE_VALUES
    ]
    categorical = [
        column
        for column in CATEGORICAL_FEATURES
        if column in periods
        and periods[column].notna().sum() >= MIN_FEATURE_VALUES
        and periods[column].nunique(dropna=True) > 1
    ]
    if not numeric and not categorical:
        raise PopulationTrainingError(f"No supported features are available for {role}s")
    return numeric, categorical


def _model_frame(
    frame: pd.DataFrame,
    numeric_features: list[str],
    categorical_features: list[str],
) -> pd.DataFrame:
    result = pd.DataFrame(index=frame.index)
    for column in numeric_features:
        result[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in categorical_features:
        result[column] = frame[column].astype("string").fillna("missing").astype(str)
    result["interval"] = pd.to_numeric(frame["interval"], errors="raise").astype(int)
    return result


def make_pipeline(
    numeric_features: list[str], categorical_features: list[str]
) -> Pipeline:
    transformers: list[tuple[str, Any, list[str]]] = []
    if numeric_features:
        transformers.append(
            (
                "numeric",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
                        ("scale", StandardScaler()),
                    ]
                ),
                numeric_features,
            )
        )
    if categorical_features:
        transformers.append(
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", min_frequency=10),
                categorical_features,
            )
        )
    transformers.append(
        (
            "time",
            OneHotEncoder(
                categories=[list(range(1, len(SURVIVAL_HORIZON_MONTHS) + 1))],
                handle_unknown="ignore",
            ),
            ["interval"],
        )
    )
    return Pipeline(
        [
            ("features", ColumnTransformer(transformers)),
            (
                "hazard",
                LogisticRegression(
                    C=0.5,
                    max_iter=2_000,
                    random_state=RANDOM_SEED,
                    solver="lbfgs",
                ),
            ),
        ]
    )


def fit_role_models(periods: pd.DataFrame) -> dict[str, dict[str, Any]]:
    models: dict[str, dict[str, Any]] = {}
    for role in SUPPORTED_ROLES:
        role_periods = periods[periods["role"] == role].copy()
        if len(role_periods) < 250 or role_periods["event"].nunique() < 2:
            raise PopulationTrainingError(f"Insufficient person-period outcomes for {role}s")
        numeric, categorical = _available_features(role_periods, role)
        pipeline = make_pipeline(numeric, categorical)
        training_frame = _model_frame(role_periods, numeric, categorical)
        pipeline.fit(
            training_frame,
            role_periods["event"],
            hazard__sample_weight=player_weights(role_periods),
        )
        models[role] = {
            "pipeline": pipeline,
            "numeric_features": numeric,
            "categorical_features": categorical,
            "training_periods": int(len(role_periods)),
            "training_players": int(role_periods["player_id"].nunique()),
            "events": int(role_periods["event"].sum()),
            "max_training_interval": int(role_periods["interval"].max()),
        }
    return models


def cumulative_predictions(
    models: dict[str, dict[str, Any]], snapshots: pd.DataFrame
) -> dict[int, np.ndarray]:
    predictions = {
        months: np.full(len(snapshots), np.nan, dtype=float)
        for months in SURVIVAL_HORIZON_MONTHS
    }
    for role, model_record in models.items():
        positions = np.flatnonzero(snapshots["role"].to_numpy() == role)
        if len(positions) == 0:
            continue
        role_snapshots = snapshots.iloc[positions]
        survival = np.ones(len(role_snapshots), dtype=float)
        for interval, months in enumerate(SURVIVAL_HORIZON_MONTHS, start=1):
            frame = role_snapshots.copy()
            frame["interval"] = interval
            model_frame = _model_frame(
                frame,
                model_record["numeric_features"],
                model_record["categorical_features"],
            )
            hazard = model_record["pipeline"].predict_proba(model_frame)[:, 1]
            hazard = np.clip(hazard, 1e-6, 1 - 1e-6)
            survival *= 1.0 - hazard
            predictions[months][positions] = 1.0 - survival
    if any(np.isnan(probability).any() for probability in predictions.values()):
        raise PopulationTrainingError("Population predictions are incomplete")
    return predictions


def horizon_has_training_support(
    models: dict[str, dict[str, Any]], test: pd.DataFrame, interval: int
) -> bool:
    test_roles = set(test["role"].dropna().astype(str))
    return all(
        role in models and int(models[role]["max_training_interval"]) >= interval
        for role in test_roles
    )


def _mature_outcomes_at(
    joined: pd.DataFrame, months: int, cutoff: pd.Timestamp
) -> tuple[pd.Series, pd.Series]:
    as_of = pd.to_datetime(joined["as_of"])
    debut = pd.to_datetime(joined["debut_date"])
    horizon_end = as_of + pd.DateOffset(months=months)
    mature = horizon_end.le(cutoff)
    event = debut.notna() & debut.le(horizon_end)
    return mature, event


def _age_bands(values: pd.Series) -> pd.Series:
    return pd.cut(
        pd.to_numeric(values, errors="coerce"),
        bins=[0, 19, 21, 23, 25, 40, np.inf],
        labels=["<=19", "20-21", "22-23", "24-25", "26-40", "41+"],
    ).astype("string").fillna("missing")


def empirical_bayes_baseline(
    training_joined: pd.DataFrame,
    test: pd.DataFrame,
    months: int,
    cutoff: pd.Timestamp,
    *,
    prior_strength: float = EMPIRICAL_BAYES_PRIOR_STRENGTH,
) -> tuple[np.ndarray | None, dict[str, Any]]:
    mature, event = _mature_outcomes_at(training_joined, months, cutoff)
    if mature.sum() < 100:
        return None, {"status": "insufficient_mature_training_rows"}
    training = training_joined.loc[mature, ["role", "prior_level", "age"]].copy()
    training["event"] = event.loc[mature].astype(int).to_numpy()
    training["role"] = training["role"].astype("string").fillna("missing")
    training["prior_level"] = (
        training["prior_level"].astype("string").fillna("missing")
    )
    training["age_band"] = _age_bands(training["age"])
    global_rate = float(training["event"].mean())

    role_rates: dict[str, float] = {}
    for role, group in training.groupby("role", observed=True):
        role_rates[str(role)] = float(
            (group["event"].sum() + prior_strength * global_rate)
            / (len(group) + prior_strength)
        )

    role_level_rates: dict[tuple[str, str], float] = {}
    for keys, group in training.groupby(["role", "prior_level"], observed=True):
        role, level = (str(keys[0]), str(keys[1]))
        parent = role_rates.get(role, global_rate)
        role_level_rates[(role, level)] = float(
            (group["event"].sum() + prior_strength * parent)
            / (len(group) + prior_strength)
        )

    detailed_rates: dict[tuple[str, str, str], float] = {}
    for keys, group in training.groupby(
        ["role", "prior_level", "age_band"], observed=True
    ):
        role, level, age_band = (str(keys[0]), str(keys[1]), str(keys[2]))
        parent = role_level_rates.get((role, level), role_rates.get(role, global_rate))
        detailed_rates[(role, level, age_band)] = float(
            (group["event"].sum() + prior_strength * parent)
            / (len(group) + prior_strength)
        )

    scoring = test[["role", "prior_level", "age"]].copy()
    scoring["role"] = scoring["role"].astype("string").fillna("missing")
    scoring["prior_level"] = scoring["prior_level"].astype("string").fillna("missing")
    scoring["age_band"] = _age_bands(scoring["age"])
    predictions = np.array(
        [
            detailed_rates.get(
                (str(row.role), str(row.prior_level), str(row.age_band)),
                role_level_rates.get(
                    (str(row.role), str(row.prior_level)),
                    role_rates.get(str(row.role), global_rate),
                ),
            )
            for row in scoring.itertuples(index=False)
        ],
        dtype=float,
    )
    return predictions, {
        "status": "fit",
        "training_rows": int(len(training)),
        "training_events": int(training["event"].sum()),
        "global_rate": global_rate,
        "prior_strength": prior_strength,
        "role_groups": len(role_rates),
        "role_level_groups": len(role_level_rates),
        "role_level_age_groups": len(detailed_rates),
    }


def _cluster_bootstrap(
    truth: np.ndarray,
    probability: np.ndarray,
    players: np.ndarray,
    *,
    repetitions: int,
    seed: int,
) -> dict[str, list[float] | int]:
    if repetitions <= 0:
        return {"repetitions": 0}
    unique_players = np.unique(players)
    indexes = {player: np.flatnonzero(players == player) for player in unique_players}
    rng = np.random.default_rng(seed)
    briers: list[float] = []
    aucs: list[float] = []
    average_precisions: list[float] = []
    for _ in range(repetitions):
        sampled = rng.choice(unique_players, size=len(unique_players), replace=True)
        selected = np.concatenate([indexes[player] for player in sampled])
        sample_truth = truth[selected]
        sample_probability = probability[selected]
        briers.append(float(brier_score_loss(sample_truth, sample_probability)))
        if len(np.unique(sample_truth)) == 2:
            aucs.append(float(roc_auc_score(sample_truth, sample_probability)))
            average_precisions.append(
                float(average_precision_score(sample_truth, sample_probability))
            )

    def interval(values: list[float]) -> list[float] | None:
        if not values:
            return None
        return [float(value) for value in np.quantile(values, [0.025, 0.975])]

    return {
        "repetitions": repetitions,
        "player_clusters": int(len(unique_players)),
        "brier_95ci": interval(briers),
        "roc_auc_95ci": interval(aucs),
        "average_precision_95ci": interval(average_precisions),
    }


def score_horizon(
    truth: pd.Series,
    probability: np.ndarray,
    players: pd.Series,
    *,
    training_base_rate: float | None = None,
    bootstrap_repetitions: int = 0,
    bootstrap_seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    y = truth.astype(int).to_numpy()
    p = np.clip(np.asarray(probability, dtype=float), 1e-6, 1 - 1e-6)
    result: dict[str, Any] = {
        "n": int(len(y)),
        "events": int(y.sum()),
        "observed_rate": float(y.mean()),
        "mean_prediction": float(p.mean()),
        "calibration_in_the_large": float(p.mean() - y.mean()),
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "roc_auc": None,
        "average_precision": None,
        "calibration_intercept": None,
        "calibration_slope": None,
    }
    if len(np.unique(y)) == 2:
        result["roc_auc"] = float(roc_auc_score(y, p))
        result["average_precision"] = float(average_precision_score(y, p))
        logits = np.log(p / (1.0 - p)).reshape(-1, 1)
        calibration = LogisticRegression(C=1e6, solver="lbfgs").fit(logits, y)
        result["calibration_intercept"] = float(calibration.intercept_[0])
        result["calibration_slope"] = float(calibration.coef_[0, 0])

    unique_probability_count = len(np.unique(p))
    if unique_probability_count <= 10:
        bins = pd.Series(p).map(
            {value: index for index, value in enumerate(np.unique(p))}
        )
    else:
        edges = np.unique(np.quantile(p, np.linspace(0.0, 1.0, 11)))
        bins = pd.Series(np.digitize(p, edges[1:-1], right=True))
    reliability = pd.DataFrame({"truth": y, "probability": p, "bin": bins}).groupby(
        "bin", observed=True
    ).agg(n=("truth", "size"), observed=("truth", "mean"), predicted=("probability", "mean"))
    reliability["absolute_gap"] = (reliability["predicted"] - reliability["observed"]).abs()
    result["expected_calibration_error"] = float(
        (reliability["absolute_gap"] * reliability["n"]).sum() / len(y)
    )
    result["max_calibration_gap"] = float(reliability["absolute_gap"].max())
    result["reliability_bins"] = [
        {
            "n": int(row["n"]),
            "observed": float(row["observed"]),
            "predicted": float(row["predicted"]),
        }
        for row in reliability.to_dict("records")
    ]

    top_n = max(1, math.ceil(len(y) * 0.10))
    top_indexes = np.argsort(-p)[:top_n]
    top_rate = float(y[top_indexes].mean())
    result["top_decile"] = {
        "n": top_n,
        "observed_rate": top_rate,
        "lift": float(top_rate / y.mean()) if y.mean() > 0 else None,
    }
    if training_base_rate is not None:
        baseline_brier = float(
            brier_score_loss(y, np.full(len(y), training_base_rate, dtype=float))
        )
        result["training_base_rate"] = training_base_rate
        result["base_rate_brier"] = baseline_brier
        result["brier_skill_score"] = (
            float(1.0 - result["brier"] / baseline_brier)
            if baseline_brier > 0
            else None
        )
        if baseline_brier == 0:
            result["baseline_status"] = "perfect_constant_baseline_has_zero_brier"
    else:
        result["training_base_rate"] = None
        result["base_rate_brier"] = None
        result["brier_skill_score"] = None
    result["cluster_bootstrap"] = _cluster_bootstrap(
        y,
        p,
        players.astype(str).to_numpy(),
        repetitions=bootstrap_repetitions,
        seed=bootstrap_seed,
    )
    return result


def _subgroup_diagnostics(
    test: pd.DataFrame,
    truth: pd.Series,
    probability: np.ndarray,
) -> dict[str, list[dict[str, Any]]]:
    diagnostics = test[["role", "prior_level", "age"]].copy()
    diagnostics["truth"] = truth.astype(int).to_numpy()
    diagnostics["probability"] = probability
    diagnostics["age_band"] = _age_bands(diagnostics["age"])
    result: dict[str, list[dict[str, Any]]] = {}
    for dimension in ("role", "prior_level", "age_band"):
        groups: list[dict[str, Any]] = []
        for value, group in diagnostics.dropna(subset=[dimension]).groupby(
            dimension, observed=True
        ):
            y = group["truth"].to_numpy()
            if len(group) < 100 or y.sum() < 10 or (len(y) - y.sum()) < 10:
                continue
            p = group["probability"].to_numpy()
            groups.append(
                {
                    "value": str(value),
                    "n": int(len(group)),
                    "events": int(y.sum()),
                    "observed_rate": float(y.mean()),
                    "mean_prediction": float(p.mean()),
                    "calibration_in_the_large": float(p.mean() - y.mean()),
                    "brier": float(brier_score_loss(y, p)),
                    "roc_auc": float(roc_auc_score(y, p)),
                }
            )
        result[dimension] = groups
    return result


def rolling_origin_backtest(
    snapshots: pd.DataFrame,
    labels: pd.DataFrame,
    *,
    bootstrap_repetitions: int = 100,
) -> list[dict[str, Any]]:
    merged = snapshots.merge(
        labels, on=["snapshot_id", "player_id", "as_of"], how="inner", validate="one_to_one"
    )
    seasons = sorted(int(season) for season in snapshots["edition"].unique())
    folds: list[dict[str, Any]] = []
    for test_season in seasons[1:]:
        train_snapshots = snapshots[snapshots["edition"] < test_season].copy()
        train_labels = labels[labels["snapshot_id"].isin(train_snapshots["snapshot_id"])]
        test = merged[merged["edition"] == test_season].copy()
        if train_snapshots.empty or test.empty:
            continue
        fold_origin = pd.Timestamp(test["as_of"].max())
        train_periods = build_person_period(train_snapshots, train_labels, fold_origin)
        models = fit_role_models(train_periods)
        predictions = cumulative_predictions(models, test)
        train_players = set(train_snapshots["player_id"])
        cold_start = ~test["player_id"].isin(train_players)
        training_joined = train_snapshots.merge(
            train_labels,
            on=["snapshot_id", "player_id", "as_of"],
            how="inner",
            validate="one_to_one",
        )
        fold: dict[str, Any] = {
            "test_season": test_season,
            "training_label_cutoff": fold_origin.date().isoformat(),
            "train_seasons": sorted(int(value) for value in train_snapshots["edition"].unique()),
            "train_snapshots": int(len(train_snapshots)),
            "train_players": int(train_snapshots["player_id"].nunique()),
            "train_periods": int(len(train_periods)),
            "test_snapshots": int(len(test)),
            "cold_start_snapshots": int(cold_start.sum()),
            "returning_player_snapshots": int((~cold_start).sum()),
            "models": {
                role: {key: value for key, value in record.items() if key != "pipeline"}
                for role, record in models.items()
            },
            "horizons": {},
            "unsupported_horizons": {},
        }
        for interval, months in enumerate(SURVIVAL_HORIZON_MONTHS, start=1):
            if not horizon_has_training_support(models, test, interval):
                fold["unsupported_horizons"][str(months)] = {
                    "reason": "hazard_interval_absent_from_one_or_more_role_training_sets",
                    "required_interval": interval,
                    "role_max_training_intervals": {
                        role: record["max_training_interval"]
                        for role, record in models.items()
                    },
                }
                continue
            horizon_end = pd.to_datetime(test["as_of"]) + pd.DateOffset(months=months)
            mature = horizon_end.le(pd.to_datetime(test["data_cutoff"]))
            if mature.sum() < 100:
                continue
            if not test.loc[mature, f"observed_{months}m"].astype(bool).all():
                raise PopulationTrainingError(
                    f"Mature {months}-month test outcomes are not marked observed"
                )
            truth = test.loc[mature, f"debut_within_{months}m"].astype(bool)
            probability = predictions[months][mature.to_numpy()]
            players = test.loc[mature, "player_id"]
            train_mature, train_event = _mature_outcomes_at(
                training_joined, months, fold_origin
            )
            training_base_rate = (
                float(train_event.loc[train_mature].mean())
                if train_mature.sum() >= 100
                else None
            )
            scored = score_horizon(
                truth,
                probability,
                players,
                training_base_rate=training_base_rate,
                bootstrap_repetitions=bootstrap_repetitions,
                bootstrap_seed=RANDOM_SEED + test_season * 100 + months,
            )
            stratified_predictions, stratified_fit = empirical_bayes_baseline(
                training_joined,
                test,
                months,
                fold_origin,
            )
            if stratified_predictions is not None:
                baseline_scored = score_horizon(
                    truth,
                    stratified_predictions[mature.to_numpy()],
                    players,
                )
                scored["empirical_bayes_baseline"] = {
                    "fit": stratified_fit,
                    "metrics": baseline_scored,
                }
                scored["brier_skill_vs_empirical_bayes"] = (
                    float(1.0 - scored["brier"] / baseline_scored["brier"])
                    if baseline_scored["brier"] > 0
                    else None
                )
            else:
                scored["empirical_bayes_baseline"] = {"fit": stratified_fit}
                scored["brier_skill_vs_empirical_bayes"] = None
            for name, membership in (
                ("cold_start", cold_start),
                ("returning_player", ~cold_start),
            ):
                subset = mature & membership
                if (
                    subset.sum() >= 100
                    and test.loc[subset, f"debut_within_{months}m"].nunique() == 2
                ):
                    scored[name] = score_horizon(
                        test.loc[subset, f"debut_within_{months}m"],
                        predictions[months][subset.to_numpy()],
                        test.loc[subset, "player_id"],
                    )
            scored["subgroups"] = _subgroup_diagnostics(
                test.loc[mature], truth, probability
            )
            fold["horizons"][str(months)] = scored
        if fold["horizons"]:
            folds.append(fold)
    return folds


def release_gate_diagnostics(folds: list[dict[str, Any]]) -> dict[str, Any]:
    all_scored = [
        horizon
        for fold in folds
        for horizon in fold["horizons"].values()
    ]
    baseline_scored = [
        horizon
        for horizon in all_scored
        if horizon.get("brier_skill_vs_empirical_bayes") is not None
    ]
    positive_skill = [
        horizon["brier_skill_vs_empirical_bayes"] > 0 for horizon in baseline_scored
    ]
    calibration = [
        abs(horizon["calibration_in_the_large"]) <= 0.02 for horizon in all_scored
    ]
    slopes = [
        horizon["calibration_slope"] is not None
        and 0.8 <= horizon["calibration_slope"] <= 1.2
        for horizon in all_scored
    ]
    return {
        "status": "diagnostic_only_holdout_not_locked",
        "release_eligible": False,
        "scored_fold_horizons": len(all_scored),
        "empirical_bayes_comparable_fold_horizons": len(baseline_scored),
        "positive_brier_skill_vs_empirical_bayes": {
            "required_fraction": 0.75,
            "passed": int(sum(positive_skill)),
            "fraction": float(np.mean(positive_skill)) if positive_skill else None,
        },
        "absolute_calibration_in_the_large_at_most_0_02": {
            "passed": int(sum(calibration)),
            "fraction": float(np.mean(calibration)) if calibration else None,
        },
        "calibration_slope_0_8_through_1_2": {
            "passed": int(sum(slopes)),
            "fraction": float(np.mean(slopes)) if slopes else None,
        },
        "blocking_gates": [
            "No chronological calibration block has been frozen.",
            "No prospective holdout manifest has been locked.",
            "Monthly hazards and censoring-aware partial-follow-up metrics are pending.",
            "Context normalization and missing-feature stress tests are pending.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train the role-aware affiliated-population arrival benchmark"
    )
    parser.add_argument(
        "--corpus-manifest",
        type=Path,
        default=ROOT / "data/processed/arrival-population-v1/corpus_manifest.json",
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        default=ROOT / "artifacts/arrival-population-v1",
    )
    parser.add_argument("--bootstrap-repetitions", type=int, default=100)
    args = parser.parse_args()
    if args.bootstrap_repetitions < 0 or args.bootstrap_repetitions > 2_000:
        raise PopulationTrainingError("Bootstrap repetitions must be from 0 through 2000")

    snapshots, labels, corpus_manifest = load_arrival_corpus(args.corpus_manifest)
    folds = rolling_origin_backtest(
        snapshots,
        labels,
        bootstrap_repetitions=args.bootstrap_repetitions,
    )
    final_cutoff = pd.to_datetime(labels["data_cutoff"]).max()
    periods = build_person_period(snapshots, labels, final_cutoff)
    models = fit_role_models(periods)

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = args.artifact_dir / "model.joblib"
    joblib.dump(models, artifact_path)
    artifact_sha256 = file_sha256(artifact_path)
    model_archive_path = args.artifact_dir / "models" / f"{artifact_sha256}.joblib"
    model_archive_path.parent.mkdir(parents=True, exist_ok=True)
    if model_archive_path.exists() and file_sha256(model_archive_path) != artifact_sha256:
        raise PopulationTrainingError("Content-addressed model artifact differs")
    if not model_archive_path.exists():
        shutil.copyfile(artifact_path, model_archive_path)

    model_configuration = {
        "model": "role_specific_regularized_logistic_discrete_time_hazard",
        "time_basis": "annual_12_month_intervals",
        "roles": list(SUPPORTED_ROLES),
        "survival_horizons_months": list(SURVIVAL_HORIZON_MONTHS),
        "hazard": {
            "regularization_c": 0.5,
            "solver": "lbfgs",
            "max_iterations": 2_000,
            "hazard_clip": [1e-6, 1 - 1e-6],
        },
        "preprocessing": {
            "numeric_imputation": "fold_median_with_missing_indicators",
            "numeric_scaling": "fold_standard_scaler",
            "categorical_missing_value": "missing",
            "categorical_encoding": "one_hot_handle_unknown_ignore",
            "categorical_min_frequency": 10,
            "interval_encoding": "one_hot",
            "minimum_non_null_feature_values": MIN_FEATURE_VALUES,
        },
        "weighting": "inverse_player_snapshot_count_per_at_risk_interval",
        "frozen_baseline": {
            "type": "hierarchical_empirical_bayes_rate",
            "groups": ["role", "prior_level", "age_band"],
            "prior_strength": EMPIRICAL_BAYES_PRIOR_STRENGTH,
        },
        "random_seed": RANDOM_SEED,
        "feature_candidates": {
            "shared_numeric": SHARED_NUMERIC_FEATURES,
            "role_numeric": ROLE_NUMERIC_FEATURES,
            "categorical": CATEGORICAL_FEATURES,
        },
        "selected_features": {
            role: {
                "numeric": record["numeric_features"],
                "categorical": record["categorical_features"],
            }
            for role, record in models.items()
        },
    }
    validation_configuration = {
        "protocol": "expanding_origin_by_affiliated_season",
        "binary_metrics": "fully_mature_horizons_only",
        "partial_follow_up": "used_in_person_period_likelihood_not_binary_metrics",
        "bootstrap_unit": "player_cluster",
        "bootstrap_repetitions": args.bootstrap_repetitions,
        "bootstrap_seed": RANDOM_SEED,
    }
    metrics: dict[str, Any] = {
        "schema_version": 1,
        "status": "research_population_benchmark_not_release_eligible",
        "trained_at": datetime.now().astimezone().isoformat(),
        "model_configuration": model_configuration,
        "model_configuration_sha256": json_sha256(model_configuration),
        "validation_configuration": validation_configuration,
        "validation_configuration_sha256": json_sha256(validation_configuration),
        "training": {
            "snapshots": int(len(snapshots)),
            "players": int(snapshots["player_id"].nunique()),
            "person_periods": int(len(periods)),
            "events": int(periods["event"].sum()),
            "models": {
                role: {key: value for key, value in record.items() if key != "pipeline"}
                for role, record in models.items()
            },
        },
        "validation": {
            "protocol": "expanding_origin_by_affiliated_season_with_label_availability_cutoff",
            "cold_start_definition": "test player has no earlier training-season snapshot",
            "folds": folds,
        },
        "release_gates": release_gate_diagnostics(folds),
        "inputs": {
            "corpus_manifest": _portable_path(args.corpus_manifest),
            "corpus_manifest_sha256": file_sha256(args.corpus_manifest),
            "corpus_manifest_content_address": corpus_manifest["manifest_sha256"],
            "corpus_content_sha256": corpus_manifest["corpus_content_sha256"],
        },
        "artifact": {
            "path": _portable_path(artifact_path),
            "sha256": artifact_sha256,
            "content_addressed_path": _portable_path(model_archive_path),
        },
        "producer": producer_metadata(
            ROOT,
            [
                Path(__file__),
                ROOT / "modeling/arrival_corpus.py",
                ROOT / "modeling/contracts.py",
                ROOT / "modeling/provenance.py",
                ROOT / "modeling/requirements.lock",
            ],
            {
                "corpus_manifest": _portable_path(args.corpus_manifest),
                "artifact_dir": _portable_path(args.artifact_dir),
                "bootstrap_repetitions": args.bootstrap_repetitions,
            },
        ),
        "release_blockers": [
            "This is an affiliated season-appearance estimand, not a contract-roster estimand.",
            "Historical feature knowledge times are not independently evidenced.",
            "Annual hazards are a benchmark; monthly competing-risk hazards are not implemented.",
            "Chronological calibration and locked prospective holdout gates are pending.",
            "League, park, level, organization, and era normalization remain incomplete.",
        ],
    }
    report_address = json_sha256(metrics)
    metrics["validation_report_sha256"] = report_address
    body = json.dumps(metrics, indent=2, default=str) + "\n"
    metrics_path = args.artifact_dir / "metrics.json"
    report_archive = args.artifact_dir / "runs" / f"{report_address}.json"
    report_archive.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text(body)
    report_archive.write_text(body)
    print(
        json.dumps(
            {
                "artifact": str(artifact_path),
                "metrics": str(metrics_path),
                "validation_report_sha256": report_address,
                "folds": len(folds),
                "training_snapshots": len(snapshots),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
