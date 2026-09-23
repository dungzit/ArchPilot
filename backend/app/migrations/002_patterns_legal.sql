-- ArchPilot backend - migration 002: pattern hub content + the legal gate.
--
-- This migration is where red-team blocker B1 lives. The rule is:
--   a legal approval is bound to the BYTES that were approved, not to the
--   pattern's ID. Any edit to legally-significant content after approval
--   sends the pattern back to 'draft'.
-- Two independent layers enforce it:
--   1. patterns.content_hash, written by the application on every save, and
--      compared against legal_reviews.content_hash at publish time.
--   2. the trigger below, which resets status whenever a legally-significant
--      column changes - including via a migration or a manual sqlite3 session,
--      which is exactly the hole B1 described.

-- ---------------------------------------------------------------------------
-- Patterns. Attribution columns are NOT NULL: REQ-HUB-005 is a storage
-- constraint, not a UI convention.
-- ---------------------------------------------------------------------------
CREATE TABLE patterns (
    id                    TEXT PRIMARY KEY,
    slug                  TEXT NOT NULL UNIQUE,
    title                 TEXT NOT NULL,
    summary_one_line      TEXT NOT NULL,
    body_md               TEXT NOT NULL,
    graph_json            TEXT NOT NULL,        -- same ArchGraph shape as designs
    categories_json       TEXT NOT NULL,        -- JSON array of category slugs

    source_company        TEXT NOT NULL,
    source_url            TEXT NOT NULL,
    source_title          TEXT NOT NULL,
    source_published_date TEXT,
    licence_note          TEXT NOT NULL DEFAULT '',

    status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'in_legal_review', 'approved',
                                            'published', 'unpublished')),
    content_hash          TEXT NOT NULL,        -- sha256 over the canonical payload
    author_id             TEXT NOT NULL REFERENCES users(id),
    published_at          TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,

    CHECK (TRIM(source_company) <> ''),
    CHECK (TRIM(source_url) <> ''),
    CHECK (TRIM(source_title) <> '')
);
CREATE INDEX idx_patterns_status ON patterns(status);
CREATE INDEX idx_patterns_company ON patterns(source_company);

-- ---------------------------------------------------------------------------
-- Legal reviews. PO decision 3: the author self-certifies; there is NO second,
-- independent reviewer in this version. The content_hash invariant is kept.
-- Rows are append-only: an approval is a historical fact, never edited.
-- ---------------------------------------------------------------------------
CREATE TABLE legal_reviews (
    id             TEXT PRIMARY KEY,
    pattern_id     TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
    reviewer_id    TEXT NOT NULL REFERENCES users(id),
    content_hash   TEXT NOT NULL,               -- the bytes that were reviewed (B1)
    checklist_json TEXT NOT NULL,               -- all 5 items, each must be true
    decision       TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    notes          TEXT,
    reviewed_at    TEXT NOT NULL
);
CREATE INDEX idx_legal_reviews_pattern ON legal_reviews(pattern_id);
CREATE INDEX idx_legal_reviews_hash ON legal_reviews(content_hash);

CREATE TRIGGER trg_legal_reviews_append_only_update
BEFORE UPDATE ON legal_reviews
BEGIN
    SELECT RAISE(ABORT, 'legal_reviews is append-only');
END;

CREATE TRIGGER trg_legal_reviews_append_only_delete
BEFORE DELETE ON legal_reviews
WHEN (SELECT COUNT(*) FROM patterns WHERE id = OLD.pattern_id) > 0
BEGIN
    SELECT RAISE(ABORT, 'legal_reviews is append-only');
END;

-- B1 invariant, layer 2. Editing legally-significant content on a pattern that
-- has cleared review pushes it back to 'draft'. recursive_triggers is OFF and
-- the WHEN clause is false for a status-only update, so this cannot loop.
CREATE TRIGGER trg_patterns_reset_status_on_content_change
AFTER UPDATE ON patterns
WHEN OLD.status IN ('in_legal_review', 'approved', 'published')
     AND (OLD.body_md              IS NOT NEW.body_md
       OR OLD.graph_json           IS NOT NEW.graph_json
       OR OLD.title                IS NOT NEW.title
       OR OLD.summary_one_line     IS NOT NEW.summary_one_line
       OR OLD.categories_json      IS NOT NEW.categories_json
       OR OLD.source_company       IS NOT NEW.source_company
       OR OLD.source_url           IS NOT NEW.source_url
       OR OLD.source_title         IS NOT NEW.source_title
       OR OLD.source_published_date IS NOT NEW.source_published_date)
BEGIN
    UPDATE patterns
       SET status = 'draft',
           published_at = NULL
     WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- Takedown requests (NFR-LEGAL-002).
-- derived_design_count records how many user designs were seeded from the
-- pattern at resolution time, so the reply to the requester is honest (M10).
-- ---------------------------------------------------------------------------
CREATE TABLE takedown_requests (
    id                   TEXT PRIMARY KEY,
    pattern_id           TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
    requester_contact    TEXT,
    reason               TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'acknowledged', 'resolved', 'rejected')),
    derived_design_count INTEGER,
    received_at          TEXT NOT NULL,
    acknowledged_at      TEXT,
    resolved_at          TEXT,
    resolution           TEXT
);
CREATE INDEX idx_takedown_pattern ON takedown_requests(pattern_id);
CREATE INDEX idx_takedown_status ON takedown_requests(status);

-- ---------------------------------------------------------------------------
-- Full-text search (REQ-HUB-004). External-content FTS5 index WITH the sync
-- triggers the red-team's M1 found missing. The index covers every row; the
-- published-only filter is applied by the single search query that joins back
-- to patterns. Never query patterns_fts directly.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE patterns_fts USING fts5(
    title,
    summary_one_line,
    body_md,
    categories_json,
    source_company,
    content = 'patterns',
    content_rowid = 'rowid',
    -- ArchPilot is a bilingual VI/EN product. remove_diacritics 2 folds full
    -- Vietnamese diacritics, so "kiến trúc" and "kien truc" both match.
    tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER trg_patterns_fts_insert AFTER INSERT ON patterns
BEGIN
    INSERT INTO patterns_fts(rowid, title, summary_one_line, body_md, categories_json, source_company)
    VALUES (NEW.rowid, NEW.title, NEW.summary_one_line, NEW.body_md, NEW.categories_json, NEW.source_company);
END;

CREATE TRIGGER trg_patterns_fts_delete AFTER DELETE ON patterns
BEGIN
    INSERT INTO patterns_fts(patterns_fts, rowid, title, summary_one_line, body_md, categories_json, source_company)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.summary_one_line, OLD.body_md, OLD.categories_json, OLD.source_company);
END;

CREATE TRIGGER trg_patterns_fts_update AFTER UPDATE ON patterns
BEGIN
    INSERT INTO patterns_fts(patterns_fts, rowid, title, summary_one_line, body_md, categories_json, source_company)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.summary_one_line, OLD.body_md, OLD.categories_json, OLD.source_company);
    INSERT INTO patterns_fts(rowid, title, summary_one_line, body_md, categories_json, source_company)
    VALUES (NEW.rowid, NEW.title, NEW.summary_one_line, NEW.body_md, NEW.categories_json, NEW.source_company);
END;
