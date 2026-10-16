"""Snapshot -> SQLite/FTS5 loader, and the start-up auto-load.

``load_snapshot`` replaces the whole reference index in ONE ``BEGIN
IMMEDIATE`` transaction. Readers (WAL) keep seeing the old index until the
commit, so a reload never shows a half-built index. It is skipped when the
file's SHA-256 equals the last loaded one (``reference_meta``), which makes
calling it on every start free.

``autoload`` is what ``app.main.lifespan`` calls: never raises, never blocks
on a missing file, logs what it did.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..db import connect, immediate_transaction, utcnow_iso
from .crawler import read_snapshot
from .parser import SHARE_ID_RE, safe_http_url, share_url
from .textnorm import collapse_ws

logger = logging.getLogger("app.reference.index")

TABS = {"featured", "real-world", "community"}
MAX_TEXT_CHARS = 8_000


@dataclass
class LoadReport:
    loaded: bool
    reason: str
    designs: int = 0
    hidden: int = 0
    steps: int = 0
    seconds: float = 0.0
    sha256: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "loaded": self.loaded,
            "reason": self.reason,
            "designs": self.designs,
            "hidden": self.hidden,
            "steps": self.steps,
            "seconds": round(self.seconds, 2),
        }


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM reference_meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO reference_meta (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, utcnow_iso()),
    )


def _is_visible(record: dict[str, Any]) -> bool:
    """AC-07: a design is hidden after two consecutive 404s; one 404 keeps the
    last good content. Anything without steps cannot be found anyway."""
    if not record.get("steps"):
        return False
    if record.get("status") == "gone":
        return int(record.get("missCount") or 0) < 2
    return record.get("status", "active") == "active"


def _text(value: Any, limit: int) -> str:
    """Bounded and whitespace-collapsed. The crawler already collapses, so the
    regex only runs when needed: it was half the load time on 12,800 steps."""
    if not isinstance(value, str):
        return ""
    text = value[: limit * 2]
    if "  " in text or "\n" in text or "\t" in text or "\r" in text or "\xa0" in text:
        text = collapse_ws(text)
    return text.strip()[:limit]


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def load_snapshot(conn: sqlite3.Connection, path: Path, *, force: bool = False) -> LoadReport:
    started = time.perf_counter()
    if not path.is_file():
        return LoadReport(False, f"snapshot not found: {path}")
    sha = file_sha256(path)
    if not force and get_meta(conn, "snapshot_sha256") == sha:
        return LoadReport(False, "snapshot unchanged", sha256=sha)

    records = read_snapshot(path)
    design_rows: list[tuple] = []
    step_rows: list[tuple] = []
    design_fts_rows: list[tuple] = []
    step_fts_rows: list[tuple] = []
    last_crawl: str | None = None
    hidden = 0
    next_step_id = 1
    for design_id, record in enumerate(sorted(records.values(), key=lambda r: r["shareId"]), 1):
        share_id = record["shareId"]
        if not SHARE_ID_RE.match(share_id):
            continue
        fetched_at = record.get("fetchedAt") if isinstance(record.get("fetchedAt"), str) else None
        if fetched_at and (last_crawl is None or fetched_at > last_crawl):
            last_crawl = fetched_at
        visible = _is_visible(record)
        hidden += 0 if visible else 1
        categories = [c for c in record.get("categories") or [] if isinstance(c, str)][:20]
        title = _text(record.get("title"), 300) or share_id
        prompt = _text(record.get("prompt"), 2_000)
        tab = record.get("tab") if record.get("tab") in TABS else None
        source = record.get("designSource") if record.get("designSource") in ("user", "article") else None
        design_rows.append(
            (
                design_id, share_id, share_url(share_id), title, prompt,
                json.dumps(categories, ensure_ascii=False), tab, source,
                _text(record.get("sourceBlogName"), 200) or None,
                safe_http_url(record.get("sourceArticleUrl")),
                _int(record.get("upvoteCount")),
                1 if record.get("isFeatured") is True or tab == "featured" else 0,
                len(record.get("steps") or []),
                record.get("createdAt") if isinstance(record.get("createdAt"), str) else None,
                record.get("updatedAt") if isinstance(record.get("updatedAt"), str) else None,
                fetched_at,
                record.get("contentHash") if isinstance(record.get("contentHash"), str) else None,
                "active" if visible else "hidden",
                _text(record.get("schemaWarning"), 500) or None,
            )
        )
        if not visible:
            continue
        design_fts_rows.append((design_id, title, prompt, " ".join(categories)))
        seen_positions: set[int] = set()
        for step in record.get("steps") or []:
            if not isinstance(step, dict):
                continue
            position = _int(step.get("position"))
            if position is None or position < 1 or position in seen_positions:
                continue
            seen_positions.add(position)
            step_title = _text(step.get("title"), 300)
            phase = _text(step.get("phase"), 32).lower() or "unknown"
            body = _text(step.get("text"), MAX_TEXT_CHARS)
            step_key = step.get("stepKey") if isinstance(step.get("stepKey"), str) else None
            step_rows.append((next_step_id, design_id, position, step_key, phase, step_title, body))
            step_fts_rows.append((next_step_id, step_title, body))
            next_step_id += 1

    with immediate_transaction(conn):
        conn.execute("DELETE FROM reference_steps")
        conn.execute("DELETE FROM reference_designs")
        conn.execute("INSERT INTO reference_design_fts(reference_design_fts) VALUES ('delete-all')")
        conn.execute("INSERT INTO reference_step_fts(reference_step_fts) VALUES ('delete-all')")
        conn.executemany(
            """
            INSERT INTO reference_designs (
                id, share_id, url, title, prompt, categories_json, tab, design_source,
                source_blog_name, source_article_url, upvote_count, is_featured, total_steps,
                created_at, updated_at, fetched_at, content_hash, status, schema_warning)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            design_rows,
        )
        conn.executemany(
            "INSERT INTO reference_steps (id, design_id, position, step_key, phase, title, text)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            step_rows,
        )
        conn.executemany(
            "INSERT INTO reference_design_fts (rowid, title, prompt, categories) VALUES (?, ?, ?, ?)", design_fts_rows
        )
        conn.executemany("INSERT INTO reference_step_fts (rowid, title, body) VALUES (?, ?, ?)", step_fts_rows)
        _set_meta(conn, "snapshot_sha256", sha)
        _set_meta(conn, "snapshot_path", str(path))
        _set_meta(conn, "snapshot_loaded_at", utcnow_iso())
        if last_crawl:
            _set_meta(conn, "last_crawl_at", last_crawl)
    report = LoadReport(
        True, "loaded", designs=len(design_rows) - hidden, hidden=hidden, steps=len(step_rows),
        seconds=time.perf_counter() - started, sha256=sha,
    )
    logger.info("reference snapshot loaded", extra=report.as_dict())
    return report


def autoload(settings) -> dict[str, Any]:
    """Start-up hook (app.main.lifespan). Never raises."""
    path = settings.reference_snapshot_path
    try:
        if not path.is_file():
            logger.info("reference snapshot not present; search index unchanged", extra={"path": str(path)})
            return {"loaded": False, "reason": "missing"}
        conn = connect(settings.db_path)
        try:
            return load_snapshot(conn, path).as_dict()
        finally:
            conn.close()
    except Exception:  # broad on purpose: a bad snapshot must not stop the app
        logger.exception("reference snapshot load failed; previous index kept")
        return {"loaded": False, "reason": "error"}


def status(conn: sqlite3.Connection) -> dict[str, Any]:
    designs = conn.execute("SELECT COUNT(*) FROM reference_designs WHERE status = 'active'").fetchone()[0]
    steps = conn.execute(
        "SELECT COUNT(*) FROM reference_steps s JOIN reference_designs d ON d.id = s.design_id"
        " WHERE d.status = 'active'"
    ).fetchone()[0]
    return {"indexed_designs": designs, "indexed_steps": steps, "last_crawl_at": get_meta(conn, "last_crawl_at")}
