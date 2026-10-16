"""WP-B parser (KH-P1-03) on two REAL SysDesAi pages saved as fixtures."""

from __future__ import annotations

import json

import pytest
from test_reference_helpers import GALLERY_HTML, share_html

from app.reference.parser import (
    MAX_STEP_CHARS,
    extract_rsc_payload,
    flatten_content,
    parse_gallery_page,
    parse_share_page,
    parse_sitemap,
    safe_http_url,
)


@pytest.fixture(scope="module")
def url_shortener():
    return parse_share_page(share_html(), "ExMwREO")


def test_url_shortener_has_15_steps_numbered_from_1(url_shortener):
    assert url_shortener.schema_warning is None
    assert url_shortener.title == "URL Shortener"
    assert url_shortener.prompt == "Design a URL shortener like Bitly"
    assert len(url_shortener.steps) == 15
    assert [s.position for s in url_shortener.steps] == list(range(1, 16))
    assert url_shortener.steps[0].phase == "clarify"  # the clarify step is Buoc 1


@pytest.mark.parametrize(
    ("position", "title", "phase"),
    [
        (8, "Add Cache Layer for Redirects", "build"),
        (12, "Short URL Redirection Flow", "flows"),
        (14, "Scaling and Failure Modes", "scale"),
        (15, "Design Summary", "wrap"),
    ],
)
def test_known_steps_match_what_sysdesai_shows(url_shortener, position, title, phase):
    step = url_shortener.steps[position - 1]
    assert (step.position, step.title, step.phase) == (position, title, phase)


def test_step_text_is_flattened_prose_first(url_shortener):
    cache_step = url_shortener.steps[7]
    assert cache_step.text.startswith("To meet the stringent 50ms redirect latency")
    assert "specifically Redis" in cache_step.text
    assert "Memcached" in cache_step.text  # tradeoff options are leaves too
    assert cache_step.step_key == "step-7"
    for step in url_shortener.steps:
        assert 0 < len(step.text) <= MAX_STEP_CHARS
        assert "  " not in step.text


def test_mermaid_diagram_is_kept_as_labels_only(url_shortener):
    text = url_shortener.steps[7].text
    assert "Cache (Redis)" in text and "Data Store (PostgreSQL)" in text
    assert "flowchart" not in text and "-->" not in text


def test_clarify_answers_equal_to_assumptions_are_not_duplicated(url_shortener):
    clarify = url_shortener.steps[0].text
    assert clarify.count("I'll assume a 100:1 read-to-write ratio") == 1


def test_design_source_is_read_from_the_page(url_shortener):
    assert url_shortener.design_source == "user"
    assert url_shortener.source_article_url is None


def test_gallery_page_yields_12_cards_without_personal_data():
    cards = parse_gallery_page(GALLERY_HTML.read_text(encoding="utf-8"))
    assert len(cards) == 12
    assert len({c["shareId"] for c in cards}) == 12
    first = cards[0]
    assert first["shareId"] == "2OaL7Jv" and first["title"] == "Web Crawler and Search Engine"
    assert first["categories"] == ["Search & Discovery"]
    assert first["isFeatured"] is True and first["upvoteCount"] == 1073
    for card in cards:
        assert not {"authorName", "authorImageUrl", "authorUsername", "commentCount", "shareCount"} & set(card)


def test_fixture_files_carry_no_author_identity():
    # The saved gallery page was scrubbed before commit (author data is personal data).
    html = GALLERY_HTML.read_text(encoding="utf-8")
    payload = extract_rsc_payload(html)
    for name in {obj.get("authorName") for obj in _objects(payload)}:
        assert name in (None, "Redacted Author")


def _objects(payload: str):
    decoder = json.JSONDecoder()
    index = payload.find('{"shareId":"')
    while index >= 0:
        obj, end = decoder.raw_decode(payload, index)
        yield obj
        index = payload.find('{"shareId":"', end)


def test_sitemap_keeps_only_share_ids_in_order():
    xml = """<?xml version="1.0"?><urlset>
      <url><loc>https://www.sysdesai.com/share/ExMwREO</loc></url>
      <url><loc>https://www.sysdesai.com/learn/caching</loc></url>
      <url><loc>https://www.sysdesai.com/share/2OaL7Jv</loc></url>
      <url><loc>https://www.sysdesai.com/share/ExMwREO</loc></url>
      <url><loc>https://www.sysdesai.com/design/private1</loc></url>
      <url><loc>https://evil.example/share/AAAAAAA</loc></url>
    </urlset>"""
    assert parse_sitemap(xml) == ["ExMwREO", "2OaL7Jv"]


def test_missing_steps_falls_back_to_visible_text_with_a_warning():
    html = share_html().replace('"steps":[', '"stepz":[').replace('\\"steps\\":[', '\\"stepz\\":[')
    parsed = parse_share_page(html, "ExMwREO")
    assert parsed.schema_warning
    assert len(parsed.steps) == 1
    assert parsed.steps[0].phase == "page" and parsed.steps[0].position == 1
    assert "URL Shortener" in parsed.title
    assert "<" not in parsed.steps[0].text


def test_garbage_html_does_not_raise():
    parsed = parse_share_page("<html><title>X | SysDesAi</title><body>hello</body></html>", "abcdef")
    assert parsed.title == "X" and parsed.schema_warning
    assert parsed.steps[0].text.endswith("hello")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://stripe.com/blog/idempotency", "https://stripe.com/blog/idempotency"),
        ("http://example.com/a", "http://example.com/a"),
        ("javascript:alert(1)", None),
        ("JaVaScRiPt:alert(1)", None),
        ("data:text/html,<script>", None),
        ("https://x.com/\"onmouseover=", None),
        (None, None),
        (42, None),
    ],
)
def test_only_http_urls_survive(value, expected):
    assert safe_http_url(value) == expected


def test_flatten_skips_machine_keys_and_non_strings():
    content = {"metrics": [{"label": "QPS", "value": "~115", "type": "number", "chosen": True, "n": 3}], "id": "x"}
    assert flatten_content(content) == "QPS · ~115"
