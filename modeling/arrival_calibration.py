from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd
from scipy.optimize import minimize

try:
    from modeling.contracts import SURVIVAL_HORIZON_MONTHS
except ModuleNotFoundError:
    from contracts import SURVIVAL_HORIZON_MONTHS


CALIBRATION_SCHEMA_VERSION = "arrival-horizon-calibration/v1"
COEFFICIENT_ENCODING = "ieee754-hex"

SNAPSHOT_COLUMN = "snapshot_id"
HORIZON_COLUMN = "horizon_months"
PROBABILITY_COLUMN = "probability"
OUTCOME_COLUMN = "outcome"
COLD_START_COLUMN = "cold_start"
WEIGHT_COLUMN = "sample_weight"


class ArrivalCalibrationError(ValueError):
    pass


@dataclass(frozen=True)
class FixedCalibrationConfig:
    """Frozen choices for the first chronological arrival calibrator."""

    formula: str = "logit(q_h)=alpha_h+beta_h*logit(p_h)+gamma_h*cold_start"
    probability_clip: float = 1e-6
    ridge_strength: float = 0.01
    ridge_target: str = "identity(alpha=0,beta=1,gamma=0)"
    optimizer: str = "L-BFGS-B"
    optimizer_max_iterations: int = 2_000
    optimizer_ftol: float = 1e-12
    optimizer_gtol: float = 1e-9
    slope_constraint: str = "beta>=0"
    projection: str = "row-wise weighted PAVA"
    projection_weight: str = "horizon OOF sample-weight sum"

    def to_portable_dict(self) -> dict[str, Any]:
        return {
            "formula": self.formula,
            "probability_clip": self.probability_clip,
            "ridge_strength": self.ridge_strength,
            "ridge_target": self.ridge_target,
            "optimizer": self.optimizer,
            "optimizer_max_iterations": self.optimizer_max_iterations,
            "optimizer_ftol": self.optimizer_ftol,
            "optimizer_gtol": self.optimizer_gtol,
            "slope_constraint": self.slope_constraint,
            "projection": self.projection,
            "projection_weight": self.projection_weight,
        }


CALIBRATION_CONFIG = FixedCalibrationConfig()


@dataclass(frozen=True)
class HorizonCalibrator:
    horizon_months: int
    alpha: float
    beta: float
    gamma: float
    training_rows: int
    training_events: int
    training_weight: float
    returning_rows: int
    returning_events: int
    cold_start_rows: int
    cold_start_events: int

    def __post_init__(self) -> None:
        integer_fields = {
            "horizon_months": self.horizon_months,
            "training_rows": self.training_rows,
            "training_events": self.training_events,
            "returning_rows": self.returning_rows,
            "returning_events": self.returning_events,
            "cold_start_rows": self.cold_start_rows,
            "cold_start_events": self.cold_start_events,
        }
        if any(
            isinstance(value, (bool, np.bool_))
            or not isinstance(value, (int, np.integer))
            for value in integer_fields.values()
        ):
            raise ArrivalCalibrationError("Calibrator support values must be integers")
        if self.horizon_months <= 0:
            raise ArrivalCalibrationError("Calibrator horizon must be a positive integer")
        coefficients = np.asarray([self.alpha, self.beta, self.gamma], dtype=float)
        if not np.isfinite(coefficients).all():
            raise ArrivalCalibrationError("Calibrator coefficients must be finite")
        if self.beta < 0:
            raise ArrivalCalibrationError("Calibrator beta slope cannot be negative")
        if (
            isinstance(self.training_weight, (bool, np.bool_))
            or not isinstance(self.training_weight, (int, float, np.integer, np.floating))
            or self.training_rows <= 0
            or self.training_weight <= 0
        ):
            raise ArrivalCalibrationError("Calibrator training support must be positive")
        if not math.isfinite(self.training_weight):
            raise ArrivalCalibrationError("Calibrator training weight must be finite")
        if self.returning_rows + self.cold_start_rows != self.training_rows:
            raise ArrivalCalibrationError("Calibrator stratum rows do not reconcile")
        if self.returning_events + self.cold_start_events != self.training_events:
            raise ArrivalCalibrationError("Calibrator stratum events do not reconcile")
        for name, rows, events in (
            ("returning", self.returning_rows, self.returning_events),
            ("cold_start", self.cold_start_rows, self.cold_start_events),
        ):
            if rows < 2 or not 0 < events < rows:
                raise ArrivalCalibrationError(
                    f"Calibrator {name} stratum lacks both outcome classes"
                )

    def to_portable_dict(self) -> dict[str, Any]:
        return {
            "horizon_months": self.horizon_months,
            "alpha_hex": float(self.alpha).hex(),
            "beta_hex": float(self.beta).hex(),
            "gamma_hex": float(self.gamma).hex(),
            "support": {
                "training_rows": self.training_rows,
                "training_events": self.training_events,
                "training_weight_hex": float(self.training_weight).hex(),
                "returning_rows": self.returning_rows,
                "returning_events": self.returning_events,
                "cold_start_rows": self.cold_start_rows,
                "cold_start_events": self.cold_start_events,
            },
        }

    @classmethod
    def from_portable_dict(cls, value: Mapping[str, Any]) -> HorizonCalibrator:
        expected = {"horizon_months", "alpha_hex", "beta_hex", "gamma_hex", "support"}
        if set(value) != expected or not isinstance(value.get("support"), Mapping):
            raise ArrivalCalibrationError("Portable calibrator fields are invalid")
        support = value["support"]
        expected_support = {
            "training_rows",
            "training_events",
            "training_weight_hex",
            "returning_rows",
            "returning_events",
            "cold_start_rows",
            "cold_start_events",
        }
        if set(support) != expected_support:
            raise ArrivalCalibrationError("Portable calibrator support is invalid")
        try:
            return cls(
                horizon_months=_strict_positive_integer(
                    value["horizon_months"], "horizon_months"
                ),
                alpha=float.fromhex(_strict_string(value["alpha_hex"], "alpha_hex")),
                beta=float.fromhex(_strict_string(value["beta_hex"], "beta_hex")),
                gamma=float.fromhex(_strict_string(value["gamma_hex"], "gamma_hex")),
                training_rows=_strict_integer(support["training_rows"], "training_rows"),
                training_events=_strict_integer(
                    support["training_events"], "training_events"
                ),
                training_weight=float.fromhex(
                    _strict_string(support["training_weight_hex"], "training_weight_hex")
                ),
                returning_rows=_strict_integer(support["returning_rows"], "returning_rows"),
                returning_events=_strict_integer(
                    support["returning_events"], "returning_events"
                ),
                cold_start_rows=_strict_integer(
                    support["cold_start_rows"], "cold_start_rows"
                ),
                cold_start_events=_strict_integer(
                    support["cold_start_events"], "cold_start_events"
                ),
            )
        except (OverflowError, TypeError, ValueError) as error:
            if isinstance(error, ArrivalCalibrationError):
                raise
            raise ArrivalCalibrationError("Portable calibrator values are invalid") from error


@dataclass(frozen=True)
class ArrivalCalibrationModel:
    horizons_months: tuple[int, ...]
    calibrators: tuple[HorizonCalibrator, ...]

    def __post_init__(self) -> None:
        horizons = validate_horizon_vector(self.horizons_months)
        if horizons != self.horizons_months:
            raise ArrivalCalibrationError("Model horizons must be stored as an integer tuple")
        fitted_horizons = tuple(calibrator.horizon_months for calibrator in self.calibrators)
        if fitted_horizons != horizons:
            raise ArrivalCalibrationError("Calibrators do not exactly match ordered horizons")

    def to_portable_dict(self) -> dict[str, Any]:
        return {
            "schema_version": CALIBRATION_SCHEMA_VERSION,
            "coefficient_encoding": COEFFICIENT_ENCODING,
            "fit_source": "provided_oof_rows_only",
            "config": CALIBRATION_CONFIG.to_portable_dict(),
            "horizons_months": list(self.horizons_months),
            "calibrators": [calibrator.to_portable_dict() for calibrator in self.calibrators],
        }

    @classmethod
    def from_portable_dict(cls, value: Mapping[str, Any]) -> ArrivalCalibrationModel:
        expected = {
            "schema_version",
            "coefficient_encoding",
            "fit_source",
            "config",
            "horizons_months",
            "calibrators",
        }
        if set(value) != expected:
            raise ArrivalCalibrationError("Portable calibration model fields are invalid")
        if value.get("schema_version") != CALIBRATION_SCHEMA_VERSION:
            raise ArrivalCalibrationError("Unsupported calibration model schema")
        if value.get("coefficient_encoding") != COEFFICIENT_ENCODING:
            raise ArrivalCalibrationError("Unsupported coefficient encoding")
        if value.get("fit_source") != "provided_oof_rows_only":
            raise ArrivalCalibrationError("Calibration fit source is invalid")
        if value.get("config") != CALIBRATION_CONFIG.to_portable_dict():
            raise ArrivalCalibrationError(
                "Calibration configuration differs from the frozen contract"
            )
        raw_horizons = value.get("horizons_months")
        raw_calibrators = value.get("calibrators")
        if not isinstance(raw_horizons, list) or not isinstance(raw_calibrators, list):
            raise ArrivalCalibrationError("Portable model horizons or calibrators are invalid")
        horizons = validate_horizon_vector(raw_horizons)
        calibrators = tuple(
            HorizonCalibrator.from_portable_dict(calibrator)
            for calibrator in raw_calibrators
            if isinstance(calibrator, Mapping)
        )
        if len(calibrators) != len(raw_calibrators):
            raise ArrivalCalibrationError("Portable calibrator entries must be objects")
        return cls(horizons_months=horizons, calibrators=calibrators)


def _strict_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ArrivalCalibrationError(f"{name} must be a nonempty string")
    return value


def _strict_integer(value: Any, name: str) -> int:
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)):
        raise ArrivalCalibrationError(f"{name} must be an integer")
    return int(value)


def _strict_positive_integer(value: Any, name: str) -> int:
    result = _strict_integer(value, name)
    if result <= 0:
        raise ArrivalCalibrationError(f"{name} must be positive")
    return result


def validate_horizon_vector(horizons: Iterable[Any]) -> tuple[int, ...]:
    if isinstance(horizons, (str, bytes)):
        raise ArrivalCalibrationError("Horizon vector must be an ordered integer sequence")
    try:
        result = tuple(
            _strict_positive_integer(horizon, "horizon") for horizon in horizons
        )
    except TypeError as error:
        raise ArrivalCalibrationError("Horizon vector must be iterable") from error
    if not result:
        raise ArrivalCalibrationError("Horizon vector cannot be empty")
    if any(left >= right for left, right in zip(result, result[1:])):
        raise ArrivalCalibrationError("Horizons must be unique and strictly increasing")
    return result


def _numeric_vector(values: pd.Series, name: str) -> np.ndarray:
    try:
        result = values.to_numpy(dtype=float)
    except (TypeError, ValueError) as error:
        raise ArrivalCalibrationError(f"{name} values must be numeric") from error
    if result.ndim != 1 or not np.isfinite(result).all():
        raise ArrivalCalibrationError(f"{name} values must be finite")
    return result


def _binary_vector(values: pd.Series, name: str) -> np.ndarray:
    result: list[int] = []
    for value in values.tolist():
        if isinstance(value, (bool, np.bool_)):
            result.append(int(value))
        elif isinstance(value, (int, np.integer)) and int(value) in (0, 1):
            result.append(int(value))
        elif isinstance(value, (float, np.floating)) and math.isfinite(float(value)):
            if float(value) in (0.0, 1.0):
                result.append(int(value))
            else:
                raise ArrivalCalibrationError(f"{name} values must be binary")
        else:
            raise ArrivalCalibrationError(f"{name} values must be binary")
    return np.asarray(result, dtype=np.int8)


def _horizon_series(values: pd.Series) -> np.ndarray:
    result = np.asarray(
        [_strict_positive_integer(value, HORIZON_COLUMN) for value in values.tolist()],
        dtype=np.int64,
    )
    return result


def _canonical_snapshot_ids(values: pd.Series) -> np.ndarray:
    if values.isna().any():
        raise ArrivalCalibrationError("snapshot_id cannot be missing")
    result = values.map(str).str.strip().to_numpy(dtype=str)
    if (result == "").any():
        raise ArrivalCalibrationError("snapshot_id cannot be empty")
    return result


def _validate_keys(
    frame: pd.DataFrame, expected_horizons: tuple[int, ...]
) -> tuple[np.ndarray, np.ndarray]:
    required = {SNAPSHOT_COLUMN, HORIZON_COLUMN}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ArrivalCalibrationError(f"Missing calibration key columns: {missing}")
    snapshot_ids = _canonical_snapshot_ids(frame[SNAPSHOT_COLUMN])
    horizons = _horizon_series(frame[HORIZON_COLUMN])
    keys = pd.DataFrame({SNAPSHOT_COLUMN: snapshot_ids, HORIZON_COLUMN: horizons})
    if keys.duplicated([SNAPSHOT_COLUMN, HORIZON_COLUMN]).any():
        raise ArrivalCalibrationError("Duplicate snapshot_id + horizon_months calibration keys")
    observed = set(int(horizon) for horizon in horizons)
    if observed != set(expected_horizons):
        raise ArrivalCalibrationError(
            "Observed calibration horizons do not exactly match the declared horizon vector"
        )
    return snapshot_ids, horizons


def _validate_oof_rows(
    frame: pd.DataFrame, horizons: tuple[int, ...]
) -> pd.DataFrame:
    required = {
        SNAPSHOT_COLUMN,
        HORIZON_COLUMN,
        PROBABILITY_COLUMN,
        OUTCOME_COLUMN,
        COLD_START_COLUMN,
    }
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ArrivalCalibrationError(f"Missing OOF calibration columns: {missing}")
    if frame.empty:
        raise ArrivalCalibrationError("OOF calibration rows cannot be empty")

    snapshot_ids, horizon_values = _validate_keys(frame, horizons)
    probabilities = _numeric_vector(frame[PROBABILITY_COLUMN], PROBABILITY_COLUMN)
    if ((probabilities < 0.0) | (probabilities > 1.0)).any():
        raise ArrivalCalibrationError("OOF probabilities must be within [0, 1]")
    outcomes = _binary_vector(frame[OUTCOME_COLUMN], OUTCOME_COLUMN)
    cold_start = _binary_vector(frame[COLD_START_COLUMN], COLD_START_COLUMN)
    if WEIGHT_COLUMN in frame:
        weights = _numeric_vector(frame[WEIGHT_COLUMN], WEIGHT_COLUMN)
        if (weights <= 0.0).any():
            raise ArrivalCalibrationError("OOF sample weights must be positive")
    else:
        weights = np.ones(len(frame), dtype=float)
    if "is_oof" in frame:
        is_oof = _binary_vector(frame["is_oof"], "is_oof")
        if not is_oof.all():
            raise ArrivalCalibrationError("Calibration input contains rows not marked OOF")

    normalized = pd.DataFrame(
        {
            SNAPSHOT_COLUMN: snapshot_ids,
            HORIZON_COLUMN: horizon_values,
            PROBABILITY_COLUMN: probabilities,
            OUTCOME_COLUMN: outcomes,
            COLD_START_COLUMN: cold_start,
            WEIGHT_COLUMN: weights,
        }
    ).sort_values([HORIZON_COLUMN, SNAPSHOT_COLUMN], kind="mergesort", ignore_index=True)

    for horizon in horizons:
        horizon_rows = normalized[normalized[HORIZON_COLUMN] == horizon]
        for stratum in (0, 1):
            stratum_outcomes = set(
                int(value)
                for value in horizon_rows.loc[
                    horizon_rows[COLD_START_COLUMN] == stratum, OUTCOME_COLUMN
                ]
            )
            if stratum_outcomes != {0, 1}:
                name = "cold_start" if stratum else "returning"
                raise ArrivalCalibrationError(
                    f"Horizon {horizon} {name} stratum lacks both outcome classes"
                )
    return normalized


def _logit(probability: np.ndarray) -> np.ndarray:
    clipped = np.clip(
        np.asarray(probability, dtype=float),
        CALIBRATION_CONFIG.probability_clip,
        1.0 - CALIBRATION_CONFIG.probability_clip,
    )
    return np.log(clipped) - np.log1p(-clipped)


def _sigmoid(value: np.ndarray) -> np.ndarray:
    value = np.asarray(value, dtype=float)
    result = np.empty_like(value)
    nonnegative = value >= 0
    result[nonnegative] = 1.0 / (1.0 + np.exp(-value[nonnegative]))
    exponential = np.exp(value[~nonnegative])
    result[~nonnegative] = exponential / (1.0 + exponential)
    return result


def _fit_one_horizon(rows: pd.DataFrame, horizon: int) -> HorizonCalibrator:
    x = _logit(rows[PROBABILITY_COLUMN].to_numpy(dtype=float))
    y = rows[OUTCOME_COLUMN].to_numpy(dtype=float)
    cold_start = rows[COLD_START_COLUMN].to_numpy(dtype=float)
    original_weight = rows[WEIGHT_COLUMN].to_numpy(dtype=float)
    weight = original_weight / original_weight.mean()
    weight_total = float(weight.sum())

    weighted_rate = float(np.average(y, weights=weight))
    initial = np.asarray(
        [float(_logit(np.asarray([weighted_rate]))[0]), 1.0, 0.0], dtype=float
    )
    identity = np.asarray([0.0, 1.0, 0.0], dtype=float)

    def objective(parameters: np.ndarray) -> tuple[float, np.ndarray]:
        linear = parameters[0] + parameters[1] * x + parameters[2] * cold_start
        negative_log_likelihood = float(
            np.sum(weight * (np.logaddexp(0.0, linear) - y * linear)) / weight_total
        )
        difference = parameters - identity
        penalty = 0.5 * CALIBRATION_CONFIG.ridge_strength * float(difference @ difference)
        residual = _sigmoid(linear) - y
        gradient = np.asarray(
            [
                np.sum(weight * residual),
                np.sum(weight * residual * x),
                np.sum(weight * residual * cold_start),
            ],
            dtype=float,
        ) / weight_total
        gradient += CALIBRATION_CONFIG.ridge_strength * difference
        return negative_log_likelihood + penalty, gradient

    fit = minimize(
        objective,
        initial,
        method=CALIBRATION_CONFIG.optimizer,
        jac=True,
        bounds=[(None, None), (0.0, None), (None, None)],
        options={
            "maxiter": CALIBRATION_CONFIG.optimizer_max_iterations,
            "ftol": CALIBRATION_CONFIG.optimizer_ftol,
            "gtol": CALIBRATION_CONFIG.optimizer_gtol,
        },
    )
    if not fit.success or not np.isfinite(fit.x).all():
        raise ArrivalCalibrationError(
            f"Constrained calibration optimization failed for horizon {horizon}: {fit.message}"
        )
    alpha, beta, gamma = (float(value) for value in fit.x)
    if beta < 0:
        raise ArrivalCalibrationError("Constrained calibration produced a negative slope")

    returning = rows[rows[COLD_START_COLUMN] == 0]
    cold = rows[rows[COLD_START_COLUMN] == 1]
    return HorizonCalibrator(
        horizon_months=horizon,
        alpha=alpha,
        beta=beta,
        gamma=gamma,
        training_rows=int(len(rows)),
        training_events=int(rows[OUTCOME_COLUMN].sum()),
        training_weight=float(original_weight.sum()),
        returning_rows=int(len(returning)),
        returning_events=int(returning[OUTCOME_COLUMN].sum()),
        cold_start_rows=int(len(cold)),
        cold_start_events=int(cold[OUTCOME_COLUMN].sum()),
    )


def fit_oof_calibrators(
    oof_rows: pd.DataFrame,
    horizons_months: Sequence[int] = SURVIVAL_HORIZON_MONTHS,
) -> ArrivalCalibrationModel:
    """Fit only the supplied out-of-fold predictions under the frozen contract."""

    horizons = validate_horizon_vector(horizons_months)
    normalized = _validate_oof_rows(oof_rows, horizons)
    calibrators = tuple(
        _fit_one_horizon(
            normalized[normalized[HORIZON_COLUMN] == horizon].copy(), horizon
        )
        for horizon in horizons
    )
    return ArrivalCalibrationModel(horizons_months=horizons, calibrators=calibrators)


def weighted_pava(values: Sequence[float], weights: Sequence[float]) -> np.ndarray:
    """Return the weighted least-squares nondecreasing projection of one row."""

    probability = np.asarray(values, dtype=float)
    weight = np.asarray(weights, dtype=float)
    if probability.ndim != 1 or weight.ndim != 1 or len(probability) != len(weight):
        raise ArrivalCalibrationError("PAVA values and weights must be equal-length vectors")
    if len(probability) == 0:
        raise ArrivalCalibrationError("PAVA vectors cannot be empty")
    if not np.isfinite(probability).all() or not np.isfinite(weight).all():
        raise ArrivalCalibrationError("PAVA values and weights must be finite")
    if ((probability < 0.0) | (probability > 1.0)).any():
        raise ArrivalCalibrationError("PAVA probabilities must be within [0, 1]")
    if (weight <= 0.0).any():
        raise ArrivalCalibrationError("PAVA weights must be positive")

    starts: list[int] = []
    ends: list[int] = []
    block_weights: list[float] = []
    weighted_sums: list[float] = []
    for index, (value, item_weight) in enumerate(zip(probability, weight)):
        starts.append(index)
        ends.append(index + 1)
        block_weights.append(float(item_weight))
        weighted_sums.append(float(value * item_weight))
        while len(starts) >= 2:
            previous = weighted_sums[-2] / block_weights[-2]
            current = weighted_sums[-1] / block_weights[-1]
            if previous <= current:
                break
            ends[-2] = ends[-1]
            block_weights[-2] += block_weights[-1]
            weighted_sums[-2] += weighted_sums[-1]
            starts.pop()
            ends.pop()
            block_weights.pop()
            weighted_sums.pop()

    projected = np.empty(len(probability), dtype=float)
    for start, end, block_weight, weighted_sum in zip(
        starts, ends, block_weights, weighted_sums
    ):
        projected[start:end] = weighted_sum / block_weight
    projected = np.clip(projected, 0.0, 1.0)
    if (np.diff(projected) < -1e-15).any():
        raise ArrivalCalibrationError("PAVA projection is not nondecreasing")
    return projected


def project_horizon_probabilities(
    probabilities: Sequence[float],
    horizons_months: Sequence[int],
    weights: Sequence[float],
) -> np.ndarray:
    horizons = validate_horizon_vector(horizons_months)
    try:
        probability_count = len(probabilities)
        weight_count = len(weights)
    except TypeError as error:
        raise ArrivalCalibrationError(
            "Probability and weight inputs must be vectors"
        ) from error
    if probability_count != len(horizons) or weight_count != len(horizons):
        raise ArrivalCalibrationError(
            "Probability, weight, and ordered horizon vectors must have equal length"
        )
    return weighted_pava(probabilities, weights)


def _validate_prediction_rows(
    rows: pd.DataFrame, model: ArrivalCalibrationModel
) -> pd.DataFrame:
    required = {SNAPSHOT_COLUMN, HORIZON_COLUMN, PROBABILITY_COLUMN, COLD_START_COLUMN}
    missing = sorted(required - set(rows.columns))
    if missing:
        raise ArrivalCalibrationError(f"Missing prediction calibration columns: {missing}")
    if rows.empty:
        raise ArrivalCalibrationError("Prediction calibration rows cannot be empty")
    snapshot_ids, horizons = _validate_keys(rows, model.horizons_months)
    probabilities = _numeric_vector(rows[PROBABILITY_COLUMN], PROBABILITY_COLUMN)
    if ((probabilities < 0.0) | (probabilities > 1.0)).any():
        raise ArrivalCalibrationError("Prediction probabilities must be within [0, 1]")
    cold_start = _binary_vector(rows[COLD_START_COLUMN], COLD_START_COLUMN)
    normalized = pd.DataFrame(
        {
            "_row_position": np.arange(len(rows), dtype=np.int64),
            SNAPSHOT_COLUMN: snapshot_ids,
            HORIZON_COLUMN: horizons,
            PROBABILITY_COLUMN: probabilities,
            COLD_START_COLUMN: cold_start,
        }
    )
    expected = list(model.horizons_months)
    for snapshot_id, group in normalized.groupby(SNAPSHOT_COLUMN, sort=False):
        observed = sorted(int(value) for value in group[HORIZON_COLUMN])
        if observed != expected:
            raise ArrivalCalibrationError(
                f"Snapshot {snapshot_id} does not have the complete ordered horizon vector"
            )
        if group[COLD_START_COLUMN].nunique() != 1:
            raise ArrivalCalibrationError(
                f"Snapshot {snapshot_id} has inconsistent cold_start values across horizons"
            )
    return normalized


def apply_calibration(
    prediction_rows: pd.DataFrame,
    model: ArrivalCalibrationModel,
) -> pd.DataFrame:
    """Apply horizon fits, then a true weighted PAVA projection within each snapshot."""

    # Rebuild through the portable representation so malformed in-memory artifacts
    # are subjected to the same fail-closed checks as loaded artifacts.
    model = ArrivalCalibrationModel.from_portable_dict(model.to_portable_dict())
    for column in ("calibrated_probability_unprojected", "calibrated_probability"):
        if column in prediction_rows:
            raise ArrivalCalibrationError(f"Prediction rows already contain {column}")
    normalized = _validate_prediction_rows(prediction_rows, model)
    calibrators = {calibrator.horizon_months: calibrator for calibrator in model.calibrators}
    unprojected = np.empty(len(normalized), dtype=float)
    projected = np.empty(len(normalized), dtype=float)

    for horizon, positions in normalized.groupby(HORIZON_COLUMN).groups.items():
        calibrator = calibrators[int(horizon)]
        index = np.asarray(list(positions), dtype=int)
        logits = _logit(normalized.iloc[index][PROBABILITY_COLUMN].to_numpy(dtype=float))
        cold_start = normalized.iloc[index][COLD_START_COLUMN].to_numpy(dtype=float)
        linear = calibrator.alpha + calibrator.beta * logits + calibrator.gamma * cold_start
        unprojected[index] = np.clip(_sigmoid(linear), 0.0, 1.0)

    projection_weights = {
        calibrator.horizon_months: calibrator.training_weight
        for calibrator in model.calibrators
    }
    for _, positions in normalized.groupby(SNAPSHOT_COLUMN, sort=False).groups.items():
        index = np.asarray(list(positions), dtype=int)
        order = np.argsort(normalized.iloc[index][HORIZON_COLUMN].to_numpy(dtype=int))
        sorted_index = index[order]
        sorted_horizons = normalized.iloc[sorted_index][HORIZON_COLUMN].to_numpy(dtype=int)
        sorted_probability = unprojected[sorted_index]
        sorted_weights = np.asarray(
            [projection_weights[int(horizon)] for horizon in sorted_horizons], dtype=float
        )
        projected[sorted_index] = project_horizon_probabilities(
            sorted_probability, tuple(int(value) for value in sorted_horizons), sorted_weights
        )

    result = prediction_rows.copy()
    result["calibrated_probability_unprojected"] = unprojected
    result["calibrated_probability"] = projected
    if not np.isfinite(projected).all() or ((projected < 0.0) | (projected > 1.0)).any():
        raise ArrivalCalibrationError("Calibrated probabilities are invalid")
    return result


def serialize_calibration_model(model: ArrivalCalibrationModel) -> str:
    validated = ArrivalCalibrationModel.from_portable_dict(model.to_portable_dict())
    return json.dumps(
        validated.to_portable_dict(),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ) + "\n"


def deserialize_calibration_model(body: str | bytes) -> ArrivalCalibrationModel:
    try:
        value = json.loads(body)
    except (json.JSONDecodeError, TypeError, UnicodeDecodeError) as error:
        raise ArrivalCalibrationError("Calibration model JSON is invalid") from error
    if not isinstance(value, Mapping):
        raise ArrivalCalibrationError("Calibration model JSON root must be an object")
    return ArrivalCalibrationModel.from_portable_dict(value)


# Clear integration aliases for callers that use artifact-oriented terminology.
fit_horizon_calibrators = fit_oof_calibrators
calibrate_predictions = apply_calibration
