"""Detached runner for the SysDesAi reference crawl (runs INSIDE the container).

docker-compose.pilot.yml mounts scripts/pilot at /pilot (read-only);
scripts/pilot/crawl-reference.ps1 drives this file with `docker exec`:

    python /pilot/crawl_runner.py check            # is app.reference in this image?
    python /pilot/crawl_runner.py run [--limit N]  # long job; started with `docker exec -d`
    python /pilot/crawl_runner.py status
    python /pilot/crawl_runner.py stop

It wraps the backend CLI contract (work package WP-B):

    python -m app.reference crawl --out <file> [--limit N]
    python -m app.reference load  --snapshot <file>

Why a wrapper instead of calling the CLI directly:
  * a full crawl takes ~45 minutes; it must survive the operator closing the
    PowerShell window, so it runs detached and logs to a plain file;
  * the crawler writes to a temporary name and the finished file is moved into
    place atomically, so a crash or Ctrl+C never leaves a half-written snapshot
    where the backend will auto-load it at the next start;
  * the previous snapshot is kept as *.prev.jsonl.gz (one-step rollback).

Files (all under the directory of ARCHPILOT_REFERENCE_SNAPSHOT, host path
pilot-data/reference/): crawl.log, crawl.pid, the snapshot, the .prev copy.
crawl.log ends with the markers __CRAWL_EXIT=<code>, __LOAD_EXIT=<code|skipped>
and __DONE__, which the PowerShell side waits for.

Exit codes of `check`: 0 ok / 3 app.reference missing or not runnable.
Exit codes of `run`:   0 finished (see markers) / 4 already running.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

APP_DIR = "/srv"  # image layout (backend/Dockerfile WORKDIR)
sys.path.insert(0, APP_DIR)

FINAL = Path(os.environ.get("ARCHPILOT_REFERENCE_SNAPSHOT", "/data/reference/sysdesai-snapshot.jsonl.gz"))
REF_DIR = FINAL.parent
LOG = REF_DIR / "crawl.log"
PIDFILE = REF_DIR / "crawl.pid"
SUFFIX = ".jsonl.gz"


def _variant(tag: str) -> Path:
    """sysdesai-snapshot.jsonl.gz -> sysdesai-snapshot.<tag>.jsonl.gz (keeps the
    .gz suffix, which the crawler may use to decide on compression)."""
    name = FINAL.name
    if name.endswith(SUFFIX):
        return FINAL.with_name(name[: -len(SUFFIX)] + f".{tag}" + SUFFIX)
    return FINAL.with_name(f"{tag}-{name}")


TMP = _variant("new")
PREV = _variant("prev")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _read_pids() -> list[int]:
    try:
        return [int(x) for x in PIDFILE.read_text().split()]
    except (OSError, ValueError):
        return []


def cmd_check() -> int:
    try:
        spec = importlib.util.find_spec("app.reference")
    except (ImportError, ValueError) as exc:
        print(f"app.reference cannot be imported: {exc}", file=sys.stderr)
        return 3
    if spec is None:
        print("module app.reference is not in this image", file=sys.stderr)
        return 3
    if spec.submodule_search_locations is not None:  # a package needs __main__ for `python -m`
        if importlib.util.find_spec("app.reference.__main__") is None:
            print("package app.reference has no __main__.py (python -m app.reference unsupported)", file=sys.stderr)
            return 3
    print("app.reference present")
    return 0


def cmd_run(limit: int | None) -> int:
    REF_DIR.mkdir(parents=True, exist_ok=True)
    pids = _read_pids()
    if pids and _alive(pids[0]):
        print(f"a crawl is already running (pid {pids[0]}); use 'stop' first", file=sys.stderr)
        return 4
    PIDFILE.write_text(f"{os.getpid()}\n")
    try:
        with LOG.open("w", encoding="utf-8") as log:

            def say(message: str) -> None:
                log.write(f"[runner {_now()}] {message}\n")
                log.flush()

            say(f"crawl start; limit={limit if limit else 'none (full crawl)'}; out={TMP.name}")
            TMP.unlink(missing_ok=True)
            cmd = [sys.executable, "-u", "-m", "app.reference", "crawl", "--out", str(TMP)]
            if limit:
                cmd += ["--limit", str(limit)]
            proc = subprocess.Popen(cmd, cwd=APP_DIR, stdout=log, stderr=subprocess.STDOUT)
            PIDFILE.write_text(f"{os.getpid()}\n{proc.pid}\n")
            crawl_code = proc.wait()
            if crawl_code == 0 and (not TMP.is_file() or TMP.stat().st_size == 0):
                say("crawl exited 0 but wrote no output file")
                crawl_code = 5
            say(f"__CRAWL_EXIT={crawl_code}")
            if crawl_code != 0:
                TMP.unlink(missing_ok=True)  # never leave a partial file behind

            load_code: str | int = "skipped"
            if crawl_code == 0:
                if FINAL.is_file():
                    os.replace(FINAL, PREV)
                os.replace(TMP, FINAL)
                say(f"snapshot in place: {FINAL} ({FINAL.stat().st_size} bytes); previous kept as {PREV.name}")
                load = subprocess.Popen(
                    [sys.executable, "-u", "-m", "app.reference", "load", "--snapshot", str(FINAL)],
                    cwd=APP_DIR,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
                load_code = load.wait()
            say(f"__LOAD_EXIT={load_code}")
            say("__DONE__")
    finally:
        PIDFILE.unlink(missing_ok=True)
    return 0


def cmd_status() -> int:
    pids = _read_pids()
    running = bool(pids) and _alive(pids[0])
    print("running" if running else "idle")
    if FINAL.is_file():
        print(f"snapshot: {FINAL} ({FINAL.stat().st_size} bytes)")
    else:
        print("snapshot: none yet")
    if LOG.is_file():
        tail = LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-5:]
        print("--- last log lines ---")
        print("\n".join(tail))
    return 0


def cmd_stop() -> int:
    pids = _read_pids()
    if not pids or not _alive(pids[0]):
        print("no crawl is running")
        return 0
    target = pids[1] if len(pids) > 1 and _alive(pids[1]) else pids[0]
    os.kill(target, signal.SIGTERM)
    print(f"sent SIGTERM to pid {target}; the runner records the exit code and skips the load")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    run = sub.add_parser("run")
    run.add_argument("--limit", type=int, default=None, help="stop after N designs (test crawl)")
    sub.add_parser("status")
    sub.add_parser("stop")
    args = parser.parse_args(argv[1:])
    if args.cmd == "check":
        return cmd_check()
    if args.cmd == "run":
        return cmd_run(args.limit)
    if args.cmd == "status":
        return cmd_status()
    return cmd_stop()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
