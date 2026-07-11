from __future__ import annotations

SURVIVAL_HORIZON_MONTHS = (12, 24, 36, 48, 60)
EVALUATION_HORIZON_MONTHS = SURVIVAL_HORIZON_MONTHS
DATA_CUTOFF = "2025-12-31"

IDENTIFIER_COLUMNS = [
    "snapshot_id",
    "player_id",
    "fangraphs_id",
    "mlbam_id",
    "bbref_id",
    "player_name",
    "edition",
    "as_of",
]

CATEGORICAL_FEATURES = [
    "role",
    "position",
    "organization",
    "bats",
    "throws",
    "risk",
    "variance",
    "prior_level",
    "acquisition_type",
]

NUMERIC_FEATURES = [
    "age",
    "height_inches",
    "weight_pounds",
    "overall_rank",
    "organization_rank",
    "future_value",
    "eta_years",
    "draft_year",
    "draft_round",
    "present_hit",
    "future_hit",
    "present_game_power",
    "future_game_power",
    "present_raw_power",
    "future_raw_power",
    "present_speed",
    "future_speed",
    "present_fielding",
    "future_fielding",
    "present_arm",
    "future_arm",
    "present_fastball",
    "future_fastball",
    "present_slider",
    "future_slider",
    "present_curveball",
    "future_curveball",
    "present_changeup",
    "future_changeup",
    "present_command",
    "future_command",
    "prior_g",
    "prior_pa",
    "prior_ab",
    "prior_ip",
    "prior_tbf",
    "prior_hr",
    "prior_bb",
    "prior_so",
    "prior_sb",
    "prior_bb_rate",
    "prior_k_rate",
    "prior_k_minus_bb_rate",
    "prior_iso",
    "prior_babip",
    "prior_wrc_plus",
    "prior_era",
    "prior_fip",
    "prior_xfip",
    "prior_whip",
    "prior_gb_rate",
    "prior_ld_rate",
    "prior_fb_rate",
    "prior_swstr_rate",
]

FORBIDDEN_FEATURE_TOKENS = (
    "debut",
    "finalgame",
    "halloffame",
    "inducted",
    "career_",
    "servicetime",
    "current_level",
    "current_age",
    "label_",
    "outcome_",
)


def assert_feature_contract(columns: list[str]) -> None:
    expected = set(CATEGORICAL_FEATURES + NUMERIC_FEATURES)
    missing = sorted(expected - set(columns))
    if missing:
        raise ValueError(f"Missing declared feature columns: {', '.join(missing)}")

    forbidden = sorted(
        column
        for column in columns
        if any(token in column.lower() for token in FORBIDDEN_FEATURE_TOKENS)
    )
    if forbidden:
        raise ValueError(f"Forbidden outcome/future fields in feature contract: {forbidden}")
