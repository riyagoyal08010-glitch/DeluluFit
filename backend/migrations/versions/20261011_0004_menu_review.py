"""Menu review: item provenance, section headings, serving notes, and the photo's meal period.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Where a dish came from: read from the photo ('extraction') or typed by the student
    # ('manual'). Together with is_user_corrected this separates AI output from edits.
    op.add_column('menu_items', sa.Column('source', sa.String(12), nullable=False, server_default='manual'))
    op.create_check_constraint(op.f('ck_menu_items_source'), 'menu_items', "source IN ('extraction', 'manual')")
    op.add_column('menu_items', sa.Column('section_heading', sa.String(80), nullable=True))
    # Only serving information printed on the menu itself (e.g. "1 bowl"); never inferred.
    op.add_column('menu_items', sa.Column('serving_note', sa.String(80), nullable=True))
    # The meal period the student said the photo shows, if any.
    op.add_column('menu_versions', sa.Column('meal_type_hint', sa.String(10), nullable=True))
    op.create_check_constraint(
        op.f('ck_menu_versions_meal_type_hint'), 'menu_versions',
        "meal_type_hint IS NULL OR meal_type_hint IN ('breakfast', 'lunch', 'snacks', 'dinner', 'other')")


def downgrade() -> None:
    op.drop_constraint(op.f('ck_menu_versions_meal_type_hint'), 'menu_versions', type_='check')
    op.drop_column('menu_versions', 'meal_type_hint')
    op.drop_column('menu_items', 'serving_note')
    op.drop_column('menu_items', 'section_heading')
    op.drop_constraint(op.f('ck_menu_items_source'), 'menu_items', type_='check')
    op.drop_column('menu_items', 'source')
