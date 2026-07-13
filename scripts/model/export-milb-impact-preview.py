#!/usr/bin/env python3
"""Export a compact, probability-free view of the frozen MiLB impact ranking."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modeling.provenance import file_sha256

ARTIFACT_DIR = ROOT / "artifacts/milb-impact-v1"
MANIFEST = ARTIFACT_DIR / "run_manifest.json"
CURRENT_SCORES = ARTIFACT_DIR / "current_scores.parquet"
OUTPUT = ROOT / "api/_data/milb-impact-2025.json"

EXPECTED_SCHEMA = "milb-impact-tournament/v1"
EXPECTED_MODEL_VERSION = "milb-impact-five-calendar-year-war-v1"
EXPECTED_MODEL = "regularized_logistic"
EXPECTED_TARGET_COLUMN = "mlb_war_next_5_ge_5"
EXPECTED_TARGET_SCOPE = "unconditional_mlb_war_next_five_calendar_seasons_ge_5"
EXPECTED_FEATURE_SEASON = 2025
EXPECTED_WINDOW = (2026, 2030)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def compact_metric(value: object) -> float:
    return round(float(value), 8)


def rank_percentile(rank: int, rows: int) -> float:
    if rows <= 1:
        return 100.0
    return round(100.0 * (rows - rank) / (rows - 1), 6)


def iso_utc(value: object) -> str:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def require_manifest_contract(manifest: dict[str, Any]) -> None:
    if manifest.get("schemaVersion") != EXPECTED_SCHEMA:
        raise ValueError("MiLB impact manifest schema changed")
    if manifest.get("modelVersion") != EXPECTED_MODEL_VERSION:
        raise ValueError("MiLB impact model version changed")
    if manifest.get("selectedModel") != EXPECTED_MODEL:
        raise ValueError("MiLB impact selected model changed")
    if manifest.get("status") != "research_only" or manifest.get("releaseEligible") is not False:
        raise ValueError("MiLB impact export requires a research-only, non-release run")

    primary = manifest.get("primaryTarget", {})
    report = primary.get("report", {})
    evaluation = report.get("evaluation", {})
    audit = primary.get("audit", {})
    current = manifest.get("currentScoring", {})
    if primary.get("column") != EXPECTED_TARGET_COLUMN:
        raise ValueError("MiLB impact primary target changed")
    if report.get("targetScope") != "unconditional total MLB WAR in snapshot year + 1 through + 5":
        raise ValueError("MiLB impact report target scope changed")
    if evaluation.get("selectedModel") != EXPECTED_MODEL:
        raise ValueError("MiLB impact report selected model changed")
    if current.get("featureSeason") != EXPECTED_FEATURE_SEASON:
        raise ValueError("MiLB impact current feature season changed")
    if current.get("state") != "research_scores_from_compatible_completed_2025_milb_snapshots":
        raise ValueError("MiLB impact current scoring state changed")
    if audit.get("knowledgeTimeVerified") is not False:
        raise ValueError("MiLB impact knowledge-time gate unexpectedly changed")
    if report.get("releaseEligible") is not False:
        raise ValueError("MiLB impact report unexpectedly became release eligible")
    warnings = set(report.get("warnings", []))
    if "selected_model_top_one_percent_tail_is_materially_miscalibrated" not in warnings:
        raise ValueError("MiLB impact tail-calibration disclosure is missing")


def main() -> None:
    manifest = read_json(MANIFEST)
    require_manifest_contract(manifest)

    expected_scores_sha = manifest.get("outputs", {}).get("currentScores", {}).get("sha256")
    actual_scores_sha = file_sha256(CURRENT_SCORES)
    if actual_scores_sha != expected_scores_sha:
        raise ValueError("The MiLB impact current-score artifact digest changed")

    scores = pd.read_parquet(CURRENT_SCORES).sort_values("rank", kind="stable").reset_index(drop=True)
    required_columns = {
        "rank",
        "mlbam_id",
        "role",
        "as_of",
        "selected_model",
        "target_window_start_season",
        "target_window_end_season",
        "target_scope",
        "model_version",
        "publication_state",
    }
    missing = sorted(required_columns.difference(scores.columns))
    if missing:
        raise ValueError(f"MiLB impact scores are missing columns: {missing}")

    rows = len(scores)
    expected_rows = int(manifest.get("currentScoring", {}).get("rows", -1))
    if rows != expected_rows or rows <= 0:
        raise ValueError("MiLB impact score count changed")
    if scores["rank"].astype(int).tolist() != list(range(1, rows + 1)):
        raise ValueError("MiLB impact ranks must be unique and contiguous")
    if not scores["selected_model"].eq(EXPECTED_MODEL).all():
        raise ValueError("MiLB impact scores contain an unexpected selected model")
    if not scores["model_version"].eq(EXPECTED_MODEL_VERSION).all():
        raise ValueError("MiLB impact scores contain an unexpected model version")
    if not scores["publication_state"].eq("research").all():
        raise ValueError("MiLB impact scores contain a non-research publication state")
    if not scores["target_scope"].eq(EXPECTED_TARGET_SCOPE).all():
        raise ValueError("MiLB impact score target scope changed")
    if not scores["target_window_start_season"].eq(EXPECTED_WINDOW[0]).all() or not scores[
        "target_window_end_season"
    ].eq(EXPECTED_WINDOW[1]).all():
        raise ValueError("MiLB impact target window changed")

    as_of_values = {iso_utc(value) for value in scores["as_of"]}
    if len(as_of_values) != 1:
        raise ValueError("MiLB impact scores require one frozen as-of timestamp")
    frozen_as_of = as_of_values.pop()

    estimates: dict[str, dict[str, Any]] = {}
    for row in scores.itertuples(index=False):
        mlbam_id = str(row.mlbam_id)
        role = str(row.role)
        rank = int(row.rank)
        if not re.fullmatch(r"\d+", mlbam_id):
            raise ValueError(f"Invalid MLBAM identifier: {mlbam_id}")
        if role not in {"hitter", "pitcher"}:
            raise ValueError(f"Invalid MiLB impact role: {role}")
        key = f"{mlbam_id}:{role}"
        if key in estimates:
            raise ValueError(f"Duplicate MiLB impact identity: {key}")
        estimates[key] = {
            "rank": rank,
            "rankPercentile": rank_percentile(rank, rows),
            "role": role,
        }

    primary = manifest["primaryTarget"]
    report = primary["report"]
    evaluation = report["evaluation"]
    selected_metrics = evaluation["metrics"][EXPECTED_MODEL]
    folds = report["folds"]
    fold_lifts = [float(fold["metrics"][EXPECTED_MODEL]["topDecile"]["lift"]) for fold in folds]
    validation_seasons = [int(fold["validationSeason"]) for fold in folds]
    if len(folds) < 2 or validation_seasons != sorted(validation_seasons):
        raise ValueError("MiLB impact fold evidence is incomplete or unordered")

    preview = {
        "schemaVersion": "milb-impact-preview/v1",
        "status": "research_only",
        "releaseEligible": False,
        "frozenAsOf": frozen_as_of,
        "sourceRunAsOf": iso_utc(manifest["asOf"]),
        "modelVersion": EXPECTED_MODEL_VERSION,
        "selectedModel": EXPECTED_MODEL,
        "universeRows": rows,
        "rankPercentileMethod": "100 * (universeRows - rank) / (universeRows - 1)",
        "target": {
            "id": EXPECTED_TARGET_COLUMN,
            "label": "At least 5 total MLB WAR in the next five calendar seasons",
            "scope": "unconditional",
            "windowStartSeason": EXPECTED_WINDOW[0],
            "windowEndSeason": EXPECTED_WINDOW[1],
            "hallOfFameProbability": False,
        },
        "oofRankEvidence": {
            "method": "player-purged expanding prediction-origin out-of-fold evaluation",
            "rows": int(selected_metrics["rows"]),
            "players": int(selected_metrics["players"]),
            "eventPlayers": int(selected_metrics["eventPlayers"]),
            "topDecileLift": compact_metric(selected_metrics["topDecile"]["lift"]),
            "brierSkillVsTransparentBaseline": compact_metric(
                selected_metrics["brierSkillVsTransparentBaseline"]
            ),
            "foldTopDecileLiftRange": {
                "minimum": compact_metric(min(fold_lifts)),
                "maximum": compact_metric(max(fold_lifts)),
                "folds": len(fold_lifts),
                "validationSeasons": validation_seasons,
            },
        },
        "gates": {
            "tailCalibrationPassed": False,
            "prospectiveValidationPassed": False,
            "knowledgeTimeVerified": False,
        },
        "lineage": {
            "runContentSha256": manifest["runContentSha256"],
            "currentScoresSha256": actual_scores_sha,
        },
        "warnings": [
            "Research-only retrospective ranking; it is not a released forecast.",
            "Raw impact probabilities are intentionally withheld because extreme-tail calibration failed.",
            "The target is at least 5 MLB WAR in 2026-2030, not Hall of Fame induction or investment return.",
            "Ranks use completed 2025 MiLB features and do not include 2026 in-season evidence.",
            "Historical archives are effective-time safe, but their knowledge time is not verified.",
            "Prospective validation has not passed, and market price is not modeled.",
        ],
        "estimates": estimates,
    }

    encoded = json.dumps(preview, separators=(",", ":"), sort_keys=True) + "\n"
    if re.search(r'"[^"\\]*probability[^"\\]*"\s*:\s*(?:-?\d|\[|\{)', encoded, re.IGNORECASE):
        raise ValueError("Probability-valued fields are forbidden in the compact MiLB impact export")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(encoded, encoding="utf-8")
    print(f"Exported {rows:,} probability-free MiLB impact ranks")


if __name__ == "__main__":
    main()
