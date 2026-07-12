from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from modeling.arrival_hazard_baseline import fit_hazard_baseline
from modeling.provenance import file_sha256, json_sha256
from modeling.train_arrival_calibration import (
    CALIBRATION_EVALUATION_SEASONS,
    HAZARD_BASELINE_CONFIG,
    ArrivalCalibrationTrainingError,
    generate_oof_predictions,
    validate_frozen_benchmark,
)


def _population_rows() -> tuple[pd.DataFrame, pd.DataFrame]:
    snapshots: list[dict[str, object]] = []
    labels: list[dict[str, object]] = []
    for season in range(2010, 2020):
        as_of = pd.Timestamp(f"{season}-12-31")
        for role in ("hitter", "pitcher"):
            for player_id in (f"repeat-{role}", f"new-{season}-{role}"):
                snapshot_id = f"{season}-{player_id}"
                if player_id == "repeat-hitter":
                    debut = pd.Timestamp("2020-06-30")
                elif player_id.startswith("new-") and season % 2 == 0:
                    debut = as_of + pd.DateOffset(months=6)
                else:
                    debut = pd.NaT
                snapshot = {
                    "snapshot_id": snapshot_id,
                    "player_id": player_id,
                    "edition": season,
                    "as_of": as_of,
                    "role": role,
                    "prior_level": "AAA" if season % 2 else "AA",
                    "age": 20 + (season % 5),
                }
                label: dict[str, object] = {
                    "snapshot_id": snapshot_id,
                    "player_id": player_id,
                    "as_of": as_of,
                    "debut_date": debut,
                    "data_cutoff": pd.Timestamp("2025-12-31"),
                }
                for months in (12, 24, 36, 48, 60):
                    horizon_end = as_of + pd.DateOffset(months=months)
                    label[f"observed_{months}m"] = True
                    label[f"debut_within_{months}m"] = bool(
                        pd.notna(debut) and pd.Timestamp(debut) <= horizon_end
                    )
                snapshots.append(snapshot)
                labels.append(label)
    return pd.DataFrame(snapshots), pd.DataFrame(labels)


def _fake_models(max_interval: int = 5) -> dict[str, dict[str, object]]:
    return {
        role: {"max_training_interval": max_interval}
        for role in ("hitter", "pitcher")
    }


def test_oof_generation_is_chronological_complete_and_player_weighted(monkeypatch) -> None:
    snapshots, labels = _population_rows()
    fitted_periods: list[pd.DataFrame] = []

    def fake_fit(periods: pd.DataFrame):
        fitted_periods.append(periods.copy())
        return _fake_models()

    def fake_predict(models, test: pd.DataFrame):
        assert models == _fake_models()
        return {
            months: np.full(len(test), 0.05 + months / 100.0, dtype=float)
            for months in (12, 24, 36, 48, 60)
        }

    monkeypatch.setattr("modeling.train_arrival_calibration.fit_role_models", fake_fit)
    monkeypatch.setattr(
        "modeling.train_arrival_calibration.cumulative_predictions", fake_predict
    )

    rows, folds = generate_oof_predictions(snapshots, labels)

    assert [fold["test_season"] for fold in folds] == list(CALIBRATION_EVALUATION_SEASONS)
    assert len(fitted_periods) == 5
    assert len(rows) == 5 * 4 * 5
    assert rows["is_oof"].all()
    assert set(rows["horizon_months"]) == {12, 24, 36, 48, 60}
    assert not rows.duplicated(["snapshot_id", "horizon_months"]).any()
    assert all(fold["train_seasons"][-1] == fold["test_season"] - 1 for fold in folds)
    assert all(set(fold["role_max_training_intervals"].values()) == {5} for fold in folds)

    repeat = rows[rows["player_id"] == "repeat-hitter"]
    new = rows[rows["player_id"] == "new-2017-hitter"]
    assert repeat["sample_weight"].unique().tolist() == pytest.approx([0.2])
    assert new["sample_weight"].unique().tolist() == pytest.approx([1.0])
    assert not repeat["cold_start"].any()
    assert new["cold_start"].all()
    # The 2020 debut cannot become a training event in the first 2015-origin fit.
    assert fitted_periods[0].loc[
        fitted_periods[0]["player_id"] == "repeat-hitter", "event"
    ].sum() == 0


def test_oof_generation_fails_closed_on_post_2020_or_missing_interval_support(
    monkeypatch,
) -> None:
    snapshots, labels = _population_rows()

    with pytest.raises(ArrivalCalibrationTrainingError, match="2021 onward"):
        generate_oof_predictions(
            snapshots,
            labels,
            evaluation_seasons=(2017, 2018, 2019, 2020, 2021),
        )

    monkeypatch.setattr(
        "modeling.train_arrival_calibration.fit_role_models",
        lambda periods: _fake_models(max_interval=4),
    )
    with pytest.raises(ArrivalCalibrationTrainingError, match="lacks all five hazard intervals"):
        generate_oof_predictions(snapshots, labels)


def test_censoring_aware_hazard_baseline_is_hierarchical_and_content_addressed() -> None:
    rows: list[dict[str, object]] = []
    for interval in range(1, 6):
        for role in ("hitter", "pitcher"):
            for index in range(6):
                rows.append(
                    {
                        "player_id": f"{role}-{index}",
                        "snapshot_id": f"{role}-{index}",
                        "interval": interval,
                        "event": int(index == 0 and interval == 5),
                        "role": role,
                        "prior_level": "AAA" if index < 3 else "AA",
                        "age": 19 + index,
                    }
                )
    periods = pd.DataFrame(rows)
    periods["sample_weight"] = np.where(periods["role"] == "hitter", 0.5, 1.5)

    first = fit_hazard_baseline(periods)
    second = fit_hazard_baseline(periods.sample(frac=1, random_state=8))

    assert first.to_json() == second.to_json()
    assert HAZARD_BASELINE_CONFIG["weight_column"] == "sample_weight"
    portable = first.to_portable_dict()
    assert len(portable["intervals"]) == 5
    assert all(len(interval["role"]) == 2 for interval in portable["intervals"])
    assert json_sha256(portable) == json_sha256(second.to_portable_dict())


def _clean_producer() -> dict[str, object]:
    return {
        "git": {"commit": "fixture-commit", "dirty": False, "status_sha256": "0" * 64},
        "files": {"fixture": "1" * 64},
        "environment": {},
        "arguments": {},
    }


def test_frozen_benchmark_validation_binds_exact_corpus_config_and_model(tmp_path: Path) -> None:
    corpus = {
        "manifest_sha256": "a" * 64,
        "corpus_content_sha256": "b" * 64,
        "producer": _clean_producer(),
    }
    corpus_path = tmp_path / "corpus_manifest.json"
    corpus_path.write_text(json.dumps(corpus))
    model_body = b"frozen-model"
    seed_path = tmp_path / "seed.joblib"
    seed_path.write_bytes(model_body)
    model_hash = file_sha256(seed_path)
    model_path = tmp_path / "models" / f"{model_hash}.joblib"
    model_path.parent.mkdir()
    model_path.write_bytes(model_body)
    configuration = {"model": "frozen-hazard", "horizons": [12, 24, 36, 48, 60]}
    metrics = {
        "model_configuration": configuration,
        "model_configuration_sha256": json_sha256(configuration),
        "inputs": {
            "corpus_manifest_sha256": file_sha256(corpus_path),
            "corpus_manifest_content_address": corpus["manifest_sha256"],
            "corpus_content_sha256": corpus["corpus_content_sha256"],
        },
        "artifact": {
            "sha256": model_hash,
            "content_addressed_path": str(model_path.relative_to(tmp_path)),
        },
        "producer": _clean_producer(),
    }
    metrics["validation_report_sha256"] = json_sha256(metrics)
    metrics_path = tmp_path / "metrics.json"
    metrics_path.write_text(json.dumps(metrics))

    evidence = validate_frozen_benchmark(
        metrics_path, corpus_path, corpus, root=tmp_path
    )

    assert evidence["model_configuration_sha256"] == json_sha256(configuration)
    assert evidence["model_artifact_sha256"] == model_hash
    tampered = json.loads(metrics_path.read_text())
    tampered["model_configuration"]["model"] = "changed"
    tampered["validation_report_sha256"] = json_sha256(
        {key: value for key, value in tampered.items() if key != "validation_report_sha256"}
    )
    metrics_path.write_text(json.dumps(tampered))
    with pytest.raises(ArrivalCalibrationTrainingError, match="configuration hash differs"):
        validate_frozen_benchmark(metrics_path, corpus_path, corpus, root=tmp_path)
