from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from modeling.evaluator_live_guard import (
    EvaluatorLiveGuardError,
    main,
    verify_live_evaluator_bytes,
)


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _write_lock(path: Path, files: dict[str, str]) -> None:
    path.write_text(json.dumps({"evaluator": {"files": files}}))


def test_verifies_every_live_evaluator_file(tmp_path: Path) -> None:
    first = tmp_path / "modeling" / "first.py"
    second = tmp_path / "modeling" / "config" / "protocol.json"
    first.parent.mkdir()
    second.parent.mkdir()
    first.write_bytes(b"first frozen bytes\n")
    second.write_bytes(b'{"frozen":true}\n')
    lock_path = tmp_path / "lock.json"
    expected = {
        "modeling/first.py": _sha256(first.read_bytes()),
        "modeling/config/protocol.json": _sha256(second.read_bytes()),
    }
    _write_lock(lock_path, expected)

    assert verify_live_evaluator_bytes(lock_path, repo_root=tmp_path) == expected


def test_fails_closed_when_live_bytes_differ(tmp_path: Path) -> None:
    evaluator = tmp_path / "evaluator.py"
    evaluator.write_bytes(b"frozen\n")
    lock_path = tmp_path / "lock.json"
    _write_lock(lock_path, {"evaluator.py": _sha256(evaluator.read_bytes())})
    evaluator.write_bytes(b"changed\n")

    with pytest.raises(EvaluatorLiveGuardError, match="live-byte SHA-256 mismatch"):
        verify_live_evaluator_bytes(lock_path, repo_root=tmp_path)


def test_fails_closed_when_locked_file_is_missing(tmp_path: Path) -> None:
    lock_path = tmp_path / "lock.json"
    _write_lock(lock_path, {"missing.py": "a" * 64})

    with pytest.raises(EvaluatorLiveGuardError, match="file is missing: missing.py"):
        verify_live_evaluator_bytes(lock_path, repo_root=tmp_path)


@pytest.mark.parametrize("relative", ["../outside.py", "/tmp/outside.py", "./file.py"])
def test_rejects_noncanonical_or_escaping_paths(
    tmp_path: Path, relative: str
) -> None:
    lock_path = tmp_path / "lock.json"
    _write_lock(lock_path, {relative: "a" * 64})

    with pytest.raises(EvaluatorLiveGuardError, match="repository-relative path"):
        verify_live_evaluator_bytes(lock_path, repo_root=tmp_path)


def test_rejects_symlinked_evaluator_path(tmp_path: Path) -> None:
    target = tmp_path / "target.py"
    target.write_bytes(b"target\n")
    link = tmp_path / "evaluator.py"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("symlinks unavailable")
    lock_path = tmp_path / "lock.json"
    _write_lock(lock_path, {"evaluator.py": _sha256(target.read_bytes())})

    with pytest.raises(EvaluatorLiveGuardError, match="traverses a symlink"):
        verify_live_evaluator_bytes(lock_path, repo_root=tmp_path)


def test_cli_reports_failure_and_returns_nonzero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    lock_path = tmp_path / "lock.json"
    _write_lock(lock_path, {"missing.py": "a" * 64})

    assert main(["--lock", str(lock_path), "--repo-root", str(tmp_path)]) == 1
    assert "Evaluator live-byte guard FAILED" in capsys.readouterr().err
