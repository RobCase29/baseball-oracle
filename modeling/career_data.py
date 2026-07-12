from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd


CAREER_DATA_SCHEMA_VERSION = "career-oracle-landmarks/v1"
DEFAULT_INACTIVITY_YEARS = 3
HITTER_POSITIONS = ("C", "1B", "2B", "3B", "SS", "LF", "CF", "RF")
EXACT_STANDARD_KEYS = (*HITTER_POSITIONS, "P", "RP")
NUMERIC_FEATURES = (
    "age",
    "season_number",
    "years_since_debut",
    "season_war",
    "season_b_war",
    "season_p_war",
    "career_war_to_date",
    "career_b_war_to_date",
    "career_p_war_to_date",
    "peak_seven_war_to_date",
    "jaws_to_date",
    "war_last_three",
    "war_best_to_date",
    "war_positive_seasons",
    "career_war_per_season",
    "career_b_pa",
    "career_p_ip_outs",
    "career_p_games",
    "career_p_games_started",
    "starter_share",
    "standard_jaws",
)
CATEGORICAL_FEATURES = ("role", "position", "standard_key")
TARGET_ONLY_COLUMNS = (
    "final_career_war",
    "final_peak_seven_war",
    "final_jaws",
    "hof_caliber",
    "hof_caliber_completed_standard",
    "target_role",
    "target_position",
    "target_standard_key",
    "target_standard_jaws",
    "target_standard_fallback",
    "target_eligible",
    "career_end_year",
    "resolved_career",
)


class CareerDataError(ValueError):
    pass


@dataclass(frozen=True)
class CareerSplit:
    train_players: tuple[str, ...]
    calibration_players: tuple[str, ...]
    test_players: tuple[str, ...]
    train_end_year: int
    calibration_start_year: int
    calibration_end_year: int
    test_start_year: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "trainPlayers": len(self.train_players),
            "calibrationPlayers": len(self.calibration_players),
            "testPlayers": len(self.test_players),
            "trainEndYear": self.train_end_year,
            "calibrationStartYear": self.calibration_start_year,
            "calibrationEndYear": self.calibration_end_year,
            "testStartYear": self.test_start_year,
            "playerDisjoint": True,
        }


def read_records(path: Path) -> pd.DataFrame:
    """Read a flat JSON array, wrapped JSON rows, JSONL, or CSV table."""

    if not path.exists():
        raise CareerDataError(f"Input does not exist: {path}")
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        return pd.read_csv(path, sep="\t" if suffix == ".tsv" else ",")
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    if suffix not in {".json", ".jsonl", ".ndjson"}:
        raise CareerDataError(f"Unsupported input format: {path.suffix}")

    if suffix in {".jsonl", ".ndjson"}:
        return pd.read_json(path, lines=True)
    value = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(value, list):
        rows = value
    elif isinstance(value, dict):
        rows = None
        for key in ("rows", "player_seasons", "standards", "inductees", "data", "items"):
            candidate = value.get(key)
            if isinstance(candidate, list):
                rows = candidate
                break
        if rows is None:
            raise CareerDataError(f"JSON object at {path} has no recognized row array")
    else:
        raise CareerDataError(f"JSON input at {path} must contain an array or object")
    return pd.DataFrame(rows)


def _first_column(frame: pd.DataFrame, names: Sequence[str]) -> pd.Series | None:
    for name in names:
        if name in frame.columns:
            return frame[name]
    return None


def _numeric(frame: pd.DataFrame, names: Sequence[str], default: float = math.nan) -> pd.Series:
    source = _first_column(frame, names)
    if source is None:
        return pd.Series(default, index=frame.index, dtype=float)
    return pd.to_numeric(source, errors="coerce").astype(float)


def _text(frame: pd.DataFrame, names: Sequence[str], default: str = "") -> pd.Series:
    source = _first_column(frame, names)
    if source is None:
        return pd.Series(default, index=frame.index, dtype="string")
    return source.astype("string").fillna(default).str.strip()


def normalize_position(value: object) -> str:
    raw = str(value or "").upper().strip()
    if not raw or raw in {"NAN", "NONE", "<NA>"}:
        return "UNKNOWN"
    if raw in {*HITTER_POSITIONS, "DH", "P", "RP"}:
        return raw
    raw = raw.replace("*", "").replace("#", "")
    # Baseball-Reference compact position codes mix defensive digits with H/D
    # appearance markers. A real defensive position takes precedence anywhere.
    compact_code = re.sub(r"[\s,/;-]+", "", raw)
    if compact_code and not re.search(r"[ABCEFGI-QS-Z]", compact_code):
        defensive = re.search(r"[2-9]", compact_code)
        if defensive:
            return {
                "2": "C",
                "3": "1B",
                "4": "2B",
                "5": "3B",
                "6": "SS",
                "7": "LF",
                "8": "CF",
                "9": "RF",
            }[defensive.group(0)]
        if "D" in compact_code:
            return "DH"
        if "1" in compact_code:
            return "P"
        if "H" in compact_code:
            return "DH"
    tokens = [token for token in re.split(r"[\s,/;-]+", raw) if token]
    aliases = {
        "1": "P",
        "2": "C",
        "3": "1B",
        "4": "2B",
        "5": "3B",
        "6": "SS",
        "7": "LF",
        "8": "CF",
        "9": "RF",
        "D": "DH",
        "H": "DH",
        "CATCHER": "C",
        "FIRST": "1B",
        "SECOND": "2B",
        "THIRD": "3B",
        "SHORTSTOP": "SS",
        "LEFTFIELD": "LF",
        "CENTERFIELD": "CF",
        "RIGHTFIELD": "RF",
        "DESIGNATEDHITTER": "DH",
        "STARTER": "P",
        "STARTINGPITCHER": "P",
        "RELIEVER": "RP",
        "RELIEFPITCHER": "RP",
        "PITCHER": "P",
    }
    for token in tokens:
        compact = re.sub(r"[^A-Z0-9]", "", token)
        normalized = aliases.get(compact, compact)
        if normalized in {*HITTER_POSITIONS, "DH", "P", "RP"}:
            return normalized
        if compact and compact[0] in aliases:
            normalized = aliases[compact[0]]
            if normalized in {*HITTER_POSITIONS, "DH", "P", "RP"}:
                return normalized
    return "UNKNOWN"


def normalize_player_seasons(frame: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(frame, pd.DataFrame) or frame.empty:
        raise CareerDataError("Player seasons must be a nonempty DataFrame")
    player_id = _text(
        frame,
        ("bbref_id", "player_id", "bbrefId", "source_player_id", "playerID"),
    )
    name = _text(frame, ("player_name", "name", "player", "playerName"))
    season = _numeric(frame, ("season", "year", "year_id", "yearID"))
    if player_id.eq("").any() or name.eq("").any():
        raise CareerDataError("Every player-season row requires a player ID and name")
    if season.isna().any() or not season.eq(np.floor(season)).all():
        raise CareerDataError("Every player-season row requires an integer season")

    b_war = _numeric(frame, ("b_war", "batting_war", "war_bat"), 0.0).fillna(0.0)
    p_war = _numeric(frame, ("p_war", "pitching_war", "war_pitch"), 0.0).fillna(0.0)
    total_source = _first_column(frame, ("total_war", "war", "WAR"))
    total_war = (
        pd.to_numeric(total_source, errors="coerce").astype(float)
        if total_source is not None
        else b_war + p_war
    )
    total_war = total_war.fillna(b_war + p_war)
    if not np.isfinite(total_war.to_numpy()).all():
        raise CareerDataError("Player-season WAR must be finite")

    season_state = _text(frame, ("season_state", "seasonState"), "complete").str.lower()
    if not season_state.isin(["complete", "in_season"]).all():
        bad = sorted(set(season_state) - {"complete", "in_season"})
        raise CareerDataError(f"Unsupported season_state values: {bad}")

    role = _text(frame, ("role", "player_type", "playerType"), "").str.lower()
    b_pa = _numeric(frame, ("b_pa", "pa", "batting_pa"), 0.0).fillna(0.0)
    p_outs = _numeric(frame, ("p_ip_outs", "pitching_outs", "ipouts"), 0.0).fillna(0.0)
    inferred_role = np.select(
        [(b_pa >= 100) & (p_outs >= 90), p_outs > b_pa, b_pa >= 0],
        ["two_way", "pitcher", "hitter"],
        default="hitter",
    )
    role = role.where(role.isin(["hitter", "pitcher", "two_way"]), inferred_role)

    normalized = pd.DataFrame(
        {
            "bbref_id": player_id.astype(str),
            "player_name": name.astype(str),
            "season": season.astype(int),
            "season_state": season_state.astype(str),
            "known_at": _text(frame, ("known_at", "knownAt"), "").astype(str),
            "age": _numeric(frame, ("age", "age_midseason", "ageMidseason")),
            "team": _text(frame, ("team", "team_name", "organization"), "").astype(str),
            "position": _text(frame, ("position", "pos", "primary_position"), "")
            .map(normalize_position)
            .astype(str),
            "source_role": role.astype(str),
            "b_pa": b_pa.astype(float),
            "b_war": b_war.astype(float),
            "p_ip_outs": p_outs.astype(float),
            "p_games": _numeric(frame, ("p_games", "p_g", "pitching_g"), 0.0).fillna(0.0),
            "p_games_started": _numeric(
                frame, ("p_games_started", "p_gs", "pitching_gs"), 0.0
            ).fillna(0.0),
            "p_war": p_war.astype(float),
            "total_war": total_war.astype(float),
        }
    )
    if normalized.duplicated(["bbref_id", "season"]).any():
        duplicate = normalized.loc[
            normalized.duplicated(["bbref_id", "season"], keep=False),
            ["bbref_id", "season"],
        ].iloc[0]
        raise CareerDataError(
            f"Duplicate player-season key: {duplicate['bbref_id']} {duplicate['season']}"
        )
    if (normalized["p_games_started"] > normalized["p_games"]).any():
        raise CareerDataError("Pitching starts cannot exceed pitching games")
    return normalized.sort_values(["bbref_id", "season"], kind="mergesort").reset_index(
        drop=True
    )


def normalize_jaws_standards(frame: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(frame, pd.DataFrame) or frame.empty:
        raise CareerDataError("JAWS standards must be a nonempty DataFrame")
    position = _text(frame, ("position", "standard_key", "pos")).map(normalize_position)
    standards = pd.DataFrame(
        {
            "position": position.astype(str),
            "label": _text(frame, ("label", "description"), "").astype(str),
            "hof_player_count": _numeric(frame, ("hof_player_count", "count", "n")),
            "career_war_standard": _numeric(
                frame, ("career_war_standard", "career_war", "WAR_career")
            ),
            "peak_seven_war_standard": _numeric(
                frame, ("peak_seven_war_standard", "peak_seven_war", "WAR_peak7")
            ),
            "jaws_standard": _numeric(frame, ("jaws_standard", "jaws", "JAWS")),
        }
    )
    standards = standards.loc[standards["position"].isin(EXACT_STANDARD_KEYS)].copy()
    if standards.empty or standards["position"].duplicated().any():
        raise CareerDataError("JAWS standards require unique supported position rows")
    required_values = standards[
        ["career_war_standard", "peak_seven_war_standard", "jaws_standard"]
    ].to_numpy(dtype=float)
    if not np.isfinite(required_values).all():
        raise CareerDataError("JAWS standard values must be finite")
    return standards.sort_values("position", kind="mergesort").reset_index(drop=True)


def standard_lookup(standards: pd.DataFrame) -> dict[str, dict[str, Any]]:
    normalized = normalize_jaws_standards(standards)
    result = {str(row["position"]): dict(row) for row in normalized.to_dict("records")}
    hitter_rows = normalized.loc[normalized["position"].isin(HITTER_POSITIONS)]
    pitcher_rows = normalized.loc[normalized["position"].isin(["P", "RP"])]
    for key, rows in (("HITTER_FALLBACK", hitter_rows), ("PITCHER_FALLBACK", pitcher_rows)):
        if rows.empty:
            continue
        result[key] = {
            "position": key,
            "label": f"Derived median of available exact {key.lower().replace('_', ' ')} standards",
            "hof_player_count": int(rows["hof_player_count"].fillna(0).sum()),
            "career_war_standard": float(rows["career_war_standard"].median()),
            "peak_seven_war_standard": float(rows["peak_seven_war_standard"].median()),
            "jaws_standard": float(rows["jaws_standard"].median()),
            "derived_fallback": True,
        }
    if "P" not in result and "RP" in result:
        result["PITCHER_FALLBACK"] = {**result["RP"], "position": "PITCHER_FALLBACK"}
    if "RP" not in result and "P" in result:
        result["PITCHER_FALLBACK"] = {**result["P"], "position": "PITCHER_FALLBACK"}
    return result


def peak_seven(values: Iterable[float]) -> float:
    array = np.asarray(list(values), dtype=float)
    if array.size == 0:
        return 0.0
    if not np.isfinite(array).all():
        raise CareerDataError("Peak-seven input contains missing or nonfinite WAR")
    take = min(7, len(array))
    return float(np.sort(array)[-take:].sum())


def _weighted_mode(values: Sequence[str], weights: Sequence[float]) -> str:
    totals: dict[str, float] = {}
    latest: dict[str, int] = {}
    for index, (value, weight) in enumerate(zip(values, weights, strict=True)):
        normalized = normalize_position(value)
        totals[normalized] = totals.get(normalized, 0.0) + max(float(weight), 1.0)
        latest[normalized] = index
    if not totals:
        return "UNKNOWN"
    return max(totals, key=lambda key: (totals[key], latest[key], key))


def _point_in_time_role(group: pd.DataFrame) -> tuple[str, str]:
    b_pa = float(group["b_pa"].sum())
    p_outs = float(group["p_ip_outs"].sum())
    p_games = float(group["p_games"].sum())
    p_starts = float(group["p_games_started"].sum())
    season_two_way = bool(
        ((group["b_pa"] >= 300) & (group["p_ip_outs"] >= 90)).any()
    )
    if season_two_way:
        return "two_way", "TWO_WAY"
    batting_workload = b_pa / 600.0
    pitching_workload = (p_outs / 3.0) / 180.0
    if p_outs > 0 and pitching_workload >= batting_workload:
        return "pitcher", "P" if p_games <= 0 or p_starts / p_games >= 0.4 else "RP"
    position = _weighted_mode(group["position"].tolist(), group["b_pa"].tolist())
    return "hitter", position


def _resolve_standard_key(
    role: str, position: str, lookup: Mapping[str, Mapping[str, Any]]
) -> tuple[str, bool, str | None]:
    if role == "pitcher" and position in {"P", "RP"} and position in lookup:
        return position, False, None
    if role == "hitter" and position in HITTER_POSITIONS and position in lookup:
        return position, False, None
    if role == "hitter" and position == "DH" and "DH" in lookup:
        return "DH", False, None
    if role == "pitcher" and "PITCHER_FALLBACK" in lookup:
        return "PITCHER_FALLBACK", True, f"standard_fallback:{position.lower()}"
    if role == "hitter" and "HITTER_FALLBACK" in lookup:
        return "HITTER_FALLBACK", True, f"standard_fallback:{position.lower()}"
    fallback = "PITCHER_FALLBACK" if role in {"pitcher", "two_way"} else "HITTER_FALLBACK"
    if fallback in lookup:
        return fallback, True, f"standard_fallback:{role}"
    raise CareerDataError(f"No JAWS standard or fallback is available for {role}/{position}")


def _infer_age(group: pd.DataFrame) -> pd.Series:
    ages = group["age"].copy()
    known = ages.notna()
    if known.any():
        offsets = ages[known] - group.loc[known, "season"]
        birth_offset = float(offsets.median())
        return ages.fillna(group["season"] + birth_offset)
    return pd.Series(np.nan, index=group.index, dtype=float)


def build_career_landmarks(
    player_seasons: pd.DataFrame,
    jaws_standards: pd.DataFrame,
    *,
    as_of_year: int | None = None,
    inactivity_years: int = DEFAULT_INACTIVITY_YEARS,
) -> pd.DataFrame:
    seasons = normalize_player_seasons(player_seasons)
    lookup = standard_lookup(jaws_standards)
    inferred_as_of = int(seasons["season"].max())
    as_of = int(as_of_year or inferred_as_of)
    if inactivity_years < 2:
        raise CareerDataError("Career resolution requires at least two inactive seasons")

    rows: list[dict[str, Any]] = []
    for player_id, raw_group in seasons.groupby("bbref_id", sort=True):
        group = raw_group.sort_values("season", kind="mergesort").copy()
        group["age"] = _infer_age(group)
        complete = group.loc[group["season_state"].eq("complete")].copy()
        if complete.empty:
            continue
        career_end = int(complete["season"].max())
        has_later_partial = bool(
            ((group["season_state"] == "in_season") & (group["season"] >= career_end)).any()
        )
        resolved = career_end <= as_of - inactivity_years and not has_later_partial
        debut_year = int(complete["season"].min())
        target_role, target_position = _point_in_time_role(complete)
        target_standard_key, target_fallback, _ = _resolve_standard_key(
            target_role, target_position, lookup
        )
        target_standard = lookup[target_standard_key]
        target_value_column = (
            "b_war"
            if target_role == "hitter"
            else "p_war"
            if target_role == "pitcher"
            else "total_war"
        )
        target_final_values = complete[target_value_column].to_numpy(dtype=float)
        stable_final_war = float(target_final_values.sum())
        stable_final_peak = peak_seven(target_final_values)
        stable_final_jaws = (stable_final_war + stable_final_peak) / 2.0

        for season_number, (_, current) in enumerate(complete.iterrows(), start=1):
            history = complete.loc[complete["season"] <= int(current["season"])]
            role, position = _point_in_time_role(history)
            standard_key, fallback, fallback_warning = _resolve_standard_key(
                role, position, lookup
            )
            standard = lookup[standard_key]
            value_column = (
                "b_war"
                if role == "hitter"
                else "p_war"
                if role == "pitcher"
                else "total_war"
            )
            war_values = history[value_column].to_numpy(dtype=float)
            current_peak = peak_seven(war_values)
            cumulative_war = float(war_values.sum())
            warnings = [fallback_warning] if fallback_warning else []
            rows.append(
                {
                    "bbref_id": str(player_id),
                    "player_name": str(current["player_name"]),
                    "season": int(current["season"]),
                    "age": float(current["age"]) if pd.notna(current["age"]) else np.nan,
                    "team": str(current["team"]),
                    "season_number": season_number,
                    "years_since_debut": int(current["season"]) - debut_year,
                    "role": role,
                    "position": position,
                    "standard_key": standard_key,
                    "standard_jaws": float(standard["jaws_standard"]),
                    "standard_fallback": fallback,
                    "standard_warning": fallback_warning,
                    "warnings": warnings,
                    "season_war": float(current[value_column]),
                    "season_b_war": float(current["b_war"]),
                    "season_p_war": float(current["p_war"]),
                    "career_war_to_date": cumulative_war,
                    "career_b_war_to_date": float(history["b_war"].sum()),
                    "career_p_war_to_date": float(history["p_war"].sum()),
                    "peak_seven_war_to_date": current_peak,
                    "jaws_to_date": (cumulative_war + current_peak) / 2.0,
                    "war_last_three": float(war_values[-3:].mean()),
                    "war_best_to_date": float(war_values.max()),
                    "war_positive_seasons": int((war_values > 0).sum()),
                    "career_war_per_season": cumulative_war / season_number,
                    "career_b_pa": float(history["b_pa"].sum()),
                    "career_p_ip_outs": float(history["p_ip_outs"].sum()),
                    "career_p_games": float(history["p_games"].sum()),
                    "career_p_games_started": float(history["p_games_started"].sum()),
                    "starter_share": float(history["p_games_started"].sum())
                    / max(float(history["p_games"].sum()), 1.0),
                    "debut_year": debut_year,
                    "career_end_year": career_end,
                    "resolved_career": resolved,
                    "final_career_war": stable_final_war if resolved else np.nan,
                    "final_peak_seven_war": stable_final_peak if resolved else np.nan,
                    "final_jaws": stable_final_jaws if resolved else np.nan,
                    "hof_caliber": (
                        int(
                            stable_final_jaws
                            >= float(standard["jaws_standard"])
                        )
                        if resolved
                        else pd.NA
                    ),
                    "hof_caliber_completed_standard": (
                        int(
                            stable_final_jaws
                            >= float(target_standard["jaws_standard"])
                        )
                        if resolved
                        else pd.NA
                    ),
                    "target_role": target_role if resolved else pd.NA,
                    "target_position": target_position if resolved else pd.NA,
                    "target_standard_key": target_standard_key if resolved else pd.NA,
                    "target_standard_jaws": (
                        float(target_standard["jaws_standard"]) if resolved else np.nan
                    ),
                    "target_standard_fallback": target_fallback if resolved else pd.NA,
                    "target_eligible": (
                        target_role != "two_way" if resolved else pd.NA
                    ),
                }
            )
    if not rows:
        raise CareerDataError("No complete player seasons were available for landmark construction")
    panel = pd.DataFrame(rows).sort_values(
        ["bbref_id", "season"], kind="mergesort"
    ).reset_index(drop=True)
    panel["hof_caliber"] = panel["hof_caliber"].astype("Int8")
    validate_landmark_panel(panel)
    return panel


def validate_landmark_panel(panel: pd.DataFrame) -> None:
    required = {
        "bbref_id",
        "season",
        *NUMERIC_FEATURES,
        *CATEGORICAL_FEATURES,
        *TARGET_ONLY_COLUMNS,
    }
    missing = sorted(required - set(panel.columns))
    if missing:
        raise CareerDataError(f"Career landmark panel is missing columns: {missing}")
    if panel.duplicated(["bbref_id", "season"]).any():
        raise CareerDataError("Career landmark panel contains duplicate player-season keys")
    ordered = panel.sort_values(["bbref_id", "season"], kind="mergesort")
    for _, group in ordered.groupby("bbref_id", sort=False):
        if not group["season_number"].tolist() == list(range(1, len(group) + 1)):
            raise CareerDataError("Career landmark season_number is not sequential")
        expected_b = group["season_b_war"].cumsum().to_numpy(dtype=float)
        expected_p = group["season_p_war"].cumsum().to_numpy(dtype=float)
        if not np.allclose(
            expected_b, group["career_b_war_to_date"].to_numpy(dtype=float), atol=1e-9
        ) or not np.allclose(
            expected_p, group["career_p_war_to_date"].to_numpy(dtype=float), atol=1e-9
        ):
            raise CareerDataError("Career WAR contains future-season leakage")
        expected_value = np.select(
            [group["role"].eq("hitter"), group["role"].eq("pitcher")],
            [
                group["career_b_war_to_date"].to_numpy(dtype=float),
                group["career_p_war_to_date"].to_numpy(dtype=float),
            ],
            default=(
                group["career_b_war_to_date"].to_numpy(dtype=float)
                + group["career_p_war_to_date"].to_numpy(dtype=float)
            ),
        )
        if not np.allclose(
            expected_value, group["career_war_to_date"].to_numpy(dtype=float), atol=1e-9
        ):
            raise CareerDataError(
                "Career WAR contains future-season leakage or an inconsistent point-in-time role basis"
            )
    resolved = panel["resolved_career"].astype(bool)
    target_columns = [
        "final_career_war",
        "final_peak_seven_war",
        "final_jaws",
        "hof_caliber",
        "hof_caliber_completed_standard",
        "target_role",
        "target_position",
        "target_standard_key",
        "target_standard_jaws",
        "target_standard_fallback",
        "target_eligible",
    ]
    if panel.loc[resolved, target_columns].isna().any(axis=None):
        raise CareerDataError("Resolved careers require complete outcome targets")
    if panel.loc[~resolved, target_columns].notna().any(axis=None):
        raise CareerDataError("Unresolved careers cannot expose final outcome targets")
    label_counts = panel.loc[resolved].groupby("bbref_id")[
        "hof_caliber_completed_standard"
    ].nunique()
    if (label_counts > 1).any():
        raise CareerDataError("Resolved player has a time-varying completed-standard diagnostic")


def assert_feature_frame(frame: pd.DataFrame) -> None:
    expected = set(NUMERIC_FEATURES + CATEGORICAL_FEATURES)
    missing = sorted(expected - set(frame.columns))
    if missing:
        raise CareerDataError(f"Career feature frame is missing columns: {missing}")
    forbidden = sorted(set(frame.columns) & set(TARGET_ONLY_COLUMNS))
    if forbidden:
        raise CareerDataError(f"Target-only fields entered the feature frame: {forbidden}")


def _split_start_year(outcomes: pd.DataFrame, fraction: float) -> int:
    ordered = outcomes.sort_values(["career_end_year", "bbref_id"], kind="mergesort")
    target = max(1, min(len(ordered) - 1, int(math.ceil(len(ordered) * fraction))))
    candidate = int(ordered.iloc[target]["career_end_year"])
    unique_years = sorted(int(year) for year in ordered["career_end_year"].unique())
    later = [year for year in unique_years if year >= candidate]
    return later[0] if later else unique_years[-1]


def chronological_player_split(
    panel: pd.DataFrame,
    *,
    train_fraction: float = 0.65,
    calibration_fraction: float = 0.18,
    minimum_players_per_split: int = 20,
) -> CareerSplit:
    validate_landmark_panel(panel)
    if not 0.4 <= train_fraction <= 0.8:
        raise CareerDataError("train_fraction must be between 0.4 and 0.8")
    if not 0.1 <= calibration_fraction <= 0.3:
        raise CareerDataError("calibration_fraction must be between 0.1 and 0.3")
    outcomes = (
        panel.loc[panel["resolved_career"]]
        .sort_values(["bbref_id", "season"], kind="mergesort")
        .groupby("bbref_id", as_index=False)
        .agg(career_end_year=("career_end_year", "max"), hof_caliber=("hof_caliber", "last"))
    )
    minimum_total = minimum_players_per_split * 3
    if len(outcomes) < minimum_total:
        raise CareerDataError(
            f"Chronological tournament requires at least {minimum_total} resolved players"
        )
    calibration_start = _split_start_year(outcomes, train_fraction)
    test_start = _split_start_year(outcomes, train_fraction + calibration_fraction)
    if test_start <= calibration_start:
        later = sorted(
            int(year)
            for year in outcomes["career_end_year"].unique()
            if int(year) > calibration_start
        )
        if not later:
            raise CareerDataError("Career end years cannot support three chronological splits")
        test_start = later[max(0, len(later) // 2)]
    train = outcomes.loc[outcomes["career_end_year"] < calibration_start, "bbref_id"]
    calibration = outcomes.loc[
        outcomes["career_end_year"].between(calibration_start, test_start - 1), "bbref_id"
    ]
    test = outcomes.loc[outcomes["career_end_year"] >= test_start, "bbref_id"]
    if min(len(train), len(calibration), len(test)) < minimum_players_per_split:
        raise CareerDataError(
            "Chronological end-year cohorts are too small for the requested minimum split size"
        )
    split = CareerSplit(
        train_players=tuple(sorted(train.astype(str))),
        calibration_players=tuple(sorted(calibration.astype(str))),
        test_players=tuple(sorted(test.astype(str))),
        train_end_year=calibration_start - 1,
        calibration_start_year=calibration_start,
        calibration_end_year=test_start - 1,
        test_start_year=test_start,
    )
    assert_player_disjoint_split(split)
    return split


def assert_player_disjoint_split(split: CareerSplit) -> None:
    train = set(split.train_players)
    calibration = set(split.calibration_players)
    test = set(split.test_players)
    if train & calibration or train & test or calibration & test:
        raise CareerDataError("Tournament cohorts are not player-disjoint")
    if not split.train_end_year < split.calibration_start_year:
        raise CareerDataError("Training cohort is not chronologically before calibration")
    if not split.calibration_end_year < split.test_start_year:
        raise CareerDataError("Calibration cohort is not chronologically before test")


def player_equal_weights(panel: pd.DataFrame) -> np.ndarray:
    counts = panel.groupby("bbref_id")["bbref_id"].transform("size").astype(float)
    weights = 1.0 / counts.to_numpy()
    return weights / weights.mean()


def latest_landmarks(panel: pd.DataFrame) -> pd.DataFrame:
    return (
        panel.sort_values(["bbref_id", "season"], kind="mergesort")
        .groupby("bbref_id", as_index=False, sort=True)
        .tail(1)
        .reset_index(drop=True)
    )


def build_prospect_bridge(panel: pd.DataFrame) -> list[dict[str, Any]]:
    outcomes = latest_landmarks(panel.loc[panel["resolved_career"]].copy())
    outcomes = outcomes.loc[outcomes["target_eligible"].astype(bool)].copy()
    outcomes["debut_age"] = outcomes["age"] - outcomes["years_since_debut"]
    outcomes["bridge_role"] = outcomes["role"].replace({"two_way": "pitcher"})
    rows: list[dict[str, Any]] = []
    for role in ("hitter", "pitcher"):
        role_rows = outcomes.loc[outcomes["bridge_role"].eq(role)].copy()
        if role_rows.empty:
            continue
        role_rate = float(role_rows["hof_caliber"].astype(float).mean())
        role_war = role_rows["final_career_war"].to_numpy(dtype=float)
        for debut_age in range(16, 33):
            distance = np.abs(role_rows["debut_age"].to_numpy(dtype=float) - debut_age)
            local = role_rows.loc[distance <= 1.0]
            if len(local) < 20:
                nearest = np.argsort(distance, kind="stable")[: min(100, len(role_rows))]
                local = role_rows.iloc[nearest]
            events = float(local["hof_caliber"].astype(float).sum())
            shrunk = (events + 25.0 * role_rate) / (len(local) + 25.0)
            values = (
                local["final_career_war"].to_numpy(dtype=float)
                if not local.empty
                else role_war
            )
            peak_values = (
                local["final_peak_seven_war"].to_numpy(dtype=float)
                if not local.empty
                else role_rows["final_peak_seven_war"].to_numpy(dtype=float)
            )
            quantiles = np.quantile(values, [0.1, 0.25, 0.5, 0.75, 0.9])
            peak_quantiles = np.quantile(peak_values, [0.1, 0.25, 0.5, 0.75, 0.9])
            rows.append(
                {
                    "role": role,
                    "estimatedDebutAge": debut_age,
                    "conditionalHofCaliberProbability": round(float(shrunk), 8),
                    "finalCareerWar": {
                        key: round(float(value), 3)
                        for key, value in zip(
                            ("p10", "p25", "p50", "p75", "p90"),
                            quantiles,
                            strict=True,
                        )
                    },
                    "peakSevenWar": {
                        key: round(float(value), 3)
                        for key, value in zip(
                            ("p10", "p25", "p50", "p75", "p90"),
                            peak_quantiles,
                            strict=True,
                        )
                    },
                    "historicalPlayers": int(len(local)),
                    "publicationState": "research_bridge_baseline",
                }
            )
    return rows
