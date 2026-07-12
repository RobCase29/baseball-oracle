from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from modeling.arrival_calibration import (
    ArrivalCalibrationError,
    ArrivalCalibrationModel,
    HorizonCalibrator,
    apply_calibration,
    deserialize_calibration_model,
    fit_oof_calibrators,
    project_horizon_probabilities,
    serialize_calibration_model,
    validate_horizon_vector,
    weighted_pava,
)


HORIZONS = (12, 24, 36)


def _oof_rows() -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    # Every horizon and cold-start stratum has both outcomes. Snapshot IDs are
    # deliberately reusable across horizons because that is the prediction key.
    examples = [
        ("return-0a", False, 0, 0.12),
        ("return-0b", False, 0, 0.28),
        ("return-1a", False, 1, 0.58),
        ("return-1b", False, 1, 0.82),
        ("cold-0a", True, 0, 0.18),
        ("cold-0b", True, 0, 0.33),
        ("cold-1a", True, 1, 0.63),
        ("cold-1b", True, 1, 0.88),
    ]
    for horizon_index, horizon in enumerate(HORIZONS):
        for snapshot_id, cold_start, outcome, probability in examples:
            rows.append(
                {
                    "snapshot_id": snapshot_id,
                    "horizon_months": horizon,
                    "probability": min(probability + 0.03 * horizon_index, 0.99),
                    "outcome": outcome,
                    "cold_start": cold_start,
                    "sample_weight": 1.0 + 0.25 * horizon_index,
                    "is_oof": True,
                }
            )
    return pd.DataFrame(rows)


def _calibrator(horizon: int, alpha: float, training_weight: float = 8.0) -> HorizonCalibrator:
    return HorizonCalibrator(
        horizon_months=horizon,
        alpha=alpha,
        beta=1.0,
        gamma=0.0,
        training_rows=8,
        training_events=4,
        training_weight=training_weight,
        returning_rows=4,
        returning_events=2,
        cold_start_rows=4,
        cold_start_events=2,
    )


def test_weighted_pava_is_true_least_squares_projection_not_cumulative_max() -> None:
    projected = weighted_pava([0.8, 0.2, 0.7], [1.0, 3.0, 1.0])

    np.testing.assert_allclose(projected, [0.35, 0.35, 0.7])
    assert np.all(np.diff(projected) >= 0.0)
    assert projected.tolist() != [0.8, 0.8, 0.8]


def test_fit_is_constrained_deterministic_and_only_records_supplied_oof_rows() -> None:
    rows = _oof_rows()

    first = fit_oof_calibrators(rows, HORIZONS)
    shuffled = fit_oof_calibrators(rows.sample(frac=1.0, random_state=91), HORIZONS)

    assert first.horizons_months == HORIZONS
    assert all(calibrator.beta >= 0.0 for calibrator in first.calibrators)
    assert all(calibrator.training_rows == 8 for calibrator in first.calibrators)
    assert all(calibrator.returning_events == 2 for calibrator in first.calibrators)
    assert serialize_calibration_model(first) == serialize_calibration_model(shuffled)
    assert '"fit_source":"provided_oof_rows_only"' in serialize_calibration_model(first)


def test_portable_serialization_is_canonical_exact_and_round_trips() -> None:
    model = fit_oof_calibrators(_oof_rows(), HORIZONS)

    first = serialize_calibration_model(model)
    second = serialize_calibration_model(model)
    restored = deserialize_calibration_model(first)

    assert first == second
    assert first.endswith("\n")
    assert "alpha_hex" in first
    assert serialize_calibration_model(restored) == first
    assert restored == model


def test_application_projects_each_complete_snapshot_to_monotone_probabilities() -> None:
    model = ArrivalCalibrationModel(
        horizons_months=HORIZONS,
        calibrators=(
            _calibrator(12, 2.0, 1.0),
            _calibrator(24, -2.0, 3.0),
            _calibrator(36, 0.0, 1.0),
        ),
    )
    predictions = pd.DataFrame(
        [
            {
                "snapshot_id": snapshot,
                "horizon_months": horizon,
                "probability": 0.5,
                "cold_start": cold,
            }
            for snapshot, cold in (("a", False), ("b", True))
            for horizon in reversed(HORIZONS)
        ]
    )

    calibrated = apply_calibration(predictions, model)

    assert calibrated.index.equals(predictions.index)
    assert calibrated["calibrated_probability"].between(0.0, 1.0).all()
    for _, rows in calibrated.sort_values("horizon_months").groupby("snapshot_id"):
        assert np.all(np.diff(rows["calibrated_probability"]) >= 0.0)
    # The 12/24-month violation is pooled to a weighted average, not raised to
    # the 12-month probability as a cumulative maximum would do.
    first = calibrated[calibrated["snapshot_id"] == "a"].sort_values("horizon_months")
    assert first.iloc[0]["calibrated_probability"] < first.iloc[0][
        "calibrated_probability_unprojected"
    ]


@pytest.mark.parametrize(
    "mutate, message",
    [
        (
            lambda rows: pd.concat([rows, rows.iloc[[0]]], ignore_index=True),
            "Duplicate snapshot_id",
        ),
        (
            lambda rows: rows.assign(
                probability=np.where(rows.index == 0, np.nan, rows["probability"])
            ),
            "must be finite",
        ),
        (
            lambda rows: rows.assign(is_oof=np.where(rows.index == 0, False, True)),
            "not marked OOF",
        ),
    ],
)
def test_fit_fails_closed_on_duplicate_nonfinite_or_non_oof_rows(
    mutate, message: str
) -> None:
    with pytest.raises(ArrivalCalibrationError, match=message):
        fit_oof_calibrators(mutate(_oof_rows()), HORIZONS)


def test_fit_fails_when_any_horizon_stratum_lacks_outcome_support() -> None:
    rows = _oof_rows()
    unsupported = (rows["horizon_months"] == 24) & rows["cold_start"]
    rows.loc[unsupported, "outcome"] = 1

    with pytest.raises(
        ArrivalCalibrationError, match="Horizon 24 cold_start stratum lacks both outcome"
    ):
        fit_oof_calibrators(rows, HORIZONS)


def test_negative_or_nonfinite_serialized_coefficients_are_rejected() -> None:
    model = fit_oof_calibrators(_oof_rows(), HORIZONS)
    negative = model.to_portable_dict()
    negative["calibrators"][0]["beta_hex"] = (-0.1).hex()
    nonfinite = model.to_portable_dict()
    nonfinite["calibrators"][0]["alpha_hex"] = "nan"

    with pytest.raises(ArrivalCalibrationError, match="cannot be negative"):
        deserialize_calibration_model(json.dumps(negative))
    with pytest.raises(ArrivalCalibrationError, match="must be finite"):
        deserialize_calibration_model(json.dumps(nonfinite))


@pytest.mark.parametrize(
    "horizons",
    [(), (12, 12), (24, 12), (0, 12), (12.0, 24), (True, 24), "12,24"],
)
def test_invalid_horizon_vectors_are_rejected(horizons) -> None:
    with pytest.raises(ArrivalCalibrationError):
        validate_horizon_vector(horizons)


def test_projection_rejects_nonfinite_values_bad_weights_and_mismatched_vectors() -> None:
    with pytest.raises(ArrivalCalibrationError, match="finite"):
        weighted_pava([0.2, np.inf], [1.0, 1.0])
    with pytest.raises(ArrivalCalibrationError, match="positive"):
        weighted_pava([0.2, 0.4], [1.0, 0.0])
    with pytest.raises(ArrivalCalibrationError, match="equal length"):
        project_horizon_probabilities([0.2], [12, 24], [1.0, 1.0])


def test_application_rejects_duplicate_or_incomplete_snapshot_horizon_vectors() -> None:
    model = fit_oof_calibrators(_oof_rows(), HORIZONS)
    complete = pd.DataFrame(
        [
            {
                "snapshot_id": "prediction-1",
                "horizon_months": horizon,
                "probability": 0.3,
                "cold_start": True,
            }
            for horizon in HORIZONS
        ]
    )
    duplicate = pd.concat([complete, complete.iloc[[0]]], ignore_index=True)
    incomplete = complete.iloc[:-1].copy()

    with pytest.raises(ArrivalCalibrationError, match="Duplicate snapshot_id"):
        apply_calibration(duplicate, model)
    with pytest.raises(ArrivalCalibrationError, match="horizon"):
        apply_calibration(incomplete, model)
