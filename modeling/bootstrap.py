from __future__ import annotations

import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENT = ROOT / ".venv"
REQUIREMENTS = ROOT / "modeling/requirements.lock"
BOOTSTRAP_REQUIREMENTS = ROOT / "modeling/bootstrap.lock"
REQUIRED_PYTHON = (3, 13)


def main() -> None:
    if sys.version_info[:2] != REQUIRED_PYTHON:
        expected = ".".join(map(str, REQUIRED_PYTHON))
        actual = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        raise SystemExit(f"Modeling requires Python {expected}.x; found {actual}")

    if ENVIRONMENT.exists():
        shutil.rmtree(ENVIRONMENT)
    venv.EnvBuilder(with_pip=True, clear=True).create(ENVIRONMENT)
    python = ENVIRONMENT / "bin/python"
    subprocess.run(
        [
            python,
            "-m",
            "pip",
            "install",
            "--require-hashes",
            "-r",
            BOOTSTRAP_REQUIREMENTS,
        ],
        check=True,
    )
    subprocess.run(
        [python, "-m", "pip", "install", "--require-hashes", "-r", REQUIREMENTS],
        check=True,
    )
    subprocess.run([python, "-m", "pip", "check"], check=True)


if __name__ == "__main__":
    main()
