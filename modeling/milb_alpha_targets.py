from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd


TARGET_VERSION = "mlb-war-next-five-calendar-seasons-v1"
DEFAULT_WAR_THRESHOLDS = (1.0, 2.0, 5.0, 10.0)


class MilbAlphaTargetError(ValueError):
    pass


def _require_columns(frame: pd.DataFrame, columns: Sequence[str], label: str) -> None:
    missing = sorted(set(columns) - set(frame.columns))
    if missing:
        raise MilbAlphaTargetError(f"{label} is missing columns: {', '.join(missing)}")


def _threshold_column(value: float, window_seasons: int) -> str:
    suffix = str(int(value)) if float(value).is_integer() else str(value).replace(".", "_")
    return f"mlb_war_next_{window_seasons}_ge_{suffix}"


def build_five_calendar_year_war_targets(
    snapshots: pd.DataFrame,
    career_outcomes: pd.DataFrame,
    war_seasons: pd.DataFrame,
    *,
    latest_complete_season: int,
    window_seasons: int = 5,
    thresholds: Sequence[float] = DEFAULT_WAR_THRESHOLDS,
) -> pd.DataFrame:
    """Build an unconditional post-snapshot MLB value target.

    A season-end MiLB snapshot's window begins in the following MLB season and
    contains ``window_seasons`` calendar seasons. Mature players with no MLB WAR
    row in that complete window receive zero; immature windows remain unlabeled.
    Identity joins are exact and the resolution path remains in the output.
    """

    _require_columns(snapshots, ("snapshot_id", "player_id", "edition"), "snapshots")
    _require_columns(career_outcomes, ("player_id", "bbref_id", "debut"), "career outcomes")
    _require_columns(war_seasons, ("bbref_id", "season", "total_war"), "WAR seasons")

    if not isinstance(latest_complete_season, int):
        raise MilbAlphaTargetError("latest_complete_season must be an integer")
    if not isinstance(window_seasons, int) or window_seasons < 1:
        raise MilbAlphaTargetError("window_seasons must be a positive integer")

    normalized_thresholds = tuple(sorted(set(float(value) for value in thresholds)))
    if not normalized_thresholds or any(
        not np.isfinite(value) for value in normalized_thresholds
    ):
        raise MilbAlphaTargetError("thresholds must contain finite values")

    source = snapshots.copy()
    if source["snapshot_id"].isna().any() or source["snapshot_id"].duplicated().any():
        raise MilbAlphaTargetError("snapshot_id must be non-null and unique")
    if source["player_id"].isna().any():
        raise MilbAlphaTargetError("MiLB snapshots require exact player_id identities")
    source["edition"] = pd.to_numeric(source["edition"], errors="coerce")
    if source["edition"].isna().any() or (source["edition"] % 1 != 0).any():
        raise MilbAlphaTargetError("snapshot edition must be an integer season")
    source["edition"] = source["edition"].astype(int)
    source["snapshot_bbref_id"] = (
        source["bbref_id"].astype("string")
        if "bbref_id" in source
        else pd.Series(pd.NA, index=source.index, dtype="string")
    )

    outcomes = career_outcomes.loc[career_outcomes["player_id"].notna()].copy()
    if outcomes["player_id"].duplicated().any():
        raise MilbAlphaTargetError("career outcomes must have at most one row per player_id")
    outcomes = outcomes[["player_id", "bbref_id", "debut"]].rename(
        columns={"bbref_id": "career_bbref_id", "debut": "career_debut"}
    )
    outcomes["career_bbref_id"] = outcomes["career_bbref_id"].astype("string")

    targets = source.merge(outcomes, on="player_id", how="left", validate="many_to_one")
    conflicts = (
        targets["snapshot_bbref_id"].notna()
        & targets["career_bbref_id"].notna()
        & targets["snapshot_bbref_id"].ne(targets["career_bbref_id"])
    )
    if conflicts.any():
        raise MilbAlphaTargetError("snapshot and career outcome Baseball-Reference IDs conflict")

    targets["resolved_bbref_id"] = targets["snapshot_bbref_id"].combine_first(
        targets["career_bbref_id"]
    )
    both = targets["snapshot_bbref_id"].notna() & targets["career_bbref_id"].notna()
    targets["identity_resolution"] = np.select(
        [both, targets["snapshot_bbref_id"].notna(), targets["career_bbref_id"].notna()],
        ["snapshot_and_career_confirmed", "snapshot_identity", "career_outcome_identity"],
        default="no_mlb_identity_observed",
    )

    war_columns = ["bbref_id", "season", "total_war"]
    if "season_state" in war_seasons:
        war_columns.append("season_state")
    war = war_seasons[war_columns].copy()
    war["bbref_id"] = war["bbref_id"].astype("string")
    war["season"] = pd.to_numeric(war["season"], errors="coerce")
    war["total_war"] = pd.to_numeric(war["total_war"], errors="coerce")
    if war[["bbref_id", "season", "total_war"]].isna().any(axis=None):
        raise MilbAlphaTargetError("WAR season identities, seasons, and values must be complete")
    if (war["season"] % 1 != 0).any():
        raise MilbAlphaTargetError("WAR season must be an integer")
    war["season"] = war["season"].astype(int)
    completed_window = war["season"].le(latest_complete_season)
    if (
        "season_state" in war
        and war.loc[completed_window, "season_state"].ne("complete").any()
    ):
        raise MilbAlphaTargetError(
            "WAR rows through latest_complete_season must have complete season state"
        )
    if war.duplicated(["bbref_id", "season"]).any():
        raise MilbAlphaTargetError("WAR seasons must have one row per player and season")
    war = war.loc[completed_window]

    targets["window_start_season"] = targets["edition"] + 1
    targets["window_end_season"] = targets["edition"] + window_seasons
    targets["target_mature"] = targets["window_end_season"].le(latest_complete_season)

    joined = targets[
        ["snapshot_id", "resolved_bbref_id", "window_start_season", "window_end_season"]
    ].merge(war, left_on="resolved_bbref_id", right_on="bbref_id", how="left")
    in_window = joined["season"].between(
        joined["window_start_season"], joined["window_end_season"], inclusive="both"
    )
    observed = joined.loc[in_window]
    war_totals = observed.groupby("snapshot_id", sort=False)["total_war"].sum()
    war_rows = observed.groupby("snapshot_id", sort=False).size()

    targets["war_season_rows"] = targets["snapshot_id"].map(war_rows).fillna(0).astype(int)
    target_value = targets["snapshot_id"].map(war_totals).fillna(0.0).astype(float)
    targets[f"mlb_war_next_{window_seasons}_seasons"] = target_value.where(
        targets["target_mature"]
    )

    debut_year = pd.to_datetime(targets["career_debut"], errors="coerce").dt.year
    targets["debut_within_target_window"] = (
        debut_year.between(
            targets["window_start_season"], targets["window_end_season"], inclusive="both"
        )
        & targets["target_mature"]
    )
    targets["career_outcome_identity_matched"] = targets["career_bbref_id"].notna()
    targets["label_status"] = np.where(
        ~targets["target_mature"],
        "immature_window",
        np.where(
            targets["war_season_rows"].gt(0),
            "mature_observed_mlb_war",
            "mature_zero_no_mlb_war_row",
        ),
    )

    for threshold in normalized_thresholds:
        column = _threshold_column(threshold, window_seasons)
        values = target_value.ge(threshold).astype("boolean")
        targets[column] = values.where(targets["target_mature"], pd.NA)

    targets["target_version"] = TARGET_VERSION
    output_columns = [
        "snapshot_id",
        "player_id",
        "edition",
        "window_start_season",
        "window_end_season",
        "target_mature",
        "target_version",
        "resolved_bbref_id",
        "identity_resolution",
        "career_outcome_identity_matched",
        "debut_within_target_window",
        "war_season_rows",
        f"mlb_war_next_{window_seasons}_seasons",
        *[_threshold_column(value, window_seasons) for value in normalized_thresholds],
        "label_status",
    ]
    return targets[output_columns].sort_values("snapshot_id", kind="mergesort").reset_index(drop=True)
