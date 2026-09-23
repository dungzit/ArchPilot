"""Create a local ArchPilot user (task 1.2: "a way to create the first user").

Usage (from ArchPilot/backend, or /srv inside the container):

    # interactive: prompts twice, nothing echoed
    python -m scripts.create_user alice --role admin --display-name "Alice Nguyen"

    # non-interactive: exactly one line on stdin
    printf '%s\\n' "$PW" | python -m scripts.create_user alice --password-stdin
    docker exec -i archpilot python -m scripts.create_user alice --password-stdin < pw.txt

The password is NEVER a command-line argument (it would land in shell history
and in the process list) and is not read from an environment variable (it would
show up in `docker inspect` and /proc/<pid>/environ). Prompt or stdin only.

Runs pending migrations first, so it works on a brand-new database.

Exit codes: 0 created · 2 bad input (weak password, mismatch, no TTY) · 3 username taken.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.db import connect, run_migrations
from app.repositories import users as users_repo
from app.security import WeakPasswordError


def read_password(args: argparse.Namespace) -> str | None:
    if args.password_stdin:
        line = sys.stdin.readline()
        return line.rstrip("\r\n")
    if not sys.stdin.isatty():
        print(
            "error: stdin is not a terminal; pipe the password with --password-stdin",
            file=sys.stderr,
        )
        return None
    password = getpass.getpass(f"password for {args.username}: ")
    if getpass.getpass("confirm password: ") != password:
        print("error: passwords do not match", file=sys.stderr)
        return None
    return password


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a local ArchPilot user.")
    parser.add_argument("username")
    parser.add_argument("--display-name", default=None)
    parser.add_argument("--role", default="member", choices=["member", "editor", "admin"])
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="read the password from the first line of stdin instead of prompting",
    )
    args = parser.parse_args(argv)

    password = read_password(args)
    if password is None:
        return 2

    settings = get_settings()
    conn = connect(settings.db_path)
    try:
        run_migrations(conn)
        user_id = users_repo.create_user(
            conn,
            username=args.username,
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
    finally:
        conn.close()

    print(f"created user {args.username} ({args.role}) id={user_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
