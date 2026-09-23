"""WAL-safe SQLite backup (red-team blocker B4).

NEVER copy a live WAL-mode SQLite file with cp/robocopy/volume snapshot: the
-wal and -shm sidecars produce a torn, possibly unrecoverable copy. This script
uses ``VACUUM INTO``, which writes a consistent, already-compacted snapshot
while the database stays online.

Usage (from ArchPilot/backend):
    python -m scripts.backup
    python -m scripts.backup --keep 14
    python -m scripts.backup --verify

Continuous replication (Litestream, streaming the WAL to the same file share)
is the second half of B4 and is a devops-master task; this script is the
coarse, always-available restore point.

Restore:
    1. stop the container
    2. copy the chosen snapshot over ARCHPILOT_DB_PATH (and delete stale -wal/-shm)
    3. start the container, hit /api/health, confirm schema_version
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

# Run as `python -m scripts.backup` from backend/, or directly as a file; the
# path insert makes the second form work. Imports must follow it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.db import snapshot_database


def make_backup(db_path: Path, backup_dir: Path) -> Path:
    """Thin CLI wrapper. One VACUUM INTO implementation lives in app.db."""
    return snapshot_database(db_path, backup_dir)


def verify_backup(path: Path) -> bool:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()
        return result == "ok"
    finally:
        conn.close()


PREMIGRATE_MARKER = "-premigrate"


def prune(backup_dir: Path, keep: int) -> list[Path]:
    """Delete the oldest scheduled snapshots.

    Pre-migration snapshots are never pruned: they are the only restore point
    for the forward-only migration they preceded (risk R8), and there is one per
    schema change, not one per night.
    """
    snapshots = sorted(
        p for p in backup_dir.glob("archpilot-*.db") if PREMIGRATE_MARKER not in p.name
    )
    doomed = snapshots[:-keep] if keep > 0 and len(snapshots) > keep else []
    for path in doomed:
        path.unlink()
    return doomed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="WAL-safe SQLite backup via VACUUM INTO.")
    parser.add_argument("--keep", type=int, default=30, help="snapshots to retain (0 = keep all)")
    parser.add_argument("--verify", action="store_true", help="run integrity_check on the new snapshot")
    args = parser.parse_args(argv)

    settings = get_settings()
    if not settings.db_path.exists():
        print(f"error: database not found at {settings.db_path}", file=sys.stderr)
        return 1

    target = make_backup(settings.db_path, settings.backup_dir)
    print(f"backup written: {target} ({target.stat().st_size} bytes)")

    if args.verify:
        ok = verify_backup(target)
        print(f"integrity_check: {'ok' if ok else 'FAILED'}")
        if not ok:
            return 1

    removed = prune(settings.backup_dir, args.keep)
    if removed:
        print(f"pruned {len(removed)} old snapshot(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
