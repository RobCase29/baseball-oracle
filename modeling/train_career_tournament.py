from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

try:
    from modeling.alpha_signal import (
        HistoricalHallBaseline,
        retrospective_alpha_diagnostic,
    )
    from modeling.career_data import (
        build_career_landmarks,
        chronological_player_split,
        normalize_jaws_standards,
        normalize_player_seasons,
        read_records,
    )
    from modeling.career_preview import (
        build_preview_payload,
        load_arrival_preview,
        validate_preview_sanity,
    )
    from modeling.career_chapters import fit_career_chapter_model
    from modeling.career_tournament import fit_final_scoring_bundle, run_career_tournament
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
except ModuleNotFoundError:
    from alpha_signal import HistoricalHallBaseline, retrospective_alpha_diagnostic
    from career_data import (
        build_career_landmarks,
        chronological_player_split,
        normalize_jaws_standards,
        normalize_player_seasons,
        read_records,
    )
    from career_preview import build_preview_payload, load_arrival_preview, validate_preview_sanity
    from career_chapters import fit_career_chapter_model
    from career_tournament import fit_final_scoring_bundle, run_career_tournament
    from provenance import file_sha256, json_sha256, producer_metadata


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = ROOT / "data/processed/baseball-reference-mlb-war"
DEFAULT_ARTIFACT_DIR = ROOT / "artifacts/career-oracle-v1"
DEFAULT_PREVIEW = ROOT / "api/_data/career-oracle-preview.json"
DEFAULT_ARRIVAL_PREVIEW = ROOT / "api/_data/research-arrival-2025.json"
DEFAULT_ROSTER_DIR = ROOT / "data/processed/baseball-reference-rosters/2026"
DEFAULT_CHADWICK_DIR = ROOT / "data/raw/chadwick-register/7e23e7dfaff51b3ae72c16393703eda7e5ecad27/data"


def _portable(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return str(resolved)


def _write_json(path: Path, value: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        body = json.dumps(value, separators=(",", ":"), sort_keys=True)
    else:
        body = json.dumps(value, indent=2, sort_keys=True)
    path.write_text(body + "\n", encoding="utf-8")


def _source_manifest(path: Path, *, allow_incomplete: bool) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Source manifest must contain an object")
    coverage = value.get("coverage")
    if not isinstance(coverage, dict):
        raise ValueError("Source manifest has no coverage object")
    if not bool(coverage.get("complete")) and not allow_incomplete:
        raise ValueError("Refusing to train from an incomplete Baseball-Reference WAR corpus")
    if int(coverage.get("failedUnits", 0)) != 0:
        raise ValueError("Refusing to train with failed Baseball-Reference acquisition units")
    return value


def _verify_manifest_output(
    manifest: dict[str, Any], path: Path
) -> dict[str, Any]:
    portable = _portable(path)
    outputs = manifest.get("outputs")
    if not isinstance(outputs, list):
        raise ValueError("Source manifest has no output list")
    output = next(
        (
            value
            for value in outputs
            if isinstance(value, dict) and str(value.get("path")) == portable
        ),
        None,
    )
    if output is None:
        raise ValueError(f"Source manifest does not bind output: {portable}")
    expected_bytes = output.get("byteLength", output.get("byte_length"))
    if expected_bytes is None or path.stat().st_size != int(expected_bytes):
        raise ValueError(f"Manifest byte length mismatch: {portable}")
    expected_sha256 = str(output.get("sha256") or "")
    if len(expected_sha256) != 64 or file_sha256(path) != expected_sha256:
        raise ValueError(f"Manifest SHA-256 mismatch: {portable}")
    return output


def _load_chadwick_crosswalk(
    directory: Path, bbref_ids: set[str]
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    matches: list[pd.DataFrame] = []
    lineage: list[dict[str, Any]] = []
    paths = sorted(directory.glob("people-*.csv"))
    if not paths:
        raise ValueError(f"No locked Chadwick people shards found in {directory}")
    for path in paths:
        frame = pd.read_csv(
            path,
            usecols=["key_bbref", "key_mlbam"],
            dtype={"key_bbref": "string", "key_mlbam": "string"},
        )
        selected = frame.loc[frame["key_bbref"].isin(bbref_ids)].copy()
        if not selected.empty:
            matches.append(selected)
        lineage.append({"path": _portable(path), "sha256": file_sha256(path)})
    combined = pd.concat(matches, ignore_index=True) if matches else pd.DataFrame()
    if combined.empty:
        raise ValueError("Locked Chadwick crosswalk matched zero roster players")
    combined = combined.loc[combined["key_mlbam"].notna()].copy()
    combined["key_mlbam"] = pd.to_numeric(combined["key_mlbam"], errors="raise").astype(int)
    if combined["key_bbref"].duplicated().any():
        raise ValueError("Locked Chadwick crosswalk has duplicate roster BRef identities")
    return (
        dict(zip(combined["key_bbref"].astype(str), combined["key_mlbam"], strict=True)),
        lineage,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the research MLB career JAWS tournament and export the unified preview"
    )
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--preview-output", type=Path, default=DEFAULT_PREVIEW)
    parser.add_argument("--arrival-preview", type=Path, default=DEFAULT_ARRIVAL_PREVIEW)
    parser.add_argument("--roster-dir", type=Path, default=DEFAULT_ROSTER_DIR)
    parser.add_argument("--chadwick-dir", type=Path, default=DEFAULT_CHADWICK_DIR)
    parser.add_argument("--as-of", default=None)
    parser.add_argument("--inactivity-years", type=int, default=3)
    parser.add_argument("--minimum-players-per-split", type=int, default=100)
    parser.add_argument("--allow-incomplete-source", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_dir = args.source_dir.resolve()
    player_path = source_dir / "player_seasons.json"
    standard_path = source_dir / "jaws_standards.json"
    inductee_path = source_dir / "hof_inductees.json"
    source_manifest_path = source_dir / "manifest.json"
    source_manifest = _source_manifest(
        source_manifest_path, allow_incomplete=args.allow_incomplete_source
    )
    roster_path = args.roster_dir.resolve() / "active_roster.json"
    roster_manifest_path = args.roster_dir.resolve() / "manifest.json"
    roster_manifest = json.loads(roster_manifest_path.read_text(encoding="utf-8"))
    if not bool(roster_manifest.get("coverage", {}).get("complete")):
        raise ValueError("Refusing to score from an incomplete active-roster snapshot")
    player_output = _verify_manifest_output(source_manifest, player_path)
    standard_output = _verify_manifest_output(source_manifest, standard_path)
    inductee_output = _verify_manifest_output(source_manifest, inductee_path)
    roster_output = _verify_manifest_output(roster_manifest, roster_path)
    roster = read_records(roster_path)
    roster_bbref_ids = set(
        roster.loc[roster["bbref_id"].notna(), "bbref_id"].astype(str).str.strip()
    )
    external_ids, chadwick_lineage = _load_chadwick_crosswalk(
        args.chadwick_dir.resolve(), roster_bbref_ids
    )
    source_times = [
        str(source_manifest.get("generatedAt") or source_manifest.get("generated_at") or ""),
        str(roster_manifest.get("generatedAt") or roster_manifest.get("generated_at") or ""),
    ]
    as_of = args.as_of or max(value for value in source_times if value)
    player_seasons = normalize_player_seasons(read_records(player_path))
    standards = normalize_jaws_standards(read_records(standard_path))
    inductees = read_records(inductee_path)
    expected_rows = {
        "player seasons": (player_output, len(player_seasons)),
        "JAWS standards": (standard_output, len(standards)),
        "HOF inductees": (inductee_output, len(inductees)),
        "active roster": (roster_output, len(roster)),
    }
    for label, (output, actual_rows) in expected_rows.items():
        expected = output.get("rowCount", output.get("row_count"))
        if expected is None or int(expected) != int(actual_rows):
            raise ValueError(f"Manifest row count mismatch for {label}")
    as_of_year = int(source_manifest["coverage"]["latestCompleteSeason"])
    panel = build_career_landmarks(
        player_seasons,
        standards,
        as_of_year=as_of_year,
        inactivity_years=args.inactivity_years,
    )
    excluded_two_way_players = tuple(
        sorted(
            panel.loc[
                panel["resolved_career"]
                & ~panel["target_eligible"].eq(True),
                "bbref_id",
            ].unique()
        )
    )
    model_panel = panel.loc[~panel["bbref_id"].isin(excluded_two_way_players)].reset_index(
        drop=True
    )
    split = chronological_player_split(
        model_panel,
        minimum_players_per_split=args.minimum_players_per_split,
    )
    tournament = run_career_tournament(model_panel, split)
    tournament.report["targetExclusions"] = {
        "twoWayPlayers": len(excluded_two_way_players),
        "policy": "excluded_from_v1_training_and_withheld_from_current_ranking_until_a_preregistered_two_way_standard_exists",
    }
    scoring_bundle = fit_final_scoring_bundle(
        model_panel,
        tournament.champion_name,
        tilt_source=tournament.report.get("scenarioTilt", {}).get("sourceClassifier"),
        tilt_classifier_weight=tournament.report.get("scenarioTilt", {}).get(
            "sourceClassifierWeight"
        ),
        withheld_high_performance_stages=tournament.report.get(
            "youngEliteDistributionGate", {}
        ).get("failedStages", []),
        withhold_early_mlb=not bool(
            tournament.report.get("rookieRankingGate", {}).get("passed")
        ),
    )
    chapter_model = fit_career_chapter_model(
        model_panel,
        latest_complete_season=as_of_year,
    )
    tournament.report["careerChapters"] = chapter_model.report
    alpha_report = HistoricalHallBaseline(model_panel).report()
    alpha_report["retrospectiveDiagnostic"] = retrospective_alpha_diagnostic(
        model_panel,
        tournament,
        chapter_model.boundaries,
    )
    tournament.report["alphaSignal"] = alpha_report
    arrival_preview = load_arrival_preview(args.arrival_preview)
    lineage = {
        "dataVersion": file_sha256(source_manifest_path),
        "sourceManifest": {
            "path": _portable(source_manifest_path),
            "sha256": file_sha256(source_manifest_path),
            "coverage": source_manifest.get("coverage"),
        },
        "inputs": {
            "playerSeasons": {
                "path": _portable(player_path),
                "rows": int(len(player_seasons)),
                "sha256": file_sha256(player_path),
            },
            "jawsStandards": {
                "path": _portable(standard_path),
                "rows": int(len(standards)),
                "sha256": file_sha256(standard_path),
            },
            "hofInductees": {
                "path": _portable(inductee_path),
                "rows": int(len(inductees)),
                "sha256": file_sha256(inductee_path),
                "usage": "descriptive_audit_only_not_target",
            },
            "activeRoster": {
                "path": _portable(roster_path),
                "rows": int(len(roster)),
                "sha256": file_sha256(roster_path),
                "manifestPath": _portable(roster_manifest_path),
                "manifestSha256": file_sha256(roster_manifest_path),
                "knownAtLast": roster_manifest.get("coverage", {}).get("known_at_last"),
                "usage": "scoring_census_only_not_training",
            },
            "chadwickCrosswalk": {
                "directory": _portable(args.chadwick_dir.resolve()),
                "matchedRosterPlayers": len(external_ids),
                "unmatchedRosterPlayers": len(roster_bbref_ids - set(external_ids)),
                "sourceLockPath": "data/source-lock.json",
                "sourceLockSha256": file_sha256(ROOT / "data/source-lock.json"),
                "shards": chadwick_lineage,
                "join": "exact_key_bbref_only_no_name_matching",
            },
            "arrivalPreview": (
                None
                if arrival_preview is None
                else {
                    "path": _portable(args.arrival_preview.resolve()),
                    "sha256": file_sha256(args.arrival_preview.resolve()),
                    "rows": int(arrival_preview.get("rows", 0)),
                    "milbAlphaSignalVersion": arrival_preview.get(
                        "milbAlphaSignalVersion"
                    ),
                    "usage": "frozen_research_arrival_and_milb_alpha_scoring",
                }
            ),
        },
    }
    preview = build_preview_payload(
        as_of=as_of,
        panel=panel,
        player_seasons=player_seasons,
        standards=standards,
        tournament=tournament,
        scoring_bundle=scoring_bundle,
        arrival_preview=arrival_preview,
        roster=roster,
        external_ids=external_ids,
        chapter_model=chapter_model,
        lineage=lineage,
    )
    validate_preview_sanity(preview)

    artifact_dir = args.artifact_dir.resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)
    panel_path = artifact_dir / "career_landmarks.parquet"
    report_path = artifact_dir / "tournament_report.json"
    model_path = artifact_dir / "model.joblib"
    manifest_path = artifact_dir / "run_manifest.json"
    panel.to_parquet(panel_path, index=False)
    _write_json(report_path, tournament.report)
    joblib.dump(
        {
            "tournament": tournament,
            "scoringBundle": scoring_bundle,
            "chapterModel": chapter_model,
        },
        model_path,
        compress=3,
    )
    _write_json(args.preview_output.resolve(), preview, compact=True)
    outputs = {
        "careerLandmarks": {
            "path": _portable(panel_path),
            "rows": int(len(panel)),
            "sha256": file_sha256(panel_path),
        },
        "tournamentReport": {
            "path": _portable(report_path),
            "sha256": file_sha256(report_path),
        },
        "model": {"path": _portable(model_path), "sha256": file_sha256(model_path)},
        "preview": {
            "path": _portable(args.preview_output.resolve()),
            "players": len(preview["players"]),
            "prospectForecasts": len(preview["prospectForecasts"]),
            "sha256": file_sha256(args.preview_output.resolve()),
        },
    }
    run_manifest = {
        "schemaVersion": "career-oracle-run/v1",
        "asOf": as_of,
        "publicationState": "research",
        "releaseEligible": False,
        "champion": tournament.champion_name,
        "lineage": lineage,
        "outputs": outputs,
        "producer": producer_metadata(
            ROOT,
            [
                Path(__file__),
                ROOT / "modeling/career_data.py",
                ROOT / "modeling/career_tournament.py",
                ROOT / "modeling/career_preview.py",
                ROOT / "modeling/career_chapters.py",
                ROOT / "modeling/alpha_signal.py",
                ROOT / "modeling/milb_alpha_signal.py",
                ROOT / "modeling/relative_standing.py",
            ],
            {
                "asOf": as_of,
                "inactivityYears": args.inactivity_years,
                "minimumPlayersPerSplit": args.minimum_players_per_split,
            },
        ),
    }
    run_manifest["manifestSha256"] = json_sha256(run_manifest)
    _write_json(manifest_path, run_manifest)
    print(
        f"Career tournament complete: {len(panel):,} landmarks, "
        f"{len(preview['players']):,} MLB players, "
        f"{len(preview['prospectForecasts']):,} prospect forecasts; "
        f"champion={tournament.champion_name}"
    )


if __name__ == "__main__":
    main()
