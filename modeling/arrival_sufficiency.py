from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

try:
    from modeling.contracts import SURVIVAL_HORIZON_MONTHS
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
    from modeling.train_arrival_population import load_arrival_corpus
except ModuleNotFoundError:
    from contracts import SURVIVAL_HORIZON_MONTHS
    from provenance import file_sha256, json_sha256, producer_metadata
    from train_arrival_population import load_arrival_corpus


ROOT = Path(__file__).resolve().parents[1]
SUFFICIENCY_SCHEMA_VERSION = "arrival-data-sufficiency/v1"
DEFAULT_THRESHOLDS: dict[str, float | int] = {
    "minimum_seasons": 8,
    "minimum_snapshots": 50_000,
    "minimum_players": 20_000,
    "minimum_mature_60m_rows": 50_000,
    "minimum_unique_60m_event_players": 2_500,
    "minimum_role_players": 5_000,
    "minimum_role_unique_60m_event_players": 500,
    "minimum_role_season_horizon_events": 50,
    "minimum_forward_folds": 8,
    "minimum_full_horizon_folds": 4,
    "minimum_scored_fold_horizon_events": 100,
    "minimum_identity_resolution_rate": 0.995,
    "maximum_selected_feature_missing_rate": 0.05,
}


class ArrivalSufficiencyError(ValueError):
    pass


def _resolve_path(value: str, root: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ArrivalSufficiencyError(f"Cannot read JSON evidence: {path}") from error
    if not isinstance(value, dict):
        raise ArrivalSufficiencyError(f"JSON evidence must be an object: {path}")
    return value


def load_verified_metrics(path: Path, *, root: Path = ROOT) -> dict[str, Any]:
    metrics = _read_json(path)
    report_address = metrics.get("validation_report_sha256")
    if not isinstance(report_address, str):
        raise ArrivalSufficiencyError("Population metrics have no report address")
    canonical = dict(metrics)
    canonical.pop("validation_report_sha256", None)
    if json_sha256(canonical) != report_address:
        raise ArrivalSufficiencyError("Population metrics report address is invalid")
    archived_report = path.parent / "runs" / f"{report_address}.json"
    if not archived_report.exists() or file_sha256(archived_report) != file_sha256(path):
        raise ArrivalSufficiencyError("Population metrics archive is missing or differs")

    artifact = metrics.get("artifact")
    if not isinstance(artifact, dict) or not isinstance(artifact.get("path"), str):
        raise ArrivalSufficiencyError("Population metrics have no model artifact")
    artifact_path = _resolve_path(artifact["path"], root)
    if not artifact_path.exists() or file_sha256(artifact_path) != artifact.get("sha256"):
        raise ArrivalSufficiencyError("Population model artifact is missing or invalid")
    return metrics


def _gate(
    gate_id: str,
    passed: bool,
    observed: Any,
    requirement: str,
) -> dict[str, Any]:
    return {
        "id": gate_id,
        "passed": bool(passed),
        "observed": observed,
        "requirement": requirement,
    }


def _selected_feature_coverage(
    snapshots: pd.DataFrame, metrics: dict[str, Any]
) -> tuple[dict[str, Any], float]:
    selected = metrics.get("model_configuration", {}).get("selected_features", {})
    coverage: dict[str, Any] = {}
    maximum_missing = 0.0
    for role, feature_groups in selected.items():
        role_rows = snapshots[snapshots["role"].eq(role)]
        if role_rows.empty or not isinstance(feature_groups, dict):
            raise ArrivalSufficiencyError(f"Selected feature role is absent: {role}")
        role_coverage: dict[str, Any] = {}
        for kind in ("numeric", "categorical"):
            features = feature_groups.get(kind, [])
            if not isinstance(features, list):
                raise ArrivalSufficiencyError(f"Invalid selected {kind} features: {role}")
            for feature in features:
                if feature not in role_rows:
                    raise ArrivalSufficiencyError(
                        f"Selected feature is absent from the corpus: {role}.{feature}"
                    )
                if kind == "numeric":
                    missing = pd.to_numeric(
                        role_rows[feature], errors="coerce"
                    ).isna()
                else:
                    values = role_rows[feature].astype("string")
                    missing = values.isna() | values.str.strip().eq("")
                missing_rate = float(missing.mean())
                maximum_missing = max(maximum_missing, missing_rate)
                role_coverage[feature] = {
                    "kind": kind,
                    "rows": int(len(role_rows)),
                    "missing_rows": int(missing.sum()),
                    "missing_rate": missing_rate,
                }
        coverage[str(role)] = role_coverage
    return coverage, maximum_missing


def _lineage_summary(
    corpus_manifest: dict[str, Any], *, root: Path
) -> dict[str, Any]:
    seasons: list[dict[str, Any]] = []
    for item in corpus_manifest.get("inputs", []):
        manifest_value = item.get("dataset_manifest_path")
        expected_manifest_hash = item.get("dataset_manifest_sha256")
        if not isinstance(manifest_value, str):
            raise ArrivalSufficiencyError("Corpus input has no dataset manifest path")
        manifest_path = _resolve_path(manifest_value, root)
        if (
            not manifest_path.exists()
            or file_sha256(manifest_path) != expected_manifest_hash
        ):
            raise ArrivalSufficiencyError("A corpus dataset manifest is missing or invalid")
        dataset_manifest = _read_json(manifest_path)
        risk_set = dataset_manifest.get("affiliated_risk_set")
        if not isinstance(risk_set, dict):
            raise ArrivalSufficiencyError("A corpus input has no affiliated risk-set evidence")
        quality = risk_set.get("quality")
        if not isinstance(quality, dict):
            raise ArrivalSufficiencyError("A corpus input has no risk-set quality evidence")

        archive = item.get("archive")
        if not isinstance(archive, dict):
            raise ArrivalSufficiencyError("A corpus input has no archive evidence")
        lock_value = archive.get("archive_lock_path")
        if not isinstance(lock_value, str):
            raise ArrivalSufficiencyError("A corpus input has no archive lock path")
        lock_path = _resolve_path(lock_value, root)
        if not lock_path.exists() or file_sha256(lock_path) != archive.get(
            "archive_lock_sha256"
        ):
            raise ArrivalSufficiencyError("A corpus archive lock is missing or invalid")
        coverage = archive.get("coverage")
        adapter_coverage = archive.get("source_adapter_coverage")
        if not isinstance(coverage, dict) or not isinstance(adapter_coverage, dict):
            raise ArrivalSufficiencyError("A corpus input has incomplete source coverage")
        seasons.append(
            {
                "season": int(item["season"]),
                "identity_resolution_rate": float(
                    quality.get("identity_resolution_rate", 0.0)
                ),
                "effective_time_safe": risk_set.get("effective_time_safe") is True,
                "knowledge_time_verified": risk_set.get("knowledge_time_verified")
                is True,
                "declared_team_pages": int(adapter_coverage["declared_team_pages"]),
                "observed_team_pages": int(adapter_coverage["observed_team_pages"]),
                "appearance_data_team_pages": int(
                    adapter_coverage["appearance_data_team_pages"]
                ),
                "declared_no_record_team_pages": int(
                    adapter_coverage["declared_no_record_team_pages"]
                ),
                "failed_team_pages": int(coverage.get("failedTeams", -1)),
            }
        )
    if not seasons:
        raise ArrivalSufficiencyError("Population corpus has no season lineage")
    return {
        "seasons": sorted(seasons, key=lambda item: item["season"]),
        "minimum_identity_resolution_rate": min(
            item["identity_resolution_rate"] for item in seasons
        ),
        "all_effective_time_safe": all(
            item["effective_time_safe"] for item in seasons
        ),
        "all_knowledge_time_verified": all(
            item["knowledge_time_verified"] for item in seasons
        ),
        "declared_team_pages": sum(item["declared_team_pages"] for item in seasons),
        "observed_team_pages": sum(item["observed_team_pages"] for item in seasons),
        "appearance_data_team_pages": sum(
            item["appearance_data_team_pages"] for item in seasons
        ),
        "declared_no_record_team_pages": sum(
            item["declared_no_record_team_pages"] for item in seasons
        ),
        "failed_team_pages": sum(item["failed_team_pages"] for item in seasons),
    }


def audit_arrival_sufficiency(
    snapshots: pd.DataFrame,
    labels: pd.DataFrame,
    corpus_manifest: dict[str, Any],
    metrics: dict[str, Any],
    *,
    thresholds: dict[str, float | int] | None = None,
    root: Path = ROOT,
) -> dict[str, Any]:
    limits = dict(DEFAULT_THRESHOLDS if thresholds is None else thresholds)
    keys = ["snapshot_id", "player_id", "as_of"]
    if snapshots["snapshot_id"].duplicated(keep=False).any():
        raise ArrivalSufficiencyError("Corpus contains duplicate snapshot IDs")
    if labels["snapshot_id"].duplicated(keep=False).any():
        raise ArrivalSufficiencyError("Corpus contains duplicate label snapshot IDs")
    joined = snapshots.merge(labels, on=keys, how="inner", validate="one_to_one")
    if len(joined) != len(snapshots) or len(joined) != len(labels):
        raise ArrivalSufficiencyError("Corpus features and labels do not align one-to-one")
    if metrics.get("inputs", {}).get("corpus_content_sha256") != corpus_manifest.get(
        "corpus_content_sha256"
    ):
        raise ArrivalSufficiencyError("Metrics and corpus content addresses differ")

    seasons = sorted(int(value) for value in snapshots["edition"].unique())
    roles = sorted(str(value) for value in snapshots["role"].dropna().unique())
    role_summary: dict[str, Any] = {}
    for role in roles:
        role_rows = joined[joined["role"].eq(role)]
        event_rows = role_rows[role_rows["debut_within_60m"].astype(bool)]
        role_summary[role] = {
            "snapshots": int(len(role_rows)),
            "players": int(role_rows["player_id"].nunique()),
            "event_rows_12m": int(role_rows["debut_within_12m"].sum()),
            "event_rows_60m": int(role_rows["debut_within_60m"].sum()),
            "unique_event_players_60m": int(event_rows["player_id"].nunique()),
        }

    role_season_horizon: list[dict[str, Any]] = []
    for (season, role), group in joined.groupby(["edition", "role"], sort=True):
        for months in SURVIVAL_HORIZON_MONTHS:
            event_column = f"debut_within_{months}m"
            event_rows = group[group[event_column].astype(bool)]
            role_season_horizon.append(
                {
                    "season": int(season),
                    "role": str(role),
                    "horizon_months": months,
                    "rows": int(len(group)),
                    "events": int(group[event_column].sum()),
                    "unique_event_players": int(event_rows["player_id"].nunique()),
                }
            )

    seen_players: set[str] = set()
    cold_start: list[dict[str, Any]] = []
    for season in seasons:
        cohort = joined[joined["edition"].eq(season)]
        membership = ~cohort["player_id"].astype(str).isin(seen_players)
        for months in SURVIVAL_HORIZON_MONTHS:
            events = cohort.loc[membership, f"debut_within_{months}m"].astype(bool)
            cold_start.append(
                {
                    "season": season,
                    "horizon_months": months,
                    "rows": int(membership.sum()),
                    "events": int(events.sum()),
                }
            )
        seen_players.update(cohort["player_id"].astype(str))

    feature_coverage, max_feature_missingness = _selected_feature_coverage(
        snapshots, metrics
    )
    lineage = _lineage_summary(corpus_manifest, root=root)
    validation_folds = metrics.get("validation", {}).get("folds", [])
    if not isinstance(validation_folds, list):
        raise ArrivalSufficiencyError("Population validation folds are invalid")
    scored_horizons = [
        horizon
        for fold in validation_folds
        for horizon in fold.get("horizons", {}).values()
    ]
    full_horizon_folds = sum("60" in fold.get("horizons", {}) for fold in validation_folds)
    minimum_scored_events = min(
        (int(horizon.get("events", 0)) for horizon in scored_horizons),
        default=0,
    )
    minimum_role_season_events = min(
        item["events"] for item in role_season_horizon
    )
    mature_60m_rows = int(labels["observed_60m"].astype(bool).sum())
    event_60m = labels["debut_within_60m"].astype(bool)
    unique_60m_event_players = int(labels.loc[event_60m, "player_id"].nunique())

    producer_git = metrics.get("producer", {}).get("git", {})
    model_provenance_clean = (
        producer_git.get("dirty") is False
        and isinstance(producer_git.get("commit"), str)
        and bool(producer_git.get("commit"))
    )
    gates = [
        _gate(
            "minimum_seasons",
            len(seasons) >= int(limits["minimum_seasons"]),
            len(seasons),
            f">= {int(limits['minimum_seasons'])}",
        ),
        _gate(
            "minimum_snapshots",
            len(snapshots) >= int(limits["minimum_snapshots"]),
            len(snapshots),
            f">= {int(limits['minimum_snapshots'])}",
        ),
        _gate(
            "minimum_players",
            snapshots["player_id"].nunique() >= int(limits["minimum_players"]),
            int(snapshots["player_id"].nunique()),
            f">= {int(limits['minimum_players'])}",
        ),
        _gate(
            "minimum_mature_60m_rows",
            mature_60m_rows >= int(limits["minimum_mature_60m_rows"]),
            mature_60m_rows,
            f">= {int(limits['minimum_mature_60m_rows'])}",
        ),
        _gate(
            "minimum_unique_60m_event_players",
            unique_60m_event_players
            >= int(limits["minimum_unique_60m_event_players"]),
            unique_60m_event_players,
            f">= {int(limits['minimum_unique_60m_event_players'])}",
        ),
        _gate(
            "minimum_role_players",
            min(item["players"] for item in role_summary.values())
            >= int(limits["minimum_role_players"]),
            min(item["players"] for item in role_summary.values()),
            f">= {int(limits['minimum_role_players'])} for every role",
        ),
        _gate(
            "minimum_role_unique_60m_event_players",
            min(item["unique_event_players_60m"] for item in role_summary.values())
            >= int(limits["minimum_role_unique_60m_event_players"]),
            min(item["unique_event_players_60m"] for item in role_summary.values()),
            f">= {int(limits['minimum_role_unique_60m_event_players'])} for every role",
        ),
        _gate(
            "minimum_role_season_horizon_events",
            minimum_role_season_events
            >= int(limits["minimum_role_season_horizon_events"]),
            minimum_role_season_events,
            f">= {int(limits['minimum_role_season_horizon_events'])}",
        ),
        _gate(
            "source_team_reconciliation",
            lineage["declared_team_pages"] == lineage["observed_team_pages"]
            and lineage["failed_team_pages"] == 0
            and lineage["appearance_data_team_pages"]
            + lineage["declared_no_record_team_pages"]
            == lineage["observed_team_pages"],
            {
                key: lineage[key]
                for key in (
                    "declared_team_pages",
                    "observed_team_pages",
                    "appearance_data_team_pages",
                    "declared_no_record_team_pages",
                    "failed_team_pages",
                )
            },
            "declared == observed, failed == 0, appearance + explicit no-record == observed",
        ),
        _gate(
            "minimum_identity_resolution_rate",
            lineage["minimum_identity_resolution_rate"]
            >= float(limits["minimum_identity_resolution_rate"]),
            lineage["minimum_identity_resolution_rate"],
            f">= {float(limits['minimum_identity_resolution_rate']):.3f}",
        ),
        _gate(
            "effective_time_safe",
            lineage["all_effective_time_safe"],
            lineage["all_effective_time_safe"],
            "true for every season",
        ),
        _gate(
            "maximum_selected_feature_missing_rate",
            max_feature_missingness
            <= float(limits["maximum_selected_feature_missing_rate"]),
            max_feature_missingness,
            f"<= {float(limits['maximum_selected_feature_missing_rate']):.3f}",
        ),
        _gate(
            "minimum_forward_folds",
            len(validation_folds) >= int(limits["minimum_forward_folds"]),
            len(validation_folds),
            f">= {int(limits['minimum_forward_folds'])}",
        ),
        _gate(
            "minimum_full_horizon_folds",
            full_horizon_folds >= int(limits["minimum_full_horizon_folds"]),
            full_horizon_folds,
            f">= {int(limits['minimum_full_horizon_folds'])}",
        ),
        _gate(
            "minimum_scored_fold_horizon_events",
            minimum_scored_events
            >= int(limits["minimum_scored_fold_horizon_events"]),
            minimum_scored_events,
            f">= {int(limits['minimum_scored_fold_horizon_events'])}",
        ),
        _gate(
            "clean_model_provenance",
            model_provenance_clean,
            producer_git,
            "model produced from a recorded clean git commit",
        ),
    ]
    research_ready = all(gate["passed"] for gate in gates)
    publication_blockers = [
        "No uninspected external temporal evaluation has been scored.",
        "Historical feature knowledge times are not independently evidenced.",
        "The estimand is a season-appearance population, not a contract-roster population.",
        "Cold-start short-horizon event support is insufficient for release gating.",
        "League, level, era, workload, and trajectory normalization are not in the frozen baseline.",
        "Career, WAR, Hall-caliber, and market-return models are separate unfinished stages.",
    ]
    return {
        "schema_version": SUFFICIENCY_SCHEMA_VERSION,
        "status": (
            "research_process_ready_not_publication_ready"
            if research_ready
            else "research_process_not_ready"
        ),
        "research_process_ready": research_ready,
        "publication_ready": False,
        "thresholds": limits,
        "corpus": {
            "content_sha256": corpus_manifest["corpus_content_sha256"],
            "seasons": seasons,
            "snapshots": int(len(snapshots)),
            "players": int(snapshots["player_id"].nunique()),
            "mature_60m_rows": mature_60m_rows,
            "event_rows_60m": int(event_60m.sum()),
            "unique_event_players_60m": unique_60m_event_players,
            "repeat_players": int(
                snapshots.groupby("player_id")["snapshot_id"].nunique().gt(1).sum()
            ),
        },
        "roles": role_summary,
        "role_season_horizon_support": role_season_horizon,
        "cold_start_support": cold_start,
        "selected_feature_coverage": feature_coverage,
        "maximum_selected_feature_missing_rate": max_feature_missingness,
        "lineage": lineage,
        "validation_support": {
            "forward_folds": len(validation_folds),
            "full_horizon_folds": full_horizon_folds,
            "scored_fold_horizons": len(scored_horizons),
            "minimum_scored_fold_horizon_events": minimum_scored_events,
        },
        "gates": gates,
        "publication_blockers": publication_blockers,
    }


def write_sufficiency_report(
    report: dict[str, Any],
    output_dir: Path,
    *,
    corpus_manifest_path: Path,
    metrics_path: Path,
) -> dict[str, Any]:
    stable = dict(report)
    stable["corpus_manifest_sha256"] = file_sha256(corpus_manifest_path)
    stable["metrics_sha256"] = file_sha256(metrics_path)
    content_address = json_sha256(stable)
    manifest = {
        **stable,
        "generated_at": datetime.now().astimezone().isoformat(),
        "report_content_sha256": content_address,
        "producer": producer_metadata(
            ROOT,
            [Path(__file__), ROOT / "modeling/train_arrival_population.py"],
            {
                "corpus_manifest": str(corpus_manifest_path),
                "metrics": str(metrics_path),
                "output_dir": str(output_dir),
            },
        ),
    }
    manifest_address = json_sha256(manifest)
    manifest["report_manifest_sha256"] = manifest_address
    body = json.dumps(manifest, indent=2, default=str) + "\n"
    output_dir.mkdir(parents=True, exist_ok=True)
    live_path = output_dir / "report.json"
    archive_path = output_dir / "reports" / f"{manifest_address}.json"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    live_path.write_text(body)
    if archive_path.exists() and archive_path.read_text() != body:
        raise ArrivalSufficiencyError("Content-addressed sufficiency report differs")
    if not archive_path.exists():
        archive_path.write_text(body)
    content_path = output_dir / "content" / f"{content_address}.json"
    content_path.parent.mkdir(parents=True, exist_ok=True)
    content_body = json.dumps(stable, indent=2, default=str) + "\n"
    if content_path.exists() and content_path.read_text() != content_body:
        raise ArrivalSufficiencyError("Content-addressed sufficiency evidence differs")
    if not content_path.exists():
        content_path.write_text(content_body)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit whether the arrival corpus supports a legitimate research process"
    )
    parser.add_argument(
        "--corpus-manifest",
        type=Path,
        default=ROOT / "data/processed/arrival-population-v1/corpus_manifest.json",
    )
    parser.add_argument(
        "--metrics",
        type=Path,
        default=ROOT / "artifacts/arrival-population-v1/metrics.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "artifacts/arrival-sufficiency-v1",
    )
    args = parser.parse_args()
    snapshots, labels, corpus_manifest = load_arrival_corpus(args.corpus_manifest)
    metrics = load_verified_metrics(args.metrics)
    report = audit_arrival_sufficiency(
        snapshots,
        labels,
        corpus_manifest,
        metrics,
    )
    manifest = write_sufficiency_report(
        report,
        args.output_dir,
        corpus_manifest_path=args.corpus_manifest,
        metrics_path=args.metrics,
    )
    print(
        json.dumps(
            {
                "status": manifest["status"],
                "research_process_ready": manifest["research_process_ready"],
                "publication_ready": manifest["publication_ready"],
                "report": str(args.output_dir / "report.json"),
                "report_content_sha256": manifest["report_content_sha256"],
                "report_manifest_sha256": manifest["report_manifest_sha256"],
            },
            indent=2,
        )
    )
    if not manifest["research_process_ready"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
