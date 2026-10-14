"""Seeded generator for the L1 integrity differential corpus (review-v2-phase0).

``app/graph_integrity.py`` and ``src/domain/graph/validate.ts`` are two
hand-written implementations of the same 19 ``INT-*`` rules. The shared
fixtures pin one example per rule; this corpus pins a few hundred random,
contract-valid documents - duplicate and dangling ids, cycles, deep chains,
aliases, prototype-looking ids (``constructor``), and ids with quotes, control
characters, NFD and astral characters - together with the exact
``[code, path, message]`` list Python produces for each. Both suites assert
their implementation reproduces that list exactly:

* ``backend/tests/test_integrity_differential.py``
* ``src/domain/graph/integrity.differential.test.ts``

Regenerate after an intentional rule or message change (from ``backend/``)::

    python -m tests.integrity_corpus

then make the TypeScript side agree. The review ran the same generator over
13,000 documents (seeds 1, 7, 42) with zero disagreements.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from app.catalog import load_catalog
from app.contract import ContractViolationError, validate_archgraph
from app.graph_integrity import check_integrity

CORPUS_PATH = Path(__file__).resolve().parents[2] / "contracts" / "differential" / "integrity.corpus.json"
SEED = 20260924
COUNT = 120

PLAIN_IDS = ["a", "b", "c", "d", "e", "n1", "n2"]
# Ids are free strings (contract `id`: 1-64 chars, no pattern). These make the
# two `repr()` implementations disagree if either one is wrong.
# Non-ASCII characters are built with chr() so no editor or tool can silently
# normalise or strip them from this file.
_E_ACUTE, _COMBINING_ACUTE, _D_STROKE, _O_HORN, _A_GRAVE = chr(0xE9), chr(0x301), chr(0x110), chr(0x1A1), chr(0xE0)
_ZWSP, _NBSP, _LINE_SEP, _GRINNING = chr(0x200B), chr(0xA0), chr(0x2028), chr(0x1F600)
NASTY_IDS = [
    "o'brien", 'say "hi"', "both'\"q", "back\\slash", "tab\there", "nl\nx", "nul\x00x", "del\x7f",
    f"zw{_ZWSP}j", f"caf{_E_ACUTE}", f"cafe{_COMBINING_ACUTE}", f"{_D_STROKE}{_O_HORN}n h{_A_GRAVE}ng",
    f"emoji{_GRINNING}", _GRINNING * 40, "x" * 64, _E_ACUTE * 64, f"{_LINE_SEP}ls", f"nbsp{_NBSP}x",
    "ctl\x1b[31m", "__proto__", "constructor", "toString", "hasOwnProperty",
]
EXTRA_ROLE_NAMES = ["quantum_router", "constructor", "tostring", "valueof", "proto"]
PROFILE_IDS = ["p1", "p2", "onprem", "constructor", "x"]
SCENARIO_IDS = ["s1", "s2", "o'x", "constructor"]
TARGETS = ["aws", "vsphere", "bare_metal", "k8s"]


def _pick_id(rng: random.Random, nasty: float) -> str:
    return rng.choice(NASTY_IDS) if rng.random() < nasty else rng.choice(PLAIN_IDS)


def _v1(rng: random.Random, legacy_types: list[str]) -> dict[str, Any]:
    nodes = [
        {"id": _pick_id(rng, 0.3), "type": rng.choice(legacy_types), "label": "L", "position": {"x": rng.randint(-5, 5), "y": 0}}
        for _ in range(rng.randint(0, 8))
    ]
    edges = [
        {"id": _pick_id(rng, 0.2), "source": _pick_id(rng, 0.3), "target": _pick_id(rng, 0.3), "label": "", "direction": "forward"}
        for _ in range(rng.randint(0, 8))
    ]
    return {"schemaVersion": "1.0", "nodes": nodes, "edges": edges}


def _v2(rng: random.Random, roles: list[str], role_names: list[str]) -> dict[str, Any]:
    catalog = load_catalog()
    nasty = rng.choice([0.0, 0.2, 0.5])
    nodes: list[dict[str, Any]] = []
    for i in range(rng.randint(0, 12)):
        role = rng.choice(role_names) if rng.random() < 0.25 else rng.choice(roles)
        node: dict[str, Any] = {
            "id": _pick_id(rng, nasty),
            "type": role,
            "label": f"L{i}",
            "codeName": rng.choice(["svc", "db", "web", f"c{i}"]),
            "position": {"x": 0, "y": 0},
        }
        if rng.random() < 0.3:
            variants = sorted(catalog.variants_of(role)) if catalog.is_role(role) else []
            node["variant"] = rng.choice([*variants, "bogus", "network", "worker"])
        if rng.random() < 0.6:
            node["parentId"] = _pick_id(rng, nasty)
        nodes.append(node)
    if rng.random() < 0.15:  # a long chain (INT-DEPTH), sometimes closed into a loop
        chain = [f"k{j}" for j in range(rng.randint(5, 10))]
        for j, chain_id in enumerate(chain):
            link: dict[str, Any] = {"id": chain_id, "type": "network_segment", "label": "k", "codeName": f"k{j}", "position": {"x": 0, "y": 0}}
            if j:
                link["parentId"] = chain[j - 1]
            nodes.append(link)
        if rng.random() < 0.5:
            nodes[-len(chain)]["parentId"] = chain[-1]
    rng.shuffle(nodes)
    edges = [
        {"id": _pick_id(rng, nasty), "source": _pick_id(rng, nasty), "target": _pick_id(rng, nasty), "label": "", "direction": "forward", "kind": "flow"}
        for _ in range(rng.randint(0, 8))
    ]
    document: dict[str, Any] = {"schemaVersion": "2.0", "settings": {"codeName": "d", "environment": "dev"}, "nodes": nodes, "edges": edges}
    if rng.random() < 0.6:
        deployment: dict[str, Any] = {
            "profiles": [{"id": rng.choice(PROFILE_IDS), "target": rng.choice(TARGETS), "label": "p"} for _ in range(rng.randint(0, 4))],
            "scenarios": [],
        }
        for _ in range(rng.randint(0, 3)):
            scenario: dict[str, Any] = {"id": rng.choice(SCENARIO_IDS), "label": "s", "defaultProfileId": rng.choice(PROFILE_IDS)}
            if rng.random() < 0.7:
                scenario["placements"] = [
                    {"nodeId": _pick_id(rng, nasty), "profileId": rng.choice(PROFILE_IDS)} for _ in range(rng.randint(0, 5))
                ]
            deployment["scenarios"].append(scenario)
        if rng.random() < 0.7:
            deployment["bindings"] = [
                {"nodeId": _pick_id(rng, nasty), "target": rng.choice(TARGETS), "realisation": "t.r"} for _ in range(rng.randint(0, 6))
            ]
        if rng.random() < 0.5:
            deployment["activeScenarioId"] = rng.choice(SCENARIO_IDS)
        document["deployment"] = deployment
    if rng.random() < 0.5:
        decisions = []
        for _ in range(rng.randint(0, 4)):
            decision: dict[str, Any] = {"id": rng.choice(["d1", "d2", "d3", "o'd"]), "number": 1, "title": "t", "status": "proposed"}
            if rng.random() < 0.7:
                decision["linkedNodeIds"] = [_pick_id(rng, nasty) for _ in range(rng.randint(0, 4))]
            if rng.random() < 0.4:
                decision["supersedes"] = rng.choice(["d1", "d2", "d9"])
            decisions.append(decision)
        document["decisions"] = decisions
    return document


def generate(seed: int = SEED, count: int = COUNT) -> list[dict[str, Any]]:
    """``count`` contract-valid documents; the same seed always gives the same list."""
    catalog = load_catalog()
    roles = sorted(catalog.roles)
    role_names = roles + sorted(catalog.aliases) + EXTRA_ROLE_NAMES
    legacy_types = sorted(catalog.legacy_types["1.0"])
    rng = random.Random(seed)  # noqa: S311 - reproducible test data, not security
    documents: list[dict[str, Any]] = []
    while len(documents) < count:
        document = _v1(rng, legacy_types) if rng.random() < 0.15 else _v2(rng, roles, role_names)
        try:
            validate_archgraph(document)
        except ContractViolationError:
            continue  # contract-valid by construction; skip the rare shape miss
        documents.append(document)
    return documents


def build_corpus(seed: int = SEED, count: int = COUNT) -> dict[str, Any]:
    return {
        "description": "L1 integrity differential corpus - see backend/tests/integrity_corpus.py. Generated; do not edit by hand.",
        "seed": seed,
        "cases": [
            {"document": document, "expect": [[i.code, i.path, i.message] for i in check_integrity(document)]}
            for document in generate(seed, count)
        ],
    }


if __name__ == "__main__":
    CORPUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    corpus = build_corpus()
    CORPUS_PATH.write_text(json.dumps(corpus, ensure_ascii=False, indent=None, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(corpus['cases'])} cases to {CORPUS_PATH}")
