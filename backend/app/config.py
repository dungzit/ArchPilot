"""Runtime configuration, read from environment variables.

No pydantic-settings dependency: a frozen dataclass plus os.environ is enough
for a single-container internal tool and keeps the dependency list at three.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


def _env_list(name: str, default: list[str]) -> list[str]:
    """Comma-separated list.

    An explicitly-empty value means "empty list", not "use the default". The
    production deployment serves the SPA same-origin and must therefore be able
    to turn CORS off entirely with ``ARCHPILOT_CORS_ORIGINS=``.
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    """Immutable process configuration."""

    env: str = field(default_factory=lambda: os.environ.get("ARCHPILOT_ENV", "development"))
    db_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("ARCHPILOT_DB_PATH", str(BACKEND_ROOT / "data" / "archpilot.db"))
        ).resolve()
    )
    backup_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("ARCHPILOT_BACKUP_DIR", str(BACKEND_ROOT / "data" / "backups"))
        ).resolve()
    )
    # Vite dev server origin. The production container serves the SPA same-origin,
    # so this list is only meaningful during development.
    cors_origins: list[str] = field(
        default_factory=lambda: _env_list(
            "ARCHPILOT_CORS_ORIGINS", ["http://localhost:5173", "http://127.0.0.1:5173"]
        )
    )
    session_ttl_hours: int = field(default_factory=lambda: _env_int("ARCHPILOT_SESSION_TTL_HOURS", 12))
    session_cookie_name: str = field(
        default_factory=lambda: os.environ.get("ARCHPILOT_SESSION_COOKIE", "archpilot_session")
    )
    # Double-submit CSRF token. Readable by the SPA (not httpOnly) on purpose:
    # the SPA must echo it in the x-csrf-token header on every mutating call.
    csrf_cookie_name: str = field(
        default_factory=lambda: os.environ.get("ARCHPILOT_CSRF_COOKIE", "archpilot_csrf")
    )
    # Set to true whenever the app is reachable over HTTPS (i.e. always in prod).
    cookie_secure: bool = field(default_factory=lambda: _env_bool("ARCHPILOT_COOKIE_SECURE", False))
    pbkdf2_iterations: int = field(default_factory=lambda: _env_int("ARCHPILOT_PBKDF2_ITERATIONS", 600_000))
    # Deep health probe budget in seconds (red-team M12: a shallow probe hides a locked DB).
    health_timeout_seconds: float = field(
        default_factory=lambda: float(os.environ.get("ARCHPILOT_HEALTH_TIMEOUT", "2.0"))
    )
    log_level: str = field(default_factory=lambda: os.environ.get("ARCHPILOT_LOG_LEVEL", "INFO"))
    # Take a VACUUM INTO snapshot before applying any pending migration.
    # Forward-only migrations mean rollback == restore-from-backup (red-team B4,
    # risk R8), so the backup has to exist before the migration runs.
    backup_before_migrate: bool = field(
        default_factory=lambda: _env_bool("ARCHPILOT_BACKUP_BEFORE_MIGRATE", True)
    )

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def validate(self) -> None:
        if self.session_ttl_hours <= 0:
            raise ValueError("ARCHPILOT_SESSION_TTL_HOURS must be > 0")
        if self.pbkdf2_iterations < 100_000:
            raise ValueError("ARCHPILOT_PBKDF2_ITERATIONS must be >= 100000")
        if self.is_production and not self.cookie_secure:
            raise ValueError("ARCHPILOT_COOKIE_SECURE must be true in production")
        if self.is_production and any(
            origin.startswith(("http://localhost", "http://127.0.0.1")) for origin in self.cors_origins
        ):
            # The production container serves the SPA same-origin. A credentialed
            # CORS grant to a loopback origin is a leftover dev setting, not a
            # deployment choice.
            raise ValueError(
                "ARCHPILOT_CORS_ORIGINS must not contain a loopback origin in production; "
                "set ARCHPILOT_CORS_ORIGINS= (empty) for the same-origin container"
            )


_settings: Settings | None = None


def get_settings() -> Settings:
    """Process-wide settings singleton. Reads the environment exactly once."""
    global _settings
    if _settings is None:
        candidate = Settings()
        candidate.validate()
        _settings = candidate
    return _settings


def reset_settings_cache() -> None:
    """Test hook: force the next get_settings() call to re-read the environment."""
    global _settings
    _settings = None
