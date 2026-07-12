from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from modeling.arrival_holdout import (
        AMENDED_LOCK_PATH,
        EXTERNAL_CORPUS_MANIFEST_PATH,
        FAILED_ADMISSION_PATH,
        ORIGINAL_LOCK_PATH,
        ROOT,
        content_addressed_lock_path,
        create_amended_holdout_lock,
    )
except ModuleNotFoundError:
    from arrival_holdout import (
        AMENDED_LOCK_PATH,
        EXTERNAL_CORPUS_MANIFEST_PATH,
        FAILED_ADMISSION_PATH,
        ORIGINAL_LOCK_PATH,
        ROOT,
        content_addressed_lock_path,
        create_amended_holdout_lock,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create the successor lock after an external prediction attempt that "
            "failed before semantic outcome decoding or prediction archival"
        )
    )
    parser.add_argument(
        "--parent-lock", type=Path, default=ROOT / ORIGINAL_LOCK_PATH
    )
    parser.add_argument(
        "--failed-admission", type=Path, default=ROOT / FAILED_ADMISSION_PATH
    )
    parser.add_argument(
        "--external-corpus-manifest",
        type=Path,
        default=ROOT / EXTERNAL_CORPUS_MANIFEST_PATH,
    )
    parser.add_argument("--output", type=Path, default=ROOT / AMENDED_LOCK_PATH)
    args = parser.parse_args()

    lock = create_amended_holdout_lock(
        args.parent_lock,
        args.failed_admission,
        args.external_corpus_manifest,
        args.output,
    )
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "content_addressed_output": str(
                    content_addressed_lock_path(
                        args.output.resolve(), lock["lock_sha256"]
                    )
                ),
                "lock_sha256": lock["lock_sha256"],
                "status": lock["status"],
                "failed_execution_semantic_outcome_decode": lock[
                    "failed_attempt"
                ]["failed_execution_semantic_outcome_decode"],
                "researcher_outcome_blind": lock["failed_attempt"][
                    "researcher_outcome_blind"
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
