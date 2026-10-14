"""Wire models for ``/api/reference`` (pilot WP-B).

Mirror of src/contracts/pilot.ts (ReferenceSearchResponse, ReferenceHit,
ReferenceStepHit, ReferenceStatus, ReferencePin, ReferencePinList). camelCase
on the wire through the shared ``ApiModel`` alias generator.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from .schemas import ApiModel, StrictApiModel

ReferenceTab = Literal["featured", "real-world", "community"]


class ReferenceStepHitOut(ApiModel):
    position: int
    title: str
    phase: str
    snippet: str


class ReferenceHitOut(ApiModel):
    share_id: str
    url: str
    title: str
    prompt: str
    categories: list[str]
    tab: ReferenceTab | None = None
    design_source: Literal["user", "article"] | None = None
    source_blog_name: str | None = None
    source_article_url: str | None = None
    upvote_count: int | None = None
    updated_at: str | None = None
    score: float
    steps: list[ReferenceStepHitOut]


class ReferenceSearchOut(ApiModel):
    query: str
    expanded_query: str
    total: int
    items: list[ReferenceHitOut]


class ReferenceStatusOut(ApiModel):
    indexed_designs: int
    indexed_steps: int
    last_crawl_at: str | None = None


ShareId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{3,40}$")]
DesignId = Annotated[str, StringConstraints(min_length=1, max_length=64)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class ReferencePinCreate(StrictApiModel):
    design_id: DesignId
    share_id: ShareId
    step_position: int | None = Field(default=None, ge=1, le=1000)
    note: Note | None = None


class ReferencePinOut(ApiModel):
    id: str
    design_id: str
    share_id: str
    url: str
    title: str
    step_position: int | None = None
    step_title: str | None = None
    note: str | None = None
    created_at: str


class ReferencePinList(ApiModel):
    items: list[ReferencePinOut]
    total: int
