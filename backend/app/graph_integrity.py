"""L1 integrity of an ArchGraph document (task 0.4; design-v2 4.3.3).

JSON Schema checks SHAPE (``app/contract.py``). It cannot say "every edge names
an existing node", "ids are unique", "containment has no cycles" or "the node
type is a catalogue role". This module checks exactly those, and nothing that
interprets meaning: NEST rules, access modes, coverage and realisations are
TypeScript's job (``src/domain/graph``), and they never block a save.

The rule codes are shared with ``validateGraph()`` in
``src/domain/graph/validate.ts`` and listed in
``contracts/fixtures/index.json`` (``integrityRules``). Every fixture in
``integrityCases`` must be rejected here with its ``expectRule`` - and by the
TypeScript implementation, and by the designs API with a 422.

Pure functions over plain dicts: no I/O except loading the catalogue once.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .catalog import Catalog, load_catalog
from .contract import ContractViolationError

RULE_CODES: tuple[str, ...] = (
    "INT-DUPLICATE-NODE-ID",
    "INT-DUPLICATE-EDGE-ID",
    "INT-DANGLING-EDGE",
    "INT-DUPLICATE-CODENAME",
    "INT-DANGLING-PARENT",
    "INT-PARENT-CYCLE",
    "INT-DEPTH",
    "INT-UNKNOWN-ROLE",
    "INT-UNKNOWN-VARIANT",
    "INT-DUPLICATE-PROFILE-ID",
    "INT-DUPLICATE-SCENARIO-ID",
    "INT-UNKNOWN-PROFILE",
    "INT-UNKNOWN-SCENARIO",
    "INT-DANGLING-BINDING",
    "INT-DUPLICATE-BINDING",
    "INT-DANGLING-PLACEMENT",
    "INT-DUPLICATE-PLACEMENT",
    "INT-DUPLICATE-DECISION-ID",
    "INT-DANGLING-DECISION-REF",
)

# How many issues the 422 detail spells out. The rest are counted, so a
# 500-node paste with 500 dangling edges cannot produce a megabyte error body.
MAX_ISSUES_IN_DETAIL = 3
_MAX_VALUE_CHARS = 64


@dataclass(frozen=True)
class IntegrityIssue:
    code: str
    path: str
    message: str

    def describe(self) -> str:
        return f"{self.code} {self.path}: {self.message}"


class GraphIntegrityError(ContractViolationError):
    """A contract-valid document is internally inconsistent. Subclasses
    ``ContractViolationError`` (a ``ValueError``), so the request model turns it
    into the same 422 ``{detail, requestId}`` envelope as a shape violation."""

    def __init__(self, issues: Sequence[IntegrityIssue]) -> None:
        self.issues = tuple(issues)
        shown = "; ".join(issue.describe() for issue in self.issues[:MAX_ISSUES_IN_DETAIL])
        more = len(self.issues) - MAX_ISSUES_IN_DETAIL
        suffix = f" (+{more} more)" if more > 0 else ""
        super().__init__(f"graph failed integrity checks - {shown}{suffix}")


def _show(value: object) -> str:
    text = repr(value)
    return text if len(text) <= _MAX_VALUE_CHARS else text[: _MAX_VALUE_CHARS - 3] + "..."


def _as_list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _duplicates(items: Iterable[tuple[int, object]]) -> list[tuple[int, object]]:
    """``(index, key)`` for every occurrence after the first of each key."""
    seen: set[object] = set()
    repeats: list[tuple[int, object]] = []
    for index, key in items:
        if key in seen:
            repeats.append((index, key))
        else:
            seen.add(key)
    return repeats


def check_integrity(document: Mapping[str, Any], catalog: Catalog | None = None) -> list[IntegrityIssue]:
    """Every L1 violation in ``document``, in document order. Empty = clean.

    Assumes ``document`` already passed the contract (so field types are
    right); stays defensive anyway, because it is also called from tests and
    scripts on arbitrary input.
    """
    nodes = [n for n in _as_list(document.get("nodes")) if isinstance(n, dict)]
    edges = [e for e in _as_list(document.get("edges")) if isinstance(e, dict)]
    issues: list[IntegrityIssue] = []

    # -- ids and edges: both schema versions --------------------------------
    for index, node_id in _duplicates((i, n.get("id")) for i, n in enumerate(nodes)):
        message = f"{_show(node_id)} is used by another node"
        issues.append(IntegrityIssue("INT-DUPLICATE-NODE-ID", f"nodes[{index}].id", message))
    for index, edge_id in _duplicates((i, e.get("id")) for i, e in enumerate(edges)):
        message = f"{_show(edge_id)} is used by another edge"
        issues.append(IntegrityIssue("INT-DUPLICATE-EDGE-ID", f"edges[{index}].id", message))
    node_ids = {n.get("id") for n in nodes}
    for index, edge in enumerate(edges):
        for end in ("source", "target"):
            if edge.get(end) not in node_ids:
                message = f"{_show(edge.get(end))} is not a node id"
                issues.append(IntegrityIssue("INT-DANGLING-EDGE", f"edges[{index}].{end}", message))

    if document.get("schemaVersion") != "2.0":
        return issues

    catalog = catalog or load_catalog()

    # -- nodes: code names, catalogue membership ----------------------------
    for index, code in _duplicates((i, n.get("codeName")) for i, n in enumerate(nodes)):
        message = f"{_show(code)} is used by another node"
        issues.append(IntegrityIssue("INT-DUPLICATE-CODENAME", f"nodes[{index}].codeName", message))
    for index, node in enumerate(nodes):
        role = node.get("type")
        if not catalog.is_role(role):
            canonical = catalog.canonical_for(role) if isinstance(role, str) else None
            hint = f"; use {canonical.describe()!r}" if canonical else ""
            issues.append(
                IntegrityIssue(
                    "INT-UNKNOWN-ROLE",
                    f"nodes[{index}].type",
                    f"{_show(role)} is not a role in component catalogue {catalog.version}{hint}",
                )
            )
        elif "variant" in node and node["variant"] not in catalog.variants_of(role):
            allowed = ", ".join(sorted(catalog.variants_of(role))) or "none"
            issues.append(
                IntegrityIssue(
                    "INT-UNKNOWN-VARIANT",
                    f"nodes[{index}].variant",
                    f"{_show(node['variant'])} is not a variant of {role} (allowed: {allowed})",
                )
            )

    issues.extend(_check_containment(nodes, node_ids, catalog.max_nesting_depth))
    issues.extend(_check_deployment(_as_dict(document.get("deployment")), node_ids))
    issues.extend(_check_decisions(_as_list(document.get("decisions")), node_ids))
    return issues


def _check_containment(nodes: list[dict[str, Any]], node_ids: set[Any], max_depth: int) -> list[IntegrityIssue]:
    issues: list[IntegrityIssue] = []
    index_of: dict[Any, int] = {}
    parent_of: dict[Any, Any] = {}
    for index, node in enumerate(nodes):
        node_id = node.get("id")
        if node_id in index_of:
            continue  # a duplicate id is already reported; the first one wins
        index_of[node_id] = index
        if "parentId" in node:
            parent_of[node_id] = node["parentId"]
            if node["parentId"] not in node_ids:
                issues.append(
                    IntegrityIssue(
                        "INT-DANGLING-PARENT", f"nodes[{index}].parentId", f"{_show(node['parentId'])} is not a node id"
                    )
                )

    # depth[id]: 1 for a top-level node (or one whose parent is missing, which
    # is reported above); None for a node on, or nested below, a cycle.
    depth: dict[Any, int | None] = {}
    for start_id in index_of:
        path: list[Any] = []  # from start_id upwards, not yet resolved
        current = start_id
        while True:
            if current in depth:
                base = depth[current]
                break
            if current in path:  # walked back onto our own path: a loop
                loop_start = path.index(current)
                cycle = path[loop_start:]
                issues.append(_cycle_issue(cycle, index_of))
                for member in cycle:
                    depth[member] = None
                path = path[:loop_start]
                base = None
                break
            path.append(current)
            parent = parent_of.get(current)
            if parent is None or parent not in index_of:
                depth[current] = 1
                path.pop()
                base = 1
                break
            current = parent
        for item in reversed(path):  # resolve downwards from the known ancestor
            base = None if base is None else base + 1
            depth[item] = base

    for node_id in index_of:  # document order, not walk order: same as validate.ts
        level = depth[node_id]
        if level is not None and level == max_depth + 1:
            issues.append(
                IntegrityIssue(
                    "INT-DEPTH",
                    f"nodes[{index_of[node_id]}].parentId",
                    f"{_show(node_id)} is nested {level} levels deep; the limit is {max_depth}",
                )
            )
    return issues


def _cycle_issue(cycle: list[Any], index_of: Mapping[Any, int]) -> IntegrityIssue:
    """Report a loop once, anchored at its member that comes first in the
    document, so the message is the same whichever node the walk started from."""
    first = min(cycle, key=index_of.__getitem__)
    start = cycle.index(first)
    loop = [*cycle[start:], *cycle[:start], first]
    return IntegrityIssue(
        "INT-PARENT-CYCLE",
        f"nodes[{index_of[first]}].parentId",
        "containment loop " + " -> ".join(str(item) for item in loop),
    )


def _check_deployment(deployment: dict[str, Any], node_ids: set[Any]) -> list[IntegrityIssue]:
    if not deployment:
        return []
    issues: list[IntegrityIssue] = []
    profiles = [p for p in _as_list(deployment.get("profiles")) if isinstance(p, dict)]
    scenarios = [s for s in _as_list(deployment.get("scenarios")) if isinstance(s, dict)]
    bindings = [b for b in _as_list(deployment.get("bindings")) if isinstance(b, dict)]

    for index, profile_id in _duplicates((i, p.get("id")) for i, p in enumerate(profiles)):
        message = f"{_show(profile_id)} is used twice"
        issues.append(IntegrityIssue("INT-DUPLICATE-PROFILE-ID", f"deployment.profiles[{index}].id", message))
    for index, scenario_id in _duplicates((i, s.get("id")) for i, s in enumerate(scenarios)):
        issues.append(
            IntegrityIssue(
                "INT-DUPLICATE-SCENARIO-ID", f"deployment.scenarios[{index}].id", f"{_show(scenario_id)} is used twice"
            )
        )
    profile_ids = {p.get("id") for p in profiles}
    scenario_ids = {s.get("id") for s in scenarios}

    for s_index, scenario in enumerate(scenarios):
        where = f"deployment.scenarios[{s_index}]"
        if scenario.get("defaultProfileId") not in profile_ids:
            issues.append(
                IntegrityIssue(
                    "INT-UNKNOWN-PROFILE",
                    f"{where}.defaultProfileId",
                    f"{_show(scenario.get('defaultProfileId'))} is not a profile id",
                )
            )
        placements = [p for p in _as_list(scenario.get("placements")) if isinstance(p, dict)]
        for p_index, placement in enumerate(placements):
            if placement.get("nodeId") not in node_ids:
                issues.append(
                    IntegrityIssue(
                        "INT-DANGLING-PLACEMENT",
                        f"{where}.placements[{p_index}].nodeId",
                        f"{_show(placement.get('nodeId'))} is not a node id",
                    )
                )
            if placement.get("profileId") not in profile_ids:
                issues.append(
                    IntegrityIssue(
                        "INT-UNKNOWN-PROFILE",
                        f"{where}.placements[{p_index}].profileId",
                        f"{_show(placement.get('profileId'))} is not a profile id",
                    )
                )
        for p_index, node_id in _duplicates((i, p.get("nodeId")) for i, p in enumerate(placements)):
            issues.append(
                IntegrityIssue(
                    "INT-DUPLICATE-PLACEMENT",
                    f"{where}.placements[{p_index}].nodeId",
                    f"{_show(node_id)} is placed twice in this scenario",
                )
            )

    if "activeScenarioId" in deployment and deployment["activeScenarioId"] not in scenario_ids:
        issues.append(
            IntegrityIssue(
                "INT-UNKNOWN-SCENARIO",
                "deployment.activeScenarioId",
                f"{_show(deployment['activeScenarioId'])} is not a scenario id",
            )
        )

    for index, binding in enumerate(bindings):
        if binding.get("nodeId") not in node_ids:
            issues.append(
                IntegrityIssue(
                    "INT-DANGLING-BINDING",
                    f"deployment.bindings[{index}].nodeId",
                    f"{_show(binding.get('nodeId'))} is not a node id",
                )
            )
    for index, key in _duplicates((i, (b.get("nodeId"), b.get("target"))) for i, b in enumerate(bindings)):
        node_id, target = key
        issues.append(
            IntegrityIssue(
                "INT-DUPLICATE-BINDING",
                f"deployment.bindings[{index}]",
                f"node {_show(node_id)} already has a binding for target {_show(target)}",
            )
        )
    return issues


def _check_decisions(decisions: list[Any], node_ids: set[Any]) -> list[IntegrityIssue]:
    records = [d for d in decisions if isinstance(d, dict)]
    issues: list[IntegrityIssue] = []
    for index, decision_id in _duplicates((i, d.get("id")) for i, d in enumerate(records)):
        issues.append(
            IntegrityIssue("INT-DUPLICATE-DECISION-ID", f"decisions[{index}].id", f"{_show(decision_id)} is used twice")
        )
    decision_ids = {d.get("id") for d in records}
    for index, record in enumerate(records):
        for l_index, node_id in enumerate(_as_list(record.get("linkedNodeIds"))):
            if node_id not in node_ids:
                issues.append(
                    IntegrityIssue(
                        "INT-DANGLING-DECISION-REF",
                        f"decisions[{index}].linkedNodeIds[{l_index}]",
                        f"{_show(node_id)} is not a node id",
                    )
                )
        if "supersedes" in record and record["supersedes"] not in decision_ids:
            issues.append(
                IntegrityIssue(
                    "INT-DANGLING-DECISION-REF",
                    f"decisions[{index}].supersedes",
                    f"{_show(record['supersedes'])} is not a decision id",
                )
            )
    return issues


def assert_integrity(document: Mapping[str, Any], catalog: Catalog | None = None) -> None:
    """Raise ``GraphIntegrityError`` unless ``document`` is integrity-clean."""
    issues = check_integrity(document, catalog)
    if issues:
        raise GraphIntegrityError(issues)
