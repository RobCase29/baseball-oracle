from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class EvaluatorLiveGuardError(ValueError):
    pass


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise EvaluatorLiveGuardError(f"Lock contains duplicate JSON key: {key}")
        value[key] = item
    return value


def _read_lock(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_object_without_duplicate_keys,
        )
    except EvaluatorLiveGuardError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise EvaluatorLiveGuardError(f"Cannot read evaluator lock: {path}") from error
    if not isinstance(value, dict):
        raise EvaluatorLiveGuardError("Evaluator lock must contain a JSON object")
    return value


def _resolve_locked_file(relative: str, root: Path) -> Path:
    candidate = Path(relative)
    if (
        not relative
        or candidate.is_absolute()
        or candidate.as_posix() != relative
        or ".." in candidate.parts
    ):
        raise EvaluatorLiveGuardError(
            f"Evaluator path is not a canonical repository-relative path: {relative!r}"
        )

    unresolved = root.joinpath(*candidate.parts)
    current = root
    for part in candidate.parts:
        current /= part
        if current.is_symlink():
            raise EvaluatorLiveGuardError(f"Evaluator path traverses a symlink: {relative}")

    try:
        resolved = unresolved.resolve(strict=True)
    except OSError as error:
        raise EvaluatorLiveGuardError(f"Evaluator file is missing: {relative}") from error
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise EvaluatorLiveGuardError(
            f"Evaluator path escapes the repository root: {relative}"
        ) from error
    if not resolved.is_file():
        raise EvaluatorLiveGuardError(f"Evaluator path is not a regular file: {relative}")
    return resolved


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise EvaluatorLiveGuardError(f"Cannot hash evaluator file: {path}") from error
    return digest.hexdigest()


def verify_live_evaluator_bytes(
    lock_path: Path, *, repo_root: Path = REPO_ROOT
) -> dict[str, str]:
    root = repo_root.resolve(strict=True)
    if not root.is_dir():
        raise EvaluatorLiveGuardError(f"Repository root is not a directory: {root}")

    lock = _read_lock(lock_path.resolve())
    evaluator = lock.get("evaluator")
    files = evaluator.get("files") if isinstance(evaluator, dict) else None
    if not isinstance(files, dict) or not files:
        raise EvaluatorLiveGuardError("Lock evaluator.files must be a non-empty JSON object")

    verified: dict[str, str] = {}
    for relative, expected in sorted(files.items()):
        if not isinstance(relative, str):
            raise EvaluatorLiveGuardError("Lock evaluator.files keys must be strings")
        if not isinstance(expected, str) or SHA256_PATTERN.fullmatch(expected) is None:
            raise EvaluatorLiveGuardError(
                f"Locked evaluator SHA-256 is invalid: {relative}"
            )
        path = _resolve_locked_file(relative, root)
        actual = _file_sha256(path)
        if actual != expected:
            raise EvaluatorLiveGuardError(
                f"Evaluator live-byte SHA-256 mismatch: {relative} "
                f"(expected {expected}, found {actual})"
            )
        verified[relative] = actual
    return verified


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify live evaluator bytes against a frozen external-evaluation lock."
    )
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    arguments = parser.parse_args(argv)

    try:
        verified = verify_live_evaluator_bytes(
            arguments.lock, repo_root=arguments.repo_root
        )
    except (EvaluatorLiveGuardError, OSError) as error:
        print(f"Evaluator live-byte guard FAILED: {error}", file=sys.stderr)
        return 1

    print(
        f"Evaluator live-byte guard passed: {len(verified)} frozen files match the lock."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
