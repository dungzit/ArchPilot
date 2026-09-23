"""``/api/workspaces/current`` (task 1.3).

Owner-scoped by construction: there is no workspace id in the URL, so a user
can only ever address their own row. Mutations go through the central CSRF
middleware like every other cookie-authenticated unsafe method.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException, status

from ..dependencies import CurrentUser, DbConn
from ..repositories import workspaces as workspaces_repo
from ..repositories.errors import RevisionConflictError
from ..schemas import WorkspaceOut, WorkspacePut

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


def workspace_out(row: sqlite3.Row) -> WorkspaceOut:
    return WorkspaceOut(
        id=row["id"],
        name=row["name"],
        project_name=row["project_name"],
        system_name=row["system_name"],
        deployment_target=row["deployment_target"],
        revision=row["revision"],
        updated_at=row["updated_at"],
    )


@router.get(
    "/current",
    response_model=WorkspaceOut,
    summary="The caller's workspace; 404 until the first PUT (or first design) creates it",
)
def get_current_workspace(user: CurrentUser, conn: DbConn) -> WorkspaceOut:
    row = workspaces_repo.get_current(conn, user["id"])
    if row is None:
        # The SPA maps this to `loadWorkspace() -> null`, which is exactly what
        # store.ts returns today for an empty localStorage.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no workspace yet")
    return workspace_out(row)


@router.put(
    "/current",
    response_model=WorkspaceOut,
    summary="Create (revision 0) or update (current revision) the caller's workspace",
    responses={409: {"description": "stale revision"}},
)
def put_current_workspace(payload: WorkspacePut, user: CurrentUser, conn: DbConn) -> WorkspaceOut:
    try:
        row = workspaces_repo.put_current(
            conn,
            user["id"],
            name=payload.name,
            project_name=payload.project_name,
            system_name=payload.system_name,
            deployment_target=payload.deployment_target,
            expected_revision=payload.revision,
        )
    except RevisionConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return workspace_out(row)
