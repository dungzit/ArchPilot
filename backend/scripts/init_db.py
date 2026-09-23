"""Create/migrate the SQLite database and optionally seed the first user.

Usage (from ArchPilot/backend):
    python -m scripts.init_db
    python -m scripts.init_db --create-user admin --role admin
    ARCHPILOT_ADMIN_PASSWORD=... python -m scripts.init_db --create-user admin --role admin

The password is never a command-line argument: it is read from
ARCHPILOT_ADMIN_PASSWORD or prompted for, so it does not land in shell history
or the process list.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

# Run as `python -m scripts.init_db` from backend/, or directly as a file; the
# path insert makes the second form work. Imports must follow it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.db import connect, run_migrations
from app.repositories import users as users_repo
from app.security import WeakPasswordError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Initialise the ArchPilot SQLite database.")
    parser.add_argument("--create-user", metavar="USERNAME", help="create a local-auth user")
    parser.add_argument("--display-name", default=None)
    parser.add_argument("--role", default="member", choices=["member", "editor", "admin"])
    args = parser.parse_args(argv)

    settings = get_settings()
    conn = connect(settings.db_path)
    try:
        applied = run_migrations(conn)
        print(f"database: {settings.db_path}")
        print(f"migrations applied this run: {applied or 'none (already current)'}")

        if args.create_user:
            password = os.environ.get("ARCHPILOT_ADMIN_PASSWORD")
            if not password:
                password = getpass.getpass(f"password for {args.create_user}: ")
                confirm = getpass.getpass("confirm password: ")
                if password != confirm:
                    print("passwords do not match", file=sys.stderr)
                    return 2
            try:
                user_id = users_repo.create_user(
                    conn,
                    username=args.create_user,
                    password=password,
                    display_name=args.display_name,
                    role=args.role,
                    iterations=settings.pbkdf2_iterations,
                )
            except WeakPasswordError as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 2
            except users_repo.UsernameTakenError as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 3
            print(f"created user {args.create_user} ({args.role}) id={user_id}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
