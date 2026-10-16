"""Pilot v1: WP-B SysDesAi reference search and pins (docs/v3/03).

* ``GET  /api/reference/search``  keyword search (VI->EN glossary, FTS5 bm25).
* ``GET  /api/reference/status``  index size and last crawl time.
* ``GET  /api/reference/pins?designId=`` / ``POST`` / ``DELETE /{id}``:
  owner-scoped pins on the caller's own ArchPilot designs. Someone else's
  design (or pin) answers 404, never 403.

Every route requires a session. CSRF for POST/DELETE is enforced centrally
(app/main.py). The index itself is read-only here; it is written only by the
snapshot loader (app/reference/index.py). Wire contract: src/contracts/pilot.ts.
"""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from ..dependencies import CurrentUser, DbConn
from ..reference import index as reference_index
from ..reference import pins as pins_repo
from ..reference import search as reference_search
from ..reference.parser import share_url
from ..repositories.errors import NotFoundError
from ..schemas_pilot_reference import (
    ReferencePinCreate,
    ReferencePinList,
    ReferencePinOut,
    ReferenceSearchOut,
    ReferenceStatusOut,
)

router = APIRouter(prefix="/api/reference", tags=["reference"])

SearchText = Annotated[str, Query(max_length=300)]
# Out-of-range limits are clamped to 1..50 rather than rejected: a search box
# should never answer 422 because of a paging knob.
Limit = Annotated[int, Query()]
Phase = Annotated[str | None, Query(max_length=32)]
Category = Annotated[str | None, Query(max_length=100)]
DesignIdQuery = Annotated[str, Query(alias="designId", min_length=1, max_length=64)]
PinId = Annotated[str, Path(min_length=1, max_length=64)]


@router.get("/search", response_model=ReferenceSearchOut, summary="Search SysDesAi reference designs")
def search(
    _user: CurrentUser,  # authentication only: the index is shared reference data
    conn: DbConn,
    q: SearchText = "",
    limit: Limit = reference_search.DEFAULT_LIMIT,
    phase: Phase = None,
    category: Category = None,
) -> ReferenceSearchOut:
    result = reference_search.search(conn, q, limit=limit, phase=phase, category=category)
    return ReferenceSearchOut.model_validate(result)


@router.get("/status", response_model=ReferenceStatusOut, summary="Index size and last crawl time")
def index_status(_user: CurrentUser, conn: DbConn) -> ReferenceStatusOut:
    return ReferenceStatusOut.model_validate(reference_index.status(conn))


def _pin_out(row: sqlite3.Row) -> ReferencePinOut:
    return ReferencePinOut(
        id=row["id"],
        design_id=row["design_id"],
        share_id=row["share_id"],
        url=share_url(row["share_id"]),
        title=row["title"],
        step_position=row["step_position"],
        step_title=row["step_title"],
        note=row["note"],
        created_at=row["created_at"],
    )


def _design_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="design not found")


@router.get("/pins", response_model=ReferencePinList, summary="The caller's reference pins on one of their designs")
def list_pins(user: CurrentUser, conn: DbConn, design_id: DesignIdQuery) -> ReferencePinList:
    try:
        rows = pins_repo.list_pins(conn, user["id"], design_id)
    except NotFoundError:
        raise _design_not_found() from None
    return ReferencePinList(items=[_pin_out(row) for row in rows], total=len(rows))


@router.post(
    "/pins",
    response_model=ReferencePinOut,
    status_code=status.HTTP_201_CREATED,
    summary="Pin a SysDesAi design (or one step) to one of the caller's designs; idempotent",
    responses={200: {"description": "already pinned"}, 404: {"description": "design or reference not found"}},
)
def create_pin(payload: ReferencePinCreate, user: CurrentUser, conn: DbConn, response: Response) -> ReferencePinOut:
    try:
        row, created = pins_repo.create_pin(
            conn,
            user["id"],
            design_id=payload.design_id,
            share_id=payload.share_id,
            step_position=payload.step_position,
            note=payload.note or None,
        )
    except NotFoundError:
        raise _design_not_found() from None
    except pins_repo.ReferenceNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="reference design or step not found"
        ) from None
    except pins_repo.PinLimitError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from None
    if not created:
        response.status_code = status.HTTP_200_OK
    return _pin_out(row)


@router.delete("/pins/{pin_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove one of the caller's pins")
def delete_pin(user: CurrentUser, conn: DbConn, pin_id: PinId) -> Response:
    try:
        pins_repo.delete_pin(conn, user["id"], pin_id)
    except NotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="pin not found") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
