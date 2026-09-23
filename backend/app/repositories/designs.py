"""Design persistence (task 1.6). One ``ArchGraph`` JSON document per design.

Every query is scoped by ``owner_id`` AND ``deleted_at IS NULL``. A design that
belongs to someone else and a design that does not exist are the same thing to
the caller: ``None`` / ``NotFoundError``, which the router turns into 404.

Deletion is soft (``deleted_at``): the column already existed in 001, and a
takedown (NFR-LEGAL-002) still needs to count designs derived from a pattern.

Graph validation is NOT done here - the request model runs it against the wire
contract before this layer is reached (``app/schemas.py`` -> ``app/contract.py``).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from ..db import immediate_transaction, utcnow_iso
from . import workspaces as workspaces_repo
from .errors import NotFoundError, RevisionConflictError
from .users import new_id

DEFAULT_LIST_LIMIT = 50
MAX_LIST_LIMIT = 100

_LIVE = "owner_id = ? AND deleted_at IS NULL"


def serialise_graph(graph: dict[str, Any]) -> str:
    # Key order is preserved (no sort_keys): what the client sent is what it
    # gets back. ensure_ascii=False keeps Vietnamese labels readable in the DB.
    return json.dumps(graph, ensure_ascii=False, separators=(",", ":"))


def get_design(conn: sqlite3.Connection, owner_id: str, design_id: str) -> sqlite3.Row | None:
    return conn.execute(
        f"SELECT * FROM designs WHERE id = ? AND {_LIVE}",  # noqa: S608 - _LIVE is a literal
        (design_id, owner_id),
    ).fetchone()


def list_designs(
    conn: sqlite3.Connection, owner_id: str, *, limit: int, offset: int
) -> tuple[list[sqlite3.Row], int]:
    """Newest first. ``graph_json`` is deliberately not selected: a list page
    never needs the graphs, and a graph can be large."""
    total = conn.execute(
        f"SELECT COUNT(*) FROM designs WHERE {_LIVE}",  # noqa: S608 - _LIVE is a literal
        (owner_id,),
    ).fetchone()[0]
    rows = conn.execute(
        f"""
        SELECT id, workspace_id, owner_id, name, schema_version, seeded_from_pattern_id,
               visibility, revision, created_at, updated_at
          FROM designs
         WHERE {_LIVE}
         ORDER BY updated_at DESC, id DESC
         LIMIT ? OFFSET ?
        """,  # noqa: S608 - _LIVE is a literal; every value is bound
        (owner_id, limit, offset),
    ).fetchall()
    return rows, total


def create_design(
    conn: sqlite3.Connection, owner_id: str, *, name: str, graph: dict[str, Any]
) -> sqlite3.Row:
    design_id = new_id("dsg")
    now = utcnow_iso()
    with immediate_transaction(conn):
        workspace = workspaces_repo.ensure_current(conn, owner_id)
        conn.execute(
            """
            INSERT INTO designs (id, workspace_id, owner_id, name, graph_json, schema_version,
                                 revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                design_id,
                workspace["id"],
                owner_id,
                name,
                serialise_graph(graph),
                graph["schemaVersion"],
                now,
                now,
            ),
        )
    row = get_design(conn, owner_id, design_id)
    assert row is not None  # noqa: S101 - just inserted inside our own transaction
    return row


def update_design(
    conn: sqlite3.Connection,
    owner_id: str,
    design_id: str,
    *,
    name: str,
    graph: dict[str, Any],
    expected_revision: int,
) -> sqlite3.Row:
    """Full replace. Raises ``NotFoundError`` or ``RevisionConflictError``."""
    with immediate_transaction(conn):
        current = get_design(conn, owner_id, design_id)
        if current is None:
            raise NotFoundError(design_id)
        if current["revision"] != expected_revision:
            raise RevisionConflictError(expected=expected_revision, current=current["revision"])
        conn.execute(
            f"""
            UPDATE designs
               SET name = ?, graph_json = ?, schema_version = ?,
                   revision = revision + 1, updated_at = ?
             WHERE id = ? AND {_LIVE} AND revision = ?
            """,  # noqa: S608 - _LIVE is a literal; every value is bound
            (
                name,
                serialise_graph(graph),
                graph["schemaVersion"],
                utcnow_iso(),
                design_id,
                owner_id,
                expected_revision,
            ),
        )
    row = get_design(conn, owner_id, design_id)
    assert row is not None  # noqa: S101
    return row


def delete_design(conn: sqlite3.Connection, owner_id: str, design_id: str) -> None:
    """Soft delete. Raises ``NotFoundError`` for a missing, foreign or already-deleted design."""
    now = utcnow_iso()
    cursor = conn.execute(
        f"UPDATE designs SET deleted_at = ?, updated_at = ? WHERE id = ? AND {_LIVE}",  # noqa: S608
        (now, now, design_id, owner_id),
    )
    if cursor.rowcount == 0:
        raise NotFoundError(design_id)
