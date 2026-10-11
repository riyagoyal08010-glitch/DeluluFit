"""Migration round-trip in a disposable database and model/migration drift check."""

from __future__ import annotations

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

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


def test_constraint_and_index_names_match_models() -> None:
    """Alembic's drift check ignores CHECK constraints; compare every name directly."""
    expected: set[str] = set()
    for table in Base.metadata.tables.values():
        for c in table.constraints:
            if c.name:
                expected.add(str(c.name))
        expected |= {str(i.name) for i in table.indexes}
    with engine.connect() as conn:
        actual = {r[0] for r in conn.execute(text(
            "SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace "
            # contype 't' = constraint triggers, created by the migration's integrity SQL on purpose.
            "WHERE n.nspname = 'public' AND c.conrelid <> 'alembic_version'::regclass AND c.contype <> 't' "
            "UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'alembic_version'"))}
    assert expected - actual == set(), "declared in models but missing in the database"
    assert actual - expected == set(), "present in the database but not declared in models"
