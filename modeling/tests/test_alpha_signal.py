from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd

from modeling.alpha_signal import (
    HistoricalHallBaseline,
    build_alpha_signal,
    rank_alpha_signals,
    retrospective_alpha_diagnostic,
)


def reference_panel() -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for index in range(20):
        rows.append(
            {
                "bbref_id": f"resolved-{index}",
                "season": 2000,
                "age": 22,
                "season_number": 1,
                "role": "hitter",
                "starter_share": 0.0,
                "resolved_career": True,
                "target_eligible": True,
                "hof_caliber": index == 0,
            }
        )
    rows.append(
        {
            **rows[0],
            "season": 2001,
            "age": 23,
        }
    )
    rows.append(
        {
            "bbref_id": "future-hall",
            "season": 2025,
            "age": 22,
            "season_number": 1,
            "role": "hitter",
            "starter_share": 0.0,
            "resolved_career": True,
            "target_eligible": True,
            "hof_caliber": True,
        }
    )
    return pd.DataFrame(rows)


def feature(*, age: float = 22, season_number: int = 1) -> dict[str, object]:
    return {
        "bbref_id": "current",
        "season": 2020,
        "age": age,
        "season_number": season_number,
        "role": "hitter",
        "starter_share": 0.0,
    }


def chapter(probability: float = 0.8) -> dict[str, object]:
    return {
        "status": "research",
        "exceptionalTrajectory": {
            "probability": probability,
            "referenceBaseRate": 0.10,
            "target": "next_three_war_ge_global_training_q90",
        },
    }


def test_historical_baseline_is_prior_only_and_player_equal_weighted() -> None:
    baseline = HistoricalHallBaseline(
        reference_panel(), minimum_players=20, age_windows=(2, 3)
    )

    estimate = baseline.estimate(feature())

    assert estimate is not None
    assert estimate.players == 20
    assert estimate.landmarks == 21
    assert estimate.probability == 0.05
    assert estimate.age_window == 2


def test_alpha_requires_supported_runway_and_absolute_ceiling() -> None:
    baseline = HistoricalHallBaseline(
        reference_panel(), minimum_players=20, age_windows=(2, 3, 4)
    )
    pace = {
        "historicalPace": {
            "percentile": 99.0,
            "cohortSize": 800,
            "metric": "career_war_to_date",
        }
    }

    signal = build_alpha_signal(
        feature(),
        modeled_probability=0.20,
        jaws_margin={"p90": 5.0},
        career_chapter=chapter(),
        historical_signal=pace,
        baseline_reference=baseline,
        prime_start_age=28,
    )

    assert signal["status"] == "research"
    assert signal["tier"] == "priority"
    assert signal["eligible"] is True
    assert signal["edge"] == {"probabilityDelta": 0.15, "liftMultiple": 4.0}
    assert signal["baseline"]["minimumSeason"] == 1961
    assert signal["runway"]["yearsToPrime"] == 6.0
    assert signal["ceiling"]["gatePassed"] is True
    assert signal["historicalPace"]["percentile"] == 99.0
    assert "score" not in signal
    assert "market_price_not_modeled" in signal["warnings"]

    no_runway = build_alpha_signal(
        feature(age=23, season_number=1),
        modeled_probability=0.20,
        jaws_margin={"p90": 5.0},
        career_chapter=chapter(),
        historical_signal=pace,
        baseline_reference=baseline,
        prime_start_age=24,
    )
    assert no_runway["status"] == "research"
    assert no_runway["eligible"] is False
    assert no_runway["gates"]["prePrimeRunway"] is False

    no_ceiling = build_alpha_signal(
        feature(),
        modeled_probability=0.20,
        jaws_margin={"p90": -0.01},
        career_chapter=chapter(),
        historical_signal=pace,
        baseline_reference=baseline,
        prime_start_age=28,
    )
    assert no_ceiling["eligible"] is False
    assert no_ceiling["gates"]["absoluteCeiling"] is False


def test_alpha_withholds_when_broad_historical_support_is_missing() -> None:
    baseline = HistoricalHallBaseline(
        reference_panel(), minimum_players=21, age_windows=(2,)
    )

    signal = build_alpha_signal(
        feature(),
        modeled_probability=0.20,
        jaws_margin={"p90": 5.0},
        career_chapter=chapter(),
        historical_signal=None,
        baseline_reference=baseline,
        prime_start_age=28,
    )

    assert signal["status"] == "withheld"
    assert "historical_hall_baseline_insufficient_support" in signal["warnings"]


def test_alpha_rank_is_eligible_only_and_lexicographic() -> None:
    def player(
        player_id: str,
        delta: float,
        impact: float,
        age: float,
        *,
        eligible: bool = True,
    ) -> dict[str, object]:
        return {
            "bbrefId": player_id,
            "alphaSignal": {
                "status": "research",
                "eligible": eligible,
                "rank": None,
                "edge": {"probabilityDelta": delta},
                "nearTermImpact": {"probability": impact},
                "runway": {"age": age},
            },
        }

    players = [
        player("older", 0.2, 0.8, 25),
        player("impact", 0.2, 0.9, 25),
        player("delta", 0.3, 0.1, 22),
        player("ineligible", 0.9, 0.9, 19, eligible=False),
    ]

    rank_alpha_signals(players)

    assert players[2]["alphaSignal"]["rank"] == 1
    assert players[1]["alphaSignal"]["rank"] == 2
    assert players[0]["alphaSignal"]["rank"] == 3
    assert players[3]["alphaSignal"]["rank"] is None


def test_retrospective_diagnostic_uses_one_snapshot_and_suppresses_small_sample_lift() -> None:
    reference = []
    for index in range(500):
        for season_number in (1, 2):
            reference.append(
                {
                    "bbref_id": f"reference-{index}",
                    "season": 1999 + season_number,
                    "age": 21 + season_number,
                    "season_number": season_number,
                    "role": "hitter",
                    "target_role": "hitter",
                    "starter_share": 0.0,
                    "resolved_career": True,
                    "target_eligible": True,
                    "hof_caliber": index == 0,
                }
            )
    test = []
    for index in range(10):
        for season_number in (1, 2):
            test.append(
                {
                    "bbref_id": f"test-{index}",
                    "season": 2009 + season_number,
                    "age": 21 + season_number,
                    "season_number": season_number,
                    "role": "hitter",
                    "target_role": "hitter",
                    "starter_share": 0.0,
                    "resolved_career": True,
                    "target_eligible": True,
                    "hof_caliber": index in (0, 1),
                }
            )
    panel = pd.DataFrame([*reference, *test])

    class RankingModel:
        def predict_distribution(self, frame: pd.DataFrame):
            count = len(frame)
            probabilities = np.full(count, 0.3)
            zeros = np.zeros((count, 5))
            margins = np.full((count, 5), -1.0)
            for position, row in enumerate(frame.itertuples(index=False)):
                player_number = int(str(row.bbref_id).split("-")[-1])
                if row.season_number == 2 or player_number < 5:
                    margins[position, 4] = 2.0
            return probabilities, zeros, zeros, zeros, margins, np.zeros(count)

    tournament = SimpleNamespace(
        split=SimpleNamespace(
            train_players=tuple(f"reference-{index}" for index in range(400)),
            calibration_players=tuple(f"reference-{index}" for index in range(400, 500)),
            test_players=tuple(row["bbref_id"] for row in test),
        ),
        ranking_model=RankingModel(),
        champion_name="test_champion",
    )

    report = retrospective_alpha_diagnostic(
        panel, tournament, {"hitter": {"primeStartAge": 28}}
    )

    assert report["reference"]["players"] == 500
    assert report["snapshotPolicy"] == {
        "selection": "earliest_supported_early_career_snapshot_per_player",
        "candidateLandmarks": 20,
        "evaluatedSnapshots": 10,
        "maximumSnapshotsPerPlayer": 1,
        "minimumPlayersForLiftEstimate": 30,
    }
    assert report["supportedEarly"]["players"] == 10
    assert report["supportedEarly"]["weightedEventRate"] == 0.2
    assert report["eligible"]["players"] == 5
    assert report["eligible"]["weightedEventRate"] == 0.4
    assert report["eligible"]["precisionLiftVsSupportedEarly"] is None
    assert (
        report["topEligibleTwentyPercentByProbabilityDelta"]
        ["precisionLiftVsSupportedEarly"]
        is None
    )
