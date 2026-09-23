"""Health endpoints.

``/api/health/live`` is the shallow "process is up" probe.
``/api/health`` is the deep probe the container healthcheck should use: it
reads AND writes SQLite, because a shallow 200 keeps returning 200 while the
database is locked or read-only (red-team finding M12).
"""

from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter, Response, status

from .. import __version__
from ..config import get_settings
from ..db import connect, utcnow_iso
from ..schemas import ComponentHealth, HealthResponse, LivenessResponse

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/live", response_model=LivenessResponse, summary="Liveness probe")
def liveness() -> LivenessResponse:
    return LivenessResponse(status="ok")


def _check_database(timeout_seconds: float) -> tuple[list[ComponentHealth], str | None]:
    checks: list[ComponentHealth] = []
    schema_version: str | None = None

    started = time.perf_counter()
    conn: sqlite3.Connection | None = None
    try:
        conn = connect()
        conn.execute(f"PRAGMA busy_timeout = {int(timeout_seconds * 1000)}")
        row = conn.execute(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
        ).fetchone()
        schema_version = row["version"] if row else None
        conn.execute("SELECT COUNT(*) FROM users").fetchone()
        checks.append(
            ComponentHealth(
                name="sqlite_read",
                status="ok",
                detail=f"schema {schema_version or 'none'}",
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
        )
    except Exception as exc:  # noqa: BLE001 - the probe must report, not raise
        checks.append(
            ComponentHealth(
                name="sqlite_read",
                status="fail",
                detail=str(exc)[:200],
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
        )
        if conn is not None:
            conn.close()
        return checks, schema_version

    write_started = time.perf_counter()
    try:
        conn.execute("UPDATE health_probe SET probed_at = ? WHERE id = 1", (utcnow_iso(),))
        checks.append(
            ComponentHealth(
                name="sqlite_write",
                status="ok",
                latency_ms=round((time.perf_counter() - write_started) * 1000, 2),
            )
        )
    except Exception as exc:  # noqa: BLE001
        checks.append(
            ComponentHealth(
                name="sqlite_write",
                status="fail",
                detail=str(exc)[:200],
                latency_ms=round((time.perf_counter() - write_started) * 1000, 2),
            )
        )
    finally:
        conn.close()

    return checks, schema_version


@router.get(
    "",
    response_model=HealthResponse,
    summary="Deep health probe (read + write against SQLite)",
)
def health(response: Response) -> HealthResponse:
    settings = get_settings()
    checks, schema_version = _check_database(settings.health_timeout_seconds)

    if any(check.status == "fail" for check in checks):
        overall = "fail"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    elif any(check.status == "degraded" for check in checks):
        overall = "degraded"
    else:
        overall = "ok"

    return HealthResponse(
        status=overall,
        version=__version__,
        env=settings.env,
        schema_version=schema_version,
        checks=checks,
    )
