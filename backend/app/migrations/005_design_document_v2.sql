-- 005 - ArchGraph 2.0 design documents (task 0.4; design-v2 D-08; contract 1.1.0).
--
-- The 2.0 document (graph + deployment + brief + decisions + derivations) still
-- lives in designs.graph_json, one document per design, so the target layer,
-- the wizard brief and the ADR log need NO new table (design-v2 4.3.12).
--
-- What this migration adds is a storage-layer guard, in the same spirit as the
-- 003 publish gate: the API validates every body against the contract and the
-- integrity layer (app/contract.py, app/graph_integrity.py), but a script or a
-- future import CLI writes SQL directly. These triggers make sure that
--   (a) designs.schema_version is a version the contract knows, and
--   (b) it always equals graph_json's own $.schemaVersion,
-- so `GET /api/designs` (which lists schema_version without reading the graph)
-- can never disagree with the stored document. Adding schema 3.0 later is a
-- deliberate edit here, exactly like the contract's enum.
--
-- Deliberately NOT added here: designs.lesson_id and seeded_from_template_id
-- (design-v2 lists them under 005). They reference tables that do not exist
-- yet (templates, lessons); they land with the migrations that create those
-- tables, so the foreign keys can be real.
--
-- Rollback = restore the pre-migration VACUUM INTO snapshot (backup-before-
-- migrate, red-team B4). Existing rows are all '1.0' with 1.0 documents, so
-- nothing already stored violates the new rule.

CREATE TRIGGER designs_document_version_insert
BEFORE INSERT ON designs
WHEN NEW.schema_version NOT IN ('1.0', '2.0')
  OR json_valid(NEW.graph_json) = 0
  OR json_extract(NEW.graph_json, '$.schemaVersion') IS NOT NEW.schema_version
BEGIN
    SELECT RAISE(ABORT, 'designs: schema_version must be 1.0 or 2.0 and equal graph_json.schemaVersion');
END;

CREATE TRIGGER designs_document_version_update
BEFORE UPDATE OF graph_json, schema_version ON designs
WHEN NEW.schema_version NOT IN ('1.0', '2.0')
  OR json_valid(NEW.graph_json) = 0
  OR json_extract(NEW.graph_json, '$.schemaVersion') IS NOT NEW.schema_version
BEGIN
    SELECT RAISE(ABORT, 'designs: schema_version must be 1.0 or 2.0 and equal graph_json.schemaVersion');
END;
