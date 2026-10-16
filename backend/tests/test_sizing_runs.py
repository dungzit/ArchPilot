"""``/api/sizing-runs`` (pilot WP-A, docs/v3/05 and 06).

Owner-scoped like designs: someone else's run or design answers 404, never
403. A run may cite one of the caller's own designs; listing by design
checks the same access rule. The stored run round-trips unchanged.
"""

from __future__ import annotations

import copy
import json

import pytest

URL = "/api/sizing-runs"
EMPTY_GRAPH = {"schemaVersion": "1.0", "nodes": [], "edges": []}

# What evaluateModel returns for the 05 §9 Kafka golden (abridged trace).
KAFKA_RUN = {
    "componentLabel": "Kafka cluster (Prod)",
    "rulePackId": "archpilot-core",
    "rulePackVersion": 1,
    "modelId": "kafka",
    "modelName": "Kafka cluster",
    "inputs": [
        {"name": "ingress", "value": 150, "unit": "MB/s", "source": "customer (RFP)"},
        {"name": "broker_write", "value": 100, "unit": "MB/s", "source": "param: catalog: kafka.broker_write_mbps"},
    ],
    "steps": [
        {"name": "tp_brokers", "formula": "ceil(ingress * rf / broker_write / target_util)", "substituted": "ceil(150 MB/s \u00d7 3 / 100 MB/s / 0.6) = ceil(7.5)", "value": 8, "unit": "broker"},
        {"name": "storage", "formula": 'convert(ingress * retention * rf, "TB")', "substituted": 'convert(150 MB/s \u00d7 3 day \u00d7 3, "TB")', "value": 116.64, "unit": "TB"},
        {"name": "brokers", "formula": "max(tp_brokers, storage_brokers, rf)", "substituted": "max(8, 14, 3)", "value": 14, "unit": "broker"},
    ],
    "outputs": [{"name": "brokers", "value": 14, "unit": "broker", "label": "Brokers"}],
    "binding": "storage_brokers",
    "warnings": [{"severity": "high", "messageVi": "Replication factor < 3 ở môi trường Prod.", "messageEn": "Replication factor below 3 in Prod."}],
}


def run_body(**overrides) -> dict:
    body = copy.deepcopy(KAFKA_RUN)
    body.update(overrides)
    return body


def make_design(test_client, name: str = "Checkout") -> str:
    response = test_client.post("/api/designs", json={"name": name, "graph": EMPTY_GRAPH})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def save(test_client, **overrides) -> dict:
    response = test_client.post(URL, json=run_body(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def run_count(migrated_db) -> int:
    return migrated_db.execute("SELECT COUNT(*) FROM sizing_runs").fetchone()[0]


def test_every_route_requires_authentication(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json=run_body()).status_code == 401
    assert client.get(f"{URL}/srn_x").status_code == 401
    assert client.delete(f"{URL}/srn_x").status_code == 401


def test_cookie_authenticated_save_without_csrf_header_is_rejected(client, login):
    login()
    assert client.post(URL, json=run_body()).status_code == 403


def test_save_without_a_design_round_trips_the_run(user_a):
    response = user_a.post(URL, json=run_body(id="client-id", createdAt="1999-01-01T00:00:00+00:00"))
    assert response.status_code == 201, response.text
    run = response.json()
    assert response.headers["location"] == f"{URL}/{run['id']}"
    assert run["id"].startswith("srn_"), "the id is server-owned"
    assert run["createdAt"] != "1999-01-01T00:00:00+00:00", "so is the time"
    assert run["designId"] is None
    expected = run_body()
    for key, value in expected.items():
        assert json.loads(json.dumps(run[key])) == value, key
    assert user_a.get(f"{URL}/{run['id']}").json() == run


def test_pack_name_and_output_source_step_round_trip_and_stay_optional(user_a):
    outputs = [{"name": "brokers", "value": 14, "unit": "broker", "label": "Brokers", "from": "brokers"}]
    run = save(user_a, rulePackName="ArchPilot core sizing", outputs=outputs)
    assert run["rulePackName"] == "ArchPilot core sizing"
    assert run["outputs"] == outputs
    assert user_a.get(f"{URL}/{run['id']}").json()["outputs"][0]["from"] == "brokers"
    older = save(user_a)
    assert older["rulePackName"] is None
    assert "from" not in older["outputs"][0]


def test_save_against_own_design_and_list_by_design(user_a):
    design_id = make_design(user_a)
    other_design = make_design(user_a, "Other")
    cited = save(user_a, designId=design_id)
    save(user_a, designId=other_design)
    loose = save(user_a)
    assert cited["designId"] == design_id

    by_design = user_a.get(URL, params={"designId": design_id}).json()
    assert by_design["total"] == 1
    assert [item["id"] for item in by_design["items"]] == [cited["id"]]

    everything = user_a.get(URL).json()
    assert everything["total"] == 3
    assert everything["items"][0]["id"] == loose["id"], "newest first"


def test_someone_elses_design_is_404_and_nothing_is_stored(user_a, user_b, migrated_db):
    design_id = make_design(user_a)
    response = user_b.post(URL, json=run_body(designId=design_id))
    assert response.status_code == 404
    assert response.json()["detail"] == "design not found"
    assert user_b.get(URL, params={"designId": design_id}).status_code == 404
    assert user_b.post(URL, json=run_body(designId="dsg_does_not_exist")).status_code == 404
    assert run_count(migrated_db) == 0


def test_a_deleted_design_cannot_be_cited(user_a):
    design_id = make_design(user_a)
    assert user_a.delete(f"/api/designs/{design_id}").status_code == 204
    assert user_a.post(URL, json=run_body(designId=design_id)).status_code == 404


def test_runs_are_private_to_their_owner(user_a, user_b):
    run = save(user_a)
    assert user_b.get(URL).json() == {"items": [], "total": 0}
    assert user_b.get(f"{URL}/{run['id']}").status_code == 404
    assert user_b.delete(f"{URL}/{run['id']}").status_code == 404
    assert user_a.get(f"{URL}/{run['id']}").status_code == 200, "B's delete did not touch it"


def test_owner_deletes_a_run(user_a):
    run = save(user_a)
    assert user_a.delete(f"{URL}/{run['id']}").status_code == 204
    assert user_a.get(f"{URL}/{run['id']}").status_code == 404
    assert user_a.delete(f"{URL}/{run['id']}").status_code == 404


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"rulePackId": None}, "rulePackId"),
        ({"rulePackVersion": -1}, "rulePackVersion"),
        ({"warnings": [{"severity": "fatal", "messageVi": "", "messageEn": ""}]}, "severity"),
        ({"steps": [{"name": f"s{i}", "formula": "1", "substituted": "1", "value": 1, "unit": ""} for i in range(201)]}, "steps"),
        ({"componentLabel": "x" * 201}, "componentLabel"),
        # The caps the SPA clips to before saving (src/api/sizingRuns.ts fitRunToServerCaps).
        ({"inputs": [{"name": "p", "value": 1, "unit": "", "source": "param: " + "x" * 200}]}, "source"),
        ({"binding": "x" * 201}, "binding"),
        ({"rulePackName": "x" * 201}, "rulePackName"),
        ({"outputs": [{"name": "o", "value": 1, "unit": "", "from": "not an identifier"}]}, "from"),
    ],
)
def test_invalid_runs_are_422(user_a, migrated_db, overrides, fragment):
    response = user_a.post(URL, json=run_body(**overrides))
    assert response.status_code == 422, response.text
    assert fragment in response.json()["detail"]
    assert run_count(migrated_db) == 0


def test_non_finite_values_are_422(user_a, migrated_db):
    body = json.dumps(run_body()).replace('"value": 14,', '"value": NaN,', 1)
    response = user_a.post(URL, content=body.encode(), headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert run_count(migrated_db) == 0


def test_a_body_over_512_kib_is_413(user_a, migrated_db):
    response = user_a.post(URL, json=run_body(padding="x" * (512 * 1024)))
    assert response.status_code == 413
    assert run_count(migrated_db) == 0


def test_list_by_design_rejects_a_bad_limit(user_a):
    assert user_a.get(URL, params={"limit": 0}).status_code == 422
    assert user_a.get(URL, params={"limit": 501}).status_code == 422
