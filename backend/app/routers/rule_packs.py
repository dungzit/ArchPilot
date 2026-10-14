"""Pilot v1: WP-A user-created and Excel-imported rule packs (docs/v3/05).

Placeholder router registered by the lead so app/main.py is not a merge
hotspot; the owning work package adds the routes. Wire contract:
src/contracts/pilot.ts.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/rule-packs", tags=["rule-packs"])
