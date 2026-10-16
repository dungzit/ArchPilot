"""Request body size guard (build-scope 7.2 item 3c; review-v2-phase0 M2).

uvicorn has no body limit, and the 1 MiB graph cap in ``app/schemas.py`` runs
only after the whole body has been read and parsed on the event loop. This
pure-ASGI middleware refuses a body larger than ``max_bytes`` before any of that:

* a declared ``Content-Length`` over the limit -> **413** at once, body unread;
* a streamed (chunked) body is counted as it arrives; the request fails as soon
  as it passes the limit, so memory stays bounded. FastAPI reports that as its
  generic 400 "error parsing the body" - still in the error envelope.

The limit is generous on purpose (4 MiB by default): a legitimate 1 MiB graph
sent as pretty-printed or ``\\uXXXX``-escaped JSON is larger on the wire than
the compact UTF-8 the graph cap measures. A reverse proxy in front of the
container may set a tighter ``client_max_body_size``; this is the floor that
holds without one.
"""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024


class BodyTooLargeError(Exception):
    """A streamed body passed the limit."""


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = DEFAULT_MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _content_length(scope)
        if declared is not None and declared > self.max_bytes:
            await self._reject(scope, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLargeError(f"request body exceeds {self.max_bytes} bytes")
            return message

        await self.app(scope, limited_receive, send)

    async def _reject(self, scope: Scope, send: Send) -> None:
        body: dict[str, str] = {"detail": f"request body is larger than {self.max_bytes} bytes"}
        request_id = (scope.get("state") or {}).get("request_id")
        if request_id:
            body["requestId"] = request_id
        payload = json.dumps(body).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": payload})


def _content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", ()):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None  # h11 already rejects a malformed length; stay permissive here
    return None
