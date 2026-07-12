from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any

try:
    from modeling.arrival_calibration import (
        CALIBRATION_CONFIG,
        CALIBRATION_SCHEMA_VERSION,
        deserialize_calibration_model,
    )
    from modeling.arrival_corpus import CORPUS_SCHEMA_VERSION, corpus_stable_content
    from modeling.arrival_external import (
        MAX_MISSINGNESS_JUMP,
        MAX_POPULATION_STABILITY_INDEX,
        MAX_SELECTED_FEATURE_MISSING_FRACTION,
        MAX_UNSEEN_CATEGORICAL_FRACTION,
        PREDICTION_SCHEMA_VERSION,
        PSI_SMOOTHING,
    )
    from modeling.arrival_hazard_baseline import (
        HAZARD_BASELINE_SCHEMA_VERSION,
        ArrivalHazardBaselineModel,
    )
    from modeling.contracts import SURVIVAL_HORIZON_MONTHS
    from modeling.provenance import file_sha256, json_sha256
    from modeling.arrival_validation import PROMOTION_GATE_CONFIG
except ModuleNotFoundError:
    from arrival_calibration import (
        CALIBRATION_CONFIG,
        CALIBRATION_SCHEMA_VERSION,
        deserialize_calibration_model,
    )
    from arrival_corpus import CORPUS_SCHEMA_VERSION, corpus_stable_content
    from arrival_external import (
        MAX_MISSINGNESS_JUMP,
        MAX_POPULATION_STABILITY_INDEX,
        MAX_SELECTED_FEATURE_MISSING_FRACTION,
        MAX_UNSEEN_CATEGORICAL_FRACTION,
        PREDICTION_SCHEMA_VERSION,
        PSI_SMOOTHING,
    )
    from arrival_hazard_baseline import (
        HAZARD_BASELINE_SCHEMA_VERSION,
        ArrivalHazardBaselineModel,
    )
    from contracts import SURVIVAL_HORIZON_MONTHS
    from provenance import file_sha256, json_sha256
    from arrival_validation import PROMOTION_GATE_CONFIG


ROOT = Path(__file__).resolve().parents[1]
LOCK_SCHEMA_VERSION = "arrival-external-holdout-lock/v2"
PROTOCOL_SCHEMA_VERSION = "arrival-validation-protocol/v2"
CALIBRATION_MANIFEST_SCHEMA = "arrival-calibration-run/v1"
SUFFICIENCY_SCHEMA_VERSION = "arrival-data-sufficiency/v1"
STUDY_STATUS = "retrospective_external_regime_test_not_prospective"
DATA_CUTOFF = "2025-12-31"
MIN_BOOTSTRAP_REPETITIONS = 2_000
BOOTSTRAP_REPETITIONS = MIN_BOOTSTRAP_REPETITIONS
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40,64}$")
EMPTY_GIT_STATUS_SHA256 = (
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)
OFFICIAL_PROTOCOL_PATH = "modeling/config/arrival-validation-v2.json"
EVALUATOR_PRODUCER_PATHS = (
    "modeling/arrival_holdout.py",
    "modeling/arrival_external.py",
    "modeling/arrival_validation.py",
    "modeling/arrival_calibration.py",
    "modeling/arrival_hazard_baseline.py",
    "modeling/contracts.py",
    OFFICIAL_PROTOCOL_PATH,
)

DEFAULT_EVALUATION_SCHEDULE: tuple[dict[str, Any], ...] = (
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
EVALUATION_INGESTION_SENTINELS: tuple[str, ...] = tuple(
    value
    for season in range(2021, 2026)
    for value in (
        f"data/raw/baseball-reference-register/{season}",
        f"data/processed/model-v1-bref-{season}",
        f"data/archive-locks/sports-reference-baseball-register/{season}.json",
        f"data/manifests/runs/*baseball-reference-register-{season}.json",
    )
)


class ArrivalHoldoutError(ValueError):
    pass


def _portable_path(path: Path, root: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(root.resolve()))
    except ValueError:
        return str(resolved)


def _resolve_path(value: str, root: Path) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def _read_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ArrivalHoldoutError(f"Cannot read {label}: {path}") from error
    if not isinstance(value, dict):
        raise ArrivalHoldoutError(f"{label} must contain a JSON object: {path}")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise ArrivalHoldoutError(f"{label} is not a lowercase SHA-256 digest")
    return value


def _require_file_hash(path: Path, expected_sha256: Any, label: str) -> str:
    expected = _require_sha256(expected_sha256, f"{label} hash")
    if not path.is_file() or path.is_symlink():
        raise ArrivalHoldoutError(f"{label} is missing or is not a regular file: {path}")
    if file_sha256(path) != expected:
        raise ArrivalHoldoutError(f"{label} hash differs: {path}")
    return expected


def _regular_file_sha256(path: Path, label: str) -> str:
    if not path.is_file() or path.is_symlink():
        raise ArrivalHoldoutError(f"{label} is missing or is not a regular file: {path}")
    return file_sha256(path)


def _require_identical_files(left: Path, right: Path, label: str) -> None:
    if left.read_bytes() != right.read_bytes():
        raise ArrivalHoldoutError(f"{label} bytes differ")


def _verify_git_commit_exists(root: Path, commit: str) -> None:
    if GIT_COMMIT_PATTERN.fullmatch(commit) is None:
        raise ArrivalHoldoutError("Benchmark producer git commit is invalid")
    try:
        result = subprocess.run(
            ["git", "cat-file", "-e", f"{commit}^{{commit}}"],
            cwd=root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError as error:
        raise ArrivalHoldoutError("Git is unavailable for benchmark verification") from error
    if result.returncode != 0:
        raise ArrivalHoldoutError(
            "Benchmark producer git commit is not present in the repository"
        )


def _git_relative_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ArrivalHoldoutError(f"Git evidence path is not repository-relative: {value}")
    normalized = path.as_posix()
    if normalized.startswith("./") or "\\" in value:
        raise ArrivalHoldoutError(f"Git evidence path is not canonical: {value}")
    return normalized


def _git_blob(root: Path, commit: str, value: str) -> bytes:
    relative = _git_relative_path(value)
    _verify_git_commit_exists(root, commit)
    try:
        result = subprocess.run(
            ["git", "show", f"{commit}:{relative}"],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError as error:
        raise ArrivalHoldoutError(
            "Git is unavailable for immutable evidence verification"
        ) from error
    if result.returncode != 0:
        raise ArrivalHoldoutError(
            f"Recorded producer file is absent from git commit {commit}: {relative}"
        )
    return result.stdout


def _git_blob_sha256(root: Path, commit: str, value: str) -> str:
    return hashlib.sha256(_git_blob(root, commit, value)).hexdigest()


def _verify_producer(
    value: Any,
    label: str,
    *,
    root: Path,
    require_live_files: bool,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ArrivalHoldoutError(f"{label} producer metadata is missing")
    git = value.get("git")
    files = value.get("files")
    if (
        not isinstance(git, dict)
        or git.get("dirty") is not False
        or git.get("status_sha256") != EMPTY_GIT_STATUS_SHA256
    ):
        raise ArrivalHoldoutError(f"{label} was not produced from a clean git state")
    commit = git.get("commit")
    if not isinstance(commit, str):
        raise ArrivalHoldoutError(f"{label} producer git commit is missing")
    _verify_git_commit_exists(root, commit)
    if not isinstance(files, dict) or not files:
        raise ArrivalHoldoutError(f"{label} producer file evidence is missing")

    verified: dict[str, str] = {}
    for raw_path, raw_sha256 in sorted(files.items()):
        if not isinstance(raw_path, str):
            raise ArrivalHoldoutError(f"{label} producer file path is invalid")
        relative = _git_relative_path(raw_path)
        expected = _require_sha256(raw_sha256, f"{label} producer file hash")
        if _git_blob_sha256(root, commit, relative) != expected:
            raise ArrivalHoldoutError(
                f"{label} producer file differs from recorded git object: {relative}"
            )
        if require_live_files:
            _require_file_hash(root / relative, expected, f"{label} producer file {relative}")
        verified[relative] = expected
    return {"git_commit": commit, "files": verified}


def _git_head(root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError as error:
        raise ArrivalHoldoutError("Git is unavailable for evaluator binding") from error
    commit = result.stdout.strip()
    if result.returncode != 0 or GIT_COMMIT_PATTERN.fullmatch(commit) is None:
        raise ArrivalHoldoutError("Evaluator git commit cannot be resolved")
    return commit


def _bind_evaluator(root: Path) -> dict[str, Any]:
    commit = _git_head(root)
    files: dict[str, str] = {}
    for relative in EVALUATOR_PRODUCER_PATHS:
        path = root / relative
        expected = _regular_file_sha256(path, f"Evaluator file {relative}")
        if _git_blob_sha256(root, commit, relative) != expected:
            raise ArrivalHoldoutError(
                f"Evaluator file is not identical to git commit {commit}: {relative}"
            )
        files[relative] = expected
    return {"git_commit": commit, "files": files}


def _verify_evaluator(value: Any, *, root: Path) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"git_commit", "files"}:
        raise ArrivalHoldoutError("Evaluator producer evidence is invalid")
    commit = value.get("git_commit")
    files = value.get("files")
    if not isinstance(commit, str) or not isinstance(files, dict):
        raise ArrivalHoldoutError("Evaluator producer evidence is incomplete")
    if set(files) != set(EVALUATOR_PRODUCER_PATHS):
        raise ArrivalHoldoutError("Evaluator producer file set differs from the frozen contract")
    _verify_git_commit_exists(root, commit)
    verified: dict[str, str] = {}
    for relative, raw_sha256 in sorted(files.items()):
        expected = _require_sha256(raw_sha256, f"Evaluator file hash {relative}")
        if _git_blob_sha256(root, commit, relative) != expected:
            raise ArrivalHoldoutError(f"Evaluator git object hash differs: {relative}")
        verified[relative] = expected
    return {"git_commit": commit, "files": verified}


def _assert_no_evaluation_cohort_ingestion(root: Path) -> None:
    discovered: list[str] = []
    for pattern in EVALUATION_INGESTION_SENTINELS:
        matches = list(root.glob(pattern))
        discovered.extend(_portable_path(path, root) for path in matches)
    if discovered:
        raise ArrivalHoldoutError(
            "Evaluation cohort ingestion appears to have started before lock creation: "
            + ", ".join(sorted(set(discovered)))
        )


def _verify_corpus_manifest(
    path: Path,
    root: Path,
    *,
    require_live_aliases: bool,
) -> dict[str, Any]:
    manifest = _read_json_object(path, "arrival corpus manifest")
    if manifest.get("schema_version") != CORPUS_SCHEMA_VERSION:
        raise ArrivalHoldoutError("Arrival corpus schema is unsupported")
    if manifest.get("data_cutoff") != DATA_CUTOFF:
        raise ArrivalHoldoutError("Arrival corpus data cutoff differs from the holdout cutoff")

    manifest_address = _require_sha256(
        manifest.get("manifest_sha256"), "Arrival corpus manifest address"
    )
    canonical = dict(manifest)
    canonical.pop("manifest_sha256", None)
    if json_sha256(canonical) != manifest_address:
        raise ArrivalHoldoutError("Arrival corpus manifest self-address is invalid")
    if path.parent.name == "manifests" and path.name == f"{manifest_address}.json":
        archived_manifest = path
    else:
        archived_manifest = path.parent / "manifests" / f"{manifest_address}.json"
    if not archived_manifest.is_file() or archived_manifest.is_symlink():
        raise ArrivalHoldoutError("Arrival corpus archived manifest is missing")
    if require_live_aliases:
        _require_identical_files(path, archived_manifest, "Arrival corpus manifest archive")

    corpus_address = _require_sha256(
        manifest.get("corpus_content_sha256"), "Arrival corpus content address"
    )
    try:
        stable_content = corpus_stable_content(manifest)
    except (KeyError, TypeError, ValueError) as error:
        raise ArrivalHoldoutError("Arrival corpus stable content is incomplete") from error
    if json_sha256(stable_content) != corpus_address:
        raise ArrivalHoldoutError("Arrival corpus content address is invalid")

    inputs = manifest.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise ArrivalHoldoutError("Arrival corpus has no training inputs")
    try:
        seasons = sorted(int(item["season"]) for item in inputs)
    except (KeyError, TypeError, ValueError) as error:
        raise ArrivalHoldoutError("Arrival corpus input seasons are invalid") from error
    if len(seasons) != len(set(seasons)):
        raise ArrivalHoldoutError("Arrival corpus input seasons are duplicated")
    if any(season >= 2021 for season in seasons):
        raise ArrivalHoldoutError(
            "Arrival corpus already contains a predeclared evaluation cohort"
        )

    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != {"snapshots", "labels"}:
        raise ArrivalHoldoutError("Arrival corpus outputs are incomplete")
    output_evidence: dict[str, dict[str, Any]] = {}
    for name in ("snapshots", "labels"):
        output = outputs[name]
        if not isinstance(output, dict):
            raise ArrivalHoldoutError(f"Arrival corpus {name} output is invalid")
        expected = _require_sha256(
            output.get("sha256"), f"Arrival corpus {name} output hash"
        )
        primary_value = output.get("path")
        archived_value = output.get("content_addressed_path")
        if not isinstance(primary_value, str) or not isinstance(archived_value, str):
            raise ArrivalHoldoutError(f"Arrival corpus {name} paths are incomplete")
        primary = _resolve_path(primary_value, root)
        archived = _resolve_path(archived_value, root)
        _require_file_hash(archived, expected, f"Arrival corpus {name} archive")
        if require_live_aliases:
            _require_file_hash(primary, expected, f"Arrival corpus {name} output")
            _require_identical_files(primary, archived, f"Arrival corpus {name} archive")
        if archived.parent.name != corpus_address or archived.parent.parent.name != "datasets":
            raise ArrivalHoldoutError(
                f"Arrival corpus {name} archive is not stored under its content address"
            )
        output_evidence[name] = {
            "content_addressed_path": _portable_path(archived, root),
            "sha256": expected,
            "rows": int(output.get("rows", -1)),
        }
        if output_evidence[name]["rows"] < 1:
            raise ArrivalHoldoutError(f"Arrival corpus {name} row count is invalid")

    producer = _verify_producer(
        manifest.get("producer"),
        "Arrival corpus",
        root=root,
        require_live_files=require_live_aliases,
    )
    return {
        "content_addressed_path": _portable_path(archived_manifest, root),
        "file_sha256": file_sha256(archived_manifest),
        "manifest_sha256": manifest_address,
        "corpus_content_sha256": corpus_address,
        "data_cutoff": manifest["data_cutoff"],
        "training_seasons": seasons,
        "outputs": output_evidence,
        "producer": producer,
    }


def verify_benchmark_evidence(
    metrics_path: Path,
    *,
    root: Path = ROOT,
    require_live_aliases: bool = True,
    corpus_manifest_path: Path | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    metrics_path = metrics_path.resolve()
    metrics = _read_json_object(metrics_path, "benchmark metrics report")
    if metrics.get("schema_version") != 1:
        raise ArrivalHoldoutError("Benchmark metrics schema is unsupported")
    if metrics.get("status") != "research_population_benchmark_not_release_eligible":
        raise ArrivalHoldoutError("Benchmark metrics status is not the frozen research state")

    report_address = _require_sha256(
        metrics.get("validation_report_sha256"), "Benchmark validation report address"
    )
    canonical_metrics = dict(metrics)
    canonical_metrics.pop("validation_report_sha256", None)
    if json_sha256(canonical_metrics) != report_address:
        raise ArrivalHoldoutError("Benchmark validation report self-address is invalid")
    if metrics_path.parent.name == "runs" and metrics_path.name == f"{report_address}.json":
        report_archive = metrics_path
    else:
        report_archive = metrics_path.parent / "runs" / f"{report_address}.json"
    if not report_archive.is_file() or report_archive.is_symlink():
        raise ArrivalHoldoutError("Content-addressed benchmark report is missing")
    if require_live_aliases:
        _require_identical_files(metrics_path, report_archive, "Benchmark report archive")

    model_configuration = metrics.get("model_configuration")
    validation_configuration = metrics.get("validation_configuration")
    if not isinstance(model_configuration, dict) or not isinstance(
        validation_configuration, dict
    ):
        raise ArrivalHoldoutError("Benchmark configurations are missing")
    model_configuration_sha256 = _require_sha256(
        metrics.get("model_configuration_sha256"), "Model configuration hash"
    )
    validation_configuration_sha256 = _require_sha256(
        metrics.get("validation_configuration_sha256"),
        "Validation configuration hash",
    )
    if json_sha256(model_configuration) != model_configuration_sha256:
        raise ArrivalHoldoutError("Embedded model configuration hash differs")
    if json_sha256(validation_configuration) != validation_configuration_sha256:
        raise ArrivalHoldoutError("Embedded validation configuration hash differs")

    artifact = metrics.get("artifact")
    if not isinstance(artifact, dict):
        raise ArrivalHoldoutError("Benchmark model artifact evidence is missing")
    artifact_sha256 = _require_sha256(
        artifact.get("sha256"), "Benchmark model artifact hash"
    )
    artifact_path_value = artifact.get("path")
    archive_path_value = artifact.get("content_addressed_path")
    if not isinstance(artifact_path_value, str) or not isinstance(
        archive_path_value, str
    ):
        raise ArrivalHoldoutError("Benchmark model artifact paths are incomplete")
    artifact_path = _resolve_path(artifact_path_value, root)
    artifact_archive = _resolve_path(archive_path_value, root)
    _require_file_hash(
        artifact_archive, artifact_sha256, "Content-addressed benchmark model"
    )
    if require_live_aliases:
        _require_file_hash(artifact_path, artifact_sha256, "Benchmark model artifact")
        _require_identical_files(
            artifact_path, artifact_archive, "Benchmark model artifact archive"
        )
    if artifact_archive.name != f"{artifact_sha256}.joblib":
        raise ArrivalHoldoutError("Benchmark model archive filename is not content-addressed")

    inputs = metrics.get("inputs")
    if not isinstance(inputs, dict):
        raise ArrivalHoldoutError("Benchmark corpus evidence is missing")
    corpus_path_value = inputs.get("corpus_manifest")
    if not isinstance(corpus_path_value, str):
        raise ArrivalHoldoutError("Benchmark corpus manifest path is missing")
    referenced_corpus_path = _resolve_path(corpus_path_value, root)
    corpus_path = (
        corpus_manifest_path.resolve()
        if corpus_manifest_path is not None
        else referenced_corpus_path
    )
    if require_live_aliases:
        corpus_file_sha256 = _require_file_hash(
            referenced_corpus_path,
            inputs.get("corpus_manifest_sha256"),
            "Benchmark corpus manifest",
        )
    else:
        corpus_file_sha256 = _require_sha256(
            inputs.get("corpus_manifest_sha256"), "Benchmark corpus manifest hash"
        )
    corpus = _verify_corpus_manifest(
        corpus_path,
        root,
        require_live_aliases=require_live_aliases,
    )
    if corpus["file_sha256"] != corpus_file_sha256:
        raise ArrivalHoldoutError("Benchmark corpus manifest evidence differs")
    if inputs.get("corpus_manifest_content_address") != corpus["manifest_sha256"]:
        raise ArrivalHoldoutError("Benchmark corpus manifest address differs")
    if inputs.get("corpus_content_sha256") != corpus["corpus_content_sha256"]:
        raise ArrivalHoldoutError("Benchmark corpus content address differs")

    producer = _verify_producer(
        metrics.get("producer"),
        "Benchmark",
        root=root,
        require_live_files=require_live_aliases,
    )

    return {
        "metrics_report": {
            "file_sha256": file_sha256(report_archive),
            "validation_report_sha256": report_address,
            "content_addressed_path": _portable_path(report_archive, root),
        },
        "corpus": corpus,
        "model_artifact": {
            "content_addressed_path": _portable_path(artifact_archive, root),
            "sha256": artifact_sha256,
        },
        "configuration": {
            "model": {
                "metrics_json_pointer": "/model_configuration",
                "sha256": model_configuration_sha256,
            },
            "validation": {
                "metrics_json_pointer": "/validation_configuration",
                "sha256": validation_configuration_sha256,
            },
        },
        "producer": producer,
    }


def _validate_protocol_specification(value: dict[str, Any]) -> None:
    if value.get("schema_version") != PROTOCOL_SCHEMA_VERSION:
        raise ArrivalHoldoutError("External validation protocol schema is unsupported")
    if value.get("status") != "frozen_before_post_2020_ingestion":
        raise ArrivalHoldoutError("External validation protocol is not frozen")
    estimand = value.get("estimand")
    inference = value.get("inference")
    calibration = value.get("calibration")
    comparators = value.get("comparators")
    evaluation = value.get("external_evaluation")
    admission = value.get("admission_gates")
    sufficiency = value.get("sufficiency")
    promotion = value.get("promotion_gates")
    if not all(
        isinstance(item, dict)
        for item in (
            estimand,
            inference,
            calibration,
            comparators,
            evaluation,
            admission,
            sufficiency,
            promotion,
        )
    ):
        raise ArrivalHoldoutError("External validation protocol sections are incomplete")
    if estimand.get("horizons_months") != list(SURVIVAL_HORIZON_MONTHS):
        raise ArrivalHoldoutError("External validation horizons differ from the model contract")
    if (
        inference.get("bootstrap_method") != "paired_nonparametric_player_cluster"
        or inference.get("bootstrap_repetitions") != BOOTSTRAP_REPETITIONS
        or inference.get("bootstrap_seed") != 29
        or inference.get("resampling_unit") != "player_id"
        or inference.get("same_draw_for_candidate_and_all_baselines") is not True
        or inference.get("pooling") != "within_horizon_only_never_across_horizons"
    ):
        raise ArrivalHoldoutError("External validation inference contract differs")
    if (
        calibration.get("candidate_selection_after_freeze") is not False
        or calibration.get("fit_source") != "raw_out_of_fold_predictions_only"
    ):
        raise ArrivalHoldoutError("External calibration application is not frozen")
    executable_calibration = CALIBRATION_CONFIG.to_portable_dict()
    calibration_contract = {
        "formula": "formula",
        "probability_clip": "probability_clip",
        "ridge_strength": "ridge_strength",
        "ridge_target": "ridge_target",
        "slope_constraint": "slope_constraint",
        "monotone_projection": "projection",
        "projection_weight": "projection_weight",
    }
    if any(
        calibration.get(protocol_key) != executable_calibration[executable_key]
        for protocol_key, executable_key in calibration_contract.items()
    ) or calibration.get("common_oof_test_seasons") != [2015, 2016, 2017, 2018, 2019]:
        raise ArrivalHoldoutError("External calibration protocol differs from executable code")
    if (
        comparators.get("primary")
        != "censoring_aware_hierarchical_empirical_bayes_annual_hazard"
        or comparators.get("fit_data")
        != "frozen_pre_2021_person_period_rows_only"
        or comparators.get("weighting")
        != "inverse_player_snapshot_count_per_at_risk_interval"
        or comparators.get("evaluation_outcome_refit") is not False
    ):
        raise ArrivalHoldoutError("External comparator contract is not censoring-aware and frozen")
    if (
        evaluation.get("data_cutoff") != DATA_CUTOFF
        or evaluation.get("model_refit") is not False
        or evaluation.get("recalibration_refit") is not False
        or evaluation.get("threshold_tuning") is not False
    ):
        raise ArrivalHoldoutError("External evaluation application permits post-freeze fitting")
    if (
        evaluation.get("prediction_schema_version") != PREDICTION_SCHEMA_VERSION
        or evaluation.get("non_predeclared_outcome_policy")
        != "mask_even_when_historically_available"
    ):
        raise ArrivalHoldoutError("External prediction and outcome-mask contract differs")
    schedule = evaluation.get("schedule")
    expected_schedule = [
        {
            "season": row["season"],
            "mode": row["mode"],
            "horizons_months": row["horizons_months"],
        }
        for row in DEFAULT_EVALUATION_SCHEDULE
    ]
    if schedule != expected_schedule:
        raise ArrivalHoldoutError("External validation schedule differs from the preregistration")
    shift = admission.get("distribution_shift_definition")
    if (
        admission.get("maximum_selected_feature_missing_fraction")
        != MAX_SELECTED_FEATURE_MISSING_FRACTION
        or admission.get("maximum_missingness_cohort_jump_percentage_points")
        != MAX_MISSINGNESS_JUMP * 100.0
        or admission.get("maximum_unseen_categorical_fraction")
        != MAX_UNSEEN_CATEGORICAL_FRACTION
        or admission.get("maximum_population_stability_index")
        != MAX_POPULATION_STABILITY_INDEX
        or not isinstance(shift, dict)
        or shift.get("population_stability_index_smoothing") != PSI_SMOOTHING
        or admission.get("integrity_failure_action")
        != "quarantine_without_scoring_and_publish_failure"
        or admission.get("distribution_shift_failure_action")
        != "score_full_predeclared_cohort_publish_results_and_fail_promotion"
    ):
        raise ArrivalHoldoutError("External admission thresholds differ from executable code")
    pooled = sufficiency.get("promotion_role_horizon_pooled_cell")
    cold = sufficiency.get("cold_start")
    if (
        not isinstance(pooled, dict)
        or pooled.get("minimum_snapshots") != 2_500
        or pooled.get("minimum_unique_event_players") != 100
        or pooled.get("minimum_unique_non_event_players") != 100
        or not isinstance(cold, dict)
        or cold.get("release_gate_minimum_unique_event_players") != 100
        or cold.get("descriptive_minimum_unique_event_players") != 30
        or cold.get("suppress_inference_below_unique_event_players") != 30
    ):
        raise ArrivalHoldoutError("External validation sufficiency thresholds differ")
    executable_promotion = {
        key: list(item) if isinstance(item, tuple) else item
        for key, item in PROMOTION_GATE_CONFIG.items()
    }
    if any(
        promotion.get(key) != expected
        for key, expected in executable_promotion.items()
    ):
        raise ArrivalHoldoutError("External promotion gates differ from executable code")


def _validate_protocol_benchmark(
    protocol: dict[str, Any], benchmark: dict[str, Any]
) -> None:
    frozen = protocol.get("frozen_benchmark")
    if not isinstance(frozen, dict):
        raise ArrivalHoldoutError("Protocol frozen benchmark evidence is missing")
    expected = {
        "training_seasons": benchmark["corpus"]["training_seasons"],
        "corpus_content_sha256": benchmark["corpus"]["corpus_content_sha256"],
        "model_artifact_sha256": benchmark["model_artifact"]["sha256"],
        "model_configuration_sha256": benchmark["configuration"]["model"]["sha256"],
        "validation_configuration_sha256": benchmark["configuration"]["validation"][
            "sha256"
        ],
        "producer_git_commit": benchmark["producer"]["git_commit"],
    }
    if frozen != expected:
        raise ArrivalHoldoutError("Protocol frozen benchmark differs from immutable evidence")


def _bind_protocol(
    path: Path, evaluator: dict[str, Any], *, root: Path
) -> tuple[dict[str, Any], dict[str, Any]]:
    relative = _portable_path(path, root)
    if relative != OFFICIAL_PROTOCOL_PATH:
        raise ArrivalHoldoutError(
            f"Protocol must be the official repository path: {OFFICIAL_PROTOCOL_PATH}"
        )
    protocol = _read_json_object(path, "external validation protocol")
    _validate_protocol_specification(protocol)
    file_hash = _regular_file_sha256(path, "External validation protocol")
    if evaluator["files"].get(relative) != file_hash:
        raise ArrivalHoldoutError("Protocol bytes differ from the bound evaluator git object")
    return (
        {
            "schema_version": PROTOCOL_SCHEMA_VERSION,
            "git_path": relative,
            "file_sha256": file_hash,
            "json_sha256": json_sha256(protocol),
        },
        protocol,
    )


def _verify_protocol(
    evidence: Any, evaluator: dict[str, Any], *, root: Path
) -> dict[str, Any]:
    expected_keys = {"schema_version", "git_path", "file_sha256", "json_sha256"}
    if not isinstance(evidence, dict) or set(evidence) != expected_keys:
        raise ArrivalHoldoutError("External validation protocol evidence is invalid")
    if evidence.get("schema_version") != PROTOCOL_SCHEMA_VERSION:
        raise ArrivalHoldoutError("External validation protocol evidence schema differs")
    git_path = evidence.get("git_path")
    if git_path != OFFICIAL_PROTOCOL_PATH:
        raise ArrivalHoldoutError("External validation protocol git path differs")
    expected_file_hash = _require_sha256(
        evidence.get("file_sha256"), "External validation protocol file hash"
    )
    if evaluator["files"].get(git_path) != expected_file_hash:
        raise ArrivalHoldoutError("Protocol and evaluator hashes differ")
    body = _git_blob(root, evaluator["git_commit"], git_path)
    if hashlib.sha256(body).hexdigest() != expected_file_hash:
        raise ArrivalHoldoutError("External validation protocol git bytes differ")
    try:
        protocol = json.loads(body)
    except json.JSONDecodeError as error:
        raise ArrivalHoldoutError(
            "External validation protocol git bytes are invalid JSON"
        ) from error
    if not isinstance(protocol, dict):
        raise ArrivalHoldoutError("External validation protocol must be an object")
    if json_sha256(protocol) != _require_sha256(
        evidence.get("json_sha256"), "External validation protocol JSON hash"
    ):
        raise ArrivalHoldoutError("External validation protocol JSON hash differs")
    _validate_protocol_specification(protocol)
    return protocol


def _artifact_evidence(
    value: Any,
    label: str,
    *,
    root: Path,
    require_live_aliases: bool,
    expected_suffix: str,
) -> tuple[dict[str, Any], Path]:
    if not isinstance(value, dict):
        raise ArrivalHoldoutError(f"{label} evidence is missing")
    expected = _require_sha256(value.get("sha256"), f"{label} hash")
    archive_value = value.get("content_addressed_path")
    live_value = value.get("path")
    if not isinstance(archive_value, str):
        raise ArrivalHoldoutError(f"{label} content-addressed path is missing")
    archive = _resolve_path(archive_value, root)
    if archive.name != f"{expected}{expected_suffix}":
        raise ArrivalHoldoutError(f"{label} archive filename is not content-addressed")
    _require_file_hash(archive, expected, f"{label} archive")
    if require_live_aliases:
        if not isinstance(live_value, str):
            raise ArrivalHoldoutError(f"{label} live path is missing")
        live = _resolve_path(live_value, root)
        _require_file_hash(live, expected, label)
        _require_identical_files(live, archive, f"{label} archive")
    return {
        "content_addressed_path": _portable_path(archive, root),
        "sha256": expected,
    }, archive


def verify_calibration_evidence(
    manifest_path: Path,
    benchmark: dict[str, Any],
    protocol: dict[str, Any],
    *,
    root: Path = ROOT,
    require_live_aliases: bool = True,
) -> dict[str, Any]:
    root = root.resolve()
    manifest_path = manifest_path.resolve()
    manifest = _read_json_object(manifest_path, "calibration manifest")
    expected_manifest_fields = {
        "schema_version",
        "status",
        "created_at",
        "estimand",
        "oof_schema_version",
        "oof_protocol",
        "oof_protocol_sha256",
        "calibration_configuration",
        "calibration_configuration_sha256",
        "folds",
        "fit_support",
        "fit_sample_diagnostics",
        "censoring_aware_comparator",
        "inputs",
        "outputs",
        "producer",
        "release_gates",
        "manifest_sha256",
    }
    if set(manifest) != expected_manifest_fields:
        raise ArrivalHoldoutError("Calibration manifest fields differ from the official schema")
    if manifest.get("schema_version") != CALIBRATION_MANIFEST_SCHEMA:
        raise ArrivalHoldoutError("Calibration manifest schema is unsupported")
    if manifest.get("status") != "research_calibration_fit_not_release_eligible":
        raise ArrivalHoldoutError("Calibration manifest status is unsupported")
    address = _require_sha256(manifest.get("manifest_sha256"), "Calibration manifest address")
    canonical = dict(manifest)
    canonical.pop("manifest_sha256", None)
    if json_sha256(canonical) != address:
        raise ArrivalHoldoutError("Calibration manifest self-address is invalid")
    if manifest_path.parent.name == "manifests" and manifest_path.name == f"{address}.json":
        archive_manifest = manifest_path
    else:
        archive_manifest = manifest_path.parent / "manifests" / f"{address}.json"
    archive_manifest_hash = _regular_file_sha256(
        archive_manifest, "Content-addressed calibration manifest"
    )
    if require_live_aliases:
        _require_identical_files(manifest_path, archive_manifest, "Calibration manifest archive")

    inputs = manifest.get("inputs")
    outputs = manifest.get("outputs")
    comparator = manifest.get("censoring_aware_comparator")
    if not isinstance(inputs, dict) or not isinstance(outputs, dict) or not isinstance(
        comparator, dict
    ):
        raise ArrivalHoldoutError("Calibration manifest inputs or outputs are incomplete")
    if set(outputs) != {"calibrator", "oof_predictions"}:
        raise ArrivalHoldoutError("Calibration manifest output set differs")
    oof_protocol = manifest.get("oof_protocol")
    if not isinstance(oof_protocol, dict) or json_sha256(oof_protocol) != _require_sha256(
        manifest.get("oof_protocol_sha256"), "Calibration OOF protocol hash"
    ):
        raise ArrivalHoldoutError("Calibration OOF protocol evidence differs")
    if (
        oof_protocol.get("horizons_months")
        != protocol["estimand"]["horizons_months"]
        or oof_protocol.get("post_2020_evaluation") != "forbidden"
    ):
        raise ArrivalHoldoutError("Calibration OOF protocol violates the external freeze")
    benchmark_report = benchmark["metrics_report"]
    benchmark_corpus = benchmark["corpus"]
    benchmark_model = benchmark["model_artifact"]
    expected_inputs = {
        "corpus_manifest_file_sha256": benchmark_corpus["file_sha256"],
        "corpus_manifest_content_address": benchmark_corpus["manifest_sha256"],
        "corpus_content_sha256": benchmark_corpus["corpus_content_sha256"],
        "corpus_seasons": benchmark_corpus["training_seasons"],
        "benchmark_metrics_file_sha256": benchmark_report["file_sha256"],
        "benchmark_validation_report_sha256": benchmark_report[
            "validation_report_sha256"
        ],
        "frozen_model_configuration_sha256": benchmark["configuration"]["model"][
            "sha256"
        ],
        "frozen_model_artifact_sha256": benchmark_model["sha256"],
        "frozen_model_artifact_path": benchmark_model["content_addressed_path"],
    }
    for key, expected in expected_inputs.items():
        if inputs.get(key) != expected:
            raise ArrivalHoldoutError(f"Calibration input differs from benchmark: {key}")

    calibrator_record, calibrator_archive = _artifact_evidence(
        outputs.get("calibrator"),
        "Calibration model",
        root=root,
        require_live_aliases=require_live_aliases,
        expected_suffix=".json",
    )
    try:
        calibration_model = deserialize_calibration_model(calibrator_archive.read_text())
    except (OSError, ValueError) as error:
        raise ArrivalHoldoutError("Frozen calibration model is invalid") from error
    expected_horizons = tuple(protocol["estimand"]["horizons_months"])
    if calibration_model.horizons_months != expected_horizons:
        raise ArrivalHoldoutError("Frozen calibration horizons differ from the protocol")
    calibration_configuration = manifest.get("calibration_configuration")
    if (
        not isinstance(calibration_configuration, dict)
        or calibration_configuration
        != calibration_model.to_portable_dict().get("config")
        or json_sha256(calibration_configuration)
        != _require_sha256(
            manifest.get("calibration_configuration_sha256"),
            "Calibration configuration hash",
        )
    ):
        raise ArrivalHoldoutError("Frozen calibration configuration differs")
    calibrator_record.update(
        {
            "schema_version": CALIBRATION_SCHEMA_VERSION,
            "horizons_months": list(calibration_model.horizons_months),
        }
    )

    oof_record, _ = _artifact_evidence(
        outputs.get("oof_predictions"),
        "Calibration OOF predictions",
        root=root,
        require_live_aliases=require_live_aliases,
        expected_suffix=".parquet",
    )
    oof = outputs.get("oof_predictions")
    if not isinstance(oof, dict) or int(oof.get("rows", 0)) < 1 or not isinstance(
        oof.get("columns"), list
    ):
        raise ArrivalHoldoutError("Calibration OOF evidence is incomplete")
    fit_support = manifest.get("fit_support")
    if not isinstance(fit_support, dict) or fit_support.get("rows") != int(oof["rows"]):
        raise ArrivalHoldoutError("Calibration OOF rows do not reconcile with fit support")
    oof_record.update({"rows": int(oof["rows"]), "columns": oof["columns"]})

    if (
        comparator.get("implemented") is not True
        or comparator.get("schema_version") != HAZARD_BASELINE_SCHEMA_VERSION
        or comparator.get("comparison_status")
        != "frozen_not_yet_scored_on_external_holdout"
    ):
        raise ArrivalHoldoutError("Censoring-aware comparator is not frozen")
    config = comparator.get("config")
    if not isinstance(config, dict) or json_sha256(config) != _require_sha256(
        comparator.get("config_sha256"), "Comparator configuration hash"
    ):
        raise ArrivalHoldoutError("Censoring-aware comparator configuration differs")
    baseline_value = {
        "sha256": comparator.get("artifact_sha256"),
        "content_addressed_path": comparator.get("content_addressed_path"),
    }
    baseline_record, baseline_archive = _artifact_evidence(
        baseline_value,
        "Censoring-aware hazard baseline",
        root=root,
        require_live_aliases=False,
        expected_suffix=".json",
    )
    try:
        baseline_model = ArrivalHazardBaselineModel.from_json(baseline_archive.read_text())
    except (OSError, ValueError) as error:
        raise ArrivalHoldoutError("Frozen censoring-aware hazard baseline is invalid") from error
    if baseline_model.horizons_months != expected_horizons:
        raise ArrivalHoldoutError("Frozen comparator horizons differ from the protocol")
    if json_sha256(baseline_model.to_portable_dict()) != _require_sha256(
        comparator.get("model_content_sha256"), "Comparator model content hash"
    ):
        raise ArrivalHoldoutError("Frozen comparator content hash differs")
    baseline_record.update(
        {
            "schema_version": HAZARD_BASELINE_SCHEMA_VERSION,
            "model_content_sha256": comparator["model_content_sha256"],
            "config_sha256": comparator["config_sha256"],
            "horizons_months": list(baseline_model.horizons_months),
        }
    )

    producer = _verify_producer(
        manifest.get("producer"),
        "Calibration",
        root=root,
        require_live_files=require_live_aliases,
    )
    release_gates = manifest.get("release_gates")
    if not isinstance(release_gates, dict) or release_gates.get("release_eligible") is not False:
        raise ArrivalHoldoutError("Calibration manifest release status is not research-only")
    return {
        "manifest": {
            "schema_version": CALIBRATION_MANIFEST_SCHEMA,
            "manifest_sha256": address,
            "file_sha256": archive_manifest_hash,
            "content_addressed_path": _portable_path(archive_manifest, root),
        },
        "calibrator": calibrator_record,
        "oof_predictions": oof_record,
        "censoring_aware_comparator": baseline_record,
        "producer": producer,
    }


def verify_sufficiency_evidence(
    report_path: Path,
    benchmark: dict[str, Any],
    *,
    root: Path = ROOT,
    require_live_aliases: bool = True,
) -> dict[str, Any]:
    root = root.resolve()
    report_path = report_path.resolve()
    report = _read_json_object(report_path, "arrival sufficiency report")
    if report.get("schema_version") != SUFFICIENCY_SCHEMA_VERSION:
        raise ArrivalHoldoutError("Arrival sufficiency report schema is unsupported")
    manifest_address = _require_sha256(
        report.get("report_manifest_sha256"), "Sufficiency report manifest address"
    )
    canonical = dict(report)
    canonical.pop("report_manifest_sha256", None)
    if json_sha256(canonical) != manifest_address:
        raise ArrivalHoldoutError("Sufficiency report manifest self-address is invalid")
    if report_path.parent.name == "reports" and report_path.name == f"{manifest_address}.json":
        archive_report = report_path
        output_dir = report_path.parent.parent
    else:
        archive_report = report_path.parent / "reports" / f"{manifest_address}.json"
        output_dir = report_path.parent
    archive_report_hash = _regular_file_sha256(
        archive_report, "Content-addressed sufficiency report"
    )
    if require_live_aliases:
        _require_identical_files(report_path, archive_report, "Sufficiency report archive")

    content_address = _require_sha256(
        report.get("report_content_sha256"), "Sufficiency report content address"
    )
    stable = dict(report)
    for key in (
        "generated_at",
        "report_content_sha256",
        "producer",
        "report_manifest_sha256",
    ):
        stable.pop(key, None)
    if json_sha256(stable) != content_address:
        raise ArrivalHoldoutError("Sufficiency report content address is invalid")
    content_path = output_dir / "content" / f"{content_address}.json"
    content_file_hash = _regular_file_sha256(
        content_path, "Content-addressed sufficiency evidence"
    )
    content = _read_json_object(content_path, "content-addressed sufficiency evidence")
    if content != stable:
        raise ArrivalHoldoutError("Content-addressed sufficiency evidence differs")
    if stable.get("corpus_manifest_sha256") != benchmark["corpus"]["file_sha256"]:
        raise ArrivalHoldoutError("Sufficiency report corpus evidence differs")
    if stable.get("metrics_sha256") != benchmark["metrics_report"]["file_sha256"]:
        raise ArrivalHoldoutError("Sufficiency report benchmark evidence differs")
    corpus = stable.get("corpus")
    if not isinstance(corpus, dict) or corpus.get("content_sha256") != benchmark["corpus"].get(
        "corpus_content_sha256"
    ):
        raise ArrivalHoldoutError("Sufficiency report corpus content address differs")
    producer = _verify_producer(
        report.get("producer"),
        "Sufficiency report",
        root=root,
        require_live_files=require_live_aliases,
    )
    return {
        "manifest": {
            "schema_version": SUFFICIENCY_SCHEMA_VERSION,
            "manifest_sha256": manifest_address,
            "file_sha256": archive_report_hash,
            "content_addressed_path": _portable_path(archive_report, root),
        },
        "content": {
            "content_sha256": content_address,
            "file_sha256": content_file_hash,
            "content_addressed_path": _portable_path(content_path, root),
        },
        "status": report.get("status"),
        "research_process_ready": report.get("research_process_ready") is True,
        "publication_ready": report.get("publication_ready") is True,
        "producer": producer,
    }


def evaluation_protocol() -> dict[str, Any]:
    return {
        "study_design": STUDY_STATUS,
        "data_cutoff": DATA_CUTOFF,
        "no_outcome_inspection_before_lock": True,
        "pre_ingestion_guard": {
            "required_absent_paths_at_creation": list(
                EVALUATION_INGESTION_SENTINELS
            ),
            "path_check_reads_file_contents": False,
            "failure_action": "refuse_lock_creation",
        },
        "outcome_blinding": {
            "creation_utility_read_scope": "frozen_benchmark_evidence_only",
            "evaluation_cohort_features_labels_and_outcomes_read": False,
            "required_order": [
                "create_and_archive_this_lock",
                "ingest_and_archive_complete_evaluation_cohorts",
                "run_admission_gates_without_model_outcome_metrics",
                "score_frozen_model_once",
                "join_mature_outcomes_once",
                "publish_all_predeclared_results_including_failures",
            ],
            "prohibited_before_lock": [
                "evaluation_cohort_ingestion",
                "evaluation_feature_summary_inspection",
                "evaluation_outcome_or_debut_inspection",
                "threshold_or_subgroup_revision",
            ],
        },
        "schedule": copy.deepcopy(list(DEFAULT_EVALUATION_SCHEDULE)),
        "estimand": {
            "population": "all_model_eligible_affiliated_season_appearance_snapshots",
            "outcome": "first_mlb_appearance_by_predeclared_horizon",
            "unit": "player_season_snapshot",
            "prediction_time": "season_end_snapshot_as_of",
            "repeated_player_handling": (
                "retain_snapshots_and_cluster_all_inference_by_player"
            ),
            "prediction_only_policy": (
                "2025_predictions_are_archived_without_outcome_join_or_scoring"
            ),
        },
        "frozen_application": {
            "entrypoint": "modeling.arrival_external.build_external_prediction_rows",
            "model_refit": False,
            "feature_selection_change": False,
            "recalibration": False,
            "threshold_tuning": False,
            "baseline_refit_on_evaluation_outcomes": False,
            "outcome_join_order": "predictions_archived_before_mature_outcome_join",
            "unseen_category_handling": "frozen_pipeline_handle_unknown_ignore",
            "missing_feature_handling": "frozen_pipeline_imputation_without_test_outcome_access",
        },
        "comparators": {
            "primary": "censoring_aware_hierarchical_empirical_bayes_annual_hazard",
            "baseline_fit_data": "frozen_pre_2021_person_period_rows_only",
            "secondary": "frozen_interval_global_annual_hazard",
        },
        "admission_gates": {
            "evaluated_before_outcome_scoring": True,
            "failure_actions": {
                "integrity_failure": (
                    "quarantine_cohort_block_scoring_and_publish_gate_failure"
                ),
                "distribution_shift_failure": (
                    "score_and_publish_predeclared_test_but_mark_promotion_ineligible"
                ),
            },
            "requirements": [
                "permission_evidence_and_immutable_raw_archive_lock_exist_for_every_season",
                "all_declared_team_pages_are_reconciled_or_explicitly_declared_no_record",
                "source_run_is_complete_with_zero_failed_teams",
                (
                    "risk_set_contract_snapshot_policy_and_effective_time_guards_"
                    "match_the_frozen_corpus"
                ),
                "zero_duplicate_snapshot_ids_and_one_label_row_per_snapshot",
                "zero_mlb_debut_before_or_on_snapshot_as_of",
                "feature_columns_are_computable_without_post_snapshot_information",
                "both_frozen_model_roles_are_present",
                "no_evaluation_season_is_added_to_training_or_baseline_fit_data",
            ],
            "coverage": {
                "declared_team_page_reconciliation_fraction": 1.0,
                "failed_team_pages": 0,
                "missing_required_archive_receipts": 0,
                "duplicate_snapshot_ids": 0,
                "unsupported_roles": 0,
                "pre_snapshot_mlb_debuts": 0,
                "maximum_selected_feature_missing_fraction": 0.05,
                (
                    "maximum_selected_feature_missingness_"
                    "cohort_jump_percentage_points"
                ): 5.0,
                "maximum_unseen_categorical_value_fraction": 0.02,
                "maximum_population_stability_index": 0.20,
            },
        },
        "metrics": {
            "primary": {
                "name": "paired_brier_improvement",
                "definition": "empirical_bayes_brier_minus_frozen_model_brier",
                "aggregation": (
                    "equal_weight_macro_mean_over_sufficient_"
                    "pooled_role_horizon_cells"
                ),
                "direction": "higher_is_better",
            },
            "proper_scoring_rules": ["brier", "log_loss"],
            "calibration": [
                "calibration_in_the_large",
                "calibration_intercept",
                "calibration_slope",
                "expected_calibration_error",
                "observed_to_expected_ratio",
            ],
            "discrimination_descriptive_only": [
                "roc_auc",
                "average_precision",
                "top_decile_lift",
            ],
            "reporting_units": [
                "each_season_horizon_cell",
                "pooled_role_horizon_promotion_cells",
                "equal_weight_macro_summary_over_sufficient_pooled_cells",
                "cold_start",
                "returning_player",
                "role",
                "prior_level",
            ],
        },
        "bootstrap": {
            "method": "paired_nonparametric_player_cluster_bootstrap",
            "repetitions": BOOTSTRAP_REPETITIONS,
            "minimum_repetitions": MIN_BOOTSTRAP_REPETITIONS,
            "random_seed": 29,
            "confidence_level": 0.95,
            "interval": "two_sided_percentile",
            "resampling_unit": "player_id",
            "pairing": "same_resampled_players_for_model_and_baseline",
            "repeated_snapshots": "all_rows_for_resampled_player_move_together",
            "macro_summary": "recompute_cell_metrics_and_equal_weight_macro_mean_within_each_draw",
        },
        "sufficiency": {
            "season_horizon_cell": {
                "use": "descriptive_only_never_consumed_by_promotion_gates",
                "report_counts_even_when_inference_is_suppressed": True,
            },
            "promotion_role_horizon_pooled_cell": {
                "pooling": "pool_predeclared_scored_seasons_within_role_and_horizon",
                "minimum_snapshots": 2_500,
                "minimum_unique_event_players": 100,
                "minimum_unique_non_event_players": 100,
            },
            "cold_start_cell": {
                "definition": "player_id_absent_from_frozen_pre_2021_training_corpus",
                "release_gate_minimum_unique_event_players": 100,
                "descriptive_only_unique_event_player_range_inclusive": [30, 99],
                "suppress_inferential_metrics_below_unique_event_players": 30,
            },
            "subgroup_cell": {
                "predeclared_groups": ["role", "prior_level"],
                "minimum_snapshots": 500,
                "minimum_unique_event_players": 50,
                "minimum_unique_non_event_players": 50,
                "calibration_slope_minimum_unique_event_players": 100,
            },
            "insufficient_cell_policy": (
                "report_counts_and_predictions_but_mark_not_evaluable_"
                "never_pool_or_redefine"
            ),
        },
        "performance_gates": {
            "promotion_requires_every_gate": True,
            "promotion_gate_input": "sufficient_pooled_role_horizon_cells_only",
            "primary_macro_paired_brier_improvement": {
                "point_estimate_greater_than": 0.0,
                "bootstrap_95pct_lower_bound_greater_than": 0.0,
            },
            "evaluable_pooled_role_horizon_paired_brier_improvement": {
                "minimum_fraction_with_positive_point_estimate": 0.75,
                "no_role_may_have_negative_macro_point_estimate": True,
            },
            "calibration_in_the_large": {
                "maximum_absolute_macro_value": 0.02,
                "minimum_fraction_of_evaluable_cells_with_absolute_value_at_most_0_03": 0.75,
            },
            "calibration_slope": {
                "macro_interval_inclusive": [0.8, 1.2],
                "minimum_fraction_of_evaluable_cells_in_interval": 0.75,
            },
            "observed_to_expected_ratio": {
                "macro_interval_inclusive": [0.8, 1.25],
                "minimum_fraction_of_evaluable_cells_in_interval": 0.75,
            },
            "expected_calibration_error": {
                "maximum_macro_value": 0.02,
                "minimum_fraction_of_evaluable_cells_at_most_0_02": 0.75,
            },
            "cold_start": {
                "macro_paired_brier_improvement_greater_than": 0.0,
                "maximum_absolute_calibration_in_the_large": 0.03,
                "must_meet_predeclared_sufficiency": True,
            },
            "subgroups": {
                "report_every_sufficient_predeclared_group": True,
                "no_sufficient_role_macro_brier_worse_than_baseline": True,
                "no_silent_subgroup_exclusion": True,
            },
            "gate_failure_policy": (
                "retain_research_status_publish_failure_and_do_not_tune_on_holdout"
            ),
        },
        "multiplicity_and_missingness": {
            "primary_confirmatory_test_count": 1,
            "all_other_metrics": (
                "diagnostic_with_confidence_intervals_"
                "no_claim_of_confirmatory_significance"
            ),
            "missing_predictions": "automatic_admission_failure",
            "missing_outcomes_in_mature_cell": "automatic_admission_failure",
        },
    }


def admission_failure_policy() -> dict[str, Any]:
    return {
        "integrity": {
            "checks": [
                "source_and_archive_completeness",
                "identity_resolution",
                "duplicate_snapshot_or_prediction_keys",
                "outcome_or_future_information_leakage",
                "effective_time_and_knowledge_time_guards",
            ],
            "failure_action": "quarantine_block_scoring_and_publish_failure",
        },
        "distribution_shift": {
            "checks": [
                "selected_feature_missingness_jump",
                "unseen_categorical_fraction",
                "population_stability_index",
            ],
            "failure_action": (
                "score_and_publish_predeclared_test_mark_promotion_ineligible"
            ),
            "test_suppression": False,
        },
    }


def _frozen_application(
    benchmark: dict[str, Any],
    calibration: dict[str, Any],
    evaluator: dict[str, Any],
) -> dict[str, Any]:
    return {
        "entrypoint": "modeling.arrival_external.build_external_prediction_rows",
        "application_order": [
            "build_predictions_without_evaluation_outcomes",
            "archive_candidate_calibrated_and_comparator_predictions",
            "apply_predeclared_maturity_mask",
            "join_mature_binary_outcomes_once",
            "score_without_refit_or_threshold_tuning",
        ],
        "candidate": {
            "artifact_sha256": benchmark["model_artifact"]["sha256"],
            "refit": False,
        },
        "calibrator": {
            "artifact_sha256": calibration["calibrator"]["sha256"],
            "application": "modeling.arrival_calibration.apply_calibration",
            "refit": False,
            "reselection": False,
        },
        "primary_comparator": {
            "artifact_sha256": calibration["censoring_aware_comparator"]["sha256"],
            "application": (
                "modeling.arrival_hazard_baseline."
                "ArrivalHazardBaselineModel.predict_cumulative"
            ),
            "fit_source": "frozen_pre_2021_person_period_rows_only",
            "refit": False,
        },
        "secondary_comparator": {
            "artifact_sha256": calibration["censoring_aware_comparator"]["sha256"],
            "application": "frozen_interval_global_annual_hazard",
            "refit": False,
        },
        "scoring_code_git_commit": evaluator["git_commit"],
    }


def build_holdout_lock(
    metrics_path: Path,
    protocol_path: Path,
    calibration_manifest_path: Path,
    *,
    sufficiency_report_path: Path | None = None,
    root: Path = ROOT,
) -> dict[str, Any]:
    root = root.resolve()
    _assert_no_evaluation_cohort_ingestion(root)
    evaluator = _bind_evaluator(root)
    protocol_evidence, protocol = _bind_protocol(
        protocol_path.resolve(), evaluator, root=root
    )
    benchmark = verify_benchmark_evidence(metrics_path, root=root)
    _validate_protocol_benchmark(protocol, benchmark)
    calibration = verify_calibration_evidence(
        calibration_manifest_path,
        benchmark,
        protocol,
        root=root,
    )
    sufficiency = (
        verify_sufficiency_evidence(sufficiency_report_path, benchmark, root=root)
        if sufficiency_report_path is not None
        else None
    )
    lock: dict[str, Any] = {
        "schema_version": LOCK_SCHEMA_VERSION,
        "status": STUDY_STATUS,
        "benchmark": benchmark,
        "protocol": protocol_evidence,
        "calibration": calibration,
        "sufficiency": sufficiency,
        "evaluator": evaluator,
        "frozen_application": _frozen_application(
            benchmark, calibration, evaluator
        ),
        "admission_failure_policy": admission_failure_policy(),
        "evaluation": protocol,
        "limitations": [
            (
                "This temporal test is external to model development but retrospective "
                "because outcomes may already exist at lock creation time."
            ),
            (
                "The lock does not convert historical source knowledge times into "
                "prospectively observed knowledge times."
            ),
            "The 2025 cohort is prediction-only at the 2025-12-31 data cutoff.",
            (
                "Creating this lock does not ingest cohorts, inspect outcomes, score "
                "predictions, or authorize release."
            ),
        ],
    }
    lock["lock_sha256"] = json_sha256(lock)
    return lock


def _lock_body(lock: dict[str, Any]) -> bytes:
    return (json.dumps(lock, indent=2, sort_keys=True) + "\n").encode()


def content_addressed_lock_path(output_path: Path, lock_sha256: str) -> Path:
    _require_sha256(lock_sha256, "Holdout lock address")
    return output_path.parent / "locks" / f"{lock_sha256}.json"


def _write_create_only(path: Path, body: bytes, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        if not path.is_file() or path.is_symlink() or path.read_bytes() != body:
            raise ArrivalHoldoutError(
                f"Refusing to overwrite non-identical {label}: {path}"
            )
        return
    try:
        with path.open("xb") as handle:
            handle.write(body)
    except FileExistsError:
        if not path.is_file() or path.is_symlink() or path.read_bytes() != body:
            raise ArrivalHoldoutError(
                f"Refusing to overwrite concurrently created {label}: {path}"
            )


def verify_holdout_lock(path: Path, *, root: Path = ROOT) -> dict[str, Any]:
    path = path.resolve()
    lock = _read_json_object(path, "external holdout lock")
    expected_keys = {
        "schema_version",
        "status",
        "benchmark",
        "protocol",
        "calibration",
        "sufficiency",
        "evaluator",
        "frozen_application",
        "admission_failure_policy",
        "evaluation",
        "limitations",
        "lock_sha256",
    }
    if set(lock) != expected_keys:
        raise ArrivalHoldoutError("External holdout lock fields differ from the schema")
    if lock.get("schema_version") != LOCK_SCHEMA_VERSION:
        raise ArrivalHoldoutError("External holdout lock schema is unsupported")
    if lock.get("status") != STUDY_STATUS:
        raise ArrivalHoldoutError("External holdout study status is dishonest or unsupported")
    lock_address = _require_sha256(lock.get("lock_sha256"), "Holdout lock address")
    canonical = dict(lock)
    canonical.pop("lock_sha256", None)
    if json_sha256(canonical) != lock_address:
        raise ArrivalHoldoutError("External holdout lock self-address is invalid")

    evaluator = _verify_evaluator(lock.get("evaluator"), root=root.resolve())
    protocol = _verify_protocol(lock.get("protocol"), evaluator, root=root.resolve())
    if lock.get("evaluation") != protocol:
        raise ArrivalHoldoutError("Embedded evaluation protocol differs from immutable git bytes")
    if lock.get("admission_failure_policy") != admission_failure_policy():
        raise ArrivalHoldoutError("External holdout admission failure policy differs")

    benchmark = lock.get("benchmark")
    if not isinstance(benchmark, dict):
        raise ArrivalHoldoutError("External holdout benchmark evidence is missing")
    metrics_record = benchmark.get("metrics_report")
    corpus_record = benchmark.get("corpus")
    metrics_value = (
        metrics_record.get("content_addressed_path")
        if isinstance(metrics_record, dict)
        else None
    )
    corpus_value = (
        corpus_record.get("content_addressed_path")
        if isinstance(corpus_record, dict)
        else None
    )
    if not isinstance(metrics_value, str) or not isinstance(corpus_value, str):
        raise ArrivalHoldoutError("External holdout immutable benchmark paths are missing")
    verified_benchmark = verify_benchmark_evidence(
        _resolve_path(metrics_value, root),
        root=root,
        require_live_aliases=False,
        corpus_manifest_path=_resolve_path(corpus_value, root),
    )
    if benchmark != verified_benchmark:
        raise ArrivalHoldoutError("Frozen benchmark evidence differs from referenced bytes")
    _validate_protocol_benchmark(protocol, verified_benchmark)

    calibration = lock.get("calibration")
    manifest_record = calibration.get("manifest") if isinstance(calibration, dict) else None
    manifest_value = (
        manifest_record.get("content_addressed_path")
        if isinstance(manifest_record, dict)
        else None
    )
    if not isinstance(manifest_value, str):
        raise ArrivalHoldoutError("External holdout calibration archive path is missing")
    verified_calibration = verify_calibration_evidence(
        _resolve_path(manifest_value, root),
        verified_benchmark,
        protocol,
        root=root,
        require_live_aliases=False,
    )
    if calibration != verified_calibration:
        raise ArrivalHoldoutError("Frozen calibration evidence differs from referenced bytes")

    sufficiency = lock.get("sufficiency")
    if sufficiency is not None:
        sufficiency_manifest = (
            sufficiency.get("manifest") if isinstance(sufficiency, dict) else None
        )
        sufficiency_value = (
            sufficiency_manifest.get("content_addressed_path")
            if isinstance(sufficiency_manifest, dict)
            else None
        )
        if not isinstance(sufficiency_value, str):
            raise ArrivalHoldoutError("External holdout sufficiency archive path is missing")
        verified_sufficiency = verify_sufficiency_evidence(
            _resolve_path(sufficiency_value, root),
            verified_benchmark,
            root=root,
            require_live_aliases=False,
        )
        if sufficiency != verified_sufficiency:
            raise ArrivalHoldoutError("Frozen sufficiency evidence differs from referenced bytes")

    expected_application = _frozen_application(
        verified_benchmark, verified_calibration, evaluator
    )
    if lock.get("frozen_application") != expected_application:
        raise ArrivalHoldoutError("Frozen model application contract differs")

    archive_path = content_addressed_lock_path(path, lock_address)
    if not archive_path.is_file() or archive_path.is_symlink():
        raise ArrivalHoldoutError("Content-addressed external holdout lock is missing")
    _require_identical_files(path, archive_path, "External holdout lock archive")
    return lock


def create_holdout_lock(
    metrics_path: Path,
    protocol_path: Path,
    calibration_manifest_path: Path,
    output_path: Path,
    *,
    sufficiency_report_path: Path | None = None,
    root: Path = ROOT,
) -> dict[str, Any]:
    lock = build_holdout_lock(
        metrics_path.resolve(),
        protocol_path.resolve(),
        calibration_manifest_path.resolve(),
        sufficiency_report_path=(
            sufficiency_report_path.resolve()
            if sufficiency_report_path is not None
            else None
        ),
        root=root.resolve(),
    )
    body = _lock_body(lock)
    output_path = output_path.resolve()
    archive_path = content_addressed_lock_path(output_path, lock["lock_sha256"])
    if output_path == archive_path:
        raise ArrivalHoldoutError("Holdout lock output cannot alias its archive")
    _write_create_only(output_path, body, "external holdout lock")
    _write_create_only(archive_path, body, "content-addressed external holdout lock")
    return verify_holdout_lock(output_path, root=root.resolve())


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create-only preregistration for the frozen arrival model's external "
            "retrospective regime test"
        )
    )
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--calibration-manifest", type=Path, required=True)
    parser.add_argument("--sufficiency-report", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    lock = create_holdout_lock(
        args.metrics,
        args.protocol,
        args.calibration_manifest,
        args.output,
        sufficiency_report_path=args.sufficiency_report,
    )
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "content_addressed_output": str(
                    content_addressed_lock_path(
                        args.output.resolve(), lock["lock_sha256"]
                    )
                ),
                "lock_sha256": lock["lock_sha256"],
                "status": lock["status"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
