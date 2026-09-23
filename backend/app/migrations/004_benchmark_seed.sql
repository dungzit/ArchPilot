-- ---------------------------------------------------------------------------
-- 004 - benchmark provenance + an idempotent, never-overwriting seed (task 3.3)
--
-- Three additions to the `benchmarks` table created in 001:
--
-- 1. `origin` ('seed' | 'user'). Rows written by app/seeds/benchmarks.py are
--    'seed'. The moment anyone edits the substance of a seeded row (value,
--    unit, basis, citation, confidence, profile) a trigger flips it to 'user',
--    so "user-edited" is a fact stored in the row, not something the seed has
--    to guess.
-- 2. `benchmark_seed_log`: one row per seed id the seed has EVER handled.
--    The seed consults it first, so it never re-inserts a row the user deleted
--    and never touches a row it already wrote (red-team B2, applied to
--    benchmarks: a re-run must not resurrect or overwrite anything).
-- 3. A citation is required on EVERY row (build-scope rule for 3.3), not only
--    on measured/declared ones: `source_title` must be non-blank. For an
--    'estimated' generic heuristic the citation says exactly that; 001's
--    triggers still additionally require a `source_url` for measured/declared.
-- ---------------------------------------------------------------------------

ALTER TABLE benchmarks
    ADD COLUMN origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('seed', 'user'));

CREATE TABLE benchmark_seed_log (
    seed_id      TEXT PRIMARY KEY,               -- the stable id the seed file assigns
    seed_version TEXT NOT NULL,
    outcome      TEXT NOT NULL CHECK (outcome IN ('inserted', 'skipped_conflict')),
    applied_at   TEXT NOT NULL
);

CREATE TRIGGER trg_benchmarks_require_citation_title_insert
BEFORE INSERT ON benchmarks
WHEN NEW.source_title IS NULL OR TRIM(NEW.source_title) = ''
BEGIN
    SELECT RAISE(ABORT, 'every benchmark requires a source_title citation');
END;

CREATE TRIGGER trg_benchmarks_require_citation_title_update
BEFORE UPDATE ON benchmarks
WHEN NEW.source_title IS NULL OR TRIM(NEW.source_title) = ''
BEGIN
    SELECT RAISE(ABORT, 'every benchmark requires a source_title citation');
END;

-- An edit to a seeded row makes it the user's row. recursive_triggers is OFF
-- (app/db.py), and the WHEN clause only matches while origin is still 'seed',
-- so the inner UPDATE cannot loop.
CREATE TRIGGER trg_benchmarks_mark_user_edited
AFTER UPDATE ON benchmarks
WHEN OLD.origin = 'seed' AND NEW.origin = 'seed' AND (
       OLD.value            IS NOT NEW.value
    OR OLD.unit             IS NOT NEW.unit
    OR OLD.basis            IS NOT NEW.basis
    OR OLD.hardware_profile IS NOT NEW.hardware_profile
    OR OLD.source_url       IS NOT NEW.source_url
    OR OLD.source_title     IS NOT NEW.source_title
    OR OLD.retrieved_date   IS NOT NEW.retrieved_date
    OR OLD.confidence       IS NOT NEW.confidence
)
BEGIN
    UPDATE benchmarks SET origin = 'user' WHERE id = NEW.id;
END;
