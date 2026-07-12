from __future__ import annotations

import math
import warnings
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import pandas as pd
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score

try:
    from modeling.contracts import EVALUATION_HORIZON_MONTHS
except ModuleNotFoundError:
    from contracts import EVALUATION_HORIZON_MONTHS


VALIDATION_SCHEMA_VERSION = "arrival-external-validation/v1"
DEFAULT_BOOTSTRAP_REPETITIONS = 2_000
DEFAULT_BOOTSTRAP_SEED = 29
FIXED_RELIABILITY_EDGES = (0.0, 0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0)
MIN_POOLED_ROWS = 2_500
MIN_UNIQUE_EVENT_PLAYERS = 100
MIN_UNIQUE_NON_EVENT_PLAYERS = 100
COLD_START_DESCRIPTIVE_EVENT_PLAYERS = 30
COLD_START_GATEABLE_EVENT_PLAYERS = 100
SUBGROUP_MIN_ROWS = 500
SUBGROUP_MIN_EVENT_PLAYERS = 50
SUBGROUP_MIN_NON_EVENT_PLAYERS = 50
SUBGROUP_SLOPE_MIN_EVENT_PLAYERS = 100
SUPPORTED_ROLES = ("hitter", "pitcher")
KEY_COLUMNS = ("snapshot_id", "horizon_months")

PROMOTION_GATE_CONFIG = {
    "paired_brier_improvement_95pct_lower_bound_greater_than": 0.0,
    "minimum_fraction_positive_pooled_role_horizon_cells": 0.75,
    "calibration_in_the_large_absolute_maximum": 0.02,
    "minimum_fraction_cells_with_absolute_calibration_in_the_large_at_most_0_03": 0.75,
    "calibration_slope_interval_inclusive": (0.8, 1.2),
    "minimum_fraction_cells_with_calibration_slope_in_interval": 0.75,
    "observed_to_expected_interval_inclusive": (0.8, 1.25),
    "minimum_fraction_cells_with_observed_to_expected_in_interval": 0.75,
    "expected_calibration_error_maximum": 0.02,
    "minimum_fraction_cells_with_expected_calibration_error_at_most_0_02": 0.75,
    "maximum_major_cohort_brier_regression": 0.01,
    "maximum_cumulative_horizon_violations": 0,
    "promotion_requires_every_gate": True,
}


class ArrivalValidationError(ValueError):
    pass


def _baseline_columns(
    value: Mapping[str, str] | Sequence[str],
) -> dict[str, str]:
    if isinstance(value, Mapping):
        columns = {str(name): str(column) for name, column in value.items()}
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        columns = {str(column): str(column) for column in value}
    else:
        raise ArrivalValidationError("Baseline probability columns must be a mapping or sequence")
    if not columns:
        raise ArrivalValidationError("At least one frozen baseline probability is required")
    if any(not name.strip() or not column.strip() for name, column in columns.items()):
        raise ArrivalValidationError("Baseline names and probability columns cannot be empty")
    if len(set(columns.values())) != len(columns):
        raise ArrivalValidationError("Baseline probability columns must be distinct")
    return dict(sorted(columns.items()))


def _primary_baseline_name(
    baselines: Mapping[str, str], requested: str | None
) -> str:
    if requested is not None:
        if requested not in baselines:
            raise ArrivalValidationError(f"Unknown primary baseline: {requested}")
        return requested
    for preferred in (
        "censoring_aware_hierarchical_empirical_bayes_annual_hazard",
        "empirical_bayes",
    ):
        if preferred in baselines:
            return preferred
    if len(baselines) == 1:
        return next(iter(baselines))
    raise ArrivalValidationError(
        "primary_baseline is required when the frozen primary comparator is not named explicitly"
    )


def _binary_series(series: pd.Series, label: str) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.isna().any() or not numeric.isin([0, 1]).all():
        raise ArrivalValidationError(f"{label} must contain only binary 0/1 values")
    return numeric.astype("int8")


def _probability_series(series: pd.Series, label: str) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce").astype(float)
    values = numeric.to_numpy()
    if not np.isfinite(values).all():
        raise ArrivalValidationError(f"{label} contains missing or nonfinite predictions")
    if ((values < 0.0) | (values > 1.0)).any():
        raise ArrivalValidationError(f"{label} contains predictions outside [0, 1]")
    return numeric


def _supported_horizons(value: Sequence[int]) -> tuple[int, ...]:
    try:
        horizons = tuple(int(item) for item in value)
    except (TypeError, ValueError) as error:
        raise ArrivalValidationError("Supported horizons must be positive integers") from error
    if not horizons or len(set(horizons)) != len(horizons) or any(item <= 0 for item in horizons):
        raise ArrivalValidationError("Supported horizons must be unique positive integers")
    return horizons


def validate_evaluation_rows(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    candidate_probability_column: str = "candidate_probability",
    outcome_column: str = "outcome",
    outcome_mask_column: str = "outcome_observed",
    outcome_mask_columns: Sequence[str] | None = None,
    player_identity_columns: Sequence[str] | None = None,
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
) -> pd.DataFrame:
    """Return a normalized evaluation table after strict, side-effect-free validation.

    Each input row represents exactly one snapshot/horizon key. Optional source-specific
    outcome-mask and player-ID columns are checked against the canonical columns. This is
    useful after joining independently frozen candidate, comparator, and outcome files.
    """

    if not isinstance(rows, pd.DataFrame) or rows.empty:
        raise ArrivalValidationError("Evaluation rows must be a nonempty DataFrame")
    if rows.columns.duplicated().any():
        raise ArrivalValidationError("Evaluation rows contain duplicate column names")

    baselines = _baseline_columns(baseline_probability_columns)
    semantic_columns = [
        candidate_probability_column,
        outcome_column,
        outcome_mask_column,
        *baselines.values(),
    ]
    if len(set(semantic_columns)) != len(semantic_columns):
        raise ArrivalValidationError(
            "Candidate, baseline, outcome, and outcome-mask columns must be distinct"
        )
    reserved = {*KEY_COLUMNS, "player_id", "role", "cold_start"}
    collisions = sorted(set(semantic_columns) & reserved)
    if collisions:
        raise ArrivalValidationError(f"Evaluation semantic columns collide with keys: {collisions}")
    required = {
        *KEY_COLUMNS,
        "player_id",
        "role",
        "cold_start",
        candidate_probability_column,
        outcome_column,
        outcome_mask_column,
        *baselines.values(),
    }
    missing = sorted(required - set(rows.columns))
    if missing:
        raise ArrivalValidationError(f"Evaluation rows are missing columns: {missing}")

    normalized = rows.copy(deep=True)
    for column in ("snapshot_id", "player_id"):
        if normalized[column].isna().any():
            raise ArrivalValidationError(f"{column} cannot contain missing values")
        normalized[column] = normalized[column].astype(str).str.strip()
        if normalized[column].eq("").any():
            raise ArrivalValidationError(f"{column} cannot contain empty values")

    raw_horizons = pd.to_numeric(normalized["horizon_months"], errors="coerce")
    if (
        raw_horizons.isna().any()
        or not np.isfinite(raw_horizons.to_numpy(dtype=float)).all()
        or not raw_horizons.eq(np.floor(raw_horizons)).all()
    ):
        raise ArrivalValidationError("horizon_months must contain finite integers")
    normalized["horizon_months"] = raw_horizons.astype(int)
    supported = _supported_horizons(supported_horizons)
    unsupported = sorted(set(normalized["horizon_months"]) - set(supported))
    if unsupported:
        raise ArrivalValidationError(f"Unsupported evaluation horizons: {unsupported}")

    if normalized.duplicated(list(KEY_COLUMNS), keep=False).any():
        raise ArrivalValidationError("Duplicate snapshot_id + horizon_months evaluation keys")

    normalized["role"] = normalized["role"].astype("string")
    if normalized["role"].isna().any() or not normalized["role"].isin(SUPPORTED_ROLES).all():
        raise ArrivalValidationError("Evaluation rows contain missing or unsupported roles")
    normalized["role"] = normalized["role"].astype(str)
    normalized["cold_start"] = _binary_series(normalized["cold_start"], "cold_start")

    snapshot_consistency = normalized.groupby("snapshot_id", sort=False).agg(
        player_ids=("player_id", "nunique"),
        roles=("role", "nunique"),
        cold_start_values=("cold_start", "nunique"),
    )
    if (snapshot_consistency > 1).any(axis=None):
        raise ArrivalValidationError(
            "A snapshot_id maps inconsistently to player_id, role, or cold_start"
        )

    identity_columns = list(player_identity_columns or ())
    automatically_detected = [
        column
        for column in normalized.columns
        if column != "player_id"
        and (
            column.endswith("__player_id")
            or column in {"candidate_player_id", "baseline_player_id"}
            or (column.startswith("baseline_") and column.endswith("_player_id"))
        )
    ]
    for column in sorted(set(identity_columns + automatically_detected)):
        if column not in normalized:
            raise ArrivalValidationError(f"Player identity column is missing: {column}")
        if normalized[column].isna().any():
            raise ArrivalValidationError(
                f"Player identity column contains missing values: {column}"
            )
        if not normalized[column].astype(str).str.strip().eq(normalized["player_id"]).all():
            raise ArrivalValidationError(f"Player identity mismatch in column: {column}")

    normalized[candidate_probability_column] = _probability_series(
        normalized[candidate_probability_column], candidate_probability_column
    )
    for column in baselines.values():
        normalized[column] = _probability_series(normalized[column], column)

    normalized[outcome_mask_column] = _binary_series(
        normalized[outcome_mask_column], outcome_mask_column
    )
    if outcome_mask_columns is None:
        extra_masks = [
            column
            for column in normalized.columns
            if column != outcome_mask_column and column.endswith("_outcome_observed")
        ]
    else:
        extra_masks = list(outcome_mask_columns)
    for column in sorted(set(extra_masks)):
        if column not in normalized:
            raise ArrivalValidationError(f"Outcome mask column is missing: {column}")
        source_mask = _binary_series(normalized[column], column)
        if not source_mask.eq(normalized[outcome_mask_column]).all():
            raise ArrivalValidationError(f"Outcome masks do not match: {column}")
        normalized[column] = source_mask

    outcome = pd.to_numeric(normalized[outcome_column], errors="coerce")
    observed = normalized[outcome_mask_column].eq(1)
    if outcome[observed].isna().any() or not outcome[observed].isin([0, 1]).all():
        raise ArrivalValidationError("Observed outcomes must contain only binary 0/1 values")
    if outcome[~observed].notna().any():
        raise ArrivalValidationError("Unobserved outcomes must be missing")
    normalized[outcome_column] = outcome.astype("Int8")

    return normalized.sort_values(
        ["horizon_months", "role", "snapshot_id"], kind="mergesort"
    ).reset_index(drop=True)


def _log_loss(y: np.ndarray, probability: np.ndarray, weights: np.ndarray | None = None) -> float:
    clipped = np.clip(probability, 1e-15, 1.0 - 1e-15)
    losses = -(y * np.log(clipped) + (1 - y) * np.log1p(-clipped))
    return float(np.average(losses, weights=weights))


def _brier(y: np.ndarray, probability: np.ndarray, weights: np.ndarray | None = None) -> float:
    return float(np.average(np.square(probability - y), weights=weights))


def _calibration_fit(y: np.ndarray, probability: np.ndarray) -> tuple[float | None, float | None]:
    if len(np.unique(y)) < 2 or len(np.unique(probability)) < 2:
        return None, None
    clipped = np.clip(probability, 1e-6, 1.0 - 1e-6)
    logits = np.log(clipped / (1.0 - clipped)).reshape(-1, 1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        try:
            calibration = LogisticRegression(
                C=1e12,
                solver="lbfgs",
                max_iter=2_000,
            ).fit(logits, y)
        except (ValueError, FloatingPointError):
            return None, None
    intercept = float(calibration.intercept_[0])
    slope = float(calibration.coef_[0, 0])
    if not math.isfinite(intercept) or not math.isfinite(slope):
        return None, None
    return intercept, slope


def _fixed_reliability(
    y: np.ndarray, probability: np.ndarray
) -> tuple[float, list[dict[str, Any]]]:
    edges = np.asarray(FIXED_RELIABILITY_EDGES, dtype=float)
    bin_ids = np.searchsorted(edges[1:-1], probability, side="left")
    bins: list[dict[str, Any]] = []
    weighted_gap = 0.0
    for index, (lower, upper) in enumerate(zip(edges[:-1], edges[1:], strict=True)):
        selected = bin_ids == index
        count = int(selected.sum())
        if count:
            observed = float(y[selected].mean())
            predicted = float(probability[selected].mean())
            absolute_gap = abs(observed - predicted)
            weighted_gap += count * absolute_gap
        else:
            observed = None
            predicted = None
            absolute_gap = None
        bins.append(
            {
                "lower": float(lower),
                "upper": float(upper),
                "lower_inclusive": index == 0,
                "upper_inclusive": True,
                "n": count,
                "observed_rate": observed,
                "mean_prediction": predicted,
                "absolute_gap": absolute_gap,
            }
        )
    return float(weighted_gap / len(y)), bins


def _probability_diagnostics(y: np.ndarray, probability: np.ndarray) -> dict[str, Any]:
    observed_rate = float(y.mean())
    mean_prediction = float(probability.mean())
    expected = float(probability.sum())
    calibration_intercept, calibration_slope = _calibration_fit(y, probability)
    ece, reliability = _fixed_reliability(y, probability)

    top_n = max(1, math.ceil(len(y) * 0.10))
    cutoff = float(np.sort(probability)[-top_n])
    top = probability >= cutoff
    top_rate = float(y[top].mean())
    return {
        "brier": _brier(y, probability),
        "log_loss": _log_loss(y, probability),
        "roc_auc": float(roc_auc_score(y, probability)) if len(np.unique(y)) == 2 else None,
        "average_precision": (
            float(average_precision_score(y, probability)) if len(np.unique(y)) == 2 else None
        ),
        "observed_rate": observed_rate,
        "mean_prediction": mean_prediction,
        "observed_to_expected_ratio": float(y.sum() / expected) if expected > 0 else None,
        "calibration_in_the_large": mean_prediction - observed_rate,
        "calibration_intercept": calibration_intercept,
        "calibration_slope": calibration_slope,
        "expected_calibration_error": ece,
        "reliability_edges": list(FIXED_RELIABILITY_EDGES),
        "reliability_bins": reliability,
        "top_decile_lift": float(top_rate / observed_rate) if observed_rate > 0 else None,
        "top_decile": {
            "n": int(top.sum()),
            "minimum_requested_n": top_n,
            "tie_inclusive": True,
            "probability_cutoff": cutoff,
            "observed_rate": top_rate,
        },
    }


def _count_summary(group: pd.DataFrame, outcome_column: str) -> dict[str, int]:
    event = group[outcome_column].astype(int).eq(1)
    return {
        "rows": int(len(group)),
        "players": int(group["player_id"].nunique()),
        "events": int(event.sum()),
        "non_events": int((~event).sum()),
        "unique_event_players": int(group.loc[event, "player_id"].nunique()),
        "unique_non_event_players": int(group.loc[~event, "player_id"].nunique()),
    }


def pooled_horizon_diagnostics(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    candidate_probability_column: str = "candidate_probability",
    outcome_column: str = "outcome",
    outcome_mask_column: str = "outcome_observed",
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
) -> list[dict[str, Any]]:
    """Compute diagnostics separately within each horizon; no cross-horizon metric exists."""

    baselines = _baseline_columns(baseline_probability_columns)
    validated = validate_evaluation_rows(
        rows,
        baselines,
        candidate_probability_column=candidate_probability_column,
        outcome_column=outcome_column,
        outcome_mask_column=outcome_mask_column,
        supported_horizons=supported_horizons,
    )
    observed = validated[validated[outcome_mask_column].eq(1)]
    if observed.empty:
        raise ArrivalValidationError("No observed outcomes are available for diagnostics")

    result: list[dict[str, Any]] = []
    for horizon, group in observed.groupby("horizon_months", sort=True):
        y = group[outcome_column].astype(int).to_numpy()
        role_counts = {
            str(role): _count_summary(role_group, outcome_column)
            for role, role_group in group.groupby("role", sort=True)
        }
        cold_start_counts = {
            "cold_start": _count_summary(group[group["cold_start"].eq(1)], outcome_column),
            "returning_player": _count_summary(
                group[group["cold_start"].eq(0)], outcome_column
            ),
        }
        result.append(
            {
                "horizon_months": int(horizon),
                **_count_summary(group, outcome_column),
                "role_counts": role_counts,
                "cold_start_counts": cold_start_counts,
                "candidate": _probability_diagnostics(
                    y, group[candidate_probability_column].to_numpy(dtype=float)
                ),
                "baselines": {
                    name: _probability_diagnostics(y, group[column].to_numpy(dtype=float))
                    for name, column in baselines.items()
                },
            }
        )
    return result


def pooled_role_horizon_sufficiency(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    candidate_probability_column: str = "candidate_probability",
    outcome_column: str = "outcome",
    outcome_mask_column: str = "outcome_observed",
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
) -> list[dict[str, Any]]:
    validated = validate_evaluation_rows(
        rows,
        baseline_probability_columns,
        candidate_probability_column=candidate_probability_column,
        outcome_column=outcome_column,
        outcome_mask_column=outcome_mask_column,
        supported_horizons=supported_horizons,
    )
    observed = validated[validated[outcome_mask_column].eq(1)]
    cells: list[dict[str, Any]] = []
    for (role, horizon), group in observed.groupby(["role", "horizon_months"], sort=True):
        cells.append(_role_horizon_sufficiency_record(role, horizon, group, outcome_column))
    return cells


def _role_horizon_sufficiency_record(
    role: Any,
    horizon: Any,
    group: pd.DataFrame,
    outcome_column: str,
) -> dict[str, Any]:
    counts = _count_summary(group, outcome_column)
    gateable = (
        counts["rows"] >= MIN_POOLED_ROWS
        and counts["unique_event_players"] >= MIN_UNIQUE_EVENT_PLAYERS
        and counts["unique_non_event_players"] >= MIN_UNIQUE_NON_EVENT_PLAYERS
    )
    cold = group[group["cold_start"].eq(1)]
    cold_counts = _count_summary(cold, outcome_column)
    cold_event_players = cold_counts["unique_event_players"]
    if cold_event_players < COLD_START_DESCRIPTIVE_EVENT_PLAYERS:
        cold_status = "suppress_inference"
    elif cold_event_players < COLD_START_GATEABLE_EVENT_PLAYERS:
        cold_status = "descriptive_only"
    else:
        cold_status = "gateable"
    return {
        "role": str(role),
        "horizon_months": int(horizon),
        **counts,
        "status": "gateable" if gateable else "insufficient",
        "gateable": gateable,
        "requirements": {
            "minimum_rows": MIN_POOLED_ROWS,
            "minimum_unique_event_players": MIN_UNIQUE_EVENT_PLAYERS,
            "minimum_unique_non_event_players": MIN_UNIQUE_NON_EVENT_PLAYERS,
        },
        "cold_start": {
            **cold_counts,
            "status": cold_status,
            "inferential_metrics_allowed": cold_status == "gateable" and gateable,
            "requirements": {
                "descriptive_minimum_unique_event_players": (
                    COLD_START_DESCRIPTIVE_EVENT_PLAYERS
                ),
                "gateable_minimum_unique_event_players": COLD_START_GATEABLE_EVENT_PLAYERS,
                "parent_role_horizon_cell_must_be_gateable": True,
            },
        },
    }


def _diagnostics_or_none(
    group: pd.DataFrame,
    probability_column: str,
    outcome_column: str,
) -> dict[str, Any] | None:
    if group.empty:
        return None
    return _probability_diagnostics(
        group[outcome_column].astype(int).to_numpy(),
        group[probability_column].to_numpy(dtype=float),
    )


def pooled_role_horizon_diagnostics(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    candidate_probability_column: str = "candidate_probability",
    outcome_column: str = "outcome",
    outcome_mask_column: str = "outcome_observed",
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
) -> list[dict[str, Any]]:
    """Describe candidate and comparators in role/horizon cells without pooling horizons."""

    baselines = _baseline_columns(baseline_probability_columns)
    validated = validate_evaluation_rows(
        rows,
        baselines,
        candidate_probability_column=candidate_probability_column,
        outcome_column=outcome_column,
        outcome_mask_column=outcome_mask_column,
        supported_horizons=supported_horizons,
    )
    observed = validated[validated[outcome_mask_column].eq(1)]
    if observed.empty:
        raise ArrivalValidationError("No observed outcomes are available for diagnostics")
    result: list[dict[str, Any]] = []
    for (role, horizon), group in observed.groupby(["role", "horizon_months"], sort=True):
        y = group[outcome_column].astype(int).to_numpy()
        candidate = group[candidate_probability_column].to_numpy(dtype=float)
        sufficiency = _role_horizon_sufficiency_record(
            role, horizon, group, outcome_column
        )
        cold = group[group["cold_start"].eq(1)]
        cold_start = dict(sufficiency["cold_start"])
        cold_start["candidate"] = _diagnostics_or_none(
            cold, candidate_probability_column, outcome_column
        )
        cold_start["baselines"] = {
            name: _diagnostics_or_none(cold, column, outcome_column)
            for name, column in baselines.items()
        }
        cold_start["point_comparisons"] = {
            name: (
                _point_comparison(
                    cold[outcome_column].astype(int).to_numpy(),
                    cold[candidate_probability_column].to_numpy(dtype=float),
                    cold[column].to_numpy(dtype=float),
                )
                if not cold.empty
                else None
            )
            for name, column in baselines.items()
        }
        result.append(
            {
                **{key: value for key, value in sufficiency.items() if key != "cold_start"},
                "candidate": _probability_diagnostics(y, candidate),
                "baselines": {
                    name: _probability_diagnostics(
                        y, group[column].to_numpy(dtype=float)
                    )
                    for name, column in baselines.items()
                },
                "point_comparisons": {
                    name: _point_comparison(
                        y, candidate, group[column].to_numpy(dtype=float)
                    )
                    for name, column in baselines.items()
                },
                "cold_start": cold_start,
            }
        )
    return result


def _canonical_prior_level(values: pd.Series) -> pd.Series:
    normalized = values.astype("string").fillna("missing").str.strip()
    return normalized.mask(normalized.eq(""), "missing").astype(str)


def _subgroup_probability_diagnostics(
    y: np.ndarray,
    probability: np.ndarray,
    *,
    slope_allowed: bool,
) -> dict[str, Any]:
    diagnostics = _probability_diagnostics(y, probability)
    diagnostics["calibration_slope_inference"] = {
        "allowed": slope_allowed,
        "minimum_unique_event_players": SUBGROUP_SLOPE_MIN_EVENT_PLAYERS,
    }
    if not slope_allowed:
        diagnostics["calibration_slope"] = None
    return diagnostics


def prior_level_subgroup_diagnostics(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    candidate_probability_column: str = "candidate_probability",
    outcome_column: str = "outcome",
    outcome_mask_column: str = "outcome_observed",
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
) -> list[dict[str, Any]]:
    """Inventory every observed role/horizon/prior-level group, sufficient or not."""

    baselines = _baseline_columns(baseline_probability_columns)
    validated = validate_evaluation_rows(
        rows,
        baselines,
        candidate_probability_column=candidate_probability_column,
        outcome_column=outcome_column,
        outcome_mask_column=outcome_mask_column,
        supported_horizons=supported_horizons,
    )
    if "prior_level" not in validated:
        raise ArrivalValidationError(
            "prior_level is required for the predeclared subgroup inventory"
        )
    validated["prior_level"] = _canonical_prior_level(validated["prior_level"])
    observed = validated[validated[outcome_mask_column].eq(1)]
    if observed.empty:
        raise ArrivalValidationError("No observed outcomes are available for subgroups")
    result: list[dict[str, Any]] = []
    for (role, horizon, level), group in observed.groupby(
        ["role", "horizon_months", "prior_level"], sort=True, observed=True
    ):
        counts = _count_summary(group, outcome_column)
        sufficient = (
            counts["rows"] >= SUBGROUP_MIN_ROWS
            and counts["unique_event_players"] >= SUBGROUP_MIN_EVENT_PLAYERS
            and counts["unique_non_event_players"] >= SUBGROUP_MIN_NON_EVENT_PLAYERS
        )
        slope_allowed = (
            sufficient
            and counts["unique_event_players"] >= SUBGROUP_SLOPE_MIN_EVENT_PLAYERS
        )
        y = group[outcome_column].astype(int).to_numpy()
        candidate = group[candidate_probability_column].to_numpy(dtype=float)
        result.append(
            {
                "role": str(role),
                "horizon_months": int(horizon),
                "prior_level": str(level),
                **counts,
                "status": "sufficient" if sufficient else "insufficient",
                "sufficient": sufficient,
                "requirements": {
                    "minimum_rows": SUBGROUP_MIN_ROWS,
                    "minimum_unique_event_players": SUBGROUP_MIN_EVENT_PLAYERS,
                    "minimum_unique_non_event_players": SUBGROUP_MIN_NON_EVENT_PLAYERS,
                    "calibration_slope_minimum_unique_event_players": (
                        SUBGROUP_SLOPE_MIN_EVENT_PLAYERS
                    ),
                },
                "candidate": _subgroup_probability_diagnostics(
                    y, candidate, slope_allowed=slope_allowed
                ),
                "baselines": {
                    name: _subgroup_probability_diagnostics(
                        y,
                        group[column].to_numpy(dtype=float),
                        slope_allowed=slope_allowed,
                    )
                    for name, column in baselines.items()
                },
                "point_comparisons": {
                    name: _point_comparison(
                        y, candidate, group[column].to_numpy(dtype=float)
                    )
                    for name, column in baselines.items()
                },
            }
        )
    return result


def _prior_level_subgroup_adjudication(
    diagnostics: list[dict[str, Any]],
    baselines: Mapping[str, str],
    primary_baseline: str,
) -> dict[str, Any]:
    gates: list[dict[str, Any]] = []
    failed_reasons: list[str] = []
    sufficient = [cell for cell in diagnostics if cell["sufficient"]]
    insufficient = [
        {
            "role": cell["role"],
            "horizon_months": cell["horizon_months"],
            "prior_level": cell["prior_level"],
            "rows": cell["rows"],
            "unique_event_players": cell["unique_event_players"],
            "unique_non_event_players": cell["unique_non_event_players"],
        }
        for cell in diagnostics
        if not cell["sufficient"]
    ]
    identities = [
        (cell["role"], cell["horizon_months"], cell["prior_level"])
        for cell in diagnostics
    ]
    inventory_complete = len(identities) == len(set(identities))
    _append_gate(
        gates,
        failed_reasons,
        "prior_level_subgroups.complete_inventory",
        inventory_complete,
        "the predeclared prior-level subgroup inventory was incomplete or duplicated",
        {
            "groups_reported": len(diagnostics),
            "sufficient_groups": len(sufficient),
            "insufficient_groups": len(insufficient),
        },
    )
    comparisons: dict[str, Any] = {}
    for baseline_name in baselines:
        per_role: dict[str, Any] = {}
        for role in SUPPORTED_ROLES:
            cells = [cell for cell in sufficient if cell["role"] == role]
            if not cells:
                continue
            values = [
                cell["point_comparisons"][baseline_name][
                    "absolute_brier_improvement"
                ]
                for cell in cells
            ]
            per_role[role] = {
                "sufficient_groups": len(cells),
                "estimate": float(np.mean(values)),
                "equal_weight_per_role_horizon_prior_level_group": True,
            }
        comparisons[baseline_name] = {"per_role": per_role}
    primary_roles = comparisons[primary_baseline]["per_role"]
    for role, macro in primary_roles.items():
        _append_gate(
            gates,
            failed_reasons,
            f"prior_level_subgroups.{role}.macro_brier_not_worse",
            macro["estimate"] >= 0.0,
            "the sufficient prior-level subgroup macro Brier score was worse than primary",
            {**macro, "minimum": 0.0},
        )
    return {
        "status": "pass" if not failed_reasons else "fail",
        "passed": not failed_reasons,
        "primary_baseline": primary_baseline,
        "all_observed_groups_reported": inventory_complete,
        "sufficient_groups": [
            {
                "role": cell["role"],
                "horizon_months": cell["horizon_months"],
                "prior_level": cell["prior_level"],
            }
            for cell in sufficient
        ],
        "insufficient_groups": insufficient,
        "insufficient_groups_excluded_from_performance_gates": True,
        "diagnostics": diagnostics,
        "brier_comparisons": comparisons,
        "gates": gates,
        "failed_reasons": failed_reasons,
    }


def _clean_zero(value: float) -> float:
    return 0.0 if value == 0.0 else float(value)


def _comparison_values(
    y: np.ndarray,
    candidate: np.ndarray,
    baseline: np.ndarray,
    weights: np.ndarray | None = None,
) -> tuple[float, float | None, float]:
    candidate_brier = _brier(y, candidate, weights)
    baseline_brier = _brier(y, baseline, weights)
    absolute = _clean_zero(baseline_brier - candidate_brier)
    if baseline_brier > 0:
        relative = _clean_zero(absolute / baseline_brier)
    elif absolute == 0:
        relative = 0.0
    else:
        relative = None
    log_improvement = _clean_zero(
        _log_loss(y, baseline, weights) - _log_loss(y, candidate, weights)
    )
    return absolute, relative, log_improvement


def _point_comparison(
    y: np.ndarray, candidate: np.ndarray, baseline: np.ndarray
) -> dict[str, float | None]:
    absolute, relative, log_improvement = _comparison_values(y, candidate, baseline)
    return {
        "absolute_brier_improvement": absolute,
        "relative_brier_skill": relative,
        "log_loss_improvement": log_improvement,
    }


def _interval(values: list[float], repetitions: int) -> dict[str, Any]:
    if len(values) != repetitions:
        return {"lower": None, "upper": None, "values_available": len(values)}
    lower, upper = np.quantile(np.asarray(values, dtype=float), [0.025, 0.975])
    return {
        "lower": _clean_zero(float(lower)),
        "upper": _clean_zero(float(upper)),
        "values_available": len(values),
    }


def paired_player_cluster_bootstrap(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    candidate_probability_column: str = "candidate_probability",
    outcome_column: str = "outcome",
    outcome_mask_column: str = "outcome_observed",
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
    group_columns: Sequence[str] = ("role", "horizon_months"),
    repetitions: int = DEFAULT_BOOTSTRAP_REPETITIONS,
    seed: int = DEFAULT_BOOTSTRAP_SEED,
) -> dict[str, Any]:
    """Run one global player-cluster draw per replicate and reuse it everywhere.

    A player's multiplicity applies to every observed row for that player, including
    repeated snapshots and horizons. Metrics remain cell-specific, and grouping without
    ``horizon_months`` is rejected to make accidental cross-horizon pooling impossible.
    """

    if isinstance(repetitions, bool) or not isinstance(repetitions, int) or repetitions <= 0:
        raise ArrivalValidationError("Bootstrap repetitions must be a positive integer")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ArrivalValidationError("Bootstrap seed must be a nonnegative integer")
    groups = tuple(group_columns)
    if not groups or "horizon_months" not in groups:
        raise ArrivalValidationError("Bootstrap cells must include horizon_months")
    if len(set(groups)) != len(groups):
        raise ArrivalValidationError("Bootstrap group columns must be unique")

    baselines = _baseline_columns(baseline_probability_columns)
    validated = validate_evaluation_rows(
        rows,
        baselines,
        candidate_probability_column=candidate_probability_column,
        outcome_column=outcome_column,
        outcome_mask_column=outcome_mask_column,
        supported_horizons=supported_horizons,
    )
    missing_groups = sorted(set(groups) - set(validated.columns))
    if missing_groups:
        raise ArrivalValidationError(f"Bootstrap group columns are missing: {missing_groups}")
    observed = validated[validated[outcome_mask_column].eq(1)].reset_index(drop=True)
    if observed.empty:
        raise ArrivalValidationError("No observed outcomes are available for bootstrap")

    players = np.asarray(sorted(observed["player_id"].unique()), dtype=object)
    player_indexes = {player: index for index, player in enumerate(players)}
    row_player_indexes = observed["player_id"].map(player_indexes).to_numpy(dtype=int)
    rng = np.random.default_rng(seed)
    multiplicities = rng.multinomial(
        len(players), np.full(len(players), 1.0 / len(players)), size=repetitions
    )

    cell_specs: list[tuple[dict[str, Any], np.ndarray]] = []
    grouper: str | list[str] = groups[0] if len(groups) == 1 else list(groups)
    for key, group in observed.groupby(grouper, sort=True):
        values = (key,) if len(groups) == 1 else tuple(key)
        identity = {
            column: int(value) if column == "horizon_months" else str(value)
            for column, value in zip(groups, values, strict=True)
        }
        cell_specs.append((identity, group.index.to_numpy(dtype=int)))

    cells: list[dict[str, Any]] = []
    for identity, indexes in cell_specs:
        y = observed.loc[indexes, outcome_column].astype(int).to_numpy()
        candidate = observed.loc[indexes, candidate_probability_column].to_numpy(dtype=float)
        cell_player_indexes = row_player_indexes[indexes]
        comparisons: dict[str, Any] = {}
        for name, column in baselines.items():
            baseline = observed.loc[indexes, column].to_numpy(dtype=float)
            point = _comparison_values(y, candidate, baseline)
            if np.array_equal(candidate, baseline):
                draws = ([0.0] * repetitions, [0.0] * repetitions, [0.0] * repetitions)
            else:
                draws = ([], [], [])
                for replicate in range(repetitions):
                    weights = multiplicities[replicate, cell_player_indexes].astype(float)
                    if weights.sum() == 0:
                        continue
                    values = _comparison_values(y, candidate, baseline, weights)
                    for target, value in zip(draws, values, strict=True):
                        if value is not None:
                            target.append(value)
            comparisons[name] = {
                "absolute_brier_improvement": {
                    "estimate": point[0],
                    "ci_95": _interval(draws[0], repetitions),
                },
                "relative_brier_skill": {
                    "estimate": point[1],
                    "ci_95": _interval(draws[1], repetitions),
                },
                "log_loss_improvement": {
                    "estimate": point[2],
                    "ci_95": _interval(draws[2], repetitions),
                },
            }
        cells.append(
            {
                **identity,
                "rows": int(len(indexes)),
                "players": int(observed.loc[indexes, "player_id"].nunique()),
                "comparisons": comparisons,
            }
        )

    return {
        "method": "paired_nonparametric_player_cluster_bootstrap",
        "repetitions": repetitions,
        "seed": seed,
        "confidence_level": 0.95,
        "interval": "two_sided_percentile",
        "resampling_unit": "player_id",
        "player_clusters": int(len(players)),
        "same_draw_for_candidate_and_all_baselines": True,
        "all_rows_for_resampled_player_move_together": True,
        "group_columns": list(groups),
        "cross_horizon_pooling": False,
        "cells": cells,
    }


def _macro_brier_comparisons(
    observed: pd.DataFrame,
    cell_specs: list[dict[str, Any]],
    baselines: Mapping[str, str],
    candidate_probability_column: str,
    repetitions: int,
    multiplicities: np.ndarray,
    row_player_indexes: np.ndarray,
) -> dict[str, Any]:
    by_baseline: dict[str, Any] = {}
    for baseline_name, baseline_column in baselines.items():
        cell_draws = np.full((len(cell_specs), repetitions), np.nan, dtype=float)
        cell_results: list[dict[str, Any]] = []
        for cell_position, spec in enumerate(cell_specs):
            indexes = spec["indexes"]
            y = observed.loc[indexes, "outcome"].astype(int).to_numpy()
            candidate = observed.loc[indexes, candidate_probability_column].to_numpy(dtype=float)
            baseline = observed.loc[indexes, baseline_column].to_numpy(dtype=float)
            point = _comparison_values(y, candidate, baseline)[0]
            if np.array_equal(candidate, baseline):
                cell_draws[cell_position, :] = 0.0
            else:
                player_indexes = row_player_indexes[indexes]
                loss_improvement = np.square(baseline - y) - np.square(candidate - y)
                for replicate in range(repetitions):
                    weights = multiplicities[replicate, player_indexes].astype(float)
                    if weights.sum() > 0:
                        cell_draws[cell_position, replicate] = float(
                            np.average(loss_improvement, weights=weights)
                        )
            cell_results.append(
                {
                    "role": spec["role"],
                    "horizon_months": spec["horizon_months"],
                    "estimate": point,
                    "ci_95": _interval(
                        cell_draws[cell_position, np.isfinite(cell_draws[cell_position])].tolist(),
                        repetitions,
                    ),
                }
            )

        point_values = [cell["estimate"] for cell in cell_results]
        if cell_specs:
            complete_macro_draws = cell_draws[:, np.isfinite(cell_draws).all(axis=0)]
            macro_draws = (
                complete_macro_draws.mean(axis=0).tolist()
                if complete_macro_draws.shape[1]
                else []
            )
        else:
            macro_draws = []
        per_role: dict[str, Any] = {}
        for role in SUPPORTED_ROLES:
            positions = [
                index for index, spec in enumerate(cell_specs) if spec["role"] == role
            ]
            if not positions:
                continue
            role_draws_matrix = cell_draws[positions]
            complete = role_draws_matrix[:, np.isfinite(role_draws_matrix).all(axis=0)]
            role_draws = complete.mean(axis=0).tolist() if complete.shape[1] else []
            per_role[role] = {
                "cells": len(positions),
                "estimate": float(np.mean([point_values[index] for index in positions])),
                "ci_95": _interval(role_draws, repetitions),
            }
        by_baseline[baseline_name] = {
            "metric": "baseline_brier_minus_candidate_brier",
            "equal_weight_per_role_horizon_cell": True,
            "macro": {
                "cells": len(cell_specs),
                "estimate": float(np.mean(point_values)) if point_values else None,
                "ci_95": _interval(macro_draws, repetitions),
            },
            "per_role": per_role,
            "cells": cell_results,
        }
    return by_baseline


def _append_gate(
    gates: list[dict[str, Any]],
    failed_reasons: list[str],
    gate_id: str,
    passed: bool,
    reason: str,
    evidence: Mapping[str, Any],
) -> None:
    gates.append(
        {
            "gate": gate_id,
            "passed": bool(passed),
            "evidence": dict(evidence),
        }
    )
    if not passed:
        failed_reasons.append(f"{gate_id}: {reason}")


def _calibration_adjudication(
    diagnostic_cells: list[dict[str, Any]],
    *,
    scope_name: str,
    candidate_key: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    gates: list[dict[str, Any]] = []
    failed_reasons: list[str] = []
    metric_specs = [
        {
            "name": "calibration_in_the_large",
            "macro_reduce": lambda values: float(np.mean(np.abs(values))),
            "macro_aggregation": "equal_cell_mean_absolute_value",
            "macro_test": lambda value: value
            <= PROMOTION_GATE_CONFIG["calibration_in_the_large_absolute_maximum"],
            "cell_test": lambda value: abs(value) <= 0.03,
            "macro_requirement": {
                "absolute_maximum": PROMOTION_GATE_CONFIG[
                    "calibration_in_the_large_absolute_maximum"
                ]
            },
            "cell_fraction_requirement": PROMOTION_GATE_CONFIG[
                "minimum_fraction_cells_with_absolute_calibration_in_the_large_at_most_0_03"
            ],
            "cell_requirement": {"absolute_maximum": 0.03},
        },
        {
            "name": "calibration_slope",
            "macro_reduce": lambda values: float(np.mean(values)),
            "macro_aggregation": "equal_cell_mean",
            "macro_test": lambda value: PROMOTION_GATE_CONFIG[
                "calibration_slope_interval_inclusive"
            ][0]
            <= value
            <= PROMOTION_GATE_CONFIG["calibration_slope_interval_inclusive"][1],
            "cell_test": lambda value: PROMOTION_GATE_CONFIG[
                "calibration_slope_interval_inclusive"
            ][0]
            <= value
            <= PROMOTION_GATE_CONFIG["calibration_slope_interval_inclusive"][1],
            "macro_requirement": {
                "interval_inclusive": list(
                    PROMOTION_GATE_CONFIG["calibration_slope_interval_inclusive"]
                )
            },
            "cell_fraction_requirement": PROMOTION_GATE_CONFIG[
                "minimum_fraction_cells_with_calibration_slope_in_interval"
            ],
            "cell_requirement": {
                "interval_inclusive": list(
                    PROMOTION_GATE_CONFIG["calibration_slope_interval_inclusive"]
                )
            },
        },
        {
            "name": "observed_to_expected_ratio",
            "macro_reduce": lambda values: float(np.mean(values)),
            "macro_aggregation": "equal_cell_mean",
            "macro_test": lambda value: PROMOTION_GATE_CONFIG[
                "observed_to_expected_interval_inclusive"
            ][0]
            <= value
            <= PROMOTION_GATE_CONFIG["observed_to_expected_interval_inclusive"][1],
            "cell_test": lambda value: PROMOTION_GATE_CONFIG[
                "observed_to_expected_interval_inclusive"
            ][0]
            <= value
            <= PROMOTION_GATE_CONFIG["observed_to_expected_interval_inclusive"][1],
            "macro_requirement": {
                "interval_inclusive": list(
                    PROMOTION_GATE_CONFIG["observed_to_expected_interval_inclusive"]
                )
            },
            "cell_fraction_requirement": PROMOTION_GATE_CONFIG[
                "minimum_fraction_cells_with_observed_to_expected_in_interval"
            ],
            "cell_requirement": {
                "interval_inclusive": list(
                    PROMOTION_GATE_CONFIG["observed_to_expected_interval_inclusive"]
                )
            },
        },
        {
            "name": "expected_calibration_error",
            "macro_reduce": lambda values: float(np.mean(values)),
            "macro_aggregation": "equal_cell_mean",
            "macro_test": lambda value: value
            <= PROMOTION_GATE_CONFIG["expected_calibration_error_maximum"],
            "cell_test": lambda value: value <= 0.02,
            "macro_requirement": {
                "maximum": PROMOTION_GATE_CONFIG["expected_calibration_error_maximum"]
            },
            "cell_fraction_requirement": PROMOTION_GATE_CONFIG[
                "minimum_fraction_cells_with_expected_calibration_error_at_most_0_02"
            ],
            "cell_requirement": {"maximum": 0.02},
        },
    ]
    results: dict[str, Any] = {}
    for spec in metric_specs:
        values: list[float | None] = []
        for cell in diagnostic_cells:
            diagnostics = cell[candidate_key]
            raw_value = diagnostics.get(spec["name"]) if diagnostics is not None else None
            values.append(
                float(raw_value)
                if raw_value is not None and math.isfinite(float(raw_value))
                else None
            )
        available = [value for value in values if value is not None]
        macro = spec["macro_reduce"](available) if available else None
        all_available = len(available) == len(values) and bool(values)
        macro_passed = all_available and bool(spec["macro_test"](macro))
        cells_passing = sum(
            1 for value in values if value is not None and spec["cell_test"](value)
        )
        fraction = float(cells_passing / len(values)) if values else None
        fraction_passed = (
            fraction is not None and fraction >= spec["cell_fraction_requirement"]
        )
        results[spec["name"]] = {
            "cells": len(values),
            "values_available": len(available),
            "macro_equal_cell_weight": macro,
            "macro_aggregation": spec["macro_aggregation"],
            "macro_requirement": spec["macro_requirement"],
            "cells_passing": cells_passing,
            "fraction_passing": fraction,
            "cell_requirement": spec["cell_requirement"],
            "minimum_fraction_passing": spec["cell_fraction_requirement"],
        }
        _append_gate(
            gates,
            failed_reasons,
            f"{scope_name}.calibration.{spec['name']}.macro",
            macro_passed,
            "equal-cell macro calibration requirement was not met",
            results[spec["name"]],
        )
        _append_gate(
            gates,
            failed_reasons,
            f"{scope_name}.calibration.{spec['name']}.cell_fraction",
            fraction_passed,
            "the required fraction of sufficient cells was not calibrated",
            results[spec["name"]],
        )
    return results, gates, failed_reasons


def _scope_adjudication(
    observed: pd.DataFrame,
    diagnostic_cells: list[dict[str, Any]],
    cell_specs: list[dict[str, Any]],
    baselines: Mapping[str, str],
    primary_baseline: str,
    candidate_probability_column: str,
    repetitions: int,
    multiplicities: np.ndarray,
    row_player_indexes: np.ndarray,
    *,
    scope_name: str,
    candidate_key: str,
    insufficient_cells: list[dict[str, Any]],
) -> dict[str, Any]:
    gates: list[dict[str, Any]] = []
    failed_reasons: list[str] = []
    comparisons = _macro_brier_comparisons(
        observed,
        cell_specs,
        baselines,
        candidate_probability_column,
        repetitions,
        multiplicities,
        row_player_indexes,
    )
    sufficient = bool(cell_specs)
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.sufficient_cells_available",
        sufficient,
        "no sufficient role-horizon cells were available",
        {"sufficient_cells": len(cell_specs)},
    )
    roles = sorted({spec["role"] for spec in cell_specs})
    role_coverage = roles == list(SUPPORTED_ROLES)
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.supported_role_coverage",
        role_coverage,
        "both hitter and pitcher require at least one sufficient cell",
        {"roles_with_sufficient_cells": roles, "required_roles": list(SUPPORTED_ROLES)},
    )

    primary = comparisons.get(primary_baseline)
    if primary is None:
        raise ArrivalValidationError("Primary baseline comparison is missing")
    macro = primary["macro"]
    lower = macro["ci_95"]["lower"]
    lower_threshold = PROMOTION_GATE_CONFIG[
        "paired_brier_improvement_95pct_lower_bound_greater_than"
    ]
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.macro_brier_improvement_lower_bound",
        lower is not None and lower > lower_threshold,
        "paired equal-cell macro Brier-improvement lower bound did not exceed zero",
        {"estimate": macro["estimate"], "ci_95": macro["ci_95"], "greater_than": lower_threshold},
    )
    primary_cells = primary["cells"]
    positive = sum(cell["estimate"] > 0 for cell in primary_cells)
    positive_fraction = float(positive / len(primary_cells)) if primary_cells else None
    minimum_fraction = PROMOTION_GATE_CONFIG[
        "minimum_fraction_positive_pooled_role_horizon_cells"
    ]
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.positive_brier_cell_fraction",
        positive_fraction is not None and positive_fraction >= minimum_fraction,
        "too few sufficient role-horizon cells had positive Brier improvement",
        {
            "positive_cells": positive,
            "cells": len(primary_cells),
            "fraction": positive_fraction,
            "minimum_fraction": minimum_fraction,
        },
    )

    maximum_regression = PROMOTION_GATE_CONFIG["maximum_major_cohort_brier_regression"]
    role_regressions: dict[str, Any] = {}
    roles_pass = True
    for role in SUPPORTED_ROLES:
        role_macro = primary["per_role"].get(role)
        regression = (
            max(0.0, -float(role_macro["estimate"])) if role_macro is not None else None
        )
        passed = regression is not None and regression <= maximum_regression
        roles_pass = roles_pass and passed
        role_regressions[role] = {
            "brier_regression": regression,
            "maximum": maximum_regression,
            "passed": passed,
            "macro": role_macro,
        }
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.maximum_major_cohort_brier_regression",
        roles_pass,
        "a role macro exceeded the maximum allowed Brier regression",
        role_regressions,
    )

    calibration, calibration_gates, calibration_failures = _calibration_adjudication(
        diagnostic_cells,
        scope_name=scope_name,
        candidate_key=candidate_key,
    )
    gates.extend(calibration_gates)
    failed_reasons.extend(calibration_failures)
    return {
        "status": "pass" if not failed_reasons else "fail",
        "passed": not failed_reasons,
        "primary_baseline": primary_baseline,
        "sufficient_cells": [
            {"role": spec["role"], "horizon_months": spec["horizon_months"]}
            for spec in cell_specs
        ],
        "insufficient_cells": insufficient_cells,
        "insufficient_cells_excluded_from_all_gates": True,
        "brier_comparisons": comparisons,
        "calibration": calibration,
        "gates": gates,
        "failed_reasons": failed_reasons,
    }


def _descriptive_calibration_macros(
    diagnostic_cells: list[dict[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for metric in (
        "calibration_in_the_large",
        "calibration_slope",
        "observed_to_expected_ratio",
        "expected_calibration_error",
    ):
        values = [
            cell["candidate"].get(metric)
            for cell in diagnostic_cells
            if cell.get("candidate") is not None
        ]
        available = [
            float(value)
            for value in values
            if value is not None and math.isfinite(float(value))
        ]
        result[metric] = {
            "cells": len(diagnostic_cells),
            "values_available": len(available),
            "macro_equal_cell_weight": (
                float(np.mean(available)) if available else None
            ),
            "gate_applied": metric == "calibration_in_the_large",
        }
    return result


def _cold_start_adjudication(
    observed: pd.DataFrame,
    diagnostic_cells: list[dict[str, Any]],
    cell_specs: list[dict[str, Any]],
    baselines: Mapping[str, str],
    primary_baseline: str,
    candidate_probability_column: str,
    repetitions: int,
    multiplicities: np.ndarray,
    row_player_indexes: np.ndarray,
    insufficient_cells: list[dict[str, Any]],
) -> dict[str, Any]:
    scope_name = "cold_start_role_horizon"
    gates: list[dict[str, Any]] = []
    failed_reasons: list[str] = []
    comparisons = _macro_brier_comparisons(
        observed,
        cell_specs,
        baselines,
        candidate_probability_column,
        repetitions,
        multiplicities,
        row_player_indexes,
    )
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.sufficient_cells_available",
        bool(cell_specs),
        "no cold-start role-horizon cell met the frozen support requirement",
        {"sufficient_cells": len(cell_specs)},
    )
    primary_macro = comparisons[primary_baseline]["macro"]
    brier_estimate = primary_macro["estimate"]
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.macro_brier_improvement",
        brier_estimate is not None and brier_estimate > 0.0,
        "equal-cell cold-start macro Brier improvement was not positive",
        {"estimate": brier_estimate, "greater_than": 0.0},
    )
    calibration = _descriptive_calibration_macros(diagnostic_cells)
    citl = calibration["calibration_in_the_large"]["macro_equal_cell_weight"]
    citl_limit = 0.03
    _append_gate(
        gates,
        failed_reasons,
        f"{scope_name}.absolute_macro_calibration_in_the_large",
        citl is not None and abs(citl) <= citl_limit,
        "absolute cold-start macro calibration-in-the-large exceeded 0.03",
        {
            "macro_equal_cell_weight": citl,
            "absolute_maximum": citl_limit,
            "aggregation": "absolute_value_of_equal_cell_mean_signed_calibration",
        },
    )
    return {
        "status": "pass" if not failed_reasons else "fail",
        "passed": not failed_reasons,
        "protocol": (
            "support_plus_positive_macro_brier_plus_absolute_macro_calibration_only"
        ),
        "primary_baseline": primary_baseline,
        "sufficient_cells": [
            {"role": spec["role"], "horizon_months": spec["horizon_months"]}
            for spec in cell_specs
        ],
        "insufficient_cells": insufficient_cells,
        "insufficient_cells_excluded_from_all_gates": True,
        "brier_comparisons": comparisons,
        "calibration_descriptive": calibration,
        "gates": gates,
        "failed_reasons": failed_reasons,
    }


def cumulative_horizon_violations(
    rows: pd.DataFrame,
    *,
    candidate_probability_column: str = "candidate_probability",
) -> dict[str, Any]:
    violations: list[dict[str, Any]] = []
    for snapshot_id, group in rows.groupby("snapshot_id", sort=True):
        ordered = group.sort_values("horizon_months", kind="mergesort")
        horizons = ordered["horizon_months"].to_numpy(dtype=int)
        probabilities = ordered[candidate_probability_column].to_numpy(dtype=float)
        for position in np.flatnonzero(np.diff(probabilities) < -1e-15):
            violations.append(
                {
                    "snapshot_id": str(snapshot_id),
                    "earlier_horizon_months": int(horizons[position]),
                    "later_horizon_months": int(horizons[position + 1]),
                    "earlier_probability": float(probabilities[position]),
                    "later_probability": float(probabilities[position + 1]),
                }
            )
    return {
        "violations": len(violations),
        "maximum_allowed": PROMOTION_GATE_CONFIG["maximum_cumulative_horizon_violations"],
        "details": violations,
    }


def adjudicate_promotion_gates(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    promotion_eligible: bool,
    candidate_probability_column: str = "candidate_probability",
    primary_baseline: str | None = None,
    repetitions: int = DEFAULT_BOOTSTRAP_REPETITIONS,
    seed: int = DEFAULT_BOOTSTRAP_SEED,
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
) -> dict[str, Any]:
    """Adjudicate the frozen v2 promotion gates using only sufficient cells."""

    if isinstance(repetitions, bool) or not isinstance(repetitions, int) or repetitions <= 0:
        raise ArrivalValidationError("Bootstrap repetitions must be a positive integer")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ArrivalValidationError("Bootstrap seed must be a nonnegative integer")
    if not isinstance(promotion_eligible, (bool, np.bool_)):
        raise ArrivalValidationError("promotion_eligible must be an explicit boolean")
    baselines = _baseline_columns(baseline_probability_columns)
    selected_baseline = _primary_baseline_name(baselines, primary_baseline)
    validated = validate_evaluation_rows(
        rows,
        baselines,
        candidate_probability_column=candidate_probability_column,
        supported_horizons=supported_horizons,
    )
    observed = validated[validated["outcome_observed"].eq(1)].reset_index(drop=True)
    if observed.empty:
        raise ArrivalValidationError("No observed outcomes are available for promotion gates")
    diagnostics = pooled_role_horizon_diagnostics(
        validated,
        baselines,
        candidate_probability_column=candidate_probability_column,
        supported_horizons=supported_horizons,
    )
    subgroup_diagnostics = prior_level_subgroup_diagnostics(
        validated,
        baselines,
        candidate_probability_column=candidate_probability_column,
        supported_horizons=supported_horizons,
    )
    diagnostic_lookup = {
        (cell["role"], cell["horizon_months"]): cell for cell in diagnostics
    }

    players = np.asarray(sorted(observed["player_id"].unique()), dtype=object)
    player_lookup = {player: index for index, player in enumerate(players)}
    row_player_indexes = observed["player_id"].map(player_lookup).to_numpy(dtype=int)
    rng = np.random.default_rng(seed)
    multiplicities = rng.multinomial(
        len(players), np.full(len(players), 1.0 / len(players)), size=repetitions
    )

    pooled_specs: list[dict[str, Any]] = []
    cold_specs: list[dict[str, Any]] = []
    pooled_diagnostics: list[dict[str, Any]] = []
    cold_diagnostics: list[dict[str, Any]] = []
    pooled_insufficient: list[dict[str, Any]] = []
    cold_insufficient: list[dict[str, Any]] = []
    for (role, horizon), group in observed.groupby(["role", "horizon_months"], sort=True):
        identity = {"role": str(role), "horizon_months": int(horizon)}
        diagnostic = diagnostic_lookup[(str(role), int(horizon))]
        if diagnostic["gateable"]:
            pooled_specs.append({**identity, "indexes": group.index.to_numpy(dtype=int)})
            pooled_diagnostics.append(diagnostic)
        else:
            pooled_insufficient.append(
                {**identity, "status": diagnostic["status"], "counts": {
                    key: diagnostic[key]
                    for key in ("rows", "unique_event_players", "unique_non_event_players")
                }}
            )
        cold = group[group["cold_start"].eq(1)]
        if diagnostic["cold_start"]["inferential_metrics_allowed"]:
            cold_specs.append({**identity, "indexes": cold.index.to_numpy(dtype=int)})
            cold_diagnostics.append(
                {**identity, "candidate": diagnostic["cold_start"]["candidate"]}
            )
        else:
            cold_insufficient.append(
                {
                    **identity,
                    "status": diagnostic["cold_start"]["status"],
                    "parent_role_horizon_gateable": diagnostic["gateable"],
                    "counts": {
                        key: diagnostic["cold_start"][key]
                        for key in ("rows", "unique_event_players", "unique_non_event_players")
                    },
                }
            )

    pooled = _scope_adjudication(
        observed,
        pooled_diagnostics,
        pooled_specs,
        baselines,
        selected_baseline,
        candidate_probability_column,
        repetitions,
        multiplicities,
        row_player_indexes,
        scope_name="pooled_role_horizon",
        candidate_key="candidate",
        insufficient_cells=pooled_insufficient,
    )
    cold_start = _cold_start_adjudication(
        observed,
        cold_diagnostics,
        cold_specs,
        baselines,
        selected_baseline,
        candidate_probability_column,
        repetitions,
        multiplicities,
        row_player_indexes,
        cold_insufficient,
    )
    prior_level_subgroups = _prior_level_subgroup_adjudication(
        subgroup_diagnostics, baselines, selected_baseline
    )
    monotonicity = cumulative_horizon_violations(
        validated, candidate_probability_column=candidate_probability_column
    )
    monotonicity_passed = monotonicity["violations"] <= monotonicity["maximum_allowed"]
    monotonicity_gate = {
        "gate": "candidate.maximum_cumulative_horizon_violations",
        "passed": monotonicity_passed,
        "evidence": monotonicity,
    }
    monotonicity_failures = (
        []
        if monotonicity_passed
        else [
            "candidate.maximum_cumulative_horizon_violations: cumulative probabilities "
            "decreased across ordered horizons"
        ]
    )
    failed_reasons = (
        pooled["failed_reasons"]
        + cold_start["failed_reasons"]
        + prior_level_subgroups["failed_reasons"]
        + monotonicity_failures
    )
    admission_gate = {
        "gate": "external_admission.promotion_eligible",
        "passed": bool(promotion_eligible),
        "evidence": {
            "promotion_eligible": bool(promotion_eligible),
            "meaning": "all separately frozen admission and distribution-shift gates passed",
        },
    }
    if not promotion_eligible:
        failed_reasons.append(
            "external_admission.promotion_eligible: external admission or distribution-shift "
            "gates failed"
        )
    all_gates = (
        list(pooled["gates"])
        + list(cold_start["gates"])
        + list(prior_level_subgroups["gates"])
        + [monotonicity_gate, admission_gate]
    )
    return {
        "protocol_schema_version": "arrival-validation-protocol/v2",
        "status": "pass" if not failed_reasons else "fail",
        "passed": not failed_reasons,
        "promotion_requires_every_gate": PROMOTION_GATE_CONFIG[
            "promotion_requires_every_gate"
        ],
        "primary_baseline": selected_baseline,
        "thresholds": {
            key: list(value) if isinstance(value, tuple) else value
            for key, value in PROMOTION_GATE_CONFIG.items()
        },
        "bootstrap": {
            "method": "paired_nonparametric_player_cluster",
            "repetitions": repetitions,
            "seed": seed,
            "player_clusters": int(len(players)),
            "same_global_player_draws_for_every_scope_cell_and_baseline": True,
            "equal_weight_macro_unit": "sufficient_role_horizon_cell",
            "cross_horizon_outcome_pooling": False,
        },
        "role_horizon_diagnostics": diagnostics,
        "pooled_role_horizon": pooled,
        "cold_start_role_horizon": cold_start,
        "prior_level_subgroups": prior_level_subgroups,
        "monotonicity": monotonicity_gate,
        "external_admission": admission_gate,
        "gates": all_gates,
        "metrics_scored_even_when_external_admission_fails": True,
        "failed_reasons": failed_reasons,
    }


def evaluate_external_predictions(
    rows: pd.DataFrame,
    baseline_probability_columns: Mapping[str, str] | Sequence[str],
    *,
    promotion_eligible: bool,
    candidate_probability_column: str = "candidate_probability",
    primary_baseline: str | None = None,
    repetitions: int = DEFAULT_BOOTSTRAP_REPETITIONS,
    seed: int = DEFAULT_BOOTSTRAP_SEED,
    supported_horizons: Sequence[int] = EVALUATION_HORIZON_MONTHS,
) -> dict[str, Any]:
    """Build a fail-closed external-evaluation report without reading or writing files."""

    validated = validate_evaluation_rows(
        rows,
        baseline_probability_columns,
        candidate_probability_column=candidate_probability_column,
        supported_horizons=supported_horizons,
    )
    promotion_adjudication = adjudicate_promotion_gates(
        validated,
        baseline_probability_columns,
        promotion_eligible=promotion_eligible,
        candidate_probability_column=candidate_probability_column,
        primary_baseline=primary_baseline,
        supported_horizons=supported_horizons,
        repetitions=repetitions,
        seed=seed,
    )
    return {
        "schema_version": VALIDATION_SCHEMA_VERSION,
        "rows": int(len(validated)),
        "observed_rows": int(validated["outcome_observed"].sum()),
        "horizon_pooling": "within_horizon_only_never_across_horizons",
        "diagnostics_by_horizon": pooled_horizon_diagnostics(
            validated,
            baseline_probability_columns,
            candidate_probability_column=candidate_probability_column,
            supported_horizons=supported_horizons,
        ),
        "role_horizon_sufficiency": pooled_role_horizon_sufficiency(
            validated,
            baseline_probability_columns,
            candidate_probability_column=candidate_probability_column,
            supported_horizons=supported_horizons,
        ),
        "role_horizon_diagnostics": promotion_adjudication[
            "role_horizon_diagnostics"
        ],
        "paired_bootstrap": paired_player_cluster_bootstrap(
            validated,
            baseline_probability_columns,
            candidate_probability_column=candidate_probability_column,
            supported_horizons=supported_horizons,
            repetitions=repetitions,
            seed=seed,
        ),
        "promotion_adjudication": promotion_adjudication,
    }
