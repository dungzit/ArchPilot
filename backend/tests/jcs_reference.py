"""Independent Python reference for ``src/domain/graph/hash.ts`` (review-v2-phase0).

RFC 8785 (JCS) with strings and keys NFC-normalised first - exactly the
canonical form ``canonicalJson()`` produces - plus SHA-256. Written from the
RFC, not from the TypeScript, so the shared vectors in
``contracts/differential/jcs.vectors.json`` are a real two-implementation
check. The server does not hash derivations today (design-v2 4.3.10 keeps that
client-side); if it ever must, this is the tested starting point.

The subtle part is numbers: ECMAScript Number::toString, not ``repr``
(``1e-07`` -> ``1e-7``, ``1e16`` -> ``10000000000000000``, ``-0`` -> ``0``).
Python integers are converted to the nearest double first, as JSON.parse does.

Regenerate the vectors (from ``backend/``): ``python -m tests.jcs_reference``.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import struct
import unicodedata
from pathlib import Path
from typing import Any

VECTORS_PATH = Path(__file__).resolve().parents[2] / "contracts" / "differential" / "jcs.vectors.json"


def es_number(value: float) -> str:
    """ECMAScript Number::toString for a finite double (RFC 8785 section 3.2.2.3)."""
    if not math.isfinite(value):
        raise ValueError(f"{value} has no JSON form")
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    mantissa, _, exponent = repr(abs(value)).partition("e")  # repr = shortest round-trip digits
    whole, _, fraction = mantissa.partition(".")
    raw = whole + fraction
    stripped = raw.lstrip("0")
    point = len(whole) + (int(exponent) if exponent else 0) - (len(raw) - len(stripped))
    digits = stripped.rstrip("0") or "0"
    k = len(digits)
    if k <= point <= 21:
        text = digits + "0" * (point - k)
    elif 0 < point <= 21:
        text = f"{digits[:point]}.{digits[point:]}"
    elif -6 < point <= 0:
        text = "0." + "0" * (-point) + digits
    else:
        e = point - 1
        text = digits[0] + (f".{digits[1:]}" if k > 1 else "") + ("e+" if e >= 0 else "e-") + str(abs(e))
    return sign + text


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return es_number(float(value))
    if isinstance(value, str):
        return json.dumps(unicodedata.normalize("NFC", value), ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        members: dict[str, Any] = {}
        for key, item in value.items():
            normal = unicodedata.normalize("NFC", key)
            if normal in members:
                raise ValueError(f"two keys normalise to {normal!r}")
            members[normal] = item
        ordered = sorted(members, key=lambda key: key.encode("utf-16-be"))  # UTF-16 code units
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical_json(members[k]) for k in ordered) + "}"
    raise TypeError(f"{type(value).__name__} has no JSON form")


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


# Non-ASCII built with chr() so no tool can normalise it out of this file.
_NFD_E = "e" + chr(0x301)
_VI_NFC = "".join(map(chr, [0x110, 0x1A1, 0x6E, 0x20, 0x68, 0xE0, 0x6E, 0x67]))  # "Don hang" with marks, NFC
_VI_NFD = unicodedata.normalize("NFD", _VI_NFC)
_ASTRAL, _PRIVATE, _EURO, _HANGUL_JAMO = chr(0x1F600), chr(0xE000), chr(0x20AC), chr(0x1100) + chr(0x1161) + chr(0x11A8)
_STRINGS = ["", "a", "B", chr(0xE9), _NFD_E, _VI_NFC, _VI_NFD, _ASTRAL, _PRIVATE, chr(0xFFFF), _EURO, 'q"q', "b\\s",
            "\n\t\x00\x1f\x7f", chr(0x2028) + chr(0x2029), chr(0x212B), chr(0xC5), _HANGUL_JAMO]

CURATED: list[Any] = [
    None, True, False, 0, -0.0, 1, 1.0, -1, 0.1, 0.5, 1e21, 1e20, 1e-6, 1e-7, 5e-324, 1.7976931348623157e308,
    2**53, 2**53 + 1, 1e16, 123456789012345680000, 12345678901234567890123, 0.30000000000000004,
    "", _VI_NFD, {"b": 1, "a": 2, "B": 3, chr(0xE1): 4, _EURO: 5, _ASTRAL: 6, chr(0xFFFF): 7},
    {_VI_NFD: _VI_NFD, "k": [3, {"z": 1, "y": None}]}, [[], {}, [{}]], {"n": [-0.0, 0.0, 100, 1e2]},
]


def _random_number(rng: random.Random) -> float | int:
    kind = rng.randrange(6)
    if kind == 0:
        return rng.randint(-(10**25), 10**25)
    if kind == 1:
        while True:
            value = struct.unpack("<d", struct.pack("<Q", rng.getrandbits(64)))[0]
            if math.isfinite(value):
                return value
    if kind == 2:
        return rng.random() * 10 ** rng.randint(-30, 30)
    if kind == 3:
        return round(rng.uniform(-100, 100), rng.randint(0, 6))
    if kind == 4:
        return float(rng.randint(0, 10**22))
    return rng.randint(-1000, 1000)


def _random_value(rng: random.Random, depth: int = 0) -> Any:
    kind = rng.randrange(6 if depth < 3 else 3)
    if kind == 0:
        return _random_number(rng)
    if kind == 1:
        return rng.choice(_STRINGS) + rng.choice(_STRINGS)
    if kind == 2:
        return rng.choice([True, False, None, _random_number(rng)])
    if kind == 3:
        return [_random_value(rng, depth + 1) for _ in range(rng.randint(0, 4))]
    members: dict[str, Any] = {}
    for _ in range(rng.randint(0, 5)):
        key = rng.choice(_STRINGS) + rng.choice(["", "x", "1", "A"])
        if unicodedata.normalize("NFC", key) not in {unicodedata.normalize("NFC", k) for k in members}:
            members[key] = _random_value(rng, depth + 1)
    return members


def build_vectors(seed: int = 8785, count: int = 120) -> dict[str, Any]:
    rng = random.Random(seed)  # noqa: S311 - reproducible test data, not security
    values = CURATED + [_random_value(rng) for _ in range(count)]
    # Stored as JSON TEXT: both suites parse it, so big integers become the same doubles on both sides.
    text = json.dumps(values, ensure_ascii=False)
    parsed = json.loads(text)
    return {
        "description": "RFC 8785 + NFC vectors; see backend/tests/jcs_reference.py. Generated; do not edit by hand.",
        "valuesJson": text,
        "expected": [{"canonical": canonical_json(v), "sha256": content_hash(v)} for v in parsed],
    }


if __name__ == "__main__":
    VECTORS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VECTORS_PATH.write_text(json.dumps(build_vectors(), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {VECTORS_PATH}")
