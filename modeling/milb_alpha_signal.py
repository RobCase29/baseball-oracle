from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

try:
    from modeling.arrival_hazard_baseline import ArrivalHazardBaselineModel
except ModuleNotFoundError:
    from arrival_hazard_baseline import ArrivalHazardBaselineModel


MILB_ALPHA_SIGNAL_VERSION = "milb-alpha-signal-v1"
PRIMARY_HORIZON_MONTHS = 36
LONG_HORIZON_MONTHS = 60
MINIMUM_AGE_CONTEXT_PLAYERS = 400
MINIMUM_METRIC_CONTEXT_PLAYERS = 100
MINIMUM_BASELINE_ROWS = 100
MINIMUM_BASELINE_EVENTS = 5
MAXIMUM_AGE_PERCENTILE = 33.0
MINIMUM_PRIMARY_PROBABILITY = 0.20
MINIMUM_PRIMARY_EDGE = 0.10
PRIORITY_PRIMARY_EDGE = 0.25
PRIORITY_MAXIMUM_AGE_PERCENTILE = 25.0
MINIMUM_HITTER_PA = 75.0
MINIMUM_PITCHER_IP = 20.0
FAILED_EXTERNAL_VALIDATION_STATUS = "external_validation_failed_research_only"


class MilbAlphaSignalError(ValueError):
    pass


_DRIVER_POLICY: dict[str, tuple[tuple[str, str, str], ...]] = {
    "hitter": (
        ("prior_iso", "Isolated power", "higher"),
        ("prior_bb_rate", "Walk rate", "higher"),
        ("prior_k_rate", "Strikeout rate", "lower"),
    ),
    "pitcher": (
        ("prior_k_minus_bb_rate", "K-BB rate", "higher"),
        ("prior_k_rate", "Strikeout rate", "higher"),
        ("prior_bb_rate", "Walk rate", "lower"),
        ("prior_era", "ERA", "lower"),
        ("prior_whip", "WHIP", "lower"),
    ),
}


def _canonical_role(value: object) -> str:
    role = str(value or "").strip().lower()
    if role not in _DRIVER_POLICY:
        raise MilbAlphaSignalError(f"Unsupported MiLB alpha role: {role or 'missing'}")
    return role


def _canonical_level(value: object) -> str:
    if value is None or value is pd.NA:
        return "missing"
    level = str(value).strip()
    return level or "missing"


def _finite_number(value: object, label: str) -> float:
    if isinstance(value, (bool, np.bool_)):
        raise MilbAlphaSignalError(f"{label} must be numeric")
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise MilbAlphaSignalError(f"{label} must be numeric") from error
    if not math.isfinite(result):
        raise MilbAlphaSignalError(f"{label} must be finite")
    return result


def _probability(value: object, label: str) -> float:
    result = _finite_number(value, label)
    if not 0.0 <= result <= 1.0:
        raise MilbAlphaSignalError(f"{label} must be within [0, 1]")
    return result


def _age_band(value: object) -> str:
    age = _finite_number(value, "age")
    if age <= 0.0:
        raise MilbAlphaSignalError("age must be positive")
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


def _equal_player_weights(frame: pd.DataFrame) -> np.ndarray:
    counts = frame.groupby("player_id")["player_id"].transform("size")
    return 1.0 / counts.to_numpy(dtype=float)


def _weighted_midrank_percentile(
    values: np.ndarray, weights: np.ndarray, value: float
) -> float:
    below = math.fsum(weights[values < value].tolist())
    tied = math.fsum(weights[values == value].tolist())
    total = math.fsum(weights.tolist())
    if total <= 0.0:
        raise MilbAlphaSignalError("Reference weights must be positive")
    return 100.0 * (below + 0.5 * tied) / total


@dataclass(frozen=True)
class AgeContext:
    percentile: float
    players: int
    rows: int
    role: str
    prior_level: str


@dataclass(frozen=True)
class BaselineSupport:
    horizon_months: int
    scope: str
    rows: int
    events: int
    role: str
    prior_level: str
    age_band: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "horizonMonths": self.horizon_months,
            "scope": self.scope,
            "rows": self.rows,
            "events": self.events,
        }


class MilbAlphaReference:
    """Frozen pre-2020 age/stat context plus hierarchical baseline support."""

    required_columns = {"snapshot_id", "player_id", "edition", "role", "prior_level", "age"}

    def __init__(
        self,
        snapshots: pd.DataFrame,
        baseline_model: ArrivalHazardBaselineModel,
    ) -> None:
        missing = sorted(self.required_columns - set(snapshots.columns))
        if missing:
            raise MilbAlphaSignalError(f"MiLB alpha reference is missing columns: {missing}")
        if snapshots.empty or snapshots["snapshot_id"].duplicated().any():
            raise MilbAlphaSignalError(
                "MiLB alpha reference must contain unique, nonempty snapshots"
            )
        reference = snapshots.copy()
        reference["role"] = reference["role"].map(_canonical_role)
        reference["prior_level"] = reference["prior_level"].map(_canonical_level)
        reference["age"] = pd.to_numeric(reference["age"], errors="coerce")
        reference["edition"] = pd.to_numeric(reference["edition"], errors="coerce")
        if reference[["player_id", "edition"]].isna().any().any():
            raise MilbAlphaSignalError("MiLB alpha reference contains invalid identity or edition")
        valid_age = reference["age"].notna() & np.isfinite(reference["age"]) & reference[
            "age"
        ].gt(0.0)
        self.excluded_invalid_age_rows = int((~valid_age).sum())
        reference = reference.loc[valid_age].copy()
        if reference.empty:
            raise MilbAlphaSignalError("MiLB alpha reference has no valid age rows")
        if int(reference["edition"].max()) >= 2021:
            raise MilbAlphaSignalError("MiLB alpha reference must be frozen before 2021")
        reference["player_id"] = reference["player_id"].astype(str)
        reference["age_band"] = reference["age"].map(_age_band)
        self.reference = reference.reset_index(drop=True)
        self.baseline_model = baseline_model
        self.age_groups: dict[tuple[str, str], tuple[np.ndarray, np.ndarray, int, int]] = {}
        for key, group in self.reference.groupby(["role", "prior_level"], sort=True):
            self.age_groups[(str(key[0]), str(key[1]))] = (
                group["age"].to_numpy(dtype=float),
                _equal_player_weights(group),
                int(group["player_id"].nunique()),
                int(len(group)),
            )
        self.metric_groups: dict[
            tuple[str, str, str, str], tuple[np.ndarray, np.ndarray, int]
        ] = {}
        self.broad_metric_groups: dict[
            tuple[str, str, str], tuple[np.ndarray, np.ndarray, int]
        ] = {}
        for role, policy in _DRIVER_POLICY.items():
            for column, _, _ in policy:
                if column not in self.reference:
                    continue
                valid = self.reference.loc[
                    self.reference["role"].eq(role)
                    & pd.to_numeric(self.reference[column], errors="coerce").notna()
                ].copy()
                valid[column] = pd.to_numeric(valid[column], errors="coerce")
                valid = valid.loc[np.isfinite(valid[column])]
                for (level, age_band), group in valid.groupby(
                    ["prior_level", "age_band"], sort=True
                ):
                    self.metric_groups[(role, str(level), str(age_band), column)] = (
                        group[column].to_numpy(dtype=float),
                        _equal_player_weights(group),
                        int(group["player_id"].nunique()),
                    )
                for level, group in valid.groupby("prior_level", sort=True):
                    self.broad_metric_groups[(role, str(level), column)] = (
                        group[column].to_numpy(dtype=float),
                        _equal_player_weights(group),
                        int(group["player_id"].nunique()),
                    )

    def age_context(self, *, role: object, prior_level: object, age: object) -> AgeContext | None:
        canonical_role = _canonical_role(role)
        level = _canonical_level(prior_level)
        numeric_age = _finite_number(age, "age")
        group = self.age_groups.get((canonical_role, level))
        if group is None:
            return None
        values, weights, players, rows = group
        return AgeContext(
            percentile=_weighted_midrank_percentile(values, weights, numeric_age),
            players=players,
            rows=rows,
            role=canonical_role,
            prior_level=level,
        )

    def baseline_support(
        self,
        *,
        role: object,
        prior_level: object,
        age: object,
        horizon_months: int,
    ) -> BaselineSupport:
        canonical_role = _canonical_role(role)
        level = _canonical_level(prior_level)
        band = _age_band(age)
        interval = next(
            (
                value
                for value in self.baseline_model.intervals
                if value.horizon_months == int(horizon_months)
            ),
            None,
        )
        if interval is None:
            raise MilbAlphaSignalError(
                f"Historical baseline has no {horizon_months}-month support"
            )
        detailed = next(
            (
                group
                for group in interval.detailed_hazards
                if (group.role, group.prior_level, group.age_band)
                == (canonical_role, level, band)
            ),
            None,
        )
        if detailed is not None:
            scope, estimate = "role_level_age_band", detailed.estimate
        else:
            role_level = next(
                (
                    group
                    for group in interval.role_level_hazards
                    if (group.role, group.prior_level) == (canonical_role, level)
                ),
                None,
            )
            if role_level is not None:
                scope, estimate = "role_level", role_level.estimate
            else:
                role_group = next(
                    (
                        group
                        for group in interval.role_hazards
                        if group.role == canonical_role
                    ),
                    None,
                )
                if role_group is None:
                    raise MilbAlphaSignalError(
                        f"Historical baseline has no support for role: {canonical_role}"
                    )
                scope, estimate = "role", role_group.estimate
        return BaselineSupport(
            horizon_months=int(horizon_months),
            scope=scope,
            rows=int(estimate.rows),
            events=int(estimate.events),
            role=canonical_role,
            prior_level=level,
            age_band=band,
        )

    def descriptive_drivers(self, feature: Mapping[str, Any]) -> list[dict[str, Any]]:
        role = _canonical_role(feature.get("role"))
        level = _canonical_level(feature.get("prior_level"))
        band = _age_band(feature.get("age"))
        drivers: list[dict[str, Any]] = []
        for column, label, direction in _DRIVER_POLICY[role]:
            raw_value = pd.to_numeric(pd.Series([feature.get(column)]), errors="coerce").iloc[0]
            if pd.isna(raw_value) or not math.isfinite(float(raw_value)):
                continue
            exact = self.metric_groups.get((role, level, band, column))
            reference_scope = "role_level_age_band"
            group = exact
            if group is None or group[2] < MINIMUM_METRIC_CONTEXT_PLAYERS:
                group = self.broad_metric_groups.get((role, level, column))
                reference_scope = "role_level"
            if group is None or group[2] < MINIMUM_METRIC_CONTEXT_PLAYERS:
                continue
            values, weights, players = group
            raw_percentile = _weighted_midrank_percentile(
                values, weights, float(raw_value)
            )
            favorable = raw_percentile if direction == "higher" else 100.0 - raw_percentile
            drivers.append(
                {
                    "metric": column,
                    "label": label,
                    "value": round(float(raw_value), 6),
                    "favorablePercentile": round(float(favorable), 2),
                    "favorableDirection": direction,
                    "referenceScope": reference_scope,
                    "referencePlayers": players,
                }
            )
        return sorted(
            drivers,
            key=lambda item: (-float(item["favorablePercentile"]), str(item["metric"])),
        )[:3]

    def report(self) -> dict[str, Any]:
        return {
            "version": MILB_ALPHA_SIGNAL_VERSION,
            "status": "research_only",
            "releaseEligible": False,
            "target": "first_mlb_arrival_within_36_months",
            "referenceSeasons": sorted(
                int(value) for value in self.reference["edition"].unique()
            ),
            "referenceSnapshots": int(len(self.reference)),
            "referencePlayers": int(self.reference["player_id"].nunique()),
            "excludedInvalidAgeRows": self.excluded_invalid_age_rows,
            "inputPolicy": {
                "included": [
                    "age",
                    "level",
                    "role",
                    "traditional_minor_league_rates_and_workload",
                ],
                "excluded": [
                    "prospect_savant_composite_score",
                    "external_prospect_rankings",
                    "fangraphs_board_rank",
                    "fangraphs_scouting_grades",
                ],
                "driverInterpretation": "descriptive_percentiles_not_model_attribution",
            },
            "selectionPolicy": {
                "primaryHorizonMonths": PRIMARY_HORIZON_MONTHS,
                "maximumAgePercentileWithinRoleLevel": MAXIMUM_AGE_PERCENTILE,
                "minimumPrimaryProbability": MINIMUM_PRIMARY_PROBABILITY,
                "minimumPrimaryProbabilityDelta": MINIMUM_PRIMARY_EDGE,
                "minimumBaselineRowsAtEachHorizon": MINIMUM_BASELINE_ROWS,
                "minimumBaselineEventsAtEachHorizon": MINIMUM_BASELINE_EVENTS,
                "minimumHitterPa": MINIMUM_HITTER_PA,
                "minimumPitcherIp": MINIMUM_PITCHER_IP,
            },
            "validation": {
                "status": "external_validation_failed",
                "releaseEligible": False,
                "validatedHorizons": [],
                "longHorizonMonths": LONG_HORIZON_MONTHS,
                "longHorizonValidated": False,
            },
        }


def _edge(probability: float, baseline: float) -> dict[str, Any]:
    lift = None if baseline <= 0.0 else probability / baseline
    return {
        "probability": round(probability, 8),
        "baselineProbability": round(baseline, 8),
        "probabilityDelta": round(probability - baseline, 8),
        "liftMultiple": None if lift is None else round(lift, 4),
    }


def build_milb_alpha_signal(
    feature: Mapping[str, Any],
    *,
    horizons: Sequence[int],
    probabilities: Sequence[float],
    baselines: Sequence[float],
    cold_start: bool,
    as_of: object,
    arrival_status: object,
    reference: MilbAlphaReference,
) -> dict[str, Any]:
    if len(horizons) != len(probabilities) or len(horizons) != len(baselines):
        raise MilbAlphaSignalError("Arrival horizons and probability vectors must align")
    normalized_horizons = tuple(int(value) for value in horizons)
    if len(set(normalized_horizons)) != len(normalized_horizons):
        raise MilbAlphaSignalError("Arrival horizons must be unique")
    try:
        index36 = normalized_horizons.index(PRIMARY_HORIZON_MONTHS)
        index60 = normalized_horizons.index(LONG_HORIZON_MONTHS)
    except ValueError as error:
        raise MilbAlphaSignalError("MiLB alpha requires 36- and 60-month horizons") from error
    candidate = tuple(
        _probability(value, f"candidate probability {horizon}")
        for horizon, value in zip(normalized_horizons, probabilities, strict=True)
    )
    baseline = tuple(
        _probability(value, f"baseline probability {horizon}")
        for horizon, value in zip(normalized_horizons, baselines, strict=True)
    )
    if any(right < left for left, right in zip(candidate, candidate[1:])):
        raise MilbAlphaSignalError("Candidate arrival probabilities must be cumulative")
    if any(right < left for left, right in zip(baseline, baseline[1:])):
        raise MilbAlphaSignalError("Baseline arrival probabilities must be cumulative")
    role = _canonical_role(feature.get("role"))
    level = _canonical_level(feature.get("prior_level"))
    age = _finite_number(feature.get("age"), "age")
    age_context = reference.age_context(role=role, prior_level=level, age=age)
    support = [
        reference.baseline_support(
            role=role,
            prior_level=level,
            age=age,
            horizon_months=horizon,
        )
        for horizon in (PRIMARY_HORIZON_MONTHS, LONG_HORIZON_MONTHS)
    ]
    workload_raw = (
        feature.get("prior_batting_pa")
        if role == "hitter"
        else feature.get("prior_pitching_ip")
    )
    workload_numeric = pd.to_numeric(pd.Series([workload_raw]), errors="coerce").iloc[0]
    workload_available = bool(
        not pd.isna(workload_numeric)
        and math.isfinite(float(workload_numeric))
        and float(workload_numeric) >= 0.0
    )
    workload_value = float(workload_numeric) if workload_available else 0.0
    workload_minimum = MINIMUM_HITTER_PA if role == "hitter" else MINIMUM_PITCHER_IP
    primary = _edge(candidate[index36], baseline[index36])
    long_horizon = _edge(candidate[index60], baseline[index60])
    supported = (
        age_context is not None
        and age_context.players >= MINIMUM_AGE_CONTEXT_PLAYERS
        and all(
            value.rows >= MINIMUM_BASELINE_ROWS
            and value.events >= MINIMUM_BASELINE_EVENTS
            for value in support
        )
    )
    gates = {
        "supportedHistoricalContext": bool(supported),
        "youngForRoleAndLevel": bool(
            age_context is not None
            and age_context.percentile <= MAXIMUM_AGE_PERCENTILE
        ),
        "minimumRawWorkload": workload_available and workload_value >= workload_minimum,
        "minimumPrimaryProbability": candidate[index36] >= MINIMUM_PRIMARY_PROBABILITY,
        "positivePrimaryModelEdge": primary["probabilityDelta"] >= MINIMUM_PRIMARY_EDGE,
        "positiveLongHorizonModelEdge": long_horizon["probabilityDelta"] > 0.0,
    }
    eligible = all(gates.values())
    priority = bool(
        eligible
        and float(primary["probabilityDelta"]) >= PRIORITY_PRIMARY_EDGE
        and age_context is not None
        and age_context.percentile <= PRIORITY_MAXIMUM_AGE_PERCENTILE
    )
    warnings = [
        "research_only",
        "external_validation_failed_no_horizon_validated",
        "frozen_2025_features_not_current_2026",
        "arrival_target_not_hall_ceiling",
        "market_price_not_modeled",
        "probability_interval_not_available",
        "descriptive_drivers_not_model_attribution",
    ]
    if bool(cold_start):
        warnings.append("arrival_cold_start")
    if str(arrival_status) != FAILED_EXTERNAL_VALIDATION_STATUS:
        warnings.append("unexpected_arrival_artifact_status")
        eligible = False
        priority = False
    return {
        "version": MILB_ALPHA_SIGNAL_VERSION,
        "status": "research",
        "releaseEligible": False,
        "target": "first_mlb_arrival_within_36_months",
        "eligible": bool(eligible),
        "tier": "priority" if priority else "watch" if eligible else "none",
        "rank": None,
        "rankScope": "frozen_2025_milb_arrival_alpha" if eligible else None,
        "asOf": None if as_of is None else str(as_of),
        "primaryEdge": {"horizonMonths": PRIMARY_HORIZON_MONTHS, **primary},
        "longHorizonEdge": {
            "horizonMonths": LONG_HORIZON_MONTHS,
            **long_horizon,
            "externallyValidated": False,
        },
        "ageContext": None
        if age_context is None
        else {
            "age": round(age, 2),
            "percentileWithinRoleLevel": round(age_context.percentile, 2),
            "youngerThanPercent": round(100.0 - age_context.percentile, 2),
            "referencePlayers": age_context.players,
            "referenceRows": age_context.rows,
            "role": age_context.role,
            "priorLevel": age_context.prior_level,
            "playerEqualWeighted": True,
        },
        "workload": {
            "kind": "PA" if role == "hitter" else "IP",
            "value": round(workload_value, 2) if workload_available else None,
            "minimum": workload_minimum,
        },
        "baselineSupport": {
            "minimumRows": min(value.rows for value in support),
            "minimumEvents": min(value.events for value in support),
            "horizons": [value.as_dict() for value in support],
            "referenceSeasons": sorted(
                int(value) for value in reference.reference["edition"].unique()
            ),
        },
        "descriptiveDrivers": reference.descriptive_drivers(feature),
        "gates": gates,
        "releaseGates": {
            "externalValidationPassed": False,
            "probabilityCalibrationPassed": False,
            "currentFeatureAlignmentPassed": False,
        },
        "validation": {
            "status": "external_validation_failed",
            "releaseEligible": False,
            "validatedHorizons": [],
            "retrospectiveRankingDiagnosticOnly": [PRIMARY_HORIZON_MONTHS],
        },
        "inputPolicy": "raw_stats_age_level_role_no_composite_score_or_external_rank",
        "warnings": sorted(warnings),
    }


def rank_milb_alpha_signals(estimates: Mapping[str, dict[str, Any]]) -> int:
    eligible = [
        (key, estimate["milbAlphaSignal"])
        for key, estimate in estimates.items()
        if isinstance(estimate.get("milbAlphaSignal"), dict)
        and estimate["milbAlphaSignal"].get("eligible") is True
    ]
    eligible.sort(
        key=lambda item: (
            -float(item[1]["primaryEdge"]["probabilityDelta"]),
            float(item[1]["ageContext"]["percentileWithinRoleLevel"]),
            -float(item[1]["longHorizonEdge"]["probabilityDelta"]),
            str(item[0]),
        )
    )
    for rank, (_, signal) in enumerate(eligible, start=1):
        signal["rank"] = rank
    return len(eligible)


def retrospective_milb_alpha_diagnostic(
    snapshots: pd.DataFrame,
    evaluated_rows: pd.DataFrame,
    reference: MilbAlphaReference,
    *,
    arrival_status: str = FAILED_EXTERNAL_VALIDATION_STATUS,
) -> dict[str, Any]:
    required_predictions = {
        "snapshot_id",
        "player_id",
        "edition",
        "horizon_months",
        "candidate_probability",
        "hierarchical_baseline_probability",
        "outcome",
        "outcome_observed",
        "cold_start",
    }
    missing = sorted(required_predictions - set(evaluated_rows.columns))
    if missing:
        raise MilbAlphaSignalError(f"MiLB alpha diagnostic is missing columns: {missing}")
    feature_columns = sorted(
        set(reference.required_columns)
        | {column for policy in _DRIVER_POLICY.values() for column, _, _ in policy}
        | {"prior_batting_pa", "prior_pitching_ip"}
    )
    missing_features = sorted(set(feature_columns) - set(snapshots.columns))
    if missing_features:
        raise MilbAlphaSignalError(
            f"MiLB alpha diagnostic snapshots are missing columns: {missing_features}"
        )
    prediction = evaluated_rows.loc[
        evaluated_rows["horizon_months"].isin(
            (PRIMARY_HORIZON_MONTHS, LONG_HORIZON_MONTHS)
        )
    ].copy()
    wide = prediction.pivot(
        index="snapshot_id",
        columns="horizon_months",
        values=[
            "candidate_probability",
            "hierarchical_baseline_probability",
            "outcome",
            "outcome_observed",
        ],
    )
    wide.columns = [f"{name}_{int(horizon)}" for name, horizon in wide.columns]
    wide = wide.reset_index()
    metadata = prediction.loc[
        prediction["horizon_months"].eq(PRIMARY_HORIZON_MONTHS),
        ["snapshot_id", "player_id", "edition", "cold_start"],
    ]
    cohort = (
        snapshots[feature_columns]
        .merge(wide, on="snapshot_id", how="inner", validate="one_to_one")
        .merge(
            metadata,
            on=["snapshot_id", "player_id", "edition"],
            how="inner",
            validate="one_to_one",
        )
    )
    cohort = cohort.loc[cohort[f"outcome_observed_{PRIMARY_HORIZON_MONTHS}"].eq(True)]
    cohort = cohort.sort_values(["edition", "snapshot_id"], kind="mergesort")
    cohort = cohort.drop_duplicates("player_id", keep="first")
    records: list[dict[str, Any]] = []
    for row in cohort.to_dict("records"):
        signal = build_milb_alpha_signal(
            row,
            horizons=(PRIMARY_HORIZON_MONTHS, LONG_HORIZON_MONTHS),
            probabilities=(
                row[f"candidate_probability_{PRIMARY_HORIZON_MONTHS}"],
                row[f"candidate_probability_{LONG_HORIZON_MONTHS}"],
            ),
            baselines=(
                row[f"hierarchical_baseline_probability_{PRIMARY_HORIZON_MONTHS}"],
                row[f"hierarchical_baseline_probability_{LONG_HORIZON_MONTHS}"],
            ),
            cold_start=bool(row["cold_start"]),
            as_of=f"{int(row['edition'])}-12-31",
            arrival_status=arrival_status,
            reference=reference,
        )
        records.append(
            {
                "eligible": bool(signal["eligible"]),
                "priority": signal["tier"] == "priority",
                "coldStart": bool(row["cold_start"]),
                "outcome": bool(row[f"outcome_{PRIMARY_HORIZON_MONTHS}"]),
                "delta": float(signal["primaryEdge"]["probabilityDelta"]),
            }
        )
    diagnostic = pd.DataFrame(records)

    def summary(frame: pd.DataFrame, selected: pd.Series) -> dict[str, Any]:
        population_rate = float(frame["outcome"].mean()) if len(frame) else None
        chosen = frame.loc[selected]
        selected_rate = float(chosen["outcome"].mean()) if len(chosen) else None
        lift = (
            None
            if selected_rate is None or population_rate in (None, 0.0)
            else selected_rate / population_rate
        )
        return {
            "players": int(len(frame)),
            "events": int(frame["outcome"].sum()),
            "eventRate": None if population_rate is None else round(population_rate, 8),
            "selectedPlayers": int(len(chosen)),
            "selectedEvents": int(chosen["outcome"].sum()),
            "selectedEventRate": None if selected_rate is None else round(selected_rate, 8),
            "precisionLift": None if lift is None else round(lift, 4),
        }

    all_summary = summary(diagnostic, diagnostic["eligible"])
    cold = diagnostic.loc[diagnostic["coldStart"]]
    cold_summary = summary(cold, cold["eligible"])
    priority = diagnostic.loc[diagnostic["priority"]]
    return {
        "status": "retrospective_development_diagnostic_not_validation",
        "releaseEligible": False,
        "horizonMonths": PRIMARY_HORIZON_MONTHS,
        "snapshotPolicy": "earliest_observed_36_month_external_snapshot_per_player",
        "externalValidationStatus": "failed",
        "validatedHorizons": [],
        "allPlayers": all_summary,
        "coldStartPlayers": cold_summary,
        "priorityTier": {
            "players": int(len(priority)),
            "events": int(priority["outcome"].sum()),
            "eventRate": None
            if priority.empty
            else round(float(priority["outcome"].mean()), 8),
        },
        "limitations": [
            "Thresholds were human-reviewed after retrospective results existed.",
            "The diagnostic is not prospective and is not a passed validation gate.",
            "Returning players can overlap the pre-2020 training population; cold-start results are reported separately.",
            "The 60-month horizon has no mature post-2020 external evaluation cohort.",
            "The target is MLB arrival, not Hall-caliber career outcome or investment return.",
        ],
    }
