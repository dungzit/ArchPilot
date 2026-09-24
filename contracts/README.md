# `contracts/` — the one wire contract

Build-scope decision **D4**, task **0.6**. This directory is the mitigation for
decision **D2** (the backend became Python, so the architects' shared
`packages/core` no longer exists and nothing in the toolchain reconciles the two
languages).

| File | What it is |
|---|---|
| `archgraph.schema.json` | JSON Schema 2020-12, contract **1.1.0**. The `ArchGraph` design document shared by designs and patterns - schema **1.0** (frozen flat graph) and schema **2.0** (graph + `deployment` + `brief` + `decisions` + `derivations`, design-v2 D-08) - dispatched on `schemaVersion` with `if/then/else` - plus three envelope rules. |
| `catalog/components.json` | The provider-neutral logical component catalogue (task 0.6): 45 roles in 11 layers (requirements v2.1 §4.1.1 ids), common attributes, edge modes, size classes, NEST containment rules, 1.0 legacy types, aliases. Read by `src/domain/graph/catalog.ts` and `backend/app/catalog.py`. |
| `catalog/components.schema.json` | Shape of the catalogue. The backend validates the catalogue against it at start-up. |
| `catalog/neutrality-tokens.json` | NFR2-NEUT-001 token list (provider and vendor words). Both suites scan the catalogue, the contract's names and enums, and every valid 2.0 fixture outside `deployment`. |
| `fixtures/index.json` | The shared manifest. Both test suites iterate it: `cases` (shape), `integrityRules` + `integrityCases` (L1 integrity), `migrations` (1.0 -> 2.0 pairs). |
| `fixtures/*.valid.json` | Documents that **must** validate. |
| `fixtures/*.invalid.json` | Documents that **must not** validate, each with the keyword it must fail on. |
| `fixtures/*.integrity.json` | Documents that are **shape-valid** but must be rejected by the integrity layer, each with the rule code (`INT-*`) it must fail on - in Python, in TypeScript, and by the designs API (422). |

## Schema 2.0 in one paragraph

A 2.0 node is **provider-neutral**: logical role (`type`, a catalogue id - the
pattern is in the contract, membership is an integrity check), `variant`,
`codeName`, neutral `attributes` (v2.1 names: `replicas`, `statefulness`,
`failureDomainLevel`, `failureDomainLabel`, ...) and neutral role `config`.
Everything target-specific lives in `deployment`: `profiles[]`,
`bindings[{nodeId, target, realisation, config}]` and
`scenarios[{..., placements[{nodeId, profileId}]}]`. **Data is never a key**
(red-team review B2): target ids, node ids and artifact names travel as values in
arrays, so rule (a) below holds at every depth of a 2.0 document too, and the
neutrality scan only has to exclude the `deployment` subtree.
`fixtures/archgraph.v2-target-keyed-map.invalid.json` is the regression fixture
for the rejected design-v0.2 shape.

## The integrity layer (L1)

JSON Schema cannot say "every edge names an existing node". The 19 `INT-*`
rules in `fixtures/index.json` `integrityRules` can, and they are implemented
twice with the same codes, paths and order: `backend/app/graph_integrity.py`
(runs on every `POST`/`PUT /api/designs`, a violation is a 422 in the error
envelope) and `validateGraph()` in `src/domain/graph/validate.ts` (runs in the
browser; its `warning`/`info` design rules - NEST-*, DES-* - never block a save).

## The three envelope rules

Graph-shape drift is the risk this file was originally scoped for. Envelope
drift is the risk that actually produced a bug (review finding M-5: the API
emitted `display_name` / `expires_at` to a SPA whose every type is camelCase).
So the contract carries both.

| Rule | `$defs` pointer | Statement |
|---|---|---|
| (a) casing | `#/$defs/camelCaseObject` | Every key on the wire is `camelCase`, at every depth. Backend: `app/schemas.py` `ApiModel` uses `alias_generator=to_camel`. |
| (b) error shape | `#/$defs/errorResponse` | Every non-2xx JSON body is `{detail}` or `{detail, requestId}`, `detail` always a string. Backend: the two exception handlers in `app/main.py`. |
| (c) timestamps | `#/$defs/timestamp` | ISO 8601, UTC, explicit offset (`+00:00` or `Z`). Backend: `datetime.now(timezone.utc).…isoformat()`. |

## Who enforces it

| Suite | Validator | Command |
|---|---|---|
| Python | `jsonschema` | `cd backend && .venv/Scripts/python.exe -m pytest tests/test_contracts.py` |
| TypeScript | `ajv` (devDependency) | `npm test` |
| **Backend at runtime** (since task 1.6) | `jsonschema`, via `backend/app/contract.py` | every `POST`/`PUT /api/designs` body's `graph` is checked against `#/$defs/archGraph` in **this file**; a violation is a 422 naming the path (`nodes[1].type: ...`) |

Both read **these files**, not copies. Both run every fixture. Both assert that
the invalid fixtures fail *on the intended keyword* — a fixture that fails for an
accidental reason proves the validator ran, not that the rule is enforced.

The Python suite additionally validates **live API responses** against rules (a),
(b) and (c), because fixtures alone would not have caught M-5.

## Changing the contract

1. Edit `archgraph.schema.json`.
2. Add or amend a fixture **and** list it in `fixtures/index.json` — a fixture on
   disk that the manifest does not list fails the build in both languages.
3. Run **both** suites. A change that only one suite sees is the exact failure
   this directory exists to prevent.

## Deliberate non-goals

- **No OpenAPI / no codegen.** At 2–4 users and one graph type, a generator and
  its pipeline cost more than the drift they prevent. Reviewed and agreed.
- ~~**No runtime validation from this file.**~~ **Reversed at task 1.6.** The
  designs API has to validate user-authored graphs, and the only alternative to
  reading this file was a second, pydantic definition of `ArchGraph` in Python
  — the exact drift this directory exists to prevent. So the backend loads this
  file at start-up (`backend/app/contract.py`; the container copies it to
  `/srv/contracts/`) and refuses to start without it. Cost: `jsonschema` became
  a runtime dependency (3 → 4). `backend/tests/test_designs.py` POSTs **every
  `archGraph` fixture in the manifest** to the live endpoint and asserts the
  same verdict, so the runtime check cannot quietly diverge from the test
  suites. The envelope rules (casing, error shape, timestamps) are still
  asserted in tests only; they are properties of our own responses, not of
  user input.
- **No referential integrity in the schema.** JSON Schema cannot express "every
  `edge.source` names an existing `node.id`" or "node ids are unique". Those are
  the integrity layer's (see above): `backend/app/graph_integrity.py` and
  `validateGraph()` in `src/domain/graph/validate.ts`, sharing the `INT-*` codes.
  This file checks shape; the integrity layer checks consistency. Do not let
  that boundary blur.
