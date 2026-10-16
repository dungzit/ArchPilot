"""Concurrent requests must not 500 (review-v2-phase0, finding B1).

FastAPI runs a sync yield dependency's setup (``get_connection``), the other
sync dependencies, the handler and the teardown as separate threadpool calls.
Sequential test traffic reuses one worker thread, so the suite never saw that
``sqlite3``'s default ``check_same_thread=True`` breaks as soon as two requests
overlap: against a real uvicorn, 599 of 600 concurrent GETs were 500s
(``ProgrammingError: SQLite objects created in a thread can only be used in
that same thread``), raised at ``close()`` - after writes had committed.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor


def test_a_connection_can_be_handed_to_another_thread(temp_settings):
    from app.db import connect

    conn = connect()
    errors: list[BaseException] = []

    def use_elsewhere():
        try:
            conn.execute("SELECT 1").fetchone()
            conn.close()
        except BaseException as exc:  # noqa: BLE001 - the assertion below reports it
            errors.append(exc)

    worker = threading.Thread(target=use_elsewhere)
    worker.start()
    worker.join()
    assert errors == []


def test_overlapping_requests_all_succeed(user_a):
    created = user_a.post("/api/designs", json={"name": "n", "graph": {"schemaVersion": "1.0", "nodes": [], "edges": []}})
    assert created.status_code == 201

    def one(index: int) -> int:
        if index % 3 == 0:
            return user_a.get(created.headers["location"]).status_code
        return user_a.get("/api/designs").status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(one, range(120)))
    assert statuses == [200] * 120
