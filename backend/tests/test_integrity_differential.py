"""Cross-language parity of the L1 integrity rules (review-v2-phase0, finding M1).

``contracts/differential/integrity.corpus.json`` holds random contract-valid
documents and the exact ``[code, path, message]`` list for each. This suite
proves Python still produces that list; ``src/domain/graph/
integrity.differential.test.ts`` proves TypeScript produces the same one. A rule,
path, order or message changed on one side only fails one of the two suites.
"""

from __future__ import annotations

import json

from app.contract import validate_archgraph
from app.graph_integrity import RULE_CODES, check_integrity
from tests.integrity_corpus import CORPUS_PATH, COUNT, SEED, generate

CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def test_python_reproduces_every_recorded_issue_list_exactly():
    mismatches = []
    for index, case in enumerate(CORPUS["cases"]):
        got = [[i.code, i.path, i.message] for i in check_integrity(case["document"])]
        if got != case["expect"]:
            mismatches.append((index, got, case["expect"]))
    assert not mismatches, f"{len(mismatches)} cases differ; first: {mismatches[0]}"


def test_the_corpus_covers_every_rule_and_is_contract_valid():
    seen = {code for case in CORPUS["cases"] for code, _, _ in case["expect"]}
    assert seen == set(RULE_CODES)
    for case in CORPUS["cases"]:
        validate_archgraph(case["document"])


def test_the_committed_corpus_is_what_the_generator_produces():
    """Nobody hand-edited the documents (the expectations are checked above)."""
    assert CORPUS["seed"] == SEED
    assert [case["document"] for case in CORPUS["cases"]] == generate(SEED, COUNT)
