"""Request/response models. Pydantic is the API boundary validator.

Wire casing
-----------
Every type in ``ArchPilot/src/domain`` is camelCase (``projectName``,
``updatedAt``, ``schemaVersion``, ``formulaVersion``). Python is snake_case.
With no shared ``packages/core`` to reconcile them (build-scope decision D2),
the wire format has to pick one, once - otherwise every resource grows its own
hand-written mapping layer and that is exactly where a Python/TypeScript split
drifts.

The wire is **camelCase**, produced by an alias generator, so Python stays
idiomatic and the SPA consumes the API without a translation step.
``populate_by_name`` keeps snake_case input accepted for scripted clients.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Role = Literal["member", "editor", "admin"]


class ApiModel(BaseModel):
    """Base for everything that crosses the HTTP boundary."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class LoginRequest(ApiModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid"
    )

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class UserOut(ApiModel):
    id: str
    username: str
    display_name: str
    role: Role


class LoginResponse(ApiModel):
    user: UserOut
    expires_at: str
    # Also set as a readable cookie. The SPA must echo it in x-csrf-token on
    # every mutating request (see app/csrf.py).
    csrf_token: str


class MessageResponse(ApiModel):
    message: str


class ComponentHealth(ApiModel):
    name: str
    status: Literal["ok", "degraded", "fail"]
    detail: str = ""
    latency_ms: float | None = None


class HealthResponse(ApiModel):
    status: Literal["ok", "degraded", "fail"]
    version: str
    env: str
    schema_version: str | None = None
    checks: list[ComponentHealth]


class LivenessResponse(ApiModel):
    status: Literal["ok"]
