"""WP-B index + search on the fixture index (AC-02, AC-03, AC-07, safety)."""

from __future__ import annotations

import re

import pytest
from test_reference_helpers import fixture_records, load_fixture_index, write_fixture_snapshot

from app.reference.crawler import write_snapshot
from app.reference.index import autoload, load_snapshot, status
from app.reference.search import search


@pytest.fixture()
def index(migrated_db, tmp_path):
    load_fixture_index(migrated_db, tmp_path)
    return migrated_db


def ids(result) -> list[str]:
    return [item["share_id"] for item in result["items"]]


def test_ac02_url_shortener_top_hit_is_exmwreo(index):
    result = search(index, "URL shortener")
    assert ids(result)[0] == "ExMwREO"
    assert result["items"][0]["url"] == "https://www.sysdesai.com/share/ExMwREO"
    # The short community look-alike is found, but ranks below.
    assert "UrlCopy04" in ids(result)


def test_ac03_vietnamese_query_finds_the_cache_step(index):
    result = search(index, "bộ nhớ đệm cho chuyển hướng link rút gọn")
    assert result["expanded_query"] == 'cache redirect "url shortener"'
    assert "ExMwREO" in ids(result)[:3]
    hit = next(item for item in result["items"] if item["share_id"] == "ExMwREO")
    assert hit["steps"][0]["position"] == 8
    assert hit["steps"][0]["title"] == "Add Cache Layer for Redirects"
    assert hit["steps"][0]["phase"] == "build"
    assert "Redis" in hit["steps"][0]["snippet"]
    assert 12 in [step["position"] for step in hit["steps"]]  # Short URL Redirection Flow


def test_spec_example_query_without_diacritics(index):
    result = search(index, "cache cho chuyen huong link rut gon")
    assert ids(result)[0] == "ExMwREO"
    assert result["items"][0]["steps"][0]["position"] == 8


def test_result_shape_and_bounds(index):
    result = search(index, "cache")
    assert result["total"] == len(result["items"]) >= 2
    for item in result["items"]:
        assert 1 <= len(item["steps"]) <= 3
        for step in item["steps"]:
            assert step["position"] >= 1
            assert len(step["snippet"]) <= 300 and not re.search(r"<[a-zA-Z/!]", step["snippet"])
    top = result["items"][0]
    assert set(top) >= {"share_id", "url", "title", "prompt", "categories", "tab", "upvote_count", "score", "steps"}


@pytest.mark.parametrize(
    "query",
    ['"); DROP TABLE x; --', "NEAR(a b)", "*", "a OR", 'title:"cache"', "^redis", "((", '"', "\x00", "x" * 300],
)
def test_fts_injection_attempts_are_inert(index, query):
    result = search(index, query)
    assert isinstance(result["items"], list)
    # The index is still intact afterwards.
    assert index.execute("SELECT COUNT(*) FROM reference_designs").fetchone()[0] == 8
    assert ids(search(index, "URL shortener"))[0] == "ExMwREO"


def test_empty_and_stopword_queries_return_nothing(index):
    for query in ("", "   ", "the of and", "cho và của"):
        result = search(index, query)
        assert result["items"] == [] and result["total"] == 0


def test_phase_filter(index):
    result = search(index, "cache redirect", phase="flows")
    assert result["items"]
    for item in result["items"]:
        assert {step["phase"] for step in item["steps"]} == {"flows"}
    assert search(index, "cache", phase="DROP TABLE")["items"] == []
    assert search(index, "cache", phase="nonexistent")["items"] == []


def test_category_filter(index):
    result = search(index, "cache", category="storage & cdn")
    assert ids(result) == ["DistCache01"]
    assert search(index, "cache", category="No Such Category")["items"] == []


def test_hidden_designs_are_never_returned(index):
    """AC-07: GoneTwice07 (404 twice) is stuffed with the query words."""
    for query in ("URL shortener cache layer for redirects", "deleted clone"):
        assert "GoneTwice07" not in ids(search(index, query))
    row = index.execute("SELECT status FROM reference_designs WHERE share_id = 'GoneTwice07'").fetchone()
    assert row["status"] == "hidden"


def test_article_designs_keep_the_blog_link_and_unsafe_urls_are_dropped(index):
    stripe = search(index, "idempotency payment")["items"][0]
    assert stripe["share_id"] == "StripePay05"
    assert stripe["design_source"] == "article" and stripe["tab"] == "real-world"
    assert stripe["source_blog_name"] == "Stripe Engineering"
    assert stripe["source_article_url"] == "https://stripe.com/blog/idempotency"
    evil = next(item for item in search(index, "notification")["items"] if item["share_id"] == "EvilUrl06")
    assert evil["source_article_url"] is None


def test_limit_is_clamped(index):
    assert len(search(index, "cache", limit=1)["items"]) == 1
    assert len(search(index, "cache", limit=0)["items"]) == 1
    assert len(search(index, "cache", limit=10_000)["items"]) <= 50


def test_status_counts_only_visible_designs(index):
    current = status(index)
    assert current["indexed_designs"] == 7
    assert current["indexed_steps"] == 15 + 4 + 4 + 3 + 3 + 2 + 1
    assert current["last_crawl_at"] == "2026-10-14T08:00:00+00:00"


def test_reload_is_skipped_when_the_snapshot_is_unchanged(index, tmp_path):
    snapshot = tmp_path / "fixture-snapshot.jsonl.gz"
    assert load_snapshot(index, snapshot).reason == "snapshot unchanged"
    assert load_snapshot(index, snapshot, force=True).loaded


def test_reload_replaces_the_index_completely(index, tmp_path):
    only_one = [r for r in fixture_records() if r["shareId"] == "RateLim02"]
    snapshot = tmp_path / "smaller.jsonl.gz"
    write_snapshot(snapshot, only_one)
    report = load_snapshot(index, snapshot)
    assert report.loaded and report.designs == 1
    assert ids(search(index, "URL shortener")) == []
    assert ids(search(index, "rate limiting")) == ["RateLim02"]


def test_autoload_never_raises(temp_settings, migrated_db, monkeypatch, tmp_path):
    monkeypatch.setattr(type(temp_settings), "reference_snapshot_path", property(lambda self: tmp_path / "missing.gz"))
    assert autoload(temp_settings) == {"loaded": False, "reason": "missing"}
    bad = tmp_path / "bad.gz"
    bad.write_bytes(b"not gzip at all")
    monkeypatch.setattr(type(temp_settings), "reference_snapshot_path", property(lambda self: bad))
    assert autoload(temp_settings) == {"loaded": False, "reason": "error"}
    good = write_fixture_snapshot(tmp_path / "good.jsonl.gz")
    monkeypatch.setattr(type(temp_settings), "reference_snapshot_path", property(lambda self: good))
    assert autoload(temp_settings)["loaded"] is True
    assert autoload(temp_settings)["reason"] == "snapshot unchanged"


def test_default_snapshot_path_is_next_to_the_database(temp_settings):
    expected = temp_settings.db_path.parent / "reference" / "sysdesai-snapshot.jsonl.gz"
    assert temp_settings.reference_snapshot_path == expected
