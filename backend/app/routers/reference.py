"""Pilot v1: WP-B SysDesAi reference search and pins (docs/v3/03).

Placeholder router registered by the lead so app/main.py is not a merge
hotspot; the owning work package adds the routes. Wire contract:
src/contracts/pilot.ts.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/reference", tags=["reference"])
