from __future__ import annotations

import pandas as pd
import pytest

from modeling.risk_set import (
    BREF_MEMBERSHIP_DATE_IMPUTATION_BASIS,
    CENSUS_METADATA_COLUMNS,
    PLAYER_SEASON_COLUMNS,
    PRIOR_STAT_FEATURES,
    ROSTER_CENSUS_COLUMNS,
    RiskSetContractError,
    build_affiliated_risk_set,
    canonicalize_baseball_reference_appearances,
    infer_bref_aggregate_role,
    validate_canonical_inputs,
)
from modeling.prepare_dataset import (
    affiliated_release_blockers,
    read_canonical_table,
    source_universe_manifest_metadata,
)


def census_metadata(**overrides: object) -> pd.DataFrame:
    row: dict[str, object] = {
        "census_id": "2022-close",
        "season": 2022,
        "as_of": "2022-12-31",
        "source": "authorized-historical-milb-feed",
        "cohort_basis": "season_appearance",
        "coverage_scope": "all_affiliated_season_participants_on_observed_teams",
        "completeness_attested": True,
        "expected_team_count": 2,
        "observed_team_count": 2,
        "inclusion_rule": "all players with an appearance for every observed affiliated team",
    }
    row.update(overrides)
    return pd.DataFrame([row], columns=CENSUS_METADATA_COLUMNS)


def roster_census() -> pd.DataFrame:
    rows = [
        {
            "census_id": "2022-close",
            "source_id_namespace": "mlbam",
            "source_player_id": "1001",
            "player_name": "Real Prospect",
            "organization": "NYY",
            "team_id": "AAA-NYY",
            "level": "AAA",
            "roster_status": "season_participant",
            "role": "hitter",
            "position": "SS",
            "birth_date": "2000-06-15",
            "bats": "R",
            "throws": "R",
            "height_inches": 72,
            "weight_pounds": 190,
            "draft_year": 2019,
            "draft_round": 2,
            "acquisition_type": "draft",
            "first_observed_on_team": "2022-04-05",
            "last_observed_on_team": "2022-09-20",
        },
        {
            "census_id": "2022-close",
            "source_id_namespace": "mlbam",
            "source_player_id": "unmatched-2",
            "player_name": "Unmatched Prospect",
            "organization": "BOS",
            "team_id": "AA-BOS",
            "level": "AA",
            "roster_status": "season_participant",
            "role": "pitcher",
            "position": "RHP",
            "birth_date": None,
            "bats": "R",
            "throws": "R",
            "height_inches": None,
            "weight_pounds": None,
            "draft_year": None,
            "draft_round": None,
            "acquisition_type": "international",
            "first_observed_on_team": "2022-05-01",
            "last_observed_on_team": "2022-08-30",
        },
    ]
    return pd.DataFrame(rows, columns=ROSTER_CENSUS_COLUMNS)


def player_seasons(*, stats_through: str = "2022-09-30") -> pd.DataFrame:
    row: dict[str, object] = {
        "source_id_namespace": "mlbam",
        "source_player_id": "1001",
        "season": 2022,
        "stats_through": stats_through,
        **{feature: None for feature in PRIOR_STAT_FEATURES},
    }
    row.update(
        {
            "prior_g": 120,
            "prior_pa": 510,
            "prior_ab": 455,
            "prior_hr": 18,
            "prior_bb": 48,
            "prior_so": 102,
            "prior_sb": 14,
            "prior_bb_rate": 0.094,
            "prior_k_rate": 0.2,
            "prior_k_minus_bb_rate": -0.106,
            "prior_iso": 0.17,
            "prior_babip": 0.31,
            "prior_wrc_plus": 121,
        }
    )
    return pd.DataFrame([row], columns=PLAYER_SEASON_COLUMNS)


def register() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "key_uuid": "uuid-1001",
                "key_mlbam": "1001",
                "key_bbref_minors": "minor-1001",
                "key_fangraphs": "fg-1001",
                "key_bbref": "major01",
            }
        ]
    )


def board_snapshots() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "snapshot_id": "fg:2022:fg-1001:hitter",
                "player_id": "uuid-1001",
                "edition": 2022,
                "as_of": pd.Timestamp("2022-12-31"),
                "role": "hitter",
                "player_name": "Real Prospect",
                "future_value": 50,
                "risk": "medium",
            }
        ]
    )


def bref_player_team_seasons() -> pd.DataFrame:
    base = {
        "source_id_namespace": "bbref_minors",
        "source_player_id": "minor-1001",
        "season": "2022",
        "organization": "NYY",
        "level": "AA",
        "player_name": "Real Prospect",
        "roster_status": "season_participant",
        "role": "hitter",
        "position": "SS",
        "birth_date": "2000-06-15",
        "bats": "R",
        "throws": "R",
        "height_inches": "72",
        "weight_pounds": "190",
        "first_observed_on_team": "2022-04-05",
        "last_observed_on_team": "2022-07-15",
        "batting_G": "40",
        "batting_PA": "170",
        "batting_AB": "150",
        "batting_H": "45",
        "batting_2B": "8",
        "batting_3B": "2",
        "batting_HR": "5",
        "batting_BB": "15",
        "batting_SO": "30",
        "batting_SB": "6",
        "batting_SF": "2",
    }
    return pd.DataFrame(
        [
            {**base, "team_id": "AA-NYY"},
            {
                **base,
                "team_id": "AAA-NYY",
                "level": "AAA",
                "first_observed_on_team": "2022-07-16",
                "last_observed_on_team": "2022-09-20",
                "batting_G": "30",
                "batting_PA": "130",
                "batting_AB": "110",
                "batting_H": "33",
                "batting_2B": "6",
                "batting_3B": "1",
                "batting_HR": "4",
                "batting_BB": "14",
                "batting_SO": "20",
                "batting_SB": "3",
                "batting_SF": "1",
            },
        ]
    )


def bref_quality(*, complete: bool = True) -> dict[str, object]:
    return {
        "schemaVersion": "baseball-reference-register-quality/v1",
        "season": 2022,
        "structuralZeroSeason": False,
        "declaredTeamCount": 2,
        "observedTeamCount": 2 if complete else 1,
        "complete": complete,
        "censusAttested": False,
        "sharedAffiliateTeamCount": 1,
    }


def bref_teams() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "season": "2022",
                "team_id": "AA-NYY",
                "organization": "NYY",
                "level": "AA",
                "source_url": (
                    "https://www.baseball-reference.com/register/team.cgi?id=AA-NYY"
                ),
            },
            {
                "season": "2022",
                "team_id": "AAA-NYY",
                "organization": "NYY | COOP",
                "level": "AAA",
                "source_url": (
                    "https://www.baseball-reference.com/register/team.cgi?id=AAA-NYY"
                ),
            },
        ]
    )


def bref_team_organizations() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"season": "2022", "team_id": "AA-NYY", "organization": "NYY"},
            {"season": "2022", "team_id": "AAA-NYY", "organization": "NYY"},
            {"season": "2022", "team_id": "AAA-NYY", "organization": "COOP"},
        ]
    )


def test_complete_census_preserves_unmatched_players_in_denominator() -> None:
    snapshots, quality = build_affiliated_risk_set(
        census_metadata(),
        roster_census(),
        player_seasons(),
        register(),
        board_snapshots(),
        include_edition_only_board_features=True,
    )
    snapshots = snapshots.set_index("source_player_id")

    assert len(snapshots) == 2
    assert snapshots.loc["1001", "player_id"] == "uuid-1001"
    assert snapshots.loc["1001", "prior_pa"] == 510
    assert snapshots.loc["1001", "prior_stats_through"] == pd.Timestamp("2022-09-30")
    assert snapshots.loc["1001", "on_fangraphs_board"]
    assert snapshots.loc["1001", "future_value"] == 50
    assert pd.isna(snapshots.loc["unmatched-2", "player_id"])
    assert not snapshots.loc["unmatched-2", "identity_resolved"]
    assert quality["census_rows"] == 2
    assert quality["resolved_identity_rows"] == 1
    assert quality["unresolved_identity_rows"] == 1
    assert quality["identity_resolution_rate"] == 0.5
    assert not quality["strict_point_in_time_features"]
    assert source_universe_manifest_metadata(snapshots.reset_index()) == {
        "source_universe_scope": "full_season_appearance_census"
    }


def test_dated_roster_manifest_uses_its_validated_source_universe_scope() -> None:
    metadata = census_metadata(
        cohort_basis="dated_roster",
        coverage_scope="all_affiliated_roster_members_at_landmark",
        inclusion_rule="all affiliated roster members active at the landmark",
    )
    roster = roster_census()
    roster.loc[:, "last_observed_on_team"] = "2023-01-31"

    snapshots, _ = build_affiliated_risk_set(
        metadata,
        roster,
        player_seasons(),
        register(),
    )

    assert source_universe_manifest_metadata(snapshots) == {
        "source_universe_scope": "full_dated_roster_census"
    }


def test_mixed_census_manifest_lists_each_validated_source_universe_scope() -> None:
    appearance_metadata = census_metadata()
    dated_metadata = census_metadata(
        census_id="2023-midyear",
        season=2023,
        as_of="2023-06-30",
        source="authorized-historical-milb-roster-feed",
        cohort_basis="dated_roster",
        coverage_scope="all_affiliated_roster_members_at_landmark",
        inclusion_rule="all affiliated roster members active at the landmark",
    )
    metadata = pd.concat([appearance_metadata, dated_metadata], ignore_index=True)
    appearance_roster = roster_census()
    dated_roster = roster_census()
    dated_roster.loc[:, "census_id"] = "2023-midyear"
    dated_roster.loc[:, "last_observed_on_team"] = "2023-07-31"
    roster = pd.concat([appearance_roster, dated_roster], ignore_index=True)

    snapshots, _ = build_affiliated_risk_set(
        metadata,
        roster,
        player_seasons(),
        register(),
    )

    assert source_universe_manifest_metadata(snapshots) == {
        "source_universe_scope": "mixed_affiliated_census_scopes",
        "source_universe_scopes": [
            {
                "cohort_basis": "dated_roster",
                "source_universe_scope": "full_dated_roster_census",
            },
            {
                "cohort_basis": "season_appearance",
                "source_universe_scope": "full_season_appearance_census",
            },
        ],
    }


def test_bref_release_blockers_name_missing_season_lock_lineage() -> None:
    blockers = affiliated_release_blockers(
        using_bref_adapter=True,
        unresolved_identity_rows=0,
    )

    assert any("versioned season archive lock" in blocker for blocker in blockers)
    assert not any("identities are unresolved" in blocker for blocker in blockers)
    assert not any("acquisition source lock" in blocker for blocker in blockers)


def test_canonical_release_blockers_report_measured_unresolved_identities() -> None:
    blockers = affiliated_release_blockers(
        using_bref_adapter=False,
        unresolved_identity_rows=7,
    )

    assert any("acquisition source lock" in blocker for blocker in blockers)
    assert any(blocker.startswith("7 affiliated census identities") for blocker in blockers)


def test_baseball_reference_adapter_builds_an_explicit_appearance_cohort() -> None:
    source_rows = bref_player_team_seasons()
    zero_game = source_rows.iloc[[0]].copy()
    zero_game.loc[:, "source_player_id"] = "zero-game-1"
    zero_game.loc[:, "player_name"] = "Zero Game Roster Entry"
    zero_game.loc[:, "first_observed_on_team"] = "9999-12-31"
    zero_game.loc[:, "last_observed_on_team"] = ""
    for column in [
        "batting_G",
        "batting_PA",
        "batting_AB",
        "batting_H",
        "batting_2B",
        "batting_3B",
        "batting_HR",
        "batting_BB",
        "batting_SO",
        "batting_SB",
        "batting_SF",
    ]:
        zero_game.loc[:, column] = "0"
    source_rows = pd.concat([source_rows, zero_game], ignore_index=True)
    metadata, roster, seasons = canonicalize_baseball_reference_appearances(
        source_rows,
        bref_quality(),
        bref_teams(),
        bref_team_organizations(),
    )
    validated_metadata, validated_roster, validated_seasons = validate_canonical_inputs(
        metadata,
        roster,
        seasons,
    )

    assert validated_metadata.iloc[0]["cohort_basis"] == "season_appearance"
    assert validated_metadata.iloc[0]["coverage_scope"] == (
        "all_affiliated_season_participants_on_observed_teams"
    )
    assert len(validated_roster) == 2
    assert len(validated_seasons) == 1
    assert validated_seasons.iloc[0]["prior_pa"] == 300
    assert validated_seasons.iloc[0]["prior_hr"] == 9
    assert validated_seasons.iloc[0]["prior_batting_pa"] == 300
    assert validated_seasons.iloc[0]["role_inference_basis"] == (
        "position_player_with_incidental_or_no_pitching"
    )
    assert validated_seasons.iloc[0]["stats_through"] == pd.Timestamp("2022-09-20")
    assert set(validated_roster["organization"]) == {"NYY", "COOP | NYY"}
    assert metadata.attrs["adapter_quality"]["excluded_zero_game_roster_rows"] == 1
    assert metadata.iloc[0]["expected_team_count"] == 2
    assert metadata.iloc[0]["observed_team_count"] == 2
    assert metadata.attrs["adapter_quality"]["source_declared_team_count"] == 2
    assert metadata.attrs["adapter_quality"]["source_observed_team_pages"] == 2
    assert metadata.attrs["adapter_quality"]["appearance_data_team_count"] == 2
    assert metadata.attrs["adapter_quality"]["declared_no_record_teams"] == 0
    assert metadata.attrs["adapter_quality"]["membership_date_imputation_rows"] == 0
    assert metadata.attrs["adapter_quality"]["membership_date_imputation_values"] == 0

    snapshots, risk_quality = build_affiliated_risk_set(
        metadata,
        roster,
        seasons,
        register(),
    )
    assert len(snapshots) == 1
    assert snapshots.iloc[0]["membership_stint_count"] == 2
    assert snapshots.iloc[0]["organizations"] == "COOP | NYY"
    assert risk_quality["collapsed_membership_rows"] == 1
    assert risk_quality["source_adapter_quality"][
        "cooperative_affiliate_teams"
    ] == 1


def test_baseball_reference_adapter_normalizes_exact_missing_birth_date_sentinel() -> None:
    source_rows = bref_player_team_seasons()
    source_rows.loc[:, "birth_date"] = "XXXX-XX-XX"
    metadata, roster, seasons = canonicalize_baseball_reference_appearances(
        source_rows,
        bref_quality(),
        bref_teams(),
        bref_team_organizations(),
    )

    _, validated_roster, _ = validate_canonical_inputs(metadata, roster, seasons)

    assert validated_roster["birth_date"].isna().all()


def test_baseball_reference_adapter_does_not_normalize_arbitrary_invalid_birth_date() -> None:
    source_rows = bref_player_team_seasons()
    source_rows.loc[source_rows.index[-1], "birth_date"] = "not-a-date"
    metadata, roster, seasons = canonicalize_baseball_reference_appearances(
        source_rows,
        bref_quality(),
        bref_teams(),
        bref_team_organizations(),
    )

    with pytest.raises(
        RiskSetContractError,
        match="roster birth_date contains invalid dates",
    ):
        validate_canonical_inputs(metadata, roster, seasons)


def test_bref_adapter_imputes_exact_membership_sentinel_and_blank_to_boundary() -> None:
    source_rows = bref_player_team_seasons()
    anomaly = source_rows.index[-1]
    source_rows.loc[anomaly, "first_observed_on_team"] = "9999-12-31"
    source_rows.loc[anomaly, "last_observed_on_team"] = ""

    metadata, roster, seasons = canonicalize_baseball_reference_appearances(
        source_rows,
        bref_quality(),
        bref_teams(),
        bref_team_organizations(),
    )
    _, validated_roster, validated_seasons = validate_canonical_inputs(
        metadata, roster, seasons
    )

    normalized = validated_roster.loc[validated_roster["team_id"].eq("AAA-NYY")].iloc[0]
    assert normalized["first_observed_on_team"] == pd.Timestamp("2022-12-31")
    assert normalized["last_observed_on_team"] == pd.Timestamp("2022-12-31")
    assert validated_seasons.iloc[0]["stats_through"] == pd.Timestamp("2022-12-31")

    quality = metadata.attrs["adapter_quality"]
    assert quality["membership_date_imputation_basis"] == (
        BREF_MEMBERSHIP_DATE_IMPUTATION_BASIS
    )
    assert quality["membership_date_imputation_boundary"] == "2022-12-31"
    assert quality["membership_date_imputation_rows"] == 1
    assert quality["membership_date_imputation_values"] == 2
    assert quality["membership_date_sentinel_values"] == 1
    assert quality["membership_date_missing_values"] == 1
    assert quality["first_observed_on_team_imputed_values"] == 1
    assert quality["last_observed_on_team_imputed_values"] == 1

    _, risk_quality = build_affiliated_risk_set(
        metadata,
        roster,
        seasons,
        register(),
    )
    assert risk_quality["source_adapter_quality"][
        "membership_date_imputation_rows"
    ] == 1


def test_bref_adapter_preserves_valid_membership_date_when_companion_is_missing() -> None:
    source_rows = bref_player_team_seasons()
    anomaly = source_rows.index[-1]
    source_rows.loc[anomaly, "last_observed_on_team"] = None

    metadata, roster, seasons = canonicalize_baseball_reference_appearances(
        source_rows,
        bref_quality(),
        bref_teams(),
        bref_team_organizations(),
    )
    _, validated_roster, _ = validate_canonical_inputs(metadata, roster, seasons)

    normalized = validated_roster.loc[validated_roster["team_id"].eq("AAA-NYY")].iloc[0]
    assert normalized["first_observed_on_team"] == pd.Timestamp("2022-07-16")
    assert normalized["last_observed_on_team"] == pd.Timestamp("2022-12-31")
    quality = metadata.attrs["adapter_quality"]
    assert quality["membership_date_imputation_rows"] == 1
    assert quality["membership_date_imputation_values"] == 1
    assert quality["membership_date_sentinel_values"] == 0
    assert quality["membership_date_missing_values"] == 1


@pytest.mark.parametrize(
    ("column", "value", "message"),
    [
        ("first_observed_on_team", "not-a-date", "malformed non-sentinel"),
        ("last_observed_on_team", "9999-12-30", "malformed non-sentinel"),
        ("last_observed_on_team", " 9999-12-31 ", "malformed non-sentinel"),
        ("first_observed_on_team", "2021-12-31", "outside the appearance season"),
        ("last_observed_on_team", "2023-01-01", "outside the appearance season"),
    ],
)
def test_bref_adapter_rejects_other_malformed_or_out_of_season_membership_dates(
    column: str,
    value: str,
    message: str,
) -> None:
    source_rows = bref_player_team_seasons()
    source_rows.loc[source_rows.index[-1], column] = value

    with pytest.raises(RiskSetContractError, match=message):
        canonicalize_baseball_reference_appearances(
            source_rows,
            bref_quality(),
            bref_teams(),
            bref_team_organizations(),
        )


def test_genuine_two_way_domains_are_preserved_but_shared_contract_is_unsupported() -> None:
    metadata = census_metadata(expected_team_count=1, observed_team_count=1)
    roster = roster_census().iloc[[0]].copy()
    roster.loc[:, "role"] = "two_way"
    seasons = player_seasons()
    seasons = seasons.astype(
        {
            "prior_hr": "object",
            "prior_bb": "object",
            "prior_so": "object",
            "role_inference_basis": "object",
        }
    )
    seasons.loc[:, "prior_hr"] = None
    seasons.loc[:, "prior_bb"] = None
    seasons.loc[:, "prior_so"] = None
    seasons.loc[:, "prior_batting_pa"] = 149
    seasons.loc[:, "prior_batting_hr"] = 4
    seasons.loc[:, "prior_pitching_ip"] = 20
    seasons.loc[:, "prior_pitching_so"] = 30
    seasons.loc[:, "role_inference_basis"] = (
        "material_batting_and_pitching_with_position_evidence"
    )

    snapshots, _ = build_affiliated_risk_set(
        metadata,
        roster,
        seasons,
        register(),
    )

    assert snapshots.iloc[0]["role"] == "two_way"
    assert snapshots.iloc[0]["prior_batting_pa"] == 149
    assert snapshots.iloc[0]["prior_pitching_ip"] == 20
    assert snapshots.iloc[0]["feature_support_status"] == (
        "unsupported_two_way_shared_feature_contract"
    )


def test_baseball_reference_adapter_rejects_partial_team_backfills() -> None:
    with pytest.raises(RiskSetContractError, match="complete team-season backfill"):
        canonicalize_baseball_reference_appearances(
            bref_player_team_seasons().iloc[[0]],
            bref_quality(complete=False),
            bref_teams().iloc[[0]],
            bref_team_organizations().iloc[[0]],
        )


def test_baseball_reference_adapter_preserves_declared_no_record_page_coverage() -> None:
    teams = bref_teams().assign(activity_status="observed")
    teams = pd.concat(
        [
            teams,
            pd.DataFrame(
                [
                    {
                        "season": "2022",
                        "team_id": "RK-NYY",
                        "organization": "NYY",
                        "level": "Rk",
                        "source_url": (
                            "https://www.baseball-reference.com/register/team.cgi?"
                            "id=RK-NYY"
                        ),
                        "activity_status": "declared_no_record",
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    organizations = pd.concat(
        [
            bref_team_organizations(),
            pd.DataFrame(
                [
                    {
                        "season": "2022",
                        "team_id": "RK-NYY",
                        "organization": "NYY",
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    quality = bref_quality()
    quality.update(
        {
            "declaredTeamCount": 3,
            "observedTeamCount": 3,
            "appearanceDataTeamCount": 2,
            "declaredNoRecordTeamCount": 1,
        }
    )

    metadata, roster, seasons = canonicalize_baseball_reference_appearances(
        bref_player_team_seasons(),
        quality,
        teams,
        organizations,
    )
    validated_metadata, validated_roster, _ = validate_canonical_inputs(
        metadata,
        roster,
        seasons,
    )

    assert validated_metadata.iloc[0]["expected_team_count"] == 2
    assert validated_metadata.iloc[0]["observed_team_count"] == 2
    assert set(validated_roster["team_id"]) == {"AA-NYY", "AAA-NYY"}
    assert metadata.attrs["adapter_quality"]["source_declared_team_count"] == 3
    assert metadata.attrs["adapter_quality"]["source_observed_team_pages"] == 3
    assert metadata.attrs["adapter_quality"]["appearance_data_team_count"] == 2
    assert metadata.attrs["adapter_quality"]["declared_no_record_teams"] == 1


def test_baseball_reference_adapter_rejects_rows_for_declared_no_record_team() -> None:
    teams = bref_teams().assign(activity_status="observed")
    teams.loc[teams["team_id"].eq("AAA-NYY"), "activity_status"] = (
        "declared_no_record"
    )
    quality = bref_quality()
    quality.update(
        {
            "appearanceDataTeamCount": 1,
            "declaredNoRecordTeamCount": 1,
        }
    )
    rows = bref_player_team_seasons()
    for column in [
        "batting_G",
        "batting_PA",
        "batting_AB",
        "batting_H",
        "batting_2B",
        "batting_3B",
        "batting_HR",
        "batting_BB",
        "batting_SO",
        "batting_SB",
        "batting_SF",
    ]:
        rows.loc[rows["team_id"].eq("AAA-NYY"), column] = "0"

    with pytest.raises(
        RiskSetContractError,
        match="declared_no_record teams must have zero participant rows",
    ):
        canonicalize_baseball_reference_appearances(
            rows,
            quality,
            teams,
            bref_team_organizations(),
        )


def test_baseball_reference_adapter_requires_every_active_team_to_participate() -> None:
    teams = pd.concat(
        [
            bref_teams().assign(activity_status="observed"),
            pd.DataFrame(
                [
                    {
                        "season": "2022",
                        "team_id": "RK-NYY",
                        "organization": "NYY",
                        "level": "Rk",
                        "source_url": (
                            "https://www.baseball-reference.com/register/team.cgi?"
                            "id=RK-NYY"
                        ),
                        "activity_status": "observed",
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    organizations = pd.concat(
        [
            bref_team_organizations(),
            pd.DataFrame(
                [
                    {
                        "season": "2022",
                        "team_id": "RK-NYY",
                        "organization": "NYY",
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    quality = bref_quality()
    quality.update(
        {
            "declaredTeamCount": 3,
            "observedTeamCount": 3,
            "appearanceDataTeamCount": 3,
            "declaredNoRecordTeamCount": 0,
        }
    )

    with pytest.raises(
        RiskSetContractError,
        match="Participant team IDs must exactly match teams with activity_status=observed",
    ):
        canonicalize_baseball_reference_appearances(
            bref_player_team_seasons(),
            quality,
            teams,
            organizations,
        )


def test_bref_role_inference_ignores_incidental_cross_domain_opportunity() -> None:
    pitcher_batting = pd.DataFrame(
        [
            {
                "position": "P",
                "batting_G": 30,
                "batting_PA": 35,
                "pitching_IP": "150.0",
            }
        ]
    )
    hitter_pitching = pd.DataFrame(
        [
            {
                "position": "3B",
                "batting_G": 100,
                "batting_PA": 420,
                "pitching_IP": "2.0",
            }
        ]
    )
    genuine_two_way = pd.DataFrame(
        [
            {
                "position": "1B",
                "batting_G": 42,
                "batting_PA": 149,
                "pitching_IP": "20.0",
            }
        ]
    )

    assert infer_bref_aggregate_role(pitcher_batting)[0] == "pitcher"
    assert infer_bref_aggregate_role(hitter_pitching)[0] == "hitter"
    assert infer_bref_aggregate_role(genuine_two_way)[0] == "two_way"


@pytest.mark.parametrize("source_role", ["hitter", "pitcher"])
def test_bref_role_inference_uses_unanimous_source_role_without_other_evidence(
    source_role: str,
) -> None:
    no_workload_or_position_evidence = pd.DataFrame(
        [
            {
                "position": "UNK",
                "role": source_role.upper(),
                "batting_G": 2,
                "batting_PA": None,
                "pitching_IP": None,
            },
            {
                "position": None,
                "role": f" {source_role} ",
                "batting_G": 1,
                "batting_PA": None,
                "pitching_IP": None,
            },
        ]
    )

    assert infer_bref_aggregate_role(no_workload_or_position_evidence) == (
        source_role,
        f"unanimous_source_{source_role}_without_pa_ip_or_known_position",
    )


def test_bref_role_inference_rejects_conflicting_source_roles_without_evidence() -> None:
    conflicting_source_roles = pd.DataFrame(
        [
            {
                "position": "UNK",
                "role": "hitter",
                "batting_G": 1,
                "batting_PA": None,
                "pitching_IP": None,
            },
            {
                "position": None,
                "role": "pitcher",
                "batting_G": 1,
                "batting_PA": None,
                "pitching_IP": None,
            },
        ]
    )

    with pytest.raises(
        RiskSetContractError,
        match="no supported aggregate role evidence",
    ):
        infer_bref_aggregate_role(conflicting_source_roles)


def test_bref_role_inference_prefers_workload_over_unanimous_source_role() -> None:
    source_hitter_with_pitching_workload = pd.DataFrame(
        [
            {
                "position": "UNK",
                "role": "hitter",
                "batting_G": 1,
                "batting_PA": 0,
                "pitching_IP": "5.0",
            }
        ]
    )

    assert infer_bref_aggregate_role(source_hitter_with_pitching_workload) == (
        "pitcher",
        "pitcher_with_incidental_or_no_batting",
    )


def test_statistics_after_landmark_are_not_joined() -> None:
    metadata = census_metadata(as_of="2022-06-30")
    roster = roster_census()
    roster["last_observed_on_team"] = "2022-06-15"
    snapshots, quality = build_affiliated_risk_set(
        metadata,
        roster,
        player_seasons(),
        register(),
    )
    resolved = snapshots[snapshots["source_player_id"] == "1001"].iloc[0]

    assert not resolved["has_prior_stats"]
    assert pd.isna(resolved["prior_pa"])
    assert quality["rows_without_prior_stats"] == 2


def test_strict_output_excludes_edition_only_board_features_by_default() -> None:
    snapshots, quality = build_affiliated_risk_set(
        census_metadata(),
        roster_census(),
        player_seasons(),
        register(),
        board_snapshots(),
    )
    resolved = snapshots[snapshots["source_player_id"] == "1001"].iloc[0]

    assert not resolved["on_fangraphs_board"]
    assert pd.isna(resolved["future_value"])
    assert resolved["board_feature_availability"] == "excluded_edition_only"
    assert quality["effective_time_safe"]
    assert not quality["knowledge_time_verified"]
    assert not quality["strict_point_in_time_features"]


def test_multi_team_appearances_collapse_without_losing_stint_lineage() -> None:
    metadata = census_metadata(expected_team_count=3, observed_team_count=3)
    roster = roster_census()
    extra = roster.iloc[[0]].copy()
    extra.loc[:, "team_id"] = "AA-NYY"
    extra.loc[:, "organization"] = "NYY"
    extra.loc[:, "level"] = "AA"
    extra.loc[:, "first_observed_on_team"] = "2022-04-01"
    extra.loc[:, "last_observed_on_team"] = "2022-07-15"
    roster = pd.concat([roster, extra], ignore_index=True)

    snapshots, quality = build_affiliated_risk_set(
        metadata,
        roster,
        player_seasons(),
        register(),
    )
    resolved = snapshots[snapshots["source_player_id"] == "1001"].iloc[0]

    assert len(snapshots) == 2
    assert resolved["membership_stint_count"] == 2
    assert resolved["team_ids"] == "AA-NYY | AAA-NYY"
    assert resolved["prior_level"] == "Pooled multi-level"
    assert resolved["last_observed_level"] == "AAA"
    assert '"team_id":"AA-NYY"' in resolved["membership_stints_json"]
    assert '"team_id":"AAA-NYY"' in resolved["membership_stints_json"]
    assert quality["input_membership_rows"] == 3
    assert quality["collapsed_membership_rows"] == 1
    assert quality["multi_team_player_censuses"] == 1


def test_appearance_inputs_cannot_claim_dated_roster_coverage() -> None:
    metadata = census_metadata(
        coverage_scope="all_affiliated_roster_members_at_landmark"
    )

    with pytest.raises(RiskSetContractError, match="requires coverage_scope"):
        validate_canonical_inputs(metadata, roster_census(), player_seasons())


def test_declared_affiliate_count_must_reconcile_to_roster_teams() -> None:
    metadata = census_metadata(expected_team_count=3, observed_team_count=3)

    with pytest.raises(RiskSetContractError, match="contains 2 distinct team_id"):
        validate_canonical_inputs(metadata, roster_census(), player_seasons())


def test_completeness_attestation_is_mandatory() -> None:
    with pytest.raises(RiskSetContractError, match="completeness_attested=true"):
        validate_canonical_inputs(
            census_metadata(completeness_attested=False),
            roster_census(),
            player_seasons(),
        )


def test_empty_player_season_extract_is_rejected() -> None:
    empty_seasons = pd.DataFrame(columns=PLAYER_SEASON_COLUMNS)

    with pytest.raises(RiskSetContractError, match="must not be empty"):
        validate_canonical_inputs(census_metadata(), roster_census(), empty_seasons)


def test_duplicate_player_within_census_is_rejected() -> None:
    roster = roster_census()
    roster = pd.concat([roster, roster.iloc[[0]]], ignore_index=True)

    with pytest.raises(RiskSetContractError, match="only once in a census"):
        validate_canonical_inputs(census_metadata(), roster, player_seasons())


def test_multiple_source_ids_resolving_to_one_player_are_rejected() -> None:
    roster = roster_census()
    roster.loc[1, "source_id_namespace"] = "bbref_minors"
    roster.loc[1, "source_player_id"] = "minor-1001"

    with pytest.raises(RiskSetContractError, match="same player within a census"):
        build_affiliated_risk_set(
            census_metadata(),
            roster,
            player_seasons(),
            register(),
        )


def test_fractional_rates_must_use_zero_to_one_scale() -> None:
    seasons = player_seasons()
    seasons.loc[0, "prior_k_rate"] = 20.0

    with pytest.raises(RiskSetContractError, match="zero-to-one scale"):
        validate_canonical_inputs(census_metadata(), roster_census(), seasons)


def test_roster_biography_cannot_use_future_information() -> None:
    roster = roster_census()
    roster.loc[0, "birth_date"] = "2023-01-01"

    with pytest.raises(RiskSetContractError, match="after its census landmark"):
        validate_canonical_inputs(census_metadata(), roster, player_seasons())


def test_canonical_schema_rejects_future_outcome_columns() -> None:
    roster = roster_census().assign(debut_date="2024-04-01")

    with pytest.raises(RiskSetContractError, match="unexpected=.*debut_date"):
        validate_canonical_inputs(census_metadata(), roster, player_seasons())


def test_csv_reader_preserves_source_identifier_text(tmp_path) -> None:
    path = tmp_path / "identifiers.csv"
    path.write_text("source_player_id,value\n00123,7\n")

    frame = read_canonical_table(path)

    assert frame.loc[0, "source_player_id"] == "00123"
