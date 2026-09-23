"""FastAPI application factory for the ArchPilot backend.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import BACKEND_ROOT, get_settings
from .contract import load_contract
from .csrf import CSRF_HEADER, enforce_csrf
from .db import connect, init_database
from .logging_config import configure_logging
from .repositories import benchmarks as benchmarks_repo
from .repositories import users as users_repo
from .routers import auth, benchmarks, designs, health, workspaces

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "x-request-id"

# Cheap, static hardening headers. The SPA and the API are same-origin in the
# container, so a restrictive frame/referrer policy costs nothing.
SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    applied = init_database(settings)
    purged = _purge_expired_sessions(settings)
    seeded = _seed_benchmarks(settings)
    logger.info(
        "backend started",
        extra={
            "db_path": str(settings.db_path),
            "migrations_applied": applied,
            "expired_sessions_purged": purged,
            "benchmarks_seeded": seeded,
            "env": settings.env,
        },
    )
    yield
    logger.info("backend stopping")


def _purge_expired_sessions(settings) -> int:
    """Startup sweep. ``sessions`` rows otherwise accumulate forever: nothing
    else called ``purge_expired_sessions`` before this."""
    conn = connect(settings.db_path)
    try:
        return users_repo.purge_expired_sessions(conn)
    except Exception:  # broad on purpose: never let housekeeping block startup
        logger.exception("expired-session purge failed")
        return 0
    finally:
        conn.close()


def _seed_benchmarks(settings) -> int:
    """Insert any never-seen seed benchmarks (task 3.3). Never updates or
    deletes a row, so it is safe on every start (app/repositories/benchmarks.py).
    A failure is logged, not fatal: the SPA falls back to its built-in defaults
    when the list is empty, and the rest of the API does not depend on it."""
    conn = connect(settings.db_path)
    try:
        report = benchmarks_repo.seed_benchmarks(conn)
        if report.inserted or report.skipped_conflict:
            logger.info(report.summary())
        return len(report.inserted)
    except Exception:  # broad on purpose, same reason as the session purge
        logger.exception("benchmark seed failed")
        return 0
    finally:
        conn.close()


def _apply_security_headers(response) -> None:
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)


def _error_body(detail: str, request: Request) -> dict[str, str]:
    """The one error envelope: contracts/archgraph.schema.json #/$defs/errorResponse.

    ``{detail}`` or ``{detail, requestId}``, camelCase, ``detail`` always a
    string. Enforced by tests/test_contracts.py against live responses, not only
    against fixtures.
    """
    body: dict[str, str] = {"detail": detail}
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        body["requestId"] = request_id
    return body


def _flatten_validation_error(exc: RequestValidationError) -> str:
    """FastAPI's native 422 body is ``{"detail": [ {type, loc, msg, ...} ]}``.

    That is a list of objects where the contract promises a string, and it leaks
    the internal field path shape to the client. Flatten it to one readable
    sentence: ``body.password: Field required``.
    """
    parts: list[str] = []
    for error in exc.errors():
        location = ".".join(str(item) for item in error.get("loc", ()) if item != "__root__")
        message = str(error.get("msg", "invalid value"))
        parts.append(f"{location}: {message}" if location else message)
    return "; ".join(parts) or "request validation failed"


def create_app() -> FastAPI:
    settings = get_settings()
    # Designs are validated against contracts/archgraph.schema.json at request
    # time. A container built without that file must fail here, at start-up,
    # not with a 500 on somebody's first save.
    load_contract()

    app = FastAPI(
        title="ArchPilot Backend",
        version=__version__,
        description=(
            "Server-side persistence for ArchPilot's Phase 1 canvas, sizing studio "
            "and pattern/knowledge modules. Replaces the SPA's localStorage-only store."
        ),
        lifespan=lifespan,
        # The schema of every route, including the admin surface, is not
        # something an unauthenticated caller needs in production.
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,  # required: the session lives in a cookie
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["content-type", "authorization", CSRF_HEADER, REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()

        # CSRF is enforced here rather than per-route so a router added later
        # cannot forget it (the build-scope doc's stub #1).
        rejected = enforce_csrf(request, settings, request_id)
        if rejected is not None:
            rejected.headers[REQUEST_ID_HEADER] = request_id
            _apply_security_headers(rejected)
            logger.warning(
                "csrf rejected",
                extra={"request_id": request_id, "method": request.method, "path": request.url.path},
            )
            return rejected

        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "unhandled error",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                },
            )
            response = JSONResponse(
                status_code=500,
                content={"detail": "internal server error", "requestId": request_id},
            )
            response.headers[REQUEST_ID_HEADER] = request_id
            _apply_security_headers(response)
            return response

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers[REQUEST_ID_HEADER] = request_id
        _apply_security_headers(response)
        logger.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response

    # Envelope rule (b): every non-2xx JSON body is {detail, requestId?} with a
    # string detail. Registered centrally for the same reason CSRF is - a router
    # added later cannot opt out of it.
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(str(exc.detail), request),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=_error_body(_flatten_validation_error(exc), request),
        )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(workspaces.router)
    app.include_router(designs.router)
    app.include_router(benchmarks.router)

    # Single-container deployment: if the built SPA is present, serve it from
    # the same origin. Then no CORS is involved and the session cookie is
    # first-party. During development the Vite dev server serves it instead and
    # this mount simply does not exist.
    spa_dir = BACKEND_ROOT / "static"
    if spa_dir.is_dir():
        app.mount("/", StaticFiles(directory=str(spa_dir), html=True), name="spa")
        logger.info("serving SPA from %s", spa_dir)

    return app


app = create_app()
