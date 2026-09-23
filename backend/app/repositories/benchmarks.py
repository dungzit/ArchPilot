"""Per-node capacity benchmarks (task 3.3): the read side and the seed.

Benchmarks are *shared reference data*, not owned content: every signed-in
user reads the same rows (``GET /api/benchmarks``). One row = one metric of one
component type on one hardware profile, e.g. ``database / read_qps / generic``.
The SPA pairs ``read_qps`` + ``write_qps`` rows into the dual-capacity
``NodeBenchmark`` that ``src/domain/sizing.ts`` consumes (red-team B3b).

The seed
--------
``SEED_BENCHMARKS`` is a deliberately small, honest set of **generic planning
heuristics**. None of them is a vendor figure or a measurement, so every row is
tagged ``estimated``, carries no ``source_url``, and its citation says so in
plain words. They exist so the calculator has a starting point on day one;
they are meant to be replaced by the team's own measurements.

Do not add a URL to a seed row unless the number really comes from that page,
and do not tag a seed row better than ``estimated``: storage triggers (001)
refuse ``measured``/``declared`` without a URL, and this module's tests refuse
any seed row that is not ``estimated``.

Idempotence rules (``seed_benchmarks``):

* A seed id that appears in ``benchmark_seed_log`` is never touched again -
  so a re-run never overwrites a row (edited or not) and never resurrects a
  row somebody deleted.
* A new seed id whose ``(component_type, metric, hardware_profile)`` slot is
  already taken by a user row is skipped and logged as ``skipped_conflict``.
* Everything runs in one ``BEGIN IMMEDIATE`` transaction: all or nothing.

To change a seeded number in a later release, add a row with a **new** seed id
(e.g. ``..._v2``); existing databases keep what their users have.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from ..db import immediate_transaction, utcnow_iso

SEED_VERSION = "2026-09-24.1"

GENERIC_PROFILE = "generic planning baseline"
HEURISTIC_CITATION = (
    "ArchPilot generic planning heuristic - not a vendor benchmark and not a "
    "measurement. Replace with your own load-test results."
)


@dataclass(frozen=True)
class SeedBenchmark:
    id: str
    component_type: str
    metric: str
    value: float
    unit: str
    hardware_profile: str
    basis: str
    confidence: str = "estimated"
    source_title: str = HEURISTIC_CITATION
    source_url: str | None = None


def _pair(
    component_type: str, read_qps: float, write_qps: float, basis: str
) -> tuple[SeedBenchmark, SeedBenchmark]:
    """One read row and one write row for a component type on the generic profile."""
    return (
        SeedBenchmark(
            id=f"bmk_seed_{component_type}_read_qps_generic",
            component_type=component_type,
            metric="read_qps",
            value=read_qps,
            unit="qps per node",
            hardware_profile=GENERIC_PROFILE,
            basis=basis,
        ),
        SeedBenchmark(
            id=f"bmk_seed_{component_type}_write_qps_generic",
            component_type=component_type,
            metric="write_qps",
            value=write_qps,
            unit="qps per node",
            hardware_profile=GENERIC_PROFILE,
            basis=basis,
        ),
    )


# Values match DEFAULT_NODE_BENCHMARKS in src/domain/sizing.ts where that file
# already has a type (service, database, cache), so the calculator shows the
# same number whether or not the API answered. Order-of-magnitude figures.
SEED_BENCHMARKS: tuple[SeedBenchmark, ...] = (
    *_pair(
        "database",
        8_000,
        2_000,
        "Relational database primary, mid-size server (about 8 vCPU, SSD), indexed "
        "single-row reads and writes. Rule of thumb for early planning.",
    ),
    *_pair(
        "cache",
        80_000,
        80_000,
        "In-memory key-value cache, one shard, small values (about 1 KiB), "
        "GET/SET only. Rule of thumb for early planning.",
    ),
    *_pair(
        "queue",
        20_000,
        10_000,
        "Message queue broker, persistent small messages (about 1 KiB); read = "
        "consume, write = publish. Rule of thumb for early planning.",
    ),
    *_pair(
        "service",
        1_000,
        1_000,
        "Stateless JSON API instance (about 4 vCPU), p99 under 50 ms, no heavy "
        "computation per request. Rule of thumb for early planning.",
    ),
    *_pair(
        "object_store",
        1_000,
        500,
        "Object storage node or gateway, small objects (under 1 MiB); read = GET, "
        "write = PUT. Rule of thumb for early planning.",
    ),
)


@dataclass
class SeedReport:
    inserted: list[str] = field(default_factory=list)
    already_seeded: list[str] = field(default_factory=list)
    skipped_conflict: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"benchmarks seed {SEED_VERSION}: inserted {len(self.inserted)}, "
            f"already seeded {len(self.already_seeded)}, "
            f"skipped (slot taken by a user row) {len(self.skipped_conflict)}"
        )


def seed_benchmarks(
    conn: sqlite3.Connection, rows: tuple[SeedBenchmark, ...] = SEED_BENCHMARKS
) -> SeedReport:
    """Insert seed rows that were never handled before. Never updates, never deletes."""
    report = SeedReport()
    with immediate_transaction(conn):
        handled = {row["seed_id"] for row in conn.execute("SELECT seed_id FROM benchmark_seed_log")}
        for seed in rows:
            if seed.id in handled:
                report.already_seeded.append(seed.id)
                continue
            now = utcnow_iso()
            # Explicit slot check rather than INSERT OR IGNORE: OR IGNORE would
            # also swallow a CHECK violation (a typo'd confidence tag) and log it
            # as a harmless conflict. This way only "slot already taken" is
            # skipped; every constraint and citation trigger still aborts the seed.
            taken = conn.execute(
                "SELECT 1 FROM benchmarks WHERE id = ? "
                "OR (component_type = ? AND metric = ? AND hardware_profile = ?)",
                (seed.id, seed.component_type, seed.metric, seed.hardware_profile),
            ).fetchone()
            if taken:
                outcome = "skipped_conflict"
                report.skipped_conflict.append(seed.id)
            else:
                conn.execute(
                    """
                    INSERT INTO benchmarks
                        (id, component_type, metric, value, unit, hardware_profile, basis,
                         source_url, source_title, retrieved_date, confidence, origin,
                         created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'seed', ?, ?)
                    """,
                    (
                        seed.id,
                        seed.component_type,
                        seed.metric,
                        seed.value,
                        seed.unit,
                        seed.hardware_profile,
                        seed.basis,
                        seed.source_url,
                        seed.source_title,
                        seed.confidence,
                        now,
                        now,
                    ),
                )
                outcome = "inserted"
                report.inserted.append(seed.id)
            conn.execute(
                "INSERT INTO benchmark_seed_log (seed_id, seed_version, outcome, applied_at) "
                "VALUES (?, ?, ?, ?)",
                (seed.id, SEED_VERSION, outcome, now),
            )
    return report


def list_benchmarks(conn: sqlite3.Connection, *, component_type: str | None = None) -> list[sqlite3.Row]:
    sql = (
        "SELECT id, component_type, metric, value, unit, hardware_profile, basis, source_url, "
        "source_title, retrieved_date, confidence, origin, updated_at FROM benchmarks"
    )
    params: tuple[str, ...] = ()
    if component_type is not None:
        sql += " WHERE component_type = ?"
        params = (component_type,)
    sql += " ORDER BY component_type, hardware_profile, metric, id"
    return conn.execute(sql, params).fetchall()
