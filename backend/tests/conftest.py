from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture()
def temp_settings(tmp_path, monkeypatch):
    """Point the app at a throwaway database and a fast KDF for each test."""
    monkeypatch.setenv("ARCHPILOT_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("ARCHPILOT_BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("ARCHPILOT_ENV", "test")
    monkeypatch.setenv("ARCHPILOT_PBKDF2_ITERATIONS", "100000")
    monkeypatch.setenv("ARCHPILOT_LOG_LEVEL", "WARNING")

    from app.config import get_settings, reset_settings_cache

    reset_settings_cache()
    settings = get_settings()
    yield settings
    reset_settings_cache()


@pytest.fixture()
def migrated_db(temp_settings):
    from app.db import connect, run_migrations

    conn = connect(temp_settings.db_path)
    run_migrations(conn)
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture()
def seeded_user(migrated_db, temp_settings):
    from app.repositories import users as users_repo

    user_id = users_repo.create_user(
        migrated_db,
        username="architect",
        password="correct-horse-battery",
        display_name="Test Architect",
        role="admin",
        iterations=temp_settings.pbkdf2_iterations,
    )
    return {"id": user_id, "username": "architect", "password": "correct-horse-battery"}


@pytest.fixture()
def client(temp_settings, seeded_user):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.routers.auth import reset_throttle_state

    reset_throttle_state()
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture()
def login(client, seeded_user):
    """Log in and return the headers a browser client must send on mutations."""

    def _login(username: str | None = None, password: str | None = None) -> dict[str, str]:
        response = client.post(
            "/api/auth/login",
            json={
                "username": username or seeded_user["username"],
                "password": password or seeded_user["password"],
            },
        )
        assert response.status_code == 200, response.text
        return {"x-csrf-token": response.json()["csrfToken"]}

    return _login


# --------------------------------------------------------------------------
# Two-user fixtures for the owner-scoping tests (tasks 1.3 / 1.6). Each user
# gets their own TestClient - their own cookie jar - against the same app and
# the same database, which is what two browsers on two desks look like.
# --------------------------------------------------------------------------

SECOND_USER = {"username": "intruder", "password": "another-long-password"}


def _logged_in_client(app, username: str, password: str):
    from fastapi.testclient import TestClient

    test_client = TestClient(app)
    test_client.__enter__()
    response = test_client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    # A browser SPA echoes the CSRF cookie on every mutation; so does this client.
    test_client.headers["x-csrf-token"] = response.json()["csrfToken"]
    return test_client


@pytest.fixture()
def second_user(migrated_db, temp_settings):
    from app.repositories import users as users_repo

    user_id = users_repo.create_user(
        migrated_db,
        username=SECOND_USER["username"],
        password=SECOND_USER["password"],
        role="member",
        iterations=temp_settings.pbkdf2_iterations,
    )
    return {"id": user_id, **SECOND_USER}


@pytest.fixture()
def user_a(client, seeded_user):
    """``architect``, logged in, CSRF header preset."""
    test_client = _logged_in_client(client.app, seeded_user["username"], seeded_user["password"])
    yield test_client
    test_client.__exit__(None, None, None)


@pytest.fixture()
def user_b(client, second_user):
    """``intruder``, a different member, logged in, CSRF header preset."""
    test_client = _logged_in_client(client.app, second_user["username"], second_user["password"])
    yield test_client
    test_client.__exit__(None, None, None)
