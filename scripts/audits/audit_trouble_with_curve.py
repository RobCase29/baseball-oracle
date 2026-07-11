from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.utils import resample

EXPECTED_BYTES = 19_415_394
EXPECTED_SHA256 = "e2a4cd65941c5a9411d6648836eb26b9ab0d547e9c41d11f2b1d5a88125a9c8b"
EXPECTED_RESULTS: dict[str, Any] = {
    "profiles": 9_175,
    "displayed_names": 3_549,
    "final_train_profiles": 7_164,
    "test_profiles": 778,
    "test_displayed_names": 675,
    "train_test_name_overlap": 470,
    "train_test_name_overlap_share": 0.6962962962962963,
    "all_negative_test_accuracy": 0.7352185089974294,
    "stale_negative_rows_with_mlb_debut": 1_155,
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def audit(path: Path) -> dict[str, Any]:
    if path.stat().st_size != EXPECTED_BYTES or file_sha256(path) != EXPECTED_SHA256:
        raise ValueError("Input does not match the pinned Trouble With The Curve CSV")

    frame = pd.read_csv(path, dtype=str, low_memory=False)
    labels = pd.to_numeric(frame["label"], errors="raise").astype(int)
    labeled = frame[labels.ne(-1)].copy()
    labeled["label"] = labels[labels.ne(-1)]

    train, test = train_test_split(labeled, test_size=0.1, random_state=0)
    train, _ = train_test_split(train, test_size=0.1, random_state=0)
    majority = train[train["label"].ne(1)]
    minority = train[train["label"].eq(1)]
    upsampled = resample(
        minority,
        replace=True,
        n_samples=int(len(minority) * 1.5),
        random_state=0,
    )
    final_train = pd.concat([majority, upsampled])

    train_names = set(final_train["name"])
    test_names = set(test["name"])
    overlap = train_names & test_names
    mlb_first_year = pd.to_numeric(frame["mlb_played_first"], errors="coerce").fillna(0)
    stale_negative = labels.eq(0) & mlb_first_year.gt(0)
    source = frame["source"].fillna("")

    result = {
        "csv_bytes": path.stat().st_size,
        "csv_sha256": file_sha256(path),
        "profiles": len(frame),
        "displayed_names": int(frame["name"].nunique()),
        "editions": sorted(
            int(value) for value in pd.to_numeric(frame["year"], errors="raise").unique()
        ),
        "source_rows": {
            "mlbam": int(source.eq("mlbam").sum()),
            "fangraphs": int(source.str.startswith("fg_").sum()),
        },
        "labeled_profiles": len(labeled),
        "final_train_profiles": len(final_train),
        "test_profiles": len(test),
        "test_displayed_names": len(test_names),
        "train_test_name_overlap": len(overlap),
        "train_test_name_overlap_share": len(overlap) / len(test_names),
        "all_negative_test_accuracy": float(test["label"].eq(0).mean()),
        "stale_negative_rows_with_mlb_debut": int(stale_negative.sum()),
    }
    mismatches = {
        key: {"expected": expected, "actual": result.get(key)}
        for key, expected in EXPECTED_RESULTS.items()
        if result.get(key) != expected
    }
    if mismatches:
        raise ValueError(f"Pinned audit results changed: {json.dumps(mismatches, sort_keys=True)}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reproduce aggregate checks for the pinned Trouble With The Curve CSV"
    )
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.input), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
