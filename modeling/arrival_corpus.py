from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from pandas.api.types import is_bool_dtype, is_integer_dtype

try:
    from modeling.contracts import SURVIVAL_HORIZON_MONTHS, assert_feature_contract
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
    from modeling.risk_set import DOMAIN_STAT_FEATURES
except ModuleNotFoundError:
    from contracts import SURVIVAL_HORIZON_MONTHS, assert_feature_contract
    from provenance import file_sha256, json_sha256, producer_metadata
    from risk_set import DOMAIN_STAT_FEATURES


ROOT = Path(__file__).resolve().parents[1]
CORPUS_SCHEMA_VERSION = "arrival-population-corpus/v1"
SNAPSHOT_OUTPUT = "affiliated_risk_set_snapshots"
LABEL_OUTPUT = "affiliated_arrival_labels"
ARCHIVE_LOCK_SCHEMA = "baseball-reference-register-archive-lock/v1"
SOURCE_RUN_SCHEMA = "baseball-reference-register-run/v1"
SOURCE_RUN_PARSER = "baseball-reference-register/v5"
SUPPORTED_SOURCE_RUN_PARSERS = frozenset(
    {
        "baseball-reference-register/v4",
        SOURCE_RUN_PARSER,
    }
)
RISK_SET_CONTRACT = "affiliated-player-census-v3"
RISK_SET_POLICY = "explicit_pooled_context_effective_time_safe_v3"
EXPECTED_RISK_SET_INPUTS = {
    "bref_player_team_seasons",
    "bref_quality",
    "bref_teams",
    "bref_team_organizations",
}
ROLE_ALIAS_PAIRS = {
    "hitter": (
        ("prior_pa", "prior_batting_pa"),
        ("prior_ab", "prior_batting_ab"),
        ("prior_hr", "prior_batting_hr"),
        ("prior_bb", "prior_batting_bb"),
        ("prior_so", "prior_batting_so"),
        ("prior_sb", "prior_batting_sb"),
    ),
    "pitcher": (
        ("prior_g", "prior_pitching_g"),
        ("prior_ip", "prior_pitching_ip"),
        ("prior_tbf", "prior_pitching_tbf"),
        ("prior_hr", "prior_pitching_hr"),
        ("prior_bb", "prior_pitching_bb"),
        ("prior_so", "prior_pitching_so"),
    ),
}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class ArrivalCorpusError(ValueError):
    pass


def corpus_stable_content(manifest: dict[str, Any]) -> dict[str, Any]:
    inputs = manifest.get("inputs")
    outputs = manifest.get("outputs")
    if not isinstance(inputs, list) or not isinstance(outputs, dict):
        raise ArrivalCorpusError("Population corpus manifest is incomplete")
    ordered_inputs = sorted(inputs, key=lambda item: int(item["season"]))
    stable_content: dict[str, Any] = {
        "schema_version": manifest.get("schema_version"),
        "data_cutoff": manifest.get("data_cutoff"),
        "snapshot_policy": manifest.get("snapshot_policy"),
        "input_dataset_content_sha256": [
            item["dataset_content_sha256"] for item in ordered_inputs
        ],
        "raw_archive_manifest_sha256": [
            item["archive"]["raw_archive_manifest_sha256"]
            for item in ordered_inputs
        ],
        "outputs": {
            name: {"rows": output.get("rows"), "sha256": output.get("sha256")}
            for name, output in outputs.items()
            if isinstance(output, dict)
        },
    }
    source_coverage = [
        {
            "season": item["season"],
            **item["archive"]["source_adapter_coverage"],
        }
        for item in ordered_inputs
        if isinstance(item.get("archive", {}).get("source_adapter_coverage"), dict)
    ]
    if source_coverage:
        if len(source_coverage) != len(ordered_inputs):
            raise ArrivalCorpusError(
                "Population corpus source coverage is missing for one or more seasons"
            )
        stable_content["source_adapter_coverage"] = source_coverage
    return stable_content


def _portable_path(path: Path, root: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(root.resolve()))
    except ValueError:
        return str(resolved)


def _resolve_path(value: str, root: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ArrivalCorpusError(f"Cannot read JSON evidence: {path}") from error
    if not isinstance(value, dict):
        raise ArrivalCorpusError(f"JSON evidence must contain an object: {path}")
    return value


def load_verified_dataset_manifest(
    path: Path, *, root: Path = ROOT
) -> tuple[dict[str, Any], str, str]:
    manifest = _read_json(path)
    manifest_address = manifest.get("manifest_sha256")
    if not isinstance(manifest_address, str):
        raise ArrivalCorpusError(f"Dataset manifest has no content address: {path}")
    canonical = dict(manifest)
    canonical.pop("manifest_sha256", None)
    if json_sha256(canonical) != manifest_address:
        raise ArrivalCorpusError(f"Dataset manifest content address is invalid: {path}")

    archived_manifest = path.parent / "manifests" / f"{manifest_address}.json"
    if not archived_manifest.exists() or file_sha256(archived_manifest) != file_sha256(path):
        raise ArrivalCorpusError(f"Dataset manifest archive is missing or differs: {path}")

    dataset_address = manifest.get("dataset_content_sha256")
    if not isinstance(dataset_address, str):
        raise ArrivalCorpusError(f"Dataset manifest has no stable dataset address: {path}")
    outputs = manifest.get("outputs")
    source_lock = manifest.get("source_lock")
    if not isinstance(outputs, dict) or not isinstance(source_lock, dict):
        raise ArrivalCorpusError(f"Dataset manifest is structurally incomplete: {path}")
    source_lock_value = source_lock.get("path")
    source_lock_sha256 = source_lock.get("sha256")
    if not isinstance(source_lock_value, str) or not isinstance(source_lock_sha256, str):
        raise ArrivalCorpusError(f"Dataset source lock is incomplete: {path}")
    source_lock_path = _resolve_path(source_lock_value, root)
    if (
        not source_lock_path.exists()
        or file_sha256(source_lock_path) != source_lock_sha256
    ):
        raise ArrivalCorpusError(f"Dataset source lock is missing or invalid: {path}")
    dataset_content = {
        "schema_version": manifest.get("schema_version"),
        "data_cutoff": manifest.get("data_cutoff"),
        "snapshot_policy": manifest.get("snapshot_policy"),
        "source_lock_sha256": source_lock_sha256,
        "outputs": {
            name: {"rows": output.get("rows"), "sha256": output.get("sha256")}
            for name, output in outputs.items()
            if isinstance(output, dict)
        },
    }
    if json_sha256(dataset_content) != dataset_address:
        raise ArrivalCorpusError(f"Stable dataset content address is invalid: {path}")
    return manifest, manifest_address, dataset_address


def _resolve_output(
    manifest: dict[str, Any],
    name: str,
    *,
    root: Path,
    dataset_address: str,
) -> tuple[Path, int, str]:
    output = manifest.get("outputs", {}).get(name)
    if not isinstance(output, dict):
        raise ArrivalCorpusError(f"Dataset manifest has no output named {name}")
    archived_value = output.get("content_addressed_path")
    expected_sha256 = output.get("sha256")
    expected_rows = output.get("rows")
    if not isinstance(archived_value, str) or not isinstance(expected_sha256, str):
        raise ArrivalCorpusError(f"Dataset output {name} has incomplete lineage")
    try:
        row_count = int(expected_rows)
    except (TypeError, ValueError) as error:
        raise ArrivalCorpusError(f"Dataset output {name} has an invalid row count") from error
    path = _resolve_path(archived_value, root)
    if path.parent.name != dataset_address or path.parent.parent.name != "datasets":
        raise ArrivalCorpusError(f"Dataset output {name} is not content-addressed")
    if not path.exists() or file_sha256(path) != expected_sha256:
        raise ArrivalCorpusError(f"Dataset output archive is missing or invalid: {name}")
    return path, row_count, expected_sha256


def verify_season_archive_lineage(
    manifest: dict[str, Any], season: int, *, root: Path = ROOT
) -> dict[str, Any]:
    risk_set = manifest.get("affiliated_risk_set")
    if not isinstance(risk_set, dict):
        raise ArrivalCorpusError("Dataset is missing its affiliated risk-set contract")
    if risk_set.get("effective_time_safe") is not True:
        raise ArrivalCorpusError("Affiliated risk-set features are not effective-time safe")
    if risk_set.get("contract_version") != RISK_SET_CONTRACT:
        raise ArrivalCorpusError("Dataset uses an unsupported affiliated risk-set contract")
    if risk_set.get("snapshot_policy") != RISK_SET_POLICY:
        raise ArrivalCorpusError("Dataset uses an unsupported affiliated snapshot policy")
    if risk_set.get("board_enrichment_policy") != "excluded_edition_only":
        raise ArrivalCorpusError("Population corpus cannot include edition-only board enrichment")

    lock_path = (
        root
        / "data/archive-locks/sports-reference-baseball-register"
        / f"{season}.json"
    )
    lock = _read_json(lock_path)
    if lock.get("schemaVersion") != ARCHIVE_LOCK_SCHEMA or lock.get("season") != season:
        raise ArrivalCorpusError(f"Archive lock does not match season {season}")

    run_evidence = lock.get("sourceRunManifest")
    if not isinstance(run_evidence, dict) or not isinstance(run_evidence.get("path"), str):
        raise ArrivalCorpusError(f"Archive lock has no source run for season {season}")
    run_path = _resolve_path(run_evidence["path"], root)
    expected_run_sha256 = run_evidence.get("sha256")
    if not isinstance(expected_run_sha256, str) or not run_path.exists():
        raise ArrivalCorpusError(f"Archived source run is missing for season {season}")
    if file_sha256(run_path) != expected_run_sha256:
        raise ArrivalCorpusError(f"Archived source run hash differs for season {season}")
    run = _read_json(run_path)
    if (
        run.get("schemaVersion") != SOURCE_RUN_SCHEMA
        or run.get("source") != "baseball-reference-register"
        or run.get("season") != season
        or run.get("parserVersion") not in SUPPORTED_SOURCE_RUN_PARSERS
        or run.get("status") != "complete"
    ):
        raise ArrivalCorpusError(f"Source run is not complete for season {season}")
    if run.get("error") is not None or run.get("coverage") != lock.get("coverage"):
        raise ArrivalCorpusError(f"Source run coverage differs from its lock for season {season}")
    coverage = run.get("coverage", {})
    if (
        coverage.get("structuralZeroSeason") is True
        or coverage.get("failedTeams") != 0
        or coverage.get("completedTeams") != coverage.get("declaredTeams")
    ):
        raise ArrivalCorpusError(f"Source run coverage is incomplete for season {season}")

    risk_quality = risk_set.get("quality")
    if not isinstance(risk_quality, dict):
        risk_quality = {}
    adapter_quality = risk_quality.get("source_adapter_quality")
    if not isinstance(adapter_quality, dict):
        adapter_quality = {}
    declared_team_pages = int(coverage["declaredTeams"])
    observed_team_pages = int(coverage["completedTeams"])
    appearance_data_team_pages = int(
        adapter_quality.get(
            "appearance_data_team_count",
            adapter_quality.get("observed_team_rows", observed_team_pages),
        )
    )
    declared_no_record_team_pages = int(
        adapter_quality.get(
            "declared_no_record_teams",
            observed_team_pages - appearance_data_team_pages,
        )
    )
    if (
        min(
            declared_team_pages,
            observed_team_pages,
            appearance_data_team_pages,
            declared_no_record_team_pages,
        )
        < 0
        or observed_team_pages != declared_team_pages
        or appearance_data_team_pages + declared_no_record_team_pages
        != observed_team_pages
    ):
        raise ArrivalCorpusError(
            f"Source adapter team coverage does not reconcile for season {season}"
        )

    permission = lock.get("permissionEvidence")
    if not isinstance(permission, dict) or not isinstance(permission.get("path"), str):
        raise ArrivalCorpusError(f"Archive lock has no permission evidence for season {season}")
    if run.get("permissionEvidence") != permission:
        raise ArrivalCorpusError(f"Source run permission differs from its lock for season {season}")
    permission_path = _resolve_path(permission["path"], root)
    if not permission_path.exists() or file_sha256(permission_path) != permission.get("sha256"):
        raise ArrivalCorpusError(f"Permission evidence differs for season {season}")

    raw_run_outputs = [
        output
        for output in run.get("outputs", [])
        if isinstance(output, dict) and isinstance(output.get("path"), str)
    ]
    output_paths = [str(output["path"]) for output in raw_run_outputs]
    if len(output_paths) != len(set(output_paths)):
        raise ArrivalCorpusError(f"Source run has duplicate output paths for season {season}")
    run_outputs = {str(output["path"]): output for output in raw_run_outputs}
    inputs = risk_set.get("inputs")
    if not isinstance(inputs, dict) or set(inputs) != EXPECTED_RISK_SET_INPUTS:
        raise ArrivalCorpusError(f"Risk-set input lineage is missing for season {season}")
    for name, evidence in inputs.items():
        if not isinstance(evidence, dict) or not isinstance(evidence.get("path"), str):
            raise ArrivalCorpusError(f"Risk-set input {name} has incomplete lineage")
        source_output = run_outputs.get(evidence["path"])
        if source_output is None:
            raise ArrivalCorpusError(
                f"Risk-set input {name} is absent from the locked source run"
            )
        for field in ("rows", "bytes", "sha256"):
            if evidence.get(field) != source_output.get(field):
                raise ArrivalCorpusError(
                    f"Risk-set input {name} differs from the locked source run: {field}"
                )
        input_path = _resolve_path(evidence["path"], root)
        if (
            not input_path.exists()
            or input_path.stat().st_size != evidence.get("bytes")
            or file_sha256(input_path) != evidence.get("sha256")
        ):
            raise ArrivalCorpusError(f"Risk-set input bytes differ: {name}")

    archive_manifest = lock.get("manifest")
    if not isinstance(archive_manifest, dict):
        raise ArrivalCorpusError(f"Archive lock has no immutable manifest for season {season}")
    archive_sha256 = archive_manifest.get("sha256")
    archive_pathname = archive_manifest.get("pathname")
    archive_bytes = archive_manifest.get("byteLength")
    expected_archive_pathname = (
        "raw/v1/sports-reference/baseball-register/sha256/"
        f"{str(archive_sha256)[:2]}/{archive_sha256}"
    )
    if (
        not isinstance(archive_sha256, str)
        or SHA256_PATTERN.fullmatch(archive_sha256) is None
        or archive_pathname != expected_archive_pathname
        or not isinstance(archive_bytes, int)
        or archive_bytes <= 0
        or archive_manifest.get("storageStatus") not in {"created", "verified"}
    ):
        raise ArrivalCorpusError(f"Immutable archive manifest is invalid for season {season}")
    request_receipts = run.get("requests")
    if not isinstance(request_receipts, list):
        raise ArrivalCorpusError(f"Source run request receipts are missing for season {season}")
    request_bytes = sum(
        int(receipt.get("byteLength", -1))
        for receipt in request_receipts
        if isinstance(receipt, dict)
    )
    if (
        run.get("inputCount") != lock.get("inputCount")
        or len(request_receipts) != lock.get("inputCount")
        or request_bytes != lock.get("inputBytes")
    ):
        raise ArrivalCorpusError(f"Raw archive input counts differ for season {season}")
    return {
        "season": season,
        "archive_lock_path": _portable_path(lock_path, root),
        "archive_lock_sha256": file_sha256(lock_path),
        "source_run_manifest_path": _portable_path(run_path, root),
        "source_run_manifest_sha256": expected_run_sha256,
        "raw_archive_manifest_pathname": archive_manifest["pathname"],
        "raw_archive_manifest_sha256": archive_manifest["sha256"],
        "raw_archive_input_count": lock.get("inputCount"),
        "raw_archive_input_bytes": lock.get("inputBytes"),
        "coverage": coverage,
        "source_adapter_coverage": {
            "declared_team_pages": declared_team_pages,
            "observed_team_pages": observed_team_pages,
            "appearance_data_team_pages": appearance_data_team_pages,
            "declared_no_record_team_pages": declared_no_record_team_pages,
        },
    }


def _write_parquet(frame: pd.DataFrame, path: Path) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    frame.to_parquet(temporary, index=False)
    temporary.replace(path)
    return {
        "path": str(path),
        "rows": int(len(frame)),
        "sha256": file_sha256(path),
    }


def _validate_label_semantics(
    labels: pd.DataFrame, *, expected_cutoff: str, season: int
) -> None:
    cutoff = pd.Timestamp(expected_cutoff)
    label_cutoffs = pd.to_datetime(labels["data_cutoff"], errors="coerce")
    if label_cutoffs.isna().any() or not label_cutoffs.eq(cutoff).all():
        raise ArrivalCorpusError(
            f"Season {season} label cutoffs differ from the dataset manifest"
        )
    as_of = pd.to_datetime(labels["as_of"], errors="coerce")
    raw_debut = labels["debut_date"]
    debut = pd.to_datetime(raw_debut, errors="coerce")
    if as_of.isna().any() or (raw_debut.notna() & debut.isna()).any():
        raise ArrivalCorpusError(f"Season {season} contains invalid label landmarks")
    if as_of.gt(cutoff).any():
        raise ArrivalCorpusError(f"Season {season} has labels after the outcome cutoff")
    if (debut.notna() & (debut.le(as_of) | debut.gt(cutoff))).any():
        raise ArrivalCorpusError(
            f"Season {season} contains a debut outside the observable label window"
        )
    expected_censor_state = pd.Series(
        "right_censored", index=labels.index, dtype="object"
    )
    expected_censor_state.loc[debut.notna()] = "event"
    if labels["censor_state"].astype(str).ne(expected_censor_state).any():
        raise ArrivalCorpusError(f"Season {season} has inconsistent censor states")

    for months in SURVIVAL_HORIZON_MONTHS:
        observed_column = f"observed_{months}m"
        event_column = f"debut_within_{months}m"
        if observed_column not in labels or event_column not in labels:
            raise ArrivalCorpusError(
                f"Season {season} labels are missing the {months}-month horizon"
            )
        horizon_end = as_of + pd.DateOffset(months=months)
        expected_event = debut.notna() & debut.le(horizon_end)
        expected_observed = expected_event | horizon_end.le(cutoff)
        observed = labels[observed_column].astype("boolean")
        event = labels[event_column].astype("boolean")
        if observed.isna().any() or not observed.eq(expected_observed).all():
            raise ArrivalCorpusError(
                f"Season {season} has inconsistent {months}-month observation states"
            )
        if not event.loc[expected_observed].eq(expected_event.loc[expected_observed]).all():
            raise ArrivalCorpusError(
                f"Season {season} has inconsistent {months}-month event labels"
            )
        if event.loc[~expected_observed].notna().any():
            raise ArrivalCorpusError(
                f"Season {season} labels an unobserved {months}-month outcome"
            )


def _validate_snapshot_semantics(snapshots: pd.DataFrame, *, season: int) -> None:
    if not set(DOMAIN_STAT_FEATURES).issubset(snapshots.columns):
        raise ArrivalCorpusError(f"Season {season} is missing domain-stat features")
    for column in ("effective_time_safe", "model_eligible", "has_prior_stats"):
        if (
            column not in snapshots
            or not is_bool_dtype(snapshots[column].dtype)
            or snapshots[column].isna().any()
        ):
            raise ArrivalCorpusError(f"Season {season} has an invalid {column} contract")
    if not snapshots["effective_time_safe"].eq(True).all():
        raise ArrivalCorpusError(f"Season {season} is not effective-time safe")
    if not snapshots["model_eligible"].eq(True).all():
        raise ArrivalCorpusError(f"Season {season} contains model-ineligible snapshots")
    if snapshots["model_exclusion_reason"].notna().any():
        raise ArrivalCorpusError(f"Season {season} contains model exclusion reasons")

    exact_values = {
        "cohort_basis": "season_appearance",
        "coverage_scope": "all_affiliated_season_participants_on_observed_teams",
        "source_universe_scope": "full_season_appearance_census",
        "model_analysis_scope": "mlb_naive_outcome_linked_supported_features",
        "feature_support_status": "supported",
        "board_feature_availability": "excluded_edition_only",
    }
    for column, expected in exact_values.items():
        if column not in snapshots or not snapshots[column].eq(expected).all():
            raise ArrivalCorpusError(f"Season {season} has an invalid {column} scope")
    if (
        "on_fangraphs_board" not in snapshots
        or not is_bool_dtype(snapshots["on_fangraphs_board"].dtype)
        or snapshots["on_fangraphs_board"].isna().any()
        or snapshots["on_fangraphs_board"].any()
        or snapshots["fangraphs_snapshot_id"].notna().any()
    ):
        raise ArrivalCorpusError(f"Season {season} contains forbidden board enrichment")

    edition = pd.to_numeric(snapshots["edition"], errors="coerce")
    as_of = pd.to_datetime(snapshots["as_of"], errors="coerce")
    if (
        not is_integer_dtype(snapshots["edition"].dtype)
        or edition.isna().any()
        or as_of.isna().any()
        or not edition.eq(season).all()
        or not as_of.dt.year.eq(edition).all()
    ):
        raise ArrivalCorpusError(f"Season {season} has inconsistent snapshot landmarks")
    prior_season = pd.to_numeric(snapshots["prior_season"], errors="coerce")
    prior_through = pd.to_datetime(snapshots["prior_stats_through"], errors="coerce")
    has_prior = snapshots["has_prior_stats"]
    if (
        prior_season.loc[has_prior].isna().any()
        or prior_through.loc[has_prior].isna().any()
        or prior_season.loc[has_prior].gt(edition.loc[has_prior]).any()
        or prior_through.loc[has_prior].gt(as_of.loc[has_prior]).any()
        or not prior_through.loc[has_prior].dt.year.eq(prior_season.loc[has_prior]).all()
        or prior_season.loc[~has_prior].notna().any()
        or prior_through.loc[~has_prior].notna().any()
    ):
        raise ArrivalCorpusError(f"Season {season} has inconsistent prior-stat landmarks")
    for role, pairs in ROLE_ALIAS_PAIRS.items():
        role_rows = snapshots["role"].eq(role)
        for generic, domain in pairs:
            generic_values = pd.to_numeric(
                snapshots.loc[role_rows, generic], errors="coerce"
            )
            domain_values = pd.to_numeric(
                snapshots.loc[role_rows, domain], errors="coerce"
            )
            if (
                generic_values.isna().ne(domain_values.isna()).any()
                or not generic_values.dropna().eq(domain_values.dropna()).all()
            ):
                raise ArrivalCorpusError(
                    f"Season {season} has inconsistent aliases: {generic}/{domain}"
                )


def build_arrival_corpus(
    dataset_manifests: list[Path], output_dir: Path, *, root: Path = ROOT
) -> dict[str, Any]:
    if len(dataset_manifests) < 2:
        raise ArrivalCorpusError("Population corpus requires at least two season manifests")

    snapshot_frames: list[pd.DataFrame] = []
    label_frames: list[pd.DataFrame] = []
    input_lineage: list[dict[str, Any]] = []
    observed_seasons: set[int] = set()
    data_cutoffs: set[str] = set()
    snapshot_schema: list[tuple[str, str]] | None = None
    label_schema: list[tuple[str, str]] | None = None

    for manifest_path in dataset_manifests:
        manifest, manifest_address, dataset_address = load_verified_dataset_manifest(
            manifest_path, root=root
        )
        snapshot_path, expected_snapshots, snapshot_sha256 = _resolve_output(
            manifest,
            SNAPSHOT_OUTPUT,
            root=root,
            dataset_address=dataset_address,
        )
        label_path, expected_labels, label_sha256 = _resolve_output(
            manifest,
            LABEL_OUTPUT,
            root=root,
            dataset_address=dataset_address,
        )
        snapshots = pd.read_parquet(snapshot_path)
        labels = pd.read_parquet(label_path)
        if len(snapshots) != expected_snapshots or len(labels) != expected_labels:
            raise ArrivalCorpusError("Dataset output row count differs from its manifest")
        required_snapshot_columns = {
            "snapshot_id",
            "player_id",
            "edition",
            "as_of",
            "role",
            "effective_time_safe",
        }
        required_label_columns = {"snapshot_id", "player_id", "as_of", "data_cutoff"}
        if not required_snapshot_columns.issubset(snapshots.columns):
            raise ArrivalCorpusError("Affiliated snapshots are missing required columns")
        if not required_label_columns.issubset(labels.columns):
            raise ArrivalCorpusError("Affiliated labels are missing required columns")
        assert_feature_contract(snapshots.columns.tolist())
        current_snapshot_schema = [
            (column, str(dtype)) for column, dtype in snapshots.dtypes.items()
        ]
        current_label_schema = [(column, str(dtype)) for column, dtype in labels.dtypes.items()]
        if snapshot_schema is None:
            snapshot_schema = current_snapshot_schema
            label_schema = current_label_schema
        elif current_snapshot_schema != snapshot_schema or current_label_schema != label_schema:
            raise ArrivalCorpusError(
                "An affiliated cohort schema differs from the other population cohorts"
            )
        editions = pd.to_numeric(snapshots["edition"], errors="coerce").dropna().unique()
        if len(editions) != 1:
            raise ArrivalCorpusError("Each affiliated dataset must contain exactly one season")
        season = int(editions[0])
        if season in observed_seasons:
            raise ArrivalCorpusError(f"Duplicate affiliated season: {season}")
        observed_seasons.add(season)
        if snapshots["player_id"].isna().any():
            raise ArrivalCorpusError(f"Season {season} contains unsupported population rows")
        _validate_snapshot_semantics(snapshots, season=season)
        _validate_label_semantics(
            labels,
            expected_cutoff=str(manifest.get("data_cutoff")),
            season=season,
        )
        archive_lineage = verify_season_archive_lineage(manifest, season, root=root)
        data_cutoffs.add(str(manifest.get("data_cutoff")))
        snapshot_frames.append(snapshots)
        label_frames.append(labels)
        input_lineage.append(
            {
                "season": season,
                "dataset_manifest_path": _portable_path(manifest_path, root),
                "dataset_manifest_sha256": file_sha256(manifest_path),
                "dataset_manifest_content_address": manifest_address,
                "dataset_content_sha256": dataset_address,
                "snapshots_sha256": snapshot_sha256,
                "labels_sha256": label_sha256,
                "archive": archive_lineage,
            }
        )

    if len(data_cutoffs) != 1:
        raise ArrivalCorpusError("Population corpus inputs must share one outcome cutoff")
    snapshots = pd.concat(snapshot_frames, ignore_index=True)
    labels = pd.concat(label_frames, ignore_index=True)
    snapshots["as_of"] = pd.to_datetime(snapshots["as_of"])
    labels["as_of"] = pd.to_datetime(labels["as_of"])
    if snapshots["snapshot_id"].duplicated(keep=False).any():
        raise ArrivalCorpusError("Population corpus contains duplicate snapshot IDs")
    if labels["snapshot_id"].duplicated(keep=False).any():
        raise ArrivalCorpusError("Population corpus contains duplicate label snapshot IDs")
    keys = ["snapshot_id", "player_id", "as_of"]
    joined = snapshots[keys].merge(labels[keys], on=keys, how="outer", indicator=True)
    if joined["_merge"].ne("both").any() or len(joined) != len(snapshots):
        raise ArrivalCorpusError("Population snapshots and labels do not align one-to-one")

    snapshots = snapshots.sort_values(["edition", "snapshot_id"], kind="mergesort")
    labels = labels.assign(
        edition=labels["snapshot_id"].map(snapshots.set_index("snapshot_id")["edition"])
    ).sort_values(["edition", "snapshot_id"], kind="mergesort")
    labels = labels.drop(columns=["edition"])

    live_snapshots = _write_parquet(snapshots, output_dir / "snapshots.parquet")
    live_labels = _write_parquet(labels, output_dir / "labels.parquet")
    source_coverage_by_season = [
        {
            "season": item["season"],
            **item["archive"]["source_adapter_coverage"],
        }
        for item in sorted(input_lineage, key=lambda x: x["season"])
    ]
    source_coverage = {
        "declared_team_pages": sum(
            item["declared_team_pages"] for item in source_coverage_by_season
        ),
        "observed_team_pages": sum(
            item["observed_team_pages"] for item in source_coverage_by_season
        ),
        "appearance_data_team_pages": sum(
            item["appearance_data_team_pages"] for item in source_coverage_by_season
        ),
        "declared_no_record_team_pages": sum(
            item["declared_no_record_team_pages"]
            for item in source_coverage_by_season
        ),
        "seasons_with_declared_no_record_pages": [
            item["season"]
            for item in source_coverage_by_season
            if item["declared_no_record_team_pages"] > 0
        ],
    }
    stable_content = corpus_stable_content(
        {
            "schema_version": CORPUS_SCHEMA_VERSION,
            "data_cutoff": next(iter(data_cutoffs)),
            "snapshot_policy": "affiliated-season-appearance-effective-time-v1",
            "inputs": input_lineage,
            "outputs": {
                "snapshots": {
                    "rows": live_snapshots["rows"],
                    "sha256": live_snapshots["sha256"],
                },
                "labels": {
                    "rows": live_labels["rows"],
                    "sha256": live_labels["sha256"],
                },
            },
        }
    )
    corpus_address = json_sha256(stable_content)
    archive_dir = output_dir / "datasets" / corpus_address
    archive_dir.mkdir(parents=True, exist_ok=True)
    for name, live in (("snapshots", live_snapshots), ("labels", live_labels)):
        archived_path = archive_dir / f"{name}.parquet"
        if archived_path.exists() and file_sha256(archived_path) != live["sha256"]:
            raise ArrivalCorpusError(f"Content-addressed corpus output differs: {name}")
        if not archived_path.exists():
            shutil.copyfile(Path(live["path"]), archived_path)
        live["path"] = _portable_path(Path(live["path"]), root)
        live["content_addressed_path"] = _portable_path(archived_path, root)

    player_counts = snapshots.groupby("player_id")["snapshot_id"].nunique()
    summary = {
        "seasons": sorted(observed_seasons),
        "snapshots": int(len(snapshots)),
        "players": int(snapshots["player_id"].nunique()),
        "repeat_players": int(player_counts.gt(1).sum()),
        "roles": {
            str(role): int(count)
            for role, count in snapshots["role"].value_counts().sort_index().items()
        },
        "mature_60m_rows": int(
            labels.get("observed_60m", pd.Series(False, index=labels.index)).sum()
        ),
        "debut_within_60m": int(
            labels.get("debut_within_60m", pd.Series(False, index=labels.index)).sum()
        ),
    }
    input_lineage.sort(key=lambda item: item["season"])
    manifest: dict[str, Any] = {
        "schema_version": CORPUS_SCHEMA_VERSION,
        "built_at": datetime.now().astimezone().isoformat(),
        "status": "research_population_corpus_not_release_eligible",
        "data_cutoff": next(iter(data_cutoffs)),
        "snapshot_policy": stable_content["snapshot_policy"],
        "corpus_content_sha256": corpus_address,
        "summary": summary,
        "source_coverage": source_coverage,
        "inputs": input_lineage,
        "outputs": {"snapshots": live_snapshots, "labels": live_labels},
        "producer": producer_metadata(
            root,
            [Path(__file__), root / "modeling/provenance.py"],
            {
                "dataset_manifests": [
                    _portable_path(path, root) for path in dataset_manifests
                ],
                "output_dir": _portable_path(output_dir, root),
            },
        ),
        "release_blockers": [
            "The source universe is a season-appearance census, not a contract-roster census.",
            "Historical values are effective-time safe but knowledge-time unverified.",
            "Population-model temporal calibration and locked holdout gates have not passed.",
        ],
    }
    manifest_address = json_sha256(manifest)
    manifest["manifest_sha256"] = manifest_address
    body = json.dumps(manifest, indent=2, default=str) + "\n"
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "corpus_manifest.json"
    manifest_archive = output_dir / "manifests" / f"{manifest_address}.json"
    manifest_archive.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(body)
    manifest_archive.write_text(body)
    return manifest


def discover_locked_dataset_manifests(*, root: Path = ROOT) -> list[Path]:
    lock_directory = root / "data/archive-locks/sports-reference-baseball-register"
    manifests: list[tuple[int, Path]] = []
    for lock_path in lock_directory.glob("*.json"):
        lock = _read_json(lock_path)
        season = lock.get("season")
        if not isinstance(season, int) or lock.get("coverage", {}).get(
            "structuralZeroSeason"
        ) is True:
            continue
        manifest_path = (
            root / "data/processed" / f"model-v1-bref-{season}" / "dataset_manifest.json"
        )
        if manifest_path.exists():
            manifests.append((season, manifest_path))
    return [path for _, path in sorted(manifests)]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a verified, content-addressed affiliated arrival corpus"
    )
    parser.add_argument("--dataset-manifest", type=Path, action="append", default=[])
    parser.add_argument("--discover-locked-seasons", action="store_true")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "data/processed/arrival-population-v1",
    )
    args = parser.parse_args()
    dataset_manifests = list(args.dataset_manifest)
    if args.discover_locked_seasons:
        discovered = discover_locked_dataset_manifests()
        known = {path.resolve() for path in dataset_manifests}
        dataset_manifests.extend(path for path in discovered if path.resolve() not in known)
    manifest = build_arrival_corpus(dataset_manifests, args.output_dir)
    print(
        json.dumps(
            {
                "manifest": str(args.output_dir / "corpus_manifest.json"),
                "manifest_sha256": manifest["manifest_sha256"],
                "corpus_content_sha256": manifest["corpus_content_sha256"],
                "summary": manifest["summary"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
