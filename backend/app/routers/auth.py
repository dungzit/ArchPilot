"""Local username/password authentication (Product Owner decision 4).

No SSO, no OIDC, no Entra ID - the audience is 2-4 internal users.
Session model: opaque random token in an httpOnly cookie, SHA-256 of the token
stored server-side in ``sessions``.

Status: the login/logout/me trio below is real and tested. What is NOT here
yet and is called out as a stub in the build-scope doc: password self-service
change, account lockout persistence across restarts, and CSRF double-submit
tokens for cookie-authenticated mutating routes.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request, Response, status

from ..config import Settings
from ..dependencies import AppSettings, CurrentUser, DbConn, extract_token
from ..repositories import users as users_repo
from ..schemas import LoginRequest, LoginResponse, MessageResponse, UserOut
from ..security import new_csrf_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

# Brute-force brake. In-process and therefore reset by a restart; that is
# acceptable for a single container with 2-4 users, and is listed as a known
# limitation rather than pretended away.
MAX_ATTEMPTS = 8
ATTEMPT_WINDOW_SECONDS = 300
# Bound on distinct (ip, username) keys held in memory. The map is keyed partly
# on attacker-controlled input, so without a cap and a sweep it grows by one
# entry per username tried, forever - an unauthenticated memory-exhaustion path
# on a process that is supposed to run for weeks.
MAX_TRACKED_KEYS = 2048
_attempts: dict[str, list[float]] = defaultdict(list)


def _throttle_key(request: Request, username: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}|{username.lower()}"


def _sweep(cutoff: float) -> None:
    for key in [k for k, stamps in _attempts.items() if not stamps or max(stamps) <= cutoff]:
        _attempts.pop(key, None)


def _register_failure(key: str) -> None:
    now = time.monotonic()
    if len(_attempts) >= MAX_TRACKED_KEYS:
        _sweep(now - ATTEMPT_WINDOW_SECONDS)
    if len(_attempts) >= MAX_TRACKED_KEYS:
        # Still full of live entries: drop the oldest rather than grow without
        # bound. Losing a counter is a smaller failure than losing the process.
        oldest = min(_attempts, key=lambda k: max(_attempts[k], default=0.0))
        _attempts.pop(oldest, None)
    _attempts[key].append(now)


def _is_throttled(key: str) -> bool:
    now = time.monotonic()
    cutoff = now - ATTEMPT_WINDOW_SECONDS
    recent = [ts for ts in _attempts.get(key, ()) if ts > cutoff]
    if recent:
        _attempts[key] = recent
    else:
        # Do not leave an empty list behind: that is what made every username
        # ever tried a permanent dictionary entry.
        _attempts.pop(key, None)
    return len(recent) >= MAX_ATTEMPTS


def _clear_failures(key: str) -> None:
    _attempts.pop(key, None)


def reset_throttle_state() -> None:
    """Test hook."""
    _attempts.clear()


def _set_session_cookie(response: Response, token: str, settings: Settings, max_age: int) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _set_csrf_cookie(response: Response, token: str, settings: Settings, max_age: int) -> None:
    """Double-submit token. Deliberately NOT httpOnly: the SPA has to read it
    and echo it in the x-csrf-token header. It is not a credential on its own -
    a request still needs the httpOnly session cookie to authenticate."""
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _user_out(row) -> UserOut:
    return UserOut(
        id=row["id"],
        username=row["username"],
        display_name=row["display_name"],
        role=row["role"],
    )


@router.post("/login", response_model=LoginResponse, summary="Local username/password login")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    conn: DbConn,
    settings: AppSettings,
) -> LoginResponse:
    key = _throttle_key(request, payload.username)
    if _is_throttled(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too many failed attempts; try again later",
        )

    user = users_repo.get_user_by_username(conn, payload.username)
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid username or password"
    )

    if user is None or not user["is_active"]:
        # Spend comparable time on the unknown-user path so response timing does
        # not reveal whether the username exists. The iteration count is read
        # from the users table, not from settings: raising
        # ARCHPILOT_PBKDF2_ITERATIONS otherwise makes the unknown-user path
        # measurably slower than every not-yet-rehashed real account.
        users_repo.hash_password_dummy(conn, fallback_iterations=settings.pbkdf2_iterations)
        _register_failure(key)
        logger.info("login failed: unknown or inactive user")
        raise invalid

    ok = users_repo.verify_user_password(user, payload.password)
    if not ok:
        _register_failure(key)
        logger.info("login failed: bad password", extra={"user_id": user["id"]})
        raise invalid

    _clear_failures(key)
    # Converge stored hashes on the configured cost factor. Without this the
    # per-user password_iterations column (the documented upgrade seam) leaves a
    # permanent timing difference between real and unknown usernames.
    users_repo.upgrade_password_iterations(
        conn, user, payload.password, target_iterations=settings.pbkdf2_iterations
    )
    users_repo.purge_expired_sessions(conn)

    raw_token, token_hash = users_repo.mint_session_token()
    expires_at = users_repo.create_session(
        conn,
        user_id=user["id"],
        token_hash=token_hash,
        ttl_hours=settings.session_ttl_hours,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    max_age = settings.session_ttl_hours * 3600
    csrf_token = new_csrf_token()
    _set_session_cookie(response, raw_token, settings, max_age)
    _set_csrf_cookie(response, csrf_token, settings, max_age)
    logger.info("login ok", extra={"user_id": user["id"]})
    return LoginResponse(user=_user_out(user), expires_at=expires_at, csrf_token=csrf_token)


@router.post("/logout", response_model=MessageResponse, summary="Revoke the current session")
def logout(
    request: Request,
    response: Response,
    conn: DbConn,
    settings: AppSettings,
) -> MessageResponse:
    token = extract_token(request, settings)
    if token:
        users_repo.revoke_session(conn, token)
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")
    return MessageResponse(message="logged out")


@router.get("/me", response_model=UserOut, summary="Current authenticated user")
def me(user: CurrentUser) -> UserOut:
    return _user_out(user)
