"""``scripts/create_user.py`` - the documented way to create the first local user."""

from __future__ import annotations

import io

import pytest


class _FakeStdin(io.StringIO):
    def __init__(self, text: str, *, tty: bool) -> None:
        super().__init__(text)
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty


@pytest.fixture()
def run(temp_settings, monkeypatch):
    from scripts import create_user

    def _run(argv: list[str], stdin: str = "", *, tty: bool = False) -> int:
        monkeypatch.setattr("sys.stdin", _FakeStdin(stdin, tty=tty))
        return create_user.main(argv)

    return _run


def test_password_from_stdin_creates_a_user_who_can_log_in(run, temp_settings, capsys):
    assert run(["alice", "--role", "admin", "--password-stdin"], "a-long-enough-password\r\n") == 0
    assert "created user alice (admin)" in capsys.readouterr().out

    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.post("/api/auth/login", json={"username": "alice", "password": "a-long-enough-password"})
        assert response.status_code == 200
        assert response.json()["user"]["role"] == "admin"


def test_it_migrates_a_brand_new_database_first(run, temp_settings):
    assert not temp_settings.db_path.exists()
    assert run(["bob", "--password-stdin"], "a-long-enough-password\n") == 0


def test_weak_password_is_exit_2(run, capsys):
    assert run(["carol", "--password-stdin"], "short\n") == 2
    assert "at least 12 characters" in capsys.readouterr().err


def test_duplicate_username_is_exit_3(run):
    assert run(["dave", "--password-stdin"], "a-long-enough-password\n") == 0
    assert run(["DAVE", "--password-stdin"], "a-long-enough-password\n") == 3


def test_no_tty_and_no_flag_refuses_instead_of_hanging_on_a_prompt(run, capsys):
    assert run(["erin"], "a-long-enough-password\n", tty=False) == 2
    assert "--password-stdin" in capsys.readouterr().err


def test_interactive_prompt_requires_matching_confirmation(run, monkeypatch):
    answers = iter(["a-long-enough-password", "a-different-password"])
    monkeypatch.setattr("getpass.getpass", lambda prompt="": next(answers))
    assert run(["frank"], tty=True) == 2


def test_there_is_no_way_to_pass_the_password_as_an_argument(run):
    with pytest.raises(SystemExit) as exc:
        run(["mallory", "--password", "a-long-enough-password"])
    assert exc.value.code == 2  # argparse: unrecognized arguments
