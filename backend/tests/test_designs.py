"""``/api/designs`` CRUD (task 1.6).

Build-scope verification line: "cross-user read returns 404, not 403". Also:
the graph body is validated by the SAME contract file the fixture suites use,
optimistic concurrency on update, soft delete, pagination cap, CSRF.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

URL = "/api/designs"
FIXTURES_DIR = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"
MANIFEST = json.loads((FIXTURES_DIR / "index.json").read_text(encoding="utf-8"))
GRAPH_CASES = [c for c in MANIFEST["cases"] if c["schemaRef"] == "#/$defs/archGraph"]

CHECKOUT = json.loads((FIXTURES_DIR / "archgraph.checkout-service.valid.json").read_text(encoding="utf-8"))
EMPTY_GRAPH = {"schemaVersion": "1.0", "nodes": [], "edges": []}


def create(test_client, name: str = "Checkout", graph: dict | None = None) -> dict:
    response = test_client.post(URL, json={"name": name, "graph": graph if graph is not None else CHECKOUT})
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# Happy path
# --------------------------------------------------------------------------


def test_create_returns_201_the_full_design_and_a_location(user_a):
    response = user_a.post(URL, json={"name": "  Checkout  ", "graph": CHECKOUT})
    assert response.status_code == 201
    design = response.json()
    assert response.headers["location"] == f"/api/designs/{design['id']}"
    assert design["id"].startswith("dsg_")
    assert design["name"] == "Checkout", "names are trimmed"
    assert design["revision"] == 1
    assert design["visibility"] == "private", "NFR-SEC-001: private by default"
    assert design["seededFromPatternId"] is None
    assert design["schemaVersion"] == "1.0"
    assert design["graph"] == CHECKOUT, "the graph round-trips unchanged"


def test_first_design_creates_the_owner_workspace_it_belongs_to(user_a):
    assert user_a.get("/api/workspaces/current").status_code == 404
    design = create(user_a)
    workspace = user_a.get("/api/workspaces/current").json()
    assert design["workspaceId"] == workspace["id"]
    assert create(user_a, "second")["workspaceId"] == workspace["id"], "no second workspace"


def test_get_by_id_returns_the_graph(user_a):
    design = create(user_a)
    fetched = user_a.get(f"{URL}/{design['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == design


def test_update_with_the_current_revision_replaces_and_bumps(user_a):
    design = create(user_a, graph=EMPTY_GRAPH)
    response = user_a.put(f"{URL}/{design['id']}", json={"name": "Renamed", "graph": CHECKOUT, "revision": 1})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert (updated["revision"], updated["name"], updated["graph"]) == (2, "Renamed", CHECKOUT)
    assert updated["createdAt"] == design["createdAt"]
    assert user_a.get(f"{URL}/{design['id']}").json() == updated


def test_a_stale_update_is_409_and_does_not_overwrite(user_a):
    design = create(user_a, graph=EMPTY_GRAPH)
    path = f"{URL}/{design['id']}"
    assert user_a.put(path, json={"name": "tab 2", "graph": CHECKOUT, "revision": 1}).status_code == 200
    stale = user_a.put(path, json={"name": "tab 1", "graph": EMPTY_GRAPH, "revision": 1})
    assert stale.status_code == 409
    assert "current revision is 2" in stale.json()["detail"]
    assert user_a.get(path).json()["name"] == "tab 2"


def test_delete_is_204_then_the_design_is_gone_everywhere(user_a):
    design = create(user_a)
    path = f"{URL}/{design['id']}"
    response = user_a.delete(path)
    assert response.status_code == 204
    assert response.content == b""
    assert user_a.get(path).status_code == 404
    assert user_a.put(path, json={"name": "x", "graph": EMPTY_GRAPH, "revision": 1}).status_code == 404
    assert user_a.delete(path).status_code == 404
    assert user_a.get(URL).json()["total"] == 0


def test_delete_is_soft_so_takedown_can_still_count_derived_designs(user_a, migrated_db):
    design = create(user_a)
    user_a.delete(f"{URL}/{design['id']}")
    row = migrated_db.execute("SELECT deleted_at FROM designs WHERE id = ?", (design["id"],)).fetchone()
    assert row["deleted_at"] is not None


# --------------------------------------------------------------------------
# List + pagination
# --------------------------------------------------------------------------


def test_list_is_most_recently_updated_first_without_graphs(user_a, migrated_db):
    older = create(user_a, "older", EMPTY_GRAPH)
    newer = create(user_a, "newer", EMPTY_GRAPH)
    # Timestamps have one-second precision; pin them so the order is certain.
    for design_id, stamp in ((older["id"], "2026-01-01T00:00:00+00:00"), (newer["id"], "2026-02-01T00:00:00+00:00")):
        migrated_db.execute("UPDATE designs SET updated_at = ? WHERE id = ?", (stamp, design_id))
    page = user_a.get(URL).json()
    assert page["total"] == 2
    assert (page["limit"], page["offset"]) == (50, 0)
    assert [item["id"] for item in page["items"]] == [newer["id"], older["id"]]
    assert all("graph" not in item for item in page["items"]), "list must not ship graphs"


def test_list_pagination(user_a):
    for n in range(5):
        create(user_a, f"d{n}", EMPTY_GRAPH)
    first_page = user_a.get(URL, params={"limit": 2}).json()
    last_page = user_a.get(URL, params={"limit": 2, "offset": 4}).json()
    assert (len(first_page["items"]), first_page["total"]) == (2, 5)
    assert (len(last_page["items"]), last_page["total"]) == (1, 5)
    all_ids = [i["id"] for p in range(0, 6, 2) for i in user_a.get(URL, params={"limit": 2, "offset": p}).json()["items"]]
    assert len(all_ids) == len(set(all_ids)) == 5, "pages neither overlap nor skip"


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}, {"limit": "many"}])
def test_list_rejects_out_of_range_paging(user_a, params):
    response = user_a.get(URL, params=params)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


# --------------------------------------------------------------------------
# Owner scoping: 404, never 403
# --------------------------------------------------------------------------


def test_non_owner_read_is_404_and_indistinguishable_from_missing(user_a, user_b):
    design = create(user_a)
    foreign = user_b.get(f"{URL}/{design['id']}")
    missing = user_b.get(f"{URL}/dsg_doesnotexist0000")
    assert foreign.status_code == 404, "404, not 403: a 403 would confirm the id exists"
    assert foreign.json()["detail"] == missing.json()["detail"] == "design not found"
    assert "Checkout" not in foreign.text


def test_non_owner_cannot_update(user_a, user_b):
    design = create(user_a)
    response = user_b.put(f"{URL}/{design['id']}", json={"name": "hijacked", "graph": EMPTY_GRAPH, "revision": 1})
    assert response.status_code == 404
    assert user_a.get(f"{URL}/{design['id']}").json() == design


def test_non_owner_cannot_delete(user_a, user_b):
    design = create(user_a)
    assert user_b.delete(f"{URL}/{design['id']}").status_code == 404
    assert user_a.get(f"{URL}/{design['id']}").status_code == 200


def test_list_only_shows_the_callers_designs(user_a, user_b):
    create(user_a, "A's design")
    create(user_b, "B's design")
    a_names = [item["name"] for item in user_a.get(URL).json()["items"]]
    b_page = user_b.get(URL).json()
    assert a_names == ["A's design"]
    assert [item["name"] for item in b_page["items"]] == ["B's design"]
    assert b_page["total"] == 1


# --------------------------------------------------------------------------
# The graph body is validated by the shared contract, not a second definition
# --------------------------------------------------------------------------


@pytest.mark.parametrize("case", GRAPH_CASES, ids=lambda c: f"{c['expect']}-{c['fixture']}")
def test_every_archgraph_fixture_in_the_shared_manifest_gets_the_same_verdict_from_the_api(user_a, case):
    """The same fixtures pytest (jsonschema) and vitest (ajv) run are POSTed to
    the live endpoint. If the API ever grew its own graph definition and it
    drifted from contracts/archgraph.schema.json, one of these would flip."""
    graph = json.loads((FIXTURES_DIR / case["fixture"]).read_text(encoding="utf-8"))
    response = user_a.post(URL, json={"name": case["fixture"], "graph": graph})
    if case["expect"] == "valid":
        assert response.status_code == 201, response.text
    else:
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert isinstance(detail, str)
        assert "ArchGraph contract" in detail


INTEGRITY_CASES = MANIFEST["integrityCases"]
HYBRID = json.loads((FIXTURES_DIR / "archgraph.v2-hybrid-orders.valid.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", INTEGRITY_CASES, ids=lambda c: c["fixture"])
def test_every_integrity_fixture_is_rejected_by_the_api_with_its_rule_code(user_a, case):
    """Task 0.4: corrupt documents are refused, in the contract error shape,
    and the detail names the shared rule code, so a user (or the SPA) can match
    it to the same rule validateGraph() reports in the browser."""
    graph = json.loads((FIXTURES_DIR / case["fixture"]).read_text(encoding="utf-8"))
    response = user_a.post(URL, json={"name": case["fixture"], "graph": graph})
    assert response.status_code == 422, response.text
    body = response.json()
    assert set(body) == {"detail", "requestId"}
    assert "graph failed integrity checks" in body["detail"]
    assert case["expectRule"] in body["detail"]
    assert user_a.get(URL).json()["total"] == 0, "nothing was stored"


def test_a_v2_document_round_trips_unchanged_and_lists_as_schema_2(user_a):
    design = create(user_a, "Hybrid orders", HYBRID)
    assert design["schemaVersion"] == "2.0"
    assert design["graph"] == HYBRID
    assert user_a.get(f"{URL}/{design['id']}").json()["graph"] == HYBRID
    assert user_a.get(URL).json()["items"][0]["schemaVersion"] == "2.0"


def test_a_v1_design_can_be_upgraded_to_v2_by_put_and_downgraded_back(user_a):
    """The SPA migrates on load and saves 2.0; an older tab may still save 1.0.
    The API accepts both on every write (the revision check still applies)."""
    design = create(user_a, graph=CHECKOUT)
    path = f"{URL}/{design['id']}"
    upgraded = user_a.put(path, json={"name": "x", "graph": HYBRID, "revision": 1})
    assert upgraded.status_code == 200, upgraded.text
    assert (upgraded.json()["schemaVersion"], upgraded.json()["revision"]) == ("2.0", 2)
    back = user_a.put(path, json={"name": "x", "graph": CHECKOUT, "revision": 2})
    assert back.status_code == 200, back.text
    assert back.json()["schemaVersion"] == "1.0"


def test_an_unknown_role_is_rejected_and_the_detail_names_the_canonical_id(user_a):
    graph = copy.deepcopy(HYBRID)
    graph["nodes"][12]["type"] = "database"  # the design-v0.2 / 1.0 id of relational_db
    detail = user_a.post(URL, json={"name": "x", "graph": graph}).json()["detail"]
    assert "INT-UNKNOWN-ROLE nodes[12].type" in detail
    assert "'relational_db'" in detail


def test_an_integrity_error_on_update_leaves_the_stored_design_untouched(user_a):
    design = create(user_a, graph=HYBRID)
    broken = copy.deepcopy(HYBRID)
    broken["edges"][0]["target"] = "n_deleted"
    response = user_a.put(f"{URL}/{design['id']}", json={"name": "x", "graph": broken, "revision": 1})
    assert response.status_code == 422
    stored = user_a.get(f"{URL}/{design['id']}").json()
    assert (stored["revision"], stored["graph"]) == (1, HYBRID)


def test_many_integrity_issues_are_summarised_not_echoed(user_a):
    graph = copy.deepcopy(HYBRID)
    for edge in graph["edges"]:
        edge["target"] = "n_gone"
    detail = user_a.post(URL, json={"name": "x", "graph": graph}).json()["detail"]
    assert detail.count("INT-DANGLING-EDGE") == 3
    assert "(+5 more)" in detail


def test_the_storage_layer_refuses_a_schema_version_that_disagrees_with_the_document(user_a, migrated_db):
    """Migration 005: a script that bypasses the API still cannot store a
    document whose schema_version column lies about graph_json."""
    import sqlite3

    design = create(user_a, graph=CHECKOUT)
    with pytest.raises(sqlite3.IntegrityError, match=r"schema_version must be 1\.0 or 2\.0"):
        migrated_db.execute("UPDATE designs SET schema_version = '2.0' WHERE id = ?", (design["id"],))
    with pytest.raises(sqlite3.IntegrityError, match=r"schema_version must be 1\.0 or 2\.0"):
        migrated_db.execute(
            "UPDATE designs SET graph_json = ?, schema_version = '3.0' WHERE id = ?",
            ('{"schemaVersion":"3.0","nodes":[],"edges":[]}', design["id"]),
        )
    migrated_db.execute(
        "UPDATE designs SET graph_json = ?, schema_version = '2.0' WHERE id = ?",
        (json.dumps(HYBRID), design["id"]),
    )
    assert user_a.get(f"{URL}/{design['id']}").json()["schemaVersion"] == "2.0"


def test_a_missing_catalogue_fails_at_startup_not_on_first_save(temp_settings, monkeypatch, tmp_path):
    from app import catalog
    from app.main import create_app

    monkeypatch.setenv("ARCHPILOT_CATALOG_DIR", str(tmp_path))
    catalog.load_catalog.cache_clear()
    try:
        with pytest.raises(FileNotFoundError, match="component catalogue"):
            create_app()
    finally:
        monkeypatch.delenv("ARCHPILOT_CATALOG_DIR")
        catalog.load_catalog.cache_clear()


def test_contract_errors_name_the_offending_path(user_a):
    graph = copy.deepcopy(CHECKOUT)
    graph["nodes"][1]["type"] = "mainframe"
    detail = user_a.post(URL, json={"name": "x", "graph": graph}).json()["detail"]
    assert "nodes[1].type" in detail
    assert "mainframe" in detail


def test_the_api_validates_with_the_contract_file_the_test_suites_use():
    from app.contract import load_contract

    on_disk = json.loads((FIXTURES_DIR.parent / "archgraph.schema.json").read_text(encoding="utf-8"))
    assert load_contract() == on_disk


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "no graph"},
        {"name": "graph is a list", "graph": []},
        {"name": "graph is a string", "graph": "{}"},
        {"name": "   ", "graph": EMPTY_GRAPH},
        {"name": "x" * 121, "graph": EMPTY_GRAPH},
        {"name": "extra key", "graph": EMPTY_GRAPH, "ownerId": "usr_someone_else"},
        {"name": "client revision on create", "graph": EMPTY_GRAPH, "revision": 7},
    ],
    ids=["missing-graph", "list-graph", "string-graph", "blank-name", "long-name", "owner-id", "revision-on-create"],
)
def test_malformed_create_bodies_are_422(user_a, payload):
    response = user_a.post(URL, json=payload)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)
    assert user_a.get(URL).json()["total"] == 0


def test_update_requires_a_revision(user_a):
    design = create(user_a)
    response = user_a.put(f"{URL}/{design['id']}", json={"name": "x", "graph": EMPTY_GRAPH})
    assert response.status_code == 422
    assert "revision" in response.json()["detail"]


def test_oversized_graphs_are_rejected(user_a, monkeypatch):
    import app.schemas

    monkeypatch.setattr(app.schemas, "MAX_GRAPH_BYTES", 200)
    response = user_a.post(URL, json={"name": "big", "graph": CHECKOUT})
    assert response.status_code == 422
    assert "limit is 200" in response.json()["detail"]


def test_a_missing_contract_file_fails_at_startup_not_on_first_save(temp_settings, monkeypatch, tmp_path):
    from app import contract
    from app.main import create_app

    monkeypatch.setenv("ARCHPILOT_CONTRACT_PATH", str(tmp_path / "nope.json"))
    contract.load_contract.cache_clear()
    contract.validator_for.cache_clear()
    try:
        with pytest.raises(FileNotFoundError, match="wire contract"):
            create_app()
    finally:
        monkeypatch.delenv("ARCHPILOT_CONTRACT_PATH")
        contract.load_contract.cache_clear()
        contract.validator_for.cache_clear()


# --------------------------------------------------------------------------
# Auth + CSRF
# --------------------------------------------------------------------------


def test_unauthenticated_calls_are_401(client):
    assert client.get(URL).status_code == 401
    assert client.get(f"{URL}/dsg_x").status_code == 401
    assert client.post(URL, json={"name": "x", "graph": EMPTY_GRAPH}).status_code == 401


def test_cookie_authenticated_mutations_need_the_csrf_header(user_a):
    design = create(user_a)
    no_token = {"x-csrf-token": ""}
    assert user_a.post(URL, json={"name": "x", "graph": EMPTY_GRAPH}, headers=no_token).status_code == 403
    path = f"{URL}/{design['id']}"
    assert user_a.put(path, json={"name": "x", "graph": EMPTY_GRAPH, "revision": 1}, headers=no_token).status_code == 403
    assert user_a.delete(path, headers=no_token).status_code == 403
    assert user_a.get(path).json() == design
