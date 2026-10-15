"""Reset the password of an existing ArchPilot user (pilot operations helper).

Runs INSIDE the container; docker-compose.pilot.yml mounts scripts/pilot at /pilot
(read-only). Used by scripts/pilot/reset-password.ps1:

    <new password> | docker exec -i archpilot-pilot python /pilot/reset_password.py alice

The password is read from the first line of stdin (never from argv or the
environment, same rule as backend/scripts/create_user.py). All active sessions of
the user are revoked so the old password stops working immediately.

Exit codes: 0 done / 2 bad input (weak password) / 3 unknown user.
"""

from __future__ import annotations

import sys

# Image layout: the application lives in /srv (backend/Dockerfile WORKDIR).
sys.path.insert(0, "/srv")

from app.config import get_settings  # noqa: E402
from app.db import connect, utcnow_iso  # noqa: E402
from app.repositories import users as users_repo  # noqa: E402
from app.security import WeakPasswordError  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: reset_password.py <username>   (new password on stdin)", file=sys.stderr)
        return 2
    username = argv[1]
    # lstrip the UTF-8 BOM that Windows PowerShell 5.1 adds when piping into
    # `docker exec -i` (same fix as backend/scripts/create_user.py).
    password = sys.stdin.readline().lstrip("\ufeff").rstrip("\r\n")

    settings = get_settings()
    conn = connect(settings.db_path)
    try:
        user = users_repo.get_user_by_username(conn, username)
        if user is None:
            print(f"error: no such user {username!r}", file=sys.stderr)
            return 3
        try:
            users_repo.set_password(conn, user["id"], password, iterations=settings.pbkdf2_iterations)
        except WeakPasswordError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        cursor = conn.execute(
            "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (utcnow_iso(), user["id"]),
        )
        print(f"password reset for {user['username']}; sessions revoked: {cursor.rowcount}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
