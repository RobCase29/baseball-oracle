#!/usr/bin/env python3
"""Export the frozen 2025 arrival estimates for the research-only product preview."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS = ROOT / "artifacts/arrival-external-v1-amendment-001/predictions.parquet"
SNAPSHOTS = ROOT / "data/processed/arrival-external-v1/snapshots.parquet"
PREDICTION_MANIFEST = ROOT / "artifacts/arrival-external-v1-amendment-001/prediction_manifest.json"
EVALUATION_REPORT = ROOT / "artifacts/arrival-external-v1-amendment-001/evaluation_report.json"
LOCK = ROOT / "data/model-locks/arrival-post-pandemic-v1-amendment-001.json"
OUTPUT = ROOT / "api/_data/research-arrival-2025.json"
STATUS_OUTPUT = ROOT / "api/_data/model-status.json"
HORIZONS = (12, 24, 36, 48, 60)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def compact_probability(value: object) -> float:
    return round(float(value), 8)


def main() -> None:
    prediction_manifest = read_json(PREDICTION_MANIFEST)
    evaluation = read_json(EVALUATION_REPORT)
    lock = read_json(LOCK)
    predictions = pd.read_parquet(PREDICTIONS)
    snapshots = pd.read_parquet(SNAPSHOTS)

    prediction_sha = prediction_manifest.get("output", {}).get("sha256")
    if prediction_sha != "8dda7eb4fe18841c2ac24960d0e225f3498c3f4f5ea4a6c8d76f2dc34fb443b2":
        raise ValueError("The frozen prediction artifact digest changed")
    if evaluation.get("status") != "external_validation_fail_not_release_eligible":
        raise ValueError("Research preview requires the frozen non-release evaluation status")

    cohort = snapshots.loc[
        snapshots["edition"].eq(2025),
        ["snapshot_id", "mlbam_id", "role", "prior_level", "age"],
    ].copy()
    cohort["mlbam_id"] = cohort["mlbam_id"].astype("string")
    cohort = cohort.loc[cohort["mlbam_id"].notna()]
    if cohort["snapshot_id"].duplicated().any() or cohort["mlbam_id"].duplicated().any():
        raise ValueError("The 2025 export requires unique snapshots and MLBAM identifiers")

    rows = predictions.loc[predictions["edition"].eq(2025)].merge(
        cohort,
        on=["snapshot_id", "role", "prior_level", "age"],
        how="inner",
        validate="many_to_one",
    )
    if rows["score_outcome"].any() or not rows["evaluation_mode"].eq("prediction_only").all():
        raise ValueError("The 2025 preview must remain prediction-only")
    if set(rows["horizon_months"].unique()) != set(HORIZONS):
        raise ValueError("The 2025 preview horizons changed")

    estimates: dict[str, Any] = {}
    for snapshot_id, group in rows.groupby("snapshot_id", sort=True):
        ordered = group.sort_values("horizon_months")
        first = ordered.iloc[0]
        key = f"{first['mlbam_id']}:{first['role']}"
        estimates[key] = {
            "snapshotId": snapshot_id,
            "coldStart": bool(first["cold_start"]),
            "priorLevel": str(first["prior_level"]),
            "age": round(float(first["age"]), 2),
            "probabilities": [compact_probability(value) for value in ordered["candidate_probability"]],
            "baselines": [
                compact_probability(value)
                for value in ordered["hierarchical_baseline_probability"]
            ],
        }

    preview = {
        "schemaVersion": "research-arrival-preview/v1",
        "status": "external_validation_failed_research_only",
        "releaseEligible": False,
        "asOf": "2025-12-31T00:00:00.000Z",
        "horizons": list(HORIZONS),
        "rows": len(estimates),
        "lockSha256": lock.get("lock_sha256"),
        "predictionManifestSha256": prediction_manifest.get("manifest_sha256"),
        "predictionTableSha256": prediction_sha,
        "evaluationReportSha256": evaluation.get("report_sha256"),
        "estimates": estimates,
    }

    validation = evaluation.get("validation", {})
    gates = validation.get("promotion_adjudication", {})
    cells = validation.get("role_horizon_diagnostics", [])
    baseline_key = "censoring_aware_hierarchical_empirical_bayes_annual_hazard"
    status = {
        "schemaVersion": "model-status/v1",
        "generatedFrom": evaluation.get("report_sha256"),
        "status": evaluation.get("status"),
        "releaseEligible": False,
        "asOf": preview["asOf"],
        "coverage": {
            "externalSnapshots": 33559,
            "externalPlayers": 13976,
            "predictionOnly2025": len(estimates),
            "predictionRows": prediction_manifest.get("output", {}).get("rows"),
        },
        "headline": {
            "sufficientCells": 8,
            "positiveBrierCells": 8,
            "pairedBrierImprovement": 0.0152686,
            "pairedBrierLow": 0.0132979,
            "pairedBrierHigh": 0.0172709,
            "ecePassedCells": 5,
            "eceRequiredCells": 6,
        },
        "failedReasons": gates.get("failed_reasons", []),
        "cells": [
            {
                "role": cell.get("role"),
                "horizonMonths": cell.get("horizon_months"),
                "rows": cell.get("rows"),
                "events": cell.get("events"),
                "candidateBrier": cell.get("candidate", {}).get("brier"),
                "baselineBrier": cell.get("baselines", {}).get(baseline_key, {}).get("brier"),
                "ece": cell.get("candidate", {}).get("expected_calibration_error"),
                "calibrationSlope": cell.get("candidate", {}).get("calibration_slope"),
                "observedExpected": cell.get("candidate", {}).get("observed_to_expected_ratio"),
            }
            for cell in cells
            if cell.get("status") == "gateable"
        ],
        "disclosures": [
            "Retrospective research evaluation; not a prospective release.",
            "Population-shift admission and pooled ECE cell-fraction gates failed.",
            "The 60-month external horizon is not mature.",
            "2025 estimates are frozen prediction-only outputs and do not include 2026 evidence or current MLB status.",
        ],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(preview, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    STATUS_OUTPUT.write_text(json.dumps(status, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    print(f"Exported {len(estimates):,} frozen research estimates")


if __name__ == "__main__":
    main()
