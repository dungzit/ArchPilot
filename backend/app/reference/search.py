"""Keyword search over the reference index (KH-P1-07/09, pilot: no embeddings).

Pipeline
--------
1. ``expand_query``: fold (lowercase, no diacritics), tokenise to
   ``[a-z0-9]+``, replace Vietnamese glossary phrases by English terms, drop
   stopwords and 1-letter tokens, keep 2-4 consecutive untranslated words as a
   phrase, cap at 24 terms.
2. ``build_fts_query``: every term becomes a QUOTED FTS5 string; terms are
   OR-ed; a multi-word term is added as a phrase AND as its words, so
   adjacency ranks higher. Tokens are ``[a-z0-9]+`` only, so user input can
   never inject FTS5 syntax (NEAR, *, ^, column filters, unbalanced quotes) -
   there is no escaping to get wrong.
3. Ranking, two bm25 scores summed: the design (``reference_design_fts``:
   title 10, prompt 3, categories 2) and its steps (``reference_step_fts``:
   step title 5, text 1; best + 1/2 second + 1/4 third). Two indexes because
   FTS5 normalises bm25 by the length of the WHOLE row: a title repeated on
   long step rows would be diluted and a short look-alike design would outrank
   the real one. Then small boosts: +10 % featured, + up to 10 % for
   log10(upvotes) (a weak signal, R-P1-04).
4. Steps shown (<= 3 per design) are ranked by the query terms the design
   title does NOT already cover: for "cache for url shortener redirects" on
   the design "URL Shortener", the steps about cache and redirect. Each has a
   plain-text snippet of at most 300 characters around the first match.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from .glossary import translate_tokens
from .parser import safe_http_url, share_url
from .textnorm import STOPWORDS, collapse_ws, tokens

MAX_QUERY_TERMS = 24
MAX_FTS_TERMS = 48
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
CANDIDATES = 1_500
STEPS_PER_DESIGN = 3
STEP_DEPTH_WEIGHTS = (1.0, 0.5, 0.25)
SNIPPET_CHARS = 300
# bm25() column weights; literals because bm25() takes them as SQL arguments.
DESIGN_WEIGHTS = "10.0, 3.0, 2.0"  # title, prompt, categories
STEP_WEIGHTS = "5.0, 1.0"  # step title, step text
FEATURED_BOOST = 0.10
UPVOTE_BOOST_PER_DECADE = 0.03
UPVOTE_BOOST_CAP = 0.10

_PHASE_RE = re.compile(r"^[a-z]{2,32}$")
_SAFE_PART_RE = re.compile(r'"[a-z0-9]+(?: [a-z0-9]+)*"')


@dataclass
class ExpandedQuery:
    terms: list[str]
    """English or untranslated terms; a multi-word term is a phrase."""

    @property
    def display(self) -> str:
        return " ".join(f'"{term}"' if " " in term else term for term in self.terms)

    @property
    def words(self) -> list[str]:
        out: list[str] = []
        for term in self.terms:
            for word in term.split():
                if word not in out:
                    out.append(word)
        return out


def _keep(token: str) -> bool:
    if token in STOPWORDS:
        return False
    return len(token) > 1 or token.isdigit()


def expand_query(query: str) -> ExpandedQuery:
    """Glossary hits become their English terms. Consecutive untranslated
    words (2-4 of them, e.g. ``rate limiting``) are kept as ONE phrase term,
    so typed adjacency counts; longer runs fall back to single words."""
    folded = tokens(query or "")[: MAX_QUERY_TERMS * 3]
    terms: list[str] = []
    run: list[str] = []

    def add(term: str) -> None:
        if term not in terms:
            terms.append(term)

    def flush() -> None:
        if 2 <= len(run) <= 4:
            add(" ".join(run))
        else:
            for word in run:
                add(word)
        run.clear()

    for source, english in translate_tokens(folded):
        if english is not None:
            flush()
            for term in english:
                add(term)
        elif _keep(source):
            run.append(source)
        else:
            flush()
    flush()
    return ExpandedQuery(terms=terms[:MAX_QUERY_TERMS])


def build_fts_query(expanded: ExpandedQuery) -> str:
    """``"url shortener" OR "url" OR "shortener" OR "cache"``. Empty string
    when nothing searchable is left (the caller returns no hits)."""
    parts: list[str] = []
    for term in expanded.terms:
        words = term.split()
        if len(words) > 1:
            parts.append('"' + " ".join(words) + '"')
        parts.extend(f'"{word}"' for word in words if _keep(word))
    unique: list[str] = []
    for part in parts:
        # Belt and braces: a part is a quoted run of [a-z0-9 ] and nothing else.
        if _SAFE_PART_RE.fullmatch(part) and part not in unique:
            unique.append(part)
    return " OR ".join(unique[:MAX_FTS_TERMS])


def make_snippet(text: str, words: list[str], limit: int = SNIPPET_CHARS) -> str:
    """Plain-text window (<= ``limit`` chars incl. ellipses) around the first
    occurrence of any query word; the start of the text when none occurs."""
    text = collapse_ws(text or "")
    if len(text) <= limit:
        return text
    first: int | None = None
    for word in words:
        stem = _stem(word) if len(word) > 4 else word
        match = re.search(r"\b" + re.escape(stem), text, re.IGNORECASE)
        if match and (first is None or match.start() < first):
            first = match.start()
    start = 0 if first is None else max(0, first - 80)
    if start > 0:
        space = text.find(" ", start)
        start = space + 1 if 0 <= space < (first or start) else start
    prefix = "…" if start > 0 else ""
    budget = limit - len(prefix) - 1  # room for the trailing ellipsis
    end = start + budget
    if end >= len(text):
        return prefix + text[start:]
    cut = text.rfind(" ", start, end)
    if cut <= start + budget // 2:
        cut = end
    return prefix + text[start:cut].rstrip() + "…"


_SUFFIXES = ("ations", "ation", "ions", "ion", "ings", "ing", "ers", "er", "es", "ed", "s")


def _stem(word: str) -> str:
    """Crude English stem: redirects/redirection -> redirect, caching/cache -> cach."""
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            break
    return word[:-1] if len(word) > 3 and word.endswith("e") else word


def _boost(featured: bool, upvotes: int | None) -> float:
    factor = 1.0 + (FEATURED_BOOST if featured else 0.0)
    if upvotes and upvotes > 0:
        factor += min(UPVOTE_BOOST_CAP, UPVOTE_BOOST_PER_DECADE * math.log10(1 + upvotes))
    return factor


@dataclass
class _Filters:
    design_sql: str
    design_params: list[Any]
    phase: str | None


def _filters(phase: str | None, category: str | None) -> _Filters | None:
    """SQL predicate on ``d`` (reference_designs) plus an optional phase.
    ``None`` = an impossible filter (a malformed phase): no results."""
    clauses = ["d.status = 'active'"]
    params: list[Any] = []
    phase_value = (phase or "").strip().lower() or None
    if phase_value is not None and not _PHASE_RE.match(phase_value):
        return None
    category_value = collapse_ws(category or "")
    if category_value:
        clauses.append("EXISTS (SELECT 1 FROM json_each(d.categories_json) c WHERE lower(c.value) = lower(?))")
        params.append(category_value)
    return _Filters(" AND ".join(clauses), params, phase_value)


def _residual_terms(expanded: ExpandedQuery, design_title: str) -> list[str]:
    """Query terms the design title does NOT already cover."""
    title_stems = {_stem(token) for token in tokens(design_title)}
    residual = []
    for term in expanded.terms:
        words = [word for word in term.split() if _keep(word)]
        if not words or not all(_stem(word) in title_stems for word in words):
            residual.append(term)
    return residual


def _step_texts(conn: sqlite3.Connection, step_ids: list[int]) -> dict[int, str]:
    if not step_ids:
        return {}
    placeholders = ",".join("?" for _ in step_ids)
    return {
        row["id"]: row["text"]
        for row in conn.execute(
            f"SELECT id, text FROM reference_steps WHERE id IN ({placeholders})",  # noqa: S608 - placeholders only
            step_ids,
        )
    }


def _steps_to_show(
    conn: sqlite3.Connection,
    design: sqlite3.Row,
    step_range: tuple[int, int] | None,
    stage_one: list[sqlite3.Row],
    expanded: ExpandedQuery,
    phase: str | None,
) -> tuple[list[sqlite3.Row], list[str]]:
    """Best steps of ONE design for the residual terms, topped up with the
    overall best ones. Step ids of a design are contiguous (the loader assigns
    them design by design), so a rowid range scopes the FTS query cheaply."""
    residual = _residual_terms(expanded, design["title"])
    residual_query = build_fts_query(ExpandedQuery(terms=residual)) if residual else ""
    if not residual_query or len(residual) == len(expanded.terms) or step_range is None:
        return stage_one[:STEPS_PER_DESIGN], expanded.words
    params: list[Any] = [residual_query, step_range[0], step_range[1]]
    phase_sql = ""
    if phase:
        phase_sql = " AND s.phase = ?"
        params.append(phase)
    rows = conn.execute(
        f"""
        SELECT s.id AS step_id, s.design_id, s.position, s.phase, s.title AS step_title,
               bm25(reference_step_fts, {STEP_WEIGHTS}) AS rank
          FROM reference_step_fts
          JOIN reference_steps s ON s.id = reference_step_fts.rowid
         WHERE reference_step_fts MATCH ? AND reference_step_fts.rowid BETWEEN ? AND ?{phase_sql}
         ORDER BY rank
         LIMIT {STEPS_PER_DESIGN}
        """,  # noqa: S608 - constants only; every value is bound
        params,
    ).fetchall()
    shown = list(rows)
    for step in stage_one:
        if len(shown) >= STEPS_PER_DESIGN:
            break
        if all(step["step_id"] != kept["step_id"] for kept in shown):
            shown.append(step)
    words = ExpandedQuery(terms=residual).words if rows else expanded.words
    return shown, words


def search(
    conn: sqlite3.Connection,
    query: str,
    *,
    limit: int = DEFAULT_LIMIT,
    phase: str | None = None,
    category: str | None = None,
) -> dict[str, Any]:
    limit = max(1, min(int(limit), MAX_LIMIT))
    expanded = expand_query(query)
    fts_query = build_fts_query(expanded)
    response: dict[str, Any] = {"query": query, "expanded_query": expanded.display, "total": 0, "items": []}
    filters = _filters(phase, category)
    if not fts_query or filters is None:
        return response
    step_where = filters.design_sql + (" AND s.phase = ?" if filters.phase else "")
    step_params = [*filters.design_params, *([filters.phase] if filters.phase else [])]

    # Stage 1a - step matches over the whole index, best first.
    step_rows = conn.execute(
        f"""
        SELECT s.id AS step_id, s.design_id, s.position, s.phase, s.title AS step_title,
               d.share_id, d.is_featured, d.upvote_count,
               bm25(reference_step_fts, {STEP_WEIGHTS}) AS rank
          FROM reference_step_fts
          JOIN reference_steps s ON s.id = reference_step_fts.rowid
          JOIN reference_designs d ON d.id = s.design_id
         WHERE reference_step_fts MATCH ? AND {step_where}
         ORDER BY rank
         LIMIT {CANDIDATES}
        """,  # noqa: S608 - weights, predicates and CANDIDATES are module constants; values are bound
        [fts_query, *step_params],
    ).fetchall()

    # Stage 1b - design matches (title, prompt, categories). With a phase
    # filter a design must ALSO have a matching step in that phase.
    design_rows = conn.execute(
        f"""
        SELECT d.id, d.share_id, d.is_featured, d.upvote_count,
               bm25(reference_design_fts, {DESIGN_WEIGHTS}) AS rank
          FROM reference_design_fts
          JOIN reference_designs d ON d.id = reference_design_fts.rowid
         WHERE reference_design_fts MATCH ? AND {filters.design_sql}
         ORDER BY rank
         LIMIT {CANDIDATES}
        """,  # noqa: S608 - as above
        [fts_query, *filters.design_params],
    ).fetchall()

    info: dict[int, tuple[str, bool, int | None]] = {}
    design_rel: dict[int, float] = {}
    for row in design_rows:
        design_rel[row["id"]] = -row["rank"]  # bm25 is "more negative = better"
        info[row["id"]] = (row["share_id"], bool(row["is_featured"]), row["upvote_count"])
    grouped: dict[int, list[sqlite3.Row]] = {}
    for row in step_rows:
        bucket = grouped.setdefault(row["design_id"], [])
        if len(bucket) < STEPS_PER_DESIGN:
            bucket.append(row)
        info.setdefault(row["design_id"], (row["share_id"], bool(row["is_featured"]), row["upvote_count"]))
    candidate_ids = set(grouped) if filters.phase else set(grouped) | set(design_rel)
    if not candidate_ids:
        return response

    ranked: list[tuple[float, int]] = []
    for design_id in candidate_ids:
        _share_id, featured, upvotes = info[design_id]
        steps = grouped.get(design_id, [])
        # Depth counts: several matching steps make a better reference than
        # one lucky short step.
        step_rel = sum(-step["rank"] * weight for step, weight in zip(steps, STEP_DEPTH_WEIGHTS, strict=False))
        relevance = design_rel.get(design_id, 0.0) + step_rel
        ranked.append((relevance * _boost(featured, upvotes), design_id))
    ranked.sort(key=lambda item: (-item[0], info[item[1]][0]))
    total = len(ranked)
    ranked = ranked[:limit]
    top_ids = [design_id for _, design_id in ranked]

    placeholders = ",".join("?" for _ in top_ids)  # at most MAX_LIMIT placeholders
    designs = {
        row["id"]: row
        for row in conn.execute(
            f"SELECT * FROM reference_designs WHERE id IN ({placeholders})",  # noqa: S608 - placeholders only
            top_ids,
        )
    }
    ranges = {
        row["design_id"]: (row["lo"], row["hi"])
        for row in conn.execute(
            "SELECT design_id, MIN(id) AS lo, MAX(id) AS hi FROM reference_steps "  # noqa: S608 - placeholders only
            f"WHERE design_id IN ({placeholders}) GROUP BY design_id",
            top_ids,
        )
    }

    items = []
    for score, design_id in ranked:
        design = designs[design_id]
        shown, words = _steps_to_show(
            conn, design, ranges.get(design_id), grouped.get(design_id, []), expanded, filters.phase
        )
        texts = _step_texts(conn, [step["step_id"] for step in shown])
        items.append(
            {
                "share_id": design["share_id"],
                "url": share_url(design["share_id"]),
                "title": design["title"],
                "prompt": design["prompt"],
                "categories": json.loads(design["categories_json"]),
                "tab": design["tab"],
                "design_source": design["design_source"],
                "source_blog_name": design["source_blog_name"],
                "source_article_url": safe_http_url(design["source_article_url"]),
                "upvote_count": design["upvote_count"],
                "updated_at": design["updated_at"],
                "score": round(score, 4),
                "steps": [
                    {
                        "position": step["position"],
                        "title": step["step_title"],
                        "phase": step["phase"],
                        "snippet": make_snippet(texts.get(step["step_id"], ""), words),
                    }
                    for step in shown
                ],
            }
        )
    response["total"] = total
    response["items"] = items
    return response
