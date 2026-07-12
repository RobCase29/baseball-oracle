from __future__ import annotations

import copy

import numpy as np
import pandas as pd
import pytest

from modeling.arrival_hazard_baseline import (
    PRIOR_STRENGTH,
    ArrivalHazardBaselineError,
    ArrivalHazardBaselineModel,
    fit_hazard_baseline,
)
from modeling.contracts import SURVIVAL_HORIZON_MONTHS


def _period_rows(
    snapshot_id: str,
    role: str,
    prior_level: str | None,
    age: float,
    intervals: int,
    event_interval: int | None = None,
    sample_weight: float = 1.0,
) -> list[dict[str, object]]:
    return [
        {
            "snapshot_id": snapshot_id,
            "role": role,
            "prior_level": prior_level,
            "age": age,
            "interval": interval,
            "event": int(interval == event_interval),
            "sample_weight": sample_weight,
        }
        for interval in range(1, intervals + 1)
    ]


def _training_periods() -> pd.DataFrame:
    return pd.DataFrame(
        _period_rows("h1", "hitter", "AAA", 22, 1, 1, 2.0)
        + _period_rows("h2", "hitter", "AAA", 22, 5, sample_weight=0.5)
        + _period_rows("h3", "hitter", "A", 20, 2, 2, 0.5)
        + _period_rows("p1", "pitcher", "AA", 24, 3, 3, 1.0)
        + _period_rows("p2", "pitcher", "AAA", 25, 5, sample_weight=1.0)
        + _period_rows("p3", "pitcher", None, 42, 1, 1, 3.0)
    )


def _scoring_snapshots() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "snapshot_id": "known-detail",
                "role": "hitter",
                "prior_level": "AAA",
                "age": 22,
            },
            {
                "snapshot_id": "known-level",
                "role": "hitter",
                "prior_level": "AAA",
                "age": 30,
            },
            {
                "snapshot_id": "role-only",
                "role": "hitter",
                "prior_level": "Rk",
                "age": 18,
            },
            {
                "snapshot_id": "pitcher",
                "role": "pitcher",
                "prior_level": "AA",
                "age": 24,
            },
        ]
    )


def test_fit_uses_at_risk_rows_and_hierarchical_annual_shrinkage() -> None:
    model = fit_hazard_baseline(_training_periods())

    assert model.horizons_months == SURVIVAL_HORIZON_MONTHS
    first = model.intervals[0]
    second = model.intervals[1]
    assert (first.global_estimate.rows, first.global_estimate.events) == (6, 2)
    assert (second.global_estimate.rows, second.global_estimate.events) == (4, 1)
    assert first.global_estimate.weighted_exposure == 8.0
    assert first.global_estimate.weighted_events == 5.0
    assert second.global_estimate.weighted_exposure == 3.0
    assert second.global_estimate.weighted_events == 0.5

    global_rate = 5 / 8
    hitter = next(group for group in first.role_hazards if group.role == "hitter")
    expected_hitter = (2 + PRIOR_STRENGTH * global_rate) / (3 + PRIOR_STRENGTH)
    assert hitter.estimate.rate == expected_hitter

    hitter_aaa = next(
        group
        for group in first.role_level_hazards
        if (group.role, group.prior_level) == ("hitter", "AAA")
    )
    expected_level = (2 + PRIOR_STRENGTH * expected_hitter) / (2.5 + PRIOR_STRENGTH)
    assert hitter_aaa.estimate.rate == expected_level

    detail = next(
        group
        for group in first.detailed_hazards
        if (group.role, group.prior_level, group.age_band)
        == ("hitter", "AAA", "22-23")
    )
    expected_detail = (2 + PRIOR_STRENGTH * expected_level) / (2.5 + PRIOR_STRENGTH)
    assert detail.estimate.rate == expected_detail


def test_predictions_follow_declared_fallbacks_and_compound_hazards() -> None:
    model = fit_hazard_baseline(_training_periods())
    snapshots = _scoring_snapshots()

    hazards = model.predict_interval_hazards(snapshots)
    cumulative = model.predict_cumulative(snapshots)
    first = model.intervals[0]
    role_rate = next(
        group.estimate.rate for group in first.role_hazards if group.role == "hitter"
    )
    level_rate = next(
        group.estimate.rate
        for group in first.role_level_hazards
        if (group.role, group.prior_level) == ("hitter", "AAA")
    )
    detailed_rate = next(
        group.estimate.rate
        for group in first.detailed_hazards
        if (group.role, group.prior_level, group.age_band)
        == ("hitter", "AAA", "22-23")
    )

    assert hazards[12][0] == detailed_rate
    assert hazards[12][1] == level_rate
    assert hazards[12][2] == role_rate
    for position in range(len(snapshots)):
        survival = 1.0
        for horizon in SURVIVAL_HORIZON_MONTHS:
            survival *= 1.0 - hazards[horizon][position]
            assert cumulative[horizon][position] == pytest.approx(1.0 - survival)
    matrix = np.column_stack([cumulative[horizon] for horizon in SURVIVAL_HORIZON_MONTHS])
    assert np.all(np.diff(matrix, axis=1) >= 0.0)
    assert np.all((matrix >= 0.0) & (matrix <= 1.0))


def test_fit_and_portable_json_are_deterministic_and_bit_exact() -> None:
    periods = _training_periods()
    first = fit_hazard_baseline(periods)
    second = fit_hazard_baseline(periods.sample(frac=1.0, random_state=83))

    assert first.to_json() == second.to_json()
    restored = ArrivalHazardBaselineModel.from_json(first.to_json())
    assert restored.to_json() == first.to_json()
    original_predictions = first.predict_cumulative(_scoring_snapshots())
    restored_predictions = restored.predict_cumulative(_scoring_snapshots())
    for horizon in SURVIVAL_HORIZON_MONTHS:
        assert np.array_equal(original_predictions[horizon], restored_predictions[horizon])


def test_portable_model_rejects_rate_support_and_contract_tampering() -> None:
    model = fit_hazard_baseline(_training_periods())
    portable = model.to_portable_dict()

    bad_rate = copy.deepcopy(portable)
    bad_rate["intervals"][0]["role"][0]["rate_hex"] = float(0.99).hex()
    with pytest.raises(ArrivalHazardBaselineError, match="does not match"):
        ArrivalHazardBaselineModel.from_portable_dict(bad_rate)

    bad_support = copy.deepcopy(portable)
    bad_support["intervals"][0]["role"][0]["rows"] += 1
    with pytest.raises(ArrivalHazardBaselineError, match="support does not reconcile"):
        ArrivalHazardBaselineModel.from_portable_dict(bad_support)

    bad_weighted_support = copy.deepcopy(portable)
    bad_weighted_support["intervals"][0]["role"][0][
        "weighted_exposure_hex"
    ] = float(4.0).hex()
    with pytest.raises(ArrivalHazardBaselineError, match="weighted support"):
        ArrivalHazardBaselineModel.from_portable_dict(bad_weighted_support)

    bad_prior = copy.deepcopy(portable)
    bad_prior["prior_strength_hex"] = float(25).hex()
    with pytest.raises(ArrivalHazardBaselineError, match="prior strength"):
        ArrivalHazardBaselineModel.from_portable_dict(bad_prior)

    extra_field = copy.deepcopy(portable)
    extra_field["unexpected"] = True
    with pytest.raises(ArrivalHazardBaselineError, match="fields are invalid"):
        ArrivalHazardBaselineModel.from_portable_dict(extra_field)

    with pytest.raises(ArrivalHazardBaselineError, match="invalid constant"):
        ArrivalHazardBaselineModel.from_json('{"value":NaN}')
    with pytest.raises(ArrivalHazardBaselineError, match="duplicate field"):
        ArrivalHazardBaselineModel.from_json('{"schema_version":"a","schema_version":"b"}')

    noncanonical_hex = copy.deepcopy(portable)
    noncanonical_hex["intervals"][0]["global"]["rate_hex"] = "0.5555555555555p-1"
    with pytest.raises(ArrivalHazardBaselineError, match="canonical hexadecimal"):
        ArrivalHazardBaselineModel.from_portable_dict(noncanonical_hex)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda frame: frame.assign(
                role=np.where(frame["snapshot_id"] == "h1", "fielder", frame["role"])
            ),
            "Unsupported role",
        ),
        (
            lambda frame: frame.assign(
                age=np.where(frame["snapshot_id"] == "h1", np.inf, frame["age"])
            ),
            "finite positive",
        ),
        (
            lambda frame: frame.assign(
                event=np.where(
                    (frame["snapshot_id"] == "h2") & (frame["interval"] == 1),
                    2,
                    frame["event"],
                )
            ),
            "binary",
        ),
    ],
)
def test_fit_rejects_invalid_roles_finite_values_and_rates(mutate, message: str) -> None:
    with pytest.raises(ArrivalHazardBaselineError, match=message):
        fit_hazard_baseline(mutate(_training_periods()))


def test_fit_rejects_rows_that_are_not_valid_person_period_sequences() -> None:
    periods = _training_periods()
    missing_middle = periods[
        ~((periods["snapshot_id"] == "h2") & (periods["interval"] == 2))
    ]
    with pytest.raises(ArrivalHazardBaselineError, match="noncontiguous"):
        fit_hazard_baseline(missing_middle)

    event_before_end = periods.copy()
    event_before_end.loc[
        (event_before_end["snapshot_id"] == "h2")
        & (event_before_end["interval"] == 2),
        "event",
    ] = 1
    with pytest.raises(ArrivalHazardBaselineError, match="terminal event"):
        fit_hazard_baseline(event_before_end)

    duplicate = pd.concat([periods, periods.iloc[[0]]], ignore_index=True)
    with pytest.raises(ArrivalHazardBaselineError, match="Duplicate"):
        fit_hazard_baseline(duplicate)


def test_fit_requires_positive_finite_explicit_weights_and_supports_named_column() -> None:
    periods = _training_periods()
    with pytest.raises(ArrivalHazardBaselineError, match="Missing person-period columns"):
        fit_hazard_baseline(periods.drop(columns="sample_weight"))

    for invalid in (0.0, -1.0, np.inf, np.nan):
        invalid_weights = periods.copy()
        invalid_weights.loc[invalid_weights.index[0], "sample_weight"] = invalid
        with pytest.raises(ArrivalHazardBaselineError, match="finite and positive"):
            fit_hazard_baseline(invalid_weights)

    renamed = periods.rename(columns={"sample_weight": "candidate_weight"})
    model = fit_hazard_baseline(renamed, weight_column="candidate_weight")
    assert model.weight_column == "candidate_weight"
    assert model.to_portable_dict()["weight_column"] == "candidate_weight"


def test_scoring_fails_closed_for_unsupported_horizons_and_role_intervals() -> None:
    short_periods = _training_periods().loc[
        _training_periods()["interval"] <= 2
    ].copy()
    short_model = fit_hazard_baseline(short_periods)
    with pytest.raises(ArrivalHazardBaselineError, match="lack fitted interval support"):
        short_model.predict_cumulative(_scoring_snapshots(), [60])
    with pytest.raises(ArrivalHazardBaselineError, match="Unsupported horizons"):
        short_model.predict_cumulative(_scoring_snapshots(), [72])

    role_limited = pd.DataFrame(
        _period_rows("hitter", "hitter", "AAA", 22, 1)
        + _period_rows("pitcher", "pitcher", "AAA", 22, 2)
    )
    role_limited_model = fit_hazard_baseline(role_limited)
    hitter = pd.DataFrame(
        [
            {
                "snapshot_id": "future-hitter",
                "role": "hitter",
                "prior_level": "AAA",
                "age": 22,
            }
        ]
    )
    with pytest.raises(ArrivalHazardBaselineError, match="lacks fitted support"):
        role_limited_model.predict_cumulative(hitter, [24])


def test_scoring_rejects_invalid_snapshot_identity_role_age_and_horizons() -> None:
    model = fit_hazard_baseline(_training_periods())
    snapshots = _scoring_snapshots()

    duplicate = pd.concat([snapshots, snapshots.iloc[[0]]], ignore_index=True)
    with pytest.raises(ArrivalHazardBaselineError, match="must be unique"):
        model.predict_cumulative(duplicate)

    unsupported_role = snapshots.copy()
    unsupported_role.loc[0, "role"] = "two-way"
    with pytest.raises(ArrivalHazardBaselineError, match="Unsupported role"):
        model.predict_cumulative(unsupported_role)

    nonfinite_age = snapshots.copy()
    nonfinite_age["age"] = nonfinite_age["age"].astype(float)
    nonfinite_age.loc[0, "age"] = np.inf
    with pytest.raises(ArrivalHazardBaselineError, match="finite positive"):
        model.predict_cumulative(nonfinite_age)

    missing_age = snapshots.copy()
    missing_age["age"] = missing_age["age"].astype(float)
    missing_age.loc[0, "age"] = np.nan
    predictions = model.predict_cumulative(missing_age, [12])
    assert np.isfinite(predictions[12]).all()

    with pytest.raises(ArrivalHazardBaselineError, match="strictly increasing"):
        model.predict_cumulative(snapshots, [24, 12])
