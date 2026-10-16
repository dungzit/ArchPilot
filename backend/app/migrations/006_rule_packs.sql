-- 006 - Pilot v1 WP-A: user rule packs and saved sizing runs (docs/v3/05).
--
-- rule_packs: the team's shared library of user-created and Excel-imported
-- packs. Built-in packs live in TypeScript (src/domain/rules/packs) and are
-- never stored here. name/version/status are columns so a list never needs to
-- parse the body; body_json holds {description, models} in wire (camelCase)
-- shape, validated by app/schemas_pilot_rules.py. The rule DSL inside is
-- checked by the TypeScript engine, not by the database.
--
-- sizing_runs: one evaluated model, saved so the HLD export (WP-C) can cite
-- it. Owner-scoped like designs. design_id is optional; when present it must
-- be a design the owner can access (checked by the router, same rule as
-- /api/designs). Runs are immutable: there is no updated_at.
--
-- Rollback = restore the pre-migration VACUUM INTO snapshot (backup-before-
-- migrate). Both tables are new, so no existing row is touched.

CREATE TABLE rule_packs (
    id             TEXT PRIMARY KEY,
    owner_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    version        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published', 'deprecated')),
    body_json      TEXT NOT NULL CHECK (json_valid(body_json)),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX idx_rule_packs_owner ON rule_packs(owner_user_id);
CREATE INDEX idx_rule_packs_updated ON rule_packs(updated_at);

CREATE TABLE sizing_runs (
    id             TEXT PRIMARY KEY,
    owner_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    design_id      TEXT REFERENCES designs(id) ON DELETE CASCADE,
    body_json      TEXT NOT NULL CHECK (json_valid(body_json)),
    created_at     TEXT NOT NULL
);
CREATE INDEX idx_sizing_runs_owner_design ON sizing_runs(owner_user_id, design_id, created_at);
