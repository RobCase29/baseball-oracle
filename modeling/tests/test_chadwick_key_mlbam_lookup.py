from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from scripts.model.export_chadwick_key_mlbam_lookup import build_artifact
from scripts.model.export_mlb_identity_crosswalk import (
    CHADWICK_VERSION,
    EXPECTED_CHADWICK_SHARDS,
    file_sha256,
)


HEADER = ["key_person", "key_mlbam"]


def fixture(
    root: Path,
    rows: list[dict[str, str]] | None = None,
) -> tuple[Path, Path]:
    chadwick_dir = root / "raw" / CHADWICK_VERSION / "data"
    chadwick_dir.mkdir(parents=True)
    records = rows or [
        {"key_person": "00000001", "key_mlbam": "100"},
        {"key_person": "00000002", "key_mlbam": ""},
        {"key_person": "", "key_mlbam": "102"},
        {"key_person": "00000003", "key_mlbam": "103"},
    ]
    resources: dict[str, object] = {}
    for index, name in enumerate(EXPECTED_CHADWICK_SHARDS):
        path = chadwick_dir / name
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=HEADER)
            writer.writeheader()
            if index == 0:
                writer.writerows(records)
        resources[f"data/{name}"] = {
            "bytes": path.stat().st_size,
            "sha256": file_sha256(path),
        }

    source_lock = root / "source-lock.json"
    source_lock.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "updatedAt": "2026-07-11T22:48:51.000Z",
                "sources": {
                    "chadwick-register": {
                        "version": CHADWICK_VERSION,
                        "resources": resources,
                    }
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    return chadwick_dir, source_lock


def test_exports_only_rows_with_both_exact_identifiers(tmp_path: Path) -> None:
    chadwick_dir, source_lock = fixture(tmp_path)
    artifact = build_artifact(
        root=tmp_path,
        chadwick_dir=chadwick_dir,
        source_lock_path=source_lock,
    )

    assert artifact["recordCount"] == 2
    assert artifact["records"] == [["00000001", 100], ["00000003", 103]]
    assert artifact["identityPolicy"] == (
        "exact_chadwick_key_person_to_mlbam_no_name_matching"
    )
    assert artifact["source"]["chadwickRegister"]["version"] == CHADWICK_VERSION


@pytest.mark.parametrize(
    "rows,match",
    [
        (
            [
                {"key_person": "00000001", "key_mlbam": "100"},
                {"key_person": "00000001", "key_mlbam": "101"},
            ],
            "Duplicate Chadwick key_person",
        ),
        (
            [
                {"key_person": "00000001", "key_mlbam": "100"},
                {"key_person": "00000002", "key_mlbam": "100"},
            ],
            "Duplicate Chadwick key_mlbam",
        ),
    ],
)
def test_rejects_ambiguous_exact_identifiers(
    tmp_path: Path,
    rows: list[dict[str, str]],
    match: str,
) -> None:
    chadwick_dir, source_lock = fixture(tmp_path, rows)
    with pytest.raises(ValueError, match=match):
        build_artifact(
            root=tmp_path,
            chadwick_dir=chadwick_dir,
            source_lock_path=source_lock,
        )
