from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from modeling.arrival_corpus import CORPUS_SCHEMA_VERSION
from modeling.contracts import SURVIVAL_HORIZON_MONTHS
from modeling.provenance import file_sha256, json_sha256
from modeling.train_arrival_population import (
    PopulationTrainingError,
    _mature_outcomes_at,
    build_person_period,
    cumulative_predictions,
    empirical_bayes_baseline,
    horizon_has_training_support,
    load_arrival_corpus,
    player_weights,
    release_gate_diagnostics,
    score_horizon,
)


class _ConstantHazardPipeline:
    def __init__(self, hazard: float) -> None:
        self.hazard = hazard

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        hazard = np.full(len(frame), self.hazard, dtype=float)
        return np.column_stack((1.0 - hazard, hazard))


def _write_corpus_fixture(root: Path) -> tuple[Path, dict]:
    snapshots_path = root / "archives/snapshots.parquet"
    labels_path = root / "archives/labels.parquet"
    snapshots_path.parent.mkdir(parents=True)
    pd.DataFrame(
        [
            {
                "snapshot_id": "snapshot-1",
                "player_id": "player-1",
                "edition": 2018,
                "as_of": pd.Timestamp("2018-12-31"),
                "role": "hitter",
            }
        ]
    ).to_parquet(snapshots_path, index=False)
    pd.DataFrame(
        [
            {
                "snapshot_id": "snapshot-1",
                "player_id": "player-1",
                "as_of": pd.Timestamp("2018-12-31"),
                "debut_date": pd.NaT,
                "data_cutoff": pd.Timestamp("2025-12-31"),
            }
        ]
    ).to_parquet(labels_path, index=False)

    outputs = {
        "snapshots": {
            "rows": 1,
            "sha256": file_sha256(snapshots_path),
            "content_addressed_path": str(snapshots_path),
        },
        "labels": {
            "rows": 1,
            "sha256": file_sha256(labels_path),
            "content_addressed_path": str(labels_path),
        },
    }
    inputs = [
        {
            "season": 2018,
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
    stable_content = {
        "schema_version": CORPUS_SCHEMA_VERSION,
        "data_cutoff": "2025-12-31",
        "snapshot_policy": "synthetic-effective-time-policy",
        "input_dataset_content_sha256": ["a" * 64],
        "raw_archive_manifest_sha256": ["b" * 64],
        "source_adapter_coverage": [
            {
                "season": 2018,
                "declared_team_pages": 1,
                "observed_team_pages": 1,
                "appearance_data_team_pages": 1,
                "declared_no_record_team_pages": 0,
            }
        ],
        "outputs": {
            name: {"rows": output["rows"], "sha256": output["sha256"]}
            for name, output in outputs.items()
        },
    }
    manifest = {
        "schema_version": CORPUS_SCHEMA_VERSION,
        "built_at": "2026-07-12T00:00:00-04:00",
        "data_cutoff": stable_content["data_cutoff"],
        "snapshot_policy": stable_content["snapshot_policy"],
        "inputs": inputs,
        "outputs": outputs,
        "corpus_content_sha256": json_sha256(stable_content),
    }
    manifest["manifest_sha256"] = json_sha256(manifest)
    body = json.dumps(manifest, indent=2) + "\n"
    manifest_path = root / "corpus_manifest.json"
    archived_manifest = root / "manifests" / f"{manifest['manifest_sha256']}.json"
    archived_manifest.parent.mkdir()
    manifest_path.write_text(body)
    archived_manifest.write_text(body)
    return manifest_path, manifest


def test_person_period_censors_events_unavailable_at_fold_cutoff() -> None:
    snapshots = pd.DataFrame(
        [
            {
                "snapshot_id": "snapshot-1",
                "player_id": "player-1",
                "edition": 2018,
                "as_of": pd.Timestamp("2018-12-31"),
                "role": "hitter",
            }
        ]
    )
    labels = pd.DataFrame(
        [
            {
                "snapshot_id": "snapshot-1",
                "player_id": "player-1",
                "as_of": pd.Timestamp("2018-12-31"),
                "debut_date": pd.Timestamp("2021-01-01"),
                "data_cutoff": pd.Timestamp("2025-12-31"),
            }
        ]
    )

    early = build_person_period(snapshots, labels, pd.Timestamp("2020-12-31"))
    mature = build_person_period(snapshots, labels, pd.Timestamp("2022-12-31"))
    row_limited_labels = labels.assign(data_cutoff=pd.Timestamp("2020-12-31"))
    row_limited = build_person_period(
        snapshots, row_limited_labels, pd.Timestamp("2025-12-31")
    )

    assert early["interval"].tolist() == [1, 2]
    assert early["event"].tolist() == [0, 0]
    assert row_limited[["interval", "event"]].to_dict("records") == early[
        ["interval", "event"]
    ].to_dict("records")
    assert mature["interval"].tolist() == [1, 2, 3]
    assert mature["event"].tolist() == [0, 0, 1]


def test_role_models_produce_monotone_cumulative_probabilities() -> None:
    snapshots = pd.DataFrame(
        [
            {"player_id": "hitter-1", "role": "hitter"},
            {"player_id": "pitcher-1", "role": "pitcher"},
        ]
    )
    models = {
        "hitter": {
            "pipeline": _ConstantHazardPipeline(0.20),
            "numeric_features": [],
            "categorical_features": [],
        },
        "pitcher": {
            "pipeline": _ConstantHazardPipeline(0.10),
            "numeric_features": [],
            "categorical_features": [],
        },
    }

    predictions = cumulative_predictions(models, snapshots)
    by_player = np.column_stack(
        [predictions[months] for months in SURVIVAL_HORIZON_MONTHS]
    )

    assert np.all(np.diff(by_player, axis=1) >= 0.0)
    assert np.all((by_player > 0.0) & (by_player < 1.0))
    np.testing.assert_allclose(
        by_player[0], [1.0 - 0.8**interval for interval in range(1, 6)]
    )
    np.testing.assert_allclose(
        by_player[1], [1.0 - 0.9**interval for interval in range(1, 6)]
    )


def test_horizons_require_interval_support_for_every_scored_role() -> None:
    models = {
        "hitter": {"max_training_interval": 2},
        "pitcher": {"max_training_interval": 1},
    }
    test = pd.DataFrame([{"role": "hitter"}, {"role": "pitcher"}])

    assert horizon_has_training_support(models, test, 1)
    assert not horizon_has_training_support(models, test, 2)


def test_survival_weights_preserve_intervals_and_balance_repeated_snapshots() -> None:
    periods = pd.DataFrame(
        [
            {"player_id": "repeat", "snapshot_id": "r1", "interval": interval}
            for interval in range(1, 4)
        ]
        + [
            {"player_id": "repeat", "snapshot_id": "r2", "interval": interval}
            for interval in range(1, 3)
        ]
        + [
            {"player_id": "single", "snapshot_id": "s1", "interval": interval}
            for interval in range(1, 3)
        ]
    )

    weights = player_weights(periods)

    assert len(set(weights[:5])) == 1
    assert len(set(weights[5:])) == 1
    assert weights[5] == pytest.approx(weights[0] * 2)


def test_binary_fold_metrics_require_a_fully_mature_horizon() -> None:
    joined = pd.DataFrame(
        [
            {
                "as_of": pd.Timestamp("2018-12-31"),
                "debut_date": pd.Timestamp("2019-06-01"),
            },
            {"as_of": pd.Timestamp("2018-12-31"), "debut_date": pd.NaT},
        ]
    )

    mature, event = _mature_outcomes_at(joined, 24, pd.Timestamp("2019-12-31"))

    assert mature.tolist() == [False, False]
    assert event.tolist() == [True, False]


def test_empirical_bayes_baseline_is_fold_fit_and_hierarchically_shrunk() -> None:
    training_rows = []
    for index in range(120):
        high_event = index < 60
        training_rows.append(
            {
                "role": "hitter",
                "prior_level": "AAA",
                "age": 22,
                "as_of": pd.Timestamp("2018-12-31"),
                "debut_date": (
                    pd.Timestamp("2019-06-01") if high_event else pd.NaT
                ),
            }
        )
        low_event = index < 6
        training_rows.append(
            {
                "role": "pitcher",
                "prior_level": "A",
                "age": 20,
                "as_of": pd.Timestamp("2018-12-31"),
                "debut_date": pd.Timestamp("2019-06-01") if low_event else pd.NaT,
            }
        )
    training = pd.DataFrame(training_rows)
    test = pd.DataFrame(
        [
            {"role": "hitter", "prior_level": "AAA", "age": 22},
            {"role": "pitcher", "prior_level": "A", "age": 20},
            {"role": "hitter", "prior_level": "unseen", "age": 30},
        ]
    )

    predictions, fit = empirical_bayes_baseline(
        training, test, 12, pd.Timestamp("2020-12-31")
    )
    unavailable, unavailable_fit = empirical_bayes_baseline(
        training, test, 24, pd.Timestamp("2019-12-30")
    )

    assert predictions is not None
    assert predictions[0] > predictions[2] > predictions[1]
    assert fit["status"] == "fit"
    assert unavailable is None
    assert unavailable_fit["status"] == "insufficient_mature_training_rows"


def test_scoring_and_player_cluster_bootstrap_are_deterministic() -> None:
    truth = pd.Series([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
    probability = np.array(
        [0.10, 0.85, 0.30, 0.65, 0.25, 0.80, 0.40, 0.60, 0.15, 0.90, 0.35, 0.70]
    )
    players = pd.Series(
        ["p1", "p1", "p2", "p2", "p3", "p3", "p4", "p4", "p5", "p5", "p6", "p6"]
    )

    first = score_horizon(
        truth,
        probability,
        players,
        training_base_rate=0.5,
        bootstrap_repetitions=50,
        bootstrap_seed=90210,
    )
    second = score_horizon(
        truth,
        probability,
        players,
        training_base_rate=0.5,
        bootstrap_repetitions=50,
        bootstrap_seed=90210,
    )

    assert first["n"] == 12
    assert first["events"] == 6
    assert first["brier"] == pytest.approx(
        np.mean((probability - truth.to_numpy()) ** 2)
    )
    assert first["base_rate_brier"] == pytest.approx(0.25)
    assert first["cluster_bootstrap"] == second["cluster_bootstrap"]
    assert first["cluster_bootstrap"]["repetitions"] == 50
    assert first["cluster_bootstrap"]["player_clusters"] == 6


def test_reliability_bins_do_not_split_tied_predictions_by_row_order() -> None:
    sorted_truth = pd.Series([0] * 50 + [1] * 50)
    alternating_truth = pd.Series([0, 1] * 50)
    probability = np.full(100, 0.5)
    players = pd.Series([f"p{index}" for index in range(100)])

    sorted_score = score_horizon(sorted_truth, probability, players)
    alternating_score = score_horizon(alternating_truth, probability, players)

    assert sorted_score["expected_calibration_error"] == 0.0
    assert sorted_score["expected_calibration_error"] == alternating_score[
        "expected_calibration_error"
    ]
    assert sorted_score["reliability_bins"] == alternating_score["reliability_bins"]


def test_scoring_handles_a_perfect_constant_baseline() -> None:
    result = score_horizon(
        pd.Series([0, 0, 0]),
        np.array([0.1, 0.2, 0.3]),
        pd.Series(["p1", "p2", "p3"]),
        training_base_rate=0.0,
    )

    assert result["base_rate_brier"] == 0.0
    assert result["brier_skill_score"] is None
    assert result["baseline_status"] == "perfect_constant_baseline_has_zero_brier"


def test_release_gates_include_horizons_without_a_stratified_comparator() -> None:
    gates = release_gate_diagnostics(
        [
            {
                "horizons": {
                    "12": {
                        "brier_skill_vs_empirical_bayes": 0.1,
                        "calibration_in_the_large": 0.01,
                        "calibration_slope": 1.0,
                    },
                    "60": {
                        "brier_skill_vs_empirical_bayes": None,
                        "calibration_in_the_large": 0.04,
                        "calibration_slope": 0.6,
                    },
                }
            }
        ]
    )

    assert gates["scored_fold_horizons"] == 2
    assert gates["empirical_bayes_comparable_fold_horizons"] == 1
    assert gates["positive_brier_skill_vs_empirical_bayes"]["fraction"] == 1.0
    assert gates["absolute_calibration_in_the_large_at_most_0_02"]["fraction"] == 0.5


def test_rejects_tampered_corpus_manifest(tmp_path: Path) -> None:
    manifest_path, manifest = _write_corpus_fixture(tmp_path)
    snapshots, labels, loaded_manifest = load_arrival_corpus(manifest_path)
    assert len(snapshots) == len(labels) == 1
    assert loaded_manifest["manifest_sha256"] == manifest["manifest_sha256"]

    manifest["snapshot_policy"] = "tampered-policy"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    with pytest.raises(
        PopulationTrainingError,
        match="Arrival corpus manifest content address is invalid",
    ):
        load_arrival_corpus(manifest_path)


def test_rejects_source_coverage_outside_corpus_content_address(
    tmp_path: Path,
) -> None:
    manifest_path, manifest = _write_corpus_fixture(tmp_path)
    manifest["inputs"][0]["archive"]["source_adapter_coverage"][
        "declared_no_record_team_pages"
    ] = 1
    manifest["manifest_sha256"] = json_sha256(
        {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    )
    body = json.dumps(manifest, indent=2) + "\n"
    manifest_path.write_text(body)
    archived_manifest = (
        tmp_path / "manifests" / f"{manifest['manifest_sha256']}.json"
    )
    archived_manifest.write_text(body)

    with pytest.raises(
        PopulationTrainingError,
        match="Arrival corpus stable content address is invalid",
    ):
        load_arrival_corpus(manifest_path)
