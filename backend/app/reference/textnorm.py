"""Text normalisation shared by the indexer and the query builder.

``fold`` is the single definition of "the same word" for search: NFKC, then
NFD with every combining mark removed, ``đ -> d``, lowercase. Vietnamese typed
with or without diacritics ("bộ nhớ đệm", "bo nho dem") folds to the same
string, and so does fullwidth or composed/decomposed input.

``tokens`` only ever returns ``[a-z0-9]+`` runs. That is the safety property
the FTS5 query builder relies on: a token can never contain a quote, a
bracket, ``*``, ``:``, ``^`` or any other FTS5 syntax character.
"""

from __future__ import annotations

import re
import unicodedata

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_WS_RE = re.compile(r"\s+")

# Function words in both languages. Dropped from queries because, after
# folding, several Vietnamese ones collide with English words ("an" < "ăn",
# "the" < "thế") and every one of them matches most steps anyway.
STOPWORDS: frozenset[str] = frozenset(
    {
        # English
        "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "how", "i",
        "in", "into", "is", "it", "its", "of", "on", "or", "our", "that", "the", "their",
        "this", "to", "we", "what", "when", "which", "with", "you", "your", "vs",
        # Vietnamese (already folded)
        "ai", "bi", "boi", "cac", "can", "cho", "chung", "co", "cua", "da", "dang", "de",
        "den", "duoc", "gi", "hay", "hoac", "khi", "khong", "la", "lam", "mot", "nao",
        "neu", "nhieu", "nhu", "nhung", "noi", "ra", "rang", "sao", "se", "tai", "theo",
        "thi", "toi", "trong", "tu", "va", "vao", "ve", "voi", "vi", "nay", "cung",
        "rat", "cai", "con", "nen", "phai", "muon", "biet", "nhe", "oi",
    }
)


def fold(text: str) -> str:
    """Lowercase, strip diacritics (Vietnamese included), map ``đ`` to ``d``."""
    if not text:
        return ""
    normalised = unicodedata.normalize("NFKC", text)
    decomposed = unicodedata.normalize("NFD", normalised)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return stripped.replace("đ", "d").replace("Đ", "D").lower()


def tokens(text: str) -> list[str]:
    """Folded ``[a-z0-9]+`` tokens, in order, duplicates kept."""
    return _TOKEN_RE.findall(fold(text))


def collapse_ws(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()
