from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from modeling.milb_impact_tournament import (
    BASELINE_MODEL_NAME,
    CATEGORICAL_FEATURES,
    MODEL_NAMES,
    NUMERIC_FEATURES,
    PRIMARY_TARGET_COLUMN,
    AgeLevelRolePerformancePrior,
    MilbImpactTournamentError,
    evaluate_oof_predictions,
    make_expanding_origin_folds,
    player_equal_weights,
    prepare_labeled_panel,
)


def _feature_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {column: 0.0 for column in NUMERIC_FEATURES}
    row.update({column: "missing" for column in CATEGORICAL_FEATURES})
    row.update(
        {
            "role": "hitter",
            "position": "OF",
            "prior_level": "AA",
            "last_observed_level": "AA",
            "bats": "R",
            "throws": "R",
            "pooled_stats_across_levels": "False",
            "pooled_stats_across_organizations": "False",
            "role_inference_basis": "hitter",
            "age": 22.0,
            "prior_bb_rate": 0.10,
            "prior_k_rate": 0.20,
            "prior_iso": 0.12,
        }
    )
    row.update(overrides)
    return row


def test_prepare_panel_filters_unsafe_rows_and_requires_complete_target_coverage() -> None:
    snapshots = pd.DataFrame(
        [
            {
                **_feature_row(),
                "snapshot_id": "safe",
                "player_id": "p1",
                "edition": 2015,
                "effective_time_safe": True,
                "identity_resolved": True,
                "model_eligible": True,
                "knowledge_time_verified": False,
            },
            {
                **_feature_row(),
                "snapshot_id": "unsafe",
                "player_id": "p2",
                "edition": 2015,
                "effective_time_safe": False,
                "identity_resolved": True,
                "model_eligible": True,
                "knowledge_time_verified": False,
            },
        ]
    )
    targets = pd.DataFrame(
        [
            {
                "snapshot_id": "safe",
                "player_id": "p1",
                "edition": 2015,
                "window_end_season": 2020,
                "target_mature": True,
                PRIMARY_TARGET_COLUMN: True,
            },
            {
                "snapshot_id": "unsafe",
                "player_id": "p2",
                "edition": 2015,
                "window_end_season": 2020,
                "target_mature": True,
                PRIMARY_TARGET_COLUMN: False,
            },
        ]
    )

    panel, audit = prepare_labeled_panel(snapshots, targets)

    assert panel["snapshot_id"].tolist() == ["safe"]
    assert audit["exclusions"]["effective_time_safe"] == 1
    assert audit["knowledgeTimeVerified"] is False

    with pytest.raises(MilbImpactTournamentError, match="identical one-to-one coverage"):
        prepare_labeled_panel(snapshots, targets.iloc[:1])


def test_expanding_origin_uses_only_available_labels_and_purges_validation_players() -> None:
    rows = []
    for edition in range(2010, 2017):
        for index in range(6):
            player = "repeat" if index == 0 and edition in {2010, 2015} else f"p-{edition}-{index}"
            rows.append(
                {
                    "player_id": player,
                    "edition": edition,
                    "window_end_season": edition + 5,
                    PRIMARY_TARGET_COLUMN: int(index == 1),
                }
            )
    panel = pd.DataFrame(rows)

    folds = make_expanding_origin_folds(
        panel,
        minimum_training_rows=5,
        minimum_training_events=1,
    )
    first = folds[0]
    train = panel.loc[list(first.train_index)]
    validation = panel.loc[list(first.validation_index)]

    assert first.validation_season == 2015
    assert train["window_end_season"].max() <= first.validation_season
    assert set(train["player_id"]).isdisjoint(validation["player_id"])
    assert first.purged_player_rows == 1
    assert first.purged_players == 1


def test_player_equal_weights_give_each_player_equal_total_mass() -> None:
    frame = pd.DataFrame(
        {"player_id": ["repeat", "repeat", "repeat", "single"]}
    )

    weights = player_equal_weights(frame)

    assert weights[:3].sum() == pytest.approx(weights[3])
    assert weights.mean() == pytest.approx(1.0)


def test_transparent_baseline_learns_fold_specific_performance_bands() -> None:
    rows = []
    target = []
    for index in range(240):
        strong = index >= 180
        rows.append(
            _feature_row(
                prior_iso=0.26 if strong else 0.05,
                prior_bb_rate=0.14 if strong else 0.05,
                prior_k_rate=0.14 if strong else 0.31,
            )
        )
        target.append(int(strong and index % 2 == 0))
    frame = pd.DataFrame(rows)
    model = AgeLevelRolePerformancePrior(smoothing=10.0).fit(
        frame, target, sample_weight=np.ones(len(frame))
    )

    weak = pd.DataFrame([_feature_row(prior_iso=0.04, prior_bb_rate=0.04, prior_k_rate=0.34)])
    strong = pd.DataFrame([_feature_row(prior_iso=0.30, prior_bb_rate=0.16, prior_k_rate=0.12)])

    assert model.predict_proba(strong)[0, 1] > model.predict_proba(weak)[0, 1]
    assert set(model.performance_edges_) == {"hitter"}


def test_oof_evaluation_uses_equal_player_weights_and_paired_cluster_uncertainty() -> None:
    rows = []
    for player_index in range(80):
        repeats = 3 if player_index < 20 else 1
        event = int(player_index % 10 == 0)
        for repeat in range(repeats):
            rows.append(
                {
                    "player_id": f"p{player_index}",
                    "snapshot_id": f"p{player_index}-{repeat}",
                    PRIMARY_TARGET_COLUMN: event,
                    f"probability__{BASELINE_MODEL_NAME}": 0.10,
                    "probability__regularized_logistic": 0.70 if event else 0.02,
                    "probability__nonlinear": 0.65 if event else 0.03,
                    "probability__logit_blend": 0.675 if event else 0.025,
                }
            )
    predictions = pd.DataFrame(rows)

    result = evaluate_oof_predictions(
        predictions, bootstrap_repetitions=20, bootstrap_seed=7
    )

    assert result["selectedModel"] in set(MODEL_NAMES) - {BASELINE_MODEL_NAME}
    assert result["metrics"][BASELINE_MODEL_NAME]["weightedEventRate"] == pytest.approx(
        0.10
    )
    selected = result["selectedModel"]
    assert result["metrics"][selected]["topDecile"]["lift"] > 5.0
    assert result["bootstrap"]["playerClusters"] == 80
    assert result["bootstrap"]["pairedBrierImprovementVsBaseline95"][selected] is not None
