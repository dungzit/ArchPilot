"""Health endpoint behaviour, including the deep read+write probe (M12)."""

from __future__ import annotations


def test_liveness_is_shallow_and_cheap(client):
    response = client.get("/api/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_deep_health_reports_read_and_write_checks(client):
    from app.db import discover_migrations

    latest = discover_migrations()[-1].name.split("_", 1)[0]

    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    # Asserted against the migrations on disk, not a literal: a hard-coded
    # "002" turns every future migration into a false test failure.
    assert body["schemaVersion"] == latest
    names = {check["name"] for check in body["checks"]}
    assert names == {"sqlite_read", "sqlite_write"}
    assert all(check["status"] == "ok" for check in body["checks"])


def test_deep_health_returns_503_when_the_write_path_is_broken(client, migrated_db):
    # Break only the write path. A shallow "return 200" probe would still pass
    # here, the container would never be restarted, and the tool would be
    # silently unusable - the exact M12 failure mode.
    migrated_db.execute("DROP TABLE health_probe")

    response = client.get("/api/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "fail"
    checks = {check["name"]: check["status"] for check in body["checks"]}
    assert checks["sqlite_read"] == "ok"
    assert checks["sqlite_write"] == "fail"


def test_deep_health_returns_503_when_the_read_path_is_broken(client, migrated_db):
    migrated_db.execute("DROP TABLE sessions")
    migrated_db.execute("DROP TABLE users")

    response = client.get("/api/health")
    assert response.status_code == 503
    checks = {check["name"]: check["status"] for check in response.json()["checks"]}
    assert checks["sqlite_read"] == "fail"


def test_every_response_carries_a_request_id(client):
    response = client.get("/api/health/live")
    assert response.headers.get("x-request-id")


def test_supplied_request_id_is_echoed(client):
    response = client.get("/api/health/live", headers={"x-request-id": "trace-123"})
    assert response.headers["x-request-id"] == "trace-123"
