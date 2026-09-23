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

import json
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from .contract import validate_archgraph

Role = Literal["member", "editor", "admin"]

# Mirrors `DeploymentTarget` in src/domain/model.ts.
DeploymentTarget = Literal[
    "aws", "azure", "gcp", "vmware", "kubernetes", "on_premises", "bare_metal", "hybrid"
]

# A design is edited by one person in a browser; 1 MiB of graph JSON is several
# thousand nodes. The cap is a resource guard, not a contract rule, so it lives
# here and not in contracts/archgraph.schema.json.
MAX_GRAPH_BYTES = 1_048_576

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


def _check_archgraph(value: dict[str, Any]) -> dict[str, Any]:
    """Validate against contracts/archgraph.schema.json - the same file both
    test suites use. No second definition of the graph shape exists in Python."""
    validate_archgraph(value)
    size = len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_GRAPH_BYTES:
        raise ValueError(f"graph is {size} bytes; the limit is {MAX_GRAPH_BYTES}")
    return value


ArchGraphDocument = Annotated[dict[str, Any], AfterValidator(_check_archgraph)]


class ApiModel(BaseModel):
    """Base for everything that crosses the HTTP boundary."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StrictApiModel(ApiModel):
    """Request bodies: an unknown key is a client bug, so it is a 422, not silently dropped."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


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


# --------------------------------------------------------------------------
# Workspaces (task 1.3). Wire shape == `WorkspaceRecord` in src/domain/store.ts.
# --------------------------------------------------------------------------


class WorkspaceOut(ApiModel):
    id: str
    name: str
    project_name: str
    system_name: str
    deployment_target: str
    revision: int
    updated_at: str


class WorkspacePut(StrictApiModel):
    name: Name
    project_name: OptionalText = ""
    system_name: OptionalText = ""
    deployment_target: DeploymentTarget
    # The revision the client last saw. 0 = "none yet", and is the only value
    # that may create the workspace. A stale value is a 409, never a silent
    # overwrite. `id` and `updatedAt` are server-owned and not accepted.
    revision: int = Field(ge=0)


# --------------------------------------------------------------------------
# Designs (task 1.6). `graph` is an ArchGraph, validated by the wire contract.
# --------------------------------------------------------------------------


class DesignCreate(StrictApiModel):
    name: Name
    graph: ArchGraphDocument


class DesignPut(StrictApiModel):
    name: Name
    graph: ArchGraphDocument
    revision: int = Field(ge=1)


class DesignSummary(ApiModel):
    id: str
    workspace_id: str
    name: str
    schema_version: str
    visibility: Literal["private", "workspace"]
    seeded_from_pattern_id: str | None = None
    revision: int
    created_at: str
    updated_at: str


class DesignOut(DesignSummary):
    graph: dict[str, Any]


class DesignList(ApiModel):
    items: list[DesignSummary]
    total: int
    limit: int
    offset: int


# --------------------------------------------------------------------------
# Benchmarks (task 3.3). Shared reference data, read by any signed-in user.
# One row = one metric; the SPA pairs read_qps + write_qps into a NodeBenchmark.
# --------------------------------------------------------------------------

Confidence = Literal["measured", "declared", "estimated", "unverified"]


class BenchmarkOut(ApiModel):
    id: str
    component_type: str
    metric: str
    value: float
    unit: str
    hardware_profile: str
    basis: str
    # The citation. `source_title` is always present (migration 004);
    # `source_url` is required for measured/declared (migration 001) and is
    # null for the generic 'estimated' heuristics the seed ships.
    source_title: str
    source_url: str | None = None
    retrieved_date: str | None = None
    confidence: Confidence
    origin: Literal["seed", "user"]
    updated_at: str


class BenchmarkList(ApiModel):
    items: list[BenchmarkOut]
    total: int
