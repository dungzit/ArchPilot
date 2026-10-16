"""WP-B HTTP surface: /api/reference/{search,status,pins}.

Auth on every route, camelCase wire (src/contracts/pilot.ts), pins scoped to
the caller's own designs (someone else's design or pin -> 404), CSRF on
mutations, and the start-up auto-load of the snapshot.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from test_reference_helpers import load_fixture_index, write_fixture_snapshot

EMPTY_GRAPH = {"schemaVersion": "1.0", "nodes": [], "edges": []}


@pytest.fixture()
def indexed(migrated_db, tmp_path):
    load_fixture_index(migrated_db, tmp_path)


def make_design(test_client, name: str = "Checkout") -> str:
    response = test_client.post("/api/designs", json={"name": name, "graph": EMPTY_GRAPH})
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("get", "/api/reference/search?q=cache"),
        ("get", "/api/reference/status"),
        ("get", "/api/reference/pins?designId=dsg_x"),
        ("post", "/api/reference/pins"),
        ("delete", "/api/reference/pins/rpin_x"),
    ],
)
def test_every_route_requires_a_session(client, method, url):
    kwargs = {"json": {"designId": "dsg_x", "shareId": "ExMwREO"}} if method == "post" else {}
    response = getattr(client, method)(url, **kwargs)
    # POST/DELETE without a session are stopped by auth or by CSRF; never served.
    assert response.status_code in (401, 403)
    if method == "get":
        assert response.status_code == 401


def test_search_wire_format_is_the_contract(user_a, indexed):
    response = user_a.get("/api/reference/search", params={"q": "bộ nhớ đệm cho chuyển hướng link rút gọn"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"query", "expandedQuery", "total", "items"}
    assert body["expandedQuery"] == 'cache redirect "url shortener"'
    hit = body["items"][0]
    assert set(hit) == {
        "shareId", "url", "title", "prompt", "categories", "tab", "designSource", "sourceBlogName",
        "sourceArticleUrl", "upvoteCount", "updatedAt", "score", "steps",
    }
    assert hit["shareId"] == "ExMwREO" and hit["tab"] == "featured" and hit["upvoteCount"] == 1148
    assert hit["steps"][0] == {
        "position": 8,
        "title": "Add Cache Layer for Redirects",
        "phase": "build",
        "snippet": hit["steps"][0]["snippet"],
    }


def test_search_parameters(user_a, indexed):
    assert user_a.get("/api/reference/search", params={"q": "URL shortener", "limit": 1}).json()["items"][0]["shareId"] == "ExMwREO"
    assert len(user_a.get("/api/reference/search", params={"q": "cache", "limit": 500}).json()["items"]) <= 50
    flows = user_a.get("/api/reference/search", params={"q": "redirect", "phase": "flows"}).json()
    assert all(step["phase"] == "flows" for item in flows["items"] for step in item["steps"])
    cat = user_a.get("/api/reference/search", params={"q": "cache", "category": "Storage & CDN"}).json()
    assert [item["shareId"] for item in cat["items"]] == ["DistCache01"]
    assert user_a.get("/api/reference/search").json() == {"query": "", "expandedQuery": "", "total": 0, "items": []}
    assert user_a.get("/api/reference/search", params={"q": "x" * 301}).status_code == 422


@pytest.mark.parametrize("q", ['"); DROP TABLE x; --', "NEAR(a b)", "*"])
def test_search_injection_over_http(user_a, indexed, q):
    response = user_a.get("/api/reference/search", params={"q": q})
    assert response.status_code == 200
    assert user_a.get("/api/reference/status").json()["indexedDesigns"] == 7


def test_status(user_a, indexed):
    body = user_a.get("/api/reference/status").json()
    assert body == {"indexedDesigns": 7, "indexedSteps": 32, "lastCrawlAt": "2026-10-14T08:00:00+00:00"}


def test_status_on_an_empty_index(user_a):
    assert user_a.get("/api/reference/status").json() == {"indexedDesigns": 0, "indexedSteps": 0, "lastCrawlAt": None}


# --------------------------------------------------------------------------
# Pins
# --------------------------------------------------------------------------


def test_pin_lifecycle(user_a, indexed):
    design_id = make_design(user_a)
    created = user_a.post(
        "/api/reference/pins",
        json={"designId": design_id, "shareId": "ExMwREO", "stepPosition": 8, "note": "  cache-aside idea  "},
    )
    assert created.status_code == 201, created.text
    pin = created.json()
    assert pin["designId"] == design_id and pin["shareId"] == "ExMwREO"
    assert pin["url"] == "https://www.sysdesai.com/share/ExMwREO"
    assert pin["title"] == "URL Shortener"
    assert pin["stepPosition"] == 8 and pin["stepTitle"] == "Add Cache Layer for Redirects"
    assert pin["note"] == "cache-aside idea" and pin["id"].startswith("rpin_") and pin["createdAt"]

    again = user_a.post("/api/reference/pins", json={"designId": design_id, "shareId": "ExMwREO", "stepPosition": 8})
    assert again.status_code == 200 and again.json()["id"] == pin["id"]  # idempotent

    whole = user_a.post("/api/reference/pins", json={"designId": design_id, "shareId": "ExMwREO"})
    assert whole.status_code == 201 and whole.json()["stepPosition"] is None

    listing = user_a.get("/api/reference/pins", params={"designId": design_id}).json()
    assert listing["total"] == 2 and listing["items"][0]["id"] == pin["id"]

    assert user_a.delete(f"/api/reference/pins/{pin['id']}").status_code == 204
    assert user_a.delete(f"/api/reference/pins/{pin['id']}").status_code == 404
    assert user_a.get("/api/reference/pins", params={"designId": design_id}).json()["total"] == 1


def test_pin_survives_a_reindex_without_that_design(user_a, indexed, migrated_db, tmp_path):
    from app.reference.crawler import write_snapshot
    from app.reference.index import load_snapshot

    design_id = make_design(user_a)
    user_a.post("/api/reference/pins", json={"designId": design_id, "shareId": "ExMwREO", "stepPosition": 8})
    snapshot = tmp_path / "empty.jsonl.gz"
    write_snapshot(snapshot, [])
    assert load_snapshot(migrated_db, snapshot).loaded
    items = user_a.get("/api/reference/pins", params={"designId": design_id}).json()["items"]
    assert items[0]["title"] == "URL Shortener" and items[0]["stepTitle"] == "Add Cache Layer for Redirects"


def test_pin_validation(user_a, indexed):
    design_id = make_design(user_a)
    post = lambda body: user_a.post("/api/reference/pins", json=body)  # noqa: E731
    assert post({"designId": design_id, "shareId": "NoSuchId"}).status_code == 404
    assert post({"designId": design_id, "shareId": "ExMwREO", "stepPosition": 99}).status_code == 404
    assert post({"designId": design_id, "shareId": "GoneTwice07"}).status_code == 404  # hidden
    assert post({"designId": design_id, "shareId": "../design/x"}).status_code == 422
    assert post({"designId": design_id, "shareId": "ExMwREO", "stepPosition": 0}).status_code == 422
    assert post({"designId": design_id, "shareId": "ExMwREO", "note": "x" * 1001}).status_code == 422
    assert post({"designId": design_id, "shareId": "ExMwREO", "extra": 1}).status_code == 422
    assert post({"designId": "dsg_missing", "shareId": "ExMwREO"}).status_code == 404


def test_someone_elses_design_is_404_not_403(user_a, user_b, indexed):
    design_a = make_design(user_a, "A's design")
    pin = user_a.post("/api/reference/pins", json={"designId": design_a, "shareId": "ExMwREO"}).json()

    assert user_b.get("/api/reference/pins", params={"designId": design_a}).status_code == 404
    response = user_b.post("/api/reference/pins", json={"designId": design_a, "shareId": "ExMwREO", "stepPosition": 8})
    assert response.status_code == 404 and response.json()["detail"] == "design not found"
    assert user_b.delete(f"/api/reference/pins/{pin['id']}").status_code == 404
    # A's pin is untouched.
    assert user_a.get("/api/reference/pins", params={"designId": design_a}).json()["total"] == 1


def test_deleted_design_pins_are_not_reachable(user_a, indexed):
    design_id = make_design(user_a)
    user_a.post("/api/reference/pins", json={"designId": design_id, "shareId": "ExMwREO"})
    assert user_a.delete(f"/api/designs/{design_id}").status_code == 204
    assert user_a.get("/api/reference/pins", params={"designId": design_id}).status_code == 404


def test_pin_mutations_need_the_csrf_header(client, login, indexed):
    headers = login()
    design = client.post("/api/designs", json={"name": "D", "graph": EMPTY_GRAPH}, headers=headers)
    design_id = design.json()["id"]
    response = client.post("/api/reference/pins", json={"designId": design_id, "shareId": "ExMwREO"})
    assert response.status_code == 403
    ok = client.post("/api/reference/pins", json={"designId": design_id, "shareId": "ExMwREO"}, headers=headers)
    assert ok.status_code == 201
    assert client.delete(f"/api/reference/pins/{ok.json()['id']}").status_code == 403


# --------------------------------------------------------------------------
# Start-up auto-load
# --------------------------------------------------------------------------


def test_lifespan_loads_the_snapshot_from_the_env_path(temp_settings, seeded_user, monkeypatch, tmp_path):
    from app.config import get_settings, reset_settings_cache
    from app.main import create_app

    snapshot = write_fixture_snapshot(tmp_path / "custom" / "snap.jsonl.gz")
    monkeypatch.setenv("ARCHPILOT_REFERENCE_SNAPSHOT", str(snapshot))
    reset_settings_cache()
    assert get_settings().reference_snapshot_path == snapshot.resolve()
    with TestClient(create_app()) as test_client:
        login = test_client.post("/api/auth/login", json={"username": seeded_user["username"], "password": seeded_user["password"]})
        assert login.status_code == 200
        assert test_client.get("/api/reference/status").json()["indexedDesigns"] == 7


def test_lifespan_starts_fine_without_a_snapshot(client, login):
    login()
    assert client.get("/api/reference/status").status_code == 200
