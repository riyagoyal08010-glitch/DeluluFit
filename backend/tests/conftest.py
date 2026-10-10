"""Shared fixtures.

Tests run against a real, disposable PostgreSQL database named by
TEST_DATABASE_URL. The schema is built with Alembic (not create_all) so the
migrations themselves are exercised. Every test leaves the database empty.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.core.config import Settings, get_settings

_base = Settings()
if not _base.test_database_url:
    raise RuntimeError("TEST_DATABASE_URL must point at a disposable PostgreSQL database.")
if "test" not in _base.test_database_url.rsplit("/", 1)[-1]:
    raise RuntimeError("Refusing to run: the TEST_DATABASE_URL database name must contain 'test'.")

os.environ["DATABASE_URL"] = _base.test_database_url
os.environ["ENVIRONMENT"] = "test"
os.environ["RUN_INLINE_WORKER"] = "false"
os.environ["EXTRACTION_PROVIDER"] = "disabled"
os.environ["LOCAL_STORAGE_DIR"] = tempfile.mkdtemp(prefix="delulufit-uploads-")
os.environ["STORAGE_BACKEND"] = "local"
get_settings.cache_clear()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    url = get_settings().database_url
    cfg = alembic_config(url)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield
    engine.dispose()


def truncate_all() -> None:
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture(autouse=True)
def _clean_database() -> Iterator[None]:
    yield
    truncate_all()


@pytest.fixture
def db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
