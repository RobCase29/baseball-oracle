from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pandas as pd
import pytest

from modeling.arrival_calibration import (
    ArrivalCalibrationModel,
    HorizonCalibrator,
    serialize_calibration_model,
)
from modeling.arrival_corpus import CORPUS_SCHEMA_VERSION, corpus_stable_content
from modeling.arrival_hazard_baseline import (
    HAZARD_BASELINE_SCHEMA_VERSION,
    fit_hazard_baseline,
)
from modeling.arrival_holdout import (
    BOOTSTRAP_REPETITIONS,
    DATA_CUTOFF,
    EVALUATOR_PRODUCER_PATHS,
    MIN_BOOTSTRAP_REPETITIONS,
    OFFICIAL_PROTOCOL_PATH,
    STUDY_STATUS,
    ArrivalHoldoutError,
    content_addressed_lock_path,
    create_holdout_lock,
    evaluation_protocol,
    verify_holdout_lock,
)
from modeling.contracts import SURVIVAL_HORIZON_MONTHS
from modeling.provenance import file_sha256, json_sha256


EMPTY_STATUS_SHA256 = (
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def _git(root: Path, *arguments: str) -> str:
    return subprocess.check_output(
        ["git", *arguments], cwd=root, text=True, stderr=subprocess.DEVNULL
    ).strip()


def _producer(root: Path, commit: str, files: list[str]) -> dict:
    return {
        "files": {value: file_sha256(root / value) for value in files},
        "git": {
            "commit": commit,
            "dirty": False,
            "status_sha256": EMPTY_STATUS_SHA256,
        },
        "environment": {},
        "arguments": {},
    }


def _initialize_repository(root: Path) -> str:
    subprocess.run(
        ["git", "init", "-q"], cwd=root, check=True, stdout=subprocess.DEVNULL
    )
    _git(root, "config", "user.name", "Arrival Holdout Test")
    _git(root, "config", "user.email", "holdout@example.test")
    sources = {
        "modeling/benchmark_producer.py": "# frozen benchmark producer\n",
        "modeling/corpus_producer.py": "# frozen corpus producer\n",
    }
    for value, body in sources.items():
        path = root / value
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
    _git(root, "add", "modeling")
    _git(root, "commit", "-q", "-m", "freeze benchmark producers")
    return _git(root, "rev-parse", "HEAD")


def _benchmark_fixture(root: Path, commit: str, *, corpus_season: int = 2019) -> dict:
    artifact_path = root / "artifacts/arrival-population-v1/model.joblib"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_bytes(b"synthetic frozen model bytes\n")
    artifact_sha256 = file_sha256(artifact_path)
    artifact_archive = artifact_path.parent / "models" / f"{artifact_sha256}.joblib"
    artifact_archive.parent.mkdir()
    artifact_archive.write_bytes(artifact_path.read_bytes())

    corpus_dir = root / "data/processed/arrival-population-v1"
    snapshots_path = corpus_dir / "snapshots.parquet"
    labels_path = corpus_dir / "labels.parquet"
    corpus_dir.mkdir(parents=True)
    snapshots_path.write_bytes(b"synthetic snapshot archive\n")
    labels_path.write_bytes(b"synthetic label archive\n")
    output_hashes = {
        "snapshots": file_sha256(snapshots_path),
        "labels": file_sha256(labels_path),
    }
    inputs = [
        {
            "season": corpus_season,
            "dataset_content_sha256": "a" * 64,
            "archive": {
                "raw_archive_manifest_sha256": "b" * 64,
                "source_adapter_coverage": {
                    "declared_team_pages": 1,
                    "observed_team_pages": 1,
                    "appearance_data_team_pages": 1,
                    "declared_no_record_team_pages": 0,
                },
            },
        }
    ]
    output_summary = {
        name: {"rows": 1, "sha256": digest} for name, digest in output_hashes.items()
    }
    stable = {
        "schema_version": CORPUS_SCHEMA_VERSION,
        "data_cutoff": DATA_CUTOFF,
        "snapshot_policy": "affiliated-season-appearance-effective-time-v1",
        "input_dataset_content_sha256": ["a" * 64],
        "raw_archive_manifest_sha256": ["b" * 64],
        "source_adapter_coverage": [
            {
                "season": corpus_season,
                "declared_team_pages": 1,
                "observed_team_pages": 1,
                "appearance_data_team_pages": 1,
                "declared_no_record_team_pages": 0,
            }
        ],
        "outputs": output_summary,
    }
    corpus_address = json_sha256(stable)
    datasets_dir = corpus_dir / "datasets" / corpus_address
    datasets_dir.mkdir(parents=True)
    archived_snapshots = datasets_dir / "snapshots.parquet"
    archived_labels = datasets_dir / "labels.parquet"
    archived_snapshots.write_bytes(snapshots_path.read_bytes())
    archived_labels.write_bytes(labels_path.read_bytes())
    outputs = {
        "snapshots": {
            "path": str(snapshots_path.relative_to(root)),
            "content_addressed_path": str(archived_snapshots.relative_to(root)),
            "rows": 1,
            "sha256": output_hashes["snapshots"],
        },
        "labels": {
            "path": str(labels_path.relative_to(root)),
            "content_addressed_path": str(archived_labels.relative_to(root)),
            "rows": 1,
            "sha256": output_hashes["labels"],
        },
    }
    corpus = {
        "schema_version": CORPUS_SCHEMA_VERSION,
        "data_cutoff": DATA_CUTOFF,
        "snapshot_policy": stable["snapshot_policy"],
        "corpus_content_sha256": corpus_address,
        "inputs": inputs,
        "outputs": outputs,
        "producer": _producer(root, commit, ["modeling/corpus_producer.py"]),
    }
    assert corpus_stable_content(corpus) == stable
    corpus["manifest_sha256"] = json_sha256(corpus)
    corpus_path = corpus_dir / "corpus_manifest.json"
    _write_json(corpus_path, corpus)
    corpus_archive = corpus_dir / "manifests" / f"{corpus['manifest_sha256']}.json"
    corpus_archive.parent.mkdir()
    corpus_archive.write_bytes(corpus_path.read_bytes())

    model_configuration = {
        "model": "synthetic_role_specific_discrete_time_hazard",
        "random_seed": 29,
    }
    validation_configuration = {
        "protocol": "expanding_origin_by_affiliated_season",
        "bootstrap_unit": "player_cluster",
    }
    metrics = {
        "schema_version": 1,
        "status": "research_population_benchmark_not_release_eligible",
        "model_configuration": model_configuration,
        "model_configuration_sha256": json_sha256(model_configuration),
        "validation_configuration": validation_configuration,
        "validation_configuration_sha256": json_sha256(validation_configuration),
        "inputs": {
            "corpus_manifest": str(corpus_path.relative_to(root)),
            "corpus_manifest_sha256": file_sha256(corpus_path),
            "corpus_manifest_content_address": corpus["manifest_sha256"],
            "corpus_content_sha256": corpus_address,
        },
        "artifact": {
            "path": str(artifact_path.relative_to(root)),
            "content_addressed_path": str(artifact_archive.relative_to(root)),
            "sha256": artifact_sha256,
        },
        "producer": _producer(root, commit, ["modeling/benchmark_producer.py"]),
    }
    metrics["validation_report_sha256"] = json_sha256(metrics)
    metrics_path = artifact_path.parent / "metrics.json"
    _write_json(metrics_path, metrics)
    metrics_archive = (
        metrics_path.parent / "runs" / f"{metrics['validation_report_sha256']}.json"
    )
    metrics_archive.parent.mkdir()
    metrics_archive.write_bytes(metrics_path.read_bytes())
    return {
        "metrics": metrics_path,
        "metrics_archive": metrics_archive,
        "corpus": corpus_path,
        "corpus_archive": corpus_archive,
        "snapshots": snapshots_path,
        "labels": labels_path,
        "archived_snapshots": archived_snapshots,
        "model": artifact_path,
        "model_archive": artifact_archive,
        "corpus_address": corpus_address,
        "corpus_manifest_address": corpus["manifest_sha256"],
        "model_sha256": artifact_sha256,
        "model_configuration_sha256": metrics["model_configuration_sha256"],
        "validation_configuration_sha256": metrics["validation_configuration_sha256"],
        "report_address": metrics["validation_report_sha256"],
        "producer_commit": commit,
        "training_seasons": [corpus_season],
    }


def _commit_evaluator(root: Path, benchmark: dict) -> tuple[str, Path]:
    for relative in EVALUATOR_PRODUCER_PATHS:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if relative == OFFICIAL_PROTOCOL_PATH:
            protocol = json.loads((PROJECT_ROOT / OFFICIAL_PROTOCOL_PATH).read_text())
            protocol["frozen_benchmark"] = {
                "training_seasons": benchmark["training_seasons"],
                "corpus_content_sha256": benchmark["corpus_address"],
                "model_artifact_sha256": benchmark["model_sha256"],
                "model_configuration_sha256": benchmark["model_configuration_sha256"],
                "validation_configuration_sha256": benchmark[
                    "validation_configuration_sha256"
                ],
                "producer_git_commit": benchmark["producer_commit"],
            }
            _write_json(path, protocol)
        else:
            path.write_text(f"# frozen evaluator source: {relative}\n")
    _git(root, "add", "modeling")
    _git(root, "commit", "-q", "-m", "freeze external evaluator")
    return _git(root, "rev-parse", "HEAD"), root / OFFICIAL_PROTOCOL_PATH


def _calibration_fixture(root: Path, benchmark: dict, commit: str) -> dict:
    artifact_dir = root / "artifacts/arrival-calibration-v1"
    calibration_model = ArrivalCalibrationModel(
        horizons_months=tuple(SURVIVAL_HORIZON_MONTHS),
        calibrators=tuple(
            HorizonCalibrator(
                horizon_months=horizon,
                alpha=0.0,
                beta=1.0,
                gamma=0.0,
                training_rows=4,
                training_events=2,
                training_weight=4.0,
                returning_rows=2,
                returning_events=1,
                cold_start_rows=2,
                cold_start_events=1,
            )
            for horizon in SURVIVAL_HORIZON_MONTHS
        ),
    )
    calibrator_path = artifact_dir / "calibration.json"
    calibrator_path.parent.mkdir(parents=True)
    calibrator_path.write_text(serialize_calibration_model(calibration_model))
    calibrator_hash = file_sha256(calibrator_path)
    calibrator_archive = artifact_dir / "calibrators" / f"{calibrator_hash}.json"
    calibrator_archive.parent.mkdir()
    calibrator_archive.write_bytes(calibrator_path.read_bytes())

    periods: list[dict] = []
    for player, role, event_at_five in (
        ("hitter-player", "hitter", True),
        ("pitcher-player", "pitcher", False),
    ):
        for interval in range(1, 6):
            periods.append(
                {
                    "snapshot_id": player,
                    "role": role,
                    "prior_level": "AA",
                    "age": 22,
                    "interval": interval,
                    "event": int(event_at_five and interval == 5),
                    "sample_weight": 1.0,
                }
            )
    baseline = fit_hazard_baseline(pd.DataFrame(periods))
    baseline_path = artifact_dir / "censoring_aware_baseline.json"
    baseline_path.write_text(baseline.to_json() + "\n")
    baseline_hash = file_sha256(baseline_path)
    baseline_archive = artifact_dir / "baselines" / f"{baseline_hash}.json"
    baseline_archive.parent.mkdir()
    baseline_archive.write_bytes(baseline_path.read_bytes())

    oof_path = artifact_dir / "oof_predictions.parquet"
    oof_path.write_bytes(b"synthetic OOF parquet bytes\n")
    oof_hash = file_sha256(oof_path)
    oof_archive = artifact_dir / "oof" / f"{oof_hash}.parquet"
    oof_archive.parent.mkdir()
    oof_archive.write_bytes(oof_path.read_bytes())

    comparator_config = {
        "name": "hierarchical_empirical_bayes_annual_hazard",
        "schema_version": HAZARD_BASELINE_SCHEMA_VERSION,
        "fit_rows": "all_pre2020_corpus_person_period_rows_with_row_level_censoring",
    }
    oof_protocol = {
        "name": "expanding_origin_pre2020_calibration_block",
        "horizons_months": list(SURVIVAL_HORIZON_MONTHS),
        "post_2020_evaluation": "forbidden",
    }
    calibration_configuration = calibration_model.to_portable_dict()["config"]
    manifest = {
        "schema_version": "arrival-calibration-run/v1",
        "status": "research_calibration_fit_not_release_eligible",
        "created_at": "2026-07-12T00:00:00+00:00",
        "estimand": "probability_of_first_mlb_arrival_by_horizon_from_affiliated_snapshot",
        "oof_schema_version": "arrival-calibration-oof/v1",
        "oof_protocol": oof_protocol,
        "oof_protocol_sha256": json_sha256(oof_protocol),
        "calibration_configuration": calibration_configuration,
        "calibration_configuration_sha256": json_sha256(calibration_configuration),
        "folds": [],
        "fit_support": {
            "rows": 20,
            "snapshots": 4,
            "players": 4,
            "events_by_horizon": {
                str(horizon): 2 for horizon in SURVIVAL_HORIZON_MONTHS
            },
        },
        "fit_sample_diagnostics": {},
        "inputs": {
            "corpus_manifest_path": str(benchmark["corpus"].relative_to(root)),
            "corpus_manifest_file_sha256": file_sha256(benchmark["corpus"]),
            "corpus_manifest_content_address": benchmark["corpus_manifest_address"],
            "corpus_content_sha256": benchmark["corpus_address"],
            "corpus_seasons": benchmark["training_seasons"],
            "benchmark_metrics_path": str(benchmark["metrics"].relative_to(root)),
            "benchmark_metrics_file_sha256": file_sha256(benchmark["metrics"]),
            "benchmark_validation_report_sha256": benchmark["report_address"],
            "frozen_model_configuration_sha256": benchmark[
                "model_configuration_sha256"
            ],
            "frozen_model_artifact_sha256": benchmark["model_sha256"],
            "frozen_model_artifact_path": str(benchmark["model_archive"].relative_to(root)),
        },
        "outputs": {
            "calibrator": {
                "path": str(calibrator_path.relative_to(root)),
                "sha256": calibrator_hash,
                "content_addressed_path": str(calibrator_archive.relative_to(root)),
            },
            "oof_predictions": {
                "path": str(oof_path.relative_to(root)),
                "sha256": oof_hash,
                "content_addressed_path": str(oof_archive.relative_to(root)),
                "rows": 20,
                "columns": [
                    "snapshot_id",
                    "player_id",
                    "horizon_months",
                    "probability",
                    "outcome",
                ],
            },
        },
        "censoring_aware_comparator": {
            "implemented": True,
            "schema_version": HAZARD_BASELINE_SCHEMA_VERSION,
            "config": comparator_config,
            "config_sha256": json_sha256(comparator_config),
            "model_content_sha256": json_sha256(baseline.to_portable_dict()),
            "artifact_sha256": baseline_hash,
            "content_addressed_path": str(baseline_archive.relative_to(root)),
            "training_support": {"person_period_rows": len(periods)},
            "comparison_status": "frozen_not_yet_scored_on_external_holdout",
        },
        "producer": _producer(root, commit, ["modeling/arrival_calibration.py"]),
        "release_gates": {
            "release_eligible": False,
            "status": "research_only_fit_sample_diagnostics_are_optimistic",
            "blockers": ["external holdout pending"],
        },
    }
    manifest["manifest_sha256"] = json_sha256(manifest)
    manifest_path = artifact_dir / "calibration_manifest.json"
    _write_json(manifest_path, manifest)
    manifest_archive = artifact_dir / "manifests" / f"{manifest['manifest_sha256']}.json"
    manifest_archive.parent.mkdir()
    manifest_archive.write_bytes(manifest_path.read_bytes())
    return {
        "manifest": manifest_path,
        "manifest_archive": manifest_archive,
        "calibrator": calibrator_path,
        "calibrator_archive": calibrator_archive,
        "baseline": baseline_path,
        "baseline_archive": baseline_archive,
        "oof": oof_path,
    }


def _sufficiency_fixture(root: Path, benchmark: dict, commit: str) -> dict:
    output_dir = root / "artifacts/arrival-sufficiency-v1"
    stable = {
        "schema_version": "arrival-data-sufficiency/v1",
        "status": "research_process_ready_not_publication_ready",
        "research_process_ready": True,
        "publication_ready": False,
        "corpus": {"content_sha256": benchmark["corpus_address"]},
        "corpus_manifest_sha256": file_sha256(benchmark["corpus"]),
        "metrics_sha256": file_sha256(benchmark["metrics"]),
    }
    content_address = json_sha256(stable)
    report = {
        **stable,
        "generated_at": "2026-07-12T00:00:00+00:00",
        "report_content_sha256": content_address,
        "producer": _producer(root, commit, ["modeling/arrival_validation.py"]),
    }
    report["report_manifest_sha256"] = json_sha256(report)
    report_path = output_dir / "report.json"
    _write_json(report_path, report)
    report_archive = output_dir / "reports" / f"{report['report_manifest_sha256']}.json"
    report_archive.parent.mkdir(parents=True)
    report_archive.write_bytes(report_path.read_bytes())
    content_path = output_dir / "content" / f"{content_address}.json"
    _write_json(content_path, stable)
    return {"report": report_path, "report_archive": report_archive, "content": content_path}


def _fixture(root: Path, *, corpus_season: int = 2019, sufficiency: bool = False) -> dict:
    benchmark_commit = _initialize_repository(root)
    benchmark = _benchmark_fixture(root, benchmark_commit, corpus_season=corpus_season)
    evaluator_commit, protocol = _commit_evaluator(root, benchmark)
    calibration = _calibration_fixture(root, benchmark, evaluator_commit)
    result = {"benchmark": benchmark, "protocol": protocol, "calibration": calibration}
    if sufficiency:
        result["sufficiency"] = _sufficiency_fixture(root, benchmark, evaluator_commit)
    return result


def _create(fixture: dict, output: Path, *, root: Path) -> dict:
    sufficiency = fixture.get("sufficiency")
    return create_holdout_lock(
        fixture["benchmark"]["metrics"],
        fixture["protocol"],
        fixture["calibration"]["manifest"],
        output,
        sufficiency_report_path=sufficiency["report"] if sufficiency else None,
        root=root,
    )


def test_create_lock_binds_protocol_calibration_comparator_and_evaluator(
    tmp_path: Path,
) -> None:
    fixture = _fixture(tmp_path, sufficiency=True)
    output = tmp_path / "data/evaluation/arrival-holdout.json"

    lock = _create(fixture, output, root=tmp_path)

    assert lock["status"] == STUDY_STATUS
    assert lock["evaluation"]["schema_version"] == "arrival-validation-protocol/v2"
    inference = lock["evaluation"]["inference"]
    assert inference["bootstrap_repetitions"] == BOOTSTRAP_REPETITIONS
    assert inference["bootstrap_repetitions"] >= MIN_BOOTSTRAP_REPETITIONS
    assert inference["bootstrap_seed"] == 29
    assert inference["same_draw_for_candidate_and_all_baselines"] is True
    assert lock["calibration"]["calibrator"]["horizons_months"] == list(
        SURVIVAL_HORIZON_MONTHS
    )
    assert lock["calibration"]["censoring_aware_comparator"]["schema_version"] == (
        HAZARD_BASELINE_SCHEMA_VERSION
    )
    assert lock["frozen_application"]["entrypoint"] == (
        "modeling.arrival_external.build_external_prediction_rows"
    )
    assert lock["frozen_application"]["calibrator"]["refit"] is False
    assert lock["frozen_application"]["primary_comparator"]["refit"] is False
    integrity = lock["admission_failure_policy"]["integrity"]
    distribution = lock["admission_failure_policy"]["distribution_shift"]
    assert "block_scoring" in integrity["failure_action"]
    assert distribution["test_suppression"] is False
    assert "score_and_publish" in distribution["failure_action"]
    assert "promotion_ineligible" in distribution["failure_action"]
    assert lock["sufficiency"]["research_process_ready"] is True
    assert set(lock["evaluator"]["files"]) == set(EVALUATOR_PRODUCER_PATHS)
    canonical = dict(lock)
    canonical.pop("lock_sha256")
    assert json_sha256(canonical) == lock["lock_sha256"]
    archive = content_addressed_lock_path(output, lock["lock_sha256"])
    assert archive.read_bytes() == output.read_bytes()
    assert verify_holdout_lock(output, root=tmp_path) == lock


def test_evaluation_protocol_does_not_suppress_distribution_shift_test() -> None:
    actions = evaluation_protocol()["admission_gates"]["failure_actions"]
    assert "block_scoring" in actions["integrity_failure"]
    assert "score_and_publish" in actions["distribution_shift_failure"]
    assert "promotion_ineligible" in actions["distribution_shift_failure"]


def test_verification_uses_archives_and_git_not_mutable_live_aliases(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path, sufficiency=True)
    output = tmp_path / "holdout.json"
    lock = _create(fixture, output, root=tmp_path)

    for path in (
        fixture["benchmark"]["metrics"],
        fixture["benchmark"]["corpus"],
        fixture["benchmark"]["model"],
        fixture["benchmark"]["snapshots"],
        fixture["benchmark"]["labels"],
        fixture["calibration"]["manifest"],
        fixture["calibration"]["calibrator"],
        fixture["calibration"]["baseline"],
        fixture["calibration"]["oof"],
        fixture["sufficiency"]["report"],
        fixture["protocol"],
        tmp_path / "modeling/arrival_external.py",
        tmp_path / "modeling/arrival_validation.py",
    ):
        path.write_bytes(b"mutable live alias overwritten after lock\n")

    assert verify_holdout_lock(output, root=tmp_path) == lock


def test_creation_uses_historical_producer_git_objects_not_current_worktree(
    tmp_path: Path,
) -> None:
    fixture = _fixture(tmp_path, sufficiency=True)
    (tmp_path / "modeling/benchmark_producer.py").write_text("# evolved after benchmark\n")
    (tmp_path / "modeling/corpus_producer.py").write_text("# evolved after corpus\n")

    lock = _create(fixture, tmp_path / "holdout.json", root=tmp_path)

    assert lock["benchmark"]["producer"]["git_commit"] == fixture["benchmark"][
        "producer_commit"
    ]


def test_verification_fails_when_content_addressed_model_changes(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    output = tmp_path / "holdout.json"
    _create(fixture, output, root=tmp_path)
    fixture["benchmark"]["model_archive"].write_bytes(b"tampered archived model\n")

    with pytest.raises(ArrivalHoldoutError, match="benchmark model hash differs"):
        verify_holdout_lock(output, root=tmp_path)


def test_verification_fails_when_frozen_calibrator_changes(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    output = tmp_path / "holdout.json"
    _create(fixture, output, root=tmp_path)
    fixture["calibration"]["calibrator_archive"].write_bytes(b"{}")

    with pytest.raises(ArrivalHoldoutError, match="Calibration model archive hash differs"):
        verify_holdout_lock(output, root=tmp_path)


def test_create_is_idempotent_but_refuses_nonidentical_overwrite(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    output = tmp_path / "holdout.json"
    first = _create(fixture, output, root=tmp_path)
    first_bytes = output.read_bytes()

    assert _create(fixture, output, root=tmp_path) == first
    assert output.read_bytes() == first_bytes
    output.write_text('{"changed":true}\n')
    with pytest.raises(ArrivalHoldoutError, match="Refusing to overwrite non-identical"):
        _create(fixture, output, root=tmp_path)


def test_creation_rejects_corpus_containing_evaluation_cohort(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path, corpus_season=2021)
    with pytest.raises(ArrivalHoldoutError, match="evaluation cohort"):
        _create(fixture, tmp_path / "holdout.json", root=tmp_path)


def test_creation_refuses_when_evaluation_ingestion_has_started(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    (tmp_path / "data/raw/baseball-reference-register/2021").mkdir(parents=True)
    with pytest.raises(ArrivalHoldoutError, match="ingestion appears to have started"):
        _create(fixture, tmp_path / "holdout.json", root=tmp_path)


def test_creation_rejects_protocol_or_evaluator_worktree_drift(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    fixture["protocol"].write_text("{}\n")
    with pytest.raises(ArrivalHoldoutError, match="Evaluator file is not identical"):
        _create(fixture, tmp_path / "holdout.json", root=tmp_path)


def test_creation_rejects_calibration_linked_to_different_model(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    manifest_path = fixture["calibration"]["manifest"]
    manifest = json.loads(manifest_path.read_text())
    manifest["inputs"]["frozen_model_artifact_sha256"] = "f" * 64
    manifest["manifest_sha256"] = json_sha256(
        {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    )
    _write_json(manifest_path, manifest)
    archive = manifest_path.parent / "manifests" / f"{manifest['manifest_sha256']}.json"
    archive.write_bytes(manifest_path.read_bytes())
    with pytest.raises(ArrivalHoldoutError, match="Calibration input differs"):
        _create(fixture, tmp_path / "holdout.json", root=tmp_path)
