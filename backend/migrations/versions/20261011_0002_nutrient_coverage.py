"""Nutrient coverage: sugars and sodium, source coverage, source food id, unrounded estimates.

- food_nutrients gains sugars_g, sodium_mg, source_food_id and source_nutrients
  (the nutrients the source dataset provides for this record). A NULL value
  for a nutrient listed in source_nutrients means "unknown for this food";
  a NULL value for a nutrient not listed means "not in the source".
- nutrition_estimates gains sugars_g and sodium_mg, and its values move from
  NUMERIC(10, 2) to NUMERIC(14, 4) so estimates are stored unrounded enough
  to be summed; rounding happens for display only.
- Both immutability triggers are extended to cover the new columns.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CORE = ("energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g")
ALL = CORE + ("sugars_g", "sodium_mg")
ESTIMATE_VALUES = ALL


def _nutrient_trigger(columns: tuple[str, ...]) -> str:
    cols = ", ".join(["food_id", "reference_mass_g", *columns, "source_name", "source_reference",
                      "dataset_version", "created_at"])
    new, old = ", ".join(f"NEW.{c}" for c in cols.split(", ")), ", ".join(f"OLD.{c}" for c in cols.split(", "))
    return f"""
CREATE OR REPLACE FUNCTION trg_food_nutrients_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ({new}) IS DISTINCT FROM ({old}) THEN
        RAISE EXCEPTION 'food_nutrients rows are immutable; insert a new version instead'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;"""


def _estimate_trigger(columns: tuple[str, ...]) -> str:
    cols = ["consumed_item_id", "food_nutrient_id", "estimate_version", "method", "engine_version", "confidence",
            *columns, "input_snapshot", "calculated_at"]
    new, old = ", ".join(f"NEW.{c}" for c in cols), ", ".join(f"OLD.{c}" for c in cols)
    return f"""
CREATE OR REPLACE FUNCTION trg_nutrition_estimates_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ({new}) IS DISTINCT FROM ({old}) THEN
        RAISE EXCEPTION 'nutrition estimates are immutable; insert a new version instead'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;"""


def upgrade() -> None:
    op.add_column('food_nutrients', sa.Column('sugars_g', sa.Numeric(8, 2), nullable=True))
    op.add_column('food_nutrients', sa.Column('sodium_mg', sa.Numeric(9, 2), nullable=True))
    op.add_column('food_nutrients', sa.Column('source_food_id', sa.String(60), nullable=True))
    op.add_column('food_nutrients', sa.Column(
        'source_nutrients', postgresql.ARRAY(sa.String(20)), nullable=False,
        server_default=sa.text("'{energy_kcal,protein_g,carbohydrate_g,fat_g,fibre_g}'::varchar[]")))
    op.create_check_constraint(op.f('ck_food_nutrients_sugars_g_nonnegative'), 'food_nutrients',
                               'sugars_g IS NULL OR sugars_g >= 0')
    op.create_check_constraint(op.f('ck_food_nutrients_sodium_mg_nonnegative'), 'food_nutrients',
                               'sodium_mg IS NULL OR sodium_mg >= 0')
    allowed = ", ".join(f"'{n}'" for n in ALL)
    op.create_check_constraint(op.f('ck_food_nutrients_source_nutrients_known'), 'food_nutrients',
                               f"source_nutrients <@ ARRAY[{allowed}]::varchar[]")
    # A reported value must belong to a nutrient the source covers.
    op.create_check_constraint(op.f('ck_food_nutrients_values_within_coverage'), 'food_nutrients', " AND ".join(
        f"({n} IS NULL OR '{n}' = ANY(source_nutrients))" for n in ALL))

    for col in CORE:
        op.alter_column('nutrition_estimates', col, type_=sa.Numeric(14, 4),
                        existing_type=sa.Numeric(10, 2), existing_nullable=True)
    op.add_column('nutrition_estimates', sa.Column('sugars_g', sa.Numeric(14, 4), nullable=True))
    op.add_column('nutrition_estimates', sa.Column('sodium_mg', sa.Numeric(14, 4), nullable=True))
    op.create_check_constraint(op.f('ck_nutrition_estimates_sugars_g_nonnegative'), 'nutrition_estimates',
                               'sugars_g IS NULL OR sugars_g >= 0')
    op.create_check_constraint(op.f('ck_nutrition_estimates_sodium_mg_nonnegative'), 'nutrition_estimates',
                               'sodium_mg IS NULL OR sodium_mg >= 0')

    op.execute(_nutrient_trigger(ALL + ("source_food_id", "source_nutrients")))
    op.execute(_estimate_trigger(ESTIMATE_VALUES))


def downgrade() -> None:
    op.execute(_estimate_trigger(CORE))
    op.execute(_nutrient_trigger(CORE))
    op.drop_constraint(op.f('ck_nutrition_estimates_sodium_mg_nonnegative'), 'nutrition_estimates', type_='check')
    op.drop_constraint(op.f('ck_nutrition_estimates_sugars_g_nonnegative'), 'nutrition_estimates', type_='check')
    op.drop_column('nutrition_estimates', 'sodium_mg')
    op.drop_column('nutrition_estimates', 'sugars_g')
    for col in CORE:
        # Values are rounded back to two decimal places.
        op.alter_column('nutrition_estimates', col, type_=sa.Numeric(10, 2),
                        existing_type=sa.Numeric(14, 4), existing_nullable=True)
    op.drop_constraint(op.f('ck_food_nutrients_values_within_coverage'), 'food_nutrients', type_='check')
    op.drop_constraint(op.f('ck_food_nutrients_source_nutrients_known'), 'food_nutrients', type_='check')
    op.drop_constraint(op.f('ck_food_nutrients_sodium_mg_nonnegative'), 'food_nutrients', type_='check')
    op.drop_constraint(op.f('ck_food_nutrients_sugars_g_nonnegative'), 'food_nutrients', type_='check')
    op.drop_column('food_nutrients', 'source_nutrients')
    op.drop_column('food_nutrients', 'source_food_id')
    op.drop_column('food_nutrients', 'sodium_mg')
    op.drop_column('food_nutrients', 'sugars_g')
