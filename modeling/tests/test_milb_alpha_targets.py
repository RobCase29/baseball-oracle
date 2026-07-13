from __future__ import annotations

import pandas as pd
import pytest

from modeling.milb_alpha_targets import (
    MilbAlphaTargetError,
    TARGET_VERSION,
    build_five_calendar_year_war_targets,
)


def test_builds_mature_war_targets_and_keeps_immature_rows_unlabeled() -> None:
    snapshots = pd.DataFrame(
        [
            {"snapshot_id": "s1", "player_id": "p1", "edition": 2019, "bbref_id": "b1"},
            {"snapshot_id": "s2", "player_id": "p2", "edition": 2019, "bbref_id": None},
            {"snapshot_id": "s3", "player_id": "p3", "edition": 2019, "bbref_id": None},
            {"snapshot_id": "s4", "player_id": "p4", "edition": 2022, "bbref_id": "b4"},
        ]
    )
    outcomes = pd.DataFrame(
        [
            {"player_id": "p1", "bbref_id": "b1", "debut": "2020-07-01"},
            {"player_id": "p2", "bbref_id": "b2", "debut": "2023-04-01"},
            {"player_id": "p4", "bbref_id": "b4", "debut": "2024-04-01"},
            {"player_id": None, "bbref_id": "unmatched", "debut": "2020-01-01"},
        ]
    )
    war = pd.DataFrame(
        [
            {"bbref_id": "b1", "season": 2019, "total_war": 9.0},
            {"bbref_id": "b1", "season": 2020, "total_war": 1.5},
            {"bbref_id": "b1", "season": 2021, "total_war": -0.5},
            {"bbref_id": "b1", "season": 2022, "total_war": 2.0},
            {"bbref_id": "b1", "season": 2024, "total_war": 3.0},
            {"bbref_id": "b1", "season": 2025, "total_war": 10.0},
            {"bbref_id": "b2", "season": 2023, "total_war": 2.0},
            {"bbref_id": "b2", "season": 2024, "total_war": 3.0},
            {"bbref_id": "b4", "season": 2024, "total_war": 4.0},
        ]
    )

    result = build_five_calendar_year_war_targets(
        snapshots, outcomes, war, latest_complete_season=2025
    ).set_index("snapshot_id")

    assert result.loc["s1", "mlb_war_next_5_seasons"] == pytest.approx(6.0)
    assert bool(result.loc["s1", "mlb_war_next_5_ge_5"])
    assert not bool(result.loc["s1", "mlb_war_next_5_ge_10"])
    assert result.loc["s1", "war_season_rows"] == 4
    assert result.loc["s1", "identity_resolution"] == "snapshot_and_career_confirmed"

    assert result.loc["s2", "mlb_war_next_5_seasons"] == pytest.approx(5.0)
    assert result.loc["s2", "identity_resolution"] == "career_outcome_identity"
    assert bool(result.loc["s2", "debut_within_target_window"])

    assert result.loc["s3", "mlb_war_next_5_seasons"] == pytest.approx(0.0)
    assert result.loc["s3", "label_status"] == "mature_zero_no_mlb_war_row"
    assert result.loc["s3", "identity_resolution"] == "no_mlb_identity_observed"
    assert not bool(result.loc["s3", "mlb_war_next_5_ge_1"])

    assert not bool(result.loc["s4", "target_mature"])
    assert pd.isna(result.loc["s4", "mlb_war_next_5_seasons"])
    assert pd.isna(result.loc["s4", "mlb_war_next_5_ge_1"])
    assert result.loc["s4", "label_status"] == "immature_window"
    assert set(result["target_version"]) == {TARGET_VERSION}


def test_rejects_conflicting_identity_assignments() -> None:
    snapshots = pd.DataFrame(
        [{"snapshot_id": "s1", "player_id": "p1", "edition": 2019, "bbref_id": "b1"}]
    )
    outcomes = pd.DataFrame(
        [{"player_id": "p1", "bbref_id": "different", "debut": "2020-01-01"}]
    )
    war = pd.DataFrame([{"bbref_id": "b1", "season": 2020, "total_war": 1.0}])

    with pytest.raises(MilbAlphaTargetError, match="IDs conflict"):
        build_five_calendar_year_war_targets(
            snapshots, outcomes, war, latest_complete_season=2025
        )


def test_rejects_duplicate_player_season_war_rows() -> None:
    snapshots = pd.DataFrame(
        [{"snapshot_id": "s1", "player_id": "p1", "edition": 2019, "bbref_id": "b1"}]
    )
    outcomes = pd.DataFrame(columns=["player_id", "bbref_id", "debut"])
    war = pd.DataFrame(
        [
            {"bbref_id": "b1", "season": 2020, "total_war": 1.0},
            {"bbref_id": "b1", "season": 2020, "total_war": 2.0},
        ]
    )

    with pytest.raises(MilbAlphaTargetError, match="one row per player and season"):
        build_five_calendar_year_war_targets(
            snapshots, outcomes, war, latest_complete_season=2025
        )


def test_rejects_partial_war_inside_the_declared_complete_window() -> None:
    snapshots = pd.DataFrame(
        [{"snapshot_id": "s1", "player_id": "p1", "edition": 2019, "bbref_id": "b1"}]
    )
    outcomes = pd.DataFrame(columns=["player_id", "bbref_id", "debut"])
    war = pd.DataFrame(
        [
            {
                "bbref_id": "b1",
                "season": 2024,
                "season_state": "in_season",
                "total_war": 1.0,
            }
        ]
    )

    with pytest.raises(MilbAlphaTargetError, match="complete season state"):
        build_five_calendar_year_war_targets(
            snapshots, outcomes, war, latest_complete_season=2025
        )
