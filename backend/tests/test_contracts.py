"""Contract tests - the Python half of the shared contract (build-scope D4 / task 0.6).

Decision D2 replaced the architects' shared ``packages/core`` with a Python
backend, so no compiler reconciles the two languages any more. This suite and
``ArchPilot/src/contracts/contract.test.ts`` read the *same* schema file and the
*same* fixture manifest. A fixture that has to be copied means the contract is
already broken, so nothing here is duplicated - the only Python-specific part is
the validator library.

What is asserted, in order of what actually bites:

1. every fixture in ``contracts/fixtures/index.json`` validates (or fails) as
   the manifest says, **and the invalid ones fail on the intended keyword**;
2. the manifest is complete - no fixture file on disk is silently unexercised;
3. envelope rules (a) casing, (b) error shape and (c) timestamp format hold on
   the **live API responses**, not only on hand-written fixtures. Review finding
   M-5 was envelope drift, not graph drift, so the fixtures alone would not have
   caught it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
FIXTURES_DIR = CONTRACTS_DIR / "fixtures"
MANIFEST_PATH = FIXTURES_DIR / "index.json"

CONTRACT = json.loads((CONTRACTS_DIR / "archgraph.schema.json").read_text(encoding="utf-8"))
MANIFEST = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
CONTRACT_ID = CONTRACT["$id"]

_REGISTRY = Resource.from_contents(CONTRACT) @ Registry()


def validator_for(schema_ref: str) -> Draft202012Validator:
    """A validator for one ``$defs`` pointer inside the shared contract."""
    return Draft202012Validator({"$ref": CONTRACT_ID + schema_ref}, registry=_REGISTRY)


def load_fixture(name: str):
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def error_signature(errors) -> str:
    """Flatten errors to `keyword|schema/path` so the same assertion string works
    against jsonschema here and against ajv in the TypeScript suite."""
    return " ".join(
        f"{error.validator}|{'/'.join(str(part) for part in error.absolute_schema_path)}"
        for error in errors
    )


def case_id(case: dict) -> str:
    return f"{case['expect']}-{case['rule']}-{case['fixture']}"


CASES = MANIFEST["cases"]
VALID_CASES = [c for c in CASES if c["expect"] == "valid"]
INVALID_CASES = [c for c in CASES if c["expect"] == "invalid"]


def test_the_contract_document_is_itself_a_valid_json_schema():
    Draft202012Validator.check_schema(CONTRACT)


@pytest.mark.parametrize("case", VALID_CASES, ids=case_id)
def test_valid_fixtures_are_accepted(case):
    errors = list(validator_for(case["schemaRef"]).iter_errors(load_fixture(case["fixture"])))
    assert not errors, f"{case['fixture']} should validate: {error_signature(errors)}"


@pytest.mark.parametrize("case", INVALID_CASES, ids=case_id)
def test_broken_fixtures_are_rejected_for_the_intended_reason(case):
    """The half of a contract test that people skip. A fixture that fails for an
    accidental reason proves the validator runs, not that the rule is enforced."""
    errors = list(validator_for(case["schemaRef"]).iter_errors(load_fixture(case["fixture"])))
    assert errors, f"{case['fixture']} must NOT validate - the contract is not being enforced"
    signature = error_signature(errors)
    assert case["expectKeyword"] in signature, (
        f"{case['fixture']} failed, but not on '{case['expectKeyword']}': {signature}"
    )


INTEGRITY_CASES = MANIFEST["integrityCases"]
MIGRATIONS = MANIFEST["migrations"]


def test_manifest_covers_every_fixture_on_disk():
    on_disk = {p.name for p in FIXTURES_DIR.glob("*.json")} - {MANIFEST_PATH.name}
    listed = {c["fixture"] for c in CASES} | {c["fixture"] for c in INTEGRITY_CASES}
    listed |= {m[key] for m in MIGRATIONS for key in ("input", "expected")}
    assert on_disk == listed, (
        f"unexercised fixtures: {sorted(on_disk - listed)}; "
        f"missing files: {sorted(listed - on_disk)}"
    )


# --------------------------------------------------------------------------
# Contract 1.1.0 (task 0.2): the L1 integrity layer and the migration pair,
# driven by the same manifest the TypeScript suite reads.
# --------------------------------------------------------------------------


def test_python_integrity_rules_are_exactly_the_manifest_rules():
    from app.graph_integrity import RULE_CODES

    assert list(RULE_CODES) == [rule["code"] for rule in MANIFEST["integrityRules"]]


@pytest.mark.parametrize("case", INTEGRITY_CASES, ids=lambda c: c["fixture"])
def test_integrity_fixtures_pass_the_contract_and_fail_integrity_on_the_named_rule(case):
    """Each broken-integrity fixture must be shape-VALID - otherwise it would
    prove the contract, not the integrity layer - and must then be rejected
    with exactly the rule the manifest names."""
    from app.graph_integrity import check_integrity

    document = load_fixture(case["fixture"])
    errors = list(validator_for(case["schemaRef"]).iter_errors(document))
    assert not errors, f"{case['fixture']} must be contract-valid: {error_signature(errors)}"
    codes = [issue.code for issue in check_integrity(document)]
    assert case["expectRule"] in codes, f"{case['fixture']}: expected {case['expectRule']}, got {codes}"


@pytest.mark.parametrize(
    "case", [c for c in VALID_CASES if c["schemaRef"] == "#/$defs/archGraph"], ids=case_id
)
def test_every_valid_graph_fixture_is_integrity_clean(case):
    from app.graph_integrity import check_integrity

    assert check_integrity(load_fixture(case["fixture"])) == []


@pytest.mark.parametrize("pair", MIGRATIONS, ids=lambda m: f"{m['from']}->{m['to']}")
def test_migration_pair_is_consistent_with_the_catalogue(pair):
    """TypeScript owns migrate() (the server never rewrites a document), so the
    Python half checks what it can independently: both sides pass both layers,
    no node or edge is lost, and every type moved exactly as the catalogue's
    legacyTypes table says."""
    from app.catalog import load_catalog
    from app.graph_integrity import check_integrity

    source, expected = load_fixture(pair["input"]), load_fixture(pair["expected"])
    assert (source["schemaVersion"], expected["schemaVersion"]) == (pair["from"], pair["to"])
    for document in (source, expected):
        validator_for("#/$defs/archGraph").validate(document)
        assert check_integrity(document) == []
    assert [n["id"] for n in source["nodes"]] == [n["id"] for n in expected["nodes"]]
    assert [e["id"] for e in source["edges"]] == [e["id"] for e in expected["edges"]]
    legacy = load_catalog().legacy_types[pair["from"]]
    for before, after in zip(source["nodes"], expected["nodes"], strict=True):
        ref = legacy[before["type"]]
        assert (after["type"], after.get("variant")) == (ref.role, ref.variant), before["id"]
        assert after["label"] == before["label"]
        assert after["position"] == before["position"]
    assert "deployment" not in expected, "REQ-TGT-003: a migrated design has no target until the user picks one"


def test_every_envelope_rule_has_at_least_one_broken_fixture():
    """Guards the guard: deleting the invalid fixtures must break the build."""
    covered = {c["rule"] for c in INVALID_CASES}
    assert {"casing", "error-shape", "timestamp", "graph-shape"} <= covered


# --------------------------------------------------------------------------
# The live API must obey the same envelope rules as the fixtures.
# --------------------------------------------------------------------------


def test_login_response_obeys_the_casing_and_timestamp_rules(client, seeded_user):
    body = client.post(
        "/api/auth/login",
        json={"username": seeded_user["username"], "password": seeded_user["password"]},
    ).json()
    validator_for("#/$defs/camelCaseObject").validate(body)
    validator_for("#/$defs/timestamp").validate(body["expiresAt"])


def test_health_response_obeys_the_casing_rule(client):
    validator_for("#/$defs/camelCaseObject").validate(client.get("/api/health").json())


def test_unauthenticated_error_obeys_the_error_shape(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    validator_for("#/$defs/errorResponse").validate(response.json())


def test_validation_error_obeys_the_error_shape(client):
    """FastAPI's native 422 body is {"detail": [ {...} ]} - a list, plus per-item
    objects. That violates envelope rule (b), so app/main.py normalises it. Without
    this test the SPA's error handler would render [object Object] the first time a
    field is missing."""
    response = client.post("/api/auth/login", json={"username": "admin"})
    assert response.status_code == 422
    validator_for("#/$defs/errorResponse").validate(response.json())
    assert isinstance(response.json()["detail"], str)


def test_csrf_rejection_obeys_the_error_shape(client, login):
    login()
    response = client.post("/api/auth/logout")
    assert response.status_code == 403
    validator_for("#/$defs/errorResponse").validate(response.json())


def test_error_bodies_carry_the_request_id_that_the_header_carries(client):
    response = client.get("/api/auth/me", headers={"x-request-id": "contract-test-1"})
    assert response.status_code == 401
    body = response.json()
    validator_for("#/$defs/errorResponse").validate(body)
    assert body["requestId"] == "contract-test-1" == response.headers["x-request-id"]


# --------------------------------------------------------------------------
# Tasks 1.3 / 1.6: the new resources obey the same envelope rules, and a
# stored graph comes back still satisfying the ArchGraph contract.
# --------------------------------------------------------------------------

_GRAPH = load_fixture("archgraph.checkout-service.valid.json")
_WORKSPACE_BODY = {
    "name": "Contract ws",
    "projectName": "p",
    "systemName": "s",
    "deploymentTarget": "on_premises",
    "revision": 0,
}


def test_workspace_response_obeys_the_casing_and_timestamp_rules(user_a):
    body = user_a.put("/api/workspaces/current", json=_WORKSPACE_BODY).json()
    validator_for("#/$defs/camelCaseObject").validate(body)
    validator_for("#/$defs/timestamp").validate(body["updatedAt"])
    validator_for("#/$defs/camelCaseObject").validate(user_a.get("/api/workspaces/current").json())


def test_design_responses_obey_the_casing_and_timestamp_rules_and_carry_a_valid_graph(user_a):
    created = user_a.post("/api/designs", json={"name": "contract", "graph": _GRAPH}).json()
    fetched = user_a.get(f"/api/designs/{created['id']}").json()
    updated = user_a.put(
        f"/api/designs/{created['id']}", json={"name": "contract 2", "graph": _GRAPH, "revision": 1}
    ).json()
    listed = user_a.get("/api/designs").json()
    for body in (created, fetched, updated, listed):
        validator_for("#/$defs/camelCaseObject").validate(body)
    for body in (created, fetched, updated, *listed["items"]):
        validator_for("#/$defs/timestamp").validate(body["createdAt"])
        validator_for("#/$defs/timestamp").validate(body["updatedAt"])
    for body in (created, fetched, updated):
        validator_for("#/$defs/archGraph").validate(body["graph"])


def test_new_error_paths_obey_the_error_shape(user_a, user_b):
    """404 (non-owner), 409 (stale revision), 422 (contract violation) and 404
    (no workspace yet) - every new error path the SPA's ApiError has to parse."""
    design = user_a.post("/api/designs", json={"name": "x", "graph": _GRAPH}).json()
    path = f"/api/designs/{design['id']}"
    user_a.put(path, json={"name": "x", "graph": _GRAPH, "revision": 1})
    broken = load_fixture("archgraph.snake-case-key.invalid.json")
    responses = {
        404: user_b.get(path),
        409: user_a.put(path, json={"name": "x", "graph": _GRAPH, "revision": 1}),
        422: user_a.post("/api/designs", json={"name": "x", "graph": broken}),
    }
    responses_ws = user_b.get("/api/workspaces/current")
    for expected_status, response in [*responses.items(), (404, responses_ws)]:
        assert response.status_code == expected_status, response.text
        validator_for("#/$defs/errorResponse").validate(response.json())
        assert response.json()["requestId"] == response.headers["x-request-id"]


def test_a_v2_design_response_obeys_the_casing_rule_at_every_depth(user_a):
    """Red-team review B2. Design v0.2 keyed maps by target id (`bare_metal`),
    profile id (`dc1_vsphere`) and artifact name (`brief.answers`); any of them
    would fail this assertion. Contract 1.1.0 carries that data as values in
    arrays, so the WHOLE body - 2.0 graph included - is camelCase."""
    graph = load_fixture("archgraph.v2-hybrid-orders.valid.json")
    created = user_a.post("/api/designs", json={"name": "hybrid", "graph": graph})
    assert created.status_code == 201, created.text
    body = created.json()
    validator_for("#/$defs/camelCaseObject").validate(body)
    validator_for("#/$defs/archGraph").validate(body["graph"])
    assert body["schemaVersion"] == "2.0"


def test_benchmark_response_obeys_the_casing_and_timestamp_rules(user_a):
    """Task 3.3: the new read-only resource obeys the same envelope rules."""
    body = user_a.get("/api/benchmarks").json()
    validator_for("#/$defs/camelCaseObject").validate(body)
    assert body["items"], "startup seed should have produced rows"
    for item in body["items"]:
        validator_for("#/$defs/timestamp").validate(item["updatedAt"])
