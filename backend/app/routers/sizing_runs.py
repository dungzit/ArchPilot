"""Pilot v1: WP-A saved rule evaluations, cited by the HLD export (docs/v3/05, 06).

Placeholder router registered by the lead so app/main.py is not a merge
hotspot; the owning work package adds the routes. Wire contract:
src/contracts/pilot.ts.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/sizing-runs", tags=["sizing-runs"])
