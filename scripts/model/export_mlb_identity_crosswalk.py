#!/usr/bin/env python3
"""Export an exact-ID MLBAM/BRef crosswalk with observed MLB season spans."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CHADWICK_VERSION = "7e23e7dfaff51b3ae72c16393703eda7e5ecad27"
EXPECTED_CHADWICK_SHARDS = tuple(f"people-{index:x}.csv" for index in range(16))

DEFAULT_CHADWICK_DIR = (
    ROOT / "data/raw/chadwick-register" / CHADWICK_VERSION / "data"
)
DEFAULT_SOURCE_LOCK = ROOT / "data/source-lock.json"
DEFAULT_PLAYER_SEASONS = (
    ROOT / "data/processed/baseball-reference-mlb-war/player_seasons.json"
)
DEFAULT_PLAYER_SEASONS_MANIFEST = (
    ROOT / "data/processed/baseball-reference-mlb-war/manifest.json"
)
DEFAULT_BREF_REFERENCE_LOCK = (
    ROOT / "data/reference-locks/baseball-reference-mlb-war.json"
)
DEFAULT_OUTPUT = ROOT / "api/_data/mlb-identity-crosswalk.json"

CHADWICK_REQUIRED_COLUMNS = {
    "key_mlbam",
    "key_bbref",
    "mlb_played_first",
    "mlb_played_last",
}
BREF_ID_PATTERN = re.compile(r"^[a-z0-9_'.]+$")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_object(path: Path, label: str) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def relative_path(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def require_positive_identifier(value: object, label: str) -> str:
    text = str(value or "")
    if not text.isdigit() or int(text) <= 0:
        raise ValueError(f"{label} must be a positive integer identifier")
    return text


def require_bbref_identifier(value: object, label: str) -> str:
    text = str(value or "")
    if not BREF_ID_PATTERN.fullmatch(text):
        raise ValueError(f"{label} must be an exact Baseball-Reference identifier")
    return text


def optional_year(value: object, label: str) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not text.isdigit():
        raise ValueError(f"{label} must be an integer year or empty")
    year = int(text)
    if year < 1871 or year > 2100:
        raise ValueError(f"{label} is outside the supported MLB year range")
    return year


def validate_chadwick_lock(
    chadwick_dir: Path,
    source_lock_path: Path,
    root: Path,
) -> list[dict[str, object]]:
    source_lock = read_object(source_lock_path, "source lock")
    if source_lock.get("schemaVersion") != 1:
        raise ValueError("Chadwick source lock schema changed")
    sources = source_lock.get("sources")
    if not isinstance(sources, dict):
        raise ValueError("Source lock is missing sources")
    chadwick = sources.get("chadwick-register")
    if not isinstance(chadwick, dict) or chadwick.get("version") != CHADWICK_VERSION:
        raise ValueError("Chadwick source lock version changed")
    resources = chadwick.get("resources")
    if not isinstance(resources, dict):
        raise ValueError("Chadwick source lock is missing resources")

    actual_names = tuple(sorted(path.name for path in chadwick_dir.glob("people-*.csv")))
    if actual_names != EXPECTED_CHADWICK_SHARDS:
        raise ValueError("Chadwick directory must contain exactly the 16 pinned people shards")

    lineage: list[dict[str, object]] = []
    for name in EXPECTED_CHADWICK_SHARDS:
        path = chadwick_dir / name
        lock_entry = resources.get(f"data/{name}")
        if not isinstance(lock_entry, dict):
            raise ValueError(f"Chadwick source lock is missing data/{name}")
        expected_sha = lock_entry.get("sha256")
        expected_bytes = lock_entry.get("bytes")
        actual_sha = file_sha256(path)
        actual_bytes = path.stat().st_size
        if actual_sha != expected_sha or actual_bytes != expected_bytes:
            raise ValueError(f"Chadwick shard does not match its source lock: {name}")
        lineage.append(
            {
                "path": relative_path(path, root),
                "sha256": actual_sha,
                "bytes": actual_bytes,
            }
        )
    return lineage


def validate_bref_lock(
    player_seasons_path: Path,
    manifest_path: Path,
    reference_lock_path: Path,
    root: Path,
) -> tuple[list[dict[str, Any]], dict[str, object]]:
    reference_lock = read_object(reference_lock_path, "Baseball-Reference lock")
    if reference_lock.get("schemaVersion") != "baseball-reference-mlb-war-reference-lock/v1":
        raise ValueError("Baseball-Reference reference lock schema changed")
    coverage = reference_lock.get("coverage")
    if not isinstance(coverage, dict) or coverage.get("complete") is not True:
        raise ValueError("Baseball-Reference reference lock must describe complete coverage")
    if coverage.get("failedUnits") != 0:
        raise ValueError("Baseball-Reference reference lock contains failed units")

    outputs = reference_lock.get("outputs")
    if not isinstance(outputs, list):
        raise ValueError("Baseball-Reference reference lock is missing outputs")
    expected_path = relative_path(player_seasons_path, root)
    matches = [entry for entry in outputs if isinstance(entry, dict) and entry.get("path") == expected_path]
    if len(matches) != 1:
        raise ValueError("Baseball-Reference lock must identify player_seasons.json exactly once")
    locked_output = matches[0]
    actual_sha = file_sha256(player_seasons_path)
    actual_bytes = player_seasons_path.stat().st_size
    if actual_sha != locked_output.get("sha256") or actual_bytes != locked_output.get("byteLength"):
        raise ValueError("player_seasons.json does not match its reference lock")

    manifest_lock = reference_lock.get("datasetManifest")
    if not isinstance(manifest_lock, dict):
        raise ValueError("Baseball-Reference lock is missing its dataset manifest")
    expected_manifest_path = relative_path(manifest_path, root)
    if manifest_lock.get("path") != expected_manifest_path:
        raise ValueError("Baseball-Reference dataset manifest path changed")
    if file_sha256(manifest_path) != manifest_lock.get("sha256"):
        raise ValueError("Baseball-Reference dataset manifest does not match its reference lock")

    manifest = read_object(manifest_path, "Baseball-Reference dataset manifest")
    if manifest.get("schemaVersion") != "baseball-reference-mlb-war-dataset/v1":
        raise ValueError("Baseball-Reference dataset manifest schema changed")
    if manifest.get("coverage") != coverage:
        raise ValueError("Baseball-Reference manifest and reference-lock coverage differ")

    seasons = json.loads(player_seasons_path.read_text(encoding="utf-8"))
    if not isinstance(seasons, list):
        raise ValueError("player_seasons.json must contain an array")
    if len(seasons) != locked_output.get("rowCount"):
        raise ValueError("player_seasons.json row count does not match its reference lock")

    return seasons, {
        "path": expected_path,
        "sha256": actual_sha,
        "bytes": actual_bytes,
        "rows": len(seasons),
        "manifestPath": expected_manifest_path,
        "manifestSha256": file_sha256(manifest_path),
        "referenceLockPath": relative_path(reference_lock_path, root),
        "referenceLockSha256": file_sha256(reference_lock_path),
        "generatedAt": reference_lock.get("createdAt"),
    }


def build_artifact(
    *,
    chadwick_dir: Path,
    source_lock_path: Path,
    player_seasons_path: Path,
    player_seasons_manifest_path: Path,
    bref_reference_lock_path: Path,
    root: Path = ROOT,
) -> dict[str, object]:
    """Build an exact identifier artifact; player names are never read or compared."""

    chadwick_lineage = validate_chadwick_lock(chadwick_dir, source_lock_path, root)
    player_seasons, bref_lineage = validate_bref_lock(
        player_seasons_path,
        player_seasons_manifest_path,
        bref_reference_lock_path,
        root,
    )

    seasons_by_bbref: dict[str, set[int]] = {}
    observed_player_seasons: set[tuple[str, int]] = set()
    for index, row in enumerate(player_seasons):
        if not isinstance(row, dict):
            raise ValueError(f"player_seasons[{index}] must be an object")
        bbref_id = require_bbref_identifier(
            row.get("bbref_id"),
            f"player_seasons[{index}].bbref_id",
        )
        season = optional_year(row.get("season"), f"player_seasons[{index}].season")
        if season is None:
            raise ValueError(f"player_seasons[{index}].season is required")
        identity = (bbref_id, season)
        if identity in observed_player_seasons:
            raise ValueError(f"Duplicate Baseball-Reference player season: {bbref_id} {season}")
        observed_player_seasons.add(identity)
        seasons_by_bbref.setdefault(bbref_id, set()).add(season)

    records: list[list[object | None]] = []
    seen_mlbam: set[str] = set()
    seen_bbref: set[str] = set()
    for shard_name in EXPECTED_CHADWICK_SHARDS:
        shard_path = chadwick_dir / shard_name
        with shard_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None or not CHADWICK_REQUIRED_COLUMNS.issubset(reader.fieldnames):
                raise ValueError(f"Chadwick shard has an unexpected header: {shard_name}")
            for row_number, row in enumerate(reader, start=2):
                raw_mlbam = str(row.get("key_mlbam") or "").strip()
                bbref_id = str(row.get("key_bbref") or "").strip() or None
                chadwick_first = optional_year(
                    row.get("mlb_played_first"),
                    f"{shard_name}:{row_number}.mlb_played_first",
                )
                chadwick_last = optional_year(
                    row.get("mlb_played_last"),
                    f"{shard_name}:{row_number}.mlb_played_last",
                )
                if (chadwick_first is None) != (chadwick_last is None):
                    raise ValueError(f"Incomplete Chadwick MLB span at {shard_name}:{row_number}")
                if chadwick_first is not None and chadwick_first > chadwick_last:
                    raise ValueError(f"Reversed Chadwick MLB span at {shard_name}:{row_number}")

                # Include exact MLBAM/BRef crosswalks plus MLBAM-only confirmed MLB players.
                if not raw_mlbam or (bbref_id is None and chadwick_first is None):
                    continue
                mlbam = require_positive_identifier(raw_mlbam, f"{shard_name}:{row_number}.key_mlbam")
                if mlbam in seen_mlbam:
                    raise ValueError(f"Duplicate Chadwick MLBAM identifier: {mlbam}")
                seen_mlbam.add(mlbam)
                if bbref_id is not None:
                    bbref_id = require_bbref_identifier(
                        row.get("key_bbref"),
                        f"{shard_name}:{row_number}.key_bbref",
                    )
                    if bbref_id in seen_bbref:
                        raise ValueError(f"Duplicate Chadwick BRef identifier: {bbref_id}")
                    seen_bbref.add(bbref_id)

                bref_seasons = seasons_by_bbref.get(bbref_id or "")
                if bref_seasons:
                    first_mlb_season = min(bref_seasons)
                    last_mlb_season = max(bref_seasons)
                    if chadwick_first is not None and chadwick_first != first_mlb_season:
                        raise ValueError(f"Chadwick/BRef debut conflict for {bbref_id}")
                    if chadwick_last is not None and last_mlb_season < chadwick_last:
                        raise ValueError(f"BRef MLB span ends before Chadwick for {bbref_id}")
                    evidence = "bref"
                elif chadwick_first is not None:
                    first_mlb_season = chadwick_first
                    last_mlb_season = chadwick_last
                    evidence = "chadwick"
                else:
                    first_mlb_season = None
                    last_mlb_season = None
                    evidence = None

                records.append(
                    [int(mlbam), bbref_id, first_mlb_season, last_mlb_season, evidence]
                )

    records.sort(key=lambda row: int(row[0]))
    bref_evidence = sum(row[4] == "bref" for row in records)
    chadwick_evidence = sum(row[4] == "chadwick" for row in records)
    crosswalk_only = sum(row[4] is None for row in records)
    generated_at = bref_lineage.get("generatedAt")
    if not isinstance(generated_at, str) or not generated_at:
        raise ValueError("Baseball-Reference reference lock is missing createdAt")

    return {
        "schemaVersion": "mlb-identity-crosswalk/v1",
        "asOf": generated_at,
        "identityPolicy": "exact_mlbam_bbref_only_no_name_matching",
        "recordCount": len(records),
        "coverage": {
            "recordsWithBbref": sum(row[1] is not None for row in records),
            "baseballReferenceSeasonEvidence": bref_evidence,
            "chadwickSeasonEvidence": chadwick_evidence,
            "crosswalkOnly": crosswalk_only,
        },
        "source": {
            "chadwickRegister": {
                "version": CHADWICK_VERSION,
                "sourceLockPath": relative_path(source_lock_path, root),
                "sourceLockSha256": file_sha256(source_lock_path),
                "shards": chadwick_lineage,
            },
            "baseballReferencePlayerSeasons": bref_lineage,
        },
        "recordShape": [
            "mlbam",
            "bbref",
            "firstMlbSeason",
            "lastMlbSeason",
            "seasonEvidence",
        ],
        "records": records,
    }


def write_artifact(artifact: dict[str, object], output_path: Path) -> None:
    encoded = json.dumps(artifact, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(f"{output_path.suffix}.tmp")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(output_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chadwick-dir", type=Path, default=DEFAULT_CHADWICK_DIR)
    parser.add_argument("--source-lock", type=Path, default=DEFAULT_SOURCE_LOCK)
    parser.add_argument("--player-seasons", type=Path, default=DEFAULT_PLAYER_SEASONS)
    parser.add_argument(
        "--player-seasons-manifest",
        type=Path,
        default=DEFAULT_PLAYER_SEASONS_MANIFEST,
    )
    parser.add_argument(
        "--bref-reference-lock",
        type=Path,
        default=DEFAULT_BREF_REFERENCE_LOCK,
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact = build_artifact(
        chadwick_dir=args.chadwick_dir,
        source_lock_path=args.source_lock,
        player_seasons_path=args.player_seasons,
        player_seasons_manifest_path=args.player_seasons_manifest,
        bref_reference_lock_path=args.bref_reference_lock,
    )
    write_artifact(artifact, args.output)
    coverage = artifact["coverage"]
    print(
        f"Exported {artifact['recordCount']:,} exact MLB identities "
        f"({coverage['baseballReferenceSeasonEvidence']:,} with BRef season evidence)"
    )


if __name__ == "__main__":
    main()
