"""Serve the built SPA from the API's origin, with a history-API fallback (task 0.5).

The SPA now uses ``react-router`` (design-v2 D-14), so a deep link such as
``/designs/dsg_1`` or ``/hub/some-pattern`` must return ``index.html`` and let
the router draw the page. The obvious catch-all breaks two things (red-team
review M9), so the fallback is deliberately narrow. ``index.html`` is served
for a missing path ONLY when all of these hold:

* the method is GET or HEAD (anything else is a 405 from StaticFiles);
* the path is not under ``/api`` - an unknown API path must stay a JSON 404 in
  the ``{detail, requestId}`` envelope, never an HTML 200 (API routes are
  matched before this mount, so they can never be shadowed by it);
* the path is not under ``/assets/`` - a stale tab asking for
  ``index-OLD.js`` after a deploy must get a 404, not HTML that ``nosniff``
  then blocks into a blank page;
* the client asked for HTML (``Accept`` contains ``text/html``), which a
  browser navigation always does and ``fetch()`` by default does not.

Caching: ``index.html`` is ``no-store`` (it names the current hashed bundle);
``/assets/*`` files are content-hashed by Vite, so they are ``immutable``.
"""

from __future__ import annotations

from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

SPA_SHELL = "index.html"
NO_STORE = "no-store"
IMMUTABLE = "public, max-age=31536000, immutable"


def is_api_path(path: str) -> bool:
    return path == "/api" or path.startswith("/api/")


def is_asset_path(path: str) -> bool:
    return path.startswith("/assets/")


def accepts_html(scope: Scope) -> bool:
    for name, value in scope.get("headers", ()):
        if name == b"accept":
            return b"text/html" in value.lower()
    return False


def should_fall_back(scope: Scope) -> bool:
    path = scope.get("path", "")
    return (
        scope.get("method") in ("GET", "HEAD")
        and not is_api_path(path)
        and not is_asset_path(path)
        and accepts_html(scope)
    )


class SpaStaticFiles(StaticFiles):
    """``StaticFiles(html=True)`` plus the narrow fallback described above."""

    def __init__(self, *, directory: str) -> None:
        super().__init__(directory=directory, html=True)

    async def get_response(self, path: str, scope: Scope) -> Response:
        request_path = scope.get("path", "")
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or not should_fall_back(scope):
                raise
            response = await super().get_response(SPA_SHELL, scope)
            response.headers["cache-control"] = NO_STORE
            return response

        if request_path in ("/", f"/{SPA_SHELL}"):
            response.headers["cache-control"] = NO_STORE
        elif is_asset_path(request_path) and response.status_code == 200:
            response.headers["cache-control"] = IMMUTABLE
        return response
