"""Pure parsers for SysDesAi pages (KH-P1-03). No I/O, no network.

SysDesAi is a Next.js app. Each page streams its React Server Components
payload as ``<script>self.__next_f.push([1,"..."])</script>`` chunks; every
chunk is a JSON string literal, and the joined strings contain plain JSON
objects we can decode with ``json.JSONDecoder.raw_decode``:

* gallery pages: one object per design, starting ``{"shareId":"...``;
* share pages: ``{"session":{..., "steps":[...]}, "shareId":..., "designSource":...}``.

This is SysDesAi's internal structure and can change without notice, so
``parse_share_page`` degrades instead of failing: if no usable ``steps`` array
is found it returns the page's visible text as ONE step and sets
``schema_warning`` (the crawler then keeps any good data it already had).

Fields we never keep: author name/username/avatar, comments, share counts.
"""

from __future__ import annotations

import hashlib
import html as html_lib
import json
import re
from dataclasses import dataclass, field
from typing import Any

from .textnorm import collapse_ws

BASE_URL = "https://www.sysdesai.com"
SHARE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,40}$")
MAX_STEP_CHARS = 8_000
MAX_FALLBACK_CHARS = 8_000
# A mermaid diagram is kept only as its node/edge LABELS (see _mermaid_labels).
MAX_DIAGRAM_LABEL_CHARS = 600

PHASES = ("clarify", "problem", "scope", "estimate", "api", "data", "build", "flows", "scale", "wrap")

_RSC_CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)\s*</script>', re.S)
_SITEMAP_SHARE_RE = re.compile(r"<loc>\s*https?://(?:www\.)?sysdesai\.com/share/([A-Za-z0-9_-]{3,40})/?\s*</loc>")
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
_META_DESC_RE = re.compile(r'<meta\s+name="description"\s+content="(.*?)"', re.S | re.I)
_SCRIPT_STYLE_RE = re.compile(r"<(script|style|noscript|svg)\b.*?</\1\s*>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_MERMAID_START_RE = re.compile(
    r"^\s*(flowchart|graph|sequenceDiagram|erDiagram|classDiagram|stateDiagram|gantt|journey|mindmap)\b"
)

# Keys whose string values are machine detail, not prose worth indexing.
_SKIP_KEYS = frozenset({"id", "type", "status", "icon", "color", "phase", "x", "y", "from", "to", "method"})
# Prose first, so the 8,000-character cap cuts tables and lists, not the narrative.
_LEAD_KEYS = (
    "script", "designChallenge", "approach", "whyItMatters", "designSummary", "componentName",
    "flowName", "rationale", "rateLimiting", "indexingStrategy", "functional", "nonFunctional",
)

# Gallery metadata we keep. Everything else in the object (authorName,
# authorImageUrl, authorUsername, shareCount, commentCount, hasUpvoted...) is
# dropped here, at the boundary.
_GALLERY_FIELDS = (
    "shareId", "title", "prompt", "categories", "upvoteCount", "isFeatured", "designSource",
    "sourceBlogName", "sourceArticleUrl", "createdAt", "updatedAt", "totalSteps",
)


@dataclass
class ParsedStep:
    position: int
    step_key: str | None
    phase: str
    title: str
    text: str

    def to_json(self) -> dict[str, Any]:
        return {
            "position": self.position,
            "stepKey": self.step_key,
            "phase": self.phase,
            "title": self.title,
            "text": self.text,
        }


@dataclass
class ParsedShare:
    share_id: str
    title: str
    prompt: str
    design_source: str | None = None
    source_blog_name: str | None = None
    source_article_url: str | None = None
    gallery_tab: str | None = None
    steps: list[ParsedStep] = field(default_factory=list)
    schema_warning: str | None = None


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def extract_rsc_payload(html: str) -> str:
    """Join every ``self.__next_f.push([1,"..."])`` chunk, JSON-unescaped."""
    parts: list[str] = []
    for chunk in _RSC_CHUNK_RE.findall(html):
        try:
            parts.append(json.loads('"' + chunk + '"'))
        except json.JSONDecodeError:
            continue  # one damaged chunk must not lose the rest
    return "".join(parts)


def safe_http_url(value: Any) -> str | None:
    """Only ``http(s)://`` URLs survive. A ``javascript:`` URL from a third
    party would otherwise become a clickable link in the SPA."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if len(candidate) > 2_000 or not re.match(r"^https?://[^\s<>\"']+$", candidate, re.I):
        return None
    return candidate


def share_url(share_id: str) -> str:
    return f"{BASE_URL}/share/{share_id}"


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    return cut[:space] if space > limit * 0.8 else cut


def _str_or_none(value: Any, limit: int = 500) -> str | None:
    if isinstance(value, str) and value.strip():
        return collapse_ws(value)[:limit]
    return None


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _iter_objects(payload: str, marker: str):
    """Yield every JSON object in ``payload`` that starts with ``marker``."""
    decoder = json.JSONDecoder()
    start = 0
    while True:
        index = payload.find(marker, start)
        if index < 0:
            return
        try:
            obj, end = decoder.raw_decode(payload, index)
        except json.JSONDecodeError:
            start = index + len(marker)
            continue
        yield obj
        start = end


# ---------------------------------------------------------------------------
# Sitemap and gallery
# ---------------------------------------------------------------------------


def parse_sitemap(xml: str) -> list[str]:
    """``/share/{id}`` ids in sitemap order, de-duplicated."""
    seen: dict[str, None] = {}
    for share_id in _SITEMAP_SHARE_RE.findall(xml):
        seen.setdefault(share_id, None)
    return list(seen)


def parse_gallery_page(html: str) -> list[dict[str, Any]]:
    """Design cards on one gallery page, reduced to the fields we keep."""
    payload = extract_rsc_payload(html)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for obj in _iter_objects(payload, '{"shareId":"'):
        if not isinstance(obj, dict):
            continue
        share_id = obj.get("shareId")
        if not isinstance(share_id, str) or not SHARE_ID_RE.match(share_id) or share_id in seen:
            continue
        if not isinstance(obj.get("title"), str):
            continue
        seen.add(share_id)
        card = {key: obj.get(key) for key in _GALLERY_FIELDS}
        categories = obj.get("categories")
        if not isinstance(categories, list):
            categories = []
        card["categories"] = [collapse_ws(c)[:80] for c in categories if isinstance(c, str) and c.strip()]
        card["title"] = collapse_ws(obj["title"])[:300]
        card["prompt"] = _str_or_none(obj.get("prompt"), 2_000) or ""
        card["upvoteCount"] = _int_or_none(obj.get("upvoteCount"))
        card["totalSteps"] = _int_or_none(obj.get("totalSteps"))
        card["isFeatured"] = obj.get("isFeatured") is True
        card["designSource"] = obj.get("designSource") if obj.get("designSource") in ("user", "article") else None
        card["sourceBlogName"] = _str_or_none(obj.get("sourceBlogName"), 200)
        card["sourceArticleUrl"] = safe_http_url(obj.get("sourceArticleUrl"))
        card["createdAt"] = _str_or_none(obj.get("createdAt"), 40)
        card["updatedAt"] = _str_or_none(obj.get("updatedAt"), 40)
        out.append(card)
    return out


# ---------------------------------------------------------------------------
# Share page
# ---------------------------------------------------------------------------


def _mermaid_labels(script: str) -> str:
    """Node and edge labels of a mermaid diagram, without the syntax.

    Decision: diagrams are indexed as their LABELS only. Labels ("Cache
    (Redis)", "Load Balancer") carry the component vocabulary people search
    for; arrows, ids and layout keywords are noise that would inflate the
    step's length and dilute BM25. Capped at 600 characters.
    """
    labels: list[str] = []
    patterns = (
        r'"([^"\n]{1,120})"',  # A["Label"], -->|"label"|
        r"\[([^\[\]\n\"]{1,120})\]",  # A[Label]
        r"\(([^()\n\"]{1,120})\)",  # A(Label)
        r"\{([^{}\n\"]{1,120})\}",  # A{Decision}
        r"subgraph\s+([^\n\[]{1,120})",  # subgraph Data Layer
        r"\|([^|\n\"]{1,120})\|",  # -->|label|
        r"(?:->>|-->>|->|-x|--x|-\)|--\))[^:\n]*:\s*([^\n]{1,160})",  # sequence messages
    )
    for pattern in patterns:
        for match in re.findall(pattern, script):
            label = collapse_ws(match)
            if label and label not in labels:
                labels.append(label)
    return _clip(", ".join(labels), MAX_DIAGRAM_LABEL_CHARS)


def _flatten(value: Any, key: str | None, out: list[str], seen: set[str]) -> None:
    if isinstance(value, str):
        if key in _SKIP_KEYS:
            return
        text = value
        if key == "diagram" or _MERMAID_START_RE.match(text):
            text = _mermaid_labels(text)
        text = collapse_ws(text)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    elif isinstance(value, dict):
        lead = [k for k in _LEAD_KEYS if k in value]
        rest = [k for k in value if k not in lead]
        for k in lead + rest:
            _flatten(value[k], k, out, seen)
    elif isinstance(value, list):
        for item in value:
            _flatten(item, key, out, seen)
    # numbers, booleans and null carry no searchable prose


def flatten_content(content: Any) -> str:
    """Every string leaf of a step's ``content``, prose first, de-duplicated,
    whitespace collapsed, at most 8,000 characters."""
    pieces: list[str] = []
    _flatten(content, None, pieces, set())
    return _clip(" · ".join(pieces), MAX_STEP_CHARS)


def visible_text(html: str) -> str:
    """The page's human-visible text: scripts/styles dropped, tags stripped."""
    body = _SCRIPT_STYLE_RE.sub(" ", html)
    body = _TAG_RE.sub(" ", body)
    return collapse_ws(html_lib.unescape(body))


def _page_title(html: str) -> str:
    match = _TITLE_RE.search(html)
    if not match:
        return ""
    title = collapse_ws(html_lib.unescape(match.group(1)))
    return re.sub(r"\s*\|\s*SysDesAi\s*$", "", title)


def _page_description(html: str) -> str:
    match = _META_DESC_RE.search(html)
    return collapse_ws(html_lib.unescape(match.group(1))) if match else ""


def _steps_from_array(raw_steps: Any) -> list[ParsedStep] | None:
    """``None`` when the array does not look like SysDesAi steps any more."""
    if not isinstance(raw_steps, list) or not raw_steps:
        return None
    steps: list[ParsedStep] = []
    for index, raw in enumerate(raw_steps):
        if not isinstance(raw, dict):
            return None
        title = raw.get("title")
        data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
        phase = raw.get("phase") or data.get("phase")
        if not isinstance(title, str) or not isinstance(phase, str):
            return None
        content = data.get("content", {})
        steps.append(
            ParsedStep(
                position=index + 1,  # SysDesAi shows the clarify step as "Bước 1"
                step_key=raw.get("id") if isinstance(raw.get("id"), str) else None,
                phase=collapse_ws(phase)[:32].lower(),
                title=collapse_ws(title)[:300],
                text=flatten_content(content),
            )
        )
    return steps


def _find_session_props(payload: str) -> dict[str, Any] | None:
    for obj in _iter_objects(payload, '{"session":{'):
        if isinstance(obj, dict) and isinstance(obj.get("session"), dict):
            return obj
    return None


def _find_steps_array(payload: str) -> Any:
    marker = '"steps":['
    index = payload.find(marker)
    if index < 0:
        return None
    try:
        array, _ = json.JSONDecoder().raw_decode(payload, index + len('"steps":'))
    except json.JSONDecodeError:
        return None
    return array


def parse_share_page(html: str, share_id: str) -> ParsedShare:
    """One design page -> metadata + steps, or the visible-text fallback."""
    payload = extract_rsc_payload(html)
    props = _find_session_props(payload)
    session = props.get("session") if props else None

    title = ""
    prompt = ""
    if isinstance(session, dict):
        title = _str_or_none(session.get("title"), 300) or ""
        prompt = _str_or_none(session.get("prompt"), 2_000) or ""
    title = title or _page_title(html) or share_id
    prompt = prompt or _page_description(html)

    parsed = ParsedShare(share_id=share_id, title=title, prompt=prompt)
    if props:
        source = props.get("designSource")
        parsed.design_source = source if source in ("user", "article") else None
        parsed.source_blog_name = _str_or_none(props.get("sourceBlogName"), 200)
        parsed.source_article_url = safe_http_url(props.get("sourceArticleUrl"))
        tab = props.get("galleryTab")
        parsed.gallery_tab = tab if tab in ("featured", "real-world", "community") else None

    raw_steps = session.get("steps") if isinstance(session, dict) else None
    steps = _steps_from_array(raw_steps)
    if steps is None:
        steps = _steps_from_array(_find_steps_array(payload))
    if steps is not None:
        parsed.steps = steps
        return parsed

    # Fallback (AC-06): the page's visible text as a single step.
    parsed.schema_warning = "steps JSON not found or changed shape; indexed the page's visible text instead"
    text = _clip(visible_text(html), MAX_FALLBACK_CHARS)
    if text:
        parsed.steps = [ParsedStep(position=1, step_key=None, phase="page", title=title, text=text)]
    return parsed


def content_hash(title: str, prompt: str, steps: list[dict[str, Any]]) -> str:
    """Stable hash of what we index, so a refresh can tell "changed" from "same"."""
    canonical = json.dumps(
        {"title": title, "prompt": prompt, "steps": [[s["phase"], s["title"], s["text"]] for s in steps]},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
