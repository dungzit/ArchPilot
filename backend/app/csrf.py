"""Double-submit CSRF protection for cookie-authenticated mutating requests.

Why this exists now rather than at task 7.3
-------------------------------------------
``SameSite=lax`` blocks the cookie on a cross-site *form* POST, and a
cross-origin JSON POST needs a CORS preflight the server will not grant. So the
practical exposure today is small. It is not zero, and more importantly it is
not *durable*: the moment a route accepts a simple content type, a subdomain is
added, a browser relaxes SameSite defaults, or ``ARCHPILOT_CORS_ORIGINS`` gains
an entry, the whole mutating surface is exposed at once. The guard is ~40 lines
and is cheaper to add before the design/workspace/sizing/admin routers land than
to retrofit across them.

Model: double-submit.
  * login mints a random token, sets it in a readable (non-httpOnly) cookie and
    returns it in the response body;
  * the SPA echoes it in ``x-csrf-token`` on every unsafe request;
  * the server compares header and cookie in constant time.

The check applies only when the request actually carries the session cookie. A
scripted client using ``Authorization: Bearer`` is not subject to CSRF (a
browser will not attach that header cross-site), and an unauthenticated request
is rejected by the route's own auth dependency.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from .config import Settings
from .security import constant_time_equals

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CSRF_HEADER = "x-csrf-token"

# Login has no session yet, so there is nothing to protect and no token to send.
EXEMPT_PATHS = frozenset({"/api/auth/login"})


def csrf_failure(reason: str, request_id: str) -> JSONResponse:
    # Shape and casing are fixed by contracts/archgraph.schema.json
    # #/$defs/errorResponse - {detail, requestId?}, camelCase. Asserted by
    # tests/test_contracts.py::test_csrf_rejection_obeys_the_error_shape.
    return JSONResponse(
        status_code=403,
        content={"detail": f"csrf check failed: {reason}", "requestId": request_id},
    )


def enforce_csrf(request: Request, settings: Settings, request_id: str) -> JSONResponse | None:
    """Return a 403 response when the double-submit check fails, else None."""
    if request.method not in UNSAFE_METHODS:
        return None
    if request.url.path in EXEMPT_PATHS:
        return None

    session_cookie = request.cookies.get(settings.session_cookie_name)
    if not session_cookie:
        # Bearer-token or unauthenticated call: not a browser-cookie flow.
        return None

    cookie_token = request.cookies.get(settings.csrf_cookie_name)
    header_token = request.headers.get(CSRF_HEADER)
    if not cookie_token or not header_token:
        return csrf_failure("missing csrf token", request_id)
    if not constant_time_equals(cookie_token, header_token):
        return csrf_failure("csrf token mismatch", request_id)
    return None
