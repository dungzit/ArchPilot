"""``GET /api/benchmarks`` (task 3.3, REQ-CALC-003, red-team M7).

Read-only and owner-independent: benchmarks are shared reference data, so any
signed-in user sees the same rows. Every row carries its citation
(``sourceTitle`` always, ``sourceUrl`` for measured/declared) and its
confidence tag, because the sizing engine widens its range from that tag.

There is deliberately no write route yet. Editing benchmarks without a deploy
(NFR-EXT-001) belongs with the admin surface (5.x); until then rows are
changed with SQL, and migration 004 marks any edited seed row as the user's.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from ..dependencies import CurrentUser, DbConn
from ..repositories import benchmarks as benchmarks_repo
from ..schemas import BenchmarkList, BenchmarkOut

router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"])

ComponentType = Annotated[str | None, Query(alias="componentType", min_length=1, max_length=64)]


@router.get("", response_model=BenchmarkList, summary="All per-node capacity benchmarks, each with its citation")
def list_benchmarks(
    _user: CurrentUser,  # authentication only: benchmarks are not owner-scoped
    conn: DbConn,
    component_type: ComponentType = None,
) -> BenchmarkList:
    rows = benchmarks_repo.list_benchmarks(conn, component_type=component_type)
    items = [BenchmarkOut(**dict(row)) for row in rows]
    return BenchmarkList(items=items, total=len(items))
