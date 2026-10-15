"""Rule pack persistence (pilot WP-A, docs/v3/05). Migration 006.

A shared team library: every signed-in user reads every pack. Who may change
or delete one (owner or admin) is decided by the router, which reads the row
first; this layer only stores and fetches.

``version`` is owned here: 1 on create, ``version + 1`` on every update, in
one UPDATE statement so two concurrent saves still produce two versions.

Every create, update and delete also writes a row to ``events`` (05 §7: every
publish is audit-logged), in the same transaction as the change.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from ..db import immediate_transaction, utcnow_iso
from .errors import NotFoundError
from .users import new_id

DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 200

_SELECT = """
    SELECT p.id, p.owner_user_id, u.username AS owner_username, p.name, p.version, p.status,
           p.body_json, p.created_at, p.updated_at
      FROM rule_packs p
      LEFT JOIN users u ON u.id = p.owner_user_id
"""


def serialise_body(*, description: str | None, models: list[dict[str, Any]]) -> str:
    # allow_nan=False: the schemas already refuse NaN/Infinity; this is the
    # last line before json_valid() in the table's CHECK would refuse it.
    return json.dumps(
        {"description": description, "models": models},
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )


def _audit(conn: sqlite3.Connection, actor_id: str, event_type: str, pack_id: str, payload: dict[str, Any]) -> None:
    conn.execute(
        "INSERT INTO events (user_id, event_type, target_id, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?)",
        (actor_id, event_type, pack_id, json.dumps(payload, ensure_ascii=False), utcnow_iso()),
    )


def get_pack(conn: sqlite3.Connection, pack_id: str) -> sqlite3.Row | None:
    return conn.execute(f"{_SELECT} WHERE p.id = ?", (pack_id,)).fetchone()


def list_packs(conn: sqlite3.Connection, *, limit: int, offset: int) -> tuple[list[sqlite3.Row], int]:
    """Newest change first (timestamps have second precision, so ties fall back
    to the newest row). Bodies are included: the Rules screen runs packs client-side."""
    total = conn.execute("SELECT COUNT(*) FROM rule_packs").fetchone()[0]
    rows = conn.execute(
        f"{_SELECT} ORDER BY p.updated_at DESC, p.rowid DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    return rows, total


def create_pack(
    conn: sqlite3.Connection,
    owner_id: str,
    *,
    name: str,
    status: str,
    description: str | None,
    models: list[dict[str, Any]],
) -> sqlite3.Row:
    pack_id = new_id("rpk")
    now = utcnow_iso()
    with immediate_transaction(conn):
        conn.execute(
            """
            INSERT INTO rule_packs (id, owner_user_id, name, version, status, body_json, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?)
            """,
            (pack_id, owner_id, name, status, serialise_body(description=description, models=models), now, now),
        )
        _audit(conn, owner_id, "rule_pack.created", pack_id, {"version": 1, "status": status, "name": name})
    row = get_pack(conn, pack_id)
    assert row is not None  # noqa: S101 - just inserted
    return row


def update_pack(
    conn: sqlite3.Connection,
    pack_id: str,
    *,
    actor_id: str,
    name: str,
    status: str,
    description: str | None,
    models: list[dict[str, Any]],
) -> sqlite3.Row:
    """Full replace; bumps ``version``. Raises ``NotFoundError`` if the pack is gone."""
    with immediate_transaction(conn):
        cursor = conn.execute(
            """
            UPDATE rule_packs
               SET name = ?, status = ?, body_json = ?, version = version + 1, updated_at = ?
             WHERE id = ?
            """,
            (name, status, serialise_body(description=description, models=models), utcnow_iso(), pack_id),
        )
        if cursor.rowcount == 0:
            raise NotFoundError(pack_id)
        version = conn.execute("SELECT version FROM rule_packs WHERE id = ?", (pack_id,)).fetchone()[0]
        _audit(conn, actor_id, "rule_pack.updated", pack_id, {"version": version, "status": status, "name": name})
    row = get_pack(conn, pack_id)
    if row is None:  # deleted between the commit and the read
        raise NotFoundError(pack_id)
    return row


def delete_pack(conn: sqlite3.Connection, pack_id: str, *, actor_id: str) -> None:
    with immediate_transaction(conn):
        row = conn.execute("SELECT name, version FROM rule_packs WHERE id = ?", (pack_id,)).fetchone()
        if row is None:
            raise NotFoundError(pack_id)
        conn.execute("DELETE FROM rule_packs WHERE id = ?", (pack_id,))
        _audit(conn, actor_id, "rule_pack.deleted", pack_id, {"version": row["version"], "name": row["name"]})


def pack_out_fields(row: sqlite3.Row) -> dict[str, Any]:
    """Row -> ``RulePack`` wire fields (snake_case keys; the schema aliases them)."""
    body = json.loads(row["body_json"])
    return {
        "id": row["id"],
        "name": row["name"],
        "version": row["version"],
        "status": row["status"],
        "built_in": False,
        "owner": row["owner_username"],
        "description": body.get("description"),
        "models": body.get("models", []),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
