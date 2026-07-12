from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from modeling.career_data import (
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
    CareerDataError,
    assert_feature_frame,
    build_career_landmarks,
    chronological_player_split,
    normalize_position,
    peak_seven,
    read_records,
)
from modeling.provenance import file_sha256
from modeling.train_career_tournament import _verify_manifest_output


def standards() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "position": position,
                "label": f"Avg {position}",
                "hof_player_count": 10,
                "career_war_standard": career,
                "peak_seven_war_standard": peak,
                "jaws_standard": jaws,
            }
            for position, career, peak, jaws in [
                ("C", 50, 30, 40),
                ("1B", 60, 40, 50),
                ("2B", 60, 40, 50),
                ("3B", 60, 40, 50),
                ("SS", 60, 40, 50),
                ("LF", 60, 40, 50),
                ("CF", 70, 50, 60),
                ("RF", 60, 40, 50),
                ("P", 65, 45, 55),
                ("RP", 35, 25, 30),
            ]
        ]
    )


def season(
    player: str,
    year: int,
    war: float,
    *,
    position: str = "*6/H",
    role: str = "hitter",
    state: str = "complete",
    age: int | None = None,
) -> dict:
    pitcher = role == "pitcher"
    return {
        "bbref_id": player,
        "player_name": f"Player {player}",
        "season": year,
        "season_state": state,
        "known_at": f"{year}-12-31",
        "age": age if age is not None else 22 + year % 10,
        "team": "TST",
        "position": position,
        "role": role,
        "b_pa": 0 if pitcher else 500,
        "b_war": 0 if pitcher else war,
        "p_ip_outs": 540 if pitcher else 0,
        "p_games": 30 if pitcher else 0,
        "p_games_started": 25 if pitcher else 0,
        "p_war": war if pitcher else 0,
        "total_war": war,
    }


def test_baseball_reference_compact_positions_prefer_real_defense() -> None:
    assert normalize_position("H8/79") == "CF"
    assert normalize_position("9D/H") == "RF"
    assert normalize_position("D3/5H") == "1B"
    assert normalize_position("D/H") == "DH"
    assert normalize_position("1") == "P"
    assert normalize_position("SS") == "SS"


def test_peak_seven_and_jaws_are_exact_and_point_in_time() -> None:
    rows = [season("alpha01", 1990 + index, float(index + 1)) for index in range(8)]
    panel = build_career_landmarks(pd.DataFrame(rows), standards(), as_of_year=2020)

    assert peak_seven(range(1, 9)) == 35.0
    assert panel.iloc[0]["career_war_to_date"] == 1.0
    assert panel.iloc[0]["peak_seven_war_to_date"] == 1.0
    assert panel.iloc[-1]["final_career_war"] == 36.0
    assert panel.iloc[-1]["final_peak_seven_war"] == 35.0
    assert panel.iloc[-1]["final_jaws"] == 35.5
    assert panel.iloc[0]["career_war_to_date"] != panel.iloc[-1]["career_war_to_date"]


def test_point_in_time_target_rebaselines_without_rewriting_standard_history() -> None:
    rows = [
        season("position01", 1990, 25.0, position="2", age=22),
        season("position01", 1991, 25.0, position="8", age=23),
    ]
    panel = build_career_landmarks(pd.DataFrame(rows), standards(), as_of_year=2020)

    assert panel.loc[0, "position"] == "C"
    assert panel.loc[0, "standard_key"] == "C"
    assert panel.loc[0, "standard_jaws"] == 40.0
    assert panel.loc[1, "position"] == "CF"
    assert panel.loc[1, "standard_key"] == "CF"
    assert panel.loc[1, "standard_jaws"] == 60.0
    assert panel["target_standard_key"].tolist() == ["CF", "CF"]
    assert panel["target_standard_jaws"].tolist() == [60.0, 60.0]
    assert panel["hof_caliber"].astype(int).tolist() == [1, 0]
    assert panel["hof_caliber_completed_standard"].astype(int).tolist() == [0, 0]


def test_pitcher_target_rebaselines_from_relief_to_starting_standard() -> None:
    relief = season("rolebase01", 1990, 20.0, position="1", role="pitcher", age=22)
    relief["p_games"] = 80
    relief["p_games_started"] = 0
    starter = season("rolebase01", 1991, 20.0, position="1", role="pitcher", age=23)
    starter["p_games"] = 80
    starter["p_games_started"] = 80
    panel = build_career_landmarks(
        pd.DataFrame([relief, starter]), standards(), as_of_year=2020
    )

    assert panel["standard_key"].tolist() == ["RP", "P"]
    assert panel["standard_jaws"].tolist() == [30.0, 55.0]
    assert panel["hof_caliber"].astype(int).tolist() == [1, 0]


def test_unresolved_and_in_season_careers_are_strictly_masked() -> None:
    rows = [
        season("retired01", 2010, 3.0),
        season("recent01", 2024, 3.0),
        season("active01", 2025, 3.0),
        season("active01", 2026, 1.0, state="in_season"),
    ]
    panel = build_career_landmarks(
        pd.DataFrame(rows), standards(), as_of_year=2026, inactivity_years=3
    )

    retired = panel.loc[panel["bbref_id"].eq("retired01")].iloc[0]
    assert bool(retired["resolved_career"]) is True
    assert pd.notna(retired["final_career_war"])
    unresolved = panel.loc[panel["bbref_id"].isin(["recent01", "active01"])]
    assert not unresolved["resolved_career"].any()
    assert unresolved[
        ["final_career_war", "final_peak_seven_war", "final_jaws", "hof_caliber"]
    ].isna().all(axis=None)


def test_three_subsequent_complete_seasons_are_required_for_resolution() -> None:
    rows = [
        season("threefull", 2022, 1.0),
        season("onlytwo0", 2023, 1.0),
    ]
    panel = build_career_landmarks(
        pd.DataFrame(rows), standards(), as_of_year=2025, inactivity_years=3
    ).set_index("bbref_id")

    assert bool(panel.loc["threefull", "resolved_career"]) is True
    assert bool(panel.loc["onlytwo0", "resolved_career"]) is False


def test_jaws_value_basis_excludes_cross_side_war() -> None:
    pitcher = season("pitchside1", 1990, 4.0, position="1", role="pitcher")
    pitcher["b_war"] = 20.0
    pitcher["total_war"] = 24.0
    hitter = season("hitside01", 1990, 4.0, position="6", role="hitter")
    hitter["p_war"] = 20.0
    hitter["p_ip_outs"] = 3
    hitter["p_games"] = 1
    hitter["total_war"] = 24.0

    panel = build_career_landmarks(
        pd.DataFrame([pitcher, hitter]), standards(), as_of_year=2020
    ).set_index("bbref_id")

    assert panel.loc["pitchside1", "role"] == "pitcher"
    assert panel.loc["pitchside1", "career_war_to_date"] == 4.0
    assert panel.loc["pitchside1", "final_career_war"] == 4.0
    assert panel.loc["hitside01", "role"] == "hitter"
    assert panel.loc["hitside01", "career_war_to_date"] == 4.0
    assert panel.loc["hitside01", "final_career_war"] == 4.0


def test_pitcher_batting_appearances_do_not_create_false_two_way_career() -> None:
    rows: list[dict] = []
    for offset in range(8):
        pitcher = season(
            "pitchbat01", 1990 + offset, 4.0, position="1/H", role="pitcher", age=23 + offset
        )
        pitcher["b_pa"] = 70
        pitcher["b_war"] = 0.2
        pitcher["total_war"] = 4.2
        rows.append(pitcher)
    rows[0]["b_pa"] = 200
    rows[0]["p_ip_outs"] = 750
    two_way = season("twoway01", 1998, 5.0, position="8/1", role="two_way", age=24)
    two_way["b_pa"] = 400
    two_way["b_war"] = 3.0
    two_way["p_ip_outs"] = 150
    two_way["p_war"] = 2.0
    two_way["total_war"] = 5.0
    rows.append(two_way)

    panel = build_career_landmarks(pd.DataFrame(rows), standards(), as_of_year=2020)

    assert set(panel.loc[panel["bbref_id"].eq("pitchbat01"), "role"]) == {"pitcher"}
    assert set(panel.loc[panel["bbref_id"].eq("twoway01"), "role"]) == {"two_way"}


def test_feature_contract_rejects_target_fields() -> None:
    assert "season" not in NUMERIC_FEATURES
    valid = pd.DataFrame(columns=[*NUMERIC_FEATURES, *CATEGORICAL_FEATURES])
    assert_feature_frame(valid)
    with pytest.raises(CareerDataError, match="Target-only"):
        assert_feature_frame(valid.assign(final_career_war=[]))


def test_chronological_split_is_player_disjoint_and_ordered() -> None:
    rows: list[dict] = []
    for index in range(36):
        end_year = 1950 + index
        player = f"split{index:04d}"
        rows.append(season(player, end_year, 60.0 if index % 8 == 0 else 1.0))
    panel = build_career_landmarks(pd.DataFrame(rows), standards(), as_of_year=2020)
    split = chronological_player_split(panel, minimum_players_per_split=3)

    train = set(split.train_players)
    calibration = set(split.calibration_players)
    test = set(split.test_players)
    assert not train & calibration
    assert not train & test
    assert not calibration & test
    assert split.train_end_year < split.calibration_start_year
    assert split.calibration_end_year < split.test_start_year


def test_read_records_supports_wrapped_json_and_csv(tmp_path) -> None:
    wrapped = tmp_path / "rows.json"
    wrapped.write_text(json.dumps({"rows": [{"value": 1}]}), encoding="utf-8")
    csv = tmp_path / "rows.csv"
    csv.write_text("value\n1\n", encoding="utf-8")

    assert read_records(wrapped).to_dict("records") == [{"value": 1}]
    assert read_records(csv).to_dict("records") == [{"value": 1}]


def test_training_manifest_output_verification_fails_closed(tmp_path) -> None:
    path = tmp_path / "rows.json"
    path.write_text("[]\n", encoding="utf-8")
    manifest = {
        "outputs": [
            {
                "path": str(path.resolve()),
                "byteLength": path.stat().st_size,
                "sha256": file_sha256(path),
            }
        ]
    }

    assert _verify_manifest_output(manifest, path)["sha256"] == file_sha256(path)
    path.write_text("[{}]\n", encoding="utf-8")
    with pytest.raises(ValueError, match="byte length mismatch|SHA-256 mismatch"):
        _verify_manifest_output(manifest, path)


def test_career_war_leakage_validator_detects_future_rewrite() -> None:
    rows = [season("leak0001", 1990, 1.0), season("leak0001", 1991, 2.0)]
    panel = build_career_landmarks(pd.DataFrame(rows), standards(), as_of_year=2020)
    panel.loc[0, "career_war_to_date"] = 3.0
    from modeling.career_data import validate_landmark_panel

    with pytest.raises(CareerDataError, match="future-season leakage"):
        validate_landmark_panel(panel)
