# ArchPilot Backend

Python 3.10+ / FastAPI / SQLite. Server-side persistence for ArchPilot's
Phase 1 modules (architecture canvas, sizing studio, knowledge & pattern
search), replacing the SPA's current `localStorage`-only store.

This is the Phase-0 scaffold. See
`../../docs/development/systemsarchitect-build-scope.md` for the full plan,
the API surface still to be built, and the task breakdown.

## Install and run

```bash
cd ArchPilot/backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt   # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt  # Linux/macOS

# create the database and the first user. The password is prompted for (twice,
# not echoed) or piped on stdin - never a command-line argument.
.venv/Scripts/python.exe -m scripts.create_user admin --role admin --display-name "Admin"
# non-interactive / inside the container:
#   printf '%s\n' "$PW" | python -m scripts.create_user admin --role admin --password-stdin
#   docker exec -i <container> python -m scripts.create_user alice --password-stdin < pw.txt
# (scripts.init_db --create-user still works; it also reads ARCHPILOT_ADMIN_PASSWORD.)

.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Then:

```bash
curl http://127.0.0.1:8000/api/health
curl -c ck.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"choose-a-long-password"}' \
  http://127.0.0.1:8000/api/auth/login
curl -b ck.txt http://127.0.0.1:8000/api/auth/me

# mutating calls need the double-submit CSRF token (login returns it, and sets
# it as a readable archpilot_csrf cookie)
TOKEN=$(grep archpilot_csrf ck.txt | awk '{print $7}')
curl -b ck.txt -H "x-csrf-token: $TOKEN" -X POST http://127.0.0.1:8000/api/auth/logout
```

Interactive API docs: <http://127.0.0.1:8000/api/docs> (disabled when
`ARCHPILOT_ENV=production`).

## Lint and test

These are the exact two commands CI runs (`.github/workflows/ci.yml`, job
`backend`). CI runs them on **Python 3.12** — the version in `Dockerfile` — and
again on **3.10**, the documented floor. Run at least one locally before you
push.

```bash
.venv/Scripts/python.exe -m ruff check .   # config: ruff.toml
.venv/Scripts/python.exe -m pytest
```

`ruff format --check` is deliberately not in CI yet; see the note at the bottom
of `ruff.toml`.

## Endpoints today

| Method | Path | Auth | Status |
|---|---|---|---|
| `GET` | `/api/health/live` | no | shallow liveness |
| `GET` | `/api/health` | no | deep: SQLite read **and** write probe, 503 on failure |
| `POST` | `/api/auth/login` | no | local username/password, sets httpOnly session cookie + CSRF cookie |
| `POST` | `/api/auth/logout` | cookie/bearer | revokes the session (needs `x-csrf-token` when cookie-authenticated) |
| `GET` | `/api/auth/me` | cookie/bearer | current user |
| `GET` | `/api/workspaces/current` | cookie/bearer | the caller's workspace (`WorkspaceRecord` shape); 404 until one exists |
| `PUT` | `/api/workspaces/current` | cookie/bearer | create (`revision: 0`) or update (`revision` = current); stale revision → **409** |
| `GET` | `/api/designs?limit=&offset=` | cookie/bearer | the caller's designs, newest first, no graphs; `limit` 1–100 (default 50) |
| `POST` | `/api/designs` | cookie/bearer | `{name, graph}` → 201; `graph` validated against `../contracts/archgraph.schema.json` (422 names the path) |
| `GET` | `/api/designs/{id}` | cookie/bearer | one design with its graph; **404, not 403, for a non-owner** |
| `PUT` | `/api/designs/{id}` | cookie/bearer | `{name, graph, revision}` full replace; stale revision → **409**; non-owner → 404 |
| `DELETE` | `/api/designs/{id}` | cookie/bearer | soft delete → 204; non-owner → 404 |

**CSRF.** Every unsafe method (`POST`/`PUT`/`PATCH`/`DELETE`) on a
cookie-authenticated request must echo the `archpilot_csrf` cookie in an
`x-csrf-token` header. Enforced centrally in `app/csrf.py` from the request
middleware, so a router added later cannot forget it. `Authorization: Bearer`
clients are exempt (a browser cannot set that header cross-site).

## Layout

```
backend/
  app/
    main.py              FastAPI factory, request-id middleware, CORS, SPA mount
    config.py            env-driven settings (frozen dataclass, no extra deps)
    db.py                SQLite connection tuning + forward-only migration runner
    security.py          PBKDF2 password hashing, session tokens (stdlib only)
    content_hash.py      canonical pattern hashing - the legal-gate invariant
    schemas.py           pydantic request/response models
    dependencies.py      DbConn / CurrentUser / require_role
    logging_config.py    JSON logs to stdout
    csrf.py              double-submit CSRF check for cookie-auth mutations
    migrations/          001_core.sql, 002_patterns_legal.sql, 003_publish_gate.sql
    contract.py          loads ../contracts/archgraph.schema.json; validates design graphs per request
    repositories/        users.py, patterns.py, workspaces.py, designs.py, errors.py (SQL, no ORM)
    routers/             health.py, auth.py, workspaces.py, designs.py
  scripts/
    init_db.py           migrate + create a user
    create_user.py       create a user; password from a prompt or --password-stdin only
    backup.py            VACUUM INTO snapshot, verify, prune
  tests/                 pytest suite
  Dockerfile             SPA build stage + Python runtime, single container
```

## Operational notes

- **Backups must never be a file copy.** SQLite runs in WAL mode; copying the
  `.db` while `-wal`/`-shm` are live yields a torn file. Use
  `python -m scripts.backup --verify`. Continuous WAL replication (Litestream)
  is the second half of this control and is a devops task.
- **Rollback is restore-from-backup, not an image rollback.** Migrations are
  forward-only; an old image against a forward-migrated database will fail.
  The app now takes its own `VACUUM INTO` snapshot
  (`archpilot-<stamp>-premigrate.db`) before applying any pending migration to
  an existing database, and refuses to migrate if that snapshot fails. Set
  `ARCHPILOT_BACKUP_BEFORE_MIGRATE=false` only if an external process already
  guarantees the backup. Pre-migration snapshots are never pruned by
  `scripts/backup.py`.
- **Put `ARCHPILOT_BACKUP_DIR` on different storage from `ARCHPILOT_DB_PATH`.**
  The defaults put both under `data/`, which in the container is one volume:
  losing the volume loses the database and every backup of it.
- **Secrets** live in `.env` on the Docker host (`chmod 600`, never committed).
  `.env.example` documents every variable.
- `ARCHPILOT_COOKIE_SECURE=true` is mandatory when `ARCHPILOT_ENV=production`;
  the app refuses to start otherwise. So is a CORS list with no loopback origin
  — set `ARCHPILOT_CORS_ORIGINS=` (empty) for the same-origin container.

## Known limitations of this scaffold

1. Login throttling is in-process, so a restart clears it. It is also keyed on
   `(client IP, username)`, so an attacker who rotates usernames is not slowed
   down at all — acceptable only because there are 2–4 accounts on an internal
   network.
2. No password self-service change endpoint; use `scripts/init_db.py`.
3. Designs, sizing, pattern and workspace routers are not implemented - only
   their tables exist.
4. `patterns_fts` is populated by triggers but no search endpoint exists yet.
5. `repositories/patterns.py` carries the publish gate but has no HTTP route
   yet (Phase 5). Every future admin route must publish through
   `publish_pattern()`, never with a raw `UPDATE ... SET status='published'`.
6. Litestream is not configured; RPO is the backup interval.
