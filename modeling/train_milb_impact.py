from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

try:
    from modeling.milb_alpha_targets import build_five_calendar_year_war_targets
    from modeling.milb_impact_tournament import (
        EXPLORATORY_TARGET_COLUMN,
        MODEL_VERSION,
        PRIMARY_TARGET_COLUMN,
        TOURNAMENT_SCHEMA_VERSION,
        fit_final_models,
        prepare_labeled_panel,
        run_tournament,
        score_current_snapshots,
    )
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
    from modeling.train_arrival_population import load_arrival_corpus
except ModuleNotFoundError:
    from milb_alpha_targets import build_five_calendar_year_war_targets
    from milb_impact_tournament import (
        EXPLORATORY_TARGET_COLUMN,
        MODEL_VERSION,
        PRIMARY_TARGET_COLUMN,
        TOURNAMENT_SCHEMA_VERSION,
        fit_final_models,
        prepare_labeled_panel,
        run_tournament,
        score_current_snapshots,
    )
    from provenance import file_sha256, json_sha256, producer_metadata
    from train_arrival_population import load_arrival_corpus


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS_MANIFEST = ROOT / "data/processed/arrival-population-v1/corpus_manifest.json"
DEFAULT_CAREER_OUTCOMES = ROOT / "data/processed/model-v1/career_outcomes.parquet"
DEFAULT_WAR_SEASONS = ROOT / "data/processed/baseball-reference-mlb-war/player_seasons.csv"
DEFAULT_CURRENT_SNAPSHOTS = (
    ROOT / "data/processed/model-v1-bref-2025/affiliated_risk_set_snapshots.parquet"
)
DEFAULT_ARTIFACT_DIR = ROOT / "artifacts/milb-impact-v1"
DEFAULT_LATEST_COMPLETE_SEASON = 2025


def _portable(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return str(resolved)


def _json_default(value: Any) -> Any:
    if isinstance(value, (np.bool_, np.integer, np.floating)):
        return value.item()
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, Path):
        return _portable(value)
    raise TypeError(f"Unsupported JSON value: {type(value).__name__}")


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, default=_json_default) + "\n",
        encoding="utf-8",
    )


def _read_table(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(path)
    if path.suffix.lower() in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, low_memory=False)
    if path.suffix.lower() == ".json":
        return pd.read_json(path)
    raise ValueError(f"Unsupported table format: {path}")


def _archive_file(path: Path, archive_directory: Path) -> dict[str, Any]:
    digest = file_sha256(path)
    archived = archive_directory / f"{digest}{path.suffix}"
    archived.parent.mkdir(parents=True, exist_ok=True)
    if not archived.exists():
        shutil.copy2(path, archived)
    elif file_sha256(archived) != digest:
        raise ValueError(f"Content-addressed artifact differs: {archived}")
    return {
        "path": _portable(path),
        "sha256": digest,
        "bytes": path.stat().st_size,
        "contentAddressedPath": _portable(archived),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train and backtest the direct five-calendar-year MiLB impact challenger"
    )
    parser.add_argument("--corpus-manifest", type=Path, default=DEFAULT_CORPUS_MANIFEST)
    parser.add_argument("--career-outcomes", type=Path, default=DEFAULT_CAREER_OUTCOMES)
    parser.add_argument("--war-seasons", type=Path, default=DEFAULT_WAR_SEASONS)
    parser.add_argument("--current-snapshots", type=Path, default=DEFAULT_CURRENT_SNAPSHOTS)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument(
        "--latest-complete-season", type=int, default=DEFAULT_LATEST_COMPLETE_SEASON
    )
    parser.add_argument("--minimum-training-rows", type=int, default=1_000)
    parser.add_argument("--minimum-training-events", type=int, default=20)
    parser.add_argument("--bootstrap-repetitions", type=int, default=200)
    parser.add_argument("--seed", type=int, default=29)
    parser.add_argument("--as-of", default=None)
    parser.add_argument("--skip-current-scoring", action="store_true")
    parser.add_argument("--skip-exploratory-ten-war", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    corpus_manifest = args.corpus_manifest.resolve()
    career_path = args.career_outcomes.resolve()
    war_path = args.war_seasons.resolve()
    current_path = args.current_snapshots.resolve()
    artifact_dir = args.artifact_dir.resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)

    snapshots, _, source_corpus = load_arrival_corpus(corpus_manifest)
    career_outcomes = _read_table(career_path)
    war_seasons = _read_table(war_path)
    targets = build_five_calendar_year_war_targets(
        snapshots,
        career_outcomes,
        war_seasons,
        latest_complete_season=args.latest_complete_season,
    )
    target_support = {
        "rows": int(len(targets)),
        "players": int(targets["player_id"].nunique()),
        "identityResolution": {
            str(key): int(value)
            for key, value in targets["identity_resolution"].value_counts().items()
        },
        "labelStatus": {
            str(key): int(value)
            for key, value in targets["label_status"].value_counts().items()
        },
        "fiveWarEventRows": int(targets[PRIMARY_TARGET_COLUMN].fillna(False).sum()),
        "tenWarEventRows": int(targets[EXPLORATORY_TARGET_COLUMN].fillna(False).sum()),
    }
    primary_panel, primary_audit = prepare_labeled_panel(
        snapshots, targets, target_column=PRIMARY_TARGET_COLUMN
    )
    primary_oof, primary_report = run_tournament(
        primary_panel,
        target_column=PRIMARY_TARGET_COLUMN,
        minimum_training_rows=args.minimum_training_rows,
        minimum_training_events=args.minimum_training_events,
        bootstrap_repetitions=args.bootstrap_repetitions,
        bootstrap_seed=args.seed,
    )
    selected_model = str(primary_report["evaluation"]["selectedModel"])
    final_bundle = fit_final_models(primary_panel, target_column=PRIMARY_TARGET_COLUMN)
    final_bundle["selectedModel"] = selected_model

    exploratory_report: dict[str, Any] | None = None
    exploratory_oof: pd.DataFrame | None = None
    exploratory_audit: dict[str, Any] | None = None
    if not args.skip_exploratory_ten_war:
        exploratory_panel, exploratory_audit = prepare_labeled_panel(
            snapshots, targets, target_column=EXPLORATORY_TARGET_COLUMN
        )
        exploratory_oof, exploratory_report = run_tournament(
            exploratory_panel,
            target_column=EXPLORATORY_TARGET_COLUMN,
            minimum_training_rows=args.minimum_training_rows,
            minimum_training_events=args.minimum_training_events,
            bootstrap_repetitions=args.bootstrap_repetitions,
            bootstrap_seed=args.seed + 10_000,
        )
        exploratory_report["status"] = "exploratory_only"
        exploratory_report["selectedForCurrentScoring"] = False
        exploratory_report["warnings"].append(
            "ten_war_target_has_low_event_support_and_cannot_drive_product_claims"
        )

    current_scores: pd.DataFrame | None = None
    if not args.skip_current_scoring:
        current_snapshots = _read_table(current_path)
        current_scores = score_current_snapshots(
            final_bundle, current_snapshots, selected_model=selected_model
        )

    model_path = artifact_dir / "model.joblib"
    primary_oof_path = artifact_dir / "oof_predictions.parquet"
    targets_path = artifact_dir / "targets.parquet"
    joblib.dump(final_bundle, model_path)
    primary_oof.to_parquet(primary_oof_path, index=False)
    targets.to_parquet(targets_path, index=False)
    outputs = {
        "model": _archive_file(model_path, artifact_dir / "models"),
        "primaryOofPredictions": _archive_file(
            primary_oof_path, artifact_dir / "oof"
        ),
        "targets": _archive_file(targets_path, artifact_dir / "targets"),
    }
    if exploratory_oof is not None:
        exploratory_path = artifact_dir / "exploratory_10war_oof_predictions.parquet"
        exploratory_oof.to_parquet(exploratory_path, index=False)
        outputs["exploratoryTenWarOofPredictions"] = _archive_file(
            exploratory_path, artifact_dir / "oof"
        )
    if current_scores is not None:
        current_scores_path = artifact_dir / "current_scores.parquet"
        current_scores.to_parquet(current_scores_path, index=False)
        outputs["currentScores"] = _archive_file(
            current_scores_path, artifact_dir / "current-scores"
        )

    arguments = {
        "corpusManifest": _portable(corpus_manifest),
        "careerOutcomes": _portable(career_path),
        "warSeasons": _portable(war_path),
        "currentSnapshots": None if args.skip_current_scoring else _portable(current_path),
        "latestCompleteSeason": args.latest_complete_season,
        "minimumTrainingRows": args.minimum_training_rows,
        "minimumTrainingEvents": args.minimum_training_events,
        "bootstrapRepetitions": args.bootstrap_repetitions,
        "seed": args.seed,
        "exploratoryTenWar": not args.skip_exploratory_ten_war,
    }
    as_of = args.as_of or datetime.now(timezone.utc).isoformat()
    manifest: dict[str, Any] = {
        "schemaVersion": TOURNAMENT_SCHEMA_VERSION,
        "modelVersion": MODEL_VERSION,
        "asOf": as_of,
        "status": "research_only",
        "releaseEligible": False,
        "selectedModel": selected_model,
        "primaryTarget": {
            "column": PRIMARY_TARGET_COLUMN,
            "scope": "unconditional >=5 total MLB WAR in snapshot year + 1 through + 5",
            "targetSupport": target_support,
            "audit": primary_audit,
            "report": primary_report,
        },
        "exploratoryTenWar": (
            None
            if exploratory_report is None
            else {
                "column": EXPLORATORY_TARGET_COLUMN,
                "scope": "exploratory unconditional >=10 total MLB WAR in the same window",
                "audit": exploratory_audit,
                "report": exploratory_report,
            }
        ),
        "currentScoring": {
            "possibleFromCompatibleFeatures": current_scores is not None,
            "rows": 0 if current_scores is None else int(len(current_scores)),
            "players": (
                0 if current_scores is None else int(current_scores["player_id"].nunique())
            ),
            "featureSeason": (
                None
                if current_scores is None
                else int(current_scores["edition"].max())
            ),
            "state": (
                "not_requested"
                if current_scores is None
                else "research_scores_from_compatible_completed_2025_milb_snapshots"
            ),
        },
        "lineage": {
            "arrivalCorpusManifest": {
                "path": _portable(corpus_manifest),
                "sha256": file_sha256(corpus_manifest),
                "corpusContentSha256": source_corpus.get("corpus_content_sha256"),
            },
            "careerOutcomes": {
                "path": _portable(career_path),
                "sha256": file_sha256(career_path),
                "rows": int(len(career_outcomes)),
            },
            "warSeasons": {
                "path": _portable(war_path),
                "sha256": file_sha256(war_path),
                "rows": int(len(war_seasons)),
                "latestCompleteSeason": args.latest_complete_season,
            },
            "currentSnapshots": (
                None
                if args.skip_current_scoring
                else {
                    "path": _portable(current_path),
                    "sha256": file_sha256(current_path),
                }
            ),
        },
        "outputs": outputs,
        "producer": producer_metadata(
            ROOT,
            [
                Path(__file__),
                ROOT / "modeling/milb_impact_tournament.py",
                ROOT / "modeling/milb_alpha_targets.py",
            ],
            arguments,
        ),
        "warnings": [
            "research_only_not_investment_advice",
            "not_a_hall_of_fame_probability",
            "model_selection_and_evaluation_share_the_retrospective_oof_panel",
            "all_available_validation_windows_include_the_2020_shortened_season",
            "current_scores_use_completed_2025_features_and_are_not_2026_in_season_updates",
        ],
    }
    stable_manifest = dict(manifest)
    stable_manifest.pop("asOf", None)
    manifest["runContentSha256"] = json_sha256(stable_manifest)
    manifest_path = artifact_dir / "run_manifest.json"
    _write_json(manifest_path, manifest)
    run_archive = artifact_dir / "runs" / f"{manifest['runContentSha256']}.json"
    if run_archive.exists() and file_sha256(run_archive) != file_sha256(manifest_path):
        raise ValueError(f"Content-addressed run manifest differs: {run_archive}")
    if not run_archive.exists():
        run_archive.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(manifest_path, run_archive)

    primary_metrics = primary_report["evaluation"]["metrics"][selected_model]
    print(
        json.dumps(
            {
                "artifact": _portable(manifest_path),
                "selectedModel": selected_model,
                "oofRows": primary_metrics["rows"],
                "oofPlayers": primary_metrics["players"],
                "oofEventPlayers": primary_metrics["eventPlayers"],
                "brier": primary_metrics["brier"],
                "rocAuc": primary_metrics["rocAuc"],
                "averagePrecision": primary_metrics["averagePrecision"],
                "topDecileLift": primary_metrics["topDecile"]["lift"],
                "currentScores": 0 if current_scores is None else len(current_scores),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
