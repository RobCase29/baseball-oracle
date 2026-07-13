from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from modeling.career_data import build_career_landmarks
from modeling.career_preview import (
    build_mlb_preview_players,
    build_preview_payload,
    build_prospect_forecasts,
    validate_preview_sanity,
)
from modeling.tests.test_career_data import season, standards


class ProbabilityModel:
    def predict_hof_probability(self, panel: pd.DataFrame) -> np.ndarray:
        return np.asarray(
            [0.6 if player == "active001" else 0.2 for player in panel["bbref_id"]],
            dtype=float,
        )

    def predict_distribution(
        self, panel: pd.DataFrame, peak_floor: np.ndarray | None = None
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        probability = self.predict_hof_probability(panel)
        final = self.final_war_model.predict_quantiles(panel)
        peak = self.peak_seven_model.predict_quantiles(panel)
        if peak_floor is not None:
            peak = np.maximum(peak, peak_floor[:, None])
        jaws = (final + peak) / 2.0
        margin = jaws - panel["standard_jaws"].to_numpy(dtype=float)[:, None]
        return probability, final, peak, jaws, margin, np.zeros(len(panel), dtype=float)


class QuantileModel:
    def __init__(self, anchor: str, increments: list[float]):
        self.anchor = anchor
        self.increments = np.asarray(increments, dtype=float)

    def predict_quantiles(self, panel: pd.DataFrame) -> np.ndarray:
        anchor = panel[self.anchor].to_numpy(dtype=float)
        return anchor[:, None] + self.increments[None, :]


def scoring_bundle() -> SimpleNamespace:
    value = ProbabilityModel()
    value.final_war_model = QuantileModel("career_war_to_date", [-2, 0, 2, 4, 8])
    value.peak_seven_model = QuantileModel("peak_seven_war_to_date", [-5, -1, 1, 3, 5])
    value.selected_entrant = "calibrated_ensemble"
    value.lineage = {"trainingCareerEndYear": 2010, "calibrationStartYear": 2011}
    return value


def active_inputs() -> tuple[pd.DataFrame, pd.DataFrame]:
    rows = [
        season("active001", 2024, 2.0, age=24),
        season("active001", 2025, 4.0, age=25),
        season("active001", 2026, 3.0, state="in_season", age=26),
        season("rookie001", 2026, 2.0, state="in_season", age=22),
    ]
    seasons = pd.DataFrame(rows)
    panel = build_career_landmarks(seasons, standards(), as_of_year=2026)
    return seasons, panel


def test_current_preview_uses_complete_features_and_surfaces_partial_actuals() -> None:
    seasons, panel = active_inputs()

    players, census = build_mlb_preview_players(
        panel, seasons, standards(), scoring_bundle()
    )

    assert census == {
        "season": 2026,
        "players": 2,
        "partialSeason": True,
        "censusSource": "season_participants",
    }
    assert [player["bbrefId"] for player in players] == ["active001", "rookie001"]
    veteran = players[0]
    assert veteran["rank"] == 1
    assert veteran["lineage"]["forecastFeatureSeason"] == 2025
    assert veteran["lineage"]["actualThroughSeason"] == 2026
    assert veteran["cumulativeWar"] == 9.0
    assert veteran["currentPeakSevenWar"] == 9.0
    assert veteran["peakSevenWar"]["p10"] == 6.0
    assert "partial_season_input" in veteran["warnings"]
    assert "forecast_features_exclude_current_partial_season" in veteran["warnings"]
    assert "current_scoring_refit_not_cross_fitted_or_evaluated" in veteran[
        "warnings"
    ]
    assert "early_hall_tail_not_learned_research_only" in veteran["warnings"]
    rookie = players[1]
    assert "partial_season_feature_fallback" in rookie["warnings"]
    assert rookie["publicationState"] == "withheld"
    assert rookie["peakSevenWar"] is None
    assert rookie["rank"] is None
    assert veteran["asOf"] == "2025-12-31T00:00:00.000Z"
    assert veteran["actualAsOf"].startswith("2026-")


def test_partial_2026_war_cannot_change_2025_terminal_forecast() -> None:
    seasons, panel = active_inputs()
    high_partial = seasons.copy()
    mask = high_partial["bbref_id"].eq("active001") & high_partial["season"].eq(2026)
    high_partial.loc[mask, ["b_war", "total_war"]] = 30.0
    high_panel = build_career_landmarks(
        high_partial, standards(), as_of_year=2026
    )

    baseline_players, _ = build_mlb_preview_players(
        panel, seasons, standards(), scoring_bundle()
    )
    changed_players, _ = build_mlb_preview_players(
        high_panel, high_partial, standards(), scoring_bundle()
    )
    baseline = next(
        player for player in baseline_players if player["bbrefId"] == "active001"
    )
    changed = next(
        player for player in changed_players if player["bbrefId"] == "active001"
    )

    for field in (
        "hofCaliberProbability",
        "finalCareerWar",
        "peakSevenWar",
        "finalJaws",
        "jawsMargin",
        "scenarioSupportExtensionJaws",
        "relativeSignal",
        "careerChapter",
        "alphaSignal",
    ):
        assert changed[field] == baseline[field]
    assert changed["forecastAsOf"] == baseline["forecastAsOf"]
    assert changed["cumulativeWar"] != baseline["cumulativeWar"]
    assert changed["currentPeakSevenWar"] != baseline["currentPeakSevenWar"]


def test_preview_discloses_exact_refit_does_not_inherit_tournament_metrics() -> None:
    seasons, panel = active_inputs()

    payload = build_preview_payload(
        as_of="2026-07-12T00:00:00Z",
        panel=panel,
        player_seasons=seasons,
        standards=standards(),
        tournament=SimpleNamespace(report={}),
        scoring_bundle=scoring_bundle(),
    )

    assert payload["currentScoringEvaluation"] == {
        "crossFitted": False,
        "evaluated": False,
        "inheritsTournamentMetrics": False,
        "scope": "exact final 2022 refit used for current MLB scoring",
    }
    assert any(
        "current-player probabilities do not inherit" in disclosure
        for disclosure in payload["disclosures"]
    )


def test_failed_rookie_discrimination_gate_withholds_early_mlb_rank() -> None:
    seasons, panel = active_inputs()
    bundle = scoring_bundle()
    bundle.lineage["withholdEarlyMlbRanking"] = True

    players, _ = build_mlb_preview_players(
        panel, seasons, standards(), bundle
    )

    veteran = next(player for player in players if player["bbrefId"] == "active001")
    assert veteran["stage"] == "early_mlb"
    assert veteran["publicationState"] == "withheld"
    assert veteran["rank"] is None
    assert veteran["hofCaliberProbability"] is None
    assert veteran["standardReference"] is not None
    assert "rookie_ranking_gate_failed_forecast_withheld" in veteran["warnings"]


def test_prospect_forecasts_are_unconditional_and_keyed_for_join() -> None:
    arrival = {
        "horizons": [12, 24, 36, 48, 60],
        "asOf": "2025-12-31",
        "status": "external_validation_failed_research_only",
        "estimates": {
            "123:hitter": {
                "age": 20,
                "probabilities": [0.1, 0.2, 0.4, 0.5, 0.6],
                "coldStart": False,
                "snapshotId": "snapshot-123",
            }
        },
    }
    bridge = [
        {
            "role": "hitter",
            "estimatedDebutAge": 22,
            "conditionalHofCaliberProbability": 0.1,
            "finalCareerWar": {"p10": 0, "p25": 5, "p50": 15, "p75": 30, "p90": 50},
            "peakSevenWar": {"p10": 0, "p25": 4, "p50": 12, "p75": 22, "p90": 35},
        }
    ]

    forecasts = build_prospect_forecasts(arrival, bridge)

    assert set(forecasts) == {"123:hitter"}
    forecast = forecasts["123:hitter"]
    assert forecast["arrivalProbability36"] == 0.4
    assert forecast["hofCaliberProbability"] == 0.06
    assert forecast["rank"] == 1
    assert forecast["rankScope"] == "prospect_arrival_bridge"
    assert forecast["decomposition"]["conditionalHofCaliberProbability"] == 0.1
    assert forecast["publicationState"] == "research"
    assert "bridge_baseline_not_direct_milb_to_hof_training" in forecast["warnings"]


def test_roster_census_includes_player_without_current_season_appearance() -> None:
    seasons, panel = active_inputs()
    inactive_row = season("roster001", 2025, 1.0, age=27)
    seasons = pd.concat([seasons, pd.DataFrame([inactive_row])], ignore_index=True)
    panel = build_career_landmarks(seasons, standards(), as_of_year=2026)
    roster = pd.DataFrame(
        [
            {
                "bbref_id": "active001",
                "player_name": "Active Player",
                "team_id": "AAA",
                "team_name": "Active Team",
                "age": 26,
                "is_active": True,
                "is_dl": False,
            },
            {
                "bbref_id": "roster001",
                "player_name": "Roster Player",
                "team_id": "BBB",
                "team_name": "Roster Team",
                "age": 28,
                "is_active": False,
                "is_dl": True,
            },
        ]
    )

    players, census = build_mlb_preview_players(
        panel, seasons, standards(), scoring_bundle(), roster
    )

    assert census["censusSource"] == "40_man_roster"
    assert census["players"] == 2
    rostered = next(player for player in players if player["bbrefId"] == "roster001")
    assert rostered["organization"] == "Roster Team"
    assert rostered["rosterStatus"] == "injured_list"
    assert rostered["publicationState"] == "withheld"
    assert rostered["rank"] is None
    assert "rostered_without_2026_mlb_appearance" in rostered["warnings"]


def test_two_way_forecast_is_withheld_without_preregistered_standard() -> None:
    two_way = season(
        "twoway99", 2026, 5.0, position="8/1", role="two_way", state="in_season", age=25
    )
    two_way["b_pa"] = 400
    two_way["b_war"] = 3.0
    two_way["p_ip_outs"] = 150
    two_way["p_war"] = 2.0
    seasons = pd.DataFrame([two_way])
    pseudo_complete = seasons.assign(season_state="complete")
    panel = build_career_landmarks(pseudo_complete, standards(), as_of_year=2026)

    players, _ = build_mlb_preview_players(
        panel, seasons, standards(), scoring_bundle()
    )

    assert players[0]["publicationState"] == "withheld"
    assert players[0]["rank"] is None
    assert players[0]["hofCaliberProbability"] is None
    assert players[0]["finalCareerWar"] is None
    assert "two_way_target_not_preregistered_forecast_withheld" in players[0]["warnings"]
    assert "hof_target_rebaselines_if_career_to_date_standard_changes" not in players[0][
        "warnings"
    ]
    assert "single_scenario_jaws_tail_support_extension" not in players[0]["warnings"]


def test_named_sanity_rejects_collapsed_young_star_interval() -> None:
    payload = {
        "players": [
            {
                "bbrefId": "wittbo02",
                "publicationState": "research",
                "hofCaliberProbability": 0.1,
                "finalCareerWar": {"p10": 40.0, "p50": 50.0, "p90": 70.0},
            }
        ]
    }
    validate_preview_sanity(payload)
    payload["players"][0]["finalCareerWar"]["p90"] = 45.0
    with pytest.raises(ValueError, match="underdispersed"):
        validate_preview_sanity(payload)
