"""Local auth: login, session cookie, /me, logout, throttling."""

from __future__ import annotations

import pytest

from app.routers.auth import MAX_ATTEMPTS, reset_throttle_state


def test_login_success_sets_httponly_session_cookie(client, seeded_user):
    response = client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": seeded_user["password"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["username"] == "architect"
    assert body["user"]["role"] == "admin"
    assert body["expiresAt"]

    set_cookie = response.headers["set-cookie"]
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie.replace("samesite", "SameSite")


def test_username_is_case_insensitive(client, seeded_user):
    response = client.post(
        "/api/auth/login",
        json={"username": "ARCHITECT", "password": seeded_user["password"]},
    )
    assert response.status_code == 200


def test_login_rejects_a_bad_password(client, seeded_user):
    response = client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": "wrong-password-here"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid username or password"


def test_unknown_user_returns_the_same_error_as_a_bad_password(client):
    response = client.post(
        "/api/auth/login", json={"username": "nobody", "password": "whatever-value"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid username or password"


def test_me_requires_authentication(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_the_logged_in_user(client, seeded_user):
    client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": seeded_user["password"]},
    )
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["id"] == seeded_user["id"]


def test_logout_revokes_the_session(client, login):
    headers = login()
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_bearer_token_is_accepted_for_scripted_clients(client, seeded_user, migrated_db):
    from app.repositories import users as users_repo

    raw, token_hash = users_repo.mint_session_token()
    users_repo.create_session(
        migrated_db, user_id=seeded_user["id"], token_hash=token_hash, ttl_hours=1
    )
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {raw}"})
    assert response.status_code == 200
    assert response.json()["username"] == "architect"


def test_expired_session_is_rejected(client, seeded_user, migrated_db):
    from app.repositories import users as users_repo

    raw, token_hash = users_repo.mint_session_token()
    users_repo.create_session(
        migrated_db, user_id=seeded_user["id"], token_hash=token_hash, ttl_hours=-1
    )
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {raw}"})
    assert response.status_code == 401


def test_repeated_failures_are_throttled(client, seeded_user):
    reset_throttle_state()
    for _ in range(MAX_ATTEMPTS):
        client.post(
            "/api/auth/login",
            json={"username": seeded_user["username"], "password": "nope-nope-nope"},
        )
    blocked = client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": seeded_user["password"]},
    )
    assert blocked.status_code == 429
    reset_throttle_state()


def test_throttle_map_does_not_grow_with_every_username_tried(client):
    """The map is keyed on attacker-controlled input. Before the fix every
    distinct username left a permanent empty-list entry behind."""
    from app.routers.auth import _attempts

    reset_throttle_state()
    for i in range(50):
        client.post("/api/auth/login", json={"username": f"ghost{i}", "password": "nope-nope-nope"})
    # Failures inside the window are still tracked...
    assert len(_attempts) == 50
    # ...but a key whose attempts have aged out is dropped, not kept as [].
    from app.routers import auth as auth_module

    original_window = auth_module.ATTEMPT_WINDOW_SECONDS
    auth_module.ATTEMPT_WINDOW_SECONDS = -1  # every recorded attempt is now stale
    try:
        for i in range(50):
            assert auth_module._is_throttled(f"testclient|ghost{i}") is False
        assert len(_attempts) == 0
    finally:
        auth_module.ATTEMPT_WINDOW_SECONDS = original_window
        reset_throttle_state()


def test_login_payload_rejects_unknown_fields(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "a", "password": "b", "role": "admin"},
    )
    assert response.status_code == 422


def test_login_converges_stored_iterations_on_the_configured_cost(migrated_db):
    """The per-user password_iterations upgrade seam must actually converge.

    A stale, lower count on a real account is also a user-enumeration oracle:
    the unknown-user path would burn the higher configured count and answer
    measurably later. Measured before this fix at 600k stored / 1.2M configured:
    737 ms for a non-existent username vs 378 ms for a real one.
    """
    from app.repositories import users as users_repo

    low = 100_000
    target = low + 50_000
    users_repo.create_user(
        migrated_db, username="legacy", password="correct-horse-battery", iterations=low
    )

    row = users_repo.get_user_by_username(migrated_db, "legacy")
    assert row["password_iterations"] == low
    upgraded = users_repo.upgrade_password_iterations(
        migrated_db, row, "correct-horse-battery", target_iterations=target
    )
    assert upgraded is True
    row = users_repo.get_user_by_username(migrated_db, "legacy")
    assert row["password_iterations"] == target
    assert users_repo.verify_user_password(row, "correct-horse-battery") is True


def test_unknown_user_path_costs_what_a_real_account_costs(migrated_db, seeded_user):
    """The dummy hash must be charged at the highest count actually stored,
    not at the configured count, or raising the cost factor creates an oracle."""
    from app.repositories import users as users_repo

    migrated_db.execute("UPDATE users SET password_iterations = 250000")
    assert users_repo.dummy_iterations(migrated_db, fallback=999_999) == 250_000
    # Empty/unknown table falls back to the configured value.
    migrated_db.execute("UPDATE users SET is_active = 0")
    assert users_repo.dummy_iterations(migrated_db, fallback=777_777) == 777_777


def test_expired_sessions_are_purged(migrated_db, seeded_user):
    from app.repositories import users as users_repo

    for ttl in (-5, -1, 12):
        _raw, token_hash = users_repo.mint_session_token()
        users_repo.create_session(
            migrated_db, user_id=seeded_user["id"], token_hash=token_hash, ttl_hours=ttl
        )
    assert migrated_db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 3
    assert users_repo.purge_expired_sessions(migrated_db) == 2
    assert migrated_db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1


def test_login_purges_expired_sessions(client, login, migrated_db, seeded_user):
    from app.repositories import users as users_repo

    _raw, token_hash = users_repo.mint_session_token()
    users_repo.create_session(
        migrated_db, user_id=seeded_user["id"], token_hash=token_hash, ttl_hours=-1
    )
    login()
    stale = migrated_db.execute(
        "SELECT COUNT(*) FROM sessions WHERE token_hash = ?", (token_hash,)
    ).fetchone()[0]
    assert stale == 0, "a login must sweep expired sessions (purge_expired_sessions was dead code)"


def test_weak_passwords_are_refused_at_creation(migrated_db, temp_settings):
    from app.repositories import users as users_repo
    from app.security import WeakPasswordError

    with pytest.raises(WeakPasswordError):
        users_repo.create_user(
            migrated_db,
            username="weakling",
            password="short",
            iterations=temp_settings.pbkdf2_iterations,
        )
