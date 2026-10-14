"""The Python JCS reference reproduces the shared vectors (review-v2-phase0).

``src/domain/graph/hash.vectors.test.ts`` checks ``canonicalJson()`` /
``contentHash()`` against the same file, so the two languages agree on the
canonical form byte for byte: key order by UTF-16 code units, NFC, and
ECMAScript number formatting.
"""

from __future__ import annotations

import json

import pytest

from tests.jcs_reference import VECTORS_PATH, build_vectors, canonical_json, content_hash, es_number

VECTORS = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))


def test_the_reference_reproduces_every_vector():
    values = json.loads(VECTORS["valuesJson"])
    assert len(values) == len(VECTORS["expected"])
    for value, expected in zip(values, VECTORS["expected"], strict=True):
        assert canonical_json(value) == expected["canonical"]
        assert content_hash(value) == expected["sha256"]


def test_the_committed_vectors_are_what_the_generator_produces():
    assert build_vectors() == VECTORS


@pytest.mark.parametrize(
    ("number", "text"),
    [(1e-7, "1e-7"), (1e16, "10000000000000000"), (1e21, "1e+21"), (-0.0, "0"), (0.1 + 0.2, "0.30000000000000004"),
     (5e-324, "5e-324"), (1e-6, "0.000001"), (2.5e25, "2.5e+25"), (2**53 + 1, "9007199254740992"), (100, "100")],
)
def test_numbers_use_the_ecmascript_form_not_python_repr(number, text):
    assert es_number(float(number)) == text


def test_the_golden_hash_pinned_by_the_typescript_suite():
    """hash.test.ts pins this value 'computed independently with Python hashlib'; now it is."""
    value = {"note": "".join(map(chr, [0x110, 0x1A1, 0x6E, 0x20, 0x68, 0xE0, 0x6E, 0x67])), "answers": {"readWriteRatio": 9, "peakRps": 1500}}
    assert content_hash(value) == "8c560a7dcab207e71a6dc43ceab8bea95224c5f30e3a77c7838e02a0d0ebfb42"
