"""Canonical content hashing for the pattern legal gate (red-team blocker B1).

The rule this module exists to enforce:

    A legal approval is bound to the *bytes* that were approved, not to the
    pattern's ID. If any legally-significant field changes after approval, the
    hash changes, the publish check fails, and the pattern is back to 'draft'.

Canonicalisation matters: two JSON encodings of the same graph must produce the
same hash, or an incidental key reorder would revoke a valid approval. We
therefore re-serialise ``graph_json`` with sorted keys and fixed separators
before hashing.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

# Order is part of the contract. Appending a field is a hash-version bump.
LEGALLY_SIGNIFICANT_FIELDS: tuple[str, ...] = (
    "title",
    "summary_one_line",
    "body_md",
    "graph_json",
    "categories_json",
    "source_company",
    "source_url",
    "source_title",
    "source_published_date",
)

HASH_VERSION = "sha256-v1"


class ContentHashError(ValueError):
    """Raised when a pattern payload cannot be canonicalised."""


def _canonical_json(raw: str, field: str) -> str:
    """Re-encode a JSON string deterministically (sorted keys, tight separators)."""
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ContentHashError(f"field {field!r} is not valid JSON: {exc}") from exc
    return json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_payload(pattern: dict[str, Any]) -> str:
    """Build the exact string that gets hashed.

    Uses a length-prefixed encoding so that no combination of field values can
    be shuffled across boundaries to collide (``a|bc`` vs ``ab|c``).
    """
    parts: list[str] = [HASH_VERSION]
    for field in LEGALLY_SIGNIFICANT_FIELDS:
        value = pattern.get(field)
        if value is None:
            encoded = ""
        elif field in {"graph_json", "categories_json"}:
            encoded = _canonical_json(str(value), field)
        else:
            encoded = str(value)
        parts.append(f"{field}:{len(encoded)}:{encoded}")
    return "\n".join(parts)


def compute_content_hash(pattern: dict[str, Any]) -> str:
    """SHA-256 hex digest of the canonical payload."""
    missing = [
        field
        for field in LEGALLY_SIGNIFICANT_FIELDS
        if field != "source_published_date" and not str(pattern.get(field) or "").strip()
    ]
    if missing:
        raise ContentHashError(f"missing legally-significant fields: {', '.join(missing)}")
    return hashlib.sha256(canonical_payload(pattern).encode("utf-8")).hexdigest()


def approval_matches(pattern: dict[str, Any], approved_hash: str) -> bool:
    """True when the pattern's current bytes are the ones that were approved."""
    return compute_content_hash(pattern) == approved_hash
