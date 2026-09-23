"""``GET/PUT /api/workspaces/current`` (task 1.3).

Build-scope verification line: "user B cannot read user A's workspace". Also:
revision-checked writes (a stale revision is a 409, never a silent overwrite),
the wire shape is exactly store.ts's WorkspaceRecord, and CSRF applies.
"""

from __future__ import annotations

import threading

import pytest

URL = "/api/workspaces/current"
WORKSPACE_RECORD_KEYS = {"id", "name", "projectName", "systemName", "deploymentTarget", "revision", "updatedAt"}


def body(revision: int, **overrides) -> dict:
    base = {
        "name": "Payments team",
        "projectName": "OrderFlow modernization",
        "systemName": "OrderFlow API",
        "deploymentTarget": "aws",
        "revision": revision,
    }
    return {**base, **overrides}


def test_get_before_any_workspace_exists_is_404(user_a):
    response = user_a.get(URL)
    assert response.status_code == 404
    assert response.json()["detail"] == "no workspace yet"


def test_put_with_revision_zero_creates_the_workspace(user_a):
    response = user_a.put(URL, json=body(0))
    assert response.status_code == 200, response.text
    record = response.json()
    assert set(record) == WORKSPACE_RECORD_KEYS, "wire shape must equal WorkspaceRecord in store.ts"
    assert record["revision"] == 1
    assert record["name"] == "Payments team"
    assert record["id"].startswith("wsp_")
    assert user_a.get(URL).json() == record


def test_put_with_the_current_revision_updates_and_the_server_bumps_it(user_a):
    created = user_a.put(URL, json=body(0)).json()
    updated = user_a.put(URL, json=body(1, name="Renamed", deploymentTarget="hybrid")).json()
    assert updated["id"] == created["id"]
    assert updated["revision"] == 2
    assert (updated["name"], updated["deploymentTarget"]) == ("Renamed", "hybrid")
    assert user_a.get(URL).json()["revision"] == 2


def test_a_stale_revision_is_409_and_does_not_overwrite(user_a):
    user_a.put(URL, json=body(0))
    user_a.put(URL, json=body(1, name="Second tab wins"))
    stale = user_a.put(URL, json=body(1, name="First tab, stale"))
    assert stale.status_code == 409
    assert "current revision is 2" in stale.json()["detail"]
    current = user_a.get(URL).json()
    assert (current["name"], current["revision"]) == ("Second tab wins", 2)


def test_revision_zero_cannot_clobber_an_existing_workspace(user_a):
    user_a.put(URL, json=body(0))
    again = user_a.put(URL, json=body(0, name="fresh browser, no idea one exists"))
    assert again.status_code == 409
    assert user_a.get(URL).json()["name"] == "Payments team"


def test_a_nonzero_revision_cannot_create(user_a):
    response = user_a.put(URL, json=body(3))
    assert response.status_code == 409
    assert user_a.get(URL).status_code == 404


def test_user_b_cannot_read_user_a_workspace(user_a, user_b):
    a_record = user_a.put(URL, json=body(0, name="A's private workspace")).json()
    response = user_b.get(URL)
    assert response.status_code == 404
    assert "A's private workspace" not in response.text
    assert a_record["id"] not in response.text


def test_user_b_cannot_overwrite_user_a_workspace(user_a, user_b):
    a_before = user_a.put(URL, json=body(0, name="A's private workspace")).json()
    # B guesses A's revision. There is no id in the URL to aim at, so the
    # write can only ever land on B's own (non-existent) workspace -> 409.
    assert user_b.put(URL, json=body(1, name="hijacked")).status_code == 409
    # B creating their own workspace must not touch A's either.
    b_record = user_b.put(URL, json=body(0, name="B's workspace")).json()
    assert b_record["id"] != a_before["id"]
    assert user_a.get(URL).json() == a_before


def test_unauthenticated_calls_are_401(client):
    assert client.get(URL).status_code == 401
    assert client.put(URL, json=body(0)).status_code == 401


def test_put_without_the_csrf_header_is_403(user_a):
    response = user_a.put(URL, json=body(0), headers={"x-csrf-token": ""})
    assert response.status_code == 403
    assert user_a.get(URL).status_code == 404


@pytest.mark.parametrize(
    ("payload", "fragment"),
    [
        (body(0, id="client-picked-id"), "id"),  # server-owned
        (body(0, deploymentTarget="mainframe"), "deploymentTarget"),
        (body(0, name="   "), "name"),
        (body(-1), "revision"),
        ({k: v for k, v in body(0).items() if k != "revision"}, "revision"),
    ],
    ids=["client-id", "bad-target", "blank-name", "negative-revision", "missing-revision"],
)
def test_invalid_bodies_are_422_with_a_string_detail(user_a, payload, fragment):
    response = user_a.put(URL, json=payload)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)
    assert fragment in response.json()["detail"]


def test_concurrent_writers_on_the_same_revision_exactly_one_wins(migrated_db, seeded_user, temp_settings):
    """The revision check and the write are one IMMEDIATE transaction. Two
    connections racing on revision 1 must produce one success and one conflict,
    never two successes (a lost update)."""
    from app.db import connect
    from app.repositories import workspaces as repo
    from app.repositories.errors import RevisionConflictError

    fields = {"project_name": "", "system_name": "", "deployment_target": "aws"}
    repo.put_current(migrated_db, seeded_user["id"], name="v1", expected_revision=0, **fields)

    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def writer(label: str) -> None:
        conn = connect(temp_settings.db_path)
        try:
            barrier.wait()
            repo.put_current(conn, seeded_user["id"], name=label, expected_revision=1, **fields)
            outcomes.append("ok")
        except RevisionConflictError:
            outcomes.append("conflict")
        finally:
            conn.close()

    threads = [threading.Thread(target=writer, args=(f"writer-{n}",)) for n in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)

    assert sorted(outcomes) == ["conflict", "ok"]
    assert repo.get_current(migrated_db, seeded_user["id"])["revision"] == 2
