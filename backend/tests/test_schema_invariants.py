"""Schema-level guarantees the design documents promise.

These are the tests that carry red-team blockers B1 (content_hash), M1 (FTS
sync) and M7 (benchmark citations) from prose into enforced behaviour.
"""

from __future__ import annotations

import json
import sqlite3

import pytest

from app.content_hash import ContentHashError, approval_matches, compute_content_hash
from app.db import utcnow_iso

GRAPH = json.dumps(
    {
        "schemaVersion": "1.0",
        "nodes": [{"id": "n1", "type": "service", "label": "Orders API", "position": {"x": 0, "y": 0}}],
        "edges": [],
    }
)


def _insert_pattern(conn: sqlite3.Connection, author_id: str, **overrides) -> dict:
    payload = {
        "title": "Adaptive video streaming at scale",
        "summary_one_line": "How a large streamer adapts bitrate at the edge.",
        "body_md": "Our own summary, in our own words.",
        "graph_json": GRAPH,
        "categories_json": json.dumps(["storage-cdn", "real-time"]),
        "source_company": "Example Corp",
        "source_url": "https://example.com/blog/adaptive-streaming",
        "source_title": "Adaptive streaming at Example Corp",
        "source_published_date": "2023-06-14",
    }
    override_hash = overrides.pop("override_hash", None)
    payload.update(overrides)
    now = utcnow_iso()
    content_hash = override_hash or compute_content_hash(payload)
    conn.execute(
        """
        INSERT INTO patterns (id, slug, title, summary_one_line, body_md, graph_json,
                              categories_json, source_company, source_url, source_title,
                              source_published_date, status, content_hash, author_id,
                              created_at, updated_at)
        VALUES (:id, :slug, :title, :summary_one_line, :body_md, :graph_json,
                :categories_json, :source_company, :source_url, :source_title,
                :source_published_date, 'draft', :content_hash, :author_id, :now, :now)
        """,
        {
            **payload,
            "id": "pat_test1",
            "slug": "adaptive-video-streaming",
            "content_hash": content_hash,
            "author_id": author_id,
            "now": now,
        },
    )
    return payload


def _approve(conn: sqlite3.Connection, pattern_id: str, reviewer_id: str, content_hash: str) -> None:
    conn.execute(
        """
        INSERT INTO legal_reviews (id, pattern_id, reviewer_id, content_hash,
                                   checklist_json, decision, reviewed_at)
        VALUES (?, ?, ?, ?, ?, 'approved', ?)
        """,
        (
            "rev_1",
            pattern_id,
            reviewer_id,
            content_hash,
            json.dumps({"own_words": True, "no_images": True, "cited": True,
                        "quotes_short": True, "no_endorsement": True}),
            utcnow_iso(),
        ),
    )
    conn.execute("UPDATE patterns SET status = 'approved' WHERE id = ?", (pattern_id,))


# --- B1: the legal gate binds to content, not to an ID ----------------------


def test_editing_an_approved_pattern_resets_it_to_draft(migrated_db, seeded_user):
    payload = _insert_pattern(migrated_db, seeded_user["id"])
    _approve(migrated_db, "pat_test1", seeded_user["id"], compute_content_hash(payload))
    assert migrated_db.execute("SELECT status FROM patterns WHERE id='pat_test1'").fetchone()[0] == "approved"

    migrated_db.execute(
        "UPDATE patterns SET body_md = ?, updated_at = ? WHERE id = 'pat_test1'",
        ("Quietly reworded after approval.", utcnow_iso()),
    )

    status = migrated_db.execute("SELECT status FROM patterns WHERE id='pat_test1'").fetchone()[0]
    assert status == "draft", "editing reviewed content must revoke the approval (B1)"


def test_status_only_update_does_not_reset_status(migrated_db, seeded_user):
    payload = _insert_pattern(migrated_db, seeded_user["id"])
    _approve(migrated_db, "pat_test1", seeded_user["id"], compute_content_hash(payload))
    migrated_db.execute(
        "UPDATE patterns SET status='published', published_at=? WHERE id='pat_test1'",
        (utcnow_iso(),),
    )
    row = migrated_db.execute("SELECT status FROM patterns WHERE id='pat_test1'").fetchone()
    assert row["status"] == "published"


def test_approval_hash_no_longer_matches_after_an_edit(migrated_db, seeded_user):
    payload = _insert_pattern(migrated_db, seeded_user["id"])
    approved_hash = compute_content_hash(payload)
    payload["body_md"] = "Different text."
    assert not approval_matches(payload, approved_hash)


def test_content_hash_is_stable_under_json_key_reordering():
    base = {
        "title": "t", "summary_one_line": "s", "body_md": "b",
        "graph_json": '{"schemaVersion":"1.0","nodes":[],"edges":[]}',
        "categories_json": '["a","b"]',
        "source_company": "c", "source_url": "u", "source_title": "st",
        "source_published_date": "2024-01-01",
    }
    reordered = dict(base)
    reordered["graph_json"] = '{"edges":[],"nodes":[],"schemaVersion":"1.0"}'
    assert compute_content_hash(base) == compute_content_hash(reordered)


def test_content_hash_refuses_incomplete_attribution():
    with pytest.raises(ContentHashError):
        compute_content_hash({"title": "t", "body_md": "b"})


def test_legal_reviews_are_append_only(migrated_db, seeded_user):
    payload = _insert_pattern(migrated_db, seeded_user["id"])
    _approve(migrated_db, "pat_test1", seeded_user["id"], compute_content_hash(payload))
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute("UPDATE legal_reviews SET decision='rejected' WHERE id='rev_1'")
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute("DELETE FROM legal_reviews WHERE id='rev_1'")


# --- REQ-HUB-005: attribution is a storage constraint -----------------------


def test_pattern_cannot_be_stored_without_attribution(migrated_db, seeded_user):
    # Bypass the application-side hash guard on purpose: this asserts that the
    # storage layer itself refuses blank attribution, so a direct sqlite3
    # session or a future code path cannot sneak one in.
    with pytest.raises(sqlite3.IntegrityError):
        _insert_pattern(
            migrated_db, seeded_user["id"], source_url="   ", override_hash="deadbeef"
        )


def test_application_hash_guard_also_refuses_blank_attribution(seeded_user):
    with pytest.raises(ContentHashError):
        compute_content_hash(
            {
                "title": "t", "summary_one_line": "s", "body_md": "b",
                "graph_json": "{}", "categories_json": "[]",
                "source_company": "c", "source_url": "   ", "source_title": "st",
            }
        )


# --- M1: FTS stays in sync and never leaks drafts ---------------------------


def test_fts_index_follows_inserts_and_updates(migrated_db, seeded_user):
    _insert_pattern(migrated_db, seeded_user["id"])
    hits = migrated_db.execute(
        "SELECT COUNT(*) FROM patterns_fts WHERE patterns_fts MATCH 'adaptive'"
    ).fetchone()[0]
    assert hits == 1

    migrated_db.execute(
        "UPDATE patterns SET title='Completely different subject', updated_at=? WHERE id='pat_test1'",
        (utcnow_iso(),),
    )
    stale = migrated_db.execute(
        "SELECT COUNT(*) FROM patterns_fts WHERE patterns_fts MATCH 'adaptive AND streaming'"
    ).fetchone()[0]
    fresh = migrated_db.execute(
        "SELECT COUNT(*) FROM patterns_fts WHERE patterns_fts MATCH 'subject'"
    ).fetchone()[0]
    assert stale == 0 and fresh == 1


def test_search_folds_vietnamese_diacritics(migrated_db, seeded_user):
    _insert_pattern(
        migrated_db,
        seeded_user["id"],
        body_md="Mẫu kiến trúc này mô tả luồng dữ liệu.",
    )
    hits = migrated_db.execute(
        "SELECT COUNT(*) FROM patterns_fts WHERE patterns_fts MATCH 'kien AND truc'"
    ).fetchone()[0]
    assert hits == 1, "unicode61 remove_diacritics 2 must fold Vietnamese tone marks"


def test_published_only_search_hides_drafts(migrated_db, seeded_user):
    payload = _insert_pattern(migrated_db, seeded_user["id"])  # status = draft
    query = """
        SELECT p.id
          FROM patterns_fts f
          JOIN patterns p ON p.rowid = f.rowid
         WHERE f.patterns_fts MATCH ?
           AND p.status = 'published'
    """
    assert migrated_db.execute(query, ("adaptive",)).fetchall() == []
    # Publishing now goes through the legal gate (migration 003): a raw
    # UPDATE to 'published' without a matching approval is refused by SQLite.
    _approve(migrated_db, "pat_test1", seeded_user["id"], compute_content_hash(payload))
    migrated_db.execute("UPDATE patterns SET status='published' WHERE id='pat_test1'")
    assert len(migrated_db.execute(query, ("adaptive",)).fetchall()) == 1


# --- M7: an uncited benchmark cannot claim to be 'declared' -----------------


def test_declared_benchmark_requires_a_source_url(migrated_db):
    now = utcnow_iso()
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute(
            """
            INSERT INTO benchmarks (id, component_type, metric, value, unit, hardware_profile,
                                    basis, confidence, created_at, updated_at)
            VALUES ('bm1','cache','ops_per_sec',80000,'ops/s','single shard',
                    'published benchmarks','declared',?,?)
            """,
            (now, now),
        )


def test_estimated_benchmark_may_omit_a_source_url(migrated_db):
    now = utcnow_iso()
    migrated_db.execute(
        """
        INSERT INTO benchmarks (id, component_type, metric, value, unit, hardware_profile,
                                basis, confidence, created_at, updated_at)
        VALUES ('bm2','service','rps',1000,'rps','4 vCPU JSON API',
                'industry rule of thumb','estimated',?,?)
        """,
        (now, now),
    )
    assert migrated_db.execute("SELECT COUNT(*) FROM benchmarks").fetchone()[0] == 1
