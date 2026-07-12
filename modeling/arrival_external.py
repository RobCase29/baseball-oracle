from __future__ import annotations

import argparse
import io
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

try:
    from modeling.arrival_calibration import ArrivalCalibrationModel, apply_calibration
    from modeling.arrival_calibration import deserialize_calibration_model
    from modeling.arrival_corpus import CORPUS_SCHEMA_VERSION, corpus_stable_content
    from modeling.arrival_hazard_baseline import ArrivalHazardBaselineModel
    from modeling.contracts import DATA_CUTOFF, SURVIVAL_HORIZON_MONTHS
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
    from modeling.train_arrival_population import (
        SUPPORTED_ROLES,
        cumulative_predictions,
    )
except ModuleNotFoundError:
    from arrival_calibration import ArrivalCalibrationModel, apply_calibration
    from arrival_calibration import deserialize_calibration_model
    from arrival_corpus import CORPUS_SCHEMA_VERSION, corpus_stable_content
    from arrival_hazard_baseline import ArrivalHazardBaselineModel
    from contracts import DATA_CUTOFF, SURVIVAL_HORIZON_MONTHS
    from provenance import file_sha256, json_sha256, producer_metadata
    from train_arrival_population import SUPPORTED_ROLES, cumulative_predictions


PREDICTION_SCHEMA_VERSION = "arrival-external-predictions/v1"
PREDICTION_MANIFEST_SCHEMA_VERSION = "arrival-external-prediction-run/v1"
EVALUATION_MANIFEST_SCHEMA_VERSION = "arrival-external-evaluation-run/v1"
ADMISSION_SCHEMA_VERSION = "arrival-external-admission/v1"
ROOT = Path(__file__).resolve().parents[1]
EVALUATION_SEASONS = (2021, 2022, 2023, 2024, 2025)
MAX_SELECTED_FEATURE_MISSING_FRACTION = 0.05
MAX_MISSINGNESS_JUMP = 0.05
MAX_UNSEEN_CATEGORICAL_FRACTION = 0.02
MAX_POPULATION_STABILITY_INDEX = 0.20
PSI_SMOOTHING = 1e-6
EXPECTED_SCHEDULE: tuple[dict[str, Any], ...] = (
    {
        "season": 2021,
        "snapshot_as_of": "2021-12-31",
        "mode": "retrospective_scored",
        "horizons_months": [12, 24, 36, 48],
    },
    {
        "season": 2022,
        "snapshot_as_of": "2022-12-31",
        "mode": "retrospective_scored",
        "horizons_months": [12, 24, 36],
    },
    {
        "season": 2023,
        "snapshot_as_of": "2023-12-31",
        "mode": "retrospective_scored",
        "horizons_months": [12, 24],
    },
    {
        "season": 2024,
        "snapshot_as_of": "2024-12-31",
        "mode": "retrospective_scored",
        "horizons_months": [12],
    },
    {
        "season": 2025,
        "snapshot_as_of": "2025-12-31",
        "mode": "prediction_only",
        "horizons_months": [],
    },
)


class ArrivalExternalError(ValueError):
    pass


def _portable_path(path: Path, root: Path = ROOT) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(root.resolve()))
    except ValueError:
        return str(resolved)


def _resolve_path(value: str, root: Path = ROOT) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def _read_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ArrivalExternalError(f"Cannot read {label}: {path}") from error
    if not isinstance(value, dict):
        raise ArrivalExternalError(f"{label} must contain a JSON object")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not _sha256_string(value):
        raise ArrivalExternalError(f"{label} must be a lowercase SHA-256 digest")
    return str(value)


def _require_file(path: Path, expected: Any, label: str) -> str:
    digest = _require_sha256(expected, f"{label} hash")
    if not path.is_file() or path.is_symlink() or file_sha256(path) != digest:
        raise ArrivalExternalError(f"{label} is missing or differs: {path}")
    return digest


def _require_clean_producer(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ArrivalExternalError(f"{label} producer metadata is missing")
    git = value.get("git")
    if not isinstance(git, dict) or git.get("dirty") is not False:
        raise ArrivalExternalError(f"{label} must be produced from a clean git worktree")
    if not isinstance(git.get("commit"), str) or not git["commit"]:
        raise ArrivalExternalError(f"{label} producer git commit is missing")
    return value


def _create_only(path: Path, body: bytes, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        if not path.is_file() or path.is_symlink() or path.read_bytes() != body:
            raise ArrivalExternalError(f"Refusing to overwrite non-identical {label}: {path}")
        return
    try:
        with path.open("xb") as handle:
            handle.write(body)
    except FileExistsError:
        if not path.is_file() or path.is_symlink() or path.read_bytes() != body:
            raise ArrivalExternalError(
                f"Refusing to overwrite concurrently created {label}: {path}"
            )


def _parquet_bytes(rows: pd.DataFrame) -> bytes:
    buffer = io.BytesIO()
    rows.to_parquet(buffer, index=False, compression="zstd")
    return buffer.getvalue()


def _addressed_parquet(
    rows: pd.DataFrame, latest: Path, archive_dir: Path, label: str
) -> dict[str, Any]:
    body = _parquet_bytes(rows)
    import hashlib

    digest = hashlib.sha256(body).hexdigest()
    archive = archive_dir / f"{digest}.parquet"
    _create_only(latest, body, label)
    _create_only(archive, body, f"content-addressed {label}")
    return {
        "path": _portable_path(latest),
        "content_addressed_path": _portable_path(archive),
        "sha256": digest,
        "rows": int(len(rows)),
        "columns": list(rows.columns),
    }


def _addressed_json(
    value: dict[str, Any],
    latest: Path,
    archive_dir: Path,
    *,
    address_field: str,
    label: str,
) -> dict[str, Any]:
    if address_field in value:
        raise ArrivalExternalError(f"{label} already contains its address field")
    addressed = dict(value)
    addressed[address_field] = json_sha256(addressed)
    body = (
        json.dumps(addressed, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False)
        + "\n"
    ).encode()
    archive = archive_dir / f"{addressed[address_field]}.json"
    _create_only(latest, body, label)
    _create_only(archive, body, f"content-addressed {label}")
    return addressed


def frozen_evaluation_schedule() -> list[dict[str, Any]]:
    return [
        {
            "season": int(row["season"]),
            "snapshot_as_of": str(row["snapshot_as_of"]),
            "mode": str(row["mode"]),
            "horizons_months": list(row["horizons_months"]),
        }
        for row in EXPECTED_SCHEDULE
    ]


def _validate_schedule(schedule: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(schedule, (str, bytes)):
        raise ArrivalExternalError("External evaluation schedule must be a sequence")
    normalized: list[dict[str, Any]] = []
    for row in schedule:
        if not isinstance(row, Mapping):
            raise ArrivalExternalError("External evaluation schedule rows must be objects")
        if set(row) != {"season", "snapshot_as_of", "mode", "horizons_months"}:
            raise ArrivalExternalError("External evaluation schedule fields differ")
        season = row["season"]
        if isinstance(season, bool) or not isinstance(season, int):
            raise ArrivalExternalError("External evaluation seasons must be integers")
        horizons = row["horizons_months"]
        if not isinstance(horizons, list) or any(
            isinstance(value, bool) or not isinstance(value, int) for value in horizons
        ):
            raise ArrivalExternalError("External evaluation horizons must be integer arrays")
        normalized.append(
            {
                "season": season,
                "snapshot_as_of": str(row["snapshot_as_of"]),
                "mode": str(row["mode"]),
                "horizons_months": list(horizons),
            }
        )
    if normalized != frozen_evaluation_schedule():
        raise ArrivalExternalError("External evaluation schedule differs from the frozen protocol")
    return normalized


def _canonical_player_ids(values: Iterable[Any], label: str) -> set[str]:
    result: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value.strip():
            raise ArrivalExternalError(f"{label} contains a missing or invalid player ID")
        result.add(value.strip())
    if not result:
        raise ArrivalExternalError(f"{label} cannot be empty")
    return result


def _validate_snapshots(
    snapshots: pd.DataFrame, schedule: Sequence[Mapping[str, Any]]
) -> pd.DataFrame:
    if not isinstance(snapshots, pd.DataFrame) or snapshots.empty:
        raise ArrivalExternalError("External snapshots must be a nonempty DataFrame")
    required = {"snapshot_id", "player_id", "edition", "as_of", "role", "prior_level", "age"}
    missing = sorted(required - set(snapshots.columns))
    if missing:
        raise ArrivalExternalError(f"External snapshots lack columns: {missing}")
    if snapshots.columns.duplicated().any():
        raise ArrivalExternalError("External snapshots contain duplicate columns")

    normalized = snapshots.copy()
    for column in ("snapshot_id", "player_id"):
        if normalized[column].isna().any() or not normalized[column].map(
            lambda value: isinstance(value, str) and bool(value.strip())
        ).all():
            raise ArrivalExternalError(f"External {column} values must be nonempty strings")
        normalized[column] = normalized[column].str.strip()
    if normalized["snapshot_id"].duplicated().any():
        raise ArrivalExternalError("External snapshot IDs must be unique")

    edition = pd.to_numeric(normalized["edition"], errors="coerce")
    if edition.isna().any() or not np.equal(edition, np.floor(edition)).all():
        raise ArrivalExternalError("External snapshot editions must be integers")
    normalized["edition"] = edition.astype(int)
    if tuple(sorted(normalized["edition"].unique())) != EVALUATION_SEASONS:
        raise ArrivalExternalError("External snapshots must contain exactly the 2021-2025 cohorts")

    as_of = pd.to_datetime(normalized["as_of"], errors="coerce")
    if as_of.isna().any():
        raise ArrivalExternalError("External snapshot as_of values are invalid")
    normalized["as_of"] = as_of
    schedule_by_season = {int(row["season"]): row for row in schedule}
    expected_as_of = normalized["edition"].map(
        lambda season: pd.Timestamp(schedule_by_season[season]["snapshot_as_of"])
    )
    if not normalized["as_of"].eq(expected_as_of).all():
        raise ArrivalExternalError("External snapshot landmarks differ from the frozen schedule")

    roles = set(normalized["role"].dropna().astype(str))
    if roles != set(SUPPORTED_ROLES):
        raise ArrivalExternalError(
            f"External snapshots must contain exactly the supported roles: {SUPPORTED_ROLES}"
        )
    for season, group in normalized.groupby("edition", sort=True):
        if set(group["role"].dropna().astype(str)) != set(SUPPORTED_ROLES):
            raise ArrivalExternalError(
                f"External season {season} does not contain both supported roles"
            )
    for column in ("model_eligible", "effective_time_safe"):
        if column in normalized and not normalized[column].eq(True).all():  # noqa: E712
            raise ArrivalExternalError(f"External snapshots violate {column}")
    exclusion_column = next(
        (
            column
            for column in ("model_exclusion_reason", "model_exclusion_reasons")
            if column in normalized
        ),
        None,
    )
    if exclusion_column is not None:
        reasons = normalized[exclusion_column].astype("string").fillna("")
        if reasons.str.strip().ne("").any():
            raise ArrivalExternalError("External snapshots contain model exclusion reasons")
    return normalized.reset_index(drop=True)


def _sha256_string(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def load_external_corpus_features(
    manifest_path: Path, *, root: Path = ROOT
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Verify a content-addressed external corpus and decode only its feature table."""

    root = root.resolve()
    manifest_path = manifest_path.resolve()
    manifest = _read_json_object(manifest_path, "external arrival corpus manifest")
    if manifest.get("schema_version") != CORPUS_SCHEMA_VERSION:
        raise ArrivalExternalError("External arrival corpus schema is unsupported")
    if manifest.get("data_cutoff") != DATA_CUTOFF:
        raise ArrivalExternalError("External arrival corpus cutoff differs from the protocol")
    address = _require_sha256(
        manifest.get("manifest_sha256"), "External corpus manifest address"
    )
    canonical = dict(manifest)
    canonical.pop("manifest_sha256", None)
    if json_sha256(canonical) != address:
        raise ArrivalExternalError("External corpus manifest self-address is invalid")
    archived_manifest = manifest_path.parent / "manifests" / f"{address}.json"
    _require_file(
        archived_manifest,
        file_sha256(manifest_path),
        "Content-addressed external corpus manifest",
    )
    if archived_manifest.read_bytes() != manifest_path.read_bytes():
        raise ArrivalExternalError("External corpus manifest archive differs")
    try:
        stable = corpus_stable_content(manifest)
    except (KeyError, TypeError, ValueError) as error:
        raise ArrivalExternalError("External corpus stable content is incomplete") from error
    corpus_address = _require_sha256(
        manifest.get("corpus_content_sha256"), "External corpus content address"
    )
    if json_sha256(stable) != corpus_address:
        raise ArrivalExternalError("External corpus content address is invalid")
    _source_coverage(manifest)

    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != {"snapshots", "labels"}:
        raise ArrivalExternalError("External corpus outputs are incomplete")
    snapshot_path: Path | None = None
    for name in ("snapshots", "labels"):
        record = outputs[name]
        if not isinstance(record, Mapping):
            raise ArrivalExternalError(f"External corpus {name} evidence is invalid")
        expected = _require_sha256(record.get("sha256"), f"External corpus {name} hash")
        value = record.get("content_addressed_path")
        if not isinstance(value, str):
            raise ArrivalExternalError(f"External corpus {name} archive path is missing")
        path = _resolve_path(value, root)
        _require_file(path, expected, f"External corpus {name} archive")
        if path.parent.name != corpus_address or path.parent.parent.name != "datasets":
            raise ArrivalExternalError(f"External corpus {name} path is not content-addressed")
        if name == "snapshots":
            snapshot_path = path
    assert snapshot_path is not None
    snapshots = pd.read_parquet(snapshot_path)
    expected_rows = int(outputs["snapshots"].get("rows", -1))
    if len(snapshots) != expected_rows:
        raise ArrivalExternalError("External snapshot row count differs from its manifest")
    _require_clean_producer(manifest.get("producer"), "External corpus")
    return snapshots, manifest


def load_external_corpus_labels(
    manifest_path: Path, *, root: Path = ROOT
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Decode labels only in the separate post-prediction evaluation command."""

    _, manifest = load_external_corpus_features(manifest_path, root=root)
    record = manifest["outputs"]["labels"]
    label_path = _resolve_path(record["content_addressed_path"], root.resolve())
    labels = pd.read_parquet(label_path)
    if len(labels) != int(record.get("rows", -1)):
        raise ArrivalExternalError("External label row count differs from its manifest")
    return labels, manifest


def _source_coverage(corpus_manifest: Mapping[str, Any]) -> dict[str, Any]:
    inputs = corpus_manifest.get("inputs")
    if not isinstance(inputs, list):
        raise ArrivalExternalError("External corpus input lineage is missing")
    try:
        seasons = tuple(sorted(int(item["season"]) for item in inputs))
    except (KeyError, TypeError, ValueError) as error:
        raise ArrivalExternalError("External corpus input seasons are invalid") from error
    if seasons != EVALUATION_SEASONS or len(inputs) != len(EVALUATION_SEASONS):
        raise ArrivalExternalError("External corpus must bind exactly the 2021-2025 seasons")

    records: list[dict[str, Any]] = []
    for item in sorted(inputs, key=lambda row: int(row["season"])):
        season = int(item["season"])
        archive = item.get("archive")
        if not isinstance(archive, Mapping):
            raise ArrivalExternalError(f"External season {season} archive lineage is missing")
        coverage = archive.get("coverage")
        adapter = archive.get("source_adapter_coverage")
        if not isinstance(coverage, Mapping) or not isinstance(adapter, Mapping):
            raise ArrivalExternalError(f"External season {season} coverage is missing")
        declared = int(adapter.get("declared_team_pages", -1))
        observed = int(adapter.get("observed_team_pages", -1))
        appearance = int(adapter.get("appearance_data_team_pages", -1))
        no_record = int(adapter.get("declared_no_record_team_pages", -1))
        failed = int(coverage.get("failedTeams", -1))
        complete = (
            declared > 0
            and declared == observed
            and observed == appearance + no_record
            and int(coverage.get("declaredTeams", -1)) == declared
            and int(coverage.get("completedTeams", -1)) == declared
            and failed == 0
        )
        immutable = all(
            _sha256_string(value)
            for value in (
                item.get("dataset_manifest_sha256"),
                item.get("dataset_manifest_content_address"),
                item.get("dataset_content_sha256"),
                archive.get("archive_lock_sha256"),
                archive.get("source_run_manifest_sha256"),
                archive.get("raw_archive_manifest_sha256"),
            )
        )
        records.append(
            {
                "season": season,
                "declared_team_pages": declared,
                "observed_team_pages": observed,
                "appearance_data_team_pages": appearance,
                "declared_no_record_team_pages": no_record,
                "failed_team_pages": failed,
                "reconciled": complete,
                "immutable_lineage_complete": immutable,
            }
        )
    return {
        "seasons": records,
        "all_team_pages_reconciled": all(row["reconciled"] for row in records),
        "all_lineage_content_addressed": all(
            row["immutable_lineage_complete"] for row in records
        ),
    }


def _missing_fraction(values: pd.Series) -> float:
    return float(values.isna().mean())


def _unseen_fraction(training: pd.Series, evaluation: pd.Series) -> float:
    observed = evaluation[evaluation.notna()].astype(str)
    if observed.empty:
        return 0.0
    known = set(training[training.notna()].astype(str))
    return float((~observed.isin(known)).mean())


def _population_stability_index(training: pd.Series, evaluation: pd.Series) -> float:
    reference = pd.to_numeric(training, errors="coerce").to_numpy(dtype=float)
    observed = pd.to_numeric(evaluation, errors="coerce").to_numpy(dtype=float)
    reference[~np.isfinite(reference)] = np.nan
    observed[~np.isfinite(observed)] = np.nan
    finite_reference = reference[np.isfinite(reference)]
    if finite_reference.size == 0:
        raise ArrivalExternalError("Selected numeric training feature has no finite values")
    quantiles = np.unique(np.quantile(finite_reference, np.linspace(0.0, 1.0, 11)))
    if len(quantiles) <= 1:
        edges = np.asarray([-np.inf, np.inf])
    else:
        edges = np.concatenate(([-np.inf], quantiles[1:-1], [np.inf]))

    def proportions(values: np.ndarray) -> np.ndarray:
        missing = ~np.isfinite(values)
        counts = np.bincount(
            np.digitize(values[~missing], edges[1:-1], right=True),
            minlength=len(edges) - 1,
        ).astype(float)
        counts = np.append(counts, float(missing.sum()))
        smoothed = counts + PSI_SMOOTHING
        return smoothed / smoothed.sum()

    expected = proportions(reference)
    actual = proportions(observed)
    return float(np.sum((actual - expected) * np.log(actual / expected)))


def audit_external_admission(
    external_snapshots: pd.DataFrame,
    training_snapshots: pd.DataFrame,
    models: Mapping[str, Mapping[str, Any]],
    corpus_manifest: Mapping[str, Any],
    schedule: Sequence[Mapping[str, Any]] = EXPECTED_SCHEDULE,
) -> dict[str, Any]:
    """Evaluate frozen feature and lineage gates without reading any outcome column."""

    normalized_schedule = _validate_schedule(schedule)
    external = _validate_snapshots(external_snapshots, normalized_schedule)
    if not isinstance(training_snapshots, pd.DataFrame) or training_snapshots.empty:
        raise ArrivalExternalError("Frozen training snapshots cannot be empty")
    if set(models) != set(SUPPORTED_ROLES):
        raise ArrivalExternalError("Frozen model roles differ from the admission contract")
    source = _source_coverage(corpus_manifest)

    feature_cells: list[dict[str, Any]] = []
    for role in SUPPORTED_ROLES:
        model = models[role]
        numeric = model.get("numeric_features")
        categorical = model.get("categorical_features")
        if not isinstance(numeric, list) or not isinstance(categorical, list):
            raise ArrivalExternalError(f"Frozen {role} selected-feature evidence is missing")
        selected = list(dict.fromkeys([*numeric, *categorical]))
        if not selected:
            raise ArrivalExternalError(f"Frozen {role} model has no selected features")
        missing_columns = sorted(
            (set(selected) - set(external.columns))
            | (set(selected) - set(training_snapshots.columns))
        )
        if missing_columns:
            raise ArrivalExternalError(
                f"Selected {role} features are absent from admission data: {missing_columns}"
            )
        training_role = training_snapshots[training_snapshots["role"].eq(role)]
        if training_role.empty:
            raise ArrivalExternalError(f"Frozen training snapshots lack {role}s")
        for season in EVALUATION_SEASONS:
            evaluation_role = external[
                external["role"].eq(role) & external["edition"].eq(season)
            ]
            for feature in selected:
                training_missing = _missing_fraction(training_role[feature])
                evaluation_missing = _missing_fraction(evaluation_role[feature])
                record: dict[str, Any] = {
                    "season": season,
                    "role": role,
                    "feature": feature,
                    "feature_type": "numeric" if feature in numeric else "categorical",
                    "rows": int(len(evaluation_role)),
                    "training_missing_fraction": training_missing,
                    "evaluation_missing_fraction": evaluation_missing,
                    "absolute_missingness_jump": abs(evaluation_missing - training_missing),
                    "unseen_categorical_fraction": None,
                    "population_stability_index": None,
                }
                if feature in numeric:
                    record["population_stability_index"] = _population_stability_index(
                        training_role[feature], evaluation_role[feature]
                    )
                else:
                    record["unseen_categorical_fraction"] = _unseen_fraction(
                        training_role[feature], evaluation_role[feature]
                    )
                feature_cells.append(record)

    maximum_missing = max(row["evaluation_missing_fraction"] for row in feature_cells)
    maximum_jump = max(row["absolute_missingness_jump"] for row in feature_cells)
    unseen = [
        row["unseen_categorical_fraction"]
        for row in feature_cells
        if row["unseen_categorical_fraction"] is not None
    ]
    psi = [
        row["population_stability_index"]
        for row in feature_cells
        if row["population_stability_index"] is not None
    ]
    maximum_unseen = max(unseen, default=0.0)
    maximum_psi = max(psi, default=0.0)
    identity_rate = (
        float(external["identity_resolved"].eq(True).mean())  # noqa: E712
        if "identity_resolved" in external
        else 1.0
    )
    effective_time_rate = (
        float(external["effective_time_safe"].eq(True).mean())  # noqa: E712
        if "effective_time_safe" in external
        else 1.0
    )
    gate_values = {
        "all_team_pages_reconciled": source["all_team_pages_reconciled"],
        "all_lineage_content_addressed": source["all_lineage_content_addressed"],
        "identity_resolution_rate_is_one": identity_rate == 1.0,
        "effective_time_safe_rate_is_one": effective_time_rate == 1.0,
        "duplicate_snapshot_ids_are_zero": not external["snapshot_id"].duplicated().any(),
        "maximum_selected_feature_missing_fraction": (
            maximum_missing <= MAX_SELECTED_FEATURE_MISSING_FRACTION
        ),
        "maximum_missingness_jump": maximum_jump <= MAX_MISSINGNESS_JUMP,
        "maximum_unseen_categorical_fraction": (
            maximum_unseen <= MAX_UNSEEN_CATEGORICAL_FRACTION
        ),
        "maximum_population_stability_index": (
            maximum_psi <= MAX_POPULATION_STABILITY_INDEX
        ),
    }
    failed = [name for name, passed in gate_values.items() if not passed]
    integrity_gate_names = {
        "all_team_pages_reconciled",
        "all_lineage_content_addressed",
        "identity_resolution_rate_is_one",
        "effective_time_safe_rate_is_one",
        "duplicate_snapshot_ids_are_zero",
    }
    integrity_failures = [name for name in failed if name in integrity_gate_names]
    shift_failures = [name for name in failed if name not in integrity_gate_names]
    if integrity_failures:
        status = "integrity_fail_quarantine"
    elif shift_failures:
        status = "admission_pass_distribution_shift_promotion_blocked"
    else:
        status = "admission_pass"
    return {
        "schema_version": ADMISSION_SCHEMA_VERSION,
        "status": status,
        "outcomes_read": False,
        "prediction_allowed": not integrity_failures,
        "score_allowed": not integrity_failures,
        "promotion_eligible": not failed,
        "source_coverage": source,
        "population": {
            "snapshots": int(len(external)),
            "players": int(external["player_id"].nunique()),
            "seasons": list(EVALUATION_SEASONS),
            "identity_resolution_rate": identity_rate,
            "effective_time_safe_rate": effective_time_rate,
        },
        "shift_summary": {
            "maximum_selected_feature_missing_fraction": maximum_missing,
            "maximum_absolute_missingness_jump": maximum_jump,
            "maximum_unseen_categorical_fraction": maximum_unseen,
            "maximum_population_stability_index": maximum_psi,
            "thresholds": {
                "maximum_selected_feature_missing_fraction": (
                    MAX_SELECTED_FEATURE_MISSING_FRACTION
                ),
                "maximum_absolute_missingness_jump": MAX_MISSINGNESS_JUMP,
                "maximum_unseen_categorical_fraction": (
                    MAX_UNSEEN_CATEGORICAL_FRACTION
                ),
                "maximum_population_stability_index": (
                    MAX_POPULATION_STABILITY_INDEX
                ),
                "population_stability_index_smoothing": PSI_SMOOTHING,
            },
        },
        "feature_cells": feature_cells,
        "gates": gate_values,
        "failed_gates": failed,
        "integrity_failures": integrity_failures,
        "distribution_shift_failures": shift_failures,
    }


def _global_cumulative_predictions(
    comparator: ArrivalHazardBaselineModel, rows: int
) -> dict[int, np.ndarray]:
    if rows <= 0:
        raise ArrivalExternalError("Global comparator scoring requires at least one row")
    survival = 1.0
    predictions: dict[int, np.ndarray] = {}
    for interval in comparator.intervals:
        hazard = float(interval.global_estimate.rate)
        if not math.isfinite(hazard) or not 0.0 <= hazard <= 1.0:
            raise ArrivalExternalError("Frozen global comparator contains an invalid hazard")
        survival *= 1.0 - hazard
        predictions[int(interval.horizon_months)] = np.full(rows, 1.0 - survival)
    if tuple(predictions) != tuple(SURVIVAL_HORIZON_MONTHS):
        raise ArrivalExternalError("Frozen global comparator lacks complete horizon support")
    return predictions


def _assert_probability_vectors(rows: pd.DataFrame, columns: Sequence[str]) -> None:
    for column in columns:
        values = pd.to_numeric(rows[column], errors="coerce").to_numpy(dtype=float)
        if not np.isfinite(values).all() or ((values < 0.0) | (values > 1.0)).any():
            raise ArrivalExternalError(f"External {column} values are outside [0, 1]")
    for _, group in rows.groupby("snapshot_id", sort=False):
        ordered = group.sort_values("horizon_months", kind="mergesort")
        if tuple(ordered["horizon_months"]) != tuple(SURVIVAL_HORIZON_MONTHS):
            raise ArrivalExternalError("External prediction horizon vectors are incomplete")
        for column in columns:
            if (np.diff(ordered[column].to_numpy(dtype=float)) < -1e-15).any():
                raise ArrivalExternalError(f"External {column} is not cumulative-monotone")


def build_external_prediction_rows(
    snapshots: pd.DataFrame,
    training_player_ids: Iterable[Any],
    models: Mapping[str, Mapping[str, Any]],
    calibrator: ArrivalCalibrationModel,
    comparator: ArrivalHazardBaselineModel,
    schedule: Sequence[Mapping[str, Any]] = EXPECTED_SCHEDULE,
) -> pd.DataFrame:
    """Apply every frozen prediction component without reading evaluation outcomes."""

    normalized_schedule = _validate_schedule(schedule)
    normalized = _validate_snapshots(snapshots, normalized_schedule)
    training_ids = _canonical_player_ids(training_player_ids, "Frozen training player IDs")
    if set(models) != set(SUPPORTED_ROLES):
        raise ArrivalExternalError("Frozen candidate model roles differ from the contract")
    for role in SUPPORTED_ROLES:
        record = models[role]
        if not isinstance(record, Mapping) or int(record.get("max_training_interval", 0)) != len(
            SURVIVAL_HORIZON_MONTHS
        ):
            raise ArrivalExternalError(f"Frozen {role} model lacks all hazard intervals")

    cold_start = (~normalized["player_id"].isin(training_ids)).astype("int8")
    raw = cumulative_predictions(dict(models), normalized)
    hierarchical = comparator.predict_cumulative(normalized, SURVIVAL_HORIZON_MONTHS)
    global_baseline = _global_cumulative_predictions(comparator, len(normalized))

    frames: list[pd.DataFrame] = []
    identity_columns = [
        "snapshot_id",
        "player_id",
        "edition",
        "as_of",
        "role",
        "prior_level",
        "age",
    ]
    for horizon in SURVIVAL_HORIZON_MONTHS:
        frame = normalized[identity_columns].copy()
        frame["cold_start"] = cold_start.to_numpy()
        frame["horizon_months"] = int(horizon)
        frame["probability"] = np.asarray(raw[horizon], dtype=float)
        frame["hierarchical_baseline_probability"] = np.asarray(
            hierarchical[horizon], dtype=float
        )
        frame["global_baseline_probability"] = np.asarray(
            global_baseline[horizon], dtype=float
        )
        frames.append(frame)
    long_rows = pd.concat(frames, ignore_index=True)
    calibrated = apply_calibration(long_rows, calibrator)
    calibrated = calibrated.rename(
        columns={
            "probability": "raw_candidate_probability",
            "calibrated_probability": "candidate_probability",
        }
    )

    schedule_by_season = {row["season"]: row for row in normalized_schedule}
    calibrated["evaluation_mode"] = calibrated["edition"].map(
        lambda season: schedule_by_season[int(season)]["mode"]
    )
    calibrated["score_outcome"] = [
        int(horizon) in schedule_by_season[int(season)]["horizons_months"]
        for season, horizon in zip(
            calibrated["edition"], calibrated["horizon_months"], strict=True
        )
    ]
    calibrated["prediction_schema_version"] = PREDICTION_SCHEMA_VERSION

    if calibrated.duplicated(["snapshot_id", "horizon_months"]).any():
        raise ArrivalExternalError("External prediction keys are duplicated")
    _assert_probability_vectors(
        calibrated,
        [
            "raw_candidate_probability",
            "calibrated_probability_unprojected",
            "candidate_probability",
            "hierarchical_baseline_probability",
            "global_baseline_probability",
        ],
    )
    return calibrated.sort_values(
        ["edition", "snapshot_id", "horizon_months"], kind="mergesort"
    ).reset_index(drop=True)


def attach_predeclared_outcomes(
    prediction_rows: pd.DataFrame,
    labels: pd.DataFrame,
    *,
    data_cutoff: str = DATA_CUTOFF,
) -> pd.DataFrame:
    """Join labels once while masking every non-predeclared or immature outcome."""

    if not isinstance(prediction_rows, pd.DataFrame) or prediction_rows.empty:
        raise ArrivalExternalError("External prediction rows cannot be empty")
    if not isinstance(labels, pd.DataFrame) or labels.empty:
        raise ArrivalExternalError("External labels cannot be empty")
    required_predictions = {
        "snapshot_id",
        "player_id",
        "edition",
        "horizon_months",
        "score_outcome",
        "evaluation_mode",
    }
    if missing := sorted(required_predictions - set(prediction_rows.columns)):
        raise ArrivalExternalError(f"External predictions lack columns: {missing}")
    required_labels = {"snapshot_id", "player_id", "data_cutoff"}
    required_labels.update(
        f"{prefix}_{horizon}m"
        for horizon in SURVIVAL_HORIZON_MONTHS
        for prefix in ("observed", "debut_within")
    )
    if missing := sorted(required_labels - set(labels.columns)):
        raise ArrivalExternalError(f"External labels lack columns: {missing}")
    if labels["snapshot_id"].duplicated().any():
        raise ArrivalExternalError("External label snapshot IDs must be unique")

    label_keys = labels[["snapshot_id", "player_id"]].copy()
    if label_keys.isna().any().any():
        raise ArrivalExternalError("External label identities cannot be missing")
    prediction_keys = prediction_rows[["snapshot_id", "player_id"]].drop_duplicates()
    merged_keys = prediction_keys.merge(
        label_keys, on=["snapshot_id", "player_id"], how="outer", indicator=True
    )
    if not merged_keys["_merge"].eq("both").all():
        raise ArrivalExternalError("External prediction and label identities differ")

    cutoffs = pd.to_datetime(labels["data_cutoff"], errors="coerce")
    if cutoffs.isna().any() or not cutoffs.eq(pd.Timestamp(data_cutoff)).all():
        raise ArrivalExternalError("External label cutoff differs from the frozen protocol")
    outcome_columns = [
        column
        for column in labels.columns
        if column.startswith("observed_") or column.startswith("debut_within_")
    ]
    joined = prediction_rows.merge(
        labels[["snapshot_id", "player_id", *outcome_columns]],
        on=["snapshot_id", "player_id"],
        how="left",
        validate="many_to_one",
    )

    outcomes = np.full(len(joined), np.nan, dtype=float)
    observed = np.zeros(len(joined), dtype=np.int8)
    for horizon in SURVIVAL_HORIZON_MONTHS:
        selected = joined["horizon_months"].eq(horizon)
        scoreable = selected & joined["score_outcome"].eq(True)  # noqa: E712
        source_observed = joined[f"observed_{horizon}m"]
        source_outcome = joined[f"debut_within_{horizon}m"]
        if (
            source_observed[scoreable].isna().any()
            or not source_observed[scoreable].eq(True).all()  # noqa: E712
        ):
            raise ArrivalExternalError(
                f"Predeclared {horizon}-month outcomes are not fully mature"
            )
        numeric_outcome = pd.to_numeric(source_outcome[scoreable], errors="coerce")
        if numeric_outcome.isna().any() or not numeric_outcome.isin([0, 1]).all():
            raise ArrivalExternalError(
                f"Predeclared {horizon}-month outcomes are not binary"
            )
        outcomes[np.flatnonzero(scoreable.to_numpy())] = numeric_outcome.to_numpy(dtype=float)
        observed[np.flatnonzero(scoreable.to_numpy())] = 1

    if joined.loc[joined["evaluation_mode"].eq("prediction_only"), "score_outcome"].any():
        raise ArrivalExternalError("Prediction-only cohort was marked for outcome scoring")
    joined["outcome"] = pd.Series(outcomes, dtype="Float64")
    joined["outcome_observed"] = observed
    for column in outcome_columns:
        joined = joined.drop(columns=column)
    if joined.loc[joined["outcome_observed"].eq(0), "outcome"].notna().any():
        raise ArrivalExternalError("A masked external outcome remained visible")
    return joined


def _external_producer(
    root: Path, arguments: Mapping[str, Any]
) -> dict[str, Any]:
    return producer_metadata(
        root,
        [
            Path(__file__),
            root / "modeling/arrival_holdout.py",
            root / "modeling/arrival_validation.py",
            root / "modeling/arrival_calibration.py",
            root / "modeling/arrival_hazard_baseline.py",
            root / "modeling/train_arrival_population.py",
            root / "modeling/contracts.py",
            root / "modeling/provenance.py",
            root / "modeling/requirements.lock",
            root / "modeling/config/arrival-validation-v2.json",
        ],
        dict(arguments),
    )


def _load_frozen_components(
    lock: Mapping[str, Any], *, root: Path
) -> tuple[
    Mapping[str, Mapping[str, Any]],
    ArrivalCalibrationModel,
    ArrivalHazardBaselineModel,
    pd.DataFrame,
]:
    try:
        model_record = lock["benchmark"]["model_artifact"]
        corpus_record = lock["benchmark"]["corpus"]
        calibrator_record = lock["calibration"]["calibrator"]
        comparator_record = lock["calibration"]["censoring_aware_comparator"]
    except (KeyError, TypeError) as error:
        raise ArrivalExternalError(
            "Holdout lock frozen application evidence is incomplete"
        ) from error

    model_path = _resolve_path(model_record["content_addressed_path"], root)
    _require_file(model_path, model_record["sha256"], "Frozen candidate model")
    models = joblib.load(model_path)
    if not isinstance(models, Mapping):
        raise ArrivalExternalError("Frozen candidate artifact has an invalid root")

    snapshots_record = corpus_record["outputs"]["snapshots"]
    training_path = _resolve_path(snapshots_record["content_addressed_path"], root)
    _require_file(training_path, snapshots_record["sha256"], "Frozen training snapshots")
    training_snapshots = pd.read_parquet(training_path)
    if len(training_snapshots) != int(snapshots_record["rows"]):
        raise ArrivalExternalError("Frozen training snapshot row count differs")

    calibrator_path = _resolve_path(calibrator_record["content_addressed_path"], root)
    _require_file(calibrator_path, calibrator_record["sha256"], "Frozen calibrator")
    calibrator = deserialize_calibration_model(calibrator_path.read_bytes())

    comparator_path = _resolve_path(comparator_record["content_addressed_path"], root)
    _require_file(comparator_path, comparator_record["sha256"], "Frozen comparator")
    comparator = ArrivalHazardBaselineModel.from_json(comparator_path.read_text())
    return models, calibrator, comparator, training_snapshots


def run_external_prediction(
    lock_path: Path,
    external_corpus_manifest_path: Path,
    artifact_dir: Path,
    *,
    root: Path = ROOT,
    producer_override: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Apply the frozen stack once and archive predictions before any label decode."""

    try:
        from modeling.arrival_holdout import verify_holdout_lock
    except ModuleNotFoundError:
        from arrival_holdout import verify_holdout_lock

    root = root.resolve()
    lock_path = lock_path.resolve()
    external_corpus_manifest_path = external_corpus_manifest_path.resolve()
    artifact_dir = artifact_dir.resolve()
    lock = verify_holdout_lock(lock_path, root=root)
    snapshots, external_manifest = load_external_corpus_features(
        external_corpus_manifest_path, root=root
    )
    models, calibrator, comparator, training_snapshots = _load_frozen_components(
        lock, root=root
    )
    producer = (
        dict(producer_override)
        if producer_override is not None
        else _external_producer(
            root,
            {
                "command": "predict",
                "holdout_lock": _portable_path(lock_path, root),
                "external_corpus_manifest": _portable_path(
                    external_corpus_manifest_path, root
                ),
                "artifact_dir": _portable_path(artifact_dir, root),
            },
        )
    )
    _require_clean_producer(producer, "External prediction")

    admission = audit_external_admission(
        snapshots, training_snapshots, models, external_manifest
    )
    admission_record = {
        **admission,
        "created_at": datetime.now().astimezone().isoformat(),
        "inputs": {
            "holdout_lock_sha256": lock["lock_sha256"],
            "external_corpus_manifest_sha256": external_manifest["manifest_sha256"],
            "external_corpus_content_sha256": external_manifest["corpus_content_sha256"],
        },
        "producer": producer,
    }
    addressed_admission = _addressed_json(
        admission_record,
        artifact_dir / "admission.json",
        artifact_dir / "admissions",
        address_field="admission_sha256",
        label="external admission report",
    )
    if not admission["prediction_allowed"]:
        raise ArrivalExternalError(
            "External cohort failed admission and was quarantined: "
            + ", ".join(admission["failed_gates"])
        )

    predictions = build_external_prediction_rows(
        snapshots,
        training_snapshots["player_id"].astype(str),
        models,
        calibrator,
        comparator,
    )
    forbidden = sorted(
        column
        for column in predictions.columns
        if column == "outcome"
        or column == "outcome_observed"
        or column.startswith("debut_within_")
        or column.startswith("observed_")
    )
    if forbidden:
        raise ArrivalExternalError(
            f"Pre-outcome prediction artifact contains forbidden columns: {forbidden}"
        )
    output = _addressed_parquet(
        predictions,
        artifact_dir / "predictions.parquet",
        artifact_dir / "predictions",
        "external prediction table",
    )
    manifest = {
        "schema_version": PREDICTION_MANIFEST_SCHEMA_VERSION,
        "status": "frozen_predictions_archived_before_outcome_join",
        "created_at": datetime.now().astimezone().isoformat(),
        "outcomes_read": False,
        "lock": {
            "path": _portable_path(lock_path, root),
            "lock_sha256": lock["lock_sha256"],
        },
        "external_corpus": {
            "manifest_path": _portable_path(external_corpus_manifest_path, root),
            "manifest_sha256": external_manifest["manifest_sha256"],
            "corpus_content_sha256": external_manifest["corpus_content_sha256"],
            "seasons": list(EVALUATION_SEASONS),
        },
        "frozen_inputs": lock["frozen_application"],
        "schedule": frozen_evaluation_schedule(),
        "admission": {
            "path": _portable_path(artifact_dir / "admission.json", root),
            "content_addressed_path": _portable_path(
                artifact_dir
                / "admissions"
                / f"{addressed_admission['admission_sha256']}.json",
                root,
            ),
            "sha256": file_sha256(artifact_dir / "admission.json"),
            "admission_sha256": addressed_admission["admission_sha256"],
            "status": addressed_admission["status"],
        },
        "output": output,
        "producer": producer,
    }
    return _addressed_json(
        manifest,
        artifact_dir / "prediction_manifest.json",
        artifact_dir / "manifests",
        address_field="manifest_sha256",
        label="external prediction manifest",
    )


def load_verified_external_predictions(
    manifest_path: Path,
    lock_path: Path,
    external_corpus_manifest_path: Path,
    *,
    root: Path = ROOT,
) -> tuple[pd.DataFrame, dict[str, Any], dict[str, Any]]:
    try:
        from modeling.arrival_holdout import verify_holdout_lock
    except ModuleNotFoundError:
        from arrival_holdout import verify_holdout_lock

    root = root.resolve()
    manifest_path = manifest_path.resolve()
    manifest = _read_json_object(manifest_path, "external prediction manifest")
    if manifest.get("schema_version") != PREDICTION_MANIFEST_SCHEMA_VERSION:
        raise ArrivalExternalError("External prediction manifest schema is unsupported")
    address = _require_sha256(
        manifest.get("manifest_sha256"), "External prediction manifest address"
    )
    canonical = dict(manifest)
    canonical.pop("manifest_sha256", None)
    if json_sha256(canonical) != address:
        raise ArrivalExternalError("External prediction manifest self-address is invalid")
    archive = manifest_path.parent / "manifests" / f"{address}.json"
    _require_file(archive, file_sha256(manifest_path), "External prediction manifest archive")
    if archive.read_bytes() != manifest_path.read_bytes():
        raise ArrivalExternalError("External prediction manifest archive differs")

    lock = verify_holdout_lock(lock_path.resolve(), root=root)
    if manifest.get("lock", {}).get("lock_sha256") != lock["lock_sha256"]:
        raise ArrivalExternalError("External predictions reference a different holdout lock")
    _, external_manifest = load_external_corpus_features(
        external_corpus_manifest_path.resolve(), root=root
    )
    external_evidence = manifest.get("external_corpus")
    if (
        not isinstance(external_evidence, dict)
        or external_evidence.get("manifest_sha256")
        != external_manifest["manifest_sha256"]
        or external_evidence.get("corpus_content_sha256")
        != external_manifest["corpus_content_sha256"]
    ):
        raise ArrivalExternalError("External prediction corpus evidence differs")
    output = manifest.get("output")
    if not isinstance(output, dict):
        raise ArrivalExternalError("External prediction output evidence is missing")
    path = _resolve_path(output.get("content_addressed_path", ""), root)
    _require_file(path, output.get("sha256"), "External prediction table")
    predictions = pd.read_parquet(path)
    if len(predictions) != int(output.get("rows", -1)) or list(predictions.columns) != output.get(
        "columns"
    ):
        raise ArrivalExternalError("External prediction table shape differs from its manifest")
    if manifest.get("outcomes_read") is not False:
        raise ArrivalExternalError("External predictions are not proven pre-outcome")
    _require_clean_producer(manifest.get("producer"), "External prediction")
    return predictions, manifest, lock


def _load_prediction_admission(
    prediction_manifest: Mapping[str, Any], *, root: Path
) -> dict[str, Any]:
    record = prediction_manifest.get("admission")
    if not isinstance(record, Mapping):
        raise ArrivalExternalError("External prediction admission evidence is missing")
    value = record.get("content_addressed_path")
    if not isinstance(value, str):
        raise ArrivalExternalError("External prediction admission archive path is missing")
    path = _resolve_path(value, root)
    _require_file(path, record.get("sha256"), "External admission report")
    admission = _read_json_object(path, "external admission report")
    address = _require_sha256(
        admission.get("admission_sha256"), "External admission content address"
    )
    canonical = dict(admission)
    canonical.pop("admission_sha256", None)
    if json_sha256(canonical) != address or address != record.get("admission_sha256"):
        raise ArrivalExternalError("External admission report self-address differs")
    if admission.get("schema_version") != ADMISSION_SCHEMA_VERSION:
        raise ArrivalExternalError("External admission schema is unsupported")
    if admission.get("outcomes_read") is not False:
        raise ArrivalExternalError("External admission was not outcome-blind")
    if admission.get("score_allowed") is not True:
        raise ArrivalExternalError("External integrity admission blocks outcome scoring")
    return admission


def run_external_evaluation(
    lock_path: Path,
    external_corpus_manifest_path: Path,
    prediction_manifest_path: Path,
    artifact_dir: Path,
    *,
    root: Path = ROOT,
    producer_override: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Join predeclared outcomes once and publish every frozen diagnostic and gate."""

    try:
        from modeling.arrival_validation import evaluate_external_predictions
    except ModuleNotFoundError:
        from arrival_validation import evaluate_external_predictions

    root = root.resolve()
    lock_path = lock_path.resolve()
    external_corpus_manifest_path = external_corpus_manifest_path.resolve()
    prediction_manifest_path = prediction_manifest_path.resolve()
    artifact_dir = artifact_dir.resolve()
    predictions, prediction_manifest, lock = load_verified_external_predictions(
        prediction_manifest_path,
        lock_path,
        external_corpus_manifest_path,
        root=root,
    )
    admission = _load_prediction_admission(prediction_manifest, root=root)
    labels, external_manifest = load_external_corpus_labels(
        external_corpus_manifest_path, root=root
    )
    evaluated_rows = attach_predeclared_outcomes(predictions, labels)
    producer = (
        dict(producer_override)
        if producer_override is not None
        else _external_producer(
            root,
            {
                "command": "evaluate",
                "holdout_lock": _portable_path(lock_path, root),
                "external_corpus_manifest": _portable_path(
                    external_corpus_manifest_path, root
                ),
                "prediction_manifest": _portable_path(prediction_manifest_path, root),
                "artifact_dir": _portable_path(artifact_dir, root),
            },
        )
    )
    _require_clean_producer(producer, "External evaluation")

    inference = lock["evaluation"]["inference"]
    repetitions = int(inference["bootstrap_repetitions"])
    seed = int(inference["bootstrap_seed"])
    baselines = {
        "censoring_aware_hierarchical_empirical_bayes_annual_hazard": (
            "hierarchical_baseline_probability"
        ),
        "frozen_interval_global_annual_hazard": "global_baseline_probability",
    }
    validation = evaluate_external_predictions(
        evaluated_rows,
        baselines,
        promotion_eligible=bool(admission["promotion_eligible"]),
        repetitions=repetitions,
        seed=seed,
    )
    evaluated_output = _addressed_parquet(
        evaluated_rows,
        artifact_dir / "evaluated_rows.parquet",
        artifact_dir / "evaluated_rows",
        "external evaluated rows",
    )
    adjudication = validation.get("promotion_adjudication")
    if not isinstance(adjudication, dict) or not isinstance(adjudication.get("passed"), bool):
        raise ArrivalExternalError("External promotion adjudication is missing")
    report = {
        "schema_version": EVALUATION_MANIFEST_SCHEMA_VERSION,
        "status": (
            "external_validation_pass_not_release_eligible"
            if adjudication["passed"]
            else "external_validation_fail_not_release_eligible"
        ),
        "created_at": datetime.now().astimezone().isoformat(),
        "study_design": "retrospective_external_regime_test_not_prospective",
        "release_eligible": False,
        "lock": {
            "path": _portable_path(lock_path, root),
            "lock_sha256": lock["lock_sha256"],
        },
        "external_corpus": {
            "manifest_path": _portable_path(external_corpus_manifest_path, root),
            "manifest_sha256": external_manifest["manifest_sha256"],
            "corpus_content_sha256": external_manifest["corpus_content_sha256"],
        },
        "prediction_manifest": {
            "path": _portable_path(prediction_manifest_path, root),
            "manifest_sha256": prediction_manifest["manifest_sha256"],
            "prediction_table_sha256": prediction_manifest["output"]["sha256"],
            "outcomes_read_at_prediction_time": prediction_manifest["outcomes_read"],
        },
        "admission": {
            "admission_sha256": admission["admission_sha256"],
            "status": admission["status"],
            "promotion_eligible": admission["promotion_eligible"],
            "failed_gates": admission["failed_gates"],
        },
        "outcome_join": {
            "performed_once_after_prediction_archive": True,
            "data_cutoff": DATA_CUTOFF,
            "observed_rows": int(evaluated_rows["outcome_observed"].sum()),
            "masked_rows": int(evaluated_rows["outcome_observed"].eq(0).sum()),
            "prediction_only_2025_outcomes_joined": False,
        },
        "evaluated_rows": evaluated_output,
        "validation": validation,
        "producer": producer,
        "limitations": [
            "This is a retrospective external regime test, not a prospective experiment.",
            "The source universe is an affiliated season-appearance census, not a contract roster.",
            "A passing result remains research-only until a genuinely prospective cohort matures.",
        ],
    }
    return _addressed_json(
        report,
        artifact_dir / "evaluation_report.json",
        artifact_dir / "reports",
        address_field="report_sha256",
        label="external evaluation report",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply and evaluate the frozen post-2020 arrival holdout"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    predict = subparsers.add_parser(
        "predict", help="archive predictions without decoding outcomes"
    )
    evaluate = subparsers.add_parser(
        "evaluate", help="join only preregistered mature outcomes and score once"
    )
    for command in (predict, evaluate):
        command.add_argument("--lock", type=Path, required=True)
        command.add_argument("--external-corpus-manifest", type=Path, required=True)
        command.add_argument(
            "--artifact-dir",
            type=Path,
            default=ROOT / "artifacts/arrival-external-v1",
        )
    evaluate.add_argument("--prediction-manifest", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "predict":
        result = run_external_prediction(
            args.lock,
            args.external_corpus_manifest,
            args.artifact_dir,
        )
        summary = {
            "status": result["status"],
            "manifest_sha256": result["manifest_sha256"],
            "prediction_rows": result["output"]["rows"],
            "outcomes_read": result["outcomes_read"],
        }
    else:
        result = run_external_evaluation(
            args.lock,
            args.external_corpus_manifest,
            args.prediction_manifest,
            args.artifact_dir,
        )
        summary = {
            "status": result["status"],
            "report_sha256": result["report_sha256"],
            "promotion_passed": result["validation"]["promotion_adjudication"]["passed"],
            "release_eligible": result["release_eligible"],
        }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
