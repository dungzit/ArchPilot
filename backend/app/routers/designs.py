"""``/api/designs`` CRUD (task 1.6).

* Owner-scoped. A design owned by someone else answers **404, not 403**
  (build-scope §3.4): a 403 would confirm the id exists.
* ``graph`` is validated against ``contracts/archgraph.schema.json`` by the
  request model before this module runs.
* ``PUT`` carries the revision the client last saw; a stale one is a 409.
* ``GET /api/designs`` is paginated (``limit`` <= 100) and omits the graphs.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from ..dependencies import CurrentUser, DbConn
from ..repositories import designs as designs_repo
from ..repositories.errors import NotFoundError, RevisionConflictError
from ..schemas import DesignCreate, DesignList, DesignOut, DesignPut, DesignSummary

router = APIRouter(prefix="/api/designs", tags=["designs"])

DesignId = Annotated[str, Path(min_length=1, max_length=64)]
Limit = Annotated[int, Query(ge=1, le=designs_repo.MAX_LIST_LIMIT)]
Offset = Annotated[int, Query(ge=0)]


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="design not found")


def _summary_fields(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "name": row["name"],
        "schema_version": row["schema_version"],
        "visibility": row["visibility"],
        "seeded_from_pattern_id": row["seeded_from_pattern_id"],
        "revision": row["revision"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def design_out(row: sqlite3.Row) -> DesignOut:
    return DesignOut(**_summary_fields(row), graph=json.loads(row["graph_json"]))


@router.get("", response_model=DesignList, summary="The caller's designs, newest first, without graphs")
def list_designs(
    user: CurrentUser,
    conn: DbConn,
    limit: Limit = designs_repo.DEFAULT_LIST_LIMIT,
    offset: Offset = 0,
) -> DesignList:
    rows, total = designs_repo.list_designs(conn, user["id"], limit=limit, offset=offset)
    return DesignList(
        items=[DesignSummary(**_summary_fields(row)) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=DesignOut, status_code=status.HTTP_201_CREATED, summary="Create a design")
def create_design(payload: DesignCreate, user: CurrentUser, conn: DbConn, response: Response) -> DesignOut:
    row = designs_repo.create_design(conn, user["id"], name=payload.name, graph=payload.graph)
    response.headers["location"] = f"/api/designs/{row['id']}"
    return design_out(row)


@router.get("/{design_id}", response_model=DesignOut, summary="One design, with its graph")
def get_design(user: CurrentUser, conn: DbConn, design_id: DesignId) -> DesignOut:
    row = designs_repo.get_design(conn, user["id"], design_id)
    if row is None:
        raise _not_found()
    return design_out(row)


@router.put(
    "/{design_id}",
    response_model=DesignOut,
    summary="Replace name + graph; `revision` must be the current one",
    responses={404: {"description": "not found or not yours"}, 409: {"description": "stale revision"}},
)
def update_design(payload: DesignPut, user: CurrentUser, conn: DbConn, design_id: DesignId) -> DesignOut:
    try:
        row = designs_repo.update_design(
            conn,
            user["id"],
            design_id,
            name=payload.name,
            graph=payload.graph,
            expected_revision=payload.revision,
        )
    except NotFoundError as exc:
        raise _not_found() from exc
    except RevisionConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return design_out(row)


@router.delete(
    "/{design_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a design",
    responses={404: {"description": "not found or not yours"}},
)
def delete_design(user: CurrentUser, conn: DbConn, design_id: DesignId) -> Response:
    try:
        designs_repo.delete_design(conn, user["id"], design_id)
    except NotFoundError as exc:
        raise _not_found() from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
