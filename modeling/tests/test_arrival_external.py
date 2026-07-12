from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from modeling.arrival_calibration import (
    ArrivalCalibrationModel,
    HorizonCalibrator,
)
from modeling.arrival_external import (
    AMENDED_ARTIFACT_DIR,
    AMENDED_EXTERNAL_CORPUS_PATH,
    AMENDED_LOCK_PATH,
    AMENDED_LOCK_SCHEMA_VERSION,
    EXTERNAL_RUNTIME_PRODUCER_PATHS,
    ArrivalExternalError,
    _assert_probability_vectors,
    _require_amended_prediction_manifest_evidence,
    attach_predeclared_outcomes,
    audit_external_admission,
    build_external_prediction_rows,
    frozen_evaluation_schedule,
    run_external_evaluation,
    run_external_prediction,
)
from modeling.arrival_hazard_baseline import fit_hazard_baseline
from modeling.provenance import file_sha256


def _snapshots() -> pd.DataFrame:
    rows = []
    for season in range(2021, 2026):
        for role in ("hitter", "pitcher"):
            rows.append(
                {
                    "snapshot_id": f"{season}-{role}",
                    "player_id": f"player-{season}-{role}",
                    "edition": season,
                    "as_of": f"{season}-12-31",
                    "role": role,
                    "prior_level": "AAA",
                    "age": 23,
                    "model_eligible": True,
                    "effective_time_safe": True,
                    "model_exclusion_reasons": "",
                }
            )
    return pd.DataFrame(rows)


def _calibrator() -> ArrivalCalibrationModel:
    fits = []
    for horizon in (12, 24, 36, 48, 60):
        fits.append(
            HorizonCalibrator(
                horizon_months=horizon,
                alpha=0.0,
                beta=1.0,
                gamma=0.0,
                training_rows=20,
                training_events=4,
                training_weight=20.0,
                returning_rows=10,
                returning_events=2,
                cold_start_rows=10,
                cold_start_events=2,
            )
        )
    return ArrivalCalibrationModel(
        horizons_months=(12, 24, 36, 48, 60), calibrators=tuple(fits)
    )


def _calibrator_with_preprojection_drop() -> ArrivalCalibrationModel:
    fits = []
    for horizon, probability in zip(
        (12, 24, 36, 48, 60),
        (0.8, 0.2, 0.7, 0.8, 0.9),
        strict=True,
    ):
        fits.append(
            HorizonCalibrator(
                horizon_months=horizon,
                alpha=float(np.log(probability / (1.0 - probability))),
                beta=0.0,
                gamma=0.0,
                training_rows=20,
                training_events=4,
                training_weight=20.0,
                returning_rows=10,
                returning_events=2,
                cold_start_rows=10,
                cold_start_events=2,
            )
        )
    return ArrivalCalibrationModel(
        horizons_months=(12, 24, 36, 48, 60), calibrators=tuple(fits)
    )


def _comparator():
    rows = []
    for interval in range(1, 6):
        for role in ("hitter", "pitcher"):
            for index in range(4):
                rows.append(
                    {
                        "snapshot_id": f"{role}-{index}",
                        "role": role,
                        "prior_level": "AAA",
                        "age": 23,
                        "interval": interval,
                        "event": int(index == 0 and interval == 5),
                        "sample_weight": 1.0,
                    }
                )
    return fit_hazard_baseline(pd.DataFrame(rows))


def _models():
    return {
        role: {"max_training_interval": 5}
        for role in ("hitter", "pitcher")
    }


def _admission_models():
    return {
        role: {
            "max_training_interval": 5,
            "numeric_features": ["age"],
            "categorical_features": ["prior_level"],
        }
        for role in ("hitter", "pitcher")
    }


def _external_manifest() -> dict:
    return {
        "inputs": [
            {
                "season": season,
                "dataset_manifest_sha256": "a" * 64,
                "dataset_manifest_content_address": "b" * 64,
                "dataset_content_sha256": "c" * 64,
                "archive": {
                    "archive_lock_sha256": "d" * 64,
                    "source_run_manifest_sha256": "e" * 64,
                    "raw_archive_manifest_sha256": "f" * 64,
                    "coverage": {
                        "declaredTeams": 2,
                        "completedTeams": 2,
                        "failedTeams": 0,
                    },
                    "source_adapter_coverage": {
                        "declared_team_pages": 2,
                        "observed_team_pages": 2,
                        "appearance_data_team_pages": 2,
                        "declared_no_record_team_pages": 0,
                    },
                },
            }
            for season in range(2021, 2026)
        ]
    }


def _labels(snapshots: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for row in snapshots.itertuples(index=False):
        label = {
            "snapshot_id": row.snapshot_id,
            "player_id": row.player_id,
            "data_cutoff": "2025-12-31",
        }
        for horizon in (12, 24, 36, 48, 60):
            label[f"observed_{horizon}m"] = row.edition + horizon // 12 <= 2025
            label[f"debut_within_{horizon}m"] = int(
                row.role == "hitter" and horizon >= 24
            )
        rows.append(label)
    return pd.DataFrame(rows)


def _probability_rows() -> pd.DataFrame:
    horizons = (12, 24, 36, 48, 60)
    rows = pd.DataFrame(
        {
            "snapshot_id": ["snapshot"] * len(horizons),
            "horizon_months": horizons,
        }
    )
    values = np.linspace(0.1, 0.5, len(horizons))
    for column in (
        "raw_candidate_probability",
        "calibrated_probability_unprojected",
        "candidate_probability",
        "hierarchical_baseline_probability",
        "global_baseline_probability",
    ):
        rows[column] = values
    return rows


BOUNDED_PROBABILITY_COLUMNS = (
    "raw_candidate_probability",
    "calibrated_probability_unprojected",
    "candidate_probability",
    "hierarchical_baseline_probability",
    "global_baseline_probability",
)
CUMULATIVE_PROBABILITY_COLUMNS = (
    "raw_candidate_probability",
    "candidate_probability",
    "hierarchical_baseline_probability",
    "global_baseline_probability",
)


def test_builds_complete_frozen_predictions_before_outcome_join(monkeypatch) -> None:
    snapshots = _snapshots()

    def fake_candidate(models, frame):
        assert set(models) == {"hitter", "pitcher"}
        return {
            horizon: np.full(len(frame), horizon / 120.0)
            for horizon in (12, 24, 36, 48, 60)
        }

    monkeypatch.setattr(
        "modeling.arrival_external.cumulative_predictions", fake_candidate
    )
    rows = build_external_prediction_rows(
        snapshots,
        ["player-2021-hitter"],
        _models(),
        _calibrator(),
        _comparator(),
    )

    assert len(rows) == len(snapshots) * 5
    assert not rows.duplicated(["snapshot_id", "horizon_months"]).any()
    assert rows.groupby("snapshot_id")["horizon_months"].apply(tuple).map(
        lambda value: value == (12, 24, 36, 48, 60)
    ).all()
    assert rows.loc[rows["edition"].eq(2025), "score_outcome"].eq(False).all()
    assert rows.loc[rows["edition"].eq(2021), "score_outcome"].sum() == 8
    returning = rows[rows["player_id"].eq("player-2021-hitter")]
    assert returning["cold_start"].eq(0).all()
    assert rows.loc[~rows.index.isin(returning.index), "cold_start"].eq(1).all()


def test_build_allows_preprojection_drop_and_returns_monotone_candidate(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "modeling.arrival_external.cumulative_predictions",
        lambda models, frame: {
            horizon: np.full(len(frame), horizon / 120.0)
            for horizon in (12, 24, 36, 48, 60)
        },
    )

    rows = build_external_prediction_rows(
        _snapshots(),
        ["training-player"],
        _models(),
        _calibrator_with_preprojection_drop(),
        _comparator(),
    )

    for _, group in rows.groupby("snapshot_id"):
        ordered = group.sort_values("horizon_months")
        assert (
            np.diff(ordered["calibrated_probability_unprojected"].to_numpy()) < 0.0
        ).any()
        assert (
            np.diff(ordered["candidate_probability"].to_numpy()) >= 0.0
        ).all()


@pytest.mark.parametrize("column", CUMULATIVE_PROBABILITY_COLUMNS)
def test_probability_validator_rejects_drop_in_cumulative_column(column) -> None:
    rows = _probability_rows()
    rows.loc[rows["horizon_months"].eq(24), column] = 0.05

    with pytest.raises(ArrivalExternalError, match=f"{column} is not cumulative-monotone"):
        _assert_probability_vectors(
            rows,
            BOUNDED_PROBABILITY_COLUMNS,
            CUMULATIVE_PROBABILITY_COLUMNS,
        )


@pytest.mark.parametrize("value", [np.nan, -0.01, 1.01])
def test_probability_validator_rejects_invalid_unprojected_value(value) -> None:
    rows = _probability_rows()
    rows.loc[0, "calibrated_probability_unprojected"] = value

    with pytest.raises(
        ArrivalExternalError,
        match="calibrated_probability_unprojected values are outside",
    ):
        _assert_probability_vectors(
            rows,
            BOUNDED_PROBABILITY_COLUMNS,
            CUMULATIVE_PROBABILITY_COLUMNS,
        )


def test_schedule_and_snapshot_landmarks_fail_closed(monkeypatch) -> None:
    monkeypatch.setattr(
        "modeling.arrival_external.cumulative_predictions",
        lambda models, frame: {
            horizon: np.full(len(frame), 0.1) for horizon in (12, 24, 36, 48, 60)
        },
    )
    changed = frozen_evaluation_schedule()
    changed[0]["horizons_months"] = [12]
    with pytest.raises(ArrivalExternalError, match="schedule differs"):
        build_external_prediction_rows(
            _snapshots(), ["training-player"], _models(), _calibrator(), _comparator(), changed
        )

    snapshots = _snapshots()
    snapshots.loc[0, "as_of"] = "2021-11-30"
    with pytest.raises(ArrivalExternalError, match="landmarks differ"):
        build_external_prediction_rows(
            snapshots, ["training-player"], _models(), _calibrator(), _comparator()
        )


def test_outcome_join_exposes_only_predeclared_mature_cells(monkeypatch) -> None:
    monkeypatch.setattr(
        "modeling.arrival_external.cumulative_predictions",
        lambda models, frame: {
            horizon: np.full(len(frame), horizon / 120.0)
            for horizon in (12, 24, 36, 48, 60)
        },
    )
    snapshots = _snapshots()
    predictions = build_external_prediction_rows(
        snapshots, ["training-player"], _models(), _calibrator(), _comparator()
    )
    joined = attach_predeclared_outcomes(predictions, _labels(snapshots))

    assert joined["outcome_observed"].sum() == 20
    assert joined.loc[joined["score_outcome"], "outcome"].notna().all()
    assert joined.loc[~joined["score_outcome"], "outcome"].isna().all()
    assert joined.loc[joined["edition"].eq(2025), "outcome"].isna().all()


def test_outcome_join_rejects_immature_predeclared_cell(monkeypatch) -> None:
    monkeypatch.setattr(
        "modeling.arrival_external.cumulative_predictions",
        lambda models, frame: {
            horizon: np.full(len(frame), 0.1) for horizon in (12, 24, 36, 48, 60)
        },
    )
    snapshots = _snapshots()
    predictions = build_external_prediction_rows(
        snapshots, ["training-player"], _models(), _calibrator(), _comparator()
    )
    labels = _labels(snapshots)
    labels.loc[labels["snapshot_id"].eq("2021-hitter"), "observed_48m"] = False
    with pytest.raises(ArrivalExternalError, match="not fully mature"):
        attach_predeclared_outcomes(predictions, labels)


def test_admission_gates_use_training_reference_without_outcomes() -> None:
    external = _snapshots()
    external["identity_resolved"] = True
    training = pd.concat(
        [
            external.assign(
                snapshot_id=lambda frame: "training-" + frame["snapshot_id"],
                edition=2019,
            )
        ],
        ignore_index=True,
    )
    report = audit_external_admission(
        external, training, _admission_models(), _external_manifest()
    )

    assert report["status"] == "admission_pass"
    assert report["prediction_allowed"] is True
    assert report["outcomes_read"] is False
    assert not report["failed_gates"]


def test_admission_quarantines_integrity_failure_but_still_reports_shift() -> None:
    external = _snapshots()
    external["prior_level"] = "NEW"
    training = external.copy()
    training["prior_level"] = "AAA"
    manifest = _external_manifest()
    manifest["inputs"][0]["archive"]["coverage"]["failedTeams"] = 1

    report = audit_external_admission(
        external, training, _admission_models(), manifest
    )

    assert report["status"] == "integrity_fail_quarantine"
    assert report["prediction_allowed"] is False
    assert "all_team_pages_reconciled" in report["failed_gates"]
    assert "maximum_unseen_categorical_fraction" in report["failed_gates"]


def test_distribution_shift_is_scored_but_cannot_pass_promotion() -> None:
    external = _snapshots()
    external["prior_level"] = "NEW"
    training = external.copy()
    training["prior_level"] = "AAA"

    report = audit_external_admission(
        external, training, _admission_models(), _external_manifest()
    )

    assert report["status"] == "admission_pass_distribution_shift_promotion_blocked"
    assert report["prediction_allowed"] is True
    assert report["score_allowed"] is True
    assert report["promotion_eligible"] is False
    assert report["integrity_failures"] == []
    assert report["distribution_shift_failures"] == [
        "maximum_unseen_categorical_fraction"
    ]


class _ReachedBoundExecution(RuntimeError):
    pass


def _amended_runtime_fixture(
    root: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[dict, dict, Path, Path, Path]:
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(
        ["git", "config", "user.name", "Runtime Test"], cwd=root, check=True
    )
    subprocess.run(
        ["git", "config", "user.email", "runtime@example.test"],
        cwd=root,
        check=True,
    )
    for relative in EXTERNAL_RUNTIME_PRODUCER_PATHS:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# runtime file: {relative}\n")
    subprocess.run(["git", "add", "modeling"], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "freeze amended evaluator"],
        cwd=root,
        check=True,
    )
    evaluator_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip()
    evaluator_files = {
        relative: file_sha256(root / relative)
        for relative in EXTERNAL_RUNTIME_PRODUCER_PATHS
    }
    lock = {
        "schema_version": AMENDED_LOCK_SCHEMA_VERSION,
        "lock_sha256": "1" * 64,
        "evaluator": {"git_commit": evaluator_commit, "files": evaluator_files},
        "amendment": {"output_artifact_dir": AMENDED_ARTIFACT_DIR},
        "failed_attempt": {
            "external_corpus": {
                "manifest_path": AMENDED_EXTERNAL_CORPUS_PATH,
                "manifest_sha256": "2" * 64,
                "corpus_content_sha256": "3" * 64,
            }
        },
    }
    lock_path = root / AMENDED_LOCK_PATH
    corpus_path = root / AMENDED_EXTERNAL_CORPUS_PATH
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    corpus_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text("{}\n")
    corpus_path.write_text("{}\n")
    subprocess.run(["git", "add", "data"], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "publish amended lock"],
        cwd=root,
        check=True,
    )
    run_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip()
    producer = {
        "files": evaluator_files,
        "git": {
            "commit": run_commit,
            "dirty": False,
            "status_sha256": (
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            ),
        },
    }
    monkeypatch.setattr(
        "modeling.arrival_holdout.verify_holdout_lock",
        lambda path, *, root: lock,
    )
    return lock, producer, lock_path, corpus_path, root / AMENDED_ARTIFACT_DIR


def test_direct_amended_predict_binds_runtime_paths_hashes_and_live_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    lock, producer, lock_path, corpus_path, artifact_dir = _amended_runtime_fixture(
        tmp_path, monkeypatch
    )
    external_manifest = {
        "manifest_sha256": lock["failed_attempt"]["external_corpus"][
            "manifest_sha256"
        ],
        "corpus_content_sha256": lock["failed_attempt"]["external_corpus"][
            "corpus_content_sha256"
        ],
    }
    monkeypatch.setattr(
        "modeling.arrival_external.load_external_corpus_features",
        lambda path, *, root: (_snapshots(), external_manifest),
    )
    monkeypatch.setattr(
        "modeling.arrival_external._load_frozen_components",
        lambda *args, **kwargs: (_ for _ in ()).throw(_ReachedBoundExecution()),
    )

    with pytest.raises(_ReachedBoundExecution):
        run_external_prediction(
            lock_path,
            corpus_path,
            artifact_dir,
            root=tmp_path,
            producer_override=producer,
        )


def test_direct_amended_predict_rejects_runtime_drift_without_npm_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, producer, lock_path, corpus_path, artifact_dir = _amended_runtime_fixture(
        tmp_path, monkeypatch
    )
    (tmp_path / "modeling/risk_set.py").write_text("# drift\n")

    with pytest.raises(ArrivalExternalError, match="live bytes differ"):
        run_external_prediction(
            lock_path,
            corpus_path,
            artifact_dir,
            root=tmp_path,
            producer_override=producer,
        )


def test_direct_amended_predict_rejects_external_corpus_hash_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, producer, lock_path, corpus_path, artifact_dir = _amended_runtime_fixture(
        tmp_path, monkeypatch
    )
    monkeypatch.setattr(
        "modeling.arrival_external.load_external_corpus_features",
        lambda path, *, root: (
            _snapshots(),
            {"manifest_sha256": "f" * 64, "corpus_content_sha256": "e" * 64},
        ),
    )

    with pytest.raises(ArrivalExternalError, match="corpus hashes differ"):
        run_external_prediction(
            lock_path,
            corpus_path,
            artifact_dir,
            root=tmp_path,
            producer_override=producer,
        )


def test_direct_amended_predict_rejects_alternate_or_symlinked_corpus(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, producer, lock_path, corpus_path, artifact_dir = _amended_runtime_fixture(
        tmp_path, monkeypatch
    )
    alternate = tmp_path / "data/processed/arrival-external-v1/alternate.json"
    alternate.write_text("{}\n")
    with pytest.raises(ArrivalExternalError, match="canonical alias"):
        run_external_prediction(
            lock_path,
            alternate,
            artifact_dir,
            root=tmp_path,
            producer_override=producer,
        )

    target = corpus_path.with_name("target.json")
    target.write_text(corpus_path.read_text())
    corpus_path.unlink()
    corpus_path.symlink_to(target)
    with pytest.raises(ArrivalExternalError, match="traverses a symlink"):
        run_external_prediction(
            lock_path,
            corpus_path,
            artifact_dir,
            root=tmp_path,
            producer_override=producer,
        )


def test_direct_amended_evaluate_enforces_runtime_before_outcome_decode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, producer, lock_path, corpus_path, artifact_dir = _amended_runtime_fixture(
        tmp_path, monkeypatch
    )
    prediction_manifest = artifact_dir / "prediction_manifest.json"
    monkeypatch.setattr(
        "modeling.arrival_external.load_verified_external_predictions",
        lambda *args, **kwargs: (_ for _ in ()).throw(_ReachedBoundExecution()),
    )
    with pytest.raises(_ReachedBoundExecution):
        run_external_evaluation(
            lock_path,
            corpus_path,
            prediction_manifest,
            artifact_dir,
            root=tmp_path,
            producer_override=producer,
        )
    with pytest.raises(ArrivalExternalError, match="canonical alias"):
        run_external_evaluation(
            lock_path,
            corpus_path,
            prediction_manifest,
            tmp_path / "artifacts/alternate",
            root=tmp_path,
            producer_override=producer,
        )


def test_amended_prediction_manifest_rejects_alternate_embedded_paths() -> None:
    lock = {"schema_version": AMENDED_LOCK_SCHEMA_VERSION}
    manifest = {
        "lock": {"path": AMENDED_LOCK_PATH},
        "external_corpus": {"manifest_path": AMENDED_EXTERNAL_CORPUS_PATH},
        "admission": {
            "path": f"{AMENDED_ARTIFACT_DIR}/admission.json",
            "content_addressed_path": f"{AMENDED_ARTIFACT_DIR}/admissions/a.json",
            "admission_sha256": "a",
        },
        "output": {
            "path": f"{AMENDED_ARTIFACT_DIR}/predictions.parquet",
            "content_addressed_path": f"{AMENDED_ARTIFACT_DIR}/predictions/b.parquet",
            "sha256": "b",
        },
    }
    _require_amended_prediction_manifest_evidence(manifest, lock)
    manifest["lock"]["path"] = "data/model-locks/alternate.json"
    with pytest.raises(ArrivalExternalError, match="aliases differ"):
        _require_amended_prediction_manifest_evidence(manifest, lock)
