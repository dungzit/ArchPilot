"""Migration runner and WAL-safe backup (red-team B4, M12)."""

from __future__ import annotations

from app.db import applied_versions, connect, discover_migrations, run_migrations


def test_migrations_are_discovered_in_order():
    names = [p.name for p in discover_migrations()]
    assert names == sorted(names), "migrations must apply in numeric-prefix order"
    assert names[0] == "001_core.sql"
    prefixes = [name.split("_", 1)[0] for name in names]
    assert prefixes == [f"{i:03d}" for i in range(1, len(names) + 1)], (
        "migration numbering must be gapless and unique"
    )


def test_running_migrations_twice_is_a_no_op(temp_settings):
    all_versions = {p.name.split("_", 1)[0] for p in discover_migrations()}
    conn = connect(temp_settings.db_path)
    try:
        first = run_migrations(conn)
        second = run_migrations(conn)
        assert first == sorted(all_versions)
        assert second == []
        assert applied_versions(conn) == all_versions
    finally:
        conn.close()


def test_wal_mode_is_enabled(migrated_db):
    assert migrated_db.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


def test_backup_uses_vacuum_into_and_verifies(migrated_db, temp_settings):
    from scripts.backup import make_backup, verify_backup

    # Write something so the snapshot is not trivially empty.
    migrated_db.execute("UPDATE health_probe SET probed_at = '2026-01-01T00:00:00+00:00'")

    target = make_backup(temp_settings.db_path, temp_settings.backup_dir)
    assert target.exists() and target.stat().st_size > 0
    # VACUUM INTO produces a single self-contained file: no -wal/-shm sidecars.
    assert not target.with_name(target.name + "-wal").exists()
    assert verify_backup(target) is True


def test_backup_prune_keeps_the_newest(temp_settings):
    from scripts.backup import prune

    temp_settings.backup_dir.mkdir(parents=True, exist_ok=True)
    for stamp in ("20260101T000000Z", "20260102T000000Z", "20260103T000000Z"):
        (temp_settings.backup_dir / f"archpilot-{stamp}.db").write_bytes(b"x")
    removed = prune(temp_settings.backup_dir, keep=1)
    remaining = sorted(p.name for p in temp_settings.backup_dir.glob("archpilot-*.db"))
    assert len(removed) == 2
    assert remaining == ["archpilot-20260103T000000Z.db"]


def test_prune_never_deletes_a_premigrate_snapshot(temp_settings):
    """A pre-migration snapshot is the only restore point for the forward-only
    migration it preceded (risk R8). Retention must not eat it."""
    from scripts.backup import prune

    temp_settings.backup_dir.mkdir(parents=True, exist_ok=True)
    (temp_settings.backup_dir / "archpilot-20260101T000000Z-premigrate.db").write_bytes(b"x")
    for stamp in ("20260102T000000Z", "20260103T000000Z"):
        (temp_settings.backup_dir / f"archpilot-{stamp}.db").write_bytes(b"x")
    prune(temp_settings.backup_dir, keep=1)
    remaining = sorted(p.name for p in temp_settings.backup_dir.glob("archpilot-*.db"))
    assert remaining == [
        "archpilot-20260101T000000Z-premigrate.db",
        "archpilot-20260103T000000Z.db",
    ]


def test_a_pending_migration_snapshots_the_database_first(temp_settings, monkeypatch):
    """Rollback for a forward-only migration is restore-from-backup. Before this
    change the app auto-migrated on startup with no backup taken."""
    import app.db as db_module
    from app.db import init_database

    # Bring the database to 001 only, so 002+ are still pending.
    conn = connect(temp_settings.db_path)
    try:
        first = db_module.discover_migrations()[0]
        conn.executescript(first.read_text(encoding="utf-8"))
        db_module._ensure_migrations_table(conn)
        conn.execute(
            "INSERT INTO schema_migrations (version, filename, applied_at) VALUES ('001', ?, ?)",
            (first.name, "2026-01-01T00:00:00+00:00"),
        )
    finally:
        conn.close()

    assert list(temp_settings.backup_dir.glob("*.db")) == []
    applied = init_database(temp_settings)
    assert applied and "001" not in applied
    snapshots = list(temp_settings.backup_dir.glob("archpilot-*-premigrate.db"))
    assert len(snapshots) == 1, "a pre-migration snapshot must exist before schema changes apply"


def test_a_fresh_database_is_not_snapshotted(temp_settings):
    """Nothing to lose on first boot; do not litter the backup directory."""
    from app.db import init_database

    init_database(temp_settings)
    assert list(temp_settings.backup_dir.glob("*.db")) == []
