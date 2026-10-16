-- 007 - Pilot WP-B: SysDesAi reference index and per-design reference pins
-- (docs/v3/03-kh-phase1-sysdesai-reference-search.md, contract src/contracts/pilot.ts).
--
-- reference_designs / reference_steps / reference_fts are a READ-ONLY CACHE of
-- the crawler snapshot (backend/app/reference). The loader replaces all three
-- in one transaction whenever the snapshot file's SHA-256 changes, so nothing
-- user-owned may reference their rowids: reference_pins stores the stable
-- share_id + step position (plus a title snapshot) instead of a foreign key.
--
-- Isolation (KH-P1-12): nothing here is read by the catalog or the sizing
-- engine. Attribution (KH-P1-15) is rendered by the API/SPA on every hit.
--
-- Rollback = restore the pre-migration VACUUM INTO snapshot (backup-before-
-- migrate). The new tables are additive; no existing table is touched.

CREATE TABLE reference_designs (
    id                  INTEGER PRIMARY KEY,
    share_id            TEXT NOT NULL UNIQUE,
    url                 TEXT NOT NULL CHECK (url LIKE 'https://www.sysdesai.com/share/%'),
    title               TEXT NOT NULL,
    prompt              TEXT NOT NULL DEFAULT '',
    categories_json     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories_json)),
    tab                 TEXT CHECK (tab IS NULL OR tab IN ('featured', 'real-world', 'community')),
    design_source       TEXT CHECK (design_source IS NULL OR design_source IN ('user', 'article')),
    source_blog_name    TEXT,
    -- Third-party URL rendered as a link: only http(s) may be stored.
    source_article_url  TEXT CHECK (source_article_url IS NULL
                                    OR source_article_url LIKE 'https://%'
                                    OR source_article_url LIKE 'http://%'),
    upvote_count        INTEGER,
    is_featured         INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
    total_steps         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT,
    updated_at          TEXT,
    fetched_at          TEXT,
    content_hash        TEXT,
    -- 'hidden': 404 on two consecutive crawls (AC-07). Never returned by search.
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
    schema_warning      TEXT
);
CREATE INDEX idx_reference_designs_status ON reference_designs(status);

CREATE TABLE reference_steps (
    id          INTEGER PRIMARY KEY,           -- = reference_step_fts rowid
    design_id   INTEGER NOT NULL REFERENCES reference_designs(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL CHECK (position >= 1),   -- 1-based, as shown on SysDesAi
    step_key    TEXT,                                     -- SysDesAi internal id ("step-7"), not shown
    phase       TEXT NOT NULL,
    title       TEXT NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    UNIQUE (design_id, position)
);
CREATE INDEX idx_reference_steps_phase ON reference_steps(phase);

-- Two contentless FTS5 indexes (the text already lives in the tables above;
-- bm25() only needs the index). Two, not one, because FTS5's bm25 normalises
-- by the length of the WHOLE row: a design title repeated on every long step
-- row would be diluted, and a short look-alike design would outrank the real
-- one. Weights (app/reference/search.py): design title 10, prompt 3,
-- categories 2; step title 5, step text 1. porter = English stemming
-- ("redirects" ~ "redirect"); remove_diacritics 2 matches the query folding.
-- reference_design_fts.rowid = reference_designs.id
CREATE VIRTUAL TABLE reference_design_fts USING fts5(
    title,
    prompt,
    categories,
    content = '',
    tokenize = 'porter unicode61 remove_diacritics 2'
);
-- reference_step_fts.rowid = reference_steps.id
CREATE VIRTUAL TABLE reference_step_fts USING fts5(
    title,
    body,
    content = '',
    tokenize = 'porter unicode61 remove_diacritics 2'
);

-- Loader bookkeeping: snapshot_sha256, snapshot_loaded_at, last_crawl_at, ...
CREATE TABLE reference_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE reference_pins (
    id              TEXT PRIMARY KEY,
    owner_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    design_id       TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    share_id        TEXT NOT NULL,
    step_position   INTEGER CHECK (step_position IS NULL OR step_position >= 1),
    -- Snapshots taken at pin time: the index is rebuilt on every load and a
    -- design can disappear from it, but a pin must still render.
    title           TEXT NOT NULL,
    step_title      TEXT,
    note            TEXT CHECK (note IS NULL OR length(note) <= 1000),
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_reference_pins_owner_design ON reference_pins(owner_user_id, design_id);
CREATE UNIQUE INDEX ux_reference_pins_target
    ON reference_pins(owner_user_id, design_id, share_id, ifnull(step_position, 0));
