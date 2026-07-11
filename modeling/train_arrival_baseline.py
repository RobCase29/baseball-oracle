from __future__ import annotations

import argparse
import json
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
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

try:
    from modeling.contracts import (
        CATEGORICAL_FEATURES,
        EVALUATION_HORIZON_MONTHS,
        NUMERIC_FEATURES,
        SURVIVAL_HORIZON_MONTHS,
        assert_feature_contract,
    )
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
except ModuleNotFoundError:
    from contracts import (
        CATEGORICAL_FEATURES,
        EVALUATION_HORIZON_MONTHS,
        NUMERIC_FEATURES,
        SURVIVAL_HORIZON_MONTHS,
        assert_feature_contract,
    )
    from provenance import file_sha256, json_sha256, producer_metadata

ROOT = Path(__file__).resolve().parents[1]
RANDOM_SEED = 29


def file_hash(path: Path) -> str:
    return file_sha256(path)


def portable_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return str(resolved)


def build_person_period(
    snapshots: pd.DataFrame, labels: pd.DataFrame, evaluation_cutoff: pd.Timestamp | None = None
) -> pd.DataFrame:
    merged = snapshots.merge(labels, on=["snapshot_id", "player_id", "as_of"], how="inner")
    cutoff = evaluation_cutoff or pd.to_datetime(merged["data_cutoff"]).max()
    periods: list[dict[str, Any]] = []
    for row in merged.to_dict("records"):
        event_seen = False
        for interval, months in enumerate(SURVIVAL_HORIZON_MONTHS, start=1):
            horizon_end = pd.Timestamp(row["as_of"]) + pd.DateOffset(months=months)
            debut = pd.Timestamp(row["debut_date"]) if pd.notna(row["debut_date"]) else None
            event_available = debut is not None and debut <= min(horizon_end, cutoff)
            if horizon_end > cutoff and not event_available:
                break
            event = event_available and not event_seen
            event_seen = event_seen or event
            period = {key: row.get(key) for key in NUMERIC_FEATURES + CATEGORICAL_FEATURES}
            period.update(
                {
                    "snapshot_id": row["snapshot_id"],
                    "player_id": row["player_id"],
                    "edition": int(row["edition"]),
                    "interval": interval,
                    "event": int(event),
                }
            )
            periods.append(period)
            if event:
                break
    return pd.DataFrame(periods)


def make_pipeline() -> Pipeline:
    numeric = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
        ]
    )
    categorical = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="constant", fill_value="missing")),
            ("one_hot", OneHotEncoder(handle_unknown="ignore", min_frequency=5)),
        ]
    )
    transform = ColumnTransformer(
        [("numeric", numeric, NUMERIC_FEATURES + ["interval"]), ("categorical", categorical, CATEGORICAL_FEATURES)]
    )
    return Pipeline(
        [
            ("features", transform),
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


def player_weights(periods: pd.DataFrame) -> np.ndarray:
    snapshot_count = periods.groupby("player_id")["snapshot_id"].transform("nunique")
    period_count = periods.groupby("snapshot_id")["interval"].transform("count")
    weights = 1.0 / snapshot_count.clip(lower=1) / period_count.clip(lower=1)
    return (weights / weights.mean()).to_numpy()


def cumulative_predictions(model: Pipeline, snapshots: pd.DataFrame) -> dict[int, np.ndarray]:
    survival = np.ones(len(snapshots), dtype=float)
    predictions: dict[int, np.ndarray] = {}
    for interval, months in enumerate(SURVIVAL_HORIZON_MONTHS, start=1):
        frame = snapshots[NUMERIC_FEATURES + CATEGORICAL_FEATURES].copy()
        frame["interval"] = interval
        hazard = model.predict_proba(frame)[:, 1]
        survival *= 1.0 - hazard
        predictions[months] = 1.0 - survival.copy()
    return predictions


def score_horizon(y_true: pd.Series, probability: np.ndarray) -> dict[str, float | None]:
    truth = y_true.astype(int).to_numpy()
    result: dict[str, float | None] = {
        "n": int(len(truth)),
        "events": int(truth.sum()),
        "brier": float(brier_score_loss(truth, probability)),
        "log_loss": float(log_loss(truth, probability, labels=[0, 1])),
        "roc_auc": None,
    }
    if len(np.unique(truth)) == 2:
        result["roc_auc"] = float(roc_auc_score(truth, probability))
    return result


def rolling_origin_backtest(snapshots: pd.DataFrame, labels: pd.DataFrame) -> list[dict[str, Any]]:
    folds: list[dict[str, Any]] = []
    merged = snapshots.merge(labels, on=["snapshot_id", "player_id", "as_of"], how="inner")
    for test_edition in range(2020, 2026):
        train_snapshots = snapshots[snapshots["edition"] < test_edition]
        train_labels = labels[labels["snapshot_id"].isin(train_snapshots["snapshot_id"])]
        fold_origin = pd.Timestamp(year=test_edition, month=12, day=31)
        train_periods = build_person_period(train_snapshots, train_labels, fold_origin)
        test = merged[merged["edition"] == test_edition].copy()
        if len(train_periods) < 250 or test.empty or train_periods["event"].nunique() < 2:
            continue
        model = make_pipeline()
        model.fit(
            train_periods[NUMERIC_FEATURES + CATEGORICAL_FEATURES + ["interval"]],
            train_periods["event"],
            hazard__sample_weight=player_weights(train_periods),
        )
        predictions = cumulative_predictions(model, test)
        train_players = set(train_snapshots["player_id"])
        cold_start = ~test["player_id"].isin(train_players)
        fold: dict[str, Any] = {
            "test_edition": test_edition,
            "training_label_cutoff": fold_origin.date().isoformat(),
            "train_editions": [int(train_snapshots["edition"].min()), test_edition - 1],
            "train_players": int(train_snapshots["player_id"].nunique()),
            "train_periods": int(len(train_periods)),
            "training_max_observed_interval": int(train_periods["interval"].max()),
            "test_snapshots": int(len(test)),
            "cold_start_snapshots": int(cold_start.sum()),
            "horizons": {},
        }
        for months in EVALUATION_HORIZON_MONTHS:
            horizon_end = pd.to_datetime(test["as_of"]) + pd.DateOffset(months=months)
            data_cutoff = pd.to_datetime(test["data_cutoff"])
            mature = horizon_end <= data_cutoff
            if mature.sum() < 25:
                continue
            scored = score_horizon(
                test.loc[mature, f"debut_within_{months}m"], predictions[months][mature.to_numpy()]
            )
            scored["interval_extrapolation"] = bool(
                months // 12 > int(train_periods["interval"].max())
            )
            train_joined = train_snapshots.merge(
                train_labels, on=["snapshot_id", "player_id", "as_of"], how="inner"
            )
            train_mature = (
                pd.to_datetime(train_joined["as_of"]) + pd.DateOffset(months=months)
            ) <= fold_origin
            if train_mature.sum() >= 100:
                baseline = float(
                    train_joined.loc[train_mature, f"debut_within_{months}m"].astype(bool).mean()
                )
                truth = test.loc[mature, f"debut_within_{months}m"].astype(int)
                baseline_brier = float(brier_score_loss(truth, np.full(len(truth), baseline)))
                scored["training_base_rate"] = baseline
                scored["base_rate_brier"] = baseline_brier
                scored["brier_skill_score"] = float(1 - float(scored["brier"]) / baseline_brier)
            else:
                scored["training_base_rate"] = None
                scored["base_rate_brier"] = None
                scored["brier_skill_score"] = None
                scored["baseline_status"] = "unavailable_at_fold_origin"
            cold_mature = mature & cold_start
            if cold_mature.sum() >= 25:
                scored["cold_start"] = score_horizon(
                    test.loc[cold_mature, f"debut_within_{months}m"],
                    predictions[months][cold_mature.to_numpy()],
                )
            fold["horizons"][str(months)] = scored
        if fold["horizons"]:
            folds.append(fold)
    return folds


def load_dataset_manifest(path: Path) -> tuple[dict[str, Any], str, str]:
    manifest = json.loads(path.read_text())
    content_address = manifest.get("manifest_sha256")
    if not isinstance(content_address, str):
        raise ValueError("Dataset manifest is missing its content address")
    canonical = dict(manifest)
    canonical.pop("manifest_sha256", None)
    if json_sha256(canonical) != content_address:
        raise ValueError("Dataset manifest content address does not match its contents")
    archive_path = path.parent / "manifests" / f"{content_address}.json"
    if not archive_path.exists() or file_hash(archive_path) != file_hash(path):
        raise ValueError("Dataset manifest archive is missing or differs from the live manifest")
    dataset_content_address = manifest.get("dataset_content_sha256")
    if not isinstance(dataset_content_address, str):
        raise ValueError("Dataset manifest is missing its stable dataset content address")
    dataset_content = {
        "schema_version": manifest["schema_version"],
        "data_cutoff": manifest["data_cutoff"],
        "snapshot_policy": manifest["snapshot_policy"],
        "source_lock_sha256": manifest["source_lock"]["sha256"],
        "outputs": {
            name: {"rows": output["rows"], "sha256": output["sha256"]}
            for name, output in manifest["outputs"].items()
        },
    }
    if json_sha256(dataset_content) != dataset_content_address:
        raise ValueError("Stable dataset content address does not match the output manifest")
    for name, output in manifest["outputs"].items():
        archived_value = output.get("content_addressed_path")
        if not isinstance(archived_value, str):
            raise ValueError(f"Dataset output {name} has no content-addressed path")
        archived_path = Path(archived_value)
        if not archived_path.is_absolute():
            archived_path = ROOT / archived_path
        if not archived_path.exists() or file_hash(archived_path) != output["sha256"]:
            raise ValueError(f"Dataset output archive is missing or invalid: {name}")
    return manifest, content_address, dataset_content_address


def resolve_dataset_output(manifest: dict[str, Any], name: str) -> tuple[Path, int, str]:
    output = manifest["outputs"].get(name)
    if not isinstance(output, dict):
        raise ValueError(f"Dataset manifest has no output named {name}")
    archived_path = Path(output["content_addressed_path"])
    if not archived_path.is_absolute():
        archived_path = ROOT / archived_path
    expected_rows = int(output["rows"])
    expected_sha256 = str(output["sha256"])
    if file_hash(archived_path) != expected_sha256:
        raise ValueError(f"Dataset output hash mismatch: {name}")
    return archived_path, expected_rows, expected_sha256


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the discrete-time arrival baseline")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/processed/model-v1")
    parser.add_argument("--artifact-dir", type=Path, default=ROOT / "artifacts/arrival-baseline-v1")
    args = parser.parse_args()

    manifest_path = args.data_dir / "dataset_manifest.json"
    manifest, dataset_manifest_address, dataset_content_address = load_dataset_manifest(manifest_path)
    snapshots_path, expected_snapshot_rows, expected_snapshots_sha256 = resolve_dataset_output(
        manifest, "prospect_snapshots"
    )
    labels_path, expected_label_rows, expected_labels_sha256 = resolve_dataset_output(
        manifest, "arrival_labels"
    )
    snapshots = pd.read_parquet(snapshots_path)
    labels = pd.read_parquet(labels_path)
    if len(snapshots) != expected_snapshot_rows or len(labels) != expected_label_rows:
        raise ValueError("Dataset output row count differs from its manifest")
    snapshots["as_of"] = pd.to_datetime(snapshots["as_of"])
    labels["as_of"] = pd.to_datetime(labels["as_of"])
    assert_feature_contract(snapshots.columns.tolist())

    folds = rolling_origin_backtest(snapshots, labels)
    periods = build_person_period(snapshots, labels)
    model = make_pipeline()
    model.fit(
        periods[NUMERIC_FEATURES + CATEGORICAL_FEATURES + ["interval"]],
        periods["event"],
        hazard__sample_weight=player_weights(periods),
    )

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = args.artifact_dir / "model.joblib"
    joblib.dump(model, artifact_path)
    artifact_sha256 = file_hash(artifact_path)
    model_archive_path = args.artifact_dir / "models" / f"{artifact_sha256}.joblib"
    model_archive_path.parent.mkdir(parents=True, exist_ok=True)
    if model_archive_path.exists() and file_hash(model_archive_path) != artifact_sha256:
        raise ValueError("Content-addressed model archive does not match its filename")
    if not model_archive_path.exists():
        shutil.copyfile(artifact_path, model_archive_path)
    configuration = {
        "model": "regularized_logistic_discrete_time_hazard",
        "regularization_c": 0.5,
        "solver": "lbfgs",
        "max_iterations": 2_000,
        "random_seed": RANDOM_SEED,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "survival_horizons_months": list(SURVIVAL_HORIZON_MONTHS),
    }
    producer = producer_metadata(
        ROOT,
        [
            Path(__file__),
            ROOT / "modeling/contracts.py",
            ROOT / "modeling/provenance.py",
            ROOT / "modeling/requirements.lock",
        ],
        {
            "data_dir": portable_path(args.data_dir),
            "artifact_dir": portable_path(args.artifact_dir),
        },
    )
    metrics = {
        "schema_version": 1,
        "status": "research_baseline_not_release_eligible",
        "trained_at": datetime.now().astimezone().isoformat(),
        "random_seed": RANDOM_SEED,
        "model": "regularized_logistic_discrete_time_hazard",
        "configuration": configuration,
        "configuration_sha256": json_sha256(configuration),
        "producer": producer,
        "environment_sha256": json_sha256(producer["environment"]),
        "evaluated_horizons_months": sorted(
            {
                int(months)
                for fold in folds
                for months in fold["horizons"]
            }
        ),
        "training_snapshots": int(periods["snapshot_id"].nunique()),
        "training_players": int(periods["player_id"].nunique()),
        "training_periods": int(len(periods)),
        "events": int(periods["event"].sum()),
        "feature_contract": {
            "numeric": NUMERIC_FEATURES,
            "categorical": CATEGORICAL_FEATURES,
            "time_basis": "annual hazard interval",
        },
        "validation": {
            "protocol": "rolling_origin_by_board_edition_no_random_split",
            "folds": folds,
        },
        "inputs": {
            "dataset_content_sha256": dataset_content_address,
            "dataset_manifest_content_address": dataset_manifest_address,
            "dataset_manifest_content_addressed_path": portable_path(
                args.data_dir / "manifests" / f"{dataset_manifest_address}.json"
            ),
            "dataset_manifest_file_sha256": file_hash(manifest_path),
            "snapshots_sha256": expected_snapshots_sha256,
            "labels_sha256": expected_labels_sha256,
        },
        "artifact": {
            "path": portable_path(artifact_path),
            "sha256": artifact_sha256,
            "content_addressed_path": portable_path(model_archive_path),
        },
        "release_blockers": [
            "Board membership is not a complete affiliated-player risk set.",
            "Exact FanGraphs publication timestamps are not yet evidenced.",
            "This baseline is not calibrated for production publication.",
        ],
    }
    report_sha256 = json_sha256(metrics)
    metrics["validation_report_sha256"] = report_sha256
    metrics_body = json.dumps(metrics, indent=2) + "\n"
    metrics_path = args.artifact_dir / "metrics.json"
    archive_path = args.artifact_dir / "runs" / f"{report_sha256}.json"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text(metrics_body)
    archive_path.write_text(metrics_body)
    print(
        json.dumps(
            {
                "artifact": str(artifact_path),
                "artifact_archive": str(model_archive_path),
                "metrics": str(metrics_path),
                "validation_report_sha256": report_sha256,
                "folds": len(folds),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
