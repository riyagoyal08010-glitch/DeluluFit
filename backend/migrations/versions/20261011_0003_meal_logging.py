"""Meal logging: an "other" meal type and a note on each consumed item.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "meal_type IN ('breakfast', 'lunch', 'snacks', 'dinner')"
NEW = "meal_type IN ('breakfast', 'lunch', 'snacks', 'dinner', 'other')"


def _replace_meal_type_checks(expr: str) -> None:
    for table in ("meal_logs", "menu_meals"):
        op.drop_constraint(op.f(f"ck_{table}_meal_type"), table, type_="check")
        op.create_check_constraint(op.f(f"ck_{table}_meal_type"), table, expr)


def upgrade() -> None:
    _replace_meal_type_checks(NEW)
    op.add_column('consumed_items', sa.Column('note', sa.String(280), nullable=True))


def downgrade() -> None:
    op.drop_column('consumed_items', 'note')
    # Fails if any 'other' rows exist, rather than silently relabelling them.
    _replace_meal_type_checks(OLD)
