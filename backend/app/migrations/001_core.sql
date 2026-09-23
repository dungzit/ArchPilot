-- ArchPilot backend - migration 001: identity, workspaces, designs, sizing, events.
-- Forward-only. Rollback procedure is restore-from-backup, not a down-migration.

-- ---------------------------------------------------------------------------
-- Identity: simple local auth (PO decision 4). No SSO, no OIDC, no Entra ID.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                  TEXT PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name        TEXT NOT NULL,
    password_hash       TEXT NOT NULL,          -- pbkdf2_hmac(sha256) hex digest
    password_salt       TEXT NOT NULL,          -- 16 random bytes, hex
    password_iterations INTEGER NOT NULL,       -- recorded per user so it can be raised later
    role                TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('member', 'editor', 'admin')),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

-- Opaque server-side sessions. Only the SHA-256 of the token is stored, so a
-- database leak does not hand over live sessions.
CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT,
    user_agent   TEXT,
    ip_address   TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Workspace: the server-side home for what store.ts currently keeps in
-- localStorage under 'archpilot.workspace.v1'.
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
    id                TEXT PRIMARY KEY,
    owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    project_name      TEXT NOT NULL DEFAULT '',
    system_name       TEXT NOT NULL DEFAULT '',
    deployment_target TEXT NOT NULL DEFAULT 'on_premises',
    revision          INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

-- ---------------------------------------------------------------------------
-- Designs: one ArchGraph JSON document per design. Patterns (migration 002)
-- use the identical graph shape, so "apply pattern to canvas" is a deep copy
-- and "compare" is a set diff.
-- ---------------------------------------------------------------------------
CREATE TABLE designs (
    id                      TEXT PRIMARY KEY,
    workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    graph_json              TEXT NOT NULL,      -- ArchGraph { schemaVersion, nodes, edges }
    schema_version          TEXT NOT NULL DEFAULT '1.0',
    seeded_from_pattern_id  TEXT,               -- provenance for REQ-HUB-007 / takedown reach
    visibility              TEXT NOT NULL DEFAULT 'private'
                            CHECK (visibility IN ('private', 'workspace')),
    revision                INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    deleted_at              TEXT
);
CREATE INDEX idx_designs_owner ON designs(owner_id);
CREATE INDEX idx_designs_workspace ON designs(workspace_id);
CREATE INDEX idx_designs_seeded_from ON designs(seeded_from_pattern_id);

-- ---------------------------------------------------------------------------
-- Sizing scenarios (REQ-CALC-001..007).
-- benchmark_snapshot_json pins the per-node capacity figures that were in
-- force when the scenario was saved, so a later benchmark edit cannot silently
-- change a number somebody already committed to (red-team M8).
-- ---------------------------------------------------------------------------
CREATE TABLE sizing_scenarios (
    id                       TEXT PRIMARY KEY,
    design_id                TEXT REFERENCES designs(id) ON DELETE CASCADE,
    node_id                  TEXT,              -- ArchNode.id inside designs.graph_json
    owner_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                     TEXT NOT NULL DEFAULT 'Scenario',
    inputs_json              TEXT NOT NULL,
    results_json             TEXT NOT NULL,     -- must carry formula + assumptions + confidence
    benchmark_snapshot_json  TEXT NOT NULL,
    formula_version          TEXT NOT NULL,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
);
CREATE INDEX idx_sizing_design ON sizing_scenarios(design_id);
CREATE INDEX idx_sizing_owner ON sizing_scenarios(owner_id);

-- ---------------------------------------------------------------------------
-- Per-node capacity benchmarks (red-team M7: every figure must be auditable,
-- and editable without a deploy). Dual read/write capacity per B3(b).
-- ---------------------------------------------------------------------------
CREATE TABLE benchmarks (
    id                 TEXT PRIMARY KEY,
    component_type     TEXT NOT NULL,           -- service | database | cache | queue | object_store
    metric             TEXT NOT NULL,           -- read_qps | write_qps | rps | ops_per_sec | mb_per_sec
    value              REAL NOT NULL,
    unit               TEXT NOT NULL,
    hardware_profile   TEXT NOT NULL,
    basis              TEXT NOT NULL,
    source_url         TEXT,
    source_title       TEXT,
    retrieved_date     TEXT,
    confidence         TEXT NOT NULL
                       CHECK (confidence IN ('measured', 'declared', 'estimated', 'unverified')),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    UNIQUE (component_type, metric, hardware_profile)
);

-- A 'declared' benchmark without a citation is exactly the gap red-team M7
-- flagged. Enforce it in the schema, not in a review checklist.
CREATE TRIGGER trg_benchmarks_require_citation_insert
BEFORE INSERT ON benchmarks
WHEN NEW.confidence IN ('measured', 'declared')
     AND (NEW.source_url IS NULL OR TRIM(NEW.source_url) = '')
BEGIN
    SELECT RAISE(ABORT, 'benchmark tagged measured/declared requires a source_url');
END;

CREATE TRIGGER trg_benchmarks_require_citation_update
BEFORE UPDATE ON benchmarks
WHEN NEW.confidence IN ('measured', 'declared')
     AND (NEW.source_url IS NULL OR TRIM(NEW.source_url) = '')
BEGIN
    SELECT RAISE(ABORT, 'benchmark tagged measured/declared requires a source_url');
END;

-- ---------------------------------------------------------------------------
-- Observability (NFR-OBS-001). Business events only; request logs go to stdout.
-- ---------------------------------------------------------------------------
CREATE TABLE events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT,
    event_type   TEXT NOT NULL,
    target_id    TEXT,
    payload_json TEXT,
    request_id   TEXT,
    occurred_at  TEXT NOT NULL
);
CREATE INDEX idx_events_type_time ON events(event_type, occurred_at);

-- ---------------------------------------------------------------------------
-- Health probe target. /api/health writes here so a read-only or locked
-- database actually fails the check (red-team M12).
-- ---------------------------------------------------------------------------
CREATE TABLE health_probe (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    probed_at   TEXT NOT NULL
);
INSERT INTO health_probe (id, probed_at) VALUES (1, '1970-01-01T00:00:00+00:00');
