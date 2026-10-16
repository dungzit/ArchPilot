"""CLI for the SysDesAi reference index. Run from ``backend/``.

    python -m app.reference crawl --out data/reference/sysdesai-snapshot.jsonl.gz [--limit N]
          [--delay 3.0] [--only ID ...] [--refresh] [--skip-gallery] [--max-gallery-pages N]
    python -m app.reference load [--snapshot PATH] [--force]
    python -m app.reference search "bộ nhớ đệm cho chuyển hướng" [--limit 5] [--phase build]
    python -m app.reference status

``load``/``search``/``status`` use the configured database (ARCHPILOT_DB_PATH)
and apply pending migrations first. ``crawl`` never touches the database.
Exit codes: 0 ok, 1 error, 2 usage, 3 crawl refused by robots.txt.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from ..config import get_settings
from ..db import connect, init_database
from . import crawler
from . import index as reference_index
from . import search as reference_search


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )


def _cmd_crawl(args: argparse.Namespace) -> int:
    if args.delay < crawler.MIN_DELAY:
        print(f"--delay must be >= {crawler.MIN_DELAY} seconds", file=sys.stderr)
        return 2
    out = Path(args.out).resolve()
    try:
        report = crawler.crawl(
            out,
            limit=args.limit,
            delay=args.delay,
            only=args.only,
            refresh=args.refresh,
            skip_gallery=args.skip_gallery,
            max_gallery_pages=args.max_gallery_pages,
        )
    except crawler.CrawlAborted as exc:
        print(f"crawl aborted: {exc}", file=sys.stderr)
        return 3
    except KeyboardInterrupt:
        print("interrupted; progress so far was saved to the snapshot", file=sys.stderr)
        return 130
    print(report.summary())
    print(f"snapshot: {out}")
    for error in report.errors[:20]:
        print(f"  error: {error}", file=sys.stderr)
    return 0


def _open_db():
    settings = get_settings()
    init_database(settings)
    return settings, connect(settings.db_path)


def _cmd_load(args: argparse.Namespace) -> int:
    settings, conn = _open_db()
    try:
        path = Path(args.snapshot).resolve() if args.snapshot else settings.reference_snapshot_path
        report = reference_index.load_snapshot(conn, path, force=args.force)
    finally:
        conn.close()
    print(json.dumps({"snapshot": str(path), "db": str(settings.db_path), **report.as_dict()}, ensure_ascii=False))
    return 0 if report.loaded or report.reason == "snapshot unchanged" else 1


def _cmd_search(args: argparse.Namespace) -> int:
    _, conn = _open_db()
    try:
        result = reference_search.search(conn, args.query, limit=args.limit, phase=args.phase, category=args.category)
    finally:
        conn.close()
    print(f"expanded: {result['expanded_query']}  (total {result['total']})")
    for rank, item in enumerate(result["items"], 1):
        print(f"{rank}. {item['title']}  [{item['tab'] or '-'}] score={item['score']}  {item['url']}")
        for step in item["steps"]:
            print(f"   - Buoc {step['position']}: {step['title']} ({step['phase']})")
    return 0


def _cmd_status(_args: argparse.Namespace) -> int:
    _, conn = _open_db()
    try:
        print(json.dumps(reference_index.status(conn)))
    finally:
        conn.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.reference", description="SysDesAi reference index tools")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    crawl = sub.add_parser("crawl", help="polite crawl -> JSONL.gz snapshot (resumable)")
    crawl.add_argument("--out", required=True, help="snapshot path (.jsonl.gz); existing records are reused")
    crawl.add_argument("--limit", type=int, default=None, help="fetch at most N design pages this run")
    crawl.add_argument("--delay", type=float, default=crawler.DEFAULT_DELAY, help="seconds between requests (>= 1.0)")
    crawl.add_argument("--only", nargs="+", default=None, metavar="ID", help="(re)fetch only these share ids")
    crawl.add_argument("--refresh", action="store_true", help="re-fetch designs already in the snapshot")
    crawl.add_argument("--skip-gallery", action="store_true", help="do not read gallery pages this run")
    crawl.add_argument("--max-gallery-pages", type=int, default=None, help="gallery pages per tab (default: all)")
    crawl.set_defaults(func=_cmd_crawl)

    load = sub.add_parser("load", help="load a snapshot into the database index")
    load.add_argument("--snapshot", default=None, help="default: ARCHPILOT_REFERENCE_SNAPSHOT or <db dir>/reference")
    load.add_argument("--force", action="store_true", help="reload even if the snapshot hash is unchanged")
    load.set_defaults(func=_cmd_load)

    find = sub.add_parser("search", help="query the index from the shell")
    find.add_argument("query")
    find.add_argument("--limit", type=int, default=5)
    find.add_argument("--phase", default=None)
    find.add_argument("--category", default=None)
    find.set_defaults(func=_cmd_search)

    stat = sub.add_parser("status", help="indexed counts and last crawl time")
    stat.set_defaults(func=_cmd_status)

    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        # A Windows console is often cp1252; never crash on a Vietnamese title.
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    _configure_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
