"""WP-B query side: Vietnamese folding, VI->EN glossary, safe FTS5 query."""

from __future__ import annotations

import re

import pytest

from app.reference.glossary import GLOSSARY, phrase_count
from app.reference.search import build_fts_query, expand_query, make_snippet
from app.reference.textnorm import fold, tokens


@pytest.mark.parametrize(
    ("raw", "folded"),
    [
        ("Bộ Nhớ Đệm", "bo nho dem"),
        ("đặt xe", "dat xe"),
        ("ĐƯỜNG DẪN", "duong dan"),
        ("Thanh toán", "thanh toan"),
        ("cơ sở dữ liệu", "co so du lieu"),
        # Decomposed input (NFD, as some keyboards/OSes send it) folds the same.
        ("bọ nhớ đệm", "bo nho dem"),
        ("\uff35\uff32\uff2c", "url"),  # fullwidth "URL"
    ],
)
def test_fold_strips_vietnamese_diacritics(raw, folded):
    assert fold(raw) == folded


def test_tokens_are_ascii_alphanumerics_only():
    assert tokens('"); DROP TABLE x; -- NEAR(a b) * ^col:') == ["drop", "table", "x", "near", "a", "b", "col"]


def test_glossary_has_at_least_100_phrases_and_all_keys_are_folded():
    assert phrase_count() >= 100
    for key, terms in GLOSSARY.items():
        assert key == " ".join(tokens(key))
        assert terms and all(re.fullmatch(r"[a-z0-9]+(?: [a-z0-9]+)*", t) for t in terms)


@pytest.mark.parametrize(
    ("query", "expected_terms"),
    [
        ("rút gọn link", ["url shortener"]),
        ("link rút gọn", ["url shortener"]),
        ("bộ nhớ đệm", ["cache"]),
        ("bo nho dem", ["cache"]),  # typed without diacritics
        ("cân bằng tải", ["load balancer", "load balancing"]),
        ("hàng đợi", ["queue"]),
        ("cơ sở dữ liệu", ["database"]),
        ("thanh toán", ["payment"]),
        ("nhắn tin", ["messaging", "chat"]),
        ("trò chuyện", ["chat", "messaging"]),
        ("thông báo", ["notification"]),
        ("tìm kiếm", ["search"]),
        ("phân mảnh", ["sharding"]),
        ("sao lưu", ["backup"]),
        ("giới hạn tốc độ", ["rate limiting", "rate limiter"]),
        ("chuyển hướng", ["redirect"]),
        ("đặt xe", ["ride sharing", "ride hailing"]),
        ("phát video", ["video streaming"]),
        ("gợi ý", ["recommendation"]),
        ("đề xuất", ["recommendation"]),
    ],
)
def test_required_glossary_entries(query, expected_terms):
    assert expand_query(query).terms == expected_terms


def test_longest_phrase_wins_and_stopwords_are_dropped():
    expanded = expand_query("bộ nhớ đệm cho chuyển hướng link rút gọn")
    assert expanded.terms == ["cache", "redirect", "url shortener"]
    assert expanded.display == 'cache redirect "url shortener"'
    # "cơ sở dữ liệu quan hệ" is longer than "cơ sở dữ liệu".
    assert expand_query("cơ sở dữ liệu quan hệ").terms == ["relational database", "sql"]


def test_english_words_pass_through_as_a_phrase():
    assert expand_query("URL Shortener").terms == ["url shortener"]
    assert expand_query("the rate limiting of an API").terms == ["rate limiting", "api"]


def test_mixed_language_query():
    assert expand_query("thiết kế hệ thống chat với Kafka").terms == ["system design", "chat", "kafka"]


@pytest.mark.parametrize(
    "query",
    ['"); DROP TABLE x; --', "NEAR(a b)", "*", "a OR b", 'title:"x"', "^start", "(((", "\"unbalanced", "-x +y", "\x00\x01", "x" * 300],
)
def test_fts_query_contains_only_quoted_safe_tokens(query):
    fts = build_fts_query(expand_query(query))
    if fts:
        for part in fts.split(" OR "):
            assert re.fullmatch(r'"[a-z0-9]+(?: [a-z0-9]+)*"', part), part


def test_operators_typed_by_users_are_just_words():
    assert build_fts_query(expand_query("cache AND queue")) == '"cache" OR "queue"'
    assert build_fts_query(expand_query("*")) == ""


def test_snippet_is_plain_bounded_and_centred_on_the_match():
    text = ("lorem ipsum " * 60) + "the Redis cache stores short codes " + ("dolor sit " * 60)
    snippet = make_snippet(text, ["cache"])
    assert len(snippet) <= 300
    assert "Redis cache" in snippet
    assert snippet.startswith("…") and snippet.endswith("…")
    assert make_snippet("short text", ["x"]) == "short text"
    assert len(make_snippet("x" * 1000, ["y"])) <= 300
