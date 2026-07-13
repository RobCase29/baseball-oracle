from __future__ import annotations

import pandas as pd

from modeling.career_chapters import (
    _absolute_training_threshold,
    _future_three_outcomes,
    _learn_boundaries,
    _prepare_landmarks,
    trajectory_state,
)


def landmark(
    player_id: str,
    season: int,
    season_number: int,
    season_war: float,
    *,
    age: int = 22,
    role: str = "hitter",
    starter_share: float = 0.0,
) -> dict[str, object]:
    return {
        "bbref_id": player_id,
        "season": season,
        "age": age,
        "season_number": season_number,
        "role": role,
        "season_war": season_war,
        "career_war_to_date": season_war,
        "war_last_three": season_war,
        "war_best_to_date": season_war,
        "career_war_per_season": season_war,
        "starter_share": starter_share,
    }


def thresholds() -> dict[str, float]:
    return {
        "seasonWarMedian": 0.5,
        "seasonWarUpperQuartile": 1.5,
        "launchWarMedian": 0.3,
        "launchWarQ90": 3.0,
        "trendTolerance": 0.4,
    }


def test_three_year_outcome_uses_only_next_three_calendar_seasons() -> None:
    panel = pd.DataFrame(
        [
            landmark("player", 2000, 1, 1.0),
            landmark("player", 2001, 2, 2.0, age=23),
            landmark("player", 2003, 3, 3.0, age=25),
            landmark("player", 2004, 4, 100.0, age=26),
        ]
    )
    outcomes = _future_three_outcomes(_prepare_landmarks(panel), 2004)

    origin = outcomes.loc[outcomes["season"].eq(2000)].iloc[0]
    assert origin["future_three_war"] == 5.0
    assert outcomes["season"].max() == 2001


def test_learned_chapter_boundaries_are_monotone_and_order_invariant() -> None:
    curve = [
        {
            "age": age,
            "players": 500,
            "landmarks": 700,
            "expectedNextWarChange": (
                0.20 - (age - 20) * 0.04 if age < 25 else -0.02 - (age - 25) * 0.04
            ),
            "continuationRate": 0.90 if age < 31 else 0.90 - (age - 30) * 0.08,
        }
        for age in range(20, 39)
    ]

    first = _learn_boundaries(curve)
    second = _learn_boundaries(list(reversed(curve)))

    assert first == second
    assert first["primeStartAge"] < first["declineStartAge"]
    assert first["declineStartAge"] < first["lateStartAge"]


def test_nick_style_launch_is_breakout_on_absolute_quality() -> None:
    state = trajectory_state(
        season_number=1,
        season_war=5.04,
        war_trend=None,
        exceptional_probability=0.88,
        expected_next_war_change=0.2,
        thresholds=thresholds(),
    )

    assert state == "breakout"


def test_ryan_walker_style_low_war_reliever_is_not_breakout() -> None:
    state = trajectory_state(
        season_number=3,
        season_war=0.12,
        war_trend=-1.74,
        exceptional_probability=0.08,
        expected_next_war_change=0.01,
        thresholds=thresholds(),
    )

    assert state == "declining"


def test_absolute_threshold_comes_only_from_player_weighted_training_fold() -> None:
    training = pd.DataFrame(
        {
            "bbref_id": ["long", "long", "long", "short", "elite"],
            "future_three_war": [0.0, 0.0, 0.0, 2.0, 10.0],
        }
    )
    with_nontraining_extreme = pd.concat(
        [
            training,
            pd.DataFrame(
                {"bbref_id": ["future"], "future_three_war": [1_000.0]}
            ),
        ],
        ignore_index=True,
    )

    threshold = _absolute_training_threshold(training)
    contaminated = _absolute_training_threshold(with_nontraining_extreme)

    assert threshold == 10.0
    assert contaminated > threshold
