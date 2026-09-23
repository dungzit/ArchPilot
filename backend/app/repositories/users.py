"""User and session persistence. Plain SQL, no ORM."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

from ..db import utcnow_iso
from ..security import (
    PasswordHash,
    check_password_policy,
    hash_password,
    hash_session_token,
    new_session_token,
    verify_password,
)

DUMMY_PASSWORD_SALT = "00" * 16


class UsernameTakenError(ValueError):
    pass


def mint_session_token() -> tuple[str, str]:
    """Re-export so routers depend on the repository, not on ``security`` directly."""
    return new_session_token()


def verify_user_password(user_row: sqlite3.Row, password: str) -> bool:
    return verify_password(
        password,
        hash_hex=user_row["password_hash"],
        salt_hex=user_row["password_salt"],
        iterations=user_row["password_iterations"],
    )


def dummy_iterations(conn: sqlite3.Connection, fallback: int) -> int:
    """The iteration count a *real* verify would most likely cost right now.

    ``users.password_iterations`` is per-user precisely so the cost factor can
    be raised later. That upgrade seam is also a user-enumeration oracle if the
    unknown-user path burns the *configured* count while every stored account
    still carries the old one: measured on this code base, raising 600k -> 1.2M
    made a non-existent username take 737 ms against 378 ms for a real one -
    two clean, non-overlapping populations. Charging the unknown path the
    highest count actually stored keeps the two paths equal until
    ``upgrade_password_iterations`` has converged the accounts.
    """
    row = conn.execute("SELECT MAX(password_iterations) AS m FROM users WHERE is_active = 1").fetchone()
    stored = row["m"] if row is not None else None
    return int(stored) if stored else fallback


def hash_password_dummy(conn: sqlite3.Connection, *, fallback_iterations: int) -> None:
    """Burn the same CPU as a real verify on the unknown-user path.

    Without this, an unknown username returns in microseconds while a known
    username costs a full PBKDF2 derivation - a trivially measurable user
    enumeration oracle.
    """
    hash_password(
        "invalid-password-placeholder",
        iterations=dummy_iterations(conn, fallback_iterations),
        salt_hex=DUMMY_PASSWORD_SALT,
    )


def upgrade_password_iterations(
    conn: sqlite3.Connection, user_row: sqlite3.Row, password: str, *, target_iterations: int
) -> bool:
    """Re-hash a verified password at the configured cost factor.

    Called only after a successful login, when the plaintext is available. This
    is what makes raising ARCHPILOT_PBKDF2_ITERATIONS actually take effect, and
    what collapses the timing gap described in ``dummy_iterations``.
    """
    if user_row["password_iterations"] >= target_iterations:
        return False
    digest = hash_password(password, iterations=target_iterations)
    conn.execute(
        """
        UPDATE users
           SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
         WHERE id = ?
        """,
        (digest.hash_hex, digest.salt_hex, digest.iterations, utcnow_iso(), user_row["id"]),
    )
    return True


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def create_user(
    conn: sqlite3.Connection,
    *,
    username: str,
    password: str,
    display_name: str | None = None,
    role: str = "member",
    iterations: int,
) -> str:
    """Create a local-auth user. Raises on a weak password or a taken username."""
    check_password_policy(password)
    digest: PasswordHash = hash_password(password, iterations=iterations)
    user_id = new_id("usr")
    now = utcnow_iso()
    try:
        conn.execute(
            """
            INSERT INTO users (id, username, display_name, password_hash, password_salt,
                               password_iterations, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                user_id,
                username,
                display_name or username,
                digest.hash_hex,
                digest.salt_hex,
                digest.iterations,
                role,
                now,
                now,
            ),
        )
    except sqlite3.IntegrityError as exc:
        raise UsernameTakenError(f"username {username!r} already exists") from exc
    return user_id


def get_user_by_username(conn: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
    ).fetchone()


def get_user_by_id(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def set_password(
    conn: sqlite3.Connection, user_id: str, password: str, *, iterations: int
) -> None:
    check_password_policy(password)
    digest = hash_password(password, iterations=iterations)
    conn.execute(
        """
        UPDATE users
           SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
         WHERE id = ?
        """,
        (digest.hash_hex, digest.salt_hex, digest.iterations, utcnow_iso(), user_id),
    )


def create_session(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    token_hash: str,
    ttl_hours: int,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> str:
    """Persist a session and return its expiry timestamp."""
    session_id = new_id("ses")
    created = datetime.now(timezone.utc).replace(microsecond=0)
    expires = created + timedelta(hours=ttl_hours)
    conn.execute(
        """
        INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            user_id,
            token_hash,
            created.isoformat(),
            expires.isoformat(),
            (user_agent or "")[:256] or None,
            ip_address,
        ),
    )
    return expires.isoformat()


def resolve_session(conn: sqlite3.Connection, raw_token: str) -> sqlite3.Row | None:
    """Return the active user for a raw session token, or None."""
    row = conn.execute(
        """
        SELECT u.*, s.id AS session_id, s.expires_at AS session_expires_at
          FROM sessions s
          JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?
           AND s.revoked_at IS NULL
           AND s.expires_at > ?
           AND u.is_active = 1
        """,
        (hash_session_token(raw_token), utcnow_iso()),
    ).fetchone()
    return row


def revoke_session(conn: sqlite3.Connection, raw_token: str) -> None:
    conn.execute(
        "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        (utcnow_iso(), hash_session_token(raw_token)),
    )


def purge_expired_sessions(conn: sqlite3.Connection) -> int:
    cursor = conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (utcnow_iso(),))
    return cursor.rowcount or 0
