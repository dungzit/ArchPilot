"""SysDesAi reference search (pilot WP-B, docs/v3/03).

Modules
-------
* ``parser``   - pure HTML/RSC parsing of gallery, sitemap and share pages.
* ``robots``   - robots.txt policy (stdlib parser + longest-match).
* ``crawler``  - polite crawler writing the JSONL.gz snapshot.
* ``index``    - snapshot -> SQLite FTS5 loader and start-up auto-load.
* ``textnorm`` / ``glossary`` - Vietnamese folding and VI->EN expansion.
* ``search``   - query building, bm25 ranking, grouping, snippets.
* ``pins``     - owner-scoped reference pins on ArchPilot designs.

CLI: ``python -m app.reference --help`` (run from ``backend/``).
"""
