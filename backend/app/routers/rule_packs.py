"""Pilot v1: WP-A user-created and Excel-imported rule packs (docs/v3/05).

``/api/rule-packs`` is the team's shared library:

* every signed-in user can list and read every pack;
* any signed-in user can create one (they become its owner);
* only the owner or an admin can replace or delete it. Anyone else gets
  **403**, not 404: the pack is readable by everyone, so hiding that it
  exists would protect nothing;
* ``PUT`` replaces the pack and increments ``version`` (last write wins;
  there is no revision check in the pilot).

Bodies are capped at 512 KiB (``limit_rule_body``) on top of the global
4 MiB request cap, and validated by ``app/schemas_pilot_rules.py``. Formulas
are not parsed here: the TypeScript engine owns the DSL (decision D3).
Wire contract: src/contracts/pilot.ts.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status

from ..dependencies import CurrentUser, DbConn
from ..repositories import rule_packs as rule_packs_repo
from ..repositories.errors import NotFoundError
from ..schemas_pilot_rules import MAX_RULE_BODY_BYTES, RulePackListOut, RulePackOut, RulePackWrite

router = APIRouter(prefix="/api/rule-packs", tags=["rule-packs"])

PackId = Annotated[str, Path(min_length=1, max_length=64)]
Limit = Annotated[int, Query(ge=1, le=rule_packs_repo.MAX_LIST_LIMIT)]
Offset = Annotated[int, Query(ge=0)]


async def limit_rule_body(request: Request) -> None:
    """413 for a body over 512 KiB. FastAPI has already read (and cached) the
    body when dependencies run, and the global middleware bounds that read
    at 4 MiB, so measuring it here costs nothing extra."""
    declared = request.headers.get("content-length", "")
    too_large = declared.isdigit() and int(declared) > MAX_RULE_BODY_BYTES
    if too_large or len(await request.body()) > MAX_RULE_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"request body is larger than {MAX_RULE_BODY_BYTES} bytes",
        )


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule pack not found")


def _require_owner_or_admin(user, row) -> None:
    if row["owner_user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only the owner of this rule pack or an admin can change it",
        )


def _out(row) -> RulePackOut:
    return RulePackOut(**rule_packs_repo.pack_out_fields(row))


@router.get(
    "",
    response_model=RulePackListOut,
    response_model_exclude_none=True,
    summary="Every team rule pack, newest change first",
)
def list_rule_packs(
    _user: CurrentUser,  # authentication only: the library is shared
    conn: DbConn,
    limit: Limit = rule_packs_repo.DEFAULT_LIST_LIMIT,
    offset: Offset = 0,
) -> RulePackListOut:
    rows, total = rule_packs_repo.list_packs(conn, limit=limit, offset=offset)
    return RulePackListOut(items=[_out(row) for row in rows], total=total)


@router.get("/{pack_id}", response_model=RulePackOut, response_model_exclude_none=True, summary="One rule pack")
def get_rule_pack(_user: CurrentUser, conn: DbConn, pack_id: PackId) -> RulePackOut:
    row = rule_packs_repo.get_pack(conn, pack_id)
    if row is None:
        raise _not_found()
    return _out(row)


@router.post(
    "",
    response_model=RulePackOut,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_rule_body)],
    summary="Create a rule pack (version 1, owned by the caller)",
)
def create_rule_pack(payload: RulePackWrite, user: CurrentUser, conn: DbConn, response: Response) -> RulePackOut:
    row = rule_packs_repo.create_pack(
        conn,
        user["id"],
        name=payload.name,
        status=payload.status,
        description=payload.description,
        models=payload.models_json(),
    )
    response.headers["location"] = f"/api/rule-packs/{row['id']}"
    return _out(row)


@router.put(
    "/{pack_id}",
    response_model=RulePackOut,
    response_model_exclude_none=True,
    dependencies=[Depends(limit_rule_body)],
    summary="Replace a rule pack; increments its version",
    responses={403: {"description": "not the owner and not an admin"}, 404: {"description": "not found"}},
)
def update_rule_pack(payload: RulePackWrite, user: CurrentUser, conn: DbConn, pack_id: PackId) -> RulePackOut:
    current = rule_packs_repo.get_pack(conn, pack_id)
    if current is None:
        raise _not_found()
    _require_owner_or_admin(user, current)
    try:
        row = rule_packs_repo.update_pack(
            conn,
            pack_id,
            actor_id=user["id"],
            name=payload.name,
            status=payload.status,
            description=payload.description,
            models=payload.models_json(),
        )
    except NotFoundError as exc:
        raise _not_found() from exc
    return _out(row)


@router.delete(
    "/{pack_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a rule pack",
    responses={403: {"description": "not the owner and not an admin"}, 404: {"description": "not found"}},
)
def delete_rule_pack(user: CurrentUser, conn: DbConn, pack_id: PackId) -> Response:
    current = rule_packs_repo.get_pack(conn, pack_id)
    if current is None:
        raise _not_found()
    _require_owner_or_admin(user, current)
    try:
        rule_packs_repo.delete_pack(conn, pack_id, actor_id=user["id"])
    except NotFoundError as exc:
        raise _not_found() from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
