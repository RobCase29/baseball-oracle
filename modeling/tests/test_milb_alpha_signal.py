from __future__ import annotations

import pandas as pd

from modeling.arrival_hazard_baseline import fit_hazard_baseline
from modeling.milb_alpha_signal import (
    MilbAlphaReference,
    build_milb_alpha_signal,
    rank_milb_alpha_signals,
    retrospective_milb_alpha_diagnostic,
)


def reference_inputs() -> tuple[pd.DataFrame, pd.DataFrame]:
    snapshots: list[dict[str, object]] = []
    periods: list[dict[str, object]] = []
    for index in range(500):
        player_id = f"reference-{index}"
        age = 20.0 + index / 500.0
        snapshots.append(
            {
                "snapshot_id": f"historical-{index}",
                "player_id": player_id,
                "edition": 2019,
                "role": "hitter",
                "prior_level": "AA",
                "age": age,
                "prior_batting_pa": 100 + index,
                "prior_pitching_ip": None,
                "prior_iso": index / 1000.0,
                "prior_bb_rate": 0.05 + index / 10_000.0,
                "prior_k_rate": 0.30 - index / 5_000.0,
                "prior_k_minus_bb_rate": None,
                "prior_era": None,
                "prior_whip": None,
            }
        )
        if index < 100:
            terminal_interval, event_interval = 1, 1
        elif index < 200:
            terminal_interval, event_interval = 2, 2
        elif index < 300:
            terminal_interval, event_interval = 3, 3
        elif index < 400:
            terminal_interval, event_interval = 4, 4
        elif index < 450:
            terminal_interval, event_interval = 5, 5
        else:
            terminal_interval, event_interval = 5, None
        for interval in range(1, terminal_interval + 1):
            periods.append(
                {
                    "snapshot_id": f"historical-{index}",
                    "role": "hitter",
                    "prior_level": "AA",
                    "age": age,
                    "interval": interval,
                    "event": int(interval == event_interval),
                    "sample_weight": 1.0,
                }
            )
    return pd.DataFrame(snapshots), pd.DataFrame(periods)


def reference() -> MilbAlphaReference:
    snapshots, periods = reference_inputs()
    return MilbAlphaReference(snapshots, fit_hazard_baseline(periods))


def feature(*, age: float = 20.2, pa: float = 300.0) -> dict[str, object]:
    return {
        "snapshot_id": "current",
        "player_id": "current-player",
        "edition": 2025,
        "role": "hitter",
        "prior_level": "AA",
        "age": age,
        "prior_batting_pa": pa,
        "prior_pitching_ip": None,
        "prior_iso": 0.45,
        "prior_bb_rate": 0.12,
        "prior_k_rate": 0.12,
        "prior_k_minus_bb_rate": None,
        "prior_era": None,
        "prior_whip": None,
    }


def signal(**feature_overrides: float) -> dict[str, object]:
    return build_milb_alpha_signal(
        feature(**feature_overrides),
        horizons=(36, 60),
        probabilities=(0.60, 0.80),
        baselines=(0.20, 0.30),
        cold_start=True,
        as_of="2025-12-31T00:00:00.000Z",
        arrival_status="external_validation_failed_research_only",
        reference=reference(),
    )


def test_builds_sharp_age_level_arrival_edge_without_composite_score() -> None:
    result = signal()

    assert result["version"] == "milb-alpha-signal-v1"
    assert result["target"] == "first_mlb_arrival_within_36_months"
    assert result["eligible"] is True
    assert result["tier"] == "priority"
    assert result["primaryEdge"] == {
        "horizonMonths": 36,
        "probability": 0.6,
        "baselineProbability": 0.2,
        "probabilityDelta": 0.4,
        "liftMultiple": 3.0,
    }
    assert result["ageContext"]["percentileWithinRoleLevel"] < 25
    assert result["baselineSupport"]["minimumRows"] == 100
    assert result["baselineSupport"]["minimumEvents"] == 50
    assert result["longHorizonEdge"]["externallyValidated"] is False
    assert result["validation"]["validatedHorizons"] == []
    assert result["releaseGates"] == {
        "externalValidationPassed": False,
        "probabilityCalibrationPassed": False,
        "currentFeatureAlignmentPassed": False,
    }
    assert "score" not in result
    assert result["inputPolicy"].endswith("no_composite_score_or_external_rank")
    assert result["descriptiveDrivers"][0]["favorablePercentile"] > 90
    assert "external_validation_failed_no_horizon_validated" in result["warnings"]


def test_workload_age_and_artifact_status_are_hard_research_selection_gates() -> None:
    low_workload = signal(pa=10)
    old_for_level = signal(age=20.9)
    wrong_status = build_milb_alpha_signal(
        feature(),
        horizons=(36, 60),
        probabilities=(0.60, 0.80),
        baselines=(0.20, 0.30),
        cold_start=False,
        as_of="2025-12-31",
        arrival_status="passed",
        reference=reference(),
    )

    assert low_workload["eligible"] is False
    assert low_workload["gates"]["minimumRawWorkload"] is False
    assert old_for_level["eligible"] is False
    assert old_for_level["gates"]["youngForRoleAndLevel"] is False
    assert wrong_status["eligible"] is False
    assert "unexpected_arrival_artifact_status" in wrong_status["warnings"]


def test_ranking_uses_only_eligible_edge_then_age_and_long_horizon() -> None:
    first = signal()
    second = signal()
    second["primaryEdge"]["probabilityDelta"] = 0.30
    withheld = signal(pa=1)
    estimates = {
        "second": {"milbAlphaSignal": second},
        "withheld": {"milbAlphaSignal": withheld},
        "first": {"milbAlphaSignal": first},
    }

    count = rank_milb_alpha_signals(estimates)

    assert count == 2
    assert first["rank"] == 1
    assert second["rank"] == 2
    assert withheld["rank"] is None


def test_retrospective_diagnostic_is_explicitly_not_external_validation() -> None:
    historical, periods = reference_inputs()
    alpha_reference = MilbAlphaReference(historical, fit_hazard_baseline(periods))
    snapshots: list[dict[str, object]] = []
    evaluated: list[dict[str, object]] = []
    for index in range(10):
        row = feature()
        row.update(
            {
                "snapshot_id": f"external-{index}",
                "player_id": f"external-player-{index}",
                "edition": 2021,
            }
        )
        snapshots.append(row)
        for horizon, probability, baseline in ((36, 0.60, 0.20), (60, 0.80, 0.30)):
            evaluated.append(
                {
                    "snapshot_id": row["snapshot_id"],
                    "player_id": row["player_id"],
                    "edition": 2021,
                    "horizon_months": horizon,
                    "candidate_probability": probability,
                    "hierarchical_baseline_probability": baseline,
                    "outcome": index < 5,
                    "outcome_observed": horizon == 36,
                    "cold_start": True,
                }
            )

    report = retrospective_milb_alpha_diagnostic(
        pd.DataFrame(snapshots), pd.DataFrame(evaluated), alpha_reference
    )

    assert report["status"] == "retrospective_development_diagnostic_not_validation"
    assert report["validatedHorizons"] == []
    assert report["allPlayers"]["players"] == 10
    assert report["allPlayers"]["selectedPlayers"] == 10
    assert report["coldStartPlayers"]["selectedEvents"] == 5
