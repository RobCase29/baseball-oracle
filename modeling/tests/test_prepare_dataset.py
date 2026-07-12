import json

import pandas as pd
import pytest

from modeling.prepare_dataset import (
    ROOT,
    aggregate_career_outcomes,
    build_labels,
    categorical,
    exact_age,
    infer_role,
    lahman_player_ids,
    parse_draft,
    portable_path,
    source_hash,
    verify_locked_raw_inputs,
)


def test_exact_age_uses_snapshot_date() -> None:
    age = exact_age(pd.Timestamp("2000-07-01"), pd.Timestamp("2020-01-01"))
    assert age is not None
    assert 19.49 < age < 19.51


def test_role_inference_handles_two_way_players() -> None:
    assert infer_role("RHP") == "pitcher"
    assert infer_role("SS") == "hitter"
    assert infer_role("P/OF") == "two_way"


def test_draft_parser_separates_international_signings() -> None:
    assert parse_draft("2019 J2 (NYY)") == (2019.0, None, "international")
    assert parse_draft("2021 Draft Rd 2") == (2021.0, 2.0, "draft")


def test_categorical_normalization_prevents_mixed_parquet_types() -> None:
    assert categorical(1) == "1"
    assert categorical(" Low ") == "Low"
    assert categorical(0) is None
    assert categorical("None") is None
    assert categorical(None) is None


def test_manifest_paths_support_repo_and_external_outputs() -> None:
    assert portable_path(ROOT / "data/example.parquet") == "data/example.parquet"
    assert portable_path(ROOT.parent / "external.parquet") == str(
        (ROOT.parent / "external.parquet").resolve()
    )


def test_lahman_and_bbref_namespaces_cannot_overwrite_each_other() -> None:
    snapshots = pd.DataFrame(
        [
            {
                "snapshot_id": "snapshot-1",
                "player_id": "player-1",
                "bbref_id": "shared01",
                "as_of": pd.Timestamp("2021-12-31"),
            }
        ]
    )
    people = pd.DataFrame(
        [
            {"playerID": "shared01", "bbrefID": "other01", "debut": "2024-03-30"},
            {"playerID": "actual01", "bbrefID": "shared01", "debut": "2022-06-14"},
        ]
    )
    register = pd.DataFrame(
        [{"key_uuid": "player-1", "key_retro": "retro001", "mlb_played_first": "2022"}]
    )

    labels, quality = build_labels(
        snapshots,
        people,
        register,
        {"retro001": pd.Timestamp("2022-06-14")},
    )

    assert labels.iloc[0]["debut_date"] == pd.Timestamp("2022-06-14")
    assert labels.iloc[0]["debut_source"] == "lahman+retrosheet"
    assert quality["dual_source_exact_matches"] == 1


def test_lahman_identity_mapping_never_treats_lahman_id_as_bbref_id() -> None:
    register = pd.DataFrame(
        [
            {
                "key_uuid": "wrong-player",
                "key_bbref": "shared01",
                "key_retro": None,
            }
        ]
    )
    people = pd.DataFrame(
        [
            {
                "playerID": "shared01",
                "bbrefID": None,
                "retroID": None,
            }
        ]
    )

    assert lahman_player_ids(register, people) == {}


def test_lahman_identity_mapping_quarantines_many_to_one_matches() -> None:
    register = pd.DataFrame(
        [
            {
                "key_uuid": "ambiguous-player",
                "key_bbref": "first01",
                "key_retro": "retro001",
            }
        ]
    )
    people = pd.DataFrame(
        [
            {"playerID": "lahman01", "bbrefID": "first01", "retroID": None},
            {"playerID": "lahman02", "bbrefID": None, "retroID": "retro001"},
        ]
    )

    assert lahman_player_ids(register, people) == {}


def test_horizon_event_after_data_cutoff_remains_censored() -> None:
    snapshots = pd.DataFrame(
        [
            {
                "snapshot_id": "snapshot-future",
                "player_id": "player-future",
                "bbref_id": "future01",
                "as_of": pd.Timestamp("2024-12-31"),
            }
        ]
    )
    people = pd.DataFrame(
        [
            {
                "playerID": "future01",
                "bbrefID": "future01",
                "debut": "2026-06-01",
            }
        ]
    )
    register = pd.DataFrame(
        [
            {
                "key_uuid": "player-future",
                "key_retro": None,
                "mlb_played_first": "2026",
            }
        ]
    )

    labels, _ = build_labels(snapshots, people, register, {})

    assert labels.iloc[0]["censor_state"] == "right_censored"
    assert not labels.iloc[0]["observed_24m"]
    assert pd.isna(labels.iloc[0]["debut_within_24m"])
    for months in (12, 24, 36, 48, 60):
        assert str(labels[f"observed_{months}m"].dtype) == "boolean"
        assert str(labels[f"debut_within_{months}m"].dtype) == "boolean"


def test_missing_debut_date_keeps_datetime_schema() -> None:
    snapshots = pd.DataFrame(
        [
            {
                "snapshot_id": "snapshot-censored",
                "player_id": "player-censored",
                "bbref_id": "censored01",
                "as_of": pd.Timestamp("2025-12-31"),
            }
        ]
    )
    people = pd.DataFrame(
        [{"playerID": "censored01", "bbrefID": "censored01", "debut": None}]
    )
    register = pd.DataFrame(
        [
            {
                "key_uuid": "player-censored",
                "key_retro": None,
                "mlb_played_first": None,
            }
        ]
    )

    labels, _ = build_labels(snapshots, people, register, {})

    assert str(labels["debut_date"].dtype) == "datetime64[ns]"
    assert pd.isna(labels.iloc[0]["debut_date"])


def test_hall_of_fame_inductions_respect_cutoff_and_non_inducted_remain_censored() -> None:
    people = pd.DataFrame(
        [
            {"playerID": "inducted01", "bbrefID": "inducted01", "debut": "1980-04-01", "finalGame": "2000-09-30"},
            {"playerID": "future01", "bbrefID": "future01", "debut": "1985-04-01", "finalGame": "2000-09-30"},
            {"playerID": "inactive01", "bbrefID": "inactive01", "debut": "1990-04-01", "finalGame": "2000-09-30"},
        ]
    )
    batting_columns = [
        "playerID", "yearID", "G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "BB", "SO", "HBP", "SF"
    ]
    batting = pd.DataFrame(
        [
            ["inducted01", "2000", 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ["future01", "2000", 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ["inactive01", "2000", 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ],
        columns=batting_columns,
    )
    pitching = pd.DataFrame(
        columns=["playerID", "yearID", "W", "L", "G", "GS", "CG", "SHO", "SV", "IPouts", "H", "ER", "HR", "BB", "SO"]
    )
    hall = pd.DataFrame(
        [
            {
                "playerID": "inducted01",
                "yearid": "2005",
                "inducted": "Y",
                "category": "Player",
            },
            {
                "playerID": "future01",
                "yearid": "2026",
                "inducted": "Y",
                "category": "Player",
            },
        ]
    )

    outcomes = aggregate_career_outcomes(
        people,
        batting,
        pitching,
        hall,
        {"inducted01": "uuid-1", "future01": "uuid-2", "inactive01": "uuid-3"},
    ).set_index("lahman_id")

    assert outcomes.loc["inducted01", "hall_of_fame_inducted"]
    assert outcomes.loc["inducted01", "hall_of_fame_outcome_state"] == "inducted"
    assert outcomes.loc["inducted01", "source_hall_of_fame_induction_year"] == 2005
    assert pd.isna(outcomes.loc["future01", "hall_of_fame_inducted"])
    assert (
        outcomes.loc["future01", "hall_of_fame_outcome_state"]
        == "inactive_not_inducted_censored"
    )
    assert outcomes.loc["future01", "source_hall_of_fame_induction_year"] == 2026
    assert pd.isna(outcomes.loc["inactive01", "hall_of_fame_inducted"])
    assert outcomes.loc["inactive01", "hall_of_fame_outcome_state"] == "inactive_not_inducted_censored"
    assert pd.isna(outcomes.loc["inactive01", "source_hall_of_fame_induction_year"])


def test_hall_of_fame_player_induction_requires_a_numeric_year() -> None:
    people = pd.DataFrame(
        [
            {
                "playerID": "inducted01",
                "bbrefID": "inducted01",
                "debut": "1980-04-01",
                "finalGame": "2000-09-30",
            }
        ]
    )
    batting = pd.DataFrame(
        [["inducted01", "2000", 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        columns=[
            "playerID", "yearID", "G", "AB", "R", "H", "2B", "3B", "HR", "RBI",
            "SB", "BB", "SO", "HBP", "SF",
        ],
    )
    pitching = pd.DataFrame(
        columns=[
            "playerID", "yearID", "W", "L", "G", "GS", "CG", "SHO", "SV",
            "IPouts", "H", "ER", "HR", "BB", "SO",
        ]
    )
    hall = pd.DataFrame(
        [
            {
                "playerID": "inducted01",
                "yearid": "not-a-year",
                "inducted": "Y",
                "category": "Player",
            }
        ]
    )

    with pytest.raises(ValueError, match="require a numeric yearid"):
        aggregate_career_outcomes(people, batting, pitching, hall, {})


def test_raw_input_verification_detects_post_acquisition_tampering(tmp_path) -> None:
    raw_root = tmp_path / "raw"
    raw_input = raw_root / "source" / "input.csv"
    raw_input.parent.mkdir(parents=True)
    raw_input.write_text("player_id\nplayer-1\n")
    locked_resource = {
        "bytes": raw_input.stat().st_size,
        "sha256": source_hash(raw_input),
        "url": "https://example.test/input.csv",
    }
    lock_path = tmp_path / "source-lock.json"
    lock_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "sources": {
                    "test-source": {
                        "resources": {"input.csv": locked_resource},
                    }
                },
            }
        )
    )
    run_path = tmp_path / "acquisition.json"
    run_path.write_text(
        json.dumps(
            {
                "acquiredAt": "2026-07-11T00:00:00Z",
                "sourceLock": {"sha256": source_hash(lock_path)},
                "resources": [
                    {
                        **locked_resource,
                        "source": "test-source",
                        "key": "input.csv",
                        "path": str(raw_input),
                    }
                ],
            }
        )
    )

    evidence = verify_locked_raw_inputs(raw_root, lock_path, run_path)
    assert evidence["resources"] == 1

    raw_input.write_text("player_id\nplayer-2\n")
    with pytest.raises(ValueError, match="missing or modified"):
        verify_locked_raw_inputs(raw_root, lock_path, run_path)
