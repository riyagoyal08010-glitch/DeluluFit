"""Environment-based application configuration.

All settings are read from environment variables (optionally a local `.env`
file in development). Secrets are never hardcoded.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "DeluluFit API"
    log_level: str = "INFO"

    # Database
    database_url: str = "postgresql+psycopg://delulufit@127.0.0.1:5432/delulufit"
    # Disposable database used by the test suite (it is wiped by the tests).
    test_database_url: str | None = None
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout_seconds: int = 10
    db_statement_timeout_ms: int = 15000

    # Security / sessions
    session_ttl_hours: int = 24 * 14
    session_cookie_name: str = "delulufit_session"
    csrf_cookie_name: str = "delulufit_csrf"
    csrf_header_name: str = "X-CSRF-Token"
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str | None = None

    # CORS: comma-separated list of exact origins of the deployed frontend
    cors_origins: str = "http://localhost:5173"

    # Uploads / storage
    storage_backend: Literal["local", "s3"] = "local"
    local_storage_dir: Path = BACKEND_ROOT / "var" / "uploads"
    s3_bucket: str | None = None
    s3_region: str | None = None
    s3_endpoint_url: str | None = None
    s3_prefix: str = "menu-uploads/"
    max_upload_bytes: int = 8 * 1024 * 1024
    max_image_pixels: int = 40_000_000
    normalized_image_max_side: int = 2400

    # Menu extraction
    extraction_provider: Literal["disabled", "anthropic"] = "disabled"
    anthropic_api_key: str | None = Field(default=None, repr=False)
    # Any vision-capable Claude model; override with ANTHROPIC_MODEL.
    anthropic_model: str = "claude-opus-5-5"
    extraction_timeout_seconds: int = 90
    extraction_max_attempts: int = 3
    extraction_lease_seconds: int = 300
    run_inline_worker: bool = True
    worker_poll_interval_seconds: float = 2.0

    # Rate limits (per process; see docs/SECURITY.md)
    auth_rate_limit_per_minute: int = 10
    upload_rate_limit_per_hour: int = 30

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _normalize_driver(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # Managed hosts often hand out postgres:// URLs; we use psycopg 3.
        if value.startswith("postgres://"):
            value = "postgresql://" + value[len("postgres://") :]
        if value.startswith("postgresql://"):
            value = "postgresql+psycopg://" + value[len("postgresql://") :]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def extraction_enabled(self) -> bool:
        return self.extraction_provider != "disabled" and (
            self.extraction_provider != "anthropic" or bool(self.anthropic_api_key)
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
