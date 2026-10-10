"""Migration round-trip in a disposable database and model/migration drift check."""

from __future__ import annotations

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import engine
from tests.conftest import alembic_config


def test_downgrade_and_reupgrade_round_trip() -> None:
    cfg = alembic_config(get_settings().database_url)
    command.downgrade(cfg, "base")
    engine.dispose()
    tables = set(inspect(engine).get_table_names())
    assert tables <= {"alembic_version"}
    command.upgrade(cfg, "head")
    engine.dispose()
    tables = set(inspect(engine).get_table_names())
    assert set(Base.metadata.tables) <= tables
    assert len(Base.metadata.tables) == 26


def test_models_match_migrations() -> None:
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert diff == []
