"""Pilot v1: WP-A saved rule evaluations, cited by the HLD export (docs/v3/05, 06).

``/api/sizing-runs`` is owner-scoped like ``/api/designs``:

* ``POST`` saves a ``SizingRun`` for the caller. A ``designId`` must name a
  design the caller can access (``designs_repo.get_design``, the same rule as
  ``GET /api/designs/{id}``); someone else's design is a **404**, exactly as
  if it did not exist.
* ``GET ?designId=`` lists the caller's runs for that design (404 if the
  design is not theirs); without it, all of the caller's runs.
* ``GET /{id}`` and ``DELETE /{id}``: the caller's own runs only (404 otherwise).

The run is stored as the SPA computed it; the server never re-evaluates
(decision D3: sizing arithmetic lives in TypeScript only). Wire contract:
src/contracts/pilot.ts.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status

from ..dependencies import CurrentUser, DbConn
from ..repositories import designs as designs_repo
from ..repositories import sizing_runs as sizing_runs_repo
from ..repositories.errors import NotFoundError
from ..schemas_pilot_rules import SizingRunListOut, SizingRunOut, SizingRunWrite
from .rule_packs import limit_rule_body

router = APIRouter(prefix="/api/sizing-runs", tags=["sizing-runs"])

RunId = Annotated[str, Path(min_length=1, max_length=64)]
DesignIdQuery = Annotated[str | None, Query(alias="designId", min_length=1, max_length=64)]
Limit = Annotated[int, Query(ge=1, le=sizing_runs_repo.MAX_LIST_LIMIT)]
Offset = Annotated[int, Query(ge=0)]


def _require_design(conn, user, design_id: str) -> None:
    if designs_repo.get_design(conn, user["id"], design_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="design not found")


def _out(row) -> SizingRunOut:
    return SizingRunOut(**sizing_runs_repo.run_out_fields(row))


@router.get(
    "",
    response_model=SizingRunListOut,
    summary="The caller's saved runs, newest first; optionally for one design",
)
def list_sizing_runs(
    user: CurrentUser,
    conn: DbConn,
    design_id: DesignIdQuery = None,
    limit: Limit = sizing_runs_repo.DEFAULT_LIST_LIMIT,
    offset: Offset = 0,
) -> SizingRunListOut:
    if design_id is not None:
        _require_design(conn, user, design_id)
    rows, total = sizing_runs_repo.list_runs(conn, user["id"], design_id=design_id, limit=limit, offset=offset)
    return SizingRunListOut(items=[_out(row) for row in rows], total=total)


@router.post(
    "",
    response_model=SizingRunOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_rule_body)],
    summary="Save one evaluation",
    responses={404: {"description": "designId is not a design of the caller"}},
)
def create_sizing_run(payload: SizingRunWrite, user: CurrentUser, conn: DbConn, response: Response) -> SizingRunOut:
    if payload.design_id is not None:
        _require_design(conn, user, payload.design_id)
    row = sizing_runs_repo.create_run(conn, user["id"], design_id=payload.design_id, body=payload.body_json())
    response.headers["location"] = f"/api/sizing-runs/{row['id']}"
    return _out(row)


@router.get("/{run_id}", response_model=SizingRunOut, summary="One saved run")
def get_sizing_run(user: CurrentUser, conn: DbConn, run_id: RunId) -> SizingRunOut:
    row = sizing_runs_repo.get_run(conn, user["id"], run_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sizing run not found")
    return _out(row)


@router.delete(
    "/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete one of the caller's runs",
    responses={404: {"description": "not found or not yours"}},
)
def delete_sizing_run(user: CurrentUser, conn: DbConn, run_id: RunId) -> Response:
    try:
        sizing_runs_repo.delete_run(conn, user["id"], run_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sizing run not found") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
