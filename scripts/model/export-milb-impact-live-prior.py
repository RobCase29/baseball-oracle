#!/usr/bin/env python3
"""Export the fitted MiLB impact prior and a frozen rank reference for runtime use."""

from __future__ import annotations

import json
import math
from pathlib import Path
import sys
from typing import Any

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modeling.milb_impact_tournament import (  # noqa: E402
    BASELINE_MODEL_NAME,
    MODEL_VERSION,
    AgeLevelRolePerformancePrior,
    _performance_signal,
)
from modeling.provenance import file_sha256  # noqa: E402


ARTIFACT_DIR = ROOT / "artifacts/milb-impact-v1"
MODEL_PATH = ARTIFACT_DIR / "model.joblib"
RUN_MANIFEST_PATH = ARTIFACT_DIR / "run_manifest.json"
CURRENT_SCORES_PATH = ARTIFACT_DIR / "current_scores.parquet"
CURRENT_SNAPSHOTS_PATH = (
    ROOT / "data/processed/model-v1-bref-2025/affiliated_risk_set_snapshots.parquet"
)
OUTPUT_PATH = ROOT / "api/_data/milb-impact-live-prior.json"

EXPECTED_SELECTED_MODEL = "regularized_logistic"
EXPECTED_FEATURE_SEASON = 2025
EXPECTED_TARGET = "mlb_war_next_5_ge_5"


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def _finite_or_none(value: object) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _rate_rows(model: AgeLevelRolePerformancePrior) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for columns, rates in model.levels_:
        rows.append(
            {
                "columns": list(columns),
                "rates": [
                    {"key": list(key), "probability": float(probability)}
                    for key, probability in sorted(rates.items())
                ],
            }
        )
    return rows


def main() -> None:
    manifest = _read_json(RUN_MANIFEST_PATH)
    if manifest.get("modelVersion") != MODEL_VERSION:
        raise ValueError("MiLB impact model version changed")
    if manifest.get("selectedModel") != EXPECTED_SELECTED_MODEL:
        raise ValueError("MiLB impact selected model changed")
    if manifest.get("primaryTarget", {}).get("column") != EXPECTED_TARGET:
        raise ValueError("MiLB impact target changed")
    current = manifest.get("currentScoring", {})
    if current.get("featureSeason") != EXPECTED_FEATURE_SEASON:
        raise ValueError("MiLB impact frozen feature season changed")
    expected_scores_hash = manifest.get("outputs", {}).get("currentScores", {}).get("sha256")
    if expected_scores_hash != file_sha256(CURRENT_SCORES_PATH):
        raise ValueError("MiLB impact current-score artifact differs from its manifest")

    bundle = joblib.load(MODEL_PATH)
    if bundle.get("modelVersion") != MODEL_VERSION:
        raise ValueError("MiLB impact model bundle version changed")
    prior = bundle.get("models", {}).get(BASELINE_MODEL_NAME)
    if not isinstance(prior, AgeLevelRolePerformancePrior):
        raise ValueError("MiLB impact fitted hierarchical prior is unavailable")

    scores = pd.read_parquet(CURRENT_SCORES_PATH)
    snapshots = pd.read_parquet(CURRENT_SNAPSHOTS_PATH)
    reference = scores[
        [
            "snapshot_id",
            "mlbam_id",
            "role",
            "age",
            f"probability__{BASELINE_MODEL_NAME}",
        ]
    ].merge(
        snapshots[["snapshot_id", "prior_iso", "prior_bb_rate", "prior_k_rate", "prior_k_minus_bb_rate"]],
        on="snapshot_id",
        how="left",
        validate="one_to_one",
    )
    if len(reference) != int(current.get("rows", -1)) or reference["mlbam_id"].isna().any():
        raise ValueError("MiLB impact live-prior reference universe is incomplete")
    reference["performance_signal"] = _performance_signal(reference)
    prior_column = f"probability__{BASELINE_MODEL_NAME}"
    reference = reference.sort_values(
        [prior_column, "performance_signal", "age", "mlbam_id"],
        ascending=[False, False, True, True],
        na_position="last",
        kind="stable",
    ).reset_index(drop=True)

    identities = set[str]()
    reference_rows: list[dict[str, Any]] = []
    for row in reference.itertuples(index=False):
        mlbam_id = str(row.mlbam_id)
        role = str(row.role)
        identity = f"{mlbam_id}:{role}"
        if not mlbam_id.isdigit() or role not in {"hitter", "pitcher"}:
            raise ValueError(f"Invalid MiLB impact reference identity: {identity}")
        if identity in identities:
            raise ValueError(f"Duplicate MiLB impact reference identity: {identity}")
        identities.add(identity)
        reference_rows.append(
            {
                "mlbamId": mlbam_id,
                "role": role,
                "age": _finite_or_none(row.age),
                "priorProbability": float(getattr(row, prior_column)),
                "performanceSignal": _finite_or_none(row.performance_signal),
            }
        )

    output = {
        "schemaVersion": "milb-impact-live-prior-runtime/v1",
        "status": "research_only",
        "releaseEligible": False,
        "modelVersion": MODEL_VERSION,
        "priorModel": BASELINE_MODEL_NAME,
        "sourceFeatureSeason": EXPECTED_FEATURE_SEASON,
        "sourceFeatureAsOf": "2025-12-31T00:00:00.000Z",
        "sourceModelSha256": file_sha256(MODEL_PATH),
        "sourceScoresSha256": file_sha256(CURRENT_SCORES_PATH),
        "target": {
            "id": EXPECTED_TARGET,
            "label": "At least 5 total MLB WAR in the next five full calendar seasons",
            "scope": "unconditional",
        },
        "inputPolicy": {
            "identity": "exact_mlbam_and_role",
            "eligibility": "official_current_milb_stat_row",
            "levelMap": {
                "AAA": "AAA",
                "AA": "AA",
                "A+": "Adv A",
                "A": "A",
                "RkDomestic": "Rookie",
                "RkDsl": "Foreign Rookie",
            },
            "hitterPerformance": "iso_plus_bb_rate_minus_k_rate",
            "pitcherPerformance": "k_minus_bb_rate",
            "partialSeasonPolicy": "numeric_rank_with_explicit_high_volatility",
            "rankReference": (
                "frozen_prior_probability_then_continuous_prior_performance_signal_"
                "then_age_then_exact_mlbam"
            ),
        },
        "fittedPrior": {
            "smoothing": float(prior.smoothing),
            "globalProbability": float(prior.global_rate_),
            "performanceEdges": {
                role: [float(value) for value in edges]
                for role, edges in sorted(prior.performance_edges_.items())
            },
            "hierarchy": _rate_rows(prior),
        },
        "referenceUniverse": {
            "rows": len(reference_rows),
            "featureSeason": EXPECTED_FEATURE_SEASON,
            "ordering": [
                "prior_probability_desc",
                "performance_signal_desc_nulls_last",
                "age_asc_nulls_last",
                "mlbam_id_asc",
            ],
            "entries": reference_rows,
        },
        "warnings": [
            "In-season early estimates are high-volatility research ranks.",
            "The fitted prior was evaluated on completed-season landmarks, not partial-season landmarks.",
            "Raw probabilities are internal ordering values and must not be published as calibrated confidence.",
            "This estimate does not replace the completed-season full-model rank when one exists.",
        ],
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"Exported fitted MiLB impact prior with {len(reference_rows):,} frozen reference rows"
    )


if __name__ == "__main__":
    main()
