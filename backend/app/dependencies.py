"""Shared FastAPI dependencies: settings, database, current user."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from .config import Settings, get_settings
from .db import get_connection
from .repositories import users as users_repo

DbConn = Annotated[sqlite3.Connection, Depends(get_connection)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def extract_token(request: Request, settings: Settings) -> str | None:
    """Session cookie first; ``Authorization: Bearer`` as the scripting fallback."""
    cookie = request.cookies.get(settings.session_cookie_name)
    if cookie:
        return cookie
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


def get_current_user(
    request: Request,
    conn: DbConn,
    settings: AppSettings,
) -> sqlite3.Row:
    """Require an authenticated session. 401 otherwise."""
    token = extract_token(request, settings)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    row = users_repo.resolve_session(conn, token)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="session invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return row


CurrentUser = Annotated[sqlite3.Row, Depends(get_current_user)]


def require_role(*allowed: str):
    """Role gate for admin/editor routes. Checked server-side, never in the UI only."""

    def _dependency(user: CurrentUser) -> sqlite3.Row:
        if user["role"] not in allowed:
            # 404 rather than 403 would hide the route; for an internal tool with
            # 2-4 known users an explicit 403 is more useful to the operator.
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role")
        return user

    return _dependency
