"""``GET /api/benchmarks`` and the benchmark seed (task 3.3).

Build-scope verification line: "seeding an uncited ``declared`` row fails".
Also: every row carries a citation and a confidence tag; the seed is honest
(generic heuristics, ``estimated``, no invented URLs); it is idempotent, never
overwrites a user-edited row and never resurrects a deleted one; the endpoint
is read-only and owner-independent.
"""

from __future__ import annotations

import sqlite3

import pytest

from app.db import utcnow_iso
from app.repositories import benchmarks as repo

URL = "/api/benchmarks"
BENCHMARK_KEYS = {
    "id",
    "componentType",
    "metric",
    "value",
    "unit",
    "hardwareProfile",
    "basis",
    "sourceTitle",
    "sourceUrl",
    "retrievedDate",
    "confidence",
    "origin",
    "updatedAt",
}
SEEDED_TYPES = {"database", "cache", "queue", "service", "object_store"}


def count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM benchmarks").fetchone()[0]


def insert_user_row(conn: sqlite3.Connection, **overrides) -> None:
    now = utcnow_iso()
    row = {
        "id": "bmk_user_1",
        "component_type": "database",
        "metric": "read_qps",
        "value": 12_345,
        "unit": "qps per node",
        "hardware_profile": repo.GENERIC_PROFILE,
        "basis": "our own load test",
        "source_title": "Team load test 2026-09",
        "confidence": "estimated",
        **overrides,
    }
    conn.execute(
        """
        INSERT INTO benchmarks (id, component_type, metric, value, unit, hardware_profile, basis,
                                source_title, confidence, created_at, updated_at)
        VALUES (:id, :component_type, :metric, :value, :unit, :hardware_profile, :basis,
                :source_title, :confidence, :now, :now)
        """,
        {**row, "now": now},
    )


# --- the seed data itself is honest ------------------------------------------


def test_seed_rows_are_generic_estimated_heuristics_with_no_invented_urls():
    assert {row.component_type for row in repo.SEED_BENCHMARKS} == SEEDED_TYPES
    for row in repo.SEED_BENCHMARKS:
        assert row.confidence == "estimated", row.id
        assert row.source_url is None, f"{row.id}: a seed row must not cite a URL it did not come from"
        assert "heuristic" in row.source_title and "not a vendor benchmark" in row.source_title
        assert row.value > 0
        assert row.metric in {"read_qps", "write_qps"}


def test_every_seeded_type_has_both_a_read_and_a_write_row():
    pairs = {(row.component_type, row.metric) for row in repo.SEED_BENCHMARKS}
    for component_type in SEEDED_TYPES:
        assert {(component_type, "read_qps"), (component_type, "write_qps")} <= pairs


def test_seed_ids_are_unique_and_stable():
    ids = [row.id for row in repo.SEED_BENCHMARKS]
    assert len(ids) == len(set(ids))
    assert all(identifier.startswith("bmk_seed_") for identifier in ids)


# --- seed behaviour ------------------------------------------------------------


def test_seed_inserts_every_row_once(migrated_db):
    report = repo.seed_benchmarks(migrated_db)
    assert len(report.inserted) == len(repo.SEED_BENCHMARKS)
    assert count(migrated_db) == len(repo.SEED_BENCHMARKS)
    origins = {row[0] for row in migrated_db.execute("SELECT origin FROM benchmarks")}
    assert origins == {"seed"}


def test_seed_is_idempotent(migrated_db):
    repo.seed_benchmarks(migrated_db)
    again = repo.seed_benchmarks(migrated_db)
    assert again.inserted == [] and again.skipped_conflict == []
    assert len(again.already_seeded) == len(repo.SEED_BENCHMARKS)
    assert count(migrated_db) == len(repo.SEED_BENCHMARKS)


def test_seed_never_overwrites_a_user_edited_row(migrated_db):
    repo.seed_benchmarks(migrated_db)
    target = "bmk_seed_database_read_qps_generic"
    migrated_db.execute(
        "UPDATE benchmarks SET value = 4200, basis = 'measured on our hardware' WHERE id = ?", (target,)
    )
    row = migrated_db.execute("SELECT value, origin FROM benchmarks WHERE id = ?", (target,)).fetchone()
    assert (row["value"], row["origin"]) == (4200, "user"), "an edit must mark the seeded row as the user's"

    repo.seed_benchmarks(migrated_db)
    assert migrated_db.execute("SELECT value FROM benchmarks WHERE id = ?", (target,)).fetchone()[0] == 4200


def test_a_non_content_update_keeps_the_seed_origin(migrated_db):
    repo.seed_benchmarks(migrated_db)
    target = "bmk_seed_cache_read_qps_generic"
    migrated_db.execute("UPDATE benchmarks SET updated_at = ? WHERE id = ?", (utcnow_iso(), target))
    assert migrated_db.execute("SELECT origin FROM benchmarks WHERE id = ?", (target,)).fetchone()[0] == "seed"


def test_seed_never_resurrects_a_deleted_row(migrated_db):
    repo.seed_benchmarks(migrated_db)
    migrated_db.execute("DELETE FROM benchmarks WHERE id = 'bmk_seed_queue_write_qps_generic'")
    report = repo.seed_benchmarks(migrated_db)
    assert report.inserted == []
    assert migrated_db.execute(
        "SELECT COUNT(*) FROM benchmarks WHERE id = 'bmk_seed_queue_write_qps_generic'"
    ).fetchone()[0] == 0


def test_seed_skips_a_slot_already_taken_by_a_user_row_and_leaves_it_alone(migrated_db):
    insert_user_row(migrated_db)
    report = repo.seed_benchmarks(migrated_db)
    assert report.skipped_conflict == ["bmk_seed_database_read_qps_generic"]
    row = migrated_db.execute("SELECT value, origin FROM benchmarks WHERE id = 'bmk_user_1'").fetchone()
    assert (row["value"], row["origin"]) == (12_345, "user")
    logged = migrated_db.execute(
        "SELECT outcome FROM benchmark_seed_log WHERE seed_id = 'bmk_seed_database_read_qps_generic'"
    ).fetchone()[0]
    assert logged == "skipped_conflict"


def test_seeding_an_uncited_declared_row_fails_and_writes_nothing(migrated_db):
    """The build-scope verification line for 3.3 (red-team M7)."""
    bad = repo.SeedBenchmark(
        id="bmk_seed_bad_declared",
        component_type="database",
        metric="read_qps",
        value=50_000,
        unit="qps per node",
        hardware_profile="vendor datasheet",
        basis="a number somebody quoted",
        confidence="declared",
        source_url=None,
    )
    good = repo.SEED_BENCHMARKS[0]
    with pytest.raises(sqlite3.IntegrityError, match="requires a source_url"):
        repo.seed_benchmarks(migrated_db, rows=(good, bad))
    assert count(migrated_db) == 0, "the seed is all-or-nothing"
    assert migrated_db.execute("SELECT COUNT(*) FROM benchmark_seed_log").fetchone()[0] == 0


def test_a_typo_in_the_confidence_tag_fails_the_seed_instead_of_being_skipped(migrated_db):
    bad = repo.SeedBenchmark(
        id="bmk_seed_typo",
        component_type="cache",
        metric="read_qps",
        value=1,
        unit="qps per node",
        hardware_profile="x",
        basis="x",
        confidence="guessed",
    )
    with pytest.raises(sqlite3.IntegrityError):
        repo.seed_benchmarks(migrated_db, rows=(bad,))
    assert count(migrated_db) == 0


def test_every_row_needs_a_citation_title_even_when_estimated(migrated_db):
    with pytest.raises(sqlite3.IntegrityError, match="source_title"):
        insert_user_row(migrated_db, source_title="   ")
    repo.seed_benchmarks(migrated_db)
    with pytest.raises(sqlite3.IntegrityError, match="source_title"):
        migrated_db.execute("UPDATE benchmarks SET source_title = NULL WHERE origin = 'seed'")


def test_seed_script_reports_and_is_rerunnable(temp_settings, capsys):
    from scripts.seed_benchmarks import main

    assert main([]) == 0
    first = capsys.readouterr().out
    assert f"inserted {len(repo.SEED_BENCHMARKS)}" in first
    assert main([]) == 0
    assert "inserted 0" in capsys.readouterr().out


# --- the endpoint ----------------------------------------------------------------


def test_benchmarks_require_a_session(client):
    response = client.get(URL)
    assert response.status_code == 401
    assert response.json()["detail"] == "authentication required"


def test_startup_seeds_and_the_endpoint_returns_every_row_with_its_citation(user_a):
    response = user_a.get(URL)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"items", "total"}
    assert body["total"] == len(body["items"]) == len(repo.SEED_BENCHMARKS)
    for item in body["items"]:
        assert set(item) == BENCHMARK_KEYS
        assert item["sourceTitle"].strip()
        assert item["confidence"] == "estimated"
        assert item["sourceUrl"] is None
        assert item["origin"] == "seed"
    assert {item["componentType"] for item in body["items"]} == SEEDED_TYPES


def test_benchmarks_are_shared_reference_data_not_owner_scoped(user_a, user_b):
    assert user_a.get(URL).json() == user_b.get(URL).json()


def test_component_type_filter(user_a):
    body = user_a.get(URL, params={"componentType": "cache"}).json()
    assert body["total"] == 2
    assert {item["metric"] for item in body["items"]} == {"read_qps", "write_qps"}
    assert user_a.get(URL, params={"componentType": "mainframe"}).json() == {"items": [], "total": 0}


def test_the_endpoint_is_read_only(user_a):
    response = user_a.post(URL, json={})
    assert response.status_code == 405
    assert isinstance(response.json()["detail"], str)


def test_a_restart_does_not_duplicate_the_seed(client, user_a):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()):  # a second start-up runs the seed again
        pass
    assert user_a.get(URL).json()["total"] == len(repo.SEED_BENCHMARKS)
