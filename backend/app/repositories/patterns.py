"""Pattern storage helpers that carry the B1 legal-gate invariant.

The HTTP layer for patterns is Phase 4/5 work and is not written yet. These two
functions exist now because they are the *application* half of blocker B1, and
the trigger half (migration 003) cannot do their job: SQLite has no SHA-256, so
a trigger can only compare ``patterns.content_hash`` against an approved review.
If that column is stale or forged, the trigger passes. Recomputing the hash from
the row's actual bytes is the only check that cannot be fooled, and it belongs
here so every future router reaches the gate through one function.
"""

from __future__ import annotations

import sqlite3

from ..content_hash import compute_content_hash
from ..db import utcnow_iso

HASHED_COLUMNS = (
    "title, summary_one_line, body_md, graph_json, categories_json, "
    "source_company, source_url, source_title, source_published_date"
)


class PublishBlockedError(RuntimeError):
    """Raised when a publish would breach the content-hash gate (NFR-LEGAL-001)."""


def recompute_content_hash(conn: sqlite3.Connection, pattern_id: str) -> str:
    """SHA-256 of the row as it actually is right now."""
    # S608: HASHED_COLUMNS is a module-level literal, never caller input, and the
    # only value that comes from a caller (pattern_id) is bound as a parameter.
    row = conn.execute(
        f"SELECT {HASHED_COLUMNS} FROM patterns WHERE id = ?",  # noqa: S608
        (pattern_id,),
    ).fetchone()
    if row is None:
        raise PublishBlockedError(f"pattern {pattern_id!r} does not exist")
    return compute_content_hash(dict(row))


def resync_content_hash(conn: sqlite3.Connection, pattern_id: str) -> str:
    """Write the true hash back. Call this on every content save."""
    digest = recompute_content_hash(conn, pattern_id)
    conn.execute(
        "UPDATE patterns SET content_hash = ?, updated_at = ? WHERE id = ?",
        (digest, utcnow_iso(), pattern_id),
    )
    return digest


def publish_pattern(conn: sqlite3.Connection, pattern_id: str) -> None:
    """Publish only if the stored hash is truthful AND was approved.

    Three checks, in order:
      1. the row's real hash equals the stored ``content_hash`` (catches a
         forged or stale column, which the trigger cannot see);
      2. an ``approved`` legal_review exists for exactly that hash;
      3. the UPDATE itself, which the migration-003 trigger re-checks.
    """
    row = conn.execute(
        "SELECT status, content_hash FROM patterns WHERE id = ?", (pattern_id,)
    ).fetchone()
    if row is None:
        raise PublishBlockedError(f"pattern {pattern_id!r} does not exist")

    true_hash = recompute_content_hash(conn, pattern_id)
    if true_hash != row["content_hash"]:
        raise PublishBlockedError(
            "stored content_hash does not match the pattern's current content; "
            "re-save and re-review before publishing"
        )

    approved = conn.execute(
        """
        SELECT 1 FROM legal_reviews
         WHERE pattern_id = ? AND decision = 'approved' AND content_hash = ?
         LIMIT 1
        """,
        (pattern_id, true_hash),
    ).fetchone()
    if approved is None:
        raise PublishBlockedError(
            "no approved legal_review matches the current content (B1)"
        )

    now = utcnow_iso()
    conn.execute(
        "UPDATE patterns SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?",
        (now, now, pattern_id),
    )


def unpublish_pattern(conn: sqlite3.Connection, pattern_id: str) -> int:
    """One-click takedown (NFR-LEGAL-002). Returns the derived-design count so
    the reply to the requester can be honest (red-team M10)."""
    now = utcnow_iso()
    conn.execute(
        "UPDATE patterns SET status = 'unpublished', published_at = NULL, updated_at = ? WHERE id = ?",
        (now, pattern_id),
    )
    return conn.execute(
        "SELECT COUNT(*) FROM designs WHERE seeded_from_pattern_id = ?", (pattern_id,)
    ).fetchone()[0]
