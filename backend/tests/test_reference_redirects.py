"""Security review 2026-10-15 #2: the crawler only follows redirects that stay on SysDesAi."""

from __future__ import annotations

import urllib.error
import urllib.request

import pytest

from app.reference.crawler import SameSiteRedirectHandler
from app.reference.parser import BASE_URL


def _request() -> urllib.request.Request:
    return urllib.request.Request(BASE_URL + "/share/abc", method="GET")  # noqa: S310 - fixed https URL


@pytest.mark.parametrize(
    "target",
    [
        "http://127.0.0.1:8000/api/openapi.json",
        "http://host.docker.internal:8000/",
        "http://192.168.1.10/admin",
        "https://www.sysdesai.com.evil.example/share/x",
        "https://sysdesai.com/share/x",
        "ftp://www.sysdesai.com/share/x",
    ],
)
def test_off_site_redirects_are_refused(target: str) -> None:
    handler = SameSiteRedirectHandler()
    with pytest.raises(urllib.error.HTTPError) as exc:
        handler.redirect_request(_request(), None, 302, "Found", {}, target)
    assert exc.value.code == 302


def test_same_site_redirects_are_followed() -> None:
    handler = SameSiteRedirectHandler()
    new = handler.redirect_request(_request(), None, 301, "Moved", {}, BASE_URL + "/share/def")
    assert new is not None and new.full_url == BASE_URL + "/share/def"
