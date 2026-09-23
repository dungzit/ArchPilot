"""SQLite connection handling and a forward-only migration runner.

Design notes
------------
* WAL mode: many readers, one writer. Correct for 2-4 internal users.
* ``recursive_triggers = OFF``: this SQLite build compiles with
  ``DEFAULT_RECURSIVE_TRIGGERS``. The ``patterns`` legal-invariant trigger
  writes back to ``patterns``; turning recursion off makes the no-loop
  guarantee explicit instead of relying on the WHEN clause alone.
* Forward-only migrations, recorded in ``schema_migrations``. There is no
  ``down`` path on purpose: the rollback procedure is restore-from-backup
  (red-team M12), not a reverse migration.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

from .config import Settings, get_settings

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def utcnow_iso() -> str:
    """Single source of truth for timestamps. ISO-8601, UTC, second precision."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(db_path: Path | str | None = None, *, read_only: bool = False) -> sqlite3.Connection:
    """Open a tuned SQLite connection. Caller owns closing it."""
    settings = get_settings()
    path = Path(db_path) if db_path is not None else settings.db_path
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(path), timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA recursive_triggers = OFF")
    conn.execute("PRAGMA busy_timeout = 5000")
    if read_only:
        conn.execute("PRAGMA query_only = ON")
    return conn


def get_connection() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request, always closed."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def snapshot_database(db_path: Path, backup_dir: Path, *, label: str = "") -> Path:
    """WAL-safe snapshot via ``VACUUM INTO`` (red-team B4).

    NEVER copy a live WAL-mode database with cp/robocopy/a volume snapshot: the
    -wal and -shm sidecars produce a torn, possibly unrecoverable file.
    """
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = f"-{label}" if label else ""
    target = backup_dir / f"archpilot-{stamp}{suffix}.db"
    if target.exists():
        raise FileExistsError(f"refusing to overwrite existing backup {target}")

    conn = connect(db_path)
    try:
        # VACUUM INTO's target is an SQL expression, so the path binds as a
        # parameter - no string interpolation of a filesystem path.
        conn.execute("VACUUM INTO ?", (str(target),))
    finally:
        conn.close()
    return target


def _ensure_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT PRIMARY KEY,
            filename    TEXT NOT NULL,
            applied_at  TEXT NOT NULL
        )
        """
    )


MIGRATION_NAME_RE = re.compile(r"^\d{3}_[a-z0-9_]+\.sql$")


def discover_migrations() -> list[Path]:
    """Every ``NNN_name.sql`` under app/migrations, sorted by numeric prefix.

    The strict name pattern is a safety rail: the filename is interpolated into
    the ``schema_migrations`` bookkeeping statement (see ``run_migrations``),
    so it must not contain quotes.
    """
    if not MIGRATIONS_DIR.is_dir():
        return []
    files = sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda p: p.name)
    for path in files:
        if not MIGRATION_NAME_RE.match(path.name):
            raise ValueError(
                f"migration filename {path.name!r} must match NNN_lower_snake_case.sql"
            )
    return files


def applied_versions(conn: sqlite3.Connection) -> set[str]:
    _ensure_migrations_table(conn)
    return {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}


def run_migrations(conn: sqlite3.Connection) -> list[str]:
    """Apply every pending migration in order. Returns the versions applied.

    Each migration runs in its own transaction: a failure leaves the database
    at the last complete version instead of half-migrated.
    """
    _ensure_migrations_table(conn)
    done = applied_versions(conn)
    newly_applied: list[str] = []

    for migration in discover_migrations():
        version = migration.name.split("_", 1)[0]
        if version in done:
            continue
        sql = migration.read_text(encoding="utf-8")
        logger.info("applying migration %s", migration.name)
        # The BEGIN/COMMIT live inside the executescript payload on purpose:
        # sqlite3.Connection.executescript commits any transaction opened
        # outside it, so an outer BEGIN would not actually wrap the script.
        # S608: executescript() cannot bind parameters, so this row has to be
        # interpolated. The only interpolated values are the migration filename
        # and its numeric prefix, and discover_migrations() has already rejected
        # any name that does not match NNN_lower_snake_case.sql - so a quote
        # cannot reach here. utcnow_iso() is ours.
        insert = (
            "INSERT INTO schema_migrations (version, filename, applied_at) "  # noqa: S608
            f"VALUES ('{version}', '{migration.name}', '{utcnow_iso()}');"
        )
        try:
            conn.executescript(f"BEGIN;\n{sql}\n{insert}\nCOMMIT;")
        except Exception:
            if conn.in_transaction:
                conn.executescript("ROLLBACK;")
            logger.exception("migration %s failed; database left at previous version", migration.name)
            raise
        newly_applied.append(version)

    return newly_applied


def pending_migrations(conn: sqlite3.Connection) -> list[str]:
    """Versions discovered on disk that are not yet recorded as applied."""
    done = applied_versions(conn)
    return [m.name.split("_", 1)[0] for m in discover_migrations() if m.name.split("_", 1)[0] not in done]


def init_database(settings: Settings | None = None) -> list[str]:
    """Open the configured database and bring it up to the latest schema.

    Rollback for a forward-only migration is restore-from-backup, never an image
    rollback (risk R8). That only works if a backup exists, so an existing
    database is snapshotted before any pending migration touches it.
    """
    settings = settings or get_settings()
    conn = connect(settings.db_path)
    try:
        pending = pending_migrations(conn)
        if pending and settings.backup_before_migrate and _has_existing_data(conn):
            try:
                target = snapshot_database(settings.db_path, settings.backup_dir, label="premigrate")
                logger.info(
                    "pre-migration snapshot written",
                    extra={"backup": str(target), "pending_migrations": pending},
                )
            except Exception:
                logger.exception("pre-migration snapshot failed; refusing to migrate")
                raise
        return run_migrations(conn)
    finally:
        conn.close()


def _has_existing_data(conn: sqlite3.Connection) -> bool:
    """True once at least one migration has been applied - i.e. there is something to lose."""
    return bool(applied_versions(conn))
