"""Saved sizing runs (pilot WP-A, docs/v3/05 and 06). Migration 006.

Owner-scoped exactly like designs: every query filters on ``owner_user_id``,
so someone else's run and a missing run are the same ``None`` /
``NotFoundError`` (404, never 403). Whether the caller may attach a run to a
design is checked by the router with the designs repository's own rule.

Runs are immutable records of one evaluation; there is no update.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from ..db import utcnow_iso
from .errors import NotFoundError
from .users import new_id

DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 500


def get_run(conn: sqlite3.Connection, owner_id: str, run_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM sizing_runs WHERE id = ? AND owner_user_id = ?",
        (run_id, owner_id),
    ).fetchone()


def list_runs(
    conn: sqlite3.Connection, owner_id: str, *, design_id: str | None, limit: int, offset: int
) -> tuple[list[sqlite3.Row], int]:
    """Newest first (same-second ties: newest row first); all of the caller's
    runs, or only those of one design."""
    where = "owner_user_id = ?"
    params: list[Any] = [owner_id]
    if design_id is not None:
        where += " AND design_id = ?"
        params.append(design_id)
    total = conn.execute(f"SELECT COUNT(*) FROM sizing_runs WHERE {where}", params).fetchone()[0]  # noqa: S608 - literal clauses only
    rows = conn.execute(
        f"SELECT * FROM sizing_runs WHERE {where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",  # noqa: S608
        [*params, limit, offset],
    ).fetchall()
    return rows, total


def create_run(conn: sqlite3.Connection, owner_id: str, *, design_id: str | None, body: dict[str, Any]) -> sqlite3.Row:
    run_id = new_id("srn")
    conn.execute(
        "INSERT INTO sizing_runs (id, owner_user_id, design_id, body_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (
            run_id,
            owner_id,
            design_id,
            json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
            utcnow_iso(),
        ),
    )
    row = get_run(conn, owner_id, run_id)
    assert row is not None  # noqa: S101 - just inserted
    return row


def delete_run(conn: sqlite3.Connection, owner_id: str, run_id: str) -> None:
    cursor = conn.execute("DELETE FROM sizing_runs WHERE id = ? AND owner_user_id = ?", (run_id, owner_id))
    if cursor.rowcount == 0:
        raise NotFoundError(run_id)


def run_out_fields(row: sqlite3.Row) -> dict[str, Any]:
    """Row -> ``SizingRun`` wire fields. The body is stored camelCase; the
    columns (id, design, time) are authoritative over anything in it."""
    body = json.loads(row["body_json"])
    return {
        "id": row["id"],
        "design_id": row["design_id"],
        "component_label": body.get("componentLabel"),
        "rule_pack_id": body.get("rulePackId", ""),
        "rule_pack_version": body.get("rulePackVersion", 0),
        "model_id": body.get("modelId", ""),
        "model_name": body.get("modelName", ""),
        "inputs": body.get("inputs", []),
        "steps": body.get("steps", []),
        "outputs": body.get("outputs", []),
        "binding": body.get("binding"),
        "warnings": body.get("warnings", []),
        "created_at": row["created_at"],
    }
