"""Double-submit CSRF protection.

The build-scope doc listed CSRF as stub #1: "must land before any cookie-
authenticated mutating route ships". /api/auth/logout was already such a route.
"""

from __future__ import annotations

import pytest


def test_login_issues_a_readable_csrf_cookie_and_body_token(client, seeded_user):
    response = client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": seeded_user["password"]},
    )
    assert response.status_code == 200
    token = response.json()["csrfToken"]
    assert token
    assert client.cookies.get("archpilot_csrf") == token
    # Readable by the SPA on purpose; the session cookie is not.
    csrf_header = next(h for h in response.headers.get_list("set-cookie") if "archpilot_csrf" in h)
    assert "HttpOnly" not in csrf_header
    session_header = next(h for h in response.headers.get_list("set-cookie") if "archpilot_session" in h)
    assert "HttpOnly" in session_header


def test_cookie_authenticated_mutation_without_a_token_is_rejected(client, login):
    login()
    response = client.post("/api/auth/logout")
    assert response.status_code == 403
    assert "csrf" in response.json()["detail"]
    # The session must survive a rejected forgery.
    assert client.get("/api/auth/me").status_code == 200


def test_cookie_authenticated_mutation_with_a_wrong_token_is_rejected(client, login):
    login()
    response = client.post("/api/auth/logout", headers={"x-csrf-token": "not-the-right-token"})
    assert response.status_code == 403
    assert client.get("/api/auth/me").status_code == 200


def test_cookie_authenticated_mutation_with_the_matching_token_succeeds(client, login):
    headers = login()
    assert client.post("/api/auth/logout", headers=headers).status_code == 200


def test_login_itself_is_exempt(client, seeded_user):
    # There is no session and no token yet; login must not require one.
    response = client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": seeded_user["password"]},
    )
    assert response.status_code == 200


def test_bearer_clients_are_not_subject_to_csrf(client, migrated_db, seeded_user):
    """A browser cannot attach an Authorization header cross-site, so a scripted
    client must not be forced to carry a CSRF token."""
    from app.repositories import users as users_repo

    raw, token_hash = users_repo.mint_session_token()
    users_repo.create_session(
        migrated_db, user_id=seeded_user["id"], token_hash=token_hash, ttl_hours=1
    )
    client.cookies.clear()
    response = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {raw}"})
    assert response.status_code == 200


def test_safe_methods_are_never_blocked(client, login):
    login()
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    "header", ["x-content-type-options", "x-frame-options", "referrer-policy"]
)
def test_security_headers_are_always_present(client, header):
    assert client.get("/api/health/live").headers.get(header)


def test_wire_format_is_camel_case(client, seeded_user):
    """The SPA's domain types are camelCase everywhere (WorkspaceRecord.projectName,
    EntityEnvelope.schemaVersion, SizingResult.formulaVersion). With no shared
    packages/core (decision D2), one wire casing has to be enforced by a test or
    it drifts per endpoint."""
    login_body = client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": seeded_user["password"]},
    ).json()
    assert set(login_body) == {"user", "expiresAt", "csrfToken"}
    assert set(login_body["user"]) == {"id", "username", "displayName", "role"}

    health = client.get("/api/health").json()
    assert "schemaVersion" in health and "schema_version" not in health
    assert "latencyMs" in health["checks"][0]
