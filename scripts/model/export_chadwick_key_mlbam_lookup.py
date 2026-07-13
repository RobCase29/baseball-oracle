#!/usr/bin/env python3
"""Export the pinned Chadwick key_person -> MLBAM bridge used for exact debut IDs."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any

try:
    from scripts.model.export_mlb_identity_crosswalk import (
        CHADWICK_VERSION,
        EXPECTED_CHADWICK_SHARDS,
        file_sha256,
        relative_path,
        validate_chadwick_lock,
    )
except ModuleNotFoundError:  # Direct `python scripts/model/...` execution.
    from export_mlb_identity_crosswalk import (  # type: ignore[no-redef]
        CHADWICK_VERSION,
        EXPECTED_CHADWICK_SHARDS,
        file_sha256,
        relative_path,
        validate_chadwick_lock,
    )


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CHADWICK_DIR = (
    ROOT / "data/raw/chadwick-register" / CHADWICK_VERSION / "data"
)
DEFAULT_SOURCE_LOCK = ROOT / "data/source-lock.json"
DEFAULT_OUTPUT = ROOT / "api/_data/chadwick-key-mlbam.json"

KEY_PERSON_PATTERN = re.compile(r"^[0-9a-f]{8}$")
MLBAM_PATTERN = re.compile(r"^[1-9][0-9]*$")


def read_object(path: Path, label: str) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def build_artifact(
    *,
    chadwick_dir: Path,
    source_lock_path: Path,
    root: Path = ROOT,
) -> dict[str, object]:
    """Build an exact, name-free bridge from pinned Chadwick identifiers."""

    lineage = validate_chadwick_lock(chadwick_dir, source_lock_path, root)
    source_lock = read_object(source_lock_path, "Chadwick source lock")
    as_of = source_lock.get("updatedAt")
    if not isinstance(as_of, str) or not as_of:
        raise ValueError("Chadwick source lock is missing updatedAt")

    records: list[list[object]] = []
    seen_keys: set[str] = set()
    seen_mlbam: set[int] = set()
    for shard_name in EXPECTED_CHADWICK_SHARDS:
        shard_path = chadwick_dir / shard_name
        with shard_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None or not {
                "key_person",
                "key_mlbam",
            }.issubset(reader.fieldnames):
                raise ValueError(f"Chadwick shard has an unexpected header: {shard_name}")
            for row_number, row in enumerate(reader, start=2):
                key_person = str(row.get("key_person") or "").strip()
                raw_mlbam = str(row.get("key_mlbam") or "").strip()
                if not key_person or not raw_mlbam:
                    continue
                if not KEY_PERSON_PATTERN.fullmatch(key_person):
                    raise ValueError(
                        f"Invalid Chadwick key_person at {shard_name}:{row_number}"
                    )
                if not MLBAM_PATTERN.fullmatch(raw_mlbam):
                    raise ValueError(
                        f"Invalid Chadwick key_mlbam at {shard_name}:{row_number}"
                    )
                mlbam = int(raw_mlbam)
                if key_person in seen_keys:
                    raise ValueError(f"Duplicate Chadwick key_person: {key_person}")
                if mlbam in seen_mlbam:
                    raise ValueError(f"Duplicate Chadwick key_mlbam: {mlbam}")
                seen_keys.add(key_person)
                seen_mlbam.add(mlbam)
                records.append([key_person, mlbam])

    records.sort(key=lambda record: str(record[0]))
    return {
        "schemaVersion": "chadwick-key-mlbam/v1",
        "asOf": as_of,
        "identityPolicy": "exact_chadwick_key_person_to_mlbam_no_name_matching",
        "recordCount": len(records),
        "source": {
            "chadwickRegister": {
                "version": CHADWICK_VERSION,
                "sourceLockPath": relative_path(source_lock_path, root),
                "sourceLockSha256": file_sha256(source_lock_path),
                "shards": lineage,
            }
        },
        "recordShape": ["keyPerson", "mlbam"],
        "records": records,
    }


def write_artifact(artifact: dict[str, object], output_path: Path) -> None:
    encoded = json.dumps(
        artifact,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(f"{output_path.suffix}.tmp")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(output_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chadwick-dir", type=Path, default=DEFAULT_CHADWICK_DIR)
    parser.add_argument("--source-lock", type=Path, default=DEFAULT_SOURCE_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact = build_artifact(
        chadwick_dir=args.chadwick_dir,
        source_lock_path=args.source_lock,
    )
    write_artifact(artifact, args.output)
    print(
        f"Exported {artifact['recordCount']:,} exact pinned Chadwick key/MLBAM links"
    )


if __name__ == "__main__":
    main()
