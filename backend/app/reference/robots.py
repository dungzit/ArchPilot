"""robots.txt policy: ``urllib.robotparser`` AND a longest-match check.

Why two checks. ``urllib.robotparser`` applies rules in FILE ORDER (first
match wins). SysDesAi's file starts its ``*`` group with ``Allow: /`` and only
then lists ``Disallow: /design/``, so the stdlib parser alone answers "allowed"
for ``/design/abc`` - exactly the private pages we must never touch. The
de-facto standard (RFC 9309, Google) is longest-match, where the more specific
``Disallow: /design/`` wins. A URL is fetched only if BOTH say yes.
"""

from __future__ import annotations

import re
import urllib.robotparser
from urllib.parse import urlsplit


class RobotsPolicy:
    def __init__(self, text: str, user_agent: str) -> None:
        self.user_agent = user_agent
        self._stdlib = urllib.robotparser.RobotFileParser()
        self._stdlib.parse(text.splitlines())
        self._rules = _select_rules(text, user_agent)

    @classmethod
    def allow_all(cls, user_agent: str) -> RobotsPolicy:
        """robots.txt answered 404: by convention everything is allowed."""
        return cls("", user_agent)

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        path = parts.path or "/"
        if parts.query:
            path = f"{path}?{parts.query}"
        return self._stdlib.can_fetch(self.user_agent, url) and _longest_match_allows(self._rules, path)


def _product_token(user_agent: str) -> str:
    return user_agent.split("/", 1)[0].strip().lower()


def _select_rules(text: str, user_agent: str) -> list[tuple[bool, str]]:
    """Rules of the group naming our product token, else of the ``*`` group."""
    token = _product_token(user_agent)
    groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
    agents: list[str] = []
    rules: list[tuple[bool, str]] = []
    in_rules = False
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        name, value = (part.strip() for part in line.split(":", 1))
        name = name.lower()
        if name == "user-agent":
            if in_rules:
                groups.append((agents, rules))
                agents, rules, in_rules = [], [], False
            agents.append(value.lower())
        elif name in ("allow", "disallow"):
            in_rules = True
            if name == "disallow" and not value:
                continue  # "Disallow:" with no path allows everything
            rules.append((name == "allow", value))
    if agents:
        groups.append((agents, rules))

    for group_agents, group_rules in groups:
        if any(agent != "*" and agent in token for agent in group_agents):
            return group_rules
    merged: list[tuple[bool, str]] = []
    for group_agents, group_rules in groups:
        if "*" in group_agents:
            merged.extend(group_rules)
    return merged


def _pattern_regex(pattern: str) -> re.Pattern[str]:
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    regex = "".join(".*" if ch == "*" else re.escape(ch) for ch in body)
    return re.compile(regex + ("$" if anchored else ""))


def _longest_match_allows(rules: list[tuple[bool, str]], path: str) -> bool:
    best_len = -1
    best_allow = True
    for allow, pattern in rules:
        if not pattern:
            continue
        if _pattern_regex(pattern).match(path):
            length = len(pattern)
            # Longest pattern wins; on a tie the less restrictive (allow) wins.
            if length > best_len or (length == best_len and allow):
                best_len, best_allow = length, allow
    return best_allow
