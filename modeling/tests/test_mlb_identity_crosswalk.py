from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from scripts.model.export_mlb_identity_crosswalk import (
    CHADWICK_VERSION,
    EXPECTED_CHADWICK_SHARDS,
    build_artifact,
    file_sha256,
)


HEADER = ["key_person", "key_mlbam", "key_bbref", "mlb_played_first", "mlb_played_last"]


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n", encoding="utf-8")


def fixture(
    root: Path,
    extra_chadwick_rows: list[dict[str, str]] | None = None,
) -> dict[str, Path]:
    chadwick_dir = root / "data/raw/chadwick-register" / CHADWICK_VERSION / "data"
    chadwick_dir.mkdir(parents=True)
    rows = [
        {
            "key_person": "00000001",
            "key_mlbam": "100",
            "key_bbref": "exactaa01",
            "mlb_played_first": "2020",
            "mlb_played_last": "2025",
        },
        {
            "key_person": "00000002",
            "key_mlbam": "101",
            "key_bbref": "",
            "mlb_played_first": "2024",
            "mlb_played_last": "2024",
        },
        {
            "key_person": "00000003",
            "key_mlbam": "102",
            "key_bbref": "futureaa01",
            "mlb_played_first": "",
            "mlb_played_last": "",
        },
        {
            "key_person": "00000004",
            "key_mlbam": "103",
            "key_bbref": "",
            "mlb_played_first": "",
            "mlb_played_last": "",
        },
        *(extra_chadwick_rows or []),
    ]
    for index, name in enumerate(EXPECTED_CHADWICK_SHARDS):
        with (chadwick_dir / name).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=HEADER)
            writer.writeheader()
            if index == 0:
                writer.writerows(rows)

    source_lock_path = root / "data/source-lock.json"
    resources = {}
    for name in EXPECTED_CHADWICK_SHARDS:
        path = chadwick_dir / name
        resources[f"data/{name}"] = {
            "bytes": path.stat().st_size,
            "sha256": file_sha256(path),
        }
    write_json(
        source_lock_path,
        {
            "schemaVersion": 1,
            "sources": {
                "chadwick-register": {
                    "version": CHADWICK_VERSION,
                    "resources": resources,
                }
            },
        },
    )

    player_seasons_path = root / "data/processed/baseball-reference-mlb-war/player_seasons.json"
    player_seasons = [
        {"bbref_id": "exactaa01", "season": 2020, "player_name": "Not Used"},
        {"bbref_id": "exactaa01", "season": 2026, "player_name": "Still Not Used"},
        {"bbref_id": "o'bermi01", "season": 2025, "player_name": "Exact A"},
        {"bbref_id": "newdebut01", "season": 2026, "player_name": "Not Used"},
    ]
    write_json(player_seasons_path, player_seasons)
    coverage = {
        "startSeason": 1871,
        "endSeason": 2026,
        "latestCompleteSeason": 2025,
        "mutableSeasons": [2026],
        "plannedUnits": 1,
        "completedUnits": 1,
        "failedUnits": 0,
        "complete": True,
    }
    manifest_path = root / "data/processed/baseball-reference-mlb-war/manifest.json"
    write_json(
        manifest_path,
        {
            "schemaVersion": "baseball-reference-mlb-war-dataset/v1",
            "coverage": coverage,
        },
    )
    reference_lock_path = root / "data/reference-locks/baseball-reference-mlb-war.json"
    write_json(
        reference_lock_path,
        {
            "schemaVersion": "baseball-reference-mlb-war-reference-lock/v1",
            "createdAt": "2026-07-12T18:30:20.537Z",
            "coverage": coverage,
            "outputs": [
                {
                    "path": "data/processed/baseball-reference-mlb-war/player_seasons.json",
                    "rowCount": len(player_seasons),
                    "byteLength": player_seasons_path.stat().st_size,
                    "sha256": file_sha256(player_seasons_path),
                }
            ],
            "datasetManifest": {
                "path": "data/processed/baseball-reference-mlb-war/manifest.json",
                "sha256": file_sha256(manifest_path),
            },
        },
    )
    return {
        "chadwick_dir": chadwick_dir,
        "source_lock_path": source_lock_path,
        "player_seasons_path": player_seasons_path,
        "player_seasons_manifest_path": manifest_path,
        "bref_reference_lock_path": reference_lock_path,
    }


def build(root: Path, paths: dict[str, Path]) -> dict[str, object]:
    return build_artifact(root=root, **paths)


def test_exports_only_exact_identifiers_and_prefers_bref_season_evidence(
    tmp_path: Path,
) -> None:
    artifact = build(tmp_path, fixture(tmp_path))

    assert artifact["recordCount"] == 3
    assert artifact["records"] == [
        [100, "exactaa01", 2020, 2026, "bref"],
        [101, None, 2024, 2024, "chadwick"],
        [102, "futureaa01", None, None, None],
    ]
    assert artifact["coverage"] == {
        "recordsWithBbref": 2,
        "baseballReferenceSeasonEvidence": 1,
        "chadwickSeasonEvidence": 1,
        "crosswalkOnly": 1,
    }
    assert artifact["identityPolicy"] == "exact_mlbam_bbref_only_no_name_matching"


@pytest.mark.parametrize(
    "duplicate",
    [
        {
            "key_mlbam": "100",
            "key_bbref": "otheraa01",
            "mlb_played_first": "",
            "mlb_played_last": "",
        },
        {
            "key_mlbam": "104",
            "key_bbref": "exactaa01",
            "mlb_played_first": "",
            "mlb_played_last": "",
        },
    ],
)
def test_rejects_duplicate_provider_identifiers(
    tmp_path: Path,
    duplicate: dict[str, str],
) -> None:
    paths = fixture(tmp_path, [duplicate])
    with pytest.raises(ValueError, match="Duplicate Chadwick"):
        build(tmp_path, paths)


def test_rejects_player_seasons_that_drift_from_the_reference_lock(
    tmp_path: Path,
) -> None:
    paths = fixture(tmp_path)
    paths["player_seasons_path"].write_text("[]\n", encoding="utf-8")

    with pytest.raises(ValueError, match="does not match its reference lock"):
        build(tmp_path, paths)


def test_promotes_exact_bref_page_metadata_through_pinned_chadwick_key(
    tmp_path: Path,
) -> None:
    paths = fixture(tmp_path)
    links_path = tmp_path / "data/reference-locks/bref-chadwick-links.json"
    write_json(
        links_path,
        {
            "schemaVersion": "baseball-reference-chadwick-identity-links/v1",
            "asOf": "2026-07-13T19:29:41.606Z",
            "identityPolicy": "exact_bbref_page_meta_to_pinned_chadwick_key_no_name_matching",
            "entries": [
                {
                    "bbref": "newdebut01",
                    "chadwickKey": "00000004",
                    "sourceUrl": "https://www.baseball-reference.com/players/n/newdebut01.shtml",
                    "responseSha256": "a" * 64,
                }
            ],
        },
    )

    artifact = build_artifact(
        root=tmp_path,
        bref_chadwick_links_path=links_path,
        **paths,
    )

    assert artifact["asOf"] == "2026-07-13T19:29:41.606Z"
    assert [103, "newdebut01", 2026, 2026, "bref"] in artifact["records"]
    assert artifact["source"]["baseballReferenceChadwickLinks"]["records"] == 1
