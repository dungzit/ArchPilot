"""Runtime validation against the ONE wire contract, ``contracts/archgraph.schema.json``.

Why this reads the contract file instead of defining pydantic models
--------------------------------------------------------------------
Task 1.6 stores user-authored ``ArchGraph`` documents. The shape of that
document is already defined, once, in ``contracts/archgraph.schema.json`` and is
enforced by both test suites (build-scope decision D4). Writing a pydantic
``ArchNode``/``ArchEdge`` here would be a second definition of the same shape -
exactly the Python/TypeScript drift the contract exists to prevent. So the
backend validates request bodies against the very same file, with the same
validator library (``jsonschema``) the Python contract suite already uses.

Cost, stated plainly: ``jsonschema`` moves from a test-only dependency to a
runtime one (runtime deps 3 -> 4, plus its pure-Python/wheel transitive deps).
That is cheaper than a hand-rolled second definition and cheaper than a
hand-rolled JSON-Schema subset validator.

What this does NOT check: referential integrity (an edge naming a node that
does not exist, duplicate node ids). JSON Schema cannot express it; it belongs
to ``validateGraph()`` in ``src/domain/graph.ts`` (task 1.5).

File location: the repo keeps the contract at ``ArchPilot/contracts/``; the
container copies it to ``/srv/contracts/``. ``ARCHPILOT_CONTRACT_PATH``
overrides both. A missing contract fails at application start-up, not on the
first save.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError, best_match
from referencing import Registry, Resource

from .config import BACKEND_ROOT

CONTRACT_FILENAME = "archgraph.schema.json"
ARCHGRAPH_REF = "#/$defs/archGraph"
# Detail strings travel back to the user. jsonschema messages can embed the
# whole offending instance; cap them so a 1 MB graph cannot echo itself back.
MAX_MESSAGE_CHARS = 300


class ContractViolationError(ValueError):
    """A document does not satisfy the wire contract.

    Subclasses ``ValueError`` on purpose: pydantic turns a ``ValueError`` raised
    inside a validator into a normal 422, which ``app/main.py`` then flattens
    into the ``{detail, requestId?}`` error envelope.
    """


def candidate_paths() -> list[Path]:
    override = os.environ.get("ARCHPILOT_CONTRACT_PATH")
    if override:
        return [Path(override)]
    return [
        BACKEND_ROOT / "contracts" / CONTRACT_FILENAME,  # container: /srv/contracts
        BACKEND_ROOT.parent / "contracts" / CONTRACT_FILENAME,  # repo: ArchPilot/contracts
    ]


@lru_cache(maxsize=1)
def load_contract() -> dict[str, Any]:
    """Read and self-check the contract once per process."""
    for path in candidate_paths():
        if path.is_file():
            contract = json.loads(path.read_text(encoding="utf-8"))
            Draft202012Validator.check_schema(contract)
            return contract
    searched = ", ".join(str(p) for p in candidate_paths())
    raise FileNotFoundError(f"wire contract {CONTRACT_FILENAME} not found; searched: {searched}")


@lru_cache(maxsize=8)
def validator_for(schema_ref: str) -> Draft202012Validator:
    """A validator for one ``$defs`` pointer inside the shared contract."""
    contract = load_contract()
    registry = Resource.from_contents(contract) @ Registry()
    return Draft202012Validator({"$ref": contract["$id"] + schema_ref}, registry=registry)


def _format_path(parts: Iterable[Any]) -> str:
    """``['nodes', 0, 'type']`` -> ``nodes[0].type``."""
    out = ""
    for part in parts:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out or "(root)"


def describe(error: ValidationError) -> str:
    message = error.message
    if len(message) > MAX_MESSAGE_CHARS:
        message = message[: MAX_MESSAGE_CHARS - 3] + "..."
    return f"{_format_path(error.absolute_path)}: {message}"


def validate_archgraph(document: Any) -> None:
    """Raise ``ContractViolationError`` unless ``document`` is a contract-valid ArchGraph."""
    error = best_match(validator_for(ARCHGRAPH_REF).iter_errors(document))
    if error is not None:
        raise ContractViolationError(f"graph does not match the ArchGraph contract - {describe(error)}")
