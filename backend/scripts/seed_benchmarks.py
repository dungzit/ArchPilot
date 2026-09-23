"""Seed the generic benchmark heuristics (task 3.3) - by hand, if you want to.

The API process already runs this on every start-up, so you normally never
need it. It exists for a fresh database you want to inspect before the first
start, and to show what a re-run does:

    python -m scripts.seed_benchmarks          # from ArchPilot/backend, or /srv in the container

Idempotent: a seed id that was ever handled is skipped, so a re-run never
overwrites an edited row and never brings back a deleted one. Runs pending
migrations first. Exit code 0 on success, 1 on failure (nothing is written).
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.db import connect, run_migrations
from app.repositories.benchmarks import seed_benchmarks


def main(argv: list[str] | None = None) -> int:
    del argv  # no options; kept for symmetry with the other scripts
    settings = get_settings()
    conn = connect(settings.db_path)
    try:
        run_migrations(conn)
        report = seed_benchmarks(conn)
    except sqlite3.Error as exc:  # report and fail; the transaction already rolled back
        print(f"error: benchmark seed failed: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    print(report.summary())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
