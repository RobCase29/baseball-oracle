from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from modeling.arrival_calibration import (
    ArrivalCalibrationModel,
    HorizonCalibrator,
)
from modeling.arrival_external import (
    ArrivalExternalError,
    attach_predeclared_outcomes,
    audit_external_admission,
    build_external_prediction_rows,
    frozen_evaluation_schedule,
)
from modeling.arrival_hazard_baseline import fit_hazard_baseline


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
