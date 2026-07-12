import json
from pathlib import Path

import pandas as pd
import pytest

import modeling.arrival_corpus as arrival_corpus
from modeling.arrival_corpus import ArrivalCorpusError, build_arrival_corpus
from modeling.contracts import CATEGORICAL_FEATURES, NUMERIC_FEATURES, SURVIVAL_HORIZON_MONTHS
from modeling.provenance import file_sha256, json_sha256
from modeling.risk_set import DOMAIN_STAT_FEATURES


DATA_CUTOFF = "2025-12-31"


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def _fixture_path(path: Path, root: Path) -> str:
    return str(path.relative_to(root))


def _make_season_dataset(
    root: Path,
    season: int,
    *,
    snapshot_id: str | None = None,
    player_id: str = "shared-player",
    debut_within_60m: bool = False,
    label_cutoff: str = DATA_CUTOFF,
    effective_time_safe: bool | str = True,
    drop_snapshot_feature: str | None = None,
) -> dict[str, Path]:
    permission_path = root / "docs/permissions/research-source-attestation.md"
    permission_path.parent.mkdir(parents=True, exist_ok=True)
    permission_path.write_text("Synthetic research permission evidence.\n")
    source_lock_path = root / "data/source-lock.json"
    source_lock_path.parent.mkdir(parents=True, exist_ok=True)
    if not source_lock_path.exists():
        source_lock_path.write_text('{"schemaVersion":"synthetic-source-lock/v1"}\n')

    raw_input = root / f"data/raw/register/{season}/batting.csv"
    raw_input.parent.mkdir(parents=True, exist_ok=True)
    raw_input.write_text(f"player_id,plate_appearances\n{player_id},100\n")
    input_evidence = {
        "path": _fixture_path(raw_input, root),
        "rows": 1,
        "bytes": raw_input.stat().st_size,
        "sha256": file_sha256(raw_input),
    }
    coverage = {
        "structuralZeroSeason": False,
        "structuralReason": None,
        "declaredTeams": 1,
        "affiliateSlots": 1,
        "discoveredTeams": 1,
        "completedTeams": 1,
        "failedTeams": 0,
    }
    run_path = root / f"data/manifests/runs/register-{season}.json"
    source_run = {
        "schemaVersion": arrival_corpus.SOURCE_RUN_SCHEMA,
        "source": "baseball-reference-register",
        "season": season,
        "parserVersion": arrival_corpus.SOURCE_RUN_PARSER,
        "status": "complete",
        "error": None,
        "coverage": coverage,
        "permissionEvidence": {
            "path": _fixture_path(permission_path, root),
            "sha256": file_sha256(permission_path),
        },
        "inputCount": 1,
        "requests": [{"byteLength": raw_input.stat().st_size}],
        "outputs": [input_evidence],
    }
    _write_json(run_path, source_run)

    archive_lock = {
        "schemaVersion": arrival_corpus.ARCHIVE_LOCK_SCHEMA,
        "season": season,
        "sourceRunManifest": {
            "path": _fixture_path(run_path, root),
            "sha256": file_sha256(run_path),
        },
        "permissionEvidence": {
            "path": _fixture_path(permission_path, root),
            "sha256": file_sha256(permission_path),
        },
        "coverage": coverage,
        "inputCount": 1,
        "inputBytes": raw_input.stat().st_size,
        "manifest": {
            "sha256": f"{season:064x}",
            "byteLength": 512,
            "mediaType": "application/json",
            "pathname": (
                "raw/v1/sports-reference/baseball-register/sha256/"
                f"{f'{season:064x}'[:2]}/{season:064x}"
            ),
            "storageStatus": "created",
        },
    }
    lock_path = (
        root
        / "data/archive-locks/sports-reference-baseball-register"
        / f"{season}.json"
    )
    _write_json(lock_path, archive_lock)

    row_snapshot_id = snapshot_id or f"snapshot-{season}-{player_id}"
    as_of = f"{season}-12-31"
    snapshot = {
        column: None
        for column in set(NUMERIC_FEATURES + CATEGORICAL_FEATURES + list(DOMAIN_STAT_FEATURES))
    }
    snapshot.update(
        {
            "snapshot_id": row_snapshot_id,
            "player_id": player_id,
            "edition": season,
            "as_of": pd.Timestamp(as_of),
            "role": "hitter",
            "age": 20.0,
            "effective_time_safe": effective_time_safe,
            "model_eligible": True,
            "model_exclusion_reason": None,
            "has_prior_stats": True,
            "prior_season": season,
            "prior_stats_through": pd.Timestamp(f"{season}-09-01"),
            "cohort_basis": "season_appearance",
            "coverage_scope": "all_affiliated_season_participants_on_observed_teams",
            "source_universe_scope": "full_season_appearance_census",
            "model_analysis_scope": "mlb_naive_outcome_linked_supported_features",
            "feature_support_status": "supported",
            "board_feature_availability": "excluded_edition_only",
            "on_fangraphs_board": False,
            "fangraphs_snapshot_id": None,
        }
    )
    if drop_snapshot_feature is not None:
        snapshot.pop(drop_snapshot_feature)
    snapshots = pd.DataFrame([snapshot])
    debut_date = pd.Timestamp(f"{season + 1}-06-30") if debut_within_60m else pd.NaT
    label = {
        "snapshot_id": row_snapshot_id,
        "player_id": player_id,
        "as_of": pd.Timestamp(as_of),
        "debut_date": debut_date,
        "debut_source": "synthetic" if debut_within_60m else None,
        "data_cutoff": pd.Timestamp(label_cutoff),
        "censor_state": "event" if debut_within_60m else "right_censored",
    }
    for months in SURVIVAL_HORIZON_MONTHS:
        label[f"observed_{months}m"] = True
        label[f"debut_within_{months}m"] = debut_within_60m
    labels = pd.DataFrame([label])
    staging_dir = root / f"staging/{season}"
    staging_dir.mkdir(parents=True, exist_ok=True)
    staged_snapshots = staging_dir / "snapshots.parquet"
    staged_labels = staging_dir / "labels.parquet"
    snapshots.to_parquet(staged_snapshots, index=False)
    labels.to_parquet(staged_labels, index=False)

    output_hashes = {
        arrival_corpus.SNAPSHOT_OUTPUT: file_sha256(staged_snapshots),
        arrival_corpus.LABEL_OUTPUT: file_sha256(staged_labels),
    }
    dataset_content = {
        "schema_version": "arrival-dataset/v1",
        "data_cutoff": DATA_CUTOFF,
        "snapshot_policy": "affiliated-season-appearance-effective-time-v1",
        "source_lock_sha256": file_sha256(source_lock_path),
        "outputs": {
            arrival_corpus.SNAPSHOT_OUTPUT: {
                "rows": 1,
                "sha256": output_hashes[arrival_corpus.SNAPSHOT_OUTPUT],
            },
            arrival_corpus.LABEL_OUTPUT: {
                "rows": 1,
                "sha256": output_hashes[arrival_corpus.LABEL_OUTPUT],
            },
        },
    }
    dataset_address = json_sha256(dataset_content)
    dataset_dir = root / f"data/processed/{season}/datasets/{dataset_address}"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    archived_snapshots = dataset_dir / "affiliated-risk-set-snapshots.parquet"
    archived_labels = dataset_dir / "affiliated-arrival-labels.parquet"
    archived_snapshots.write_bytes(staged_snapshots.read_bytes())
    archived_labels.write_bytes(staged_labels.read_bytes())

    outputs = {
        arrival_corpus.SNAPSHOT_OUTPUT: {
            "rows": 1,
            "sha256": output_hashes[arrival_corpus.SNAPSHOT_OUTPUT],
            "content_addressed_path": _fixture_path(archived_snapshots, root),
        },
        arrival_corpus.LABEL_OUTPUT: {
            "rows": 1,
            "sha256": output_hashes[arrival_corpus.LABEL_OUTPUT],
            "content_addressed_path": _fixture_path(archived_labels, root),
        },
    }
    dataset_manifest = {
        "schema_version": dataset_content["schema_version"],
        "built_at": "2026-07-12T00:00:00-04:00",
        "data_cutoff": DATA_CUTOFF,
        "snapshot_policy": dataset_content["snapshot_policy"],
        "source_lock": {
            "path": _fixture_path(source_lock_path, root),
            "sha256": dataset_content["source_lock_sha256"],
        },
        "outputs": outputs,
        "dataset_content_sha256": dataset_address,
        "affiliated_risk_set": {
            "effective_time_safe": True,
            "contract_version": arrival_corpus.RISK_SET_CONTRACT,
            "snapshot_policy": arrival_corpus.RISK_SET_POLICY,
            "board_enrichment_policy": "excluded_edition_only",
            "inputs": {
                name: input_evidence for name in arrival_corpus.EXPECTED_RISK_SET_INPUTS
            },
        },
    }
    dataset_manifest["manifest_sha256"] = json_sha256(dataset_manifest)
    manifest_path = root / f"data/processed/{season}/dataset_manifest.json"
    archived_manifest = (
        manifest_path.parent
        / "manifests"
        / f"{dataset_manifest['manifest_sha256']}.json"
    )
    _write_json(manifest_path, dataset_manifest)
    _write_json(archived_manifest, dataset_manifest)
    return {
        "manifest": manifest_path,
        "lock": lock_path,
        "run": run_path,
        "raw_input": raw_input,
        "snapshot_output": archived_snapshots,
        "source_lock": source_lock_path,
    }


def test_builds_verified_multi_season_corpus(tmp_path, monkeypatch) -> None:
    first = _make_season_dataset(tmp_path, 2018, debut_within_60m=True)
    second = _make_season_dataset(tmp_path, 2019)
    monkeypatch.setattr(
        arrival_corpus,
        "producer_metadata",
        lambda *_args, **_kwargs: {"fixture": "synthetic"},
    )

    output_dir = tmp_path / "data/processed/arrival-corpus"
    manifest = build_arrival_corpus(
        [second["manifest"], first["manifest"]], output_dir, root=tmp_path
    )

    assert manifest["summary"] == {
        "seasons": [2018, 2019],
        "snapshots": 2,
        "players": 1,
        "repeat_players": 1,
        "roles": {"hitter": 2},
        "mature_60m_rows": 2,
        "debut_within_60m": 1,
    }
    assert [item["season"] for item in manifest["inputs"]] == [2018, 2019]
    assert manifest["status"] == "research_population_corpus_not_release_eligible"

    live_manifest = output_dir / "corpus_manifest.json"
    archived_manifest = output_dir / "manifests" / f"{manifest['manifest_sha256']}.json"
    assert file_sha256(live_manifest) == file_sha256(archived_manifest)
    assert json_sha256(
        {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    ) == manifest["manifest_sha256"]
    snapshots = pd.read_parquet(output_dir / "snapshots.parquet")
    assert snapshots["edition"].tolist() == [2018, 2019]
    for output in manifest["outputs"].values():
        assert (tmp_path / output["content_addressed_path"]).is_file()


def test_rejects_duplicate_season(tmp_path) -> None:
    season = _make_season_dataset(tmp_path, 2018)

    with pytest.raises(ArrivalCorpusError, match="Duplicate affiliated season: 2018"):
        build_arrival_corpus(
            [season["manifest"], season["manifest"]],
            tmp_path / "corpus",
            root=tmp_path,
        )


def test_rejects_duplicate_snapshot_id_across_seasons(tmp_path) -> None:
    first = _make_season_dataset(tmp_path, 2018, snapshot_id="duplicate-snapshot")
    second = _make_season_dataset(tmp_path, 2019, snapshot_id="duplicate-snapshot")

    with pytest.raises(ArrivalCorpusError, match="duplicate snapshot IDs"):
        build_arrival_corpus(
            [first["manifest"], second["manifest"]],
            tmp_path / "corpus",
            root=tmp_path,
        )


def test_rejects_label_cutoff_that_differs_from_manifest(tmp_path) -> None:
    first = _make_season_dataset(tmp_path, 2018, label_cutoff="2099-12-31")
    second = _make_season_dataset(tmp_path, 2019, label_cutoff="2099-12-31")

    with pytest.raises(ArrivalCorpusError, match="label cutoffs differ"):
        build_arrival_corpus(
            [first["manifest"], second["manifest"]],
            tmp_path / "corpus",
            root=tmp_path,
        )


def test_rejects_feature_schema_drift_and_truthy_safety_strings(tmp_path) -> None:
    complete = _make_season_dataset(tmp_path, 2018)
    missing = _make_season_dataset(
        tmp_path, 2019, drop_snapshot_feature="prior_k_rate"
    )
    with pytest.raises(ValueError, match="Missing declared feature columns"):
        build_arrival_corpus(
            [complete["manifest"], missing["manifest"]],
            tmp_path / "missing-feature-corpus",
            root=tmp_path,
        )

    false_string_first = _make_season_dataset(
        tmp_path / "truthy", 2018, effective_time_safe="False"
    )
    false_string_second = _make_season_dataset(
        tmp_path / "truthy", 2019, effective_time_safe="False"
    )
    with pytest.raises(ArrivalCorpusError, match="invalid effective_time_safe"):
        build_arrival_corpus(
            [false_string_first["manifest"], false_string_second["manifest"]],
            tmp_path / "truthy/corpus",
            root=tmp_path / "truthy",
        )


@pytest.mark.parametrize(
    ("tampered_path", "expected_error"),
    [
        ("snapshot_output", "Dataset output archive is missing or invalid"),
        ("source_lock", "Dataset source lock is missing or invalid"),
        ("run", "Archived source run hash differs"),
        ("raw_input", "Risk-set input bytes differ"),
    ],
)
def test_rejects_tampered_archive_and_run_lineage(
    tmp_path, tampered_path: str, expected_error: str
) -> None:
    first = _make_season_dataset(tmp_path, 2018)
    second = _make_season_dataset(tmp_path, 2019)
    with first[tampered_path].open("ab") as handle:
        handle.write(b"tampered")

    with pytest.raises(ArrivalCorpusError, match=expected_error):
        build_arrival_corpus(
            [first["manifest"], second["manifest"]],
            tmp_path / "corpus",
            root=tmp_path,
        )
