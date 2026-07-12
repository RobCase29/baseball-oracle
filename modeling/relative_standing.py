from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd


RELATIVE_STANDING_VERSION = "relative-standing-v1"
MINIMUM_COHORT_PLAYERS = 100
AGE_WINDOWS = (0, 1, 2, 3)


class RelativeStandingError(ValueError):
    pass


@dataclass(frozen=True)
class ExperienceBand:
    key: str
    minimum: int
    maximum: int
    label: str


EXPERIENCE_BANDS = (
    ExperienceBand("first", 1, 1, "first MLB season"),
    ExperienceBand("seasons_2_3", 2, 3, "MLB seasons 2-3"),
    ExperienceBand("seasons_4_6", 4, 6, "MLB seasons 4-6"),
    ExperienceBand("seasons_7_10", 7, 10, "MLB seasons 7-10"),
    ExperienceBand("season_11_plus", 11, 100, "MLB season 11+"),
)


def experience_band(season_number: object) -> ExperienceBand:
    numeric = pd.to_numeric(pd.Series([season_number]), errors="coerce").iloc[0]
    if pd.isna(numeric) or not math.isfinite(float(numeric)):
        raise RelativeStandingError("Historical pace requires a finite season number")
    value = int(numeric)
    if value < 1 or not math.isclose(float(numeric), value):
        raise RelativeStandingError(
            "Historical pace requires a positive integer season number"
        )
    for band in EXPERIENCE_BANDS:
        if band.minimum <= value <= band.maximum:
            return band
    return EXPERIENCE_BANDS[-1]


def _empty_signal(warnings: Sequence[str]) -> dict[str, Any]:
    return {
        "version": RELATIVE_STANDING_VERSION,
        "kind": "hall_track",
        "status": "withheld",
        "currentPeer": None,
        "historicalPace": None,
        "warnings": sorted(set(warnings)),
    }


def _reliability(cohort_size: int) -> str:
    if cohort_size >= 1_000:
        return "high"
    if cohort_size >= 300:
        return "moderate"
    return "low"


def _cohort_label(
    age_min: int, age_max: int, band: ExperienceBand, role: str
) -> str:
    age_label = f"Age {age_min}" if age_min == age_max else f"Ages {age_min}-{age_max}"
    role_label = (
        "hitters"
        if role == "hitter"
        else "pitchers"
        if role == "pitcher"
        else role
    )
    return f"{age_label}, {band.label}, {role_label}"


class HistoricalPaceReference:
    """Player-weighted completed-landmark pace against prior resolved careers."""

    required_columns = {
        "bbref_id",
        "season",
        "age",
        "season_number",
        "role",
        "career_war_to_date",
        "resolved_career",
    }

    def __init__(
        self,
        panel: pd.DataFrame,
        *,
        minimum_players: int = MINIMUM_COHORT_PLAYERS,
        age_windows: Sequence[int] = AGE_WINDOWS,
    ) -> None:
        missing = sorted(self.required_columns - set(panel.columns))
        if missing:
            raise RelativeStandingError(
                f"Historical pace panel is missing columns: {missing}"
            )
        if minimum_players < 2:
            raise RelativeStandingError(
                "Historical pace minimum support must be at least two players"
            )
        windows = tuple(int(value) for value in age_windows)
        if not windows or windows[0] != 0 or tuple(sorted(set(windows))) != windows:
            raise RelativeStandingError(
                "Historical pace age windows must be unique, ascending, and begin at zero"
            )
        if any(value < 0 for value in windows):
            raise RelativeStandingError("Historical pace age windows cannot be negative")

        reference = panel.loc[panel["resolved_career"].eq(True)].copy()
        for column in ("season", "age", "season_number", "career_war_to_date"):
            reference[column] = pd.to_numeric(reference[column], errors="coerce")
        reference = reference.loc[
            np.isfinite(reference["season"])
            & np.isfinite(reference["age"])
            & np.isfinite(reference["season_number"])
            & np.isfinite(reference["career_war_to_date"])
        ].copy()
        reference["bbref_id"] = reference["bbref_id"].astype(str)
        reference["role"] = reference["role"].astype(str)
        reference["age_floor"] = np.floor(reference["age"]).astype(int)
        reference["stage_band"] = reference["season_number"].map(
            lambda value: experience_band(value).key
        )
        self.minimum_players = int(minimum_players)
        self.age_windows = windows
        self.groups = {
            (str(role), str(stage_band)): group.reset_index(drop=True)
            for (role, stage_band), group in reference.groupby(
                ["role", "stage_band"], sort=True
            )
        }

    def relative_signal(
        self,
        feature: Mapping[str, Any] | pd.Series,
        *,
        partial_feature: bool = False,
    ) -> dict[str, Any]:
        base_warnings = [
            "descriptive_historical_pace_not_calibrated_probability",
            "resolved_career_reference_cohort",
            "reference_seasons_precede_feature_season",
        ]
        if partial_feature:
            return _empty_signal(
                [
                    *base_warnings,
                    "partial_season_feature_not_eligible_for_historical_pace",
                ]
            )
        try:
            band = experience_band(feature["season_number"])
            feature_season = int(feature["season"])
            feature_age = float(feature["age"])
            player_value = float(feature["career_war_to_date"])
            player_id = str(feature["bbref_id"])
            role = str(feature["role"])
        except (KeyError, TypeError, ValueError, RelativeStandingError):
            return _empty_signal(
                [*base_warnings, "historical_pace_feature_state_invalid"]
            )
        if not all(math.isfinite(value) for value in (feature_age, player_value)):
            return _empty_signal(
                [*base_warnings, "historical_pace_feature_state_invalid"]
            )
        if role not in {"hitter", "pitcher"}:
            return _empty_signal([*base_warnings, "historical_pace_role_not_supported"])

        age_floor = int(math.floor(feature_age))
        role_band = self.groups.get((role, band.key))
        if role_band is None:
            return _empty_signal(
                [*base_warnings, "historical_pace_insufficient_support"]
            )
        historical = role_band.loc[
            role_band["season"].lt(feature_season)
            & role_band["bbref_id"].ne(player_id)
        ]
        cohort: pd.DataFrame | None = None
        selected_window: int | None = None
        for window in self.age_windows:
            candidate = historical.loc[
                historical["age_floor"].between(age_floor - window, age_floor + window)
            ]
            if int(candidate["bbref_id"].nunique()) >= self.minimum_players:
                cohort = candidate
                selected_window = window
                break
        if cohort is None or selected_window is None:
            return _empty_signal(
                [*base_warnings, "historical_pace_insufficient_support"]
            )

        per_player_rows = cohort.groupby("bbref_id")["bbref_id"].transform("size")
        weights = 1.0 / per_player_rows.to_numpy(dtype=float)
        values = cohort["career_war_to_date"].to_numpy(dtype=float)
        tied_mask = np.isclose(values, player_value, rtol=0.0, atol=1e-12)
        lower = float(weights[(values < player_value) & ~tied_mask].sum())
        tied = float(weights[tied_mask].sum())
        percentile = 100.0 * (lower + 0.5 * tied) / float(weights.sum())
        cohort_size = int(cohort["bbref_id"].nunique())
        age_min = age_floor - selected_window
        age_max = age_floor + selected_window
        warnings = list(base_warnings)
        if selected_window > 0:
            warnings.append("historical_pace_age_window_expanded_for_support")
        return {
            "version": RELATIVE_STANDING_VERSION,
            "kind": "hall_track",
            "status": "research",
            "currentPeer": None,
            "historicalPace": {
                "percentile": round(float(np.clip(percentile, 0.0, 100.0)), 1),
                "cohortSize": cohort_size,
                "playerValue": round(player_value, 3),
                "metric": "career_war_to_date",
                "reliability": _reliability(cohort_size),
                "featureSeason": feature_season,
                "featureAge": round(feature_age, 2),
                "cohort": {
                    "scope": "historical_point_in_time",
                    "label": _cohort_label(age_min, age_max, band, role),
                    "role": role,
                    "stageBand": band.key,
                    "seasonNumberMin": band.minimum,
                    "seasonNumberMax": band.maximum,
                    "ageMin": age_min,
                    "ageMax": age_max,
                    "ageWindow": selected_window,
                    "resolvedOnly": True,
                },
            },
            "warnings": sorted(set(warnings)),
        }
