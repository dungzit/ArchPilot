-- ArchPilot backend - migration 003: close two holes in the B1 legal gate.
--
-- Migration 002 claimed "two independent layers" enforce the legal gate. Only
-- one of them was real. Layer 2 (the trigger) *revoked* an approval after a
-- content edit, but nothing at the storage layer stopped a publish in the first
-- place, and deleting a pattern silently destroyed its append-only audit trail.
-- Both were reproduced against the shipped 002 schema:
--
--   UPDATE patterns SET status='published' WHERE id='p1';
--     -> status='published' with ZERO rows in legal_reviews.
--   DELETE FROM patterns WHERE id='p1';
--     -> legal_reviews rows for that pattern: 1 before, 0 after.
--
-- Limit of what SQL can do here: SQLite has no SHA-256, so these triggers can
-- only check that patterns.content_hash matches an approved review. They cannot
-- check that content_hash is *truthful* about the row's current bytes. That
-- remains the application's job - see repositories/patterns.py, which recomputes
-- the hash from the row before every publish.

-- ---------------------------------------------------------------------------
-- Publishing requires an approved review of exactly these bytes (B1).
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_patterns_publish_requires_approval_update
BEFORE UPDATE ON patterns
WHEN NEW.status = 'published'
     AND OLD.status <> 'published'
     AND NOT EXISTS (
         SELECT 1 FROM legal_reviews r
          WHERE r.pattern_id = NEW.id
            AND r.decision = 'approved'
            AND r.content_hash = NEW.content_hash
     )
BEGIN
    SELECT RAISE(ABORT, 'publish blocked: no approved legal_review matches this content_hash');
END;

CREATE TRIGGER trg_patterns_publish_requires_approval_insert
BEFORE INSERT ON patterns
WHEN NEW.status = 'published'
     AND NOT EXISTS (
         SELECT 1 FROM legal_reviews r
          WHERE r.pattern_id = NEW.id
            AND r.decision = 'approved'
            AND r.content_hash = NEW.content_hash
     )
BEGIN
    SELECT RAISE(ABORT, 'publish blocked: no approved legal_review matches this content_hash');
END;

-- ---------------------------------------------------------------------------
-- The legal audit trail outlives the pattern (NFR-LEGAL-001).
-- legal_reviews is declared append-only, but ON DELETE CASCADE from patterns
-- let a single DELETE erase the record of what was approved and by whom.
-- Takedown is an unpublish, never a delete - so a reviewed pattern is not
-- deletable at all.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_patterns_no_delete_when_reviewed
BEFORE DELETE ON patterns
WHEN EXISTS (SELECT 1 FROM legal_reviews r WHERE r.pattern_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'pattern has legal_reviews and cannot be deleted; unpublish it instead');
END;
