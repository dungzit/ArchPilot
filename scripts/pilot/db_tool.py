"""Read-only database checks for the pilot restore flow (runs inside the container).

    python /pilot/db_tool.py verify /data/backups/archpilot-20261014T020000Z.db

Opens the file read-only (no WAL files are created next to a backup), runs
PRAGMA integrity_check, and prints schema version and row counts so the operator
can see what they are about to restore.

Exit codes: 0 integrity ok / 1 file missing, unreadable, or integrity check failed.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


def verify(path: Path) -> int:
    if not path.is_file():
        print(f"error: file not found: {path}", file=sys.stderr)
        return 1
    try:
        conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        print(f"error: cannot open {path}: {exc}", file=sys.stderr)
        return 1
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"integrity_check: {result}")
        if result != "ok":
            return 1
        row = conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()
        print(f"schema_version: {row[0] if row and row[0] else 'none'}")
        for table in ("users", "designs", "sessions"):
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608 - fixed names
                print(f"{table}: {count}")
            except sqlite3.Error:
                print(f"{table}: n/a")
    except sqlite3.Error as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "verify":
        return verify(Path(argv[2]))
    print("usage: db_tool.py verify <path-to-db>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
