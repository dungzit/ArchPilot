"""Blocker B1, layer 2 - the storage layer must gate publication, not only
revoke an approval after the fact (migration 003).

Every test here reproduces something that succeeded against the shipped 002
schema.
"""

from __future__ import annotations

import json
import sqlite3

import pytest

from app.content_hash import compute_content_hash
from app.db import utcnow_iso
from app.repositories.patterns import (
    PublishBlockedError,
    publish_pattern,
    recompute_content_hash,
    resync_content_hash,
    unpublish_pattern,
)

GRAPH = '{"schemaVersion":"1.0","nodes":[],"edges":[]}'

PAYLOAD = {
    "title": "Adaptive streaming",
    "summary_one_line": "One line about it.",
    "body_md": "Our own summary, in our own words.",
    "graph_json": GRAPH,
    "categories_json": '["real-time"]',
    "source_company": "Example Corp",
    "source_url": "https://example.com/blog/x",
    "source_title": "Adaptive streaming at Example Corp",
    "source_published_date": "2023-01-01",
}


def _insert(conn: sqlite3.Connection, author_id: str, **overrides) -> str:
    payload = {**PAYLOAD, **overrides}
    now = utcnow_iso()
    conn.execute(
        """
        INSERT INTO patterns (id, slug, title, summary_one_line, body_md, graph_json,
                              categories_json, source_company, source_url, source_title,
                              source_published_date, status, content_hash, author_id,
                              created_at, updated_at)
        VALUES ('pat_1','slug-1',:title,:summary_one_line,:body_md,:graph_json,
                :categories_json,:source_company,:source_url,:source_title,
                :source_published_date,'draft',:h,:author,:now,:now)
        """,
        {**payload, "h": compute_content_hash(payload), "author": author_id, "now": now},
    )
    return "pat_1"


def _approve(conn: sqlite3.Connection, pattern_id: str, reviewer_id: str, content_hash: str) -> None:
    conn.execute(
        """
        INSERT INTO legal_reviews (id, pattern_id, reviewer_id, content_hash,
                                   checklist_json, decision, reviewed_at)
        VALUES ('rev_1', ?, ?, ?, ?, 'approved', ?)
        """,
        (pattern_id, reviewer_id, content_hash,
         json.dumps({"own_words": True, "no_images": True, "cited": True,
                     "quotes_short": True, "no_endorsement": True}),
         utcnow_iso()),
    )
    conn.execute("UPDATE patterns SET status='approved' WHERE id=?", (pattern_id,))


def test_publishing_without_any_approval_is_blocked_by_the_database(migrated_db, seeded_user):
    """Reproduced against 002: this UPDATE succeeded with zero legal_reviews rows."""
    pid = _insert(migrated_db, seeded_user["id"])
    with pytest.raises(sqlite3.IntegrityError, match="publish blocked"):
        migrated_db.execute(
            "UPDATE patterns SET status='published', published_at=? WHERE id=?",
            (utcnow_iso(), pid),
        )
    assert migrated_db.execute("SELECT status FROM patterns WHERE id=?", (pid,)).fetchone()[0] == "draft"


def test_inserting_a_row_that_is_already_published_is_blocked(migrated_db, seeded_user):
    now = utcnow_iso()
    with pytest.raises(sqlite3.IntegrityError, match="publish blocked"):
        migrated_db.execute(
            """
            INSERT INTO patterns (id, slug, title, summary_one_line, body_md, graph_json,
                                  categories_json, source_company, source_url, source_title,
                                  status, content_hash, author_id, created_at, updated_at)
            VALUES ('pat_x','slug-x','t','s','b',:g,'["a"]','C','https://e/x','st',
                    'published','deadbeef',:author,:now,:now)
            """,
            {"g": GRAPH, "author": seeded_user["id"], "now": now},
        )


def test_publishing_with_a_matching_approval_succeeds(migrated_db, seeded_user):
    pid = _insert(migrated_db, seeded_user["id"])
    _approve(migrated_db, pid, seeded_user["id"], compute_content_hash(PAYLOAD))
    publish_pattern(migrated_db, pid)
    assert migrated_db.execute("SELECT status FROM patterns WHERE id=?", (pid,)).fetchone()[0] == "published"


def test_publishing_with_an_approval_for_different_bytes_is_blocked(migrated_db, seeded_user):
    pid = _insert(migrated_db, seeded_user["id"])
    _approve(migrated_db, pid, seeded_user["id"], "a" * 64)  # approved something else
    with pytest.raises(PublishBlockedError, match="no approved legal_review"):
        publish_pattern(migrated_db, pid)


def test_a_forged_content_hash_cannot_publish_unreviewed_text(migrated_db, seeded_user):
    """The trigger alone cannot catch this: SQLite has no SHA-256, so it can
    only compare the *stored* hash. The application must recompute."""
    pid = _insert(migrated_db, seeded_user["id"])
    approved_hash = compute_content_hash(PAYLOAD)
    _approve(migrated_db, pid, seeded_user["id"], approved_hash)

    # Swap in unreviewed text, then forge the hash column back to the approved value.
    migrated_db.execute("UPDATE patterns SET body_md='VERBATIM COPY' WHERE id=?", (pid,))
    migrated_db.execute("UPDATE patterns SET content_hash=? WHERE id=?", (approved_hash, pid))

    # The database-layer trigger is satisfied by the forged column...
    assert recompute_content_hash(migrated_db, pid) != approved_hash
    # ...the application layer is not.
    with pytest.raises(PublishBlockedError, match="does not match"):
        publish_pattern(migrated_db, pid)


def test_resync_then_publish_requires_a_fresh_approval(migrated_db, seeded_user):
    pid = _insert(migrated_db, seeded_user["id"])
    _approve(migrated_db, pid, seeded_user["id"], compute_content_hash(PAYLOAD))
    migrated_db.execute("UPDATE patterns SET body_md='Rewritten after approval.' WHERE id=?", (pid,))
    new_hash = resync_content_hash(migrated_db, pid)
    assert new_hash != compute_content_hash(PAYLOAD)
    with pytest.raises(PublishBlockedError):
        publish_pattern(migrated_db, pid)


def test_deleting_a_reviewed_pattern_cannot_erase_the_audit_trail(migrated_db, seeded_user):
    """Reproduced against 002: DELETE FROM patterns took legal_reviews with it
    via ON DELETE CASCADE - 1 row before, 0 after."""
    pid = _insert(migrated_db, seeded_user["id"])
    _approve(migrated_db, pid, seeded_user["id"], compute_content_hash(PAYLOAD))
    with pytest.raises(sqlite3.IntegrityError, match="cannot be deleted"):
        migrated_db.execute("DELETE FROM patterns WHERE id=?", (pid,))
    assert migrated_db.execute("SELECT COUNT(*) FROM legal_reviews").fetchone()[0] == 1


def test_unreviewed_patterns_remain_deletable(migrated_db, seeded_user):
    pid = _insert(migrated_db, seeded_user["id"])
    migrated_db.execute("DELETE FROM patterns WHERE id=?", (pid,))
    assert migrated_db.execute("SELECT COUNT(*) FROM patterns").fetchone()[0] == 0


def test_unpublish_reports_the_derived_design_count(migrated_db, seeded_user):
    pid = _insert(migrated_db, seeded_user["id"])
    _approve(migrated_db, pid, seeded_user["id"], compute_content_hash(PAYLOAD))
    publish_pattern(migrated_db, pid)

    now = utcnow_iso()
    migrated_db.execute(
        "INSERT INTO workspaces (id, owner_id, name, created_at, updated_at) VALUES ('ws1',?,'w',?,?)",
        (seeded_user["id"], now, now),
    )
    for design_id in ("d1", "d2"):
        migrated_db.execute(
            """
            INSERT INTO designs (id, workspace_id, owner_id, name, graph_json,
                                 seeded_from_pattern_id, created_at, updated_at)
            VALUES (?, 'ws1', ?, 'd', ?, ?, ?, ?)
            """,
            (design_id, seeded_user["id"], GRAPH, pid, now, now),
        )

    assert unpublish_pattern(migrated_db, pid) == 2
    assert migrated_db.execute("SELECT status FROM patterns WHERE id=?", (pid,)).fetchone()[0] == "unpublished"


def test_trigger_and_python_agree_on_the_legally_significant_columns(migrated_db):
    """Two hand-maintained lists guard the same invariant: the reset trigger's
    WHEN clause and content_hash.LEGALLY_SIGNIFICANT_FIELDS. If they drift, a
    field can be edited after approval without revoking it."""
    from app.content_hash import LEGALLY_SIGNIFICANT_FIELDS

    sql = migrated_db.execute(
        "SELECT sql FROM sqlite_master WHERE name='trg_patterns_reset_status_on_content_change'"
    ).fetchone()[0]
    watched = {field for field in LEGALLY_SIGNIFICANT_FIELDS if f"OLD.{field}" in sql}
    assert watched == set(LEGALLY_SIGNIFICANT_FIELDS), (
        "columns hashed by the application but not watched by the reset trigger: "
        f"{set(LEGALLY_SIGNIFICANT_FIELDS) - watched}"
    )
