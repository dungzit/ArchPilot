"""Shared helpers for the WP-B reference tests (imported by test_reference_*.py).

The fixture index = ONE real SysDesAi page (URL Shortener, ExMwREO, saved once
on 2026-10-14 with author data scrubbed) + a handful of synthetic designs that
compete with it on purpose (a short look-alike "URL Shortener", a cache design,
a hidden design stuffed with the query words, a javascript: article URL).
"""

from __future__ import annotations

import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "reference"
SHARE_HTML = FIXTURES / "share-ExMwREO.html"
GALLERY_HTML = FIXTURES / "gallery-featured-p1.html"
SYNTHETIC = FIXTURES / "synthetic-designs.json"

EXMWREO_CARD = {
    "shareId": "ExMwREO",
    "title": "URL Shortener",
    "prompt": "Design a URL shortener like Bitly",
    "categories": ["Other"],
    "upvoteCount": 1148,
    "isFeatured": True,
    "designSource": "user",
    "sourceBlogName": None,
    "sourceArticleUrl": None,
    "createdAt": "2026-02-20T10:00:00.000Z",
    "updatedAt": "2026-09-23T10:00:00.000Z",
    "tab": "featured",
}


def share_html() -> str:
    return SHARE_HTML.read_text(encoding="utf-8")


def fixture_records() -> list[dict]:
    from app.reference.crawler import build_record

    real = build_record("ExMwREO", share_html(), EXMWREO_CARD, None, "2026-10-14T08:00:00+00:00")
    synthetic = json.loads(SYNTHETIC.read_text(encoding="utf-8"))
    for record in synthetic:
        record.setdefault("url", f"https://www.sysdesai.com/share/{record['shareId']}")
        record.setdefault("status", "active")
        record.setdefault("fetchedAt", "2026-10-13T08:00:00+00:00")
    return [real, *synthetic]


def write_fixture_snapshot(path: Path) -> Path:
    from app.reference.crawler import write_snapshot

    write_snapshot(path, fixture_records())
    return path


def load_fixture_index(conn, tmp_path: Path):
    from app.reference.index import load_snapshot

    snapshot = write_fixture_snapshot(tmp_path / "fixture-snapshot.jsonl.gz")
    report = load_snapshot(conn, snapshot)
    assert report.loaded, report.reason
    return report


def test_fixture_snapshot_round_trips(tmp_path):
    from app.reference.crawler import read_snapshot

    path = write_fixture_snapshot(tmp_path / "s.jsonl.gz")
    records = read_snapshot(path)
    assert "ExMwREO" in records and len(records) == 8
    # Deterministic bytes: same records -> same file -> same hash -> no reload.
    first = path.read_bytes()
    write_fixture_snapshot(path)
    assert path.read_bytes() == first
