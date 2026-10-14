"""SPA fallback edge cases found in review-v2-phase0 (see tests/test_spa.py for the basics).

* A NUL byte in the path made StaticFiles raise ValueError: an unauthenticated
  500 with a traceback in the log, on every OS. Now a 404.
* Cache headers followed the raw URL, so ``/assets/..%2findex.html`` served
  index.html as ``immutable`` and ``/index.html/`` without ``no-store``.
* Traversal: nothing outside the static directory is ever served.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.test_spa import HTML, INDEX

MARKER = "MARKER-FILE-OUTSIDE-STATIC"


@pytest.fixture()
def spa(temp_settings, seeded_user, monkeypatch, tmp_path):
    """Same fake build as tests/test_spa.py, with the static dir one level
    below tmp_path so a traversal target can sit right next to it."""
    from app.config import reset_settings_cache
    from app.main import create_app
    from app.routers.auth import reset_throttle_state

    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text(INDEX, encoding="utf-8")
    (static / "assets" / "index-abc123.js").write_text("console.log('spa')", encoding="utf-8")
    (tmp_path / "secret.txt").write_text(MARKER, encoding="utf-8")
    monkeypatch.setenv("ARCHPILOT_STATIC_DIR", str(static))
    reset_settings_cache()
    reset_throttle_state()
    with TestClient(create_app()) as test_client:
        yield test_client
    reset_settings_cache()


@pytest.mark.parametrize("path", ["/hub%00x", "/assets/x%00.js", "/%00", "/designs/a%00b"])
@pytest.mark.parametrize("accept", ["text/html", "*/*"])
def test_a_nul_byte_in_the_path_is_a_404_not_a_500(spa, path, accept):
    response = spa.get(path, headers={"accept": accept})
    assert response.status_code == 404
    assert set(response.json()) == {"detail", "requestId"}


def test_an_over_long_path_is_never_a_500(spa):
    response = spa.get("/" + "a" * 5000, headers=HTML)
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        assert response.text == INDEX


@pytest.mark.parametrize("path", ["/assets/..%2findex.html", "/assets/%2e%2e/index.html"])
def test_index_html_reached_through_assets_is_not_immutable(spa, path):
    response = spa.get(path, headers=HTML)
    assert response.status_code == 200
    assert response.text == INDEX
    assert response.headers["cache-control"] == "no-store"


def test_index_html_with_a_trailing_slash_is_still_no_store(spa):
    response = spa.get("/index.html/", headers=HTML)
    if response.status_code == 200:
        assert response.headers["cache-control"] == "no-store"


def test_an_asset_reached_by_a_non_canonical_path_is_still_immutable(spa):
    response = spa.get("/assets/sub/../index-abc123.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.parametrize(
    "path",
    [
        "/..%2fsecret.txt",
        "/%2e%2e/secret.txt",
        "/..%5csecret.txt",
        "/%2e%2e%5csecret.txt",
        "/assets/..%2f..%2fsecret.txt",
        "/assets/%2e%2e%5c%2e%2e%5csecret.txt",
        "/assets%2f..%2f..%2fsecret.txt",
        "/static/../secret.txt",
    ],
)
@pytest.mark.parametrize("accept", ["text/html", "*/*"])
def test_nothing_outside_the_static_directory_is_served(spa, path, accept):
    response = spa.get(path, headers={"accept": accept})
    assert MARKER not in response.text
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        assert response.text == INDEX
