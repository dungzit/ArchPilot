"""Password hashing and session tokens, stdlib only.

No bcrypt/argon2/passlib dependency. PBKDF2-HMAC-SHA256 at 600k iterations is
the OWASP 2023 baseline for PBKDF2 and is entirely inside ``hashlib``, which
matches this repo's stdlib-preferring convention and keeps the container small.

Known limitation: PBKDF2 is memory-cheap compared with argon2id. For 2-4
internal users behind the corporate network this is an accepted trade-off; the
``password_iterations`` column is per-user so the factor can be raised, or the
scheme swapped, without a destructive migration.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass

SALT_BYTES = 16
SESSION_TOKEN_BYTES = 32
CSRF_TOKEN_BYTES = 32
MIN_PASSWORD_LENGTH = 12


class WeakPasswordError(ValueError):
    """Raised when a proposed password does not meet the minimum policy."""


@dataclass(frozen=True)
class PasswordHash:
    hash_hex: str
    salt_hex: str
    iterations: int


def check_password_policy(password: str) -> None:
    """Minimal, explicit policy. Length only - no composition rules (NIST 800-63B)."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"password must be at least {MIN_PASSWORD_LENGTH} characters"
        )


def hash_password(password: str, *, iterations: int, salt_hex: str | None = None) -> PasswordHash:
    """Derive a PBKDF2-HMAC-SHA256 hash. Generates a fresh salt unless given one."""
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return PasswordHash(hash_hex=digest.hex(), salt_hex=salt.hex(), iterations=iterations)


def verify_password(password: str, *, hash_hex: str, salt_hex: str, iterations: int) -> bool:
    """Constant-time password check."""
    try:
        candidate = hash_password(password, iterations=iterations, salt_hex=salt_hex)
    except ValueError:
        return False
    return hmac.compare_digest(candidate.hash_hex, hash_hex)


def new_session_token() -> tuple[str, str]:
    """Return ``(raw_token, token_hash)``.

    The raw token goes to the client in an httpOnly cookie and is never stored.
    Only the hash is persisted, so a database copy cannot be replayed as a
    live session.
    """
    raw = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    return raw, hash_session_token(raw)


def hash_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def new_csrf_token() -> str:
    """Random double-submit token. Not secret-derived: it only needs to be
    unguessable by a cross-site attacker who cannot read the cookie."""
    return secrets.token_urlsafe(CSRF_TOKEN_BYTES)


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)
