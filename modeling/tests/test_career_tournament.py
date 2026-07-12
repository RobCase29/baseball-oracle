from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from modeling.career_data import build_career_landmarks, chronological_player_split
from modeling.career_tournament import (
    CalibratedScenarioTiltDistribution,
    QUANTILE_NAMES,
    classification_metrics,
    quantile_dict,
    run_career_tournament,
)
from modeling.tests.test_career_data import season, standards


def tournament_panel() -> pd.DataFrame:
    rows: list[dict] = []
    # Career end year drives the locked chronological split. Every era contains
    # positives and negatives so calibration and discrimination are defined.
    for index in range(90):
        player = f"model{index:04d}"
        start = 1920 + index
        positive = index % 7 == 0
        role = "pitcher" if index % 3 == 0 else "hitter"
        position = "1" if role == "pitcher" else ("2" if index % 4 == 0 else "6")
        for offset in range(4):
            value = 18.0 if positive else 0.4 + 0.1 * offset
            rows.append(
                season(
                    player,
                    start + offset,
                    value,
                    position=position,
                    role=role,
                    age=22 + offset,
                )
            )
    return build_career_landmarks(pd.DataFrame(rows), standards(), as_of_year=2030)


def test_tournament_is_deterministic_and_reports_registered_entrants() -> None:
    panel = tournament_panel()
    split = chronological_player_split(panel, minimum_players_per_split=8)

    first = run_career_tournament(panel, split)
    second = run_career_tournament(panel.sample(frac=1.0, random_state=4), split)

    assert first.report == second.report
    assert set(first.report["entrants"]) == {
        "age_position_empirical_prior",
        "regularized_logistic",
        "nonlinear_hist_gradient_boosting",
        "calibrated_ensemble",
        "joint_residual_career_distribution",
        "calibrated_scenario_tilt",
    }
    assert first.report["champion"] in first.report["entrants"]
    assert set(first.report["developmentHoldoutStageSlices"]) == {
        "firstSeason",
        "seasonsOneToThree",
        "seasonFourPlus",
    }
    assert first.report["developmentHoldoutFirstSeasonRanking"]["players"] == len(
        split.test_players
    )
    assert first.report["developmentHoldoutIntegrity"] == {
        "humanReviewedDuringDevelopment": True,
        "pristine": False,
        "use": "retrospective architecture audit only",
        "selectionUse": "excluded_from_mechanical_champion_selection",
        "nextValidation": "freeze pipeline and register a new untouched forward/debut cohort before superiority or release claims",
    }
    assert first.report["scenarioTilt"]["blendGrid"]
    assert first.report["releaseGates"]["earlyInterval80Coverage"][
        "selectionRole"
    ] == "release_only_not_champion_selection"
    tail = first.report["earlyHallEventTailDiagnostic"]
    assert tail["status"] == "failed_research_diagnostic"
    assert tail["publicationControl"] == "warning_only_not_rank_withholding"
    assert tail["warningCode"] == "early_hall_tail_not_learned_research_only"
    assert set(tail["selection"]["stages"]) == {
        "firstSeason",
        "seasonsOneToThree",
    }
    assert set(tail["developmentHoldout"]["stages"]) == {
        "firstSeason",
        "seasonsOneToThree",
    }
    assert "expected-shortfall evaluation above Hall-caliber thresholds" in tail[
        "requiredNextEvaluation"
    ]
    for metrics in first.report["entrants"].values():
        assert 0 <= metrics["brier"] <= 1
        assert 0 <= metrics["expectedCalibrationError"] <= 1
    assert 0 <= first.report["distributionMetrics"]["finalCareerWar"][
        "interval80Coverage"
    ] <= 1


def test_tournament_probabilities_and_quantiles_are_bounded_and_ordered() -> None:
    panel = tournament_panel()
    split = chronological_player_split(panel, minimum_players_per_split=8)
    tournament = run_career_tournament(panel, split)
    current = panel.sort_values(["bbref_id", "season"]).groupby("bbref_id").tail(1).head(5)

    probability = tournament.predict_hof_probability(current)
    _, final_quantiles, peak_quantiles, jaws_quantiles, margin_quantiles = (
        tournament.joint_model.predict_distribution(current)
    )

    assert ((probability >= 0) & (probability <= 1)).all()
    assert (final_quantiles[:, 1:] >= final_quantiles[:, :-1]).all()
    assert (peak_quantiles >= current["peak_seven_war_to_date"].to_numpy()[:, None]).all()
    assert (jaws_quantiles[:, 1:] >= jaws_quantiles[:, :-1]).all()
    assert (margin_quantiles[:, 1:] >= margin_quantiles[:, :-1]).all()
    assert tuple(quantile_dict(final_quantiles[0])) == QUANTILE_NAMES


def test_development_holdout_labels_cannot_select_the_champion() -> None:
    panel = tournament_panel()
    split = chronological_player_split(panel, minimum_players_per_split=8)
    first = run_career_tournament(panel, split)
    changed = panel.copy()
    test_mask = changed["bbref_id"].isin(split.test_players)
    changed.loc[test_mask, "hof_caliber"] = 1 - changed.loc[test_mask, "hof_caliber"].astype(int)

    second = run_career_tournament(changed, split)

    assert first.report["champion"] == second.report["champion"]
    assert first.report["selectionMetrics"] == second.report["selectionMetrics"]
    assert first.report["developmentHoldoutMetrics"] != second.report[
        "developmentHoldoutMetrics"
    ]


def test_weighted_metrics_honor_probability_scale() -> None:
    perfect = classification_metrics([0, 1], [0.0, 1.0], [1.0, 1.0])
    assert perfect["brier"] == pytest.approx(0.0)
    assert perfect["averagePrecision"] == 1.0
    assert perfect["rocAuc"] == 1.0


def test_zero_tail_support_extension_changes_only_one_paired_scenario() -> None:
    final = np.zeros(8, dtype=float)
    peak = np.zeros(8, dtype=float)

    shifted_final, shifted_peak, extension = (
        CalibratedScenarioTiltDistribution._ensure_tail_support(
            final, peak, 0.0, 10.0, 0.05
        )
    )

    assert extension > 0
    assert np.count_nonzero(shifted_final != final) == 1
    assert np.array_equal(shifted_peak, peak)
    assert (((shifted_final + shifted_peak) / 2.0) >= 10.0).sum() == 1
