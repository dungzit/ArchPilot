# `contracts/` — the one wire contract

Build-scope decision **D4**, task **0.6**. This directory is the mitigation for
decision **D2** (the backend became Python, so the architects' shared
`packages/core` no longer exists and nothing in the toolchain reconciles the two
languages).

| File | What it is |
|---|---|
| `archgraph.schema.json` | JSON Schema 2020-12. The `ArchGraph` shape shared by designs and patterns, plus three envelope rules. |
| `fixtures/index.json` | The shared manifest. Both test suites iterate it. |
| `fixtures/*.valid.json` | Documents that **must** validate. |
| `fixtures/*.invalid.json` | Documents that **must not** validate, each with the keyword it must fail on. |

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
- **No referential integrity.** JSON Schema cannot express "every `edge.source`
  names an existing `node.id`" or "node ids are unique". Those belong to
  `validateGraph()` in `src/domain/graph.ts` (task 1.5). This file checks shape;
  `validateGraph()` checks consistency. Do not let that boundary blur.
