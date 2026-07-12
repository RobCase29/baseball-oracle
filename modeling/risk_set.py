from __future__ import annotations

import json
from typing import Any

import pandas as pd

try:
    from modeling.contracts import (
        CATEGORICAL_FEATURES,
        DATA_CUTOFF,
        NUMERIC_FEATURES,
        assert_feature_contract,
    )
except ModuleNotFoundError:
    from contracts import (
        CATEGORICAL_FEATURES,
        DATA_CUTOFF,
        NUMERIC_FEATURES,
        assert_feature_contract,
    )

RISK_SET_CONTRACT_VERSION = "affiliated-player-census-v3"
RISK_SET_POLICY = "explicit_pooled_context_effective_time_safe_v3"
BREF_MISSING_DATE_SENTINELS = frozenset({"XXXX-XX-XX"})
BREF_TEAM_ACTIVITY_STATUSES = frozenset({"observed", "declared_no_record"})

COHORT_COVERAGE_SCOPES = {
    "dated_roster": "all_affiliated_roster_members_at_landmark",
    "season_appearance": "all_affiliated_season_participants_on_observed_teams",
}

ALLOWED_ID_NAMESPACES = {
    "bbref_minors": "key_bbref_minors",
    "chadwick_uuid": "key_uuid",
    "fangraphs": "key_fangraphs",
    "mlbam": "key_mlbam",
}

CENSUS_METADATA_COLUMNS = (
    "census_id",
    "season",
    "as_of",
    "source",
    "cohort_basis",
    "coverage_scope",
    "completeness_attested",
    "expected_team_count",
    "observed_team_count",
    "inclusion_rule",
)

ROSTER_CENSUS_COLUMNS = (
    "census_id",
    "source_id_namespace",
    "source_player_id",
    "player_name",
    "organization",
    "team_id",
    "level",
    "roster_status",
    "role",
    "position",
    "birth_date",
    "bats",
    "throws",
    "height_inches",
    "weight_pounds",
    "draft_year",
    "draft_round",
    "acquisition_type",
    "first_observed_on_team",
    "last_observed_on_team",
)

PRIOR_STAT_FEATURES = tuple(
    column for column in NUMERIC_FEATURES if column.startswith("prior_")
)

DOMAIN_STAT_FEATURES = (
    "prior_batting_g",
    "prior_batting_pa",
    "prior_batting_ab",
    "prior_batting_hr",
    "prior_batting_bb",
    "prior_batting_so",
    "prior_batting_sb",
    "prior_pitching_g",
    "prior_pitching_ip",
    "prior_pitching_tbf",
    "prior_pitching_hr",
    "prior_pitching_bb",
    "prior_pitching_so",
)

PLAYER_SEASON_COLUMNS = (
    "source_id_namespace",
    "source_player_id",
    "season",
    "stats_through",
    *PRIOR_STAT_FEATURES,
    *DOMAIN_STAT_FEATURES,
    "role_inference_basis",
)

FRACTION_RATE_COLUMNS = (
    "prior_bb_rate",
    "prior_k_rate",
    "prior_babip",
    "prior_gb_rate",
    "prior_ld_rate",
    "prior_fb_rate",
    "prior_swstr_rate",
)

NONNEGATIVE_STAT_COLUMNS = tuple(
    column
    for column in PRIOR_STAT_FEATURES
    if column not in {"prior_k_minus_bb_rate", "prior_wrc_plus", "prior_fip", "prior_xfip"}
)

ROSTER_NUMERIC_COLUMNS = (
    "height_inches",
    "weight_pounds",
    "draft_year",
    "draft_round",
)


class RiskSetContractError(ValueError):
    pass


def _raw_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame:
        return pd.Series(pd.NA, index=frame.index, dtype="object")
    return frame[column]


def _sum_raw(frame: pd.DataFrame, column: str) -> float:
    return float(pd.to_numeric(_raw_series(frame, column), errors="coerce").fillna(0).sum())


def _innings_to_outs(value: Any) -> int:
    if value is None or pd.isna(value) or str(value).strip() == "":
        return 0
    text = str(value).strip()
    if "." not in text:
        return int(text) * 3
    innings, partial = text.split(".", 1)
    if partial not in {"0", "1", "2"}:
        raise RiskSetContractError(f"invalid baseball innings value: {text}")
    return int(innings) * 3 + int(partial)


def _safe_rate(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator > 0 else None


def _position_tokens(values: pd.Series) -> set[str]:
    return {
        token.strip().upper()
        for value in values.dropna()
        for token in str(value).split("/")
        if token.strip()
    }


def infer_bref_aggregate_role(group: pd.DataFrame) -> tuple[str, str]:
    batting_g = _sum_raw(group, "batting_G")
    batting_pa = _sum_raw(group, "batting_PA")
    pitching_outs = sum(
        _innings_to_outs(value) for value in _raw_series(group, "pitching_IP")
    )
    positions = _position_tokens(group["position"])
    has_position_player_fielding = any(
        position not in {"P", "UNK"} for position in positions
    )
    material_hitting = batting_g >= 20 and batting_pa >= 60
    material_pitching = pitching_outs >= 60

    if material_hitting and material_pitching and has_position_player_fielding:
        return "two_way", "material_batting_and_pitching_with_position_evidence"
    if has_position_player_fielding:
        return "hitter", "position_player_with_incidental_or_no_pitching"
    if pitching_outs > 0 or "P" in positions:
        return "pitcher", "pitcher_with_incidental_or_no_batting"
    if batting_pa > 0:
        return "hitter", "batting_opportunity_without_position_evidence"
    source_roles = {
        str(role).strip().lower()
        for role in _raw_series(group, "role").dropna()
        if str(role).strip()
    }
    if len(source_roles) == 1:
        source_role = next(iter(source_roles))
        if source_role in {"hitter", "pitcher"}:
            return (
                source_role,
                f"unanimous_source_{source_role}_without_pa_ip_or_known_position",
            )
    raise RiskSetContractError(
        "appearance cohort row has no supported aggregate role evidence"
    )


def canonicalize_baseball_reference_appearances(
    player_team_seasons: pd.DataFrame,
    quality: dict[str, Any],
    teams: pd.DataFrame,
    team_organizations: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    required = {
        "source_id_namespace",
        "source_player_id",
        "season",
        "team_id",
        "organization",
        "level",
        "player_name",
        "roster_status",
        "role",
        "position",
        "birth_date",
        "bats",
        "throws",
        "height_inches",
        "weight_pounds",
        "first_observed_on_team",
        "last_observed_on_team",
    }
    missing = sorted(required - set(player_team_seasons.columns))
    if missing:
        raise RiskSetContractError(
            f"Baseball-Reference player_team_seasons is missing columns: {missing}"
        )
    if quality.get("schemaVersion") != "baseball-reference-register-quality/v1":
        raise RiskSetContractError("unsupported Baseball-Reference quality schema")
    if quality.get("structuralZeroSeason") is True:
        raise RiskSetContractError("a structural zero season cannot form an appearance cohort")
    if quality.get("complete") is not True:
        raise RiskSetContractError(
            "Baseball-Reference appearance cohort requires a complete team-season backfill"
        )
    season = int(quality.get("season"))
    expected_teams = int(quality.get("declaredTeamCount"))
    observed_teams = int(quality.get("observedTeamCount"))
    if expected_teams <= 0 or observed_teams != expected_teams:
        raise RiskSetContractError(
            "Baseball-Reference declared and observed team counts must reconcile"
        )
    required_team_columns = {
        "season",
        "team_id",
        "organization",
        "level",
        "source_url",
    }
    missing_team_columns = sorted(required_team_columns - set(teams.columns))
    if missing_team_columns:
        raise RiskSetContractError(
            f"Baseball-Reference teams is missing columns: {missing_team_columns}"
        )
    teams = teams.copy()
    if "activity_status" not in teams.columns:
        teams["activity_status"] = "observed"
    teams["activity_status"] = (
        teams["activity_status"].astype("string").str.strip().str.lower()
    )
    invalid_activity_statuses = sorted(
        set(teams["activity_status"].dropna()) - BREF_TEAM_ACTIVITY_STATUSES
    )
    if teams["activity_status"].isna().any() or invalid_activity_statuses:
        raise RiskSetContractError(
            "Baseball-Reference teams contains invalid activity_status values: "
            f"{invalid_activity_statuses}"
        )
    if teams["team_id"].duplicated(keep=False).any():
        raise RiskSetContractError("Baseball-Reference teams contains duplicate team_id rows")
    team_seasons = pd.to_numeric(teams["season"], errors="coerce")
    if team_seasons.isna().any() or team_seasons.astype(int).ne(season).any():
        raise RiskSetContractError("Baseball-Reference teams contains an unexpected season")
    if len(teams) != observed_teams:
        raise RiskSetContractError(
            "Baseball-Reference teams rows do not reconcile to observedTeamCount"
        )
    if not teams["source_url"].astype(str).str.startswith(
        "https://www.baseball-reference.com/register/team.cgi?"
    ).all():
        raise RiskSetContractError("Baseball-Reference teams contains an invalid source_url")
    declared_page_team_ids = set(teams["team_id"].astype(str))
    appearance_team_ids = set(
        teams.loc[teams["activity_status"].eq("observed"), "team_id"].astype(str)
    )
    declared_no_record_team_ids = declared_page_team_ids - appearance_team_ids
    appearance_team_count = len(appearance_team_ids)
    declared_no_record_team_count = len(declared_no_record_team_ids)
    if quality.get("appearanceDataTeamCount") is not None and int(
        quality["appearanceDataTeamCount"]
    ) != appearance_team_count:
        raise RiskSetContractError(
            "Baseball-Reference appearanceDataTeamCount does not reconcile to teams"
        )
    if quality.get("declaredNoRecordTeamCount") is not None and int(
        quality["declaredNoRecordTeamCount"]
    ) != declared_no_record_team_count:
        raise RiskSetContractError(
            "Baseball-Reference declaredNoRecordTeamCount does not reconcile to teams"
        )
    required_organization_columns = {"season", "team_id", "organization"}
    missing_organization_columns = sorted(
        required_organization_columns - set(team_organizations.columns)
    )
    if missing_organization_columns:
        raise RiskSetContractError(
            "Baseball-Reference team_organizations is missing columns: "
            f"{missing_organization_columns}"
        )
    organization_seasons = pd.to_numeric(
        team_organizations["season"], errors="coerce"
    )
    if organization_seasons.isna().any() or organization_seasons.astype(int).ne(
        season
    ).any():
        raise RiskSetContractError(
            "Baseball-Reference team_organizations contains an unexpected season"
        )
    if team_organizations.duplicated(["team_id", "organization"], keep=False).any():
        raise RiskSetContractError(
            "Baseball-Reference team_organizations contains duplicate relationships"
        )
    organization_team_ids = set(team_organizations["team_id"].astype(str))
    if organization_team_ids != declared_page_team_ids:
        raise RiskSetContractError(
            "Every observed team must have one or more organization relationships"
        )
    organization_counts = team_organizations.groupby("team_id")["organization"].nunique()
    shared_team_count = int(organization_counts.gt(1).sum())
    if quality.get("sharedAffiliateTeamCount") is not None and int(
        quality["sharedAffiliateTeamCount"]
    ) != shared_team_count:
        raise RiskSetContractError(
            "Cooperative affiliate counts do not reconcile to team_organizations"
        )
    seasons = pd.to_numeric(player_team_seasons["season"], errors="coerce")
    if seasons.isna().any() or seasons.astype(int).ne(season).any():
        raise RiskSetContractError("player_team_seasons contains an unexpected season")
    if player_team_seasons["source_id_namespace"].ne("bbref_minors").any():
        raise RiskSetContractError(
            "Baseball-Reference appearance rows must use bbref_minors identifiers"
        )
    source_team_ids = set(player_team_seasons["team_id"].astype(str))
    unknown_source_team_ids = sorted(source_team_ids - declared_page_team_ids)
    if unknown_source_team_ids:
        raise RiskSetContractError(
            "Baseball-Reference appearance rows reference undeclared teams: "
            f"{unknown_source_team_ids}"
        )
    no_record_participant_teams = sorted(
        source_team_ids & declared_no_record_team_ids
    )
    if no_record_participant_teams:
        raise RiskSetContractError(
            "Baseball-Reference declared_no_record teams must have zero participant rows: "
            f"{no_record_participant_teams}"
        )
    appearance_evidence = pd.Series(False, index=player_team_seasons.index)
    for column in (
        "batting_G",
        "batting_PA",
        "pitching_G",
        "pitching_IP",
        "fielding_G",
    ):
        appearance_evidence |= pd.to_numeric(
            _raw_series(player_team_seasons, column), errors="coerce"
        ).fillna(0).gt(0)
    appearance_rows = player_team_seasons[appearance_evidence].copy()
    appearance_rows.loc[
        appearance_rows["birth_date"].isin(BREF_MISSING_DATE_SENTINELS),
        "birth_date",
    ] = pd.NA
    excluded_zero_game_rows = int((~appearance_evidence).sum())
    if appearance_rows.empty:
        raise RiskSetContractError(
            "Baseball-Reference input contains no rows with season appearance evidence"
        )
    inferred_roles: dict[tuple[str, str], tuple[str, str]] = {}
    for key, group in appearance_rows.groupby(
        ["source_id_namespace", "source_player_id"],
        sort=True,
        dropna=False,
    ):
        inferred_roles[(str(key[0]), str(key[1]))] = infer_bref_aggregate_role(group)
    appearance_rows["role"] = appearance_rows.apply(
        lambda row: inferred_roles[
            (str(row["source_id_namespace"]), str(row["source_player_id"]))
        ][0],
        axis=1,
    )
    participant_teams = set(appearance_rows["team_id"].astype(str))
    if participant_teams != appearance_team_ids:
        raise RiskSetContractError(
            "Participant team IDs must exactly match teams with activity_status=observed"
        )

    team_organization_labels = team_organizations.groupby("team_id")[
        "organization"
    ].agg(lambda values: " | ".join(sorted(set(map(str, values)))))

    census_id = f"bref-register:{season}:season-appearance"
    as_of = pd.Timestamp(year=season, month=12, day=31)
    metadata = pd.DataFrame(
        [
            {
                "census_id": census_id,
                "season": season,
                "as_of": as_of,
                "source": "baseball-reference-register",
                "cohort_basis": "season_appearance",
                "coverage_scope": COHORT_COVERAGE_SCOPES["season_appearance"],
                "completeness_attested": True,
                "expected_team_count": appearance_team_count,
                "observed_team_count": appearance_team_count,
                "inclusion_rule": (
                    "Every player with a recorded appearance on every successfully "
                    "reconciled affiliated team-season page with appearance data; "
                    "declared_no_record pages are retained in source provenance but contribute "
                    "no players; this is not a contracted-player census."
                ),
            }
        ],
        columns=CENSUS_METADATA_COLUMNS,
    )
    metadata.attrs["adapter_quality"] = {
        "source_membership_rows": int(len(player_team_seasons)),
        "included_appearance_rows": int(len(appearance_rows)),
        "excluded_zero_game_roster_rows": excluded_zero_game_rows,
        "observed_team_rows": int(len(teams)),
        "source_declared_team_count": expected_teams,
        "source_observed_team_pages": observed_teams,
        "appearance_data_team_count": appearance_team_count,
        "declared_no_record_teams": declared_no_record_team_count,
        "cooperative_affiliate_teams": shared_team_count,
    }
    roster = pd.DataFrame(
        {
            "census_id": census_id,
            "source_id_namespace": appearance_rows["source_id_namespace"],
            "source_player_id": appearance_rows["source_player_id"],
            "player_name": appearance_rows["player_name"],
            "organization": appearance_rows["team_id"].map(
                team_organization_labels
            ),
            "team_id": appearance_rows["team_id"],
            "level": appearance_rows["level"],
            "roster_status": appearance_rows["roster_status"],
            "role": appearance_rows["role"],
            "position": appearance_rows["position"],
            "birth_date": appearance_rows["birth_date"],
            "bats": appearance_rows["bats"],
            "throws": appearance_rows["throws"],
            "height_inches": appearance_rows["height_inches"],
            "weight_pounds": appearance_rows["weight_pounds"],
            "draft_year": None,
            "draft_round": None,
            "acquisition_type": None,
            "first_observed_on_team": appearance_rows[
                "first_observed_on_team"
            ],
            "last_observed_on_team": appearance_rows[
                "last_observed_on_team"
            ],
        },
        columns=ROSTER_CENSUS_COLUMNS,
    )

    stat_rows: list[dict[str, Any]] = []
    keys = ["source_id_namespace", "source_player_id"]
    for (namespace, source_player_id), group in appearance_rows.groupby(
        keys, sort=True, dropna=False
    ):
        role, role_inference_basis = inferred_roles[
            (str(namespace), str(source_player_id))
        ]
        batting_g = _sum_raw(group, "batting_G")
        pitching_g = _sum_raw(group, "pitching_G")
        fielding_g = _sum_raw(group, "fielding_G")
        pa = _sum_raw(group, "batting_PA")
        ab = _sum_raw(group, "batting_AB")
        hits = _sum_raw(group, "batting_H")
        doubles = _sum_raw(group, "batting_2B")
        triples = _sum_raw(group, "batting_3B")
        batting_hr = _sum_raw(group, "batting_HR")
        batting_bb = _sum_raw(group, "batting_BB")
        batting_so = _sum_raw(group, "batting_SO")
        batting_sb = _sum_raw(group, "batting_SB")
        sacrifice_flies = _sum_raw(group, "batting_SF")
        pitching_outs = sum(
            _innings_to_outs(value) for value in _raw_series(group, "pitching_IP")
        )
        tbf = _sum_raw(group, "pitching_batters_faced")
        pitching_hits = _sum_raw(group, "pitching_H")
        pitching_er = _sum_raw(group, "pitching_ER")
        pitching_hr = _sum_raw(group, "pitching_HR")
        pitching_bb = _sum_raw(group, "pitching_BB")
        pitching_so = _sum_raw(group, "pitching_SO")
        row: dict[str, Any] = {
            "source_id_namespace": namespace,
            "source_player_id": source_player_id,
            "season": season,
            "stats_through": pd.to_datetime(
                group["last_observed_on_team"], errors="coerce"
            ).max(),
            **{feature: None for feature in PRIOR_STAT_FEATURES},
            "prior_batting_g": batting_g or None,
            "prior_batting_pa": pa or None,
            "prior_batting_ab": ab or None,
            "prior_batting_hr": batting_hr,
            "prior_batting_bb": batting_bb,
            "prior_batting_so": batting_so,
            "prior_batting_sb": batting_sb,
            "prior_pitching_g": pitching_g or None,
            "prior_pitching_ip": pitching_outs / 3 if pitching_outs else None,
            "prior_pitching_tbf": tbf or None,
            "prior_pitching_hr": pitching_hr,
            "prior_pitching_bb": pitching_bb,
            "prior_pitching_so": pitching_so,
            "role_inference_basis": role_inference_basis,
            "prior_g": max(batting_g, pitching_g, fielding_g) if role == "two_way" else (
                max(pitching_g, fielding_g)
                if role == "pitcher"
                else max(batting_g, fielding_g)
            ),
            "prior_pa": pa or None,
            "prior_ab": ab or None,
            "prior_ip": pitching_outs / 3 if pitching_outs else None,
            "prior_tbf": tbf or None,
        }
        if role == "hitter":
            row.update(
                {
                    "prior_hr": batting_hr,
                    "prior_bb": batting_bb,
                    "prior_so": batting_so,
                    "prior_sb": batting_sb,
                    "prior_bb_rate": _safe_rate(batting_bb, pa),
                    "prior_k_rate": _safe_rate(batting_so, pa),
                    "prior_iso": _safe_rate(
                        doubles + 2 * triples + 3 * batting_hr,
                        ab,
                    ),
                    "prior_babip": _safe_rate(
                        hits - batting_hr,
                        ab - batting_so - batting_hr + sacrifice_flies,
                    ),
                }
            )
        elif role == "pitcher":
            bb_rate = _safe_rate(pitching_bb, tbf)
            k_rate = _safe_rate(pitching_so, tbf)
            row.update(
                {
                    "prior_hr": pitching_hr,
                    "prior_bb": pitching_bb,
                    "prior_so": pitching_so,
                    "prior_bb_rate": bb_rate,
                    "prior_k_rate": k_rate,
                    "prior_k_minus_bb_rate": (
                        k_rate - bb_rate
                        if k_rate is not None and bb_rate is not None
                        else None
                    ),
                    "prior_era": _safe_rate(pitching_er * 27, pitching_outs),
                    "prior_whip": _safe_rate(
                        (pitching_hits + pitching_bb) * 3,
                        pitching_outs,
                    ),
                }
            )
        stat_rows.append(row)
    player_seasons = pd.DataFrame(stat_rows, columns=PLAYER_SEASON_COLUMNS)
    return metadata, roster, player_seasons


def _require_exact_columns(frame: pd.DataFrame, expected: tuple[str, ...], name: str) -> None:
    missing = sorted(set(expected) - set(frame.columns))
    unexpected = sorted(set(frame.columns) - set(expected))
    if missing or unexpected:
        details: list[str] = []
        if missing:
            details.append(f"missing={missing}")
        if unexpected:
            details.append(f"unexpected={unexpected}")
        raise RiskSetContractError(f"{name} violates its canonical schema: {'; '.join(details)}")


def _identifier(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    cleaned = str(value).strip()
    if not cleaned or cleaned.lower() in {"nan", "none", "null", "0"}:
        return None
    return cleaned.removesuffix(".0")


def _required_text(series: pd.Series, name: str) -> pd.Series:
    cleaned = series.map(_identifier)
    if cleaned.isna().any():
        raise RiskSetContractError(f"{name} contains blank values")
    return cleaned.astype(str)


def _boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    return None


def _numeric(series: pd.Series, name: str, *, integer: bool = False) -> pd.Series:
    converted = pd.to_numeric(series, errors="coerce")
    invalid = series.notna() & converted.isna()
    nonfinite = converted.isin([float("inf"), float("-inf")])
    if invalid.any() or nonfinite.any():
        raise RiskSetContractError(f"{name} contains non-numeric or non-finite values")
    if integer:
        fractional = converted.notna() & converted.mod(1).ne(0)
        if fractional.any():
            raise RiskSetContractError(f"{name} must contain whole numbers")
        return converted.astype("Int64")
    return converted.astype(float)


def _dates(series: pd.Series, name: str, *, required: bool) -> pd.Series:
    parsed = pd.to_datetime(series, errors="coerce").dt.normalize()
    invalid = series.notna() & parsed.isna()
    if invalid.any() or (required and parsed.isna().any()):
        raise RiskSetContractError(f"{name} contains invalid dates")
    return parsed


def validate_canonical_inputs(
    census_metadata: pd.DataFrame,
    roster_census: pd.DataFrame,
    player_seasons: pd.DataFrame,
    *,
    data_cutoff: str = DATA_CUTOFF,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    metadata = census_metadata.copy()
    roster = roster_census.copy()
    seasons = player_seasons.copy()
    _require_exact_columns(metadata, CENSUS_METADATA_COLUMNS, "census metadata")
    _require_exact_columns(roster, ROSTER_CENSUS_COLUMNS, "roster census")
    _require_exact_columns(seasons, PLAYER_SEASON_COLUMNS, "player seasons")
    if metadata.empty or roster.empty or seasons.empty:
        raise RiskSetContractError(
            "Census metadata, roster census, and player seasons must not be empty"
        )

    metadata["census_id"] = _required_text(metadata["census_id"], "census_id")
    if metadata["census_id"].duplicated().any():
        raise RiskSetContractError("census metadata contains duplicate census_id values")
    metadata["season"] = _numeric(metadata["season"], "metadata season", integer=True)
    metadata["as_of"] = _dates(metadata["as_of"], "metadata as_of", required=True)
    if metadata["as_of"].gt(pd.Timestamp(data_cutoff)).any():
        raise RiskSetContractError("census metadata extends beyond the outcome data cutoff")
    if metadata["season"].astype(int).ne(metadata["as_of"].dt.year).any():
        raise RiskSetContractError("each census season must match its as_of calendar year")
    metadata["source"] = _required_text(metadata["source"], "metadata source")
    metadata["inclusion_rule"] = _required_text(
        metadata["inclusion_rule"], "metadata inclusion_rule"
    )
    metadata["cohort_basis"] = _required_text(
        metadata["cohort_basis"], "metadata cohort_basis"
    )
    invalid_bases = sorted(set(metadata["cohort_basis"]) - set(COHORT_COVERAGE_SCOPES))
    if invalid_bases:
        raise RiskSetContractError(f"unsupported cohort_basis values: {invalid_bases}")
    for row in metadata.to_dict("records"):
        expected_scope = COHORT_COVERAGE_SCOPES[str(row["cohort_basis"])]
        if row["coverage_scope"] != expected_scope:
            raise RiskSetContractError(
                f"cohort_basis {row['cohort_basis']} requires coverage_scope {expected_scope}"
            )
    attested = metadata["completeness_attested"].map(_boolean)
    if attested.isna().any() or not attested.all():
        raise RiskSetContractError("every census must have completeness_attested=true")
    metadata["completeness_attested"] = attested.astype(bool)
    for column in ("expected_team_count", "observed_team_count"):
        metadata[column] = _numeric(metadata[column], column, integer=True)
        if metadata[column].isna().any() or metadata[column].le(0).any():
            raise RiskSetContractError(f"{column} must be a positive integer")
    if metadata["expected_team_count"].ne(metadata["observed_team_count"]).any():
        raise RiskSetContractError("expected and observed team counts must match")

    roster["census_id"] = _required_text(roster["census_id"], "roster census_id")
    declared = set(metadata["census_id"])
    present = set(roster["census_id"])
    if present != declared:
        raise RiskSetContractError(
            "roster census IDs must exactly match declared census metadata IDs"
        )
    roster["source_id_namespace"] = _required_text(
        roster["source_id_namespace"], "roster source_id_namespace"
    ).str.lower()
    invalid_namespaces = sorted(set(roster["source_id_namespace"]) - set(ALLOWED_ID_NAMESPACES))
    if invalid_namespaces:
        raise RiskSetContractError(f"unsupported source ID namespaces: {invalid_namespaces}")
    roster["source_player_id"] = _required_text(
        roster["source_player_id"], "roster source_player_id"
    )
    for column in (
        "player_name",
        "organization",
        "team_id",
        "level",
        "roster_status",
        "role",
        "position",
    ):
        roster[column] = _required_text(roster[column], f"roster {column}")
    if not set(roster["role"]).issubset({"hitter", "pitcher", "two_way"}):
        raise RiskSetContractError("roster role must be hitter, pitcher, or two_way")
    for column in ("bats", "throws", "acquisition_type"):
        roster[column] = roster[column].map(_identifier)
    roster["birth_date"] = _dates(roster["birth_date"], "roster birth_date", required=False)
    roster["first_observed_on_team"] = _dates(
        roster["first_observed_on_team"],
        "roster first_observed_on_team",
        required=True,
    )
    roster["last_observed_on_team"] = _dates(
        roster["last_observed_on_team"],
        "roster last_observed_on_team",
        required=True,
    )
    if roster["last_observed_on_team"].lt(roster["first_observed_on_team"]).any():
        raise RiskSetContractError("roster observation intervals cannot run backward")
    for column in ROSTER_NUMERIC_COLUMNS:
        roster[column] = _numeric(roster[column], f"roster {column}")
    if roster["height_inches"].dropna().le(0).any() or roster[
        "weight_pounds"
    ].dropna().le(0).any():
        raise RiskSetContractError("roster height and weight must be positive when supplied")
    census_as_of = roster["census_id"].map(metadata.set_index("census_id")["as_of"])
    if (roster["birth_date"].notna() & roster["birth_date"].gt(census_as_of)).any():
        raise RiskSetContractError("roster birth_date cannot occur after its census landmark")
    census_season = roster["census_id"].map(metadata.set_index("census_id")["season"])
    if (roster["draft_year"].notna() & roster["draft_year"].gt(census_season)).any():
        raise RiskSetContractError("roster draft_year cannot occur after its census season")
    duplicate_key = [
        "census_id",
        "source_id_namespace",
        "source_player_id",
        "team_id",
    ]
    if roster.duplicated(duplicate_key, keep=False).any():
        raise RiskSetContractError(
            "each source player-team stint may appear only once in a census"
        )

    roster_basis = roster["census_id"].map(
        metadata.set_index("census_id")["cohort_basis"]
    )
    appearance = roster_basis.eq("season_appearance")
    if appearance.any():
        if roster.loc[appearance, "roster_status"].ne("season_participant").any():
            raise RiskSetContractError(
                "season_appearance rows must use roster_status=season_participant"
            )
        appearance_season = census_season[appearance].astype(int)
        if (
            roster.loc[appearance, "first_observed_on_team"].dt.year.ne(
                appearance_season
            ).any()
            or roster.loc[appearance, "last_observed_on_team"].dt.year.ne(
                appearance_season
            ).any()
            or roster.loc[appearance, "last_observed_on_team"].gt(
                census_as_of[appearance]
            ).any()
        ):
            raise RiskSetContractError(
                "season_appearance intervals must fall within the season and end by as_of"
            )
    dated_roster = roster_basis.eq("dated_roster")
    if dated_roster.any() and (
        roster.loc[dated_roster, "first_observed_on_team"].gt(
            census_as_of[dated_roster]
        ).any()
        or roster.loc[dated_roster, "last_observed_on_team"].lt(
            census_as_of[dated_roster]
        ).any()
    ):
        raise RiskSetContractError(
            "dated_roster intervals must contain the census as_of landmark"
        )

    roster_team_counts = roster.groupby("census_id")["team_id"].nunique()
    for row in metadata.to_dict("records"):
        actual = int(roster_team_counts.get(row["census_id"], 0))
        if actual != int(row["observed_team_count"]):
            raise RiskSetContractError(
                f"census {row['census_id']} declares {row['observed_team_count']} "
                f"teams but contains {actual} distinct team_id values"
            )

    seasons["source_id_namespace"] = _required_text(
        seasons["source_id_namespace"], "player seasons source_id_namespace"
    ).str.lower()
    invalid_namespaces = sorted(
        set(seasons["source_id_namespace"]) - set(ALLOWED_ID_NAMESPACES)
    )
    if invalid_namespaces:
        raise RiskSetContractError(f"unsupported source ID namespaces: {invalid_namespaces}")
    seasons["source_player_id"] = _required_text(
        seasons["source_player_id"], "player seasons source_player_id"
    )
    seasons["season"] = _numeric(seasons["season"], "player seasons season", integer=True)
    seasons["stats_through"] = _dates(
        seasons["stats_through"], "player seasons stats_through", required=True
    )
    if seasons["season"].astype(int).ne(seasons["stats_through"].dt.year).any():
        raise RiskSetContractError("player-season stats_through must fall in its season")
    if seasons["stats_through"].gt(pd.Timestamp(data_cutoff)).any():
        raise RiskSetContractError("player-season statistics extend beyond the data cutoff")
    for column in PRIOR_STAT_FEATURES:
        seasons[column] = _numeric(seasons[column], f"player seasons {column}")
    for column in DOMAIN_STAT_FEATURES:
        seasons[column] = _numeric(seasons[column], f"player seasons {column}")
        if seasons[column].dropna().lt(0).any():
            raise RiskSetContractError(f"{column} must be nonnegative")
    seasons["role_inference_basis"] = seasons["role_inference_basis"].map(_identifier)
    for column in NONNEGATIVE_STAT_COLUMNS:
        if seasons[column].dropna().lt(0).any():
            raise RiskSetContractError(f"{column} must be nonnegative")
    for column in FRACTION_RATE_COLUMNS:
        values = seasons[column].dropna()
        if values.lt(0).any() or values.gt(1).any():
            raise RiskSetContractError(f"{column} must use a zero-to-one scale")
    k_minus_bb = seasons["prior_k_minus_bb_rate"].dropna()
    if k_minus_bb.lt(-1).any() or k_minus_bb.gt(1).any():
        raise RiskSetContractError("prior_k_minus_bb_rate must use a minus-one-to-one scale")
    season_key = [
        "source_id_namespace",
        "source_player_id",
        "season",
        "stats_through",
    ]
    if seasons.duplicated(season_key, keep=False).any():
        raise RiskSetContractError("player seasons contains duplicate point-in-time rows")

    return metadata, roster, seasons


def _identity_indexes(register: pd.DataFrame) -> dict[str, dict[str, dict[str, Any]]]:
    indexes: dict[str, dict[str, dict[str, Any]]] = {}
    for namespace, column in ALLOWED_ID_NAMESPACES.items():
        if column not in register:
            indexes[namespace] = {}
            continue
        populated = register[register[column].notna()].copy()
        populated[column] = populated[column].map(_identifier)
        populated = populated[populated[column].notna()]
        unique = populated[~populated[column].duplicated(keep=False)]
        indexes[namespace] = {
            str(row[column]): row.to_dict() for _, row in unique.iterrows()
        }
    return indexes


def _latest_available_stats(
    seasons: pd.DataFrame,
) -> dict[tuple[str, str], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    if seasons.empty:
        return grouped
    ordered = seasons.sort_values(["season", "stats_through"])
    for row in ordered.to_dict("records"):
        key = (str(row["source_id_namespace"]), str(row["source_player_id"]))
        grouped.setdefault(key, []).append(row)
    return grouped


def _latest_non_null(frame: pd.DataFrame, column: str) -> Any:
    values = frame[column].dropna()
    return values.iloc[-1] if not values.empty else None


def _aggregate_roster_memberships(
    roster: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, int]]:
    keys = ["census_id", "source_id_namespace", "source_player_id"]
    rows: list[dict[str, Any]] = []
    quality = {
        "input_membership_rows": int(len(roster)),
        "collapsed_membership_rows": 0,
        "multi_team_player_censuses": 0,
        "multi_organization_player_censuses": 0,
        "name_variant_player_censuses": 0,
    }
    for _, group in roster.groupby(keys, sort=True, dropna=False):
        ordered = group.sort_values(
            ["last_observed_on_team", "first_observed_on_team", "team_id"],
            kind="mergesort",
        )
        row = ordered.iloc[-1].to_dict()
        birth_dates = ordered["birth_date"].dropna().dt.date.unique()
        if len(birth_dates) > 1:
            player_key = f"{row['source_id_namespace']}:{row['source_player_id']}"
            raise RiskSetContractError(
                f"conflicting birth dates across membership stints for {player_key}"
            )
        teams = sorted(set(ordered["team_id"]))
        organizations = sorted(
            {
                organization.strip()
                for value in ordered["organization"]
                for organization in str(value).split(" | ")
                if organization.strip()
            }
        )
        levels = sorted(set(ordered["level"]))
        names = sorted(set(ordered["player_name"]))
        roles = set(ordered["role"])
        positions = sorted(set(ordered["position"]))
        if len(teams) > 1:
            quality["multi_team_player_censuses"] += 1
        if len(organizations) > 1:
            quality["multi_organization_player_censuses"] += 1
        if len(names) > 1:
            quality["name_variant_player_censuses"] += 1
        if "two_way" in roles or {"hitter", "pitcher"}.issubset(roles):
            row["role"] = "two_way"
        row["last_observed_level"] = row["level"]
        row["last_observed_organization"] = row["organization"]
        row["level"] = levels[0] if len(levels) == 1 else "Pooled multi-level"
        row["organization"] = (
            organizations[0]
            if len(organizations) == 1
            else "Pooled multi-organization"
        )
        row["pooled_stats_across_levels"] = len(levels) > 1
        row["pooled_stats_across_organizations"] = len(organizations) > 1
        row["position"] = "/".join(positions)
        row["birth_date"] = ordered["birth_date"].dropna().iloc[-1] if len(birth_dates) else pd.NaT
        for column in (
            "bats",
            "throws",
            "height_inches",
            "weight_pounds",
            "draft_year",
            "draft_round",
            "acquisition_type",
        ):
            row[column] = _latest_non_null(ordered, column)
        row["first_observed_on_team"] = ordered["first_observed_on_team"].min()
        row["last_observed_on_team"] = ordered["last_observed_on_team"].max()
        row["membership_stint_count"] = int(len(ordered))
        row["team_ids"] = " | ".join(teams)
        row["organizations"] = " | ".join(organizations)
        row["levels"] = " | ".join(levels)
        row["player_name_variants"] = " | ".join(names)
        row["membership_stints_json"] = json.dumps(
            [
                {
                    "team_id": stint["team_id"],
                    "organization": stint["organization"],
                    "level": stint["level"],
                    "roster_status": stint["roster_status"],
                    "role": stint["role"],
                    "position": stint["position"],
                    "first_observed_on_team": pd.Timestamp(
                        stint["first_observed_on_team"]
                    ).date().isoformat(),
                    "last_observed_on_team": pd.Timestamp(
                        stint["last_observed_on_team"]
                    ).date().isoformat(),
                }
                for stint in ordered.to_dict("records")
            ],
            sort_keys=True,
            separators=(",", ":"),
        )
        rows.append(row)
    quality["collapsed_membership_rows"] = int(len(roster) - len(rows))
    return pd.DataFrame(rows), quality


def _board_record(
    candidates: list[dict[str, Any]], role: str
) -> tuple[dict[str, Any] | None, bool]:
    if len(candidates) == 1:
        return candidates[0], False
    matching_role = [row for row in candidates if row.get("role") == role]
    if len(matching_role) == 1:
        return matching_role[0], False
    return None, bool(candidates)


def build_affiliated_risk_set(
    census_metadata: pd.DataFrame,
    roster_census: pd.DataFrame,
    player_seasons: pd.DataFrame,
    register: pd.DataFrame,
    board_snapshots: pd.DataFrame | None = None,
    *,
    data_cutoff: str = DATA_CUTOFF,
    include_edition_only_board_features: bool = False,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    adapter_quality = dict(census_metadata.attrs.get("adapter_quality", {}))
    metadata, roster_memberships, seasons = validate_canonical_inputs(
        census_metadata,
        roster_census,
        player_seasons,
        data_cutoff=data_cutoff,
    )
    roster, membership_quality = _aggregate_roster_memberships(roster_memberships)
    metadata_by_id = metadata.set_index("census_id").to_dict("index")
    identity_indexes = _identity_indexes(register)
    stats_by_player = _latest_available_stats(seasons)

    board_by_player: dict[tuple[str, int], list[dict[str, Any]]] = {}
    if (
        include_edition_only_board_features
        and board_snapshots is not None
        and not board_snapshots.empty
    ):
        for row in board_snapshots.to_dict("records"):
            player_id = _identifier(row.get("player_id"))
            edition = pd.to_numeric(row.get("edition"), errors="coerce")
            if player_id is not None and pd.notna(edition):
                board_by_player.setdefault((player_id, int(edition)), []).append(row)

    quality: dict[str, Any] = {
        "contract_version": RISK_SET_CONTRACT_VERSION,
        "snapshot_policy": RISK_SET_POLICY,
        "censuses": int(len(metadata)),
        "census_rows": int(len(roster)),
        **membership_quality,
        "resolved_identity_rows": 0,
        "unresolved_identity_rows": 0,
        "rows_with_prior_stats": 0,
        "rows_without_prior_stats": 0,
        "rows_on_fangraphs_board": 0,
        "ambiguous_fangraphs_board_rows": 0,
        "board_enrichment_policy": (
            "edition_year_end_conservative_not_strict"
            if include_edition_only_board_features
            else "excluded_edition_only"
        ),
        "effective_time_safe": not include_edition_only_board_features,
        "knowledge_time_verified": False,
        "strict_point_in_time_features": False,
        "source_adapter_quality": adapter_quality,
        "coverage": [],
    }
    rows: list[dict[str, Any]] = []
    board_fill_numeric = [column for column in NUMERIC_FEATURES if not column.startswith("prior_")]
    board_fill_categorical = [
        "risk",
        "variance",
        "bats",
        "throws",
        "acquisition_type",
    ]

    for roster_row in roster.to_dict("records"):
        census = metadata_by_id[str(roster_row["census_id"])]
        as_of = pd.Timestamp(census["as_of"])
        namespace = str(roster_row["source_id_namespace"])
        source_player_id = str(roster_row["source_player_id"])
        identity = identity_indexes[namespace].get(source_player_id)
        player_id = _identifier(identity.get("key_uuid")) if identity is not None else None
        if player_id is None:
            quality["unresolved_identity_rows"] += 1
        else:
            quality["resolved_identity_rows"] += 1

        row: dict[str, Any] = {
            "snapshot_id": f"milb:{roster_row['census_id']}:{namespace}:{source_player_id}",
            "census_id": roster_row["census_id"],
            "risk_set_player_key": f"{namespace}:{source_player_id}",
            "source_id_namespace": namespace,
            "source_player_id": source_player_id,
            "player_id": player_id,
            "fangraphs_id": _identifier(identity.get("key_fangraphs")) if identity else None,
            "mlbam_id": _identifier(identity.get("key_mlbam")) if identity else None,
            "bbref_id": _identifier(identity.get("key_bbref")) if identity else None,
            "player_name": roster_row["player_name"],
            "edition": int(census["season"]),
            "as_of": as_of,
            "availability_quality": (
                "edition_only_board_enrichment_effective_time_unverified"
                if include_edition_only_board_features
                else f"effective_time_safe_knowledge_time_unverified_{census['cohort_basis']}"
            ),
            "cohort_basis": census["cohort_basis"],
            "coverage_scope": census["coverage_scope"],
            "source_universe_scope": f"full_{census['cohort_basis']}_census",
            "model_analysis_scope": None,
            "effective_time_safe": not include_edition_only_board_features,
            "knowledge_time_verified": False,
            "identity_method": f"chadwick_{namespace}" if player_id else None,
            "identity_resolved": player_id is not None,
            "organization": roster_row["organization"],
            "last_observed_organization": roster_row[
                "last_observed_organization"
            ],
            "team_id": roster_row["team_id"],
            "team_ids": roster_row["team_ids"],
            "organizations": roster_row["organizations"],
            "levels": roster_row["levels"],
            "membership_stint_count": roster_row["membership_stint_count"],
            "membership_stints_json": roster_row["membership_stints_json"],
            "pooled_stats_across_levels": roster_row[
                "pooled_stats_across_levels"
            ],
            "pooled_stats_across_organizations": roster_row[
                "pooled_stats_across_organizations"
            ],
            "first_observed_on_team": roster_row["first_observed_on_team"],
            "last_observed_on_team": roster_row["last_observed_on_team"],
            "prior_level": roster_row["level"],
            "last_observed_level": roster_row["last_observed_level"],
            "roster_status": roster_row["roster_status"],
            "role": roster_row["role"],
            "position": roster_row["position"],
            "bats": roster_row["bats"],
            "throws": roster_row["throws"],
            "risk": None,
            "variance": None,
            "age": None,
            "height_inches": roster_row["height_inches"],
            "weight_pounds": roster_row["weight_pounds"],
            "draft_year": roster_row["draft_year"],
            "draft_round": roster_row["draft_round"],
            "acquisition_type": roster_row["acquisition_type"],
            "prior_season": None,
            "prior_stats_through": pd.NaT,
            "has_prior_stats": False,
            "on_fangraphs_board": False,
            "fangraphs_snapshot_id": None,
            "feature_support_status": (
                "unsupported_two_way_shared_feature_contract"
                if roster_row["role"] == "two_way"
                else "supported"
            ),
            "board_feature_availability": (
                "edition_year_end_conservative_not_strict"
                if include_edition_only_board_features
                else "excluded_edition_only"
            ),
        }
        birth_date = roster_row["birth_date"]
        if pd.notna(birth_date) and pd.Timestamp(birth_date) <= as_of:
            row["age"] = round((as_of - pd.Timestamp(birth_date)).days / 365.2425, 4)

        for feature in NUMERIC_FEATURES:
            row.setdefault(feature, None)
        for feature in CATEGORICAL_FEATURES:
            row.setdefault(feature, None)
        for feature in DOMAIN_STAT_FEATURES:
            row.setdefault(feature, None)
        row["role_inference_basis"] = None

        candidates = stats_by_player.get((namespace, source_player_id), [])
        available = [candidate for candidate in candidates if candidate["stats_through"] <= as_of]
        if available:
            latest = available[-1]
            row["prior_season"] = int(latest["season"])
            row["prior_stats_through"] = latest["stats_through"]
            row["has_prior_stats"] = True
            quality["rows_with_prior_stats"] += 1
            for feature in PRIOR_STAT_FEATURES:
                row[feature] = latest[feature]
            for feature in DOMAIN_STAT_FEATURES:
                row[feature] = latest[feature]
            row["role_inference_basis"] = latest["role_inference_basis"]
        else:
            quality["rows_without_prior_stats"] += 1

        if player_id is not None:
            board, ambiguous = _board_record(
                board_by_player.get((player_id, int(census["season"])), []),
                str(roster_row["role"]),
            )
            if ambiguous:
                quality["ambiguous_fangraphs_board_rows"] += 1
            if board is not None and pd.Timestamp(board["as_of"]) <= as_of:
                row["on_fangraphs_board"] = True
                row["fangraphs_snapshot_id"] = board.get("snapshot_id")
                quality["rows_on_fangraphs_board"] += 1
                for feature in board_fill_numeric + board_fill_categorical:
                    if pd.isna(row.get(feature)) and pd.notna(board.get(feature)):
                        row[feature] = board.get(feature)
        rows.append(row)

    snapshots = pd.DataFrame(rows)
    resolved = snapshots[snapshots["player_id"].notna()]
    if resolved.duplicated(["census_id", "player_id"], keep=False).any():
        raise RiskSetContractError(
            "multiple source identities resolve to the same player within a census"
        )
    assert_feature_contract(snapshots.columns.tolist())

    denominator = max(len(snapshots), 1)
    quality["identity_resolution_rate"] = round(
        quality["resolved_identity_rows"] / denominator, 6
    )
    quality["prior_stats_coverage_rate"] = round(
        quality["rows_with_prior_stats"] / denominator, 6
    )
    quality["fangraphs_board_coverage_rate"] = round(
        quality["rows_on_fangraphs_board"] / denominator, 6
    )

    for census in metadata.to_dict("records"):
        census_rows = snapshots[snapshots["census_id"] == census["census_id"]]
        quality["coverage"].append(
            {
                "census_id": census["census_id"],
                "season": int(census["season"]),
                "as_of": pd.Timestamp(census["as_of"]).date().isoformat(),
                "players": int(len(census_rows)),
                "teams": int(census["observed_team_count"]),
                "resolved_players": int(census_rows["player_id"].notna().sum()),
                "identity_resolution_rate": round(
                    float(census_rows["player_id"].notna().mean()), 6
                ),
                "source": census["source"],
                "cohort_basis": census["cohort_basis"],
                "coverage_scope": census["coverage_scope"],
                "inclusion_rule": census["inclusion_rule"],
            }
        )
    return snapshots, quality
