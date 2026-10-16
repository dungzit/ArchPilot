"""Designs API input limits (review-v2-phase0, findings B1 and M2).

* Python's ``json.loads`` accepts ``NaN``, ``Infinity`` and ``1e400`` (-> inf),
  and unpaired surrogates. None of them is JSON. Before the fix NaN/Infinity
  reached the database and came back as a 500 (migration 005's ``json_valid``
  trigger refused the row).
* Size is checked before shape: jsonschema over an oversized 1.0 graph took
  13 s at 1.4 MB and 64 s at 7 MB before the 1 MiB cap said no.
* The contract and integrity gates run in a worker thread, not on the event loop.
* The whole request body is capped (413), so an unbounded upload never
  reaches the JSON parser.
"""

from __future__ import annotations

import asyncio
import json

import pytest

URL = "/api/designs"
V1_NODE = '{"id":"a","type":"service","label":"A","position":{"x":%s,"y":0}}'


def post_raw(test_client, body: str, url: str = URL):
    return test_client.post(url, content=body.encode("utf-8"), headers={"content-type": "application/json"})


def design_count(migrated_db) -> int:
    return migrated_db.execute("SELECT COUNT(*) FROM designs").fetchone()[0]


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e400", "-1e400"])
def test_non_finite_numbers_are_a_422_not_a_500(user_a, migrated_db, number):
    body = '{"name":"n","graph":{"schemaVersion":"1.0","nodes":[%s],"edges":[]}}' % (V1_NODE % number)
    response = post_raw(user_a, body)
    assert response.status_code == 422, response.text
    assert set(response.json()) == {"detail", "requestId"}
    assert "NaN or Infinity" in response.json()["detail"]
    assert design_count(migrated_db) == 0


def test_a_non_finite_number_on_update_is_a_422_and_changes_nothing(user_a):
    created = user_a.post(URL, json={"name": "n", "graph": {"schemaVersion": "1.0", "nodes": [], "edges": []}}).json()
    body = '{"name":"n","revision":1,"graph":{"schemaVersion":"1.0","nodes":[%s],"edges":[]}}' % (V1_NODE % "NaN")
    response = user_a.put(f"{URL}/{created['id']}", content=body.encode(), headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert user_a.get(f"{URL}/{created['id']}").json()["revision"] == 1


@pytest.mark.parametrize("value", [-0.0, 1.0, 12345678901234567890123])
def test_finite_json_numbers_still_round_trip(user_a, value):
    graph = {"schemaVersion": "1.0", "nodes": [json.loads(V1_NODE % json.dumps(value))], "edges": []}
    response = user_a.post(URL, json={"name": "n", "graph": graph})
    assert response.status_code == 201, response.text
    assert user_a.get(response.headers["location"]).status_code == 200


def test_an_unpaired_surrogate_is_a_readable_422(user_a, migrated_db):
    body = '{"name":"n","graph":{"schemaVersion":"1.0","nodes":[{"id":"a","type":"service","label":"\\ud800","position":{"x":0,"y":0}}],"edges":[]}}'
    response = post_raw(user_a, body)
    assert response.status_code == 422
    assert "unpaired UTF-16 surrogate" in response.json()["detail"]
    assert design_count(migrated_db) == 0


def test_size_is_checked_before_shape(user_a, monkeypatch):
    """An oversized AND shape-invalid graph is refused for its size, so the
    expensive contract pass never runs on it."""
    import app.schemas

    calls = []
    monkeypatch.setattr(app.schemas, "MAX_GRAPH_BYTES", 200)
    monkeypatch.setattr(app.schemas, "validate_archgraph", lambda document: calls.append(document))
    graph = {"schemaVersion": "1.0", "nodes": [{"id": f"n{i}", "type": "nope"} for i in range(20)], "edges": []}
    response = user_a.post(URL, json={"name": "n", "graph": graph})
    assert response.status_code == 422
    assert "the limit is 200" in response.json()["detail"]
    assert calls == [], "the contract validator must not run on an oversized graph"


def test_graph_validation_runs_off_the_event_loop(user_a, monkeypatch):
    """FastAPI validates bodies on the event loop; the contract + integrity pass
    (seconds on a 1 MiB graph) must run in the worker thread instead."""
    import app.routers.designs

    seen = []
    real = app.routers.designs.check_archgraph

    def spy(graph):
        try:
            asyncio.get_running_loop()
            seen.append("event loop")
        except RuntimeError:
            seen.append("worker thread")
        return real(graph)

    monkeypatch.setattr(app.routers.designs, "check_archgraph", spy)
    created = user_a.post(URL, json={"name": "n", "graph": {"schemaVersion": "1.0", "nodes": [], "edges": []}})
    assert created.status_code == 201
    updated = user_a.put(created.headers["location"], json={"name": "n", "revision": 1, "graph": {"schemaVersion": "1.0", "nodes": [], "edges": []}})
    assert updated.status_code == 200
    assert seen == ["worker thread", "worker thread"]


def test_the_422_text_is_unchanged_by_the_move(user_a):
    response = user_a.post(URL, json={"name": "n", "graph": {"schemaVersion": "1.0", "nodes": [], "edges": [], "x": 1}})
    assert response.status_code == 422
    assert response.json()["detail"].startswith("body.graph: Value error, graph does not match the ArchGraph contract - ")


def test_an_invalid_graph_for_someone_elses_design_is_422_exactly_like_a_missing_one(user_a, user_b):
    """Validation happens before the ownership lookup: no existence oracle."""
    created = user_a.post(URL, json={"name": "n", "graph": {"schemaVersion": "1.0", "nodes": [], "edges": []}}).json()
    bad = {"name": "n", "revision": 1, "graph": {"schemaVersion": "1.0", "nodes": [], "edges": [], "x": 1}}
    foreign = user_b.put(f"{URL}/{created['id']}", json=bad)
    missing = user_b.put(f"{URL}/dsg_does_not_exist", json=bad)
    assert foreign.status_code == missing.status_code == 422
    assert foreign.json()["detail"] == missing.json()["detail"]


def test_a_declared_oversized_body_is_413_in_the_error_envelope(user_a, migrated_db, monkeypatch):
    import app.body_limit

    limit = app.body_limit.DEFAULT_MAX_BODY_BYTES
    body = '{"name":"n","graph":{"schemaVersion":"1.0","nodes":[],"edges":[],"pad":"%s"}}' % ("x" * limit)
    response = post_raw(user_a, body)
    assert response.status_code == 413
    payload = response.json()
    assert set(payload) == {"detail", "requestId"}
    assert payload["requestId"] == response.headers["x-request-id"]
    assert "content-security-policy" in response.headers
    assert design_count(migrated_db) == 0


def test_a_streamed_oversized_body_is_refused_without_a_500(user_a, migrated_db):
    import app.body_limit

    chunk = b"x" * 65536
    chunks = (app.body_limit.DEFAULT_MAX_BODY_BYTES // len(chunk)) + 2

    def stream():
        yield b'{"name":"n","graph":{"schemaVersion":"1.0","nodes":[],"edges":[],"pad":"'
        for _ in range(chunks):
            yield chunk
        yield b'"}}'

    response = user_a.post(URL, content=stream(), headers={"content-type": "application/json"})
    assert response.status_code in (400, 413)
    assert set(response.json()) == {"detail", "requestId"}
    assert design_count(migrated_db) == 0


def test_a_body_under_the_request_cap_is_not_affected(user_a):
    response = user_a.post(URL, json={"name": "n", "graph": {"schemaVersion": "1.0", "nodes": [], "edges": []}})
    assert response.status_code == 201
