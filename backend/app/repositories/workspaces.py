"""Workspace persistence (task 1.3) - the server home for ``store.ts``'s WorkspaceRecord.

"Current" workspace: the schema allows several workspaces per owner, the SPA
has exactly one. Until a workspace switcher exists, "current" is the owner's
oldest workspace - deterministic, and unaffected by later additions.

Revision model: the client sends the revision it last saw. ``0`` means "I have
never seen one" and is the only way to create the row. The server assigns the
next revision; the client never increments it (build-scope §3.5.2).
"""

from __future__ import annotations

import sqlite3

from ..db import immediate_transaction, utcnow_iso
from .errors import RevisionConflictError
from .users import new_id

DEFAULT_NAME = "Personal workspace"  # matches the SPA's fallback label in App.tsx


def get_current(conn: sqlite3.Connection, owner_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM workspaces WHERE owner_id = ? ORDER BY created_at, id LIMIT 1",
        (owner_id,),
    ).fetchone()


def _insert(
    conn: sqlite3.Connection,
    owner_id: str,
    *,
    name: str,
    project_name: str = "",
    system_name: str = "",
    deployment_target: str = "on_premises",
) -> sqlite3.Row:
    workspace_id = new_id("wsp")
    now = utcnow_iso()
    conn.execute(
        """
        INSERT INTO workspaces (id, owner_id, name, project_name, system_name,
                                deployment_target, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (workspace_id, owner_id, name, project_name, system_name, deployment_target, now, now),
    )
    return conn.execute("SELECT * FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()


def ensure_current(conn: sqlite3.Connection, owner_id: str) -> sqlite3.Row:
    """Get-or-create, for callers that need a workspace id (designs.workspace_id is NOT NULL).

    Must be called inside a transaction when the caller also writes, so the
    check and the insert cannot interleave with another request.
    """
    row = get_current(conn, owner_id)
    return row if row is not None else _insert(conn, owner_id, name=DEFAULT_NAME)


def put_current(
    conn: sqlite3.Connection,
    owner_id: str,
    *,
    name: str,
    project_name: str,
    system_name: str,
    deployment_target: str,
    expected_revision: int,
) -> sqlite3.Row:
    """Create (``expected_revision == 0``) or update the owner's current workspace.

    Raises ``RevisionConflictError`` when ``expected_revision`` is stale.
    """
    with immediate_transaction(conn):
        current = get_current(conn, owner_id)
        if current is None:
            if expected_revision != 0:
                raise RevisionConflictError(expected=expected_revision, current=0)
            return _insert(
                conn,
                owner_id,
                name=name,
                project_name=project_name,
                system_name=system_name,
                deployment_target=deployment_target,
            )

        if expected_revision != current["revision"]:
            raise RevisionConflictError(expected=expected_revision, current=current["revision"])

        conn.execute(
            """
            UPDATE workspaces
               SET name = ?, project_name = ?, system_name = ?, deployment_target = ?,
                   revision = revision + 1, updated_at = ?
             WHERE id = ? AND owner_id = ? AND revision = ?
            """,
            (
                name,
                project_name,
                system_name,
                deployment_target,
                utcnow_iso(),
                current["id"],
                owner_id,
                expected_revision,
            ),
        )
        return conn.execute("SELECT * FROM workspaces WHERE id = ?", (current["id"],)).fetchone()
