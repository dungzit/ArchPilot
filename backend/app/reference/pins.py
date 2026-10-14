"""Reference pins: "this SysDesAi design (step) is a reference for MY design".

Access rule = the designs repository's: the ArchPilot design must be live and
owned by the caller (``designs_repo.get_design``). Someone else's design, a
deleted one and a missing one are all ``NotFoundError`` -> 404, never 403.
Pins are also owner-scoped themselves (``owner_user_id``).
"""

from __future__ import annotations

import sqlite3

from ..db import utcnow_iso
from ..repositories import designs as designs_repo
from ..repositories.errors import NotFoundError
from ..repositories.users import new_id

MAX_PINS_PER_DESIGN = 200


class ReferenceNotFoundError(LookupError):
    """The share id (or step position) is not in the reference index."""


class PinLimitError(RuntimeError):
    pass


def _require_design(conn: sqlite3.Connection, owner_id: str, design_id: str) -> None:
    if designs_repo.get_design(conn, owner_id, design_id) is None:
        raise NotFoundError(design_id)


_SELECT = """
    SELECT id, design_id, share_id, step_position, title, step_title, note, created_at
      FROM reference_pins
"""


def list_pins(conn: sqlite3.Connection, owner_id: str, design_id: str) -> list[sqlite3.Row]:
    _require_design(conn, owner_id, design_id)
    return conn.execute(
        _SELECT + " WHERE owner_user_id = ? AND design_id = ? ORDER BY created_at, rowid",
        (owner_id, design_id),
    ).fetchall()


def get_pin(conn: sqlite3.Connection, owner_id: str, pin_id: str) -> sqlite3.Row | None:
    return conn.execute(_SELECT + " WHERE id = ? AND owner_user_id = ?", (pin_id, owner_id)).fetchone()


def create_pin(
    conn: sqlite3.Connection,
    owner_id: str,
    *,
    design_id: str,
    share_id: str,
    step_position: int | None,
    note: str | None,
) -> tuple[sqlite3.Row, bool]:
    """Returns ``(pin, created)``. Pinning the same target twice is idempotent."""
    _require_design(conn, owner_id, design_id)
    reference = conn.execute(
        "SELECT id, title FROM reference_designs WHERE share_id = ? AND status = 'active'", (share_id,)
    ).fetchone()
    if reference is None:
        raise ReferenceNotFoundError(share_id)
    step_title = None
    if step_position is not None:
        step = conn.execute(
            "SELECT title FROM reference_steps WHERE design_id = ? AND position = ?",
            (reference["id"], step_position),
        ).fetchone()
        if step is None:
            raise ReferenceNotFoundError(f"{share_id} step {step_position}")
        step_title = step["title"]

    existing = conn.execute(
        _SELECT
        + " WHERE owner_user_id = ? AND design_id = ? AND share_id = ? AND ifnull(step_position, 0) = ifnull(?, 0)",
        (owner_id, design_id, share_id, step_position),
    ).fetchone()
    if existing is not None:
        return existing, False
    count = conn.execute(
        "SELECT COUNT(*) FROM reference_pins WHERE owner_user_id = ? AND design_id = ?", (owner_id, design_id)
    ).fetchone()[0]
    if count >= MAX_PINS_PER_DESIGN:
        raise PinLimitError(f"at most {MAX_PINS_PER_DESIGN} reference pins per design")

    pin_id = new_id("rpin")
    try:
        conn.execute(
            """
            INSERT INTO reference_pins (id, owner_user_id, design_id, share_id, step_position,
                                        title, step_title, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (pin_id, owner_id, design_id, share_id, step_position, reference["title"], step_title, note, utcnow_iso()),
        )
    except sqlite3.IntegrityError:
        # Lost a race with an identical concurrent pin: return the winner.
        row = conn.execute(
            _SELECT
            + " WHERE owner_user_id = ? AND design_id = ? AND share_id = ? AND ifnull(step_position, 0) = ifnull(?, 0)",
            (owner_id, design_id, share_id, step_position),
        ).fetchone()
        if row is None:
            raise
        return row, False
    row = get_pin(conn, owner_id, pin_id)
    assert row is not None  # noqa: S101 - just inserted
    return row, True


def delete_pin(conn: sqlite3.Connection, owner_id: str, pin_id: str) -> None:
    cursor = conn.execute("DELETE FROM reference_pins WHERE id = ? AND owner_user_id = ?", (pin_id, owner_id))
    if cursor.rowcount == 0:
        raise NotFoundError(pin_id)
