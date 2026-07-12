from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

try:
    from modeling.contracts import SURVIVAL_HORIZON_MONTHS
except ModuleNotFoundError:
    from contracts import SURVIVAL_HORIZON_MONTHS


HAZARD_BASELINE_SCHEMA_VERSION = "arrival-hierarchical-hazard-baseline/v2"
RATE_ENCODING = "ieee754-hex"
FIT_SOURCE = "censoring_aware_person_period_rows"
PRIOR_STRENGTH = 50.0
DEFAULT_WEIGHT_COLUMN = "sample_weight"
SUPPORTED_ROLES = ("hitter", "pitcher")
AGE_BANDS = ("<=19", "20-21", "22-23", "24-25", "26-40", "41+", "missing")


class ArrivalHazardBaselineError(ValueError):
    pass


def _strict_integer(value: Any, name: str) -> int:
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)):
        raise ArrivalHazardBaselineError(f"{name} must be an integer")
    return int(value)


def _strict_nonnegative_integer(value: Any, name: str) -> int:
    result = _strict_integer(value, name)
    if result < 0:
        raise ArrivalHazardBaselineError(f"{name} cannot be negative")
    return result


def _strict_positive_integer(value: Any, name: str) -> int:
    result = _strict_integer(value, name)
    if result <= 0:
        raise ArrivalHazardBaselineError(f"{name} must be positive")
    return result


def _strict_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ArrivalHazardBaselineError(f"{name} must be a nonempty string")
    return value


def _strict_float_hex(value: Any, name: str) -> float:
    try:
        result = float.fromhex(_strict_string(value, name))
    except (OverflowError, TypeError, ValueError) as error:
        if isinstance(error, ArrivalHazardBaselineError):
            raise
        raise ArrivalHazardBaselineError(f"{name} is not a valid hexadecimal float") from error
    if not math.isfinite(result):
        raise ArrivalHazardBaselineError(f"{name} must encode a finite number")
    if result.hex() != value:
        raise ArrivalHazardBaselineError(f"{name} must use canonical hexadecimal encoding")
    return result


def _validate_rate(value: Any, name: str) -> float:
    if isinstance(value, (bool, np.bool_)) or not isinstance(
        value, (int, float, np.integer, np.floating)
    ):
        raise ArrivalHazardBaselineError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not 0.0 <= result <= 1.0:
        raise ArrivalHazardBaselineError(f"{name} must be finite and within [0, 1]")
    return result


def _validate_finite(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, (bool, np.bool_)) or not isinstance(
        value, (int, float, np.integer, np.floating)
    ):
        raise ArrivalHazardBaselineError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result) or (positive and result <= 0.0):
        qualifier = "finite and positive" if positive else "finite"
        raise ArrivalHazardBaselineError(f"{name} must be {qualifier}")
    return result


def _validate_role(value: Any) -> str:
    role = _strict_string(value, "role")
    if role not in SUPPORTED_ROLES:
        raise ArrivalHazardBaselineError(f"Unsupported role: {role}")
    return role


def _normalize_level(value: Any) -> str:
    if value is None or value is pd.NA or (
        isinstance(value, (float, np.floating)) and math.isnan(float(value))
    ):
        return "missing"
    if not isinstance(value, str):
        raise ArrivalHazardBaselineError("prior_level values must be strings or missing")
    normalized = value.strip()
    return normalized if normalized else "missing"


def _age_band(value: Any) -> str:
    if value is None or value is pd.NA or (
        isinstance(value, (float, np.floating)) and math.isnan(float(value))
    ):
        return "missing"
    if isinstance(value, (bool, np.bool_)):
        raise ArrivalHazardBaselineError("age values must be finite positive numbers")
    try:
        age = float(value)
    except (TypeError, ValueError) as error:
        raise ArrivalHazardBaselineError(
            "age values must be finite positive numbers"
        ) from error
    if not math.isfinite(age) or age <= 0.0:
        raise ArrivalHazardBaselineError("age values must be finite positive numbers")
    if age <= 19.0:
        return "<=19"
    if age <= 21.0:
        return "20-21"
    if age <= 23.0:
        return "22-23"
    if age <= 25.0:
        return "24-25"
    if age <= 40.0:
        return "26-40"
    return "41+"


def _validate_horizons(
    values: Iterable[Any], *, require_model_prefix: bool = False
) -> tuple[int, ...]:
    if isinstance(values, (str, bytes)):
        raise ArrivalHazardBaselineError("Horizons must be an ordered integer sequence")
    try:
        horizons = tuple(_strict_positive_integer(value, "horizon") for value in values)
    except TypeError as error:
        raise ArrivalHazardBaselineError("Horizons must be iterable") from error
    if not horizons:
        raise ArrivalHazardBaselineError("Horizons cannot be empty")
    if any(left >= right for left, right in zip(horizons, horizons[1:])):
        raise ArrivalHazardBaselineError("Horizons must be unique and strictly increasing")
    unsupported = sorted(set(horizons) - set(SURVIVAL_HORIZON_MONTHS))
    if unsupported:
        raise ArrivalHazardBaselineError(f"Unsupported horizons: {unsupported}")
    if require_model_prefix:
        expected = tuple(SURVIVAL_HORIZON_MONTHS[: len(horizons)])
        if horizons != expected:
            raise ArrivalHazardBaselineError(
                "Fitted intervals must be a contiguous prefix beginning at 12 months"
            )
    return horizons


@dataclass(frozen=True)
class HazardEstimate:
    rows: int
    events: int
    weighted_exposure: float
    weighted_events: float
    rate: float

    def __post_init__(self) -> None:
        rows = _strict_positive_integer(self.rows, "hazard support rows")
        events = _strict_nonnegative_integer(self.events, "hazard support events")
        if events > rows:
            raise ArrivalHazardBaselineError("Hazard events cannot exceed support rows")
        exposure = _validate_finite(
            self.weighted_exposure, "weighted exposure", positive=True
        )
        weighted_events = _validate_finite(self.weighted_events, "weighted events")
        if weighted_events < 0.0 or weighted_events > exposure:
            raise ArrivalHazardBaselineError(
                "Weighted hazard events must be within [0, weighted exposure]"
            )
        if events == 0 and weighted_events != 0.0:
            raise ArrivalHazardBaselineError(
                "Weighted events must be zero when raw events are zero"
            )
        if events == rows and weighted_events.hex() != exposure.hex():
            raise ArrivalHazardBaselineError(
                "Weighted events must equal exposure when every row is an event"
            )
        _validate_rate(self.rate, "hazard rate")

    def to_portable_dict(self) -> dict[str, Any]:
        return {
            "rows": self.rows,
            "events": self.events,
            "weighted_exposure_hex": float(self.weighted_exposure).hex(),
            "weighted_events_hex": float(self.weighted_events).hex(),
            "rate_hex": float(self.rate).hex(),
        }

    @classmethod
    def from_portable_dict(cls, value: Mapping[str, Any]) -> HazardEstimate:
        if not isinstance(value, Mapping):
            raise ArrivalHazardBaselineError("Portable hazard estimate must be an object")
        if set(value) != {
            "rows",
            "events",
            "weighted_exposure_hex",
            "weighted_events_hex",
            "rate_hex",
        }:
            raise ArrivalHazardBaselineError("Portable hazard estimate fields are invalid")
        return cls(
            rows=_strict_positive_integer(value["rows"], "rows"),
            events=_strict_nonnegative_integer(value["events"], "events"),
            weighted_exposure=_strict_float_hex(
                value["weighted_exposure_hex"], "weighted_exposure_hex"
            ),
            weighted_events=_strict_float_hex(
                value["weighted_events_hex"], "weighted_events_hex"
            ),
            rate=_strict_float_hex(value["rate_hex"], "rate_hex"),
        )


@dataclass(frozen=True)
class RoleHazard:
    role: str
    estimate: HazardEstimate


@dataclass(frozen=True)
class RoleLevelHazard:
    role: str
    prior_level: str
    estimate: HazardEstimate


@dataclass(frozen=True)
class DetailedHazard:
    role: str
    prior_level: str
    age_band: str
    estimate: HazardEstimate


def _group_to_portable_dict(group: Any) -> dict[str, Any]:
    result: dict[str, Any] = {"role": group.role}
    if isinstance(group, (RoleLevelHazard, DetailedHazard)):
        result["prior_level"] = group.prior_level
    if isinstance(group, DetailedHazard):
        result["age_band"] = group.age_band
    result.update(group.estimate.to_portable_dict())
    return result


def _parse_group(
    value: Mapping[str, Any], group_type: type[RoleHazard | RoleLevelHazard | DetailedHazard]
) -> RoleHazard | RoleLevelHazard | DetailedHazard:
    if not isinstance(value, Mapping):
        raise ArrivalHazardBaselineError("Portable hazard group must be an object")
    keys = {
        "role",
        "rows",
        "events",
        "weighted_exposure_hex",
        "weighted_events_hex",
        "rate_hex",
    }
    if group_type in (RoleLevelHazard, DetailedHazard):
        keys.add("prior_level")
    if group_type is DetailedHazard:
        keys.add("age_band")
    if set(value) != keys:
        raise ArrivalHazardBaselineError("Portable hazard group fields are invalid")
    estimate = HazardEstimate.from_portable_dict(
        {
            name: value[name]
            for name in (
                "rows",
                "events",
                "weighted_exposure_hex",
                "weighted_events_hex",
                "rate_hex",
            )
        }
    )
    role = _validate_role(value["role"])
    if group_type is RoleHazard:
        return RoleHazard(role=role, estimate=estimate)
    level = _strict_string(value["prior_level"], "prior_level")
    if level != _normalize_level(level):
        raise ArrivalHazardBaselineError("Portable prior_level is not canonical")
    if group_type is RoleLevelHazard:
        return RoleLevelHazard(role=role, prior_level=level, estimate=estimate)
    age_band = _strict_string(value["age_band"], "age_band")
    if age_band not in AGE_BANDS:
        raise ArrivalHazardBaselineError("Portable age_band is invalid")
    return DetailedHazard(
        role=role,
        prior_level=level,
        age_band=age_band,
        estimate=estimate,
    )


@dataclass(frozen=True)
class IntervalHazards:
    interval: int
    horizon_months: int
    global_estimate: HazardEstimate
    role_hazards: tuple[RoleHazard, ...]
    role_level_hazards: tuple[RoleLevelHazard, ...]
    detailed_hazards: tuple[DetailedHazard, ...]

    def to_portable_dict(self) -> dict[str, Any]:
        return {
            "interval": self.interval,
            "horizon_months": self.horizon_months,
            "global": self.global_estimate.to_portable_dict(),
            "role": [_group_to_portable_dict(group) for group in self.role_hazards],
            "role_level": [
                _group_to_portable_dict(group) for group in self.role_level_hazards
            ],
            "role_level_age_band": [
                _group_to_portable_dict(group) for group in self.detailed_hazards
            ],
        }

    @classmethod
    def from_portable_dict(cls, value: Mapping[str, Any]) -> IntervalHazards:
        if not isinstance(value, Mapping):
            raise ArrivalHazardBaselineError("Portable interval must be an object")
        expected = {
            "interval",
            "horizon_months",
            "global",
            "role",
            "role_level",
            "role_level_age_band",
        }
        if set(value) != expected:
            raise ArrivalHazardBaselineError("Portable interval fields are invalid")
        for name in ("global",):
            if not isinstance(value[name], Mapping):
                raise ArrivalHazardBaselineError(f"Portable interval {name} must be an object")
        for name in ("role", "role_level", "role_level_age_band"):
            if not isinstance(value[name], list) or not all(
                isinstance(item, Mapping) for item in value[name]
            ):
                raise ArrivalHazardBaselineError(
                    f"Portable interval {name} must be an array of objects"
                )
        return cls(
            interval=_strict_positive_integer(value["interval"], "interval"),
            horizon_months=_strict_positive_integer(
                value["horizon_months"], "horizon_months"
            ),
            global_estimate=HazardEstimate.from_portable_dict(value["global"]),
            role_hazards=tuple(
                _parse_group(item, RoleHazard) for item in value["role"]
            ),
            role_level_hazards=tuple(
                _parse_group(item, RoleLevelHazard) for item in value["role_level"]
            ),
            detailed_hazards=tuple(
                _parse_group(item, DetailedHazard)
                for item in value["role_level_age_band"]
            ),
        )


def _assert_exact_rate(actual: float, expected: float, label: str) -> None:
    if float(actual).hex() != float(expected).hex():
        raise ArrivalHazardBaselineError(f"{label} does not match its support and parent")


def _assert_unique_sorted(keys: Sequence[Any], label: str) -> None:
    if len(set(keys)) != len(keys):
        raise ArrivalHazardBaselineError(f"Duplicate {label} groups")
    if list(keys) != sorted(keys):
        raise ArrivalHazardBaselineError(f"{label} groups must be canonically sorted")


def _assert_support_reconciles(
    children: Sequence[HazardEstimate], parent: HazardEstimate, label: str
) -> None:
    if sum(child.rows for child in children) != parent.rows or sum(
        child.events for child in children
    ) != parent.events:
        raise ArrivalHazardBaselineError(f"{label} raw support does not reconcile")
    exposure = math.fsum(child.weighted_exposure for child in children)
    events = math.fsum(child.weighted_events for child in children)
    if not math.isclose(
        exposure, parent.weighted_exposure, rel_tol=1e-12, abs_tol=1e-12
    ) or not math.isclose(
        events, parent.weighted_events, rel_tol=1e-12, abs_tol=1e-12
    ):
        raise ArrivalHazardBaselineError(f"{label} weighted support does not reconcile")


def _validate_interval_fit(fit: IntervalHazards) -> None:
    interval = _strict_positive_integer(fit.interval, "interval")
    if interval > len(SURVIVAL_HORIZON_MONTHS):
        raise ArrivalHazardBaselineError("Interval exceeds the supported horizon contract")
    if fit.horizon_months != SURVIVAL_HORIZON_MONTHS[interval - 1]:
        raise ArrivalHazardBaselineError("Interval and horizon_months do not agree")

    global_estimate = fit.global_estimate
    _assert_exact_rate(
        global_estimate.rate,
        global_estimate.weighted_events / global_estimate.weighted_exposure,
        "Interval-global rate",
    )

    role_keys = [group.role for group in fit.role_hazards]
    _assert_unique_sorted(role_keys, "role")
    if any(role not in SUPPORTED_ROLES for role in role_keys):
        raise ArrivalHazardBaselineError("Interval contains an unsupported role")
    _assert_support_reconciles(
        [group.estimate for group in fit.role_hazards],
        global_estimate,
        "Role-to-global",
    )
    role_lookup = {group.role: group.estimate for group in fit.role_hazards}
    for group in fit.role_hazards:
        expected = (
            group.estimate.weighted_events
            + PRIOR_STRENGTH * global_estimate.rate
        ) / (group.estimate.weighted_exposure + PRIOR_STRENGTH)
        _assert_exact_rate(group.estimate.rate, expected, "Role hazard")

    level_keys = [(group.role, group.prior_level) for group in fit.role_level_hazards]
    _assert_unique_sorted(level_keys, "role-level")
    for group in fit.role_level_hazards:
        parent = role_lookup.get(group.role)
        if parent is None:
            raise ArrivalHazardBaselineError("Role-level hazard has no role parent")
        if group.prior_level != _normalize_level(group.prior_level):
            raise ArrivalHazardBaselineError("Role-level prior_level is not canonical")
        expected = (
            group.estimate.weighted_events + PRIOR_STRENGTH * parent.rate
        ) / (
            group.estimate.weighted_exposure + PRIOR_STRENGTH
        )
        _assert_exact_rate(group.estimate.rate, expected, "Role-level hazard")
    for role, parent in role_lookup.items():
        children = [group.estimate for group in fit.role_level_hazards if group.role == role]
        _assert_support_reconciles(children, parent, "Role-level-to-role")

    detailed_keys = [
        (group.role, group.prior_level, group.age_band)
        for group in fit.detailed_hazards
    ]
    _assert_unique_sorted(detailed_keys, "role-level-age-band")
    level_lookup = {
        (group.role, group.prior_level): group.estimate
        for group in fit.role_level_hazards
    }
    for group in fit.detailed_hazards:
        parent = level_lookup.get((group.role, group.prior_level))
        if parent is None:
            raise ArrivalHazardBaselineError("Detailed hazard has no role-level parent")
        if group.age_band not in AGE_BANDS:
            raise ArrivalHazardBaselineError("Detailed hazard age_band is invalid")
        expected = (
            group.estimate.weighted_events + PRIOR_STRENGTH * parent.rate
        ) / (
            group.estimate.weighted_exposure + PRIOR_STRENGTH
        )
        _assert_exact_rate(group.estimate.rate, expected, "Detailed hazard")
    for key, parent in level_lookup.items():
        children = [
            group.estimate
            for group in fit.detailed_hazards
            if (group.role, group.prior_level) == key
        ]
        _assert_support_reconciles(children, parent, "Detailed-to-role-level")


@dataclass(frozen=True)
class ArrivalHazardBaselineModel:
    weight_column: str
    horizons_months: tuple[int, ...]
    intervals: tuple[IntervalHazards, ...]

    def __post_init__(self) -> None:
        weight_column = _strict_string(self.weight_column, "weight_column")
        if weight_column != weight_column.strip():
            raise ArrivalHazardBaselineError("weight_column must be canonical")
        horizons = _validate_horizons(self.horizons_months, require_model_prefix=True)
        if horizons != self.horizons_months:
            raise ArrivalHazardBaselineError("Model horizons must be stored as an integer tuple")
        interval_numbers = tuple(interval.interval for interval in self.intervals)
        if interval_numbers != tuple(range(1, len(horizons) + 1)):
            raise ArrivalHazardBaselineError(
                "Model intervals must exactly match its contiguous horizon support"
            )
        if tuple(interval.horizon_months for interval in self.intervals) != horizons:
            raise ArrivalHazardBaselineError("Model intervals and horizons do not agree")
        for interval in self.intervals:
            _validate_interval_fit(interval)

    def to_portable_dict(self) -> dict[str, Any]:
        return {
            "schema_version": HAZARD_BASELINE_SCHEMA_VERSION,
            "rate_encoding": RATE_ENCODING,
            "fit_source": FIT_SOURCE,
            "prior_strength_hex": PRIOR_STRENGTH.hex(),
            "weight_column": self.weight_column,
            "horizons_months": list(self.horizons_months),
            "intervals": [interval.to_portable_dict() for interval in self.intervals],
        }

    def to_json(self) -> str:
        return json.dumps(
            self.to_portable_dict(),
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )

    @classmethod
    def from_portable_dict(cls, value: Mapping[str, Any]) -> ArrivalHazardBaselineModel:
        if not isinstance(value, Mapping):
            raise ArrivalHazardBaselineError("Portable hazard model must be an object")
        expected = {
            "schema_version",
            "rate_encoding",
            "fit_source",
            "prior_strength_hex",
            "weight_column",
            "horizons_months",
            "intervals",
        }
        if set(value) != expected:
            raise ArrivalHazardBaselineError("Portable hazard model fields are invalid")
        if value.get("schema_version") != HAZARD_BASELINE_SCHEMA_VERSION:
            raise ArrivalHazardBaselineError("Unsupported hazard baseline schema")
        if value.get("rate_encoding") != RATE_ENCODING:
            raise ArrivalHazardBaselineError("Unsupported hazard rate encoding")
        if value.get("fit_source") != FIT_SOURCE:
            raise ArrivalHazardBaselineError("Hazard baseline fit source is invalid")
        if _strict_float_hex(value.get("prior_strength_hex"), "prior_strength_hex").hex() != (
            PRIOR_STRENGTH.hex()
        ):
            raise ArrivalHazardBaselineError("Hazard prior strength differs from the contract")
        weight_column = _strict_string(value.get("weight_column"), "weight_column")
        if weight_column != weight_column.strip():
            raise ArrivalHazardBaselineError("weight_column must be canonical")
        if not isinstance(value.get("horizons_months"), list) or not isinstance(
            value.get("intervals"), list
        ):
            raise ArrivalHazardBaselineError(
                "Portable hazard horizons and intervals must be arrays"
            )
        if not all(isinstance(item, Mapping) for item in value["intervals"]):
            raise ArrivalHazardBaselineError("Portable hazard intervals must be objects")
        horizons = _validate_horizons(
            value["horizons_months"], require_model_prefix=True
        )
        intervals = tuple(
            IntervalHazards.from_portable_dict(item) for item in value["intervals"]
        )
        return cls(
            weight_column=weight_column,
            horizons_months=horizons,
            intervals=intervals,
        )

    @classmethod
    def from_json(cls, value: str) -> ArrivalHazardBaselineModel:
        if not isinstance(value, str):
            raise ArrivalHazardBaselineError("Portable hazard model JSON must be a string")

        def reject_constant(constant: str) -> None:
            raise ArrivalHazardBaselineError(
                f"Portable hazard model contains invalid constant: {constant}"
            )

        def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, item in pairs:
                if key in result:
                    raise ArrivalHazardBaselineError(
                        f"Portable hazard model contains duplicate field: {key}"
                    )
                result[key] = item
            return result

        try:
            decoded = json.loads(
                value,
                parse_constant=reject_constant,
                object_pairs_hook=unique_object,
            )
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            if isinstance(error, ArrivalHazardBaselineError):
                raise
            raise ArrivalHazardBaselineError("Portable hazard model JSON is invalid") from error
        if not isinstance(decoded, Mapping):
            raise ArrivalHazardBaselineError("Portable hazard model JSON must contain an object")
        return cls.from_portable_dict(decoded)

    def predict_interval_hazards(
        self,
        snapshots: pd.DataFrame,
        horizons_months: Sequence[int] | None = None,
    ) -> dict[int, np.ndarray]:
        normalized = _validate_scoring_snapshots(snapshots)
        horizons = _requested_horizons(horizons_months, self.horizons_months)
        required_intervals = range(1, max(_horizon_interval(value) for value in horizons) + 1)
        interval_lookup = {interval.interval: interval for interval in self.intervals}
        predictions: dict[int, np.ndarray] = {}
        for interval_number in required_intervals:
            interval = interval_lookup.get(interval_number)
            if interval is None:
                raise ArrivalHazardBaselineError(
                    f"No fitted support for interval {interval_number}"
                )
            predictions[interval.horizon_months] = _score_interval(interval, normalized)
        return {horizon: predictions[horizon] for horizon in horizons}

    def predict_cumulative(
        self,
        snapshots: pd.DataFrame,
        horizons_months: Sequence[int] | None = None,
    ) -> dict[int, np.ndarray]:
        normalized = _validate_scoring_snapshots(snapshots)
        horizons = _requested_horizons(horizons_months, self.horizons_months)
        maximum_interval = max(_horizon_interval(value) for value in horizons)
        interval_lookup = {interval.interval: interval for interval in self.intervals}
        survival = np.ones(len(normalized), dtype=float)
        cumulative: dict[int, np.ndarray] = {}
        for interval_number in range(1, maximum_interval + 1):
            interval = interval_lookup.get(interval_number)
            if interval is None:
                raise ArrivalHazardBaselineError(
                    f"No fitted support for interval {interval_number}"
                )
            hazard = _score_interval(interval, normalized)
            survival *= 1.0 - hazard
            if interval.horizon_months in horizons:
                probability = 1.0 - survival
                if not np.isfinite(probability).all() or (
                    (probability < 0.0) | (probability > 1.0)
                ).any():
                    raise ArrivalHazardBaselineError(
                        "Cumulative hazard prediction is outside [0, 1]"
                    )
                cumulative[interval.horizon_months] = probability.copy()
        return {horizon: cumulative[horizon] for horizon in horizons}


def _requested_horizons(
    requested: Sequence[int] | None, fitted: tuple[int, ...]
) -> tuple[int, ...]:
    horizons = fitted if requested is None else _validate_horizons(requested)
    unsupported = sorted(set(horizons) - set(fitted))
    if unsupported:
        raise ArrivalHazardBaselineError(
            f"Requested horizons lack fitted interval support: {unsupported}"
        )
    return horizons


def _horizon_interval(horizon: int) -> int:
    return SURVIVAL_HORIZON_MONTHS.index(horizon) + 1


def _canonical_snapshot_ids(values: pd.Series) -> np.ndarray:
    if values.isna().any():
        raise ArrivalHazardBaselineError("snapshot_id cannot be missing")
    identifiers: list[str] = []
    for value in values.tolist():
        if not isinstance(value, str) or not value.strip():
            raise ArrivalHazardBaselineError("snapshot_id values must be nonempty strings")
        identifiers.append(value.strip())
    result = np.asarray(identifiers, dtype=object)
    if len(set(result.tolist())) != len(result):
        raise ArrivalHazardBaselineError("Scoring snapshot_id values must be unique")
    return result


def _validate_scoring_snapshots(snapshots: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(snapshots, pd.DataFrame) or snapshots.empty:
        raise ArrivalHazardBaselineError("Scoring snapshots must be a nonempty DataFrame")
    required = {"snapshot_id", "role", "prior_level", "age"}
    missing = sorted(required - set(snapshots.columns))
    if missing:
        raise ArrivalHazardBaselineError(f"Missing scoring columns: {missing}")
    return pd.DataFrame(
        {
            "snapshot_id": _canonical_snapshot_ids(snapshots["snapshot_id"]),
            "role": [_validate_role(value) for value in snapshots["role"].tolist()],
            "prior_level": [
                _normalize_level(value) for value in snapshots["prior_level"].tolist()
            ],
            "age_band": [_age_band(value) for value in snapshots["age"].tolist()],
        }
    )


def _score_interval(interval: IntervalHazards, snapshots: pd.DataFrame) -> np.ndarray:
    role_lookup = {group.role: group.estimate.rate for group in interval.role_hazards}
    level_lookup = {
        (group.role, group.prior_level): group.estimate.rate
        for group in interval.role_level_hazards
    }
    detailed_lookup = {
        (group.role, group.prior_level, group.age_band): group.estimate.rate
        for group in interval.detailed_hazards
    }
    hazards: list[float] = []
    for row in snapshots.itertuples(index=False):
        role_rate = role_lookup.get(row.role)
        if role_rate is None:
            raise ArrivalHazardBaselineError(
                f"Role {row.role} lacks fitted support at {interval.horizon_months} months"
            )
        level_rate = level_lookup.get((row.role, row.prior_level), role_rate)
        hazard = detailed_lookup.get(
            (row.role, row.prior_level, row.age_band), level_rate
        )
        hazards.append(hazard)
    result = np.asarray(hazards, dtype=float)
    if not np.isfinite(result).all() or ((result < 0.0) | (result > 1.0)).any():
        raise ArrivalHazardBaselineError("Interval hazard prediction is outside [0, 1]")
    return result


def _binary_events(values: pd.Series) -> np.ndarray:
    events: list[int] = []
    for value in values.tolist():
        if isinstance(value, (bool, np.bool_)):
            events.append(int(value))
        elif isinstance(value, (int, np.integer)) and int(value) in (0, 1):
            events.append(int(value))
        elif isinstance(value, (float, np.floating)) and math.isfinite(float(value)):
            if float(value) in (0.0, 1.0):
                events.append(int(value))
            else:
                raise ArrivalHazardBaselineError("event values must be binary")
        else:
            raise ArrivalHazardBaselineError("event values must be binary")
    return np.asarray(events, dtype=np.int8)


def _interval_values(values: pd.Series) -> np.ndarray:
    intervals = np.asarray(
        [_strict_positive_integer(value, "interval") for value in values.tolist()],
        dtype=np.int8,
    )
    if (intervals > len(SURVIVAL_HORIZON_MONTHS)).any():
        raise ArrivalHazardBaselineError("Person-period interval is unsupported")
    return intervals


def _sample_weights(values: pd.Series, weight_column: str) -> np.ndarray:
    weights: list[float] = []
    for value in values.tolist():
        weights.append(
            _validate_finite(value, f"{weight_column} values", positive=True)
        )
    return np.asarray(weights, dtype=float)


def _validate_person_periods(
    periods: pd.DataFrame, weight_column: str
) -> pd.DataFrame:
    if not isinstance(periods, pd.DataFrame) or periods.empty:
        raise ArrivalHazardBaselineError("Person-period training rows must be nonempty")
    required = {
        "snapshot_id",
        "role",
        "prior_level",
        "age",
        "interval",
        "event",
        weight_column,
    }
    missing = sorted(required - set(periods.columns))
    if missing:
        raise ArrivalHazardBaselineError(f"Missing person-period columns: {missing}")

    identifiers: list[str] = []
    for value in periods["snapshot_id"].tolist():
        if not isinstance(value, str) or not value.strip():
            raise ArrivalHazardBaselineError("snapshot_id values must be nonempty strings")
        identifiers.append(value.strip())
    normalized = pd.DataFrame(
        {
            "snapshot_id": identifiers,
            "role": [_validate_role(value) for value in periods["role"].tolist()],
            "prior_level": [
                _normalize_level(value) for value in periods["prior_level"].tolist()
            ],
            "age_band": [_age_band(value) for value in periods["age"].tolist()],
            "interval": _interval_values(periods["interval"]),
            "event": _binary_events(periods["event"]),
            "_sample_weight": _sample_weights(periods[weight_column], weight_column),
        }
    )
    if normalized.duplicated(["snapshot_id", "interval"]).any():
        raise ArrivalHazardBaselineError("Duplicate snapshot_id + interval training rows")

    for snapshot_id, rows in normalized.groupby("snapshot_id", sort=False):
        ordered = rows.sort_values("interval", kind="mergesort")
        observed_intervals = ordered["interval"].tolist()
        if observed_intervals != list(range(1, max(observed_intervals) + 1)):
            raise ArrivalHazardBaselineError(
                f"Snapshot {snapshot_id} has a noncontiguous at-risk interval sequence"
            )
        if ordered[["role", "prior_level", "age_band"]].nunique().max() != 1:
            raise ArrivalHazardBaselineError(
                f"Snapshot {snapshot_id} changes features across at-risk intervals"
            )
        event_positions = np.flatnonzero(ordered["event"].to_numpy() == 1)
        if len(event_positions) > 1 or (
            len(event_positions) == 1 and event_positions[0] != len(ordered) - 1
        ):
            raise ArrivalHazardBaselineError(
                f"Snapshot {snapshot_id} has an invalid terminal event sequence"
            )

    observed = tuple(sorted(int(value) for value in normalized["interval"].unique()))
    expected = tuple(range(1, max(observed) + 1))
    if observed != expected:
        raise ArrivalHazardBaselineError(
            "Training intervals must be a contiguous prefix beginning at interval 1"
        )
    return normalized.sort_values(
        ["interval", "role", "prior_level", "age_band", "snapshot_id"],
        kind="mergesort",
        ignore_index=True,
    )


def _estimate(rows: pd.DataFrame, parent_rate: float | None = None) -> HazardEstimate:
    support = int(len(rows))
    events = int(rows["event"].sum())
    weighted_exposure = math.fsum(rows["_sample_weight"].tolist())
    weighted_events = math.fsum(
        rows.loc[rows["event"] == 1, "_sample_weight"].tolist()
    )
    if parent_rate is None:
        rate = weighted_events / weighted_exposure
    else:
        rate = (weighted_events + PRIOR_STRENGTH * parent_rate) / (
            weighted_exposure + PRIOR_STRENGTH
        )
    return HazardEstimate(
        rows=support,
        events=events,
        weighted_exposure=weighted_exposure,
        weighted_events=weighted_events,
        rate=float(rate),
    )


def _fit_interval(rows: pd.DataFrame, interval: int) -> IntervalHazards:
    global_estimate = _estimate(rows)
    roles: list[RoleHazard] = []
    role_levels: list[RoleLevelHazard] = []
    details: list[DetailedHazard] = []
    for role, role_rows in rows.groupby("role", sort=True, observed=True):
        role_estimate = _estimate(role_rows, global_estimate.rate)
        roles.append(RoleHazard(role=str(role), estimate=role_estimate))
        for level, level_rows in role_rows.groupby(
            "prior_level", sort=True, observed=True
        ):
            level_estimate = _estimate(level_rows, role_estimate.rate)
            role_levels.append(
                RoleLevelHazard(
                    role=str(role), prior_level=str(level), estimate=level_estimate
                )
            )
            for age_band, detailed_rows in level_rows.groupby(
                "age_band", sort=True, observed=True
            ):
                details.append(
                    DetailedHazard(
                        role=str(role),
                        prior_level=str(level),
                        age_band=str(age_band),
                        estimate=_estimate(detailed_rows, level_estimate.rate),
                    )
                )
    return IntervalHazards(
        interval=interval,
        horizon_months=SURVIVAL_HORIZON_MONTHS[interval - 1],
        global_estimate=global_estimate,
        role_hazards=tuple(roles),
        role_level_hazards=tuple(role_levels),
        detailed_hazards=tuple(details),
    )


def fit_hazard_baseline(
    person_periods: pd.DataFrame,
    *,
    weight_column: str = DEFAULT_WEIGHT_COLUMN,
) -> ArrivalHazardBaselineModel:
    """Fit annual hazards from rows observed at risk before censoring or arrival."""

    weight_column = _strict_string(weight_column, "weight_column")
    if weight_column != weight_column.strip():
        raise ArrivalHazardBaselineError("weight_column must be canonical")
    normalized = _validate_person_periods(person_periods, weight_column)
    intervals = tuple(
        _fit_interval(
            normalized[normalized["interval"] == interval].copy(), interval
        )
        for interval in sorted(int(value) for value in normalized["interval"].unique())
    )
    horizons = tuple(interval.horizon_months for interval in intervals)
    return ArrivalHazardBaselineModel(
        weight_column=weight_column,
        horizons_months=horizons,
        intervals=intervals,
    )
