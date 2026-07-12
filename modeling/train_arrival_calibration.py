from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

try:
    from modeling.arrival_calibration import (
        CALIBRATION_CONFIG,
        apply_calibration,
        fit_oof_calibrators,
        serialize_calibration_model,
    )
    from modeling.arrival_hazard_baseline import (
        DEFAULT_WEIGHT_COLUMN,
        FIT_SOURCE as HAZARD_BASELINE_FIT_SOURCE,
        HAZARD_BASELINE_SCHEMA_VERSION,
        PRIOR_STRENGTH as HAZARD_BASELINE_PRIOR_STRENGTH,
        RATE_ENCODING as HAZARD_BASELINE_RATE_ENCODING,
        fit_hazard_baseline,
    )
    from modeling.contracts import SURVIVAL_HORIZON_MONTHS
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
    from modeling.train_arrival_population import (
        SUPPORTED_ROLES,
        build_person_period,
        cumulative_predictions,
        fit_role_models,
        load_arrival_corpus,
        player_weights,
    )
except ModuleNotFoundError:
    from arrival_calibration import (
        CALIBRATION_CONFIG,
        apply_calibration,
        fit_oof_calibrators,
        serialize_calibration_model,
    )
    from arrival_hazard_baseline import (
        DEFAULT_WEIGHT_COLUMN,
        FIT_SOURCE as HAZARD_BASELINE_FIT_SOURCE,
        HAZARD_BASELINE_SCHEMA_VERSION,
        PRIOR_STRENGTH as HAZARD_BASELINE_PRIOR_STRENGTH,
        RATE_ENCODING as HAZARD_BASELINE_RATE_ENCODING,
        fit_hazard_baseline,
    )
    from contracts import SURVIVAL_HORIZON_MONTHS
    from provenance import file_sha256, json_sha256, producer_metadata
    from train_arrival_population import (
        SUPPORTED_ROLES,
        build_person_period,
        cumulative_predictions,
        fit_role_models,
        load_arrival_corpus,
        player_weights,
    )


ROOT = Path(__file__).resolve().parents[1]
CALIBRATION_MANIFEST_SCHEMA = "arrival-calibration-run/v1"
OOF_SCHEMA_VERSION = "arrival-calibration-oof/v1"
REQUIRED_CORPUS_SEASONS = tuple(range(2010, 2020))
CALIBRATION_EVALUATION_SEASONS = tuple(range(2015, 2020))

OOF_PROTOCOL = {
    "name": "expanding_origin_pre2020_calibration_block",
    "corpus_seasons": list(REQUIRED_CORPUS_SEASONS),
    "evaluation_seasons": list(CALIBRATION_EVALUATION_SEASONS),
    "training_seasons": "all corpus seasons strictly before test_season",
    "training_label_availability": "right_censored_at_test_fold_origin",
    "fold_origin": "maximum as_of timestamp in the test season",
    "required_hazard_intervals": len(SURVIVAL_HORIZON_MONTHS),
    "horizons_months": list(SURVIVAL_HORIZON_MONTHS),
    "binary_outcomes": "fully_mature_by_row_data_cutoff_only",
    "cold_start": "test player absent from every earlier training-season snapshot",
    "sample_weight": "inverse_player_oof_snapshot_count_repeated_at_each_horizon",
    "post_2020_evaluation": "forbidden",
}

HAZARD_BASELINE_CONFIG = {
    "name": "hierarchical_empirical_bayes_annual_hazard",
    "schema_version": HAZARD_BASELINE_SCHEMA_VERSION,
    "fit_source": HAZARD_BASELINE_FIT_SOURCE,
    "estimand": "conditional_arrival_hazard_in_each_12_month_at_risk_interval",
    "fit_rows": "all_pre2020_corpus_person_period_rows_with_row_level_censoring",
    "weighting": "inverse_player_snapshot_count_per_at_risk_interval",
    "weight_column": DEFAULT_WEIGHT_COLUMN,
    "hierarchy": [
        "interval_global",
        "interval_role",
        "interval_role_prior_level",
        "interval_role_prior_level_age_band",
    ],
    "prior_strength": HAZARD_BASELINE_PRIOR_STRENGTH,
    "age_bands": ["<=19", "20-21", "22-23", "24-25", "26-40", "41+", "missing"],
    "rate_encoding": HAZARD_BASELINE_RATE_ENCODING,
}

OOF_COLUMNS = [
    "snapshot_id",
    "player_id",
    "test_season",
    "fold_origin",
    "role",
    "cold_start",
    "horizon_months",
    "probability",
    "outcome",
    "is_oof",
    "sample_weight",
]


class ArrivalCalibrationTrainingError(ValueError):
    pass


def _portable_path(path: Path, root: Path = ROOT) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(root.resolve()))
    except ValueError:
        return str(resolved)


def _resolve_path(value: str, root: Path = ROOT) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def _require_sha256(value: Any, name: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ArrivalCalibrationTrainingError(f"{name} must be a lowercase SHA-256")
    return value


def _require_clean_producer(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ArrivalCalibrationTrainingError(f"{name} producer metadata is missing")
    git = value.get("git")
    if not isinstance(git, Mapping):
        raise ArrivalCalibrationTrainingError(f"{name} git provenance is missing")
    commit = git.get("commit")
    if not isinstance(commit, str) or not commit.strip():
        raise ArrivalCalibrationTrainingError(f"{name} producer commit is missing")
    if git.get("dirty") is not False:
        raise ArrivalCalibrationTrainingError(f"{name} was not produced from a clean worktree")
    return value


def _validate_addressed_json(value: dict[str, Any], address_key: str, name: str) -> str:
    address = _require_sha256(value.get(address_key), f"{name} {address_key}")
    canonical = dict(value)
    canonical.pop(address_key, None)
    if json_sha256(canonical) != address:
        raise ArrivalCalibrationTrainingError(f"{name} content address is invalid")
    return address


def validate_pre2020_corpus(
    snapshots: pd.DataFrame,
    labels: pd.DataFrame,
    corpus_manifest: Mapping[str, Any],
) -> None:
    required_snapshot_columns = {"snapshot_id", "player_id", "edition", "as_of", "role"}
    required_label_columns = {
        "snapshot_id",
        "player_id",
        "as_of",
        "debut_date",
        "data_cutoff",
    }
    if missing := sorted(required_snapshot_columns - set(snapshots.columns)):
        raise ArrivalCalibrationTrainingError(f"Corpus snapshots lack columns: {missing}")
    if missing := sorted(required_label_columns - set(labels.columns)):
        raise ArrivalCalibrationTrainingError(f"Corpus labels lack columns: {missing}")
    if snapshots.empty or labels.empty:
        raise ArrivalCalibrationTrainingError("Calibration corpus cannot be empty")
    if snapshots["snapshot_id"].duplicated().any() or labels["snapshot_id"].duplicated().any():
        raise ArrivalCalibrationTrainingError("Calibration corpus snapshot IDs must be unique")
    snapshot_keys = set(snapshots["snapshot_id"].astype(str))
    label_keys = set(labels["snapshot_id"].astype(str))
    if snapshot_keys != label_keys:
        raise ArrivalCalibrationTrainingError("Calibration snapshot and label keys differ")

    try:
        seasons = tuple(sorted(int(value) for value in snapshots["edition"].unique()))
    except (TypeError, ValueError) as error:
        raise ArrivalCalibrationTrainingError("Corpus seasons must be integers") from error
    if seasons != REQUIRED_CORPUS_SEASONS:
        raise ArrivalCalibrationTrainingError(
            "Calibration requires the exact 2010-2019 pre-2020 corpus"
        )
    manifest_inputs = corpus_manifest.get("inputs")
    if not isinstance(manifest_inputs, list):
        raise ArrivalCalibrationTrainingError("Corpus manifest inputs are missing")
    try:
        manifest_seasons = tuple(sorted(int(item["season"]) for item in manifest_inputs))
    except (KeyError, TypeError, ValueError) as error:
        raise ArrivalCalibrationTrainingError("Corpus manifest seasons are invalid") from error
    if manifest_seasons != REQUIRED_CORPUS_SEASONS:
        raise ArrivalCalibrationTrainingError(
            "Corpus manifest does not identify exactly the 2010-2019 inputs"
        )
    roles = set(snapshots["role"].dropna().astype(str))
    if roles != set(SUPPORTED_ROLES):
        raise ArrivalCalibrationTrainingError(
            f"Calibration corpus must contain exactly the supported roles: {SUPPORTED_ROLES}"
        )


def validate_frozen_benchmark(
    metrics_path: Path,
    corpus_manifest_path: Path,
    corpus_manifest: Mapping[str, Any],
    *,
    root: Path = ROOT,
) -> dict[str, Any]:
    try:
        metrics = json.loads(metrics_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ArrivalCalibrationTrainingError("Frozen benchmark metrics are unreadable") from error
    if not isinstance(metrics, dict):
        raise ArrivalCalibrationTrainingError("Frozen benchmark metrics must be an object")
    report_address = _validate_addressed_json(
        metrics, "validation_report_sha256", "Frozen benchmark metrics"
    )
    configuration = metrics.get("model_configuration")
    if not isinstance(configuration, dict):
        raise ArrivalCalibrationTrainingError("Frozen model configuration is missing")
    configuration_hash = _require_sha256(
        metrics.get("model_configuration_sha256"), "Frozen model configuration hash"
    )
    if json_sha256(configuration) != configuration_hash:
        raise ArrivalCalibrationTrainingError("Frozen model configuration hash differs")

    inputs = metrics.get("inputs")
    if not isinstance(inputs, Mapping):
        raise ArrivalCalibrationTrainingError("Frozen benchmark corpus evidence is missing")
    corpus_manifest_address = _require_sha256(
        corpus_manifest.get("manifest_sha256"), "Corpus manifest address"
    )
    corpus_content_address = _require_sha256(
        corpus_manifest.get("corpus_content_sha256"), "Corpus content address"
    )
    expected_links = {
        "corpus_manifest_sha256": file_sha256(corpus_manifest_path),
        "corpus_manifest_content_address": corpus_manifest_address,
        "corpus_content_sha256": corpus_content_address,
    }
    for key, expected in expected_links.items():
        if inputs.get(key) != expected:
            raise ArrivalCalibrationTrainingError(
                f"Frozen benchmark {key} does not match the calibration corpus"
            )

    artifact = metrics.get("artifact")
    if not isinstance(artifact, Mapping):
        raise ArrivalCalibrationTrainingError("Frozen benchmark artifact evidence is missing")
    artifact_hash = _require_sha256(artifact.get("sha256"), "Frozen model artifact hash")
    archive_value = artifact.get("content_addressed_path")
    if not isinstance(archive_value, str):
        raise ArrivalCalibrationTrainingError("Frozen model archive path is missing")
    archive_path = _resolve_path(archive_value, root)
    if archive_path.stem != artifact_hash:
        raise ArrivalCalibrationTrainingError("Frozen model archive filename is not addressed")
    if not archive_path.is_file() or file_sha256(archive_path) != artifact_hash:
        raise ArrivalCalibrationTrainingError("Frozen model archive hash differs")
    _require_clean_producer(metrics.get("producer"), "Frozen benchmark")
    _require_clean_producer(corpus_manifest.get("producer"), "Arrival corpus")
    return {
        "metrics": metrics,
        "metrics_file_sha256": file_sha256(metrics_path),
        "validation_report_sha256": report_address,
        "model_configuration_sha256": configuration_hash,
        "model_artifact_sha256": artifact_hash,
        "model_artifact_path": _portable_path(archive_path, root),
    }


def _evaluation_seasons(values: Sequence[int]) -> tuple[int, ...]:
    result: list[int] = []
    for value in values:
        if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)):
            raise ArrivalCalibrationTrainingError("Evaluation seasons must be integers")
        result.append(int(value))
    seasons = tuple(result)
    if any(season >= 2021 for season in seasons):
        raise ArrivalCalibrationTrainingError("Evaluation seasons from 2021 onward are forbidden")
    if seasons != CALIBRATION_EVALUATION_SEASONS:
        raise ArrivalCalibrationTrainingError(
            "OOF calibration evaluation seasons must be exactly 2015 through 2019"
        )
    return seasons


def generate_oof_predictions(
    snapshots: pd.DataFrame,
    labels: pd.DataFrame,
    *,
    evaluation_seasons: Sequence[int] = CALIBRATION_EVALUATION_SEASONS,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    seasons = _evaluation_seasons(evaluation_seasons)
    merged = snapshots.merge(
        labels,
        on=["snapshot_id", "player_id", "as_of"],
        how="inner",
        validate="one_to_one",
    )
    if len(merged) != len(snapshots):
        raise ArrivalCalibrationTrainingError("Snapshot/label merge is incomplete")
    output_frames: list[pd.DataFrame] = []
    fold_records: list[dict[str, Any]] = []
    required_intervals = len(SURVIVAL_HORIZON_MONTHS)

    for test_season in seasons:
        train_snapshots = snapshots[snapshots["edition"] < test_season].copy()
        train_labels = labels[labels["snapshot_id"].isin(train_snapshots["snapshot_id"])]
        test = merged[merged["edition"] == test_season].copy()
        if train_snapshots.empty or test.empty:
            raise ArrivalCalibrationTrainingError(
                f"Calibration fold {test_season} has no training or test snapshots"
            )
        if set(test["role"].astype(str)) != set(SUPPORTED_ROLES):
            raise ArrivalCalibrationTrainingError(
                f"Calibration fold {test_season} does not contain every supported role"
            )
        fold_origin = pd.Timestamp(pd.to_datetime(test["as_of"]).max())
        train_periods = build_person_period(train_snapshots, train_labels, fold_origin)
        models = fit_role_models(train_periods)
        role_support = {
            role: int(models.get(role, {}).get("max_training_interval", 0))
            for role in SUPPORTED_ROLES
        }
        if any(value < required_intervals for value in role_support.values()):
            raise ArrivalCalibrationTrainingError(
                f"Calibration fold {test_season} lacks all five hazard intervals: {role_support}"
            )
        predictions = cumulative_predictions(models, test)
        if set(int(value) for value in predictions) != set(SURVIVAL_HORIZON_MONTHS):
            raise ArrivalCalibrationTrainingError(
                f"Calibration fold {test_season} predictions lack a horizon"
            )
        train_players = set(train_snapshots["player_id"].astype(str))
        cold_start = ~test["player_id"].astype(str).isin(train_players)

        for months in SURVIVAL_HORIZON_MONTHS:
            horizon_end = pd.to_datetime(test["as_of"]) + pd.DateOffset(months=months)
            mature = horizon_end.le(pd.to_datetime(test["data_cutoff"]))
            observed_column = f"observed_{months}m"
            outcome_column = f"debut_within_{months}m"
            if not mature.all():
                raise ArrivalCalibrationTrainingError(
                    f"Calibration fold {test_season} has immature {months}-month outcomes"
                )
            if observed_column not in test or not test[observed_column].astype(bool).all():
                raise ArrivalCalibrationTrainingError(
                    f"Calibration fold {test_season} lacks observed {months}-month labels"
                )
            if outcome_column not in test:
                raise ArrivalCalibrationTrainingError(
                    f"Calibration fold {test_season} lacks {outcome_column}"
                )
            debut = pd.to_datetime(test["debut_date"])
            computed_outcome = debut.notna() & debut.le(horizon_end)
            stored_outcome = test[outcome_column].astype(bool)
            if not stored_outcome.equals(computed_outcome):
                raise ArrivalCalibrationTrainingError(
                    f"Calibration fold {test_season} {months}-month labels are inconsistent"
                )
            probability = np.asarray(predictions[months], dtype=float)
            if (
                probability.shape != (len(test),)
                or not np.isfinite(probability).all()
                or ((probability < 0.0) | (probability > 1.0)).any()
            ):
                raise ArrivalCalibrationTrainingError(
                    f"Calibration fold {test_season} {months}-month predictions are invalid"
                )
            output_frames.append(
                pd.DataFrame(
                    {
                        "snapshot_id": test["snapshot_id"].astype(str).to_numpy(),
                        "player_id": test["player_id"].astype(str).to_numpy(),
                        "test_season": test_season,
                        "fold_origin": fold_origin.date().isoformat(),
                        "role": test["role"].astype(str).to_numpy(),
                        "cold_start": cold_start.to_numpy(dtype=bool),
                        "horizon_months": months,
                        "probability": probability,
                        "outcome": stored_outcome.to_numpy(dtype=np.int8),
                        "is_oof": True,
                    }
                )
            )
        fold_records.append(
            {
                "test_season": test_season,
                "fold_origin": fold_origin.date().isoformat(),
                "train_seasons": sorted(
                    int(value) for value in train_snapshots["edition"].unique()
                ),
                "train_snapshots": int(len(train_snapshots)),
                "train_players": int(train_snapshots["player_id"].nunique()),
                "train_person_periods": int(len(train_periods)),
                "test_snapshots": int(len(test)),
                "cold_start_snapshots": int(cold_start.sum()),
                "returning_snapshots": int((~cold_start).sum()),
                "role_max_training_intervals": role_support,
                "label_cutoff": fold_origin.date().isoformat(),
            }
        )

    oof = pd.concat(output_frames, ignore_index=True)
    snapshot_counts = oof.groupby("player_id")["snapshot_id"].transform("nunique")
    oof["sample_weight"] = 1.0 / snapshot_counts.astype(float)
    oof = oof[OOF_COLUMNS].sort_values(
        ["test_season", "snapshot_id", "horizon_months"], kind="mergesort"
    ).reset_index(drop=True)
    if oof.duplicated(["snapshot_id", "horizon_months"]).any():
        raise ArrivalCalibrationTrainingError("OOF snapshot/horizon keys are duplicated")
    horizons_per_snapshot = oof.groupby("snapshot_id")["horizon_months"].agg(
        lambda values: tuple(sorted(int(value) for value in values))
    )
    expected_horizons = tuple(SURVIVAL_HORIZON_MONTHS)
    if not horizons_per_snapshot.map(lambda value: value == expected_horizons).all():
        raise ArrivalCalibrationTrainingError("OOF horizon vectors are incomplete")
    if not oof["is_oof"].all() or set(oof["test_season"]) != set(seasons):
        raise ArrivalCalibrationTrainingError("OOF fold membership is incomplete")
    return oof, fold_records


def _weighted_binary_diagnostics(rows: pd.DataFrame, probability_column: str) -> dict[str, Any]:
    y = rows["outcome"].to_numpy(dtype=float)
    p = np.clip(rows[probability_column].to_numpy(dtype=float), 1e-6, 1.0 - 1e-6)
    weight = rows["sample_weight"].to_numpy(dtype=float)
    weight /= weight.sum()
    return {
        "rows": int(len(rows)),
        "events": int(y.sum()),
        "weighted_observed_rate": float(np.dot(weight, y)),
        "weighted_mean_probability": float(np.dot(weight, p)),
        "weighted_brier": float(np.dot(weight, np.square(p - y))),
        "weighted_log_loss": float(
            -np.dot(weight, y * np.log(p) + (1.0 - y) * np.log1p(-p))
        ),
    }


def calibration_fit_diagnostics(rows: pd.DataFrame) -> dict[str, Any]:
    horizons: dict[str, Any] = {}
    for months, group in rows.groupby("horizon_months", sort=True):
        horizon: dict[str, Any] = {
            "raw": _weighted_binary_diagnostics(group, "probability"),
            "calibrated": _weighted_binary_diagnostics(group, "calibrated_probability"),
            "strata": {},
        }
        for cold_start, stratum in group.groupby("cold_start", sort=True):
            name = "cold_start" if bool(cold_start) else "returning"
            horizon["strata"][name] = {
                "raw": _weighted_binary_diagnostics(stratum, "probability"),
                "calibrated": _weighted_binary_diagnostics(
                    stratum, "calibrated_probability"
                ),
            }
        horizons[str(int(months))] = horizon
    return {
        "scope": "calibrator_fit_sample_only",
        "interpretation": "optimistic_descriptive_diagnostics_not_unbiased_validation",
        "release_eligible": False,
        "horizons": horizons,
    }


def _canonicalize_oof(rows: pd.DataFrame) -> pd.DataFrame:
    columns = OOF_COLUMNS + [
        "calibrated_probability_unprojected",
        "calibrated_probability",
    ]
    result = rows[columns].copy().sort_values(
        ["test_season", "snapshot_id", "horizon_months"], kind="mergesort"
    ).reset_index(drop=True)
    result["snapshot_id"] = result["snapshot_id"].astype("string")
    result["player_id"] = result["player_id"].astype("string")
    result["fold_origin"] = result["fold_origin"].astype("string")
    result["role"] = result["role"].astype("string")
    result["test_season"] = result["test_season"].astype("int16")
    result["horizon_months"] = result["horizon_months"].astype("int16")
    result["outcome"] = result["outcome"].astype("int8")
    result["cold_start"] = result["cold_start"].astype(bool)
    result["is_oof"] = result["is_oof"].astype(bool)
    for column in (
        "probability",
        "sample_weight",
        "calibrated_probability_unprojected",
        "calibrated_probability",
    ):
        result[column] = result[column].astype("float64")
    return result


def _write_content_addressed_text(
    body: str,
    latest_path: Path,
    archive_directory: Path,
) -> tuple[str, Path]:
    latest_path.parent.mkdir(parents=True, exist_ok=True)
    latest_path.write_text(body)
    address = file_sha256(latest_path)
    archive_path = archive_directory / f"{address}.json"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists() and archive_path.read_bytes() != latest_path.read_bytes():
        raise ArrivalCalibrationTrainingError("Content-addressed JSON artifact differs")
    if not archive_path.exists():
        shutil.copyfile(latest_path, archive_path)
    return address, archive_path


def _write_oof_parquet(rows: pd.DataFrame, artifact_dir: Path) -> tuple[Path, str, Path]:
    latest_path = artifact_dir / "oof_predictions.parquet"
    latest_path.parent.mkdir(parents=True, exist_ok=True)
    rows.to_parquet(latest_path, index=False, compression="zstd")
    address = file_sha256(latest_path)
    archive_path = artifact_dir / "oof" / f"{address}.parquet"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists() and file_sha256(archive_path) != address:
        raise ArrivalCalibrationTrainingError("Content-addressed OOF parquet differs")
    if not archive_path.exists():
        shutil.copyfile(latest_path, archive_path)
    return latest_path, address, archive_path


def _calibration_producer(
    corpus_manifest_path: Path,
    benchmark_metrics_path: Path,
    artifact_dir: Path,
    root: Path,
) -> dict[str, Any]:
    return producer_metadata(
        root,
        [
            Path(__file__),
            root / "modeling/arrival_calibration.py",
            root / "modeling/arrival_hazard_baseline.py",
            root / "modeling/train_arrival_population.py",
            root / "modeling/arrival_corpus.py",
            root / "modeling/contracts.py",
            root / "modeling/provenance.py",
            root / "modeling/requirements.lock",
        ],
        {
            "corpus_manifest": _portable_path(corpus_manifest_path, root),
            "benchmark_metrics": _portable_path(benchmark_metrics_path, root),
            "artifact_dir": _portable_path(artifact_dir, root),
        },
    )


def train_calibration(
    corpus_manifest_path: Path,
    benchmark_metrics_path: Path,
    artifact_dir: Path,
    *,
    root: Path = ROOT,
    producer_override: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    snapshots, labels, corpus_manifest = load_arrival_corpus(corpus_manifest_path)
    validate_pre2020_corpus(snapshots, labels, corpus_manifest)
    benchmark = validate_frozen_benchmark(
        benchmark_metrics_path, corpus_manifest_path, corpus_manifest, root=root
    )
    producer = (
        dict(producer_override)
        if producer_override is not None
        else _calibration_producer(
            corpus_manifest_path, benchmark_metrics_path, artifact_dir, root
        )
    )
    # Fail before any expensive fitting or output writes. An official artifact must
    # be reproducible from a committed producer, not merely annotated after the fact.
    _require_clean_producer(producer, "Calibration run")
    oof, folds = generate_oof_predictions(snapshots, labels)
    calibration_model = fit_oof_calibrators(oof, SURVIVAL_HORIZON_MONTHS)
    calibrated_oof = _canonicalize_oof(apply_calibration(oof, calibration_model))

    final_cutoff = pd.Timestamp(pd.to_datetime(labels["data_cutoff"]).max())
    full_periods = build_person_period(snapshots, labels, final_cutoff)
    full_periods = full_periods.copy()
    full_periods[DEFAULT_WEIGHT_COLUMN] = player_weights(full_periods)
    baseline = fit_hazard_baseline(full_periods)
    baseline_portable = baseline.to_portable_dict()
    baseline_content_hash = json_sha256(baseline_portable)

    artifact_dir.mkdir(parents=True, exist_ok=True)
    calibration_body = serialize_calibration_model(calibration_model)
    calibration_hash, calibration_archive = _write_content_addressed_text(
        calibration_body,
        artifact_dir / "calibration.json",
        artifact_dir / "calibrators",
    )
    baseline_body = baseline.to_json() + "\n"
    baseline_hash, baseline_archive = _write_content_addressed_text(
        baseline_body,
        artifact_dir / "censoring_aware_baseline.json",
        artifact_dir / "baselines",
    )
    oof_path, oof_hash, oof_archive = _write_oof_parquet(calibrated_oof, artifact_dir)

    manifest: dict[str, Any] = {
        "schema_version": CALIBRATION_MANIFEST_SCHEMA,
        "status": "research_calibration_fit_not_release_eligible",
        "created_at": datetime.now().astimezone().isoformat(),
        "estimand": "probability_of_first_mlb_arrival_by_horizon_from_affiliated_snapshot",
        "oof_schema_version": OOF_SCHEMA_VERSION,
        "oof_protocol": OOF_PROTOCOL,
        "oof_protocol_sha256": json_sha256(OOF_PROTOCOL),
        "calibration_configuration": CALIBRATION_CONFIG.to_portable_dict(),
        "calibration_configuration_sha256": json_sha256(
            CALIBRATION_CONFIG.to_portable_dict()
        ),
        "folds": folds,
        "fit_support": {
            "rows": int(len(calibrated_oof)),
            "snapshots": int(calibrated_oof["snapshot_id"].nunique()),
            "players": int(calibrated_oof["player_id"].nunique()),
            "events_by_horizon": {
                str(int(months)): int(group["outcome"].sum())
                for months, group in calibrated_oof.groupby("horizon_months", sort=True)
            },
        },
        "fit_sample_diagnostics": calibration_fit_diagnostics(calibrated_oof),
        "censoring_aware_comparator": {
            "implemented": True,
            "schema_version": HAZARD_BASELINE_SCHEMA_VERSION,
            "config": HAZARD_BASELINE_CONFIG,
            "config_sha256": json_sha256(HAZARD_BASELINE_CONFIG),
            "model_content_sha256": baseline_content_hash,
            "artifact_sha256": baseline_hash,
            "content_addressed_path": _portable_path(baseline_archive, root),
            "training_support": {
                "person_period_rows": int(len(full_periods)),
                "players": int(full_periods["player_id"].nunique()),
                "snapshots": int(full_periods["snapshot_id"].nunique()),
                "events": int(full_periods["event"].sum()),
                "weighted_exposure_hex": float(
                    full_periods[DEFAULT_WEIGHT_COLUMN].sum()
                ).hex(),
                "weighted_events_hex": float(
                    full_periods.loc[
                        full_periods["event"].astype(bool), DEFAULT_WEIGHT_COLUMN
                    ].sum()
                ).hex(),
            },
            "comparison_status": "frozen_not_yet_scored_on_external_holdout",
        },
        "inputs": {
            "corpus_manifest_path": _portable_path(corpus_manifest_path, root),
            "corpus_manifest_file_sha256": file_sha256(corpus_manifest_path),
            "corpus_manifest_content_address": corpus_manifest["manifest_sha256"],
            "corpus_content_sha256": corpus_manifest["corpus_content_sha256"],
            "corpus_seasons": list(REQUIRED_CORPUS_SEASONS),
            "benchmark_metrics_path": _portable_path(benchmark_metrics_path, root),
            "benchmark_metrics_file_sha256": benchmark["metrics_file_sha256"],
            "benchmark_validation_report_sha256": benchmark[
                "validation_report_sha256"
            ],
            "frozen_model_configuration_sha256": benchmark[
                "model_configuration_sha256"
            ],
            "frozen_model_artifact_sha256": benchmark["model_artifact_sha256"],
            "frozen_model_artifact_path": benchmark["model_artifact_path"],
        },
        "outputs": {
            "calibrator": {
                "path": _portable_path(artifact_dir / "calibration.json", root),
                "sha256": calibration_hash,
                "content_addressed_path": _portable_path(calibration_archive, root),
            },
            "oof_predictions": {
                "path": _portable_path(oof_path, root),
                "sha256": oof_hash,
                "content_addressed_path": _portable_path(oof_archive, root),
                "rows": int(len(calibrated_oof)),
                "columns": list(calibrated_oof.columns),
            },
        },
        "producer": producer,
        "release_gates": {
            "release_eligible": False,
            "status": "research_only_fit_sample_diagnostics_are_optimistic",
            "blockers": [
                "Calibration diagnostics reuse the OOF predictions used to fit the calibrator.",
                "The calibrator and censoring-aware comparator require a locked external holdout.",
                "Context normalization and prospective monitoring remain pending.",
            ],
        },
    }
    manifest["manifest_sha256"] = json_sha256(manifest)
    body = json.dumps(manifest, indent=2, ensure_ascii=True, allow_nan=False) + "\n"
    latest_manifest = artifact_dir / "calibration_manifest.json"
    latest_manifest.write_text(body)
    archive_manifest = artifact_dir / "manifests" / f"{manifest['manifest_sha256']}.json"
    archive_manifest.parent.mkdir(parents=True, exist_ok=True)
    if archive_manifest.exists() and archive_manifest.read_bytes() != latest_manifest.read_bytes():
        raise ArrivalCalibrationTrainingError("Content-addressed calibration manifest differs")
    if not archive_manifest.exists():
        shutil.copyfile(latest_manifest, archive_manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fit the frozen pre-2020 chronological arrival calibrator"
    )
    parser.add_argument(
        "--corpus-manifest",
        type=Path,
        default=ROOT / "data/processed/arrival-population-v1/corpus_manifest.json",
    )
    parser.add_argument(
        "--benchmark-metrics",
        type=Path,
        default=ROOT / "artifacts/arrival-population-v1/metrics.json",
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        default=ROOT / "artifacts/arrival-calibration-v1",
    )
    args = parser.parse_args()
    manifest = train_calibration(
        args.corpus_manifest,
        args.benchmark_metrics,
        args.artifact_dir,
    )
    print(
        json.dumps(
            {
                "manifest": str(args.artifact_dir / "calibration_manifest.json"),
                "manifest_sha256": manifest["manifest_sha256"],
                "oof_rows": manifest["fit_support"]["rows"],
                "status": manifest["status"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
