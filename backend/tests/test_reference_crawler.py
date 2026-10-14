"""WP-B crawler (KH-P1-01/02/05): robots, politeness, resume, fallback.

No network: a fake transport serves the saved fixtures and records every URL.
"""

from __future__ import annotations

import gzip
import itertools

import pytest
from test_reference_helpers import GALLERY_HTML, share_html

from app.reference import crawler
from app.reference.crawler import CrawlAborted, FetchError, PoliteFetcher, crawl, read_snapshot, write_snapshot
from app.reference.robots import RobotsPolicy

# The live file on 2026-10-14 (first group), verbatim.
SYSDESAI_ROBOTS = """User-Agent: *
Allow: /
Disallow: /design/
Disallow: /designs
Disallow: /feed
Disallow: /notifications
Disallow: /settings/

User-Agent: GPTBot
Allow: /
Disallow: /design/
"""
BASE = "https://www.sysdesai.com"
UA = crawler.USER_AGENT


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class FakeSite:
    """Serves robots, 2 gallery pages (featured p1 = real fixture), sitemap, share pages."""

    def __init__(self, robots: str = SYSDESAI_ROBOTS) -> None:
        self.robots = robots
        self.requests: list[tuple[float, str]] = []
        self.clock = FakeClock()
        self.share_status: dict[str, list[int]] = {}
        self.sitemap_ids = ["ExMwREO", "2OaL7Jv", "SiteOnly1"]

    def transport(self, url, headers, timeout):
        assert headers["User-Agent"] == UA
        assert timeout == 30.0
        self.requests.append((self.clock.now, url))
        if url == f"{BASE}/robots.txt":
            return 200, {}, self.robots.encode()
        if url.startswith(f"{BASE}/gallery?tab=featured&sort=newest&page=1"):
            return 200, {}, GALLERY_HTML.read_bytes()
        if url.startswith(f"{BASE}/gallery?"):
            return 200, {}, b"<html><body>no designs</body></html>"
        if url == f"{BASE}/sitemap.xml":
            body = "".join(f"<url><loc>{BASE}/share/{i}</loc></url>" for i in self.sitemap_ids)
            return 200, {"content-encoding": "gzip"}, gzip.compress(f"<urlset>{body}</urlset>".encode())
        if url.startswith(f"{BASE}/share/"):
            share_id = url.rsplit("/", 1)[1]
            statuses = self.share_status.get(share_id)
            if statuses:
                status = statuses.pop(0)
                if status != 200:
                    return status, {}, b""
            return 200, {}, share_html().encode()
        return 404, {}, b""

    def fetcher(self, delay: float = 3.0) -> PoliteFetcher:
        return PoliteFetcher(delay=delay, transport=self.transport, sleep=self.clock.sleep, clock=self.clock.clock)

    def urls(self) -> list[str]:
        return [url for _, url in self.requests]


# --------------------------------------------------------------------------
# robots.txt
# --------------------------------------------------------------------------


def test_stdlib_robotparser_alone_would_allow_the_private_pages():
    """Why robots.py exists: first-match semantics + "Allow: /" first."""
    import urllib.robotparser

    stdlib = urllib.robotparser.RobotFileParser()
    stdlib.parse(SYSDESAI_ROBOTS.splitlines())
    assert stdlib.can_fetch(UA, f"{BASE}/design/abc") is True  # the quirk


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        ("/share/ExMwREO", True),
        ("/gallery?tab=featured&sort=newest&page=2", True),
        ("/sitemap.xml", True),
        ("/design/abc", False),
        ("/designs", False),
        ("/designs/x", False),
        ("/feed", False),
        ("/notifications", False),
        ("/settings/profile", False),
    ],
)
def test_policy_uses_longest_match(path, allowed):
    assert RobotsPolicy(SYSDESAI_ROBOTS, UA).allowed(BASE + path) is allowed


def test_policy_respects_a_disallowed_share_section():
    policy = RobotsPolicy("User-agent: *\nDisallow: /share/\n", UA)
    assert not policy.allowed(f"{BASE}/share/ExMwREO")
    assert policy.allowed(f"{BASE}/gallery")


def test_a_group_naming_our_bot_takes_precedence():
    text = "User-agent: *\nAllow: /\n\nUser-agent: ArchPilot-ReferenceIndexer\nDisallow: /\n"
    assert not RobotsPolicy(text, UA).allowed(f"{BASE}/share/x")


def test_fetcher_refuses_disallowed_and_off_site_urls_without_requesting():
    site = FakeSite()
    fetcher = site.fetcher()
    fetcher.robots = RobotsPolicy(SYSDESAI_ROBOTS, UA)
    with pytest.raises(crawler.DisallowedError):
        fetcher.get(f"{BASE}/design/secret")
    with pytest.raises(crawler.DisallowedError):
        fetcher.get("https://evil.example/share/x")
    assert site.requests == []


# --------------------------------------------------------------------------
# Politeness
# --------------------------------------------------------------------------


def test_delay_below_one_second_is_rejected():
    with pytest.raises(ValueError):
        PoliteFetcher(delay=0.5)


def test_requests_are_spaced_by_at_least_the_delay():
    site = FakeSite()
    fetcher = site.fetcher(delay=3.0)
    for _ in range(4):
        fetcher.get(f"{BASE}/share/ExMwREO")
    starts = [t for t, _ in site.requests]
    assert all(b - a >= 3.0 for a, b in itertools.pairwise(starts))


def test_429_and_5xx_are_retried_with_exponential_backoff():
    site = FakeSite()
    site.share_status["ExMwREO"] = [429, 503, 200]
    fetcher = site.fetcher(delay=2.0)
    response = fetcher.get(f"{BASE}/share/ExMwREO")
    assert response.status == 200
    assert len(site.requests) == 3
    assert site.clock.sleeps[:1] == [4.0]  # 2 * 2**1 after the first failure
    assert 8.0 in site.clock.sleeps  # 2 * 2**2 after the second


def test_gives_up_after_three_retries():
    site = FakeSite()
    site.share_status["ExMwREO"] = [500, 500, 500, 500, 500]
    with pytest.raises(FetchError):
        site.fetcher().get(f"{BASE}/share/ExMwREO")
    assert len(site.requests) == 4  # 1 try + 3 retries


def test_retry_after_header_is_honoured():
    calls = []

    def transport(url, headers, timeout):
        calls.append(url)
        return (429, {"retry-after": "30"}, b"") if len(calls) == 1 else (200, {}, b"ok")

    clock = FakeClock()
    fetcher = PoliteFetcher(delay=1.0, transport=transport, sleep=clock.sleep, clock=clock.clock)
    assert fetcher.get(f"{BASE}/share/x1x").body == "ok"
    assert 30.0 in clock.sleeps


def test_404_is_an_answer_not_an_error():
    site = FakeSite()
    site.share_status["GoneOne"] = [404]
    assert site.fetcher().get(f"{BASE}/share/GoneOne").status == 404
    assert len(site.requests) == 1


# --------------------------------------------------------------------------
# Crawl orchestration
# --------------------------------------------------------------------------


def test_full_flow_gallery_then_sitemap_then_designs(tmp_path):
    site = FakeSite()
    out = tmp_path / "snap.jsonl.gz"
    report = crawl(out, limit=3, fetcher=site.fetcher(), now=lambda: "2026-10-14T08:00:00+00:00")
    urls = site.urls()
    assert urls[0] == f"{BASE}/robots.txt"
    gallery = [u for u in urls if "/gallery?" in u]
    assert gallery[0] == f"{BASE}/gallery?tab=featured&sort=newest&page=1"
    assert {u.split("tab=")[1].split("&")[0] for u in gallery} == {"featured", "real-world", "community"}
    sitemap_index = urls.index(f"{BASE}/sitemap.xml")
    assert all(urls.index(u) < sitemap_index for u in gallery)
    shares = [u for u in urls if "/share/" in u]
    assert len(shares) == 3 and all(urls.index(u) > sitemap_index for u in shares)
    # Gallery (featured first) order, then sitemap-only ids.
    assert shares[0].endswith("/share/2OaL7Jv")
    assert report.fetched == 3 and report.gallery_designs == 12 and report.sitemap_ids == 3

    records = read_snapshot(out)
    assert len(records) == 3
    record = records["2OaL7Jv"]
    assert record["url"] == f"{BASE}/share/2OaL7Jv"
    assert record["tab"] == "featured" and record["categories"] == ["Search & Discovery"]
    assert record["upvoteCount"] == 1073 and record["status"] == "active"
    assert record["fetchedAt"] == "2026-10-14T08:00:00+00:00" and len(record["contentHash"]) == 64
    assert record["steps"][7]["title"] == "Add Cache Layer for Redirects"  # (fixture page served for every id)
    assert set(record["steps"][0]) == {"position", "stepKey", "phase", "title", "text"}
    flat = out.read_bytes()
    assert b"authorName" not in gzip.decompress(flat) and b"Redacted Author" not in gzip.decompress(flat)
    assert not any("/design/" in u for u in urls)


def test_resume_skips_designs_already_in_the_snapshot(tmp_path):
    out = tmp_path / "snap.jsonl.gz"
    crawl(out, limit=2, fetcher=FakeSite().fetcher(), skip_gallery=True)
    assert len(read_snapshot(out)) == 2
    site = FakeSite()
    report = crawl(out, fetcher=site.fetcher(), skip_gallery=True)
    assert report.skipped_existing == 2 and report.fetched == 1
    assert len([u for u in site.urls() if "/share/" in u]) == 1
    assert len(read_snapshot(out)) == 3
    # --refresh fetches everything again.
    site = FakeSite()
    report = crawl(out, fetcher=site.fetcher(), skip_gallery=True, refresh=True)
    assert report.fetched == 3 and report.skipped_existing == 0


def test_only_fetches_just_those_ids_and_validates_them(tmp_path):
    site = FakeSite()
    out = tmp_path / "snap.jsonl.gz"
    crawl(out, only=["ExMwREO"], skip_gallery=True, fetcher=site.fetcher())
    assert [u for u in site.urls() if "/share/" in u] == [f"{BASE}/share/ExMwREO"]
    assert f"{BASE}/sitemap.xml" not in site.urls()
    with pytest.raises(ValueError):
        crawl(out, only=["../design/x"], skip_gallery=True, fetcher=FakeSite().fetcher())


def test_robots_disallowing_share_aborts_and_leaves_the_snapshot_untouched(tmp_path):
    out = tmp_path / "snap.jsonl.gz"
    crawl(out, limit=1, skip_gallery=True, fetcher=FakeSite().fetcher())
    before = out.read_bytes()
    site = FakeSite(robots="User-agent: *\nDisallow: /share/\n")
    with pytest.raises(CrawlAborted):
        crawl(out, refresh=True, fetcher=site.fetcher())
    assert out.read_bytes() == before
    assert site.urls() == [f"{BASE}/robots.txt"]


def test_unreachable_robots_txt_means_no_crawl(tmp_path):
    def transport(url, headers, timeout):
        return 503, {}, b""

    clock = FakeClock()
    fetcher = PoliteFetcher(delay=1.0, transport=transport, sleep=clock.sleep, clock=clock.clock)
    with pytest.raises(CrawlAborted):
        crawl(tmp_path / "s.jsonl.gz", fetcher=fetcher)
    assert not (tmp_path / "s.jsonl.gz").exists()


def test_schema_change_keeps_the_previous_good_steps(tmp_path):
    """AC-06: fallback text never overwrites good structured steps."""
    out = tmp_path / "snap.jsonl.gz"
    crawl(out, only=["ExMwREO"], skip_gallery=True, fetcher=FakeSite().fetcher())
    good = read_snapshot(out)["ExMwREO"]
    assert len(good["steps"]) == 15

    site = FakeSite()
    broken = share_html().replace('\\"steps\\":[', '\\"stepz\\":[')
    site.transport_original = site.transport

    def transport(url, headers, timeout):
        if "/share/" in url:
            site.requests.append((site.clock.now, url))
            return 200, {}, broken.encode()
        return site.transport_original(url, headers, timeout)

    fetcher = PoliteFetcher(delay=1.0, transport=transport, sleep=site.clock.sleep, clock=site.clock.clock)
    report = crawl(out, only=["ExMwREO"], skip_gallery=True, fetcher=fetcher)
    assert report.schema_warnings == 1
    record = read_snapshot(out)["ExMwREO"]
    assert record["schemaWarning"]
    assert record["steps"] == good["steps"]


def test_404_twice_marks_gone_with_a_miss_count(tmp_path):
    out = tmp_path / "snap.jsonl.gz"
    crawl(out, only=["ExMwREO"], skip_gallery=True, fetcher=FakeSite().fetcher())
    for expected in (1, 2):
        site = FakeSite()
        site.share_status["ExMwREO"] = [404]
        report = crawl(out, only=["ExMwREO"], skip_gallery=True, fetcher=site.fetcher())
        record = read_snapshot(out)["ExMwREO"]
        assert report.gone == 1
        assert record["status"] == "gone" and record["missCount"] == expected
        assert len(record["steps"]) == 15  # last good content kept until hidden by the loader


def test_snapshot_write_is_atomic_and_deterministic(tmp_path):
    out = tmp_path / "s.jsonl.gz"
    records = [{"shareId": "bbb", "steps": []}, {"shareId": "aaa", "steps": []}]
    write_snapshot(out, records)
    first = out.read_bytes()
    write_snapshot(out, list(reversed(records)))
    assert out.read_bytes() == first
    assert list(read_snapshot(out)) == ["aaa", "bbb"]
    assert [p.name for p in tmp_path.iterdir()] == ["s.jsonl.gz"]  # no temp file left behind


def test_a_damaged_snapshot_line_is_skipped(tmp_path):
    out = tmp_path / "s.jsonl.gz"
    with gzip.open(out, "wt", encoding="utf-8") as handle:
        handle.write('{"shareId":"good1","steps":[]}\nnot json\n{"shareId":"../bad"}\n')
    assert list(read_snapshot(out)) == ["good1"]
