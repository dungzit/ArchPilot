"""Polite SysDesAi crawler -> JSONL.gz snapshot (KH-P1-01/02/04/05).

Politeness is structural, not optional:

* robots.txt is fetched at the start of EVERY run; every URL is checked
  against it (``robots.RobotsPolicy``) before it is requested. If ``/share/``
  is disallowed the run stops and the existing snapshot is left untouched
  (AC-05: the index is "frozen" until a human decides).
* One connection, at least ``delay`` seconds between request STARTS
  (default 3.0, minimum 1.0), 30 s timeout, at most 3 retries with
  exponential backoff on 429/5xx/network errors, ``Retry-After`` honoured.
* Identifying User-Agent. Only ``/robots.txt``, ``/sitemap.xml``,
  ``/gallery?...`` and ``/share/{id}`` (id validated) are ever built.

Snapshot: one JSON design per line, gzip, sorted by shareId, written to a temp
file and atomically renamed (``os.replace``) every 25 designs and at the end,
so an interrupted 45-minute run resumes where it stopped.
"""

from __future__ import annotations

import email.utils
import gzip
import io
import json
import logging
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .parser import (
    BASE_URL,
    SHARE_ID_RE,
    content_hash,
    parse_gallery_page,
    parse_share_page,
    parse_sitemap,
    safe_http_url,
    share_url,
)
from .robots import RobotsPolicy

logger = logging.getLogger("app.reference.crawler")

USER_AGENT = "ArchPilot-ReferenceIndexer/0.1 (internal pilot)"
TABS = ("featured", "real-world", "community")
DEFAULT_DELAY = 3.0
MIN_DELAY = 1.0
TIMEOUT_SECONDS = 30.0
MAX_RETRIES = 3
MAX_RETRY_AFTER = 120.0
MAX_GALLERY_PAGES = 200  # hard stop: 3 tabs x 200 x 12 is far more than the site has
PROGRESS_EVERY = 25
MAX_BODY_BYTES = 5 * 1024 * 1024


class CrawlAborted(RuntimeError):
    """The run stopped before fetching designs; the snapshot was not touched."""


class DisallowedError(RuntimeError):
    """A URL the robots policy forbids. Never requested."""


class FetchError(RuntimeError):
    """No usable answer after the retries."""


@dataclass
class Response:
    status: int
    body: str
    headers: dict[str, str] = field(default_factory=dict)


# (url, headers, timeout) -> (status, headers, raw body bytes). Swapped in tests.
Transport = Callable[[str, dict[str, str], float], tuple[int, dict[str, str], bytes]]


def urllib_transport(url: str, headers: dict[str, str], timeout: float) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, headers=headers, method="GET")  # noqa: S310 - see below
    try:
        # S310: only https://www.sysdesai.com/... URLs reach here (PoliteFetcher.get checks the prefix).
        with urllib.request.urlopen(request, timeout=timeout) as resp:  # noqa: S310
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read(MAX_BODY_BYTES + 1)
    except urllib.error.HTTPError as exc:
        body = exc.read(64 * 1024) if exc.fp else b""
        return exc.code, {k.lower(): v for k, v in (exc.headers or {}).items()}, body


def _decode(raw: bytes, headers: dict[str, str]) -> str:
    if headers.get("content-encoding", "").lower() == "gzip" or raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    if len(raw) > MAX_BODY_BYTES:
        raise FetchError(f"response larger than {MAX_BODY_BYTES} bytes")
    return raw.decode("utf-8", errors="replace")


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0.0, (parsed - datetime.now(timezone.utc)).total_seconds())


class PoliteFetcher:
    """One connection, a minimum gap between requests, bounded retries."""

    def __init__(
        self,
        *,
        delay: float = DEFAULT_DELAY,
        transport: Transport = urllib_transport,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        user_agent: str = USER_AGENT,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        if delay < MIN_DELAY:
            raise ValueError(f"delay must be >= {MIN_DELAY} seconds")
        self.delay = delay
        self.transport = transport
        self.sleep = sleep
        self.clock = clock
        self.user_agent = user_agent
        self.max_retries = max_retries
        self.robots: RobotsPolicy | None = None
        self.requests_made = 0
        self._last_start: float | None = None

    def _throttle(self) -> None:
        if self._last_start is not None:
            wait = self._last_start + self.delay - self.clock()
            if wait > 0:
                self.sleep(wait)
        self._last_start = self.clock()

    def get(self, url: str) -> Response:
        if not url.startswith(BASE_URL + "/"):
            raise DisallowedError(f"refusing off-site URL {url}")
        if self.robots is not None and not self.robots.allowed(url):
            raise DisallowedError(f"robots.txt disallows {url}")
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xml;q=0.9,*/*;q=0.5",
            "Accept-Encoding": "gzip",
        }
        last_error = "no attempt made"
        for attempt in range(self.max_retries + 1):
            self._throttle()
            self.requests_made += 1
            try:
                status, resp_headers, raw = self.transport(url, headers, TIMEOUT_SECONDS)
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
                status, resp_headers, raw = 0, {}, b""
                last_error = f"{type(exc).__name__}: {exc}"
            if status == 200:
                return Response(200, _decode(raw, resp_headers), resp_headers)
            if status in (404, 410):
                return Response(status, "", resp_headers)
            retryable = status == 0 or status == 429 or status >= 500
            if status:
                last_error = f"HTTP {status}"
            if not retryable or attempt == self.max_retries:
                break
            backoff = self.delay * (2 ** (attempt + 1))
            retry_after = _retry_after_seconds(resp_headers.get("retry-after"))
            if retry_after is not None:
                backoff = max(backoff, min(retry_after, MAX_RETRY_AFTER))
            logger.warning("retrying %s after %s (attempt %d, waiting %.1fs)", url, last_error, attempt + 1, backoff)
            self.sleep(backoff)
        raise FetchError(f"{url}: {last_error}")


# ---------------------------------------------------------------------------
# Snapshot I/O
# ---------------------------------------------------------------------------


def read_snapshot(path: Path) -> dict[str, dict[str, Any]]:
    """shareId -> record. A damaged line is skipped (and logged), not fatal."""
    records: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return records
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("snapshot %s line %d is not JSON; skipped", path, number)
                continue
            share_id = record.get("shareId") if isinstance(record, dict) else None
            if isinstance(share_id, str) and SHARE_ID_RE.match(share_id):
                records[share_id] = record
    return records


def write_snapshot(path: Path, records: Iterable[dict[str, Any]]) -> None:
    """Deterministic (sorted, gzip mtime 0) and atomic (temp file + os.replace)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    ordered = sorted(records, key=lambda r: r["shareId"])
    with open(temp, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
        writer = io.TextIOWrapper(gz, encoding="utf-8", newline="\n")
        for record in ordered:
            writer.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            writer.write("\n")
        writer.flush()
        writer.detach()
    os.replace(temp, path)


# ---------------------------------------------------------------------------
# Crawl
# ---------------------------------------------------------------------------


@dataclass
class CrawlReport:
    gallery_pages: int = 0
    gallery_designs: int = 0
    sitemap_ids: int = 0
    targets: int = 0
    fetched: int = 0
    skipped_existing: int = 0
    gone: int = 0
    failed: int = 0
    schema_warnings: int = 0
    total_in_snapshot: int = 0
    requests: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"gallery pages={self.gallery_pages} gallery designs={self.gallery_designs} "
            f"sitemap ids={self.sitemap_ids} targets={self.targets} fetched={self.fetched} "
            f"skipped(existing)={self.skipped_existing} gone={self.gone} failed={self.failed} "
            f"schema warnings={self.schema_warnings} snapshot total={self.total_in_snapshot} "
            f"http requests={self.requests}"
        )


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_robots(fetcher: PoliteFetcher) -> RobotsPolicy:
    try:
        response = fetcher.get(f"{BASE_URL}/robots.txt")
    except FetchError as exc:
        # Unknown rules: be conservative and do not crawl at all.
        raise CrawlAborted(f"robots.txt unavailable ({exc}); not crawling") from exc
    if response.status in (404, 410):
        return RobotsPolicy.allow_all(fetcher.user_agent)
    return RobotsPolicy(response.body, fetcher.user_agent)


def _crawl_gallery(
    fetcher: PoliteFetcher, report: CrawlReport, max_pages: int | None
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    meta: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    cap = min(max_pages or MAX_GALLERY_PAGES, MAX_GALLERY_PAGES)
    for tab in TABS:
        for page in range(1, cap + 1):
            url = f"{BASE_URL}/gallery?tab={tab}&sort=newest&page={page}"
            try:
                response = fetcher.get(url)
            except (FetchError, DisallowedError) as exc:
                report.errors.append(str(exc))
                logger.warning("gallery %s page %d skipped: %s", tab, page, exc)
                break
            report.gallery_pages += 1
            if response.status != 200:
                break
            cards = parse_gallery_page(response.body)
            new = 0
            for card in cards:
                share_id = card["shareId"]
                if share_id in meta:
                    continue  # first tab wins: featured > real-world > community
                meta[share_id] = {**card, "tab": tab}
                order.append(share_id)
                new += 1
            if not cards or new == 0:
                break  # an empty page ends the tab; a repeated page is a loop guard
    report.gallery_designs = len(meta)
    return meta, order


def _needs_fetch(existing: dict[str, Any] | None, card: dict[str, Any] | None, refresh: bool) -> bool:
    if refresh or existing is None:
        return True
    if existing.get("status") != "active" or not existing.get("steps"):
        return True
    if card and card.get("updatedAt") and existing.get("updatedAt"):
        return str(card["updatedAt"]) > str(existing["updatedAt"])  # ISO-8601 sorts as text
    return False


def _apply_card(record: dict[str, Any], card: dict[str, Any] | None) -> dict[str, Any]:
    """Refresh the cheap gallery metadata (upvotes, categories...) on a record."""
    if not card:
        return record
    for key in ("title", "prompt", "categories", "upvoteCount", "isFeatured", "designSource",
                "sourceBlogName", "sourceArticleUrl", "createdAt", "updatedAt", "tab"):
        value = card.get(key)
        if value not in (None, "", []):
            record[key] = value
    return record


def build_record(
    share_id: str, html: str, card: dict[str, Any] | None, previous: dict[str, Any] | None, fetched_at: str
) -> dict[str, Any]:
    parsed = parse_share_page(html, share_id)
    steps = [step.to_json() for step in parsed.steps]
    record: dict[str, Any] = {
        "shareId": share_id,
        "url": share_url(share_id),
        "title": parsed.title,
        "prompt": parsed.prompt,
        "categories": [],
        "tab": parsed.gallery_tab,
        "designSource": parsed.design_source,
        "sourceBlogName": parsed.source_blog_name,
        "sourceArticleUrl": parsed.source_article_url,
        "upvoteCount": None,
        "isFeatured": False,
        "createdAt": None,
        "updatedAt": None,
        "fetchedAt": fetched_at,
        "contentHash": content_hash(parsed.title, parsed.prompt, steps),
        "status": "active",
        "missCount": 0,
        "schemaWarning": parsed.schema_warning,
        "totalSteps": len(steps),
        "steps": steps,
    }
    if previous:
        # Gallery metadata from an earlier run is better than nothing.
        for key in ("categories", "upvoteCount", "isFeatured", "createdAt", "updatedAt", "tab"):
            if record.get(key) in (None, [], False) and previous.get(key) not in (None, []):
                record[key] = previous[key]
    _apply_card(record, card)
    record["sourceArticleUrl"] = safe_http_url(record.get("sourceArticleUrl"))
    if parsed.schema_warning and previous and previous.get("steps") and not previous.get("schemaWarning"):
        # AC-06: never replace good structured steps with the fallback text.
        record["steps"] = previous["steps"]
        record["totalSteps"] = len(previous["steps"])
        record["contentHash"] = previous.get("contentHash", record["contentHash"])
    return record


def _gone_record(
    share_id: str, card: dict[str, Any] | None, previous: dict[str, Any] | None, fetched_at: str
) -> dict[str, Any]:
    """AC-07: count consecutive 404s; the loader hides a design at 2."""
    record = dict(previous) if previous else {
        "shareId": share_id, "url": share_url(share_id), "title": (card or {}).get("title") or share_id,
        "prompt": (card or {}).get("prompt") or "", "categories": [], "steps": [], "totalSteps": 0,
        "contentHash": None, "schemaWarning": None,
    }
    record["status"] = "gone"
    record["missCount"] = int((previous or {}).get("missCount") or 0) + 1
    record["fetchedAt"] = fetched_at
    return record


def crawl(
    out_path: Path,
    *,
    limit: int | None = None,
    delay: float = DEFAULT_DELAY,
    only: list[str] | None = None,
    refresh: bool = False,
    skip_gallery: bool = False,
    max_gallery_pages: int | None = None,
    fetcher: PoliteFetcher | None = None,
    now: Callable[[], str] = utcnow_iso,
) -> CrawlReport:
    fetcher = fetcher or PoliteFetcher(delay=delay)
    report = CrawlReport()
    existing = read_snapshot(out_path)
    logger.info("crawl start: %d designs already in %s", len(existing), out_path)

    fetcher.robots = _load_robots(fetcher)
    if not fetcher.robots.allowed(f"{BASE_URL}/share/robotscheck"):
        raise CrawlAborted("robots.txt now disallows /share/; snapshot left unchanged (frozen) - decide manually")

    only_ids: list[str] = []
    for share_id in only or []:
        if not SHARE_ID_RE.match(share_id):
            raise ValueError(f"not a share id: {share_id!r}")
        only_ids.append(share_id)

    meta: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    if not skip_gallery:
        meta, order = _crawl_gallery(fetcher, report, max_gallery_pages)
    if not only_ids:
        try:
            sitemap = fetcher.get(f"{BASE_URL}/sitemap.xml")
            ids = parse_sitemap(sitemap.body) if sitemap.status == 200 else []
        except (FetchError, DisallowedError) as exc:
            report.errors.append(str(exc))
            logger.warning("sitemap skipped: %s", exc)
            ids = []
        report.sitemap_ids = len(ids)
        seen = set(order)
        order.extend(share_id for share_id in ids if share_id not in seen)

    targets = only_ids or order
    records = dict(existing)
    todo: list[str] = []
    for share_id in targets:
        if _needs_fetch(existing.get(share_id), meta.get(share_id), refresh or bool(only_ids)):
            todo.append(share_id)
        else:
            report.skipped_existing += 1
            records[share_id] = _apply_card(dict(existing[share_id]), meta.get(share_id))
    if limit is not None:
        todo = todo[: max(0, limit)]
    report.targets = len(todo)
    logger.info(
        "crawl plan: %d to fetch, %d unchanged (gallery %d, sitemap %d)",
        len(todo), report.skipped_existing, report.gallery_designs, report.sitemap_ids,
    )

    try:
        for index, share_id in enumerate(todo, 1):
            previous = existing.get(share_id)
            try:
                response = fetcher.get(share_url(share_id))
            except DisallowedError as exc:
                report.errors.append(str(exc))
                break  # robots changed mid-run: stop, keep what we have
            except FetchError as exc:
                report.failed += 1
                report.errors.append(str(exc))
                logger.warning("design %s failed: %s", share_id, exc)
                continue
            fetched_at = now()
            if response.status in (404, 410):
                records[share_id] = _gone_record(share_id, meta.get(share_id), previous, fetched_at)
                report.gone += 1
            elif response.status == 200:
                record = build_record(share_id, response.body, meta.get(share_id), previous, fetched_at)
                if record.get("schemaWarning"):
                    report.schema_warnings += 1
                    logger.warning("design %s: %s", share_id, record["schemaWarning"])
                records[share_id] = record
                report.fetched += 1
            else:
                report.failed += 1
                report.errors.append(f"{share_id}: HTTP {response.status}")
            if index % PROGRESS_EVERY == 0:
                write_snapshot(out_path, records.values())
                logger.info("progress %d/%d designs (checkpoint written)", index, len(todo))
    finally:
        # Also on Ctrl-C: what was fetched is kept, the next run resumes.
        report.total_in_snapshot = len(records)
        report.requests = fetcher.requests_made
        if records:
            write_snapshot(out_path, records.values())
    logger.info("crawl done: %s", report.summary())
    return report
