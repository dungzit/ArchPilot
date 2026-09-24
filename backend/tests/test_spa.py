"""SPA fallback, cache headers and CSP (task 0.5; red-team review M9).

The built SPA is faked with a temp directory holding an ``index.html`` and one
hashed asset, pointed at by ``ARCHPILOT_STATIC_DIR``. What must hold:

* a deep link a browser navigates to (``Accept: text/html``) gets the SPA;
* an unknown ``/api`` path is ALWAYS a JSON 404 in the error envelope - never
  HTML, whatever the Accept header - and real API routes are never shadowed;
* a missing ``/assets/*`` file is a 404, not HTML (the stale-tab blank page);
* a non-browser ``fetch`` of an unknown path (no text/html) is a JSON 404;
* ``index.html`` is ``no-store``; hashed assets are ``immutable``;
* every response carries the CSP, except the dev-only Swagger UI.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

INDEX = "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/assets/index-abc123.js\"></script></body></html>"
HTML = {"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}


@pytest.fixture()
def spa_client(temp_settings, seeded_user, monkeypatch, tmp_path):
    from app.config import reset_settings_cache
    from app.main import create_app
    from app.routers.auth import reset_throttle_state

    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text(INDEX, encoding="utf-8")
    (static / "assets" / "index-abc123.js").write_text("console.log('spa')", encoding="utf-8")
    monkeypatch.setenv("ARCHPILOT_STATIC_DIR", str(static))
    reset_settings_cache()
    reset_throttle_state()
    with TestClient(create_app()) as test_client:
        yield test_client
    reset_settings_cache()


@pytest.mark.parametrize("path", ["/hub/anything", "/designs/dsg_123", "/designs/dsg_1/brief/2", "/m/sizing", "/nope"])
def test_a_deep_link_from_a_browser_gets_the_spa_shell(spa_client, path):
    response = spa_client.get(path, headers=HTML)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert '<div id="root"></div>' in response.text
    assert response.headers["cache-control"] == "no-store"


def test_head_on_a_deep_link_also_falls_back(spa_client):
    response = spa_client.head("/hub/x", headers=HTML)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")


def test_the_root_and_index_are_no_store(spa_client):
    for path in ("/", "/index.html"):
        response = spa_client.get(path, headers=HTML)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path", ["/api/nothing", "/api/designs/dsg_1/unknown", "/api", "/api/docs/whatever"])
@pytest.mark.parametrize("accept", ["text/html", "application/json", "*/*"])
def test_an_unknown_api_path_is_a_json_404_never_html(spa_client, path, accept):
    response = spa_client.get(path, headers={"accept": accept})
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert set(body) == {"detail", "requestId"}
    assert body["requestId"] == response.headers["x-request-id"]


def test_real_api_routes_are_not_shadowed_by_the_spa(spa_client):
    health = spa_client.get("/api/health", headers=HTML)
    assert health.status_code == 200
    assert health.headers["content-type"].startswith("application/json")
    me = spa_client.get("/api/auth/me", headers=HTML)
    assert me.status_code == 401
    assert me.json()["detail"] == "authentication required"


def test_a_missing_asset_is_a_404_not_the_shell(spa_client):
    response = spa_client.get("/assets/index-OLD.js", headers=HTML)
    assert response.status_code == 404
    assert "<html" not in response.text


def test_an_existing_hashed_asset_is_immutable(spa_client):
    response = spa_client.get("/assets/index-abc123.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_a_fetch_without_text_html_gets_a_json_404(spa_client):
    response = spa_client.get("/hub/anything", headers={"accept": "*/*"})
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_a_post_to_a_spa_path_is_not_served_the_shell(spa_client):
    response = spa_client.post("/hub/anything", headers=HTML)
    assert response.status_code == 405
    assert response.headers["content-type"].startswith("application/json")


def test_every_response_carries_the_content_security_policy(spa_client):
    for response in (
        spa_client.get("/hub/x", headers=HTML),
        spa_client.get("/api/health"),
        spa_client.get("/api/nothing"),
        spa_client.get("/assets/index-abc123.js"),
    ):
        policy = response.headers["content-security-policy"]
        assert "default-src 'self'" in policy
        assert "script-src 'self'" in policy
        assert "frame-ancestors 'none'" in policy
        assert "'unsafe-eval'" not in policy


def test_the_dev_only_swagger_ui_is_exempt_from_the_csp(spa_client):
    response = spa_client.get("/api/docs")
    assert response.status_code == 200  # ARCHPILOT_ENV=test, so docs exist
    assert "content-security-policy" not in response.headers
    assert response.headers["x-frame-options"] == "DENY", "the other headers still apply"


def test_without_a_built_spa_the_api_still_answers_json_404s(client):
    response = client.get("/hub/anything", headers=HTML)
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
