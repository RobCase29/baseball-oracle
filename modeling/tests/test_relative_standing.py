from __future__ import annotations

import pandas as pd

from modeling.relative_standing import HistoricalPaceReference


def row(
    player_id: str,
    *,
    season: int,
    age: int,
    season_number: int,
    war: float,
    role: str = "hitter",
    resolved: bool = True,
) -> dict[str, object]:
    return {
        "bbref_id": player_id,
        "season": season,
        "age": float(age),
        "season_number": season_number,
        "role": role,
        "career_war_to_date": war,
        "resolved_career": resolved,
    }


def test_historical_pace_is_deterministic_and_excludes_future_and_unresolved_rows() -> None:
    rows = [
        row("low", season=2000, age=22, season_number=1, war=1.0),
        row("high", season=2001, age=22, season_number=1, war=5.0),
        row("future", season=2026, age=22, season_number=1, war=20.0),
        row("unresolved", season=2002, age=22, season_number=1, war=20.0, resolved=False),
    ]
    feature = pd.Series(
        row("current", season=2025, age=22, season_number=1, war=4.0, resolved=False)
    )

    first = HistoricalPaceReference(pd.DataFrame(rows), minimum_players=2).relative_signal(feature)
    second = HistoricalPaceReference(
        pd.DataFrame(rows).sample(frac=1.0, random_state=7), minimum_players=2
    ).relative_signal(feature)

    assert first == second
    pace = first["historicalPace"]
    assert pace["percentile"] == 50.0
    assert pace["cohortSize"] == 2
    assert pace["cohort"]["resolvedOnly"] is True
    assert pace["cohort"]["ageWindow"] == 0


def test_historical_pace_expands_age_window_and_weights_each_player_once() -> None:
    rows = [
        row("repeat", season=2000, age=21, season_number=2, war=1.0),
        row("repeat", season=2001, age=22, season_number=3, war=3.0),
        row("other", season=2000, age=23, season_number=2, war=5.0),
    ]
    feature = pd.Series(
        row("current", season=2025, age=22, season_number=2, war=4.0, resolved=False)
    )

    signal = HistoricalPaceReference(
        pd.DataFrame(rows), minimum_players=2
    ).relative_signal(feature)

    pace = signal["historicalPace"]
    assert signal["status"] == "research"
    assert pace["percentile"] == 50.0
    assert pace["cohortSize"] == 2
    assert pace["cohort"]["ageWindow"] == 1
    assert pace["cohort"]["stageBand"] == "seasons_2_3"
    assert "historical_pace_age_window_expanded_for_support" in signal["warnings"]


def test_historical_pace_withholds_partial_features_and_thin_cohorts() -> None:
    panel = pd.DataFrame(
        [row("only", season=2000, age=22, season_number=1, war=1.0)]
    )
    reference = HistoricalPaceReference(panel, minimum_players=2)
    feature = pd.Series(
        row("current", season=2025, age=22, season_number=1, war=4.0, resolved=False)
    )

    partial = reference.relative_signal(feature, partial_feature=True)
    thin = reference.relative_signal(feature)

    assert partial["status"] == "withheld"
    assert partial["historicalPace"] is None
    assert "partial_season_feature_not_eligible_for_historical_pace" in partial["warnings"]
    assert thin["status"] == "withheld"
    assert thin["historicalPace"] is None
    assert "historical_pace_insufficient_support" in thin["warnings"]
