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


def test_manifest_covers_every_fixture_on_disk():
    on_disk = {p.name for p in FIXTURES_DIR.glob("*.json")} - {MANIFEST_PATH.name}
    listed = {c["fixture"] for c in CASES}
    assert on_disk == listed, (
        f"unexercised fixtures: {sorted(on_disk - listed)}; "
        f"missing files: {sorted(listed - on_disk)}"
    )


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
