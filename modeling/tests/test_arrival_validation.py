from __future__ import annotations

import math

import pandas as pd
import pytest

from modeling.arrival_validation import (
    DEFAULT_BOOTSTRAP_REPETITIONS,
    DEFAULT_BOOTSTRAP_SEED,
    FIXED_RELIABILITY_EDGES,
    PROMOTION_GATE_CONFIG,
    ArrivalValidationError,
    adjudicate_promotion_gates,
    cumulative_horizon_violations,
    paired_player_cluster_bootstrap,
    pooled_horizon_diagnostics,
    pooled_role_horizon_diagnostics,
    pooled_role_horizon_sufficiency,
    prior_level_subgroup_diagnostics,
    validate_evaluation_rows,
)


BASELINES = {
    "empirical_bayes": "empirical_bayes_probability",
    "global_hazard": "global_hazard_probability",
}


def _rows() -> pd.DataFrame:
    values: list[dict] = []
    outcomes = {
        12: [0, 0, 1, 1],
        24: [0, 1, 1, 1],
    }
    probabilities = {
        12: [0.1, 0.2, 0.8, 0.9],
        24: [0.2, 0.6, 0.7, 0.9],
    }
    for player_index in range(4):
        for horizon in (12, 24):
            probability = probabilities[horizon][player_index]
            values.append(
                {
                    "snapshot_id": f"snapshot-{player_index}",
                    "player_id": f"player-{player_index}",
                    "role": "hitter" if player_index < 2 else "pitcher",
                    "cold_start": player_index % 2,
                    "horizon_months": horizon,
                    "outcome": outcomes[horizon][player_index],
                    "outcome_observed": 1,
                    "candidate__outcome_observed": 1,
                    "candidate_probability": probability,
                    "empirical_bayes_probability": probability,
                    "global_hazard_probability": min(0.95, probability + 0.03),
                }
            )
    return pd.DataFrame(values)


def test_validation_normalizes_without_mutating_input() -> None:
    rows = _rows()
    rows["horizon_months"] = rows["horizon_months"].astype(str)
    original = rows.copy(deep=True)

    validated = validate_evaluation_rows(rows, BASELINES)

    pd.testing.assert_frame_equal(rows, original)
    assert validated["horizon_months"].dtype.kind in "iu"
    sort_columns = ["horizon_months", "role", "snapshot_id"]
    assert list(validated[sort_columns].itertuples(index=False)) == sorted(
        validated[sort_columns].itertuples(index=False)
    )


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda frame: pd.concat([frame, frame.iloc[[0]]], ignore_index=True), "Duplicate"),
        (
            lambda frame: frame.assign(
                candidate_probability=frame["candidate_probability"].mask(
                    frame.index == 0, math.inf
                )
            ),
            "nonfinite",
        ),
        (
            lambda frame: frame.assign(
                empirical_bayes_probability=frame["empirical_bayes_probability"].mask(
                    frame.index == 0, 1.01
                )
            ),
            "outside",
        ),
        (
            lambda frame: frame.assign(
                outcome=frame["outcome"].mask(frame.index == 0, 2)
            ),
            "binary",
        ),
        (
            lambda frame: frame.assign(
                candidate__outcome_observed=frame["candidate__outcome_observed"].mask(
                    frame.index == 0, 0
                )
            ),
            "do not match",
        ),
        (
            lambda frame: frame.assign(
                horizon_months=frame["horizon_months"].mask(frame.index == 0, 18)
            ),
            "Unsupported",
        ),
    ],
)
def test_validation_fails_closed_on_invalid_rows(mutation, message: str) -> None:
    with pytest.raises(ArrivalValidationError, match=message):
        validate_evaluation_rows(mutation(_rows()), BASELINES)


def test_validation_rejects_player_and_snapshot_inconsistency() -> None:
    rows = _rows()
    rows.loc[rows.index == 1, "player_id"] = "different-player"
    with pytest.raises(ArrivalValidationError, match="maps inconsistently"):
        validate_evaluation_rows(rows, BASELINES)

    source_mismatch = _rows().assign(candidate_player_id=lambda frame: frame["player_id"])
    source_mismatch.loc[source_mismatch.index == 0, "candidate_player_id"] = "wrong-player"
    with pytest.raises(ArrivalValidationError, match="Player identity mismatch"):
        validate_evaluation_rows(source_mismatch, BASELINES)


def test_unobserved_outcomes_must_be_missing() -> None:
    rows = _rows().drop(columns="candidate__outcome_observed")
    rows.loc[rows.index == 0, "outcome_observed"] = 0
    with pytest.raises(ArrivalValidationError, match="Unobserved outcomes must be missing"):
        validate_evaluation_rows(rows, BASELINES)

    rows.loc[rows.index == 0, "outcome"] = pd.NA
    validated = validate_evaluation_rows(rows, BASELINES)
    assert validated["outcome"].isna().sum() == 1


def test_identical_predictions_have_exact_zero_paired_intervals() -> None:
    rows = _rows()
    rows["global_hazard_probability"] = rows["candidate_probability"]

    first = paired_player_cluster_bootstrap(rows, BASELINES, repetitions=100, seed=29)
    second = paired_player_cluster_bootstrap(
        rows.sample(frac=1.0, random_state=7), BASELINES, repetitions=100, seed=29
    )

    assert first == second
    assert first["player_clusters"] == 4
    assert first["same_draw_for_candidate_and_all_baselines"] is True
    assert first["cross_horizon_pooling"] is False
    for cell in first["cells"]:
        for comparison in cell["comparisons"].values():
            for metric in comparison.values():
                assert metric["estimate"] == 0.0
                assert metric["ci_95"] == {
                    "lower": 0.0,
                    "upper": 0.0,
                    "values_available": 100,
                }


def test_bootstrap_defaults_and_cross_horizon_guard_are_frozen() -> None:
    assert DEFAULT_BOOTSTRAP_REPETITIONS == 2_000
    assert DEFAULT_BOOTSTRAP_SEED == 29
    with pytest.raises(ArrivalValidationError, match="must include horizon_months"):
        paired_player_cluster_bootstrap(
            _rows(), BASELINES, group_columns=("role",), repetitions=2
        )


def test_diagnostics_are_pooled_within_each_horizon_only() -> None:
    diagnostics = pooled_horizon_diagnostics(_rows(), BASELINES)

    assert [cell["horizon_months"] for cell in diagnostics] == [12, 24]
    assert all(cell["rows"] == 4 for cell in diagnostics)
    assert diagnostics[0]["events"] == 2
    assert diagnostics[1]["events"] == 3
    assert set(diagnostics[0]["role_counts"]) == {"hitter", "pitcher"}
    assert diagnostics[0]["cold_start_counts"]["cold_start"]["rows"] == 2
    candidate = diagnostics[0]["candidate"]
    assert candidate["brier"] == pytest.approx(0.025)
    assert candidate["roc_auc"] == 1.0
    assert candidate["average_precision"] == 1.0
    assert candidate["observed_to_expected_ratio"] == pytest.approx(1.0)
    assert candidate["reliability_edges"] == list(FIXED_RELIABILITY_EDGES)
    assert len(candidate["reliability_bins"]) == len(FIXED_RELIABILITY_EDGES) - 1
    assert candidate["top_decile"]["tie_inclusive"] is True


def _sufficiency_rows(horizon: int, cold_event_players: int, rows: int = 2_500) -> list[dict]:
    result: list[dict] = []
    for index in range(rows):
        event = index < 100
        result.append(
            {
                "snapshot_id": f"snapshot-{horizon}-{index}",
                "player_id": f"player-{horizon}-{index}",
                "role": "hitter",
                "cold_start": int(index < cold_event_players),
                "horizon_months": horizon,
                "outcome": int(event),
                "outcome_observed": 1,
                "candidate_probability": 0.1,
                "empirical_bayes_probability": 0.08,
                "global_hazard_probability": 0.04,
            }
        )
    return result


def test_role_horizon_and_cold_start_sufficiency_boundaries() -> None:
    rows = pd.DataFrame(
        _sufficiency_rows(12, 29)
        + _sufficiency_rows(24, 30)
        + _sufficiency_rows(36, 100)
        + _sufficiency_rows(48, 100, rows=2_499)
    )

    cells = pooled_role_horizon_sufficiency(rows, BASELINES)
    by_horizon = {cell["horizon_months"]: cell for cell in cells}

    assert by_horizon[12]["status"] == "gateable"
    assert by_horizon[12]["cold_start"]["status"] == "suppress_inference"
    assert by_horizon[24]["cold_start"]["status"] == "descriptive_only"
    assert by_horizon[36]["cold_start"]["status"] == "gateable"
    assert by_horizon[36]["cold_start"]["inferential_metrics_allowed"] is True
    assert by_horizon[48]["status"] == "insufficient"
    assert by_horizon[48]["cold_start"]["status"] == "gateable"
    assert by_horizon[48]["cold_start"]["inferential_metrics_allowed"] is False


def _promotion_rows(*, pitcher_rows_per_bin: int = 625) -> pd.DataFrame:
    rows: list[dict] = []
    for role, rows_per_bin in (("hitter", 625), ("pitcher", pitcher_rows_per_bin)):
        offset = 0
        for probability in (0.02, 0.04, 0.08, 0.16):
            events = round(rows_per_bin * probability)
            for index in range(rows_per_bin):
                player_index = offset + index
                rows.append(
                    {
                        "snapshot_id": f"promotion-{role}-{player_index}",
                        "player_id": f"promotion-{role}-{player_index}",
                        "role": role,
                        "prior_level": "AAA",
                        "cold_start": 1,
                        "horizon_months": 12,
                        "outcome": int(index < events),
                        "outcome_observed": 1,
                        "candidate_probability": probability,
                        "empirical_bayes_probability": min(0.99, probability + 0.10),
                        "global_hazard_probability": min(0.99, probability + 0.15),
                    }
                )
            offset += rows_per_bin
    return pd.DataFrame(rows)


def test_promotion_adjudication_passes_deterministically_with_equal_cell_macros() -> None:
    rows = _promotion_rows(pitcher_rows_per_bin=1_250)

    first = adjudicate_promotion_gates(
        rows, BASELINES, promotion_eligible=True, repetitions=50, seed=29
    )
    second = adjudicate_promotion_gates(
        rows.sample(frac=1.0, random_state=41),
        BASELINES,
        promotion_eligible=True,
        repetitions=50,
        seed=29,
    )

    assert first == second
    assert first["passed"] is True
    assert first["status"] == "pass"
    assert first["failed_reasons"] == []
    assert first["bootstrap"]["cross_horizon_outcome_pooling"] is False
    assert first["bootstrap"][
        "same_global_player_draws_for_every_scope_cell_and_baseline"
    ] is True
    pooled = first["pooled_role_horizon"]
    assert pooled["passed"] is True
    comparison = pooled["brier_comparisons"]["empirical_bayes"]
    assert comparison["equal_weight_per_role_horizon_cell"] is True
    assert set(comparison["per_role"]) == {"hitter", "pitcher"}
    cell_mean = sum(cell["estimate"] for cell in comparison["cells"]) / 2
    assert comparison["macro"]["estimate"] == pytest.approx(cell_mean)
    assert comparison["macro"]["ci_95"]["lower"] > 0
    assert first["cold_start_role_horizon"]["passed"] is True
    assert {
        gate["gate"] for gate in first["cold_start_role_horizon"]["gates"]
    } == {
        "cold_start_role_horizon.sufficient_cells_available",
        "cold_start_role_horizon.macro_brier_improvement",
        "cold_start_role_horizon.absolute_macro_calibration_in_the_large",
    }
    assert "calibration_slope" not in {
        gate["gate"] for gate in first["cold_start_role_horizon"]["gates"]
    }
    assert first["prior_level_subgroups"]["passed"] is True
    assert set(
        first["prior_level_subgroups"]["brier_comparisons"]["empirical_bayes"][
            "per_role"
        ]
    ) == {"hitter", "pitcher"}
    assert first["thresholds"][
        "minimum_fraction_cells_with_absolute_calibration_in_the_large_at_most_0_03"
    ] == 0.75


def test_role_horizon_diagnostics_report_and_exclude_insufficient_cells() -> None:
    rows = _promotion_rows()
    insufficient: list[dict] = []
    for index in range(100):
        insufficient.append(
            {
                "snapshot_id": f"insufficient-{index}",
                "player_id": f"insufficient-{index}",
                "role": "hitter",
                "prior_level": "Rk",
                "cold_start": 1,
                "horizon_months": 24,
                "outcome": int(index < 10),
                "outcome_observed": 1,
                "candidate_probability": 0.9,
                "empirical_bayes_probability": 0.1,
                "global_hazard_probability": 0.1,
            }
        )
    combined = pd.concat([rows, pd.DataFrame(insufficient)], ignore_index=True)

    diagnostics = pooled_role_horizon_diagnostics(combined, BASELINES)
    report = adjudicate_promotion_gates(
        combined, BASELINES, promotion_eligible=True, repetitions=30, seed=29
    )

    by_key = {(cell["role"], cell["horizon_months"]): cell for cell in diagnostics}
    bad_cell = by_key[("hitter", 24)]
    assert bad_cell["status"] == "insufficient"
    assert bad_cell["candidate"]["brier"] > bad_cell["baselines"]["empirical_bayes"]["brier"]
    assert bad_cell["point_comparisons"]["empirical_bayes"][
        "absolute_brier_improvement"
    ] < 0
    excluded = report["pooled_role_horizon"]["insufficient_cells"]
    assert {("hitter", 24)} == {
        (cell["role"], cell["horizon_months"]) for cell in excluded
    }
    assert report["pooled_role_horizon"]["insufficient_cells_excluded_from_all_gates"]
    assert report["passed"] is True


def test_prior_level_inventory_reports_insufficient_and_suppresses_unsupported_slope() -> None:
    rows: list[dict] = []
    for index in range(1_000):
        within_group = index % 500
        rows.append(
            {
                "snapshot_id": f"subgroup-{index}",
                "player_id": f"subgroup-{index}",
                "role": "hitter",
                "prior_level": None if index < 500 else "AA",
                "cold_start": 0,
                "horizon_months": 12,
                "outcome": int(within_group < 50),
                "outcome_observed": 1,
                "candidate_probability": 0.2 + (index % 2) * 0.01,
                "empirical_bayes_probability": 0.25,
                "global_hazard_probability": 0.30,
            }
        )

    diagnostics = prior_level_subgroup_diagnostics(pd.DataFrame(rows), BASELINES)

    assert {(cell["prior_level"], cell["status"]) for cell in diagnostics} == {
        ("AA", "sufficient"),
        ("missing", "sufficient"),
    }
    assert all(cell["candidate"]["calibration_slope"] is None for cell in diagnostics)
    assert all(
        cell["candidate"]["calibration_slope_inference"]["allowed"] is False
        for cell in diagnostics
    )


def test_failed_promotion_lists_every_failed_gate_reason() -> None:
    rows = _promotion_rows()
    hitter = rows["role"].eq("hitter")
    rows.loc[hitter, "candidate_probability"] = (
        rows.loc[hitter, "candidate_probability"] + 0.20
    )

    report = adjudicate_promotion_gates(
        rows, BASELINES, promotion_eligible=True, repetitions=40, seed=29
    )

    assert report["passed"] is False
    assert report["status"] == "fail"
    assert any("positive_brier_cell_fraction" in reason for reason in report["failed_reasons"])
    assert any(
        "calibration.calibration_in_the_large.macro" in reason
        for reason in report["failed_reasons"]
    )
    failed_gate_ids = {gate["gate"] for gate in report["gates"] if not gate["passed"]}
    reason_gate_ids = {reason.split(":", 1)[0] for reason in report["failed_reasons"]}
    assert reason_gate_ids == failed_gate_ids


def test_cumulative_horizon_gate_counts_decreases_without_outcome_pooling() -> None:
    rows = _rows()
    rows.loc[rows["horizon_months"].eq(24), "candidate_probability"] = 0.0

    violations = cumulative_horizon_violations(rows)

    assert violations["violations"] == 4
    assert violations["maximum_allowed"] == PROMOTION_GATE_CONFIG[
        "maximum_cumulative_horizon_violations"
    ]
    assert {detail["later_horizon_months"] for detail in violations["details"]} == {24}


def test_external_admission_failure_blocks_promotion_without_suppressing_metrics() -> None:
    rows = _promotion_rows()

    report = adjudicate_promotion_gates(
        rows, BASELINES, promotion_eligible=False, repetitions=20, seed=29
    )

    assert report["passed"] is False
    assert report["external_admission"]["passed"] is False
    assert report["pooled_role_horizon"]["passed"] is True
    assert report["cold_start_role_horizon"]["passed"] is True
    assert report["metrics_scored_even_when_external_admission_fails"] is True
    assert any(
        reason.startswith("external_admission.promotion_eligible:")
        for reason in report["failed_reasons"]
    )
    with pytest.raises(ArrivalValidationError, match="explicit boolean"):
        adjudicate_promotion_gates(
            rows, BASELINES, promotion_eligible=1, repetitions=2, seed=29
        )
    with pytest.raises(ArrivalValidationError, match="prior_level is required"):
        adjudicate_promotion_gates(
            rows.drop(columns="prior_level"),
            BASELINES,
            promotion_eligible=True,
            repetitions=2,
            seed=29,
        )
