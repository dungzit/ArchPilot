"""Domain errors shared by repositories. Routers map them to HTTP status codes."""

from __future__ import annotations


class NotFoundError(LookupError):
    """The row does not exist *for this owner*. Routers answer 404, never 403,
    so a non-owner cannot distinguish "not yours" from "does not exist"."""


class RevisionConflictError(RuntimeError):
    """Optimistic-concurrency failure: the caller edited a stale revision."""

    def __init__(self, *, expected: int, current: int) -> None:
        self.expected = expected
        self.current = current
        super().__init__(
            f"revision conflict: you sent revision {expected} but the current revision is "
            f"{current}; reload and re-apply your change"
        )
