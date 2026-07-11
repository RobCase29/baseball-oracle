from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_sha256(value: Any) -> str:
    body = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(body).hexdigest()


def _git_output(root: Path, *arguments: str) -> str | None:
    try:
        return subprocess.check_output(
            ["git", *arguments], cwd=root, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def producer_metadata(
    root: Path, producer_files: list[Path], arguments: dict[str, Any]
) -> dict[str, Any]:
    status = _git_output(root, "status", "--porcelain=v1", "--untracked-files=all")
    packages: dict[str, str] = {}
    for package in ("joblib", "numpy", "pandas", "pyarrow", "scikit-learn", "scipy"):
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = "not-installed"

    return {
        "files": {
            str(path.resolve().relative_to(root)): file_sha256(path)
            for path in producer_files
        },
        "git": {
            "commit": _git_output(root, "rev-parse", "HEAD"),
            "dirty": bool(status),
            "status_sha256": hashlib.sha256((status or "").encode()).hexdigest(),
        },
        "environment": {
            "python": platform.python_version(),
            "implementation": platform.python_implementation(),
            "executable": str(Path(sys.executable).resolve()),
            "platform": platform.platform(),
            "packages": packages,
        },
        "arguments": arguments,
    }
