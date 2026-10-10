"""Initial DeluluFit schema: 25 domain tables plus server-side sessions.

Hand-edited after autogeneration: the mess_menus <-> menu_versions FK cycle is
created after both tables exist, and integrity triggers are installed.

Revision ID: 0001
Revises: 
Create Date: 2026-10-11 02:37:37.224195

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Integrity triggers. Kept inline so this applied migration never changes
# because some other module was edited.
UPGRADE_SQL = """
-- Confirmed menu versions are immutable snapshots (integrity rule 6).
CREATE FUNCTION trg_menu_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'confirmed' THEN
        RAISE EXCEPTION 'confirmed menu version % is immutable', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_versions_immutable BEFORE UPDATE ON menu_versions
    FOR EACH ROW EXECUTE FUNCTION trg_menu_versions_immutable();

CREATE FUNCTION menu_version_is_confirmed(p_version_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM menu_versions WHERE id = p_version_id AND status = 'confirmed')
$$;

CREATE FUNCTION trg_menu_days_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF menu_version_is_confirmed(NEW.version_id)
       OR (TG_OP = 'UPDATE' AND menu_version_is_confirmed(OLD.version_id)) THEN
        RAISE EXCEPTION 'cannot modify days of a confirmed menu version' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_days_immutable BEFORE INSERT OR UPDATE ON menu_days
    FOR EACH ROW EXECUTE FUNCTION trg_menu_days_immutable();

CREATE FUNCTION trg_menu_meals_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM menu_days d WHERE d.id = NEW.day_id AND menu_version_is_confirmed(d.version_id))
       OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM menu_days d WHERE d.id = OLD.day_id
                                        AND menu_version_is_confirmed(d.version_id))) THEN
        RAISE EXCEPTION 'cannot modify meals of a confirmed menu version' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_meals_immutable BEFORE INSERT OR UPDATE ON menu_meals
    FOR EACH ROW EXECUTE FUNCTION trg_menu_meals_immutable();

CREATE FUNCTION trg_menu_items_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM menu_meals m JOIN menu_days d ON d.id = m.day_id
               WHERE m.id = NEW.meal_id AND menu_version_is_confirmed(d.version_id))
       OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM menu_meals m JOIN menu_days d ON d.id = m.day_id
                                        WHERE m.id = OLD.meal_id AND menu_version_is_confirmed(d.version_id))) THEN
        RAISE EXCEPTION 'cannot modify items of a confirmed menu version' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_items_immutable BEFORE INSERT OR UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION trg_menu_items_immutable();

-- A menu's current version must be a confirmed version (checked at commit so
-- the menu, version and pointer can be written in one transaction).
CREATE FUNCTION trg_mess_menus_current_confirmed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.current_version_id IS NOT NULL AND NOT menu_version_is_confirmed(NEW.current_version_id) THEN
        RAISE EXCEPTION 'current menu version must be confirmed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER mess_menus_current_confirmed AFTER INSERT OR UPDATE ON mess_menus
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_mess_menus_current_confirmed();

-- Reference nutrient rows never change in place (integrity rule 8); only the
-- is_current flag may flip when a newer row supersedes them.
CREATE FUNCTION trg_food_nutrients_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.food_id, NEW.reference_mass_g, NEW.energy_kcal, NEW.protein_g, NEW.carbohydrate_g, NEW.fat_g,
        NEW.fibre_g, NEW.source_name, NEW.source_reference, NEW.dataset_version, NEW.created_at)
       IS DISTINCT FROM
       (OLD.food_id, OLD.reference_mass_g, OLD.energy_kcal, OLD.protein_g, OLD.carbohydrate_g, OLD.fat_g,
        OLD.fibre_g, OLD.source_name, OLD.source_reference, OLD.dataset_version, OLD.created_at) THEN
        RAISE EXCEPTION 'food_nutrients rows are immutable; insert a new version instead'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER food_nutrients_immutable BEFORE UPDATE ON food_nutrients
    FOR EACH ROW EXECUTE FUNCTION trg_food_nutrients_immutable();

-- Nutrition estimates are historical records (integrity rule 7).
CREATE FUNCTION trg_nutrition_estimates_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.consumed_item_id, NEW.food_nutrient_id, NEW.estimate_version, NEW.method, NEW.engine_version,
        NEW.confidence, NEW.energy_kcal, NEW.protein_g, NEW.carbohydrate_g, NEW.fat_g, NEW.fibre_g,
        NEW.input_snapshot, NEW.calculated_at)
       IS DISTINCT FROM
       (OLD.consumed_item_id, OLD.food_nutrient_id, OLD.estimate_version, OLD.method, OLD.engine_version,
        OLD.confidence, OLD.energy_kcal, OLD.protein_g, OLD.carbohydrate_g, OLD.fat_g, OLD.fibre_g,
        OLD.input_snapshot, OLD.calculated_at) THEN
        RAISE EXCEPTION 'nutrition estimates are immutable; insert a new version instead'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER nutrition_estimates_immutable BEFORE UPDATE ON nutrition_estimates
    FOR EACH ROW EXECUTE FUNCTION trg_nutrition_estimates_immutable();
"""

DOWNGRADE_SQL = """
DROP TRIGGER IF EXISTS nutrition_estimates_immutable ON nutrition_estimates;
DROP FUNCTION IF EXISTS trg_nutrition_estimates_immutable();
DROP TRIGGER IF EXISTS food_nutrients_immutable ON food_nutrients;
DROP FUNCTION IF EXISTS trg_food_nutrients_immutable();
DROP TRIGGER IF EXISTS mess_menus_current_confirmed ON mess_menus;
DROP FUNCTION IF EXISTS trg_mess_menus_current_confirmed();
DROP TRIGGER IF EXISTS menu_items_immutable ON menu_items;
DROP FUNCTION IF EXISTS trg_menu_items_immutable();
DROP TRIGGER IF EXISTS menu_meals_immutable ON menu_meals;
DROP FUNCTION IF EXISTS trg_menu_meals_immutable();
DROP TRIGGER IF EXISTS menu_days_immutable ON menu_days;
DROP FUNCTION IF EXISTS trg_menu_days_immutable();
DROP FUNCTION IF EXISTS menu_version_is_confirmed(uuid);
DROP TRIGGER IF EXISTS menu_versions_immutable ON menu_versions;
DROP FUNCTION IF EXISTS trg_menu_versions_immutable();
"""


def upgrade() -> None:
    """Upgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('foods',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('canonical_name', sa.String(length=160), nullable=False),
    sa.Column('normalized_name', sa.String(length=160), nullable=False),
    sa.Column('category', sa.String(length=60), nullable=True),
    sa.Column('preparation_notes', sa.Text(), nullable=True),
    sa.Column('diet_type', sa.String(length=16), server_default='unknown', nullable=False),
    sa.Column('known_allergens', postgresql.ARRAY(sa.String(length=16)), server_default=sa.text("'{}'::varchar[]"), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("diet_type IN ('vegan', 'vegetarian', 'eggetarian', 'non_vegetarian', 'unknown')", name=op.f('ck_foods_diet_type')),
    sa.CheckConstraint('length(btrim(canonical_name)) > 0', name=op.f('ck_foods_name_nonempty')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_foods')),
    sa.UniqueConstraint('normalized_name', name=op.f('uq_foods_normalized_name'))
    )
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('role', sa.String(length=16), server_default='student', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("email = lower(email) AND position('@' in email) > 1", name=op.f('ck_users_email_normalized')),
    sa.CheckConstraint("role IN ('student', 'admin')", name=op.f('ck_users_role')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('email', name=op.f('uq_users_email'))
    )
    op.create_table('food_aliases',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('food_id', sa.UUID(), nullable=False),
    sa.Column('alias', sa.String(length=160), nullable=False),
    sa.Column('normalized_alias', sa.String(length=160), nullable=False),
    sa.Column('language', sa.String(length=32), nullable=True),
    sa.Column('confidence', sa.String(length=8), server_default='HIGH', nullable=False),
    sa.CheckConstraint("confidence IN ('HIGH', 'MEDIUM', 'LOW')", name=op.f('ck_food_aliases_confidence')),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['food_id'], ['foods.id'], name=op.f('fk_food_aliases_food_id_foods'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_food_aliases')),
    sa.UniqueConstraint('normalized_alias', name=op.f('uq_food_aliases_normalized_alias'))
    )
    op.create_index('ix_food_aliases_food_id', 'food_aliases', ['food_id'], unique=False)
    op.create_table('food_nutrients',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('food_id', sa.UUID(), nullable=False),
    sa.Column('reference_mass_g', sa.Numeric(precision=8, scale=2), server_default='100', nullable=False),
    sa.Column('energy_kcal', sa.Numeric(precision=8, scale=2), nullable=True),
    sa.Column('protein_g', sa.Numeric(precision=8, scale=2), nullable=True),
    sa.Column('carbohydrate_g', sa.Numeric(precision=8, scale=2), nullable=True),
    sa.Column('fat_g', sa.Numeric(precision=8, scale=2), nullable=True),
    sa.Column('fibre_g', sa.Numeric(precision=8, scale=2), nullable=True),
    sa.Column('source_name', sa.String(length=120), nullable=False),
    sa.Column('source_reference', sa.String(length=300), nullable=True),
    sa.Column('dataset_version', sa.String(length=60), nullable=True),
    sa.Column('is_current', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('carbohydrate_g IS NULL OR carbohydrate_g >= 0', name=op.f('ck_food_nutrients_carbohydrate_g_nonnegative')),
    sa.CheckConstraint('energy_kcal IS NULL OR energy_kcal >= 0', name=op.f('ck_food_nutrients_energy_kcal_nonnegative')),
    sa.CheckConstraint('fat_g IS NULL OR fat_g >= 0', name=op.f('ck_food_nutrients_fat_g_nonnegative')),
    sa.CheckConstraint('fibre_g IS NULL OR fibre_g >= 0', name=op.f('ck_food_nutrients_fibre_g_nonnegative')),
    sa.CheckConstraint('length(btrim(source_name)) > 0', name=op.f('ck_food_nutrients_source_required')),
    sa.CheckConstraint('protein_g IS NULL OR protein_g >= 0', name=op.f('ck_food_nutrients_protein_g_nonnegative')),
    sa.CheckConstraint('reference_mass_g > 0', name=op.f('ck_food_nutrients_reference_mass_positive')),
    sa.ForeignKeyConstraint(['food_id'], ['foods.id'], name=op.f('fk_food_nutrients_food_id_foods'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_food_nutrients'))
    )
    op.create_index('ix_food_nutrients_food_id', 'food_nutrients', ['food_id'], unique=False)
    op.create_index('uq_food_nutrients_current', 'food_nutrients', ['food_id'], unique=True, postgresql_where=sa.text('is_current'))
    op.create_table('food_servings',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('food_id', sa.UUID(), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('mass_g', sa.Numeric(precision=8, scale=2), nullable=False),
    sa.Column('is_default', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('source_name', sa.String(length=120), nullable=False),
    sa.Column('source_reference', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('mass_g > 0', name=op.f('ck_food_servings_mass_positive')),
    sa.ForeignKeyConstraint(['food_id'], ['foods.id'], name=op.f('fk_food_servings_food_id_foods'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_food_servings')),
    sa.UniqueConstraint('food_id', 'label', name=op.f('uq_food_servings_food_id_label')),
    sa.UniqueConstraint('id', 'food_id', name=op.f('uq_food_servings_id_food_id'))
    )
    op.create_index('uq_food_servings_default', 'food_servings', ['food_id'], unique=True, postgresql_where=sa.text('is_default'))
    op.create_table('institutions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('normalized_name', sa.String(length=160), nullable=False),
    sa.Column('city', sa.String(length=80), nullable=True),
    sa.Column('state', sa.String(length=80), nullable=True),
    sa.Column('created_by_user_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('length(btrim(name)) > 1', name=op.f('ck_institutions_name_nonempty')),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], name=op.f('fk_institutions_created_by_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_institutions')),
    sa.UniqueConstraint('normalized_name', name=op.f('uq_institutions_normalized_name'))
    )
    op.create_table('menu_uploads',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('storage_key', sa.String(length=200), nullable=False),
    sa.Column('original_filename', sa.String(length=120), nullable=True),
    sa.Column('content_type', sa.String(length=32), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('width_px', sa.Integer(), nullable=True),
    sa.Column('height_px', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("content_type IN ('image/jpeg', 'image/png', 'image/webp')", name=op.f('ck_menu_uploads_content_type')),
    sa.CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name=op.f('ck_menu_uploads_sha256_hex')),
    sa.CheckConstraint('size_bytes > 0', name=op.f('ck_menu_uploads_size_positive')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_menu_uploads_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_menu_uploads')),
    sa.UniqueConstraint('id', 'user_id', name=op.f('uq_menu_uploads_id_user_id')),
    sa.UniqueConstraint('storage_key', name=op.f('uq_menu_uploads_storage_key')),
    sa.UniqueConstraint('user_id', 'sha256', name=op.f('uq_menu_uploads_user_id_sha256'))
    )
    op.create_index('ix_menu_uploads_user_id_created_at', 'menu_uploads', ['user_id', 'created_at'], unique=False)
    op.create_table('nutrition_targets',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('energy_kcal', sa.Numeric(precision=7, scale=1), nullable=True),
    sa.Column('protein_g', sa.Numeric(precision=6, scale=1), nullable=True),
    sa.Column('carbohydrate_g', sa.Numeric(precision=6, scale=1), nullable=True),
    sa.Column('fat_g', sa.Numeric(precision=6, scale=1), nullable=True),
    sa.Column('fibre_g', sa.Numeric(precision=6, scale=1), nullable=True),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('effective_to', sa.Date(), nullable=True),
    sa.Column('notes', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("source IN ('reference_estimate', 'self_set', 'professional')", name=op.f('ck_nutrition_targets_source')),
    sa.CheckConstraint('carbohydrate_g IS NULL OR (carbohydrate_g >= 0 AND carbohydrate_g <= 1500)', name=op.f('ck_nutrition_targets_carbohydrate_range')),
    sa.CheckConstraint('effective_to IS NULL OR effective_to >= effective_from', name=op.f('ck_nutrition_targets_effective_range')),
    sa.CheckConstraint('energy_kcal IS NULL OR (energy_kcal >= 500 AND energy_kcal <= 8000)', name=op.f('ck_nutrition_targets_energy_range')),
    sa.CheckConstraint('fat_g IS NULL OR (fat_g >= 0 AND fat_g <= 400)', name=op.f('ck_nutrition_targets_fat_range')),
    sa.CheckConstraint('fibre_g IS NULL OR (fibre_g >= 0 AND fibre_g <= 150)', name=op.f('ck_nutrition_targets_fibre_range')),
    sa.CheckConstraint('num_nonnulls(energy_kcal, protein_g, carbohydrate_g, fat_g, fibre_g) > 0', name=op.f('ck_nutrition_targets_at_least_one_value')),
    sa.CheckConstraint('protein_g IS NULL OR (protein_g >= 0 AND protein_g <= 500)', name=op.f('ck_nutrition_targets_protein_range')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_nutrition_targets_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_nutrition_targets'))
    )
    op.create_index('uq_nutrition_targets_active', 'nutrition_targets', ['user_id'], unique=True, postgresql_where=sa.text('effective_to IS NULL'))
    op.create_table('user_allergies',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('allergen', sa.String(length=16), nullable=False),
    sa.Column('custom_label', sa.String(length=80), nullable=True),
    sa.Column('severity', sa.String(length=10), server_default='unknown', nullable=False),
    sa.Column('notes', sa.String(length=280), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("allergen <> 'other' OR (custom_label IS NOT NULL AND length(btrim(custom_label)) > 0)", name=op.f('ck_user_allergies_other_requires_label')),
    sa.CheckConstraint("allergen IN ('peanut', 'tree_nut', 'milk', 'egg', 'wheat_gluten', 'soy', 'fish', 'shellfish', 'sesame', 'mustard', 'other')", name=op.f('ck_user_allergies_allergen')),
    sa.CheckConstraint("severity IN ('mild', 'moderate', 'severe', 'unknown')", name=op.f('ck_user_allergies_severity')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_allergies_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_allergies'))
    )
    op.create_index('uq_user_allergies_user_allergen_label', 'user_allergies', ['user_id', 'allergen', sa.literal_column("coalesce(lower(custom_label), '')")], unique=True)
    op.create_table('user_budgets',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('period', sa.String(length=8), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('effective_to', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name=op.f('ck_user_budgets_currency_code')),
    sa.CheckConstraint("period IN ('daily', 'weekly', 'monthly')", name=op.f('ck_user_budgets_period')),
    sa.CheckConstraint('amount >= 0', name=op.f('ck_user_budgets_amount_nonnegative')),
    sa.CheckConstraint('effective_to IS NULL OR effective_to >= effective_from', name=op.f('ck_user_budgets_effective_range')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_budgets_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_budgets'))
    )
    op.create_index('ix_user_budgets_user_id_effective_from', 'user_budgets', ['user_id', 'effective_from'], unique=False)
    op.create_index('uq_user_budgets_active', 'user_budgets', ['user_id'], unique=True, postgresql_where=sa.text('effective_to IS NULL'))
    op.create_table('user_food_preferences',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('normalized_label', sa.String(length=80), nullable=False),
    sa.Column('preference', sa.String(length=8), nullable=False),
    sa.Column('food_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("preference IN ('like', 'dislike', 'avoid')", name=op.f('ck_user_food_preferences_preference')),
    sa.CheckConstraint('length(normalized_label) > 0', name=op.f('ck_user_food_preferences_label_nonempty')),
    sa.ForeignKeyConstraint(['food_id'], ['foods.id'], name=op.f('fk_user_food_preferences_food_id_foods'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_food_preferences_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_food_preferences')),
    sa.UniqueConstraint('user_id', 'normalized_label', name=op.f('uq_user_food_preferences_user_id_normalized_label'))
    )
    op.create_table('user_sessions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('csrf_token', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('expires_at > created_at', name=op.f('ck_user_sessions_expiry_after_creation')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_sessions')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_user_sessions_token_hash'))
    )
    op.create_index('ix_user_sessions_user_id', 'user_sessions', ['user_id'], unique=False)
    op.create_table('hostels',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('institution_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('normalized_name', sa.String(length=120), nullable=False),
    sa.Column('created_by_user_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('length(btrim(name)) > 0', name=op.f('ck_hostels_name_nonempty')),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], name=op.f('fk_hostels_created_by_user_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['institution_id'], ['institutions.id'], name=op.f('fk_hostels_institution_id_institutions'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_hostels')),
    sa.UniqueConstraint('id', 'institution_id', name=op.f('uq_hostels_id_institution_id')),
    sa.UniqueConstraint('institution_id', 'normalized_name', name=op.f('uq_hostels_institution_id_normalized_name'))
    )
    op.create_table('menu_extraction_jobs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('upload_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.String(length=12), server_default='queued', nullable=False),
    sa.Column('provider', sa.String(length=40), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=True),
    sa.Column('attempt_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('available_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('error_code', sa.String(length=60), nullable=True),
    sa.Column('error_message', sa.String(length=500), nullable=True),
    sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('metrics', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status <> 'succeeded' OR result IS NOT NULL", name=op.f('ck_menu_extraction_jobs_succeeded_has_result')),
    sa.CheckConstraint("status IN ('queued', 'processing', 'succeeded', 'failed')", name=op.f('ck_menu_extraction_jobs_status')),
    sa.CheckConstraint('attempt_count >= 0', name=op.f('ck_menu_extraction_jobs_attempt_count_nonnegative')),
    sa.ForeignKeyConstraint(['upload_id', 'user_id'], ['menu_uploads.id', 'menu_uploads.user_id'], name='fk_menu_extraction_jobs_upload_owner', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_menu_extraction_jobs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_menu_extraction_jobs')),
    sa.UniqueConstraint('id', 'upload_id', name=op.f('uq_menu_extraction_jobs_id_upload_id'))
    )
    op.create_index('ix_menu_extraction_jobs_queue', 'menu_extraction_jobs', ['status', 'available_at'], unique=False, postgresql_where=sa.text("status IN ('queued', 'processing')"))
    op.create_index('ix_menu_extraction_jobs_upload_id', 'menu_extraction_jobs', ['upload_id'], unique=False)
    op.create_index('ix_menu_extraction_jobs_user_id', 'menu_extraction_jobs', ['user_id'], unique=False)
    op.create_table('messes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('institution_id', sa.UUID(), nullable=True),
    sa.Column('hostel_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('hostel_id IS NULL OR institution_id IS NOT NULL', name=op.f('ck_messes_hostel_requires_institution')),
    sa.CheckConstraint('length(btrim(name)) > 0', name=op.f('ck_messes_name_nonempty')),
    sa.ForeignKeyConstraint(['hostel_id', 'institution_id'], ['hostels.id', 'hostels.institution_id'], name='fk_messes_hostel_institution'),
    sa.ForeignKeyConstraint(['institution_id'], ['institutions.id'], name=op.f('fk_messes_institution_id_institutions'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_messes_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_messes')),
    sa.UniqueConstraint('id', 'user_id', name=op.f('uq_messes_id_user_id')),
    sa.UniqueConstraint('user_id', 'name', name=op.f('uq_messes_user_id_name'))
    )
    op.create_index('ix_messes_institution_id', 'messes', ['institution_id'], unique=False)
    op.create_table('student_profiles',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('display_name', sa.String(length=80), nullable=False),
    sa.Column('height_cm', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('weight_kg', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('activity_level', sa.String(length=16), nullable=True),
    sa.Column('dietary_pattern', sa.String(length=24), server_default='no_preference', nullable=False),
    sa.Column('institution_id', sa.UUID(), nullable=True),
    sa.Column('hostel_id', sa.UUID(), nullable=True),
    sa.Column('currency', sa.String(length=3), server_default='INR', nullable=False),
    sa.Column('timezone', sa.String(length=64), server_default='Asia/Kolkata', nullable=False),
    sa.Column('onboarding_step', sa.Integer(), server_default='0', nullable=False),
    sa.Column('onboarding_completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active') OR activity_level IS NULL", name=op.f('ck_student_profiles_activity_level')),
    sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name=op.f('ck_student_profiles_currency_code')),
    sa.CheckConstraint("dietary_pattern IN ('vegetarian', 'eggetarian', 'non_vegetarian', 'vegan', 'jain', 'no_preference')", name=op.f('ck_student_profiles_dietary_pattern')),
    sa.CheckConstraint('height_cm IS NULL OR (height_cm >= 50 AND height_cm <= 272)', name=op.f('ck_student_profiles_height_range')),
    sa.CheckConstraint('hostel_id IS NULL OR institution_id IS NOT NULL', name=op.f('ck_student_profiles_hostel_requires_institution')),
    sa.CheckConstraint('length(btrim(display_name)) > 0', name=op.f('ck_student_profiles_display_name_nonempty')),
    sa.CheckConstraint('onboarding_step >= 0 AND onboarding_step <= 10', name=op.f('ck_student_profiles_onboarding_step')),
    sa.CheckConstraint('weight_kg IS NULL OR (weight_kg >= 20 AND weight_kg <= 400)', name=op.f('ck_student_profiles_weight_range')),
    sa.ForeignKeyConstraint(['hostel_id', 'institution_id'], ['hostels.id', 'hostels.institution_id'], name='fk_student_profiles_hostel_institution'),
    sa.ForeignKeyConstraint(['institution_id'], ['institutions.id'], name=op.f('fk_student_profiles_institution_id_institutions'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_student_profiles_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_student_profiles'))
    )
    op.create_index('ix_student_profiles_institution_id', 'student_profiles', ['institution_id'], unique=False)
    op.create_table('mess_menus',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('mess_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('current_version_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('length(btrim(title)) > 0', name=op.f('ck_mess_menus_title_nonempty')),
    sa.ForeignKeyConstraint(['mess_id', 'user_id'], ['messes.id', 'messes.user_id'], name='fk_mess_menus_mess_owner'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_mess_menus_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_mess_menus')),
    sa.UniqueConstraint('id', 'user_id', name=op.f('uq_mess_menus_id_user_id'))
    )
    op.create_index('ix_mess_menus_user_id', 'mess_menus', ['user_id'], unique=False)
    op.create_table('menu_versions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('menu_id', sa.UUID(), nullable=False),
    sa.Column('version_number', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=10), server_default='draft', nullable=False),
    sa.Column('source', sa.String(length=12), nullable=False),
    sa.Column('upload_id', sa.UUID(), nullable=True),
    sa.Column('extraction_job_id', sa.UUID(), nullable=True),
    sa.Column('based_on_version_id', sa.UUID(), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('notes', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'confirmed') = (confirmed_at IS NOT NULL)", name=op.f('ck_menu_versions_confirmed_at_matches_status')),
    sa.CheckConstraint("source <> 'extraction' OR extraction_job_id IS NOT NULL", name=op.f('ck_menu_versions_extraction_has_job')),
    sa.CheckConstraint("source IN ('extraction', 'manual', 'revision')", name=op.f('ck_menu_versions_source')),
    sa.CheckConstraint("status IN ('draft', 'confirmed')", name=op.f('ck_menu_versions_status')),
    sa.CheckConstraint('extraction_job_id IS NULL OR upload_id IS NOT NULL', name=op.f('ck_menu_versions_job_requires_upload')),
    sa.CheckConstraint('version_number >= 1', name=op.f('ck_menu_versions_version_number_positive')),
    sa.ForeignKeyConstraint(['based_on_version_id', 'menu_id'], ['menu_versions.id', 'menu_versions.menu_id'], name='fk_menu_versions_based_on'),
    sa.ForeignKeyConstraint(['extraction_job_id', 'upload_id'], ['menu_extraction_jobs.id', 'menu_extraction_jobs.upload_id'], name='fk_menu_versions_job_upload'),
    sa.ForeignKeyConstraint(['menu_id'], ['mess_menus.id'], name=op.f('fk_menu_versions_menu_id_mess_menus'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['upload_id'], ['menu_uploads.id'], name='fk_menu_versions_upload_id_menu_uploads'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_menu_versions')),
    sa.UniqueConstraint('id', 'menu_id', name=op.f('uq_menu_versions_id_menu_id')),
    sa.UniqueConstraint('menu_id', 'version_number', name=op.f('uq_menu_versions_menu_id_version_number'))
    )
    op.create_index('uq_menu_versions_one_draft', 'menu_versions', ['menu_id'], unique=True, postgresql_where=sa.text("status = 'draft'"))
    op.create_foreign_key('fk_mess_menus_current_version', 'mess_menus', 'menu_versions',
                          ['current_version_id', 'id'], ['id', 'menu_id'], deferrable=True, initially='DEFERRED')
    op.create_table('menu_days',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('version_id', sa.UUID(), nullable=False),
    sa.Column('menu_date', sa.Date(), nullable=False),
    sa.ForeignKeyConstraint(['version_id'], ['menu_versions.id'], name=op.f('fk_menu_days_version_id_menu_versions'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_menu_days')),
    sa.UniqueConstraint('version_id', 'menu_date', name=op.f('uq_menu_days_version_id_menu_date'))
    )
    op.create_index('ix_menu_days_menu_date', 'menu_days', ['menu_date'], unique=False)
    op.create_table('menu_meals',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('day_id', sa.UUID(), nullable=False),
    sa.Column('meal_type', sa.String(length=10), nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.CheckConstraint("meal_type IN ('breakfast', 'lunch', 'snacks', 'dinner')", name=op.f('ck_menu_meals_meal_type')),
    sa.ForeignKeyConstraint(['day_id'], ['menu_days.id'], name=op.f('fk_menu_meals_day_id_menu_days'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_menu_meals')),
    sa.UniqueConstraint('day_id', 'meal_type', name=op.f('uq_menu_meals_day_id_meal_type'))
    )
    op.create_table('meal_logs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('idempotency_key', sa.UUID(), nullable=False),
    sa.Column('request_fingerprint', sa.String(length=64), nullable=False),
    sa.Column('meal_type', sa.String(length=10), nullable=False),
    sa.Column('source', sa.String(length=10), nullable=False),
    sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('log_date', sa.Date(), nullable=False),
    sa.Column('menu_meal_id', sa.UUID(), nullable=True),
    sa.Column('location_note', sa.String(length=120), nullable=True),
    sa.Column('notes', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("meal_type IN ('breakfast', 'lunch', 'snacks', 'dinner')", name=op.f('ck_meal_logs_meal_type')),
    sa.CheckConstraint("source <> 'mess_menu' OR menu_meal_id IS NOT NULL", name=op.f('ck_meal_logs_mess_source_has_menu_meal')),
    sa.CheckConstraint("source IN ('mess_menu', 'outside', 'manual')", name=op.f('ck_meal_logs_source')),
    sa.ForeignKeyConstraint(['menu_meal_id'], ['menu_meals.id'], name=op.f('fk_meal_logs_menu_meal_id_menu_meals'), initially='DEFERRED', deferrable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_meal_logs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_meal_logs')),
    sa.UniqueConstraint('id', 'menu_meal_id', name=op.f('uq_meal_logs_id_menu_meal_id')),
    sa.UniqueConstraint('id', 'user_id', name=op.f('uq_meal_logs_id_user_id')),
    sa.UniqueConstraint('user_id', 'idempotency_key', name=op.f('uq_meal_logs_user_id_idempotency_key'))
    )
    op.create_index('ix_meal_logs_menu_meal_id', 'meal_logs', ['menu_meal_id'], unique=False)
    op.create_index('ix_meal_logs_user_id_log_date', 'meal_logs', ['user_id', 'log_date'], unique=False)
    op.create_table('menu_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('meal_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('display_name', sa.String(length=160), nullable=False),
    sa.Column('food_id', sa.UUID(), nullable=True),
    sa.Column('match_confidence', sa.String(length=8), server_default='UNKNOWN', nullable=False),
    sa.Column('extraction_confidence', sa.Numeric(precision=4, scale=3), nullable=True),
    sa.Column('is_user_corrected', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('price', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.CheckConstraint("match_confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')", name=op.f('ck_menu_items_match_confidence')),
    sa.CheckConstraint('extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)', name=op.f('ck_menu_items_extraction_confidence_range')),
    sa.CheckConstraint('length(btrim(display_name)) > 0', name=op.f('ck_menu_items_display_name_nonempty')),
    sa.CheckConstraint('position >= 0', name=op.f('ck_menu_items_position_nonnegative')),
    sa.CheckConstraint('price IS NULL OR price >= 0', name=op.f('ck_menu_items_price_nonnegative')),
    sa.ForeignKeyConstraint(['food_id'], ['foods.id'], name=op.f('fk_menu_items_food_id_foods'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['meal_id'], ['menu_meals.id'], name=op.f('fk_menu_items_meal_id_menu_meals'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_menu_items')),
    sa.UniqueConstraint('id', 'meal_id', name=op.f('uq_menu_items_id_meal_id')),
    sa.UniqueConstraint('meal_id', 'position', name=op.f('uq_menu_items_meal_id_position'))
    )
    op.create_index('ix_menu_items_food_id', 'menu_items', ['food_id'], unique=False)
    op.create_table('budget_transactions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('idempotency_key', sa.UUID(), nullable=True),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('category', sa.String(length=16), nullable=False),
    sa.Column('occurred_on', sa.Date(), nullable=False),
    sa.Column('description', sa.String(length=200), nullable=True),
    sa.Column('meal_log_id', sa.UUID(), nullable=True),
    sa.Column('refund_of_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("category IN ('mess', 'outside_food', 'groceries', 'beverages', 'snacks', 'other')", name=op.f('ck_budget_transactions_category')),
    sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name=op.f('ck_budget_transactions_currency_code')),
    sa.CheckConstraint("kind = 'refund' OR refund_of_id IS NULL", name=op.f('ck_budget_transactions_refund_link_only_on_refunds')),
    sa.CheckConstraint("kind IN ('expense', 'refund')", name=op.f('ck_budget_transactions_kind')),
    sa.CheckConstraint('amount > 0', name=op.f('ck_budget_transactions_amount_positive')),
    sa.ForeignKeyConstraint(['meal_log_id', 'user_id'], ['meal_logs.id', 'meal_logs.user_id'], name='fk_budget_transactions_meal_log_owner', deferrable=True, initially='DEFERRED'),
    sa.ForeignKeyConstraint(['refund_of_id', 'user_id'], ['budget_transactions.id', 'budget_transactions.user_id'], name='fk_budget_transactions_refund_owner', deferrable=True, initially='DEFERRED'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_budget_transactions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_budget_transactions')),
    sa.UniqueConstraint('id', 'user_id', name=op.f('uq_budget_transactions_id_user_id')),
    sa.UniqueConstraint('user_id', 'idempotency_key', name=op.f('uq_budget_transactions_user_id_idempotency_key'))
    )
    op.create_index('ix_budget_transactions_meal_log_id', 'budget_transactions', ['meal_log_id'], unique=False)
    op.create_index('ix_budget_transactions_user_id_occurred_on', 'budget_transactions', ['user_id', 'occurred_on'], unique=False)
    op.create_table('consumed_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('meal_log_id', sa.UUID(), nullable=False),
    sa.Column('menu_meal_id', sa.UUID(), nullable=True),
    sa.Column('menu_item_id', sa.UUID(), nullable=True),
    sa.Column('food_id', sa.UUID(), nullable=True),
    sa.Column('serving_id', sa.UUID(), nullable=True),
    sa.Column('position', sa.Integer(), server_default='0', nullable=False),
    sa.Column('display_name', sa.String(length=160), nullable=False),
    sa.Column('quantity', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('unit', sa.String(length=8), nullable=False),
    sa.Column('estimated_mass_g', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('mass_source', sa.String(length=20), nullable=False),
    sa.Column('match_confidence', sa.String(length=8), nullable=False),
    sa.Column('is_user_corrected', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(estimated_mass_g IS NULL) = (mass_source = 'unknown')", name=op.f('ck_consumed_items_mass_source_consistent')),
    sa.CheckConstraint("mass_source IN ('user_grams', 'serving_reference', 'unknown')", name=op.f('ck_consumed_items_mass_source')),
    sa.CheckConstraint("match_confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')", name=op.f('ck_consumed_items_match_confidence')),
    sa.CheckConstraint("serving_id IS NULL OR unit = 'serving'", name=op.f('ck_consumed_items_serving_only_for_serving_unit')),
    sa.CheckConstraint("unit IN ('g', 'ml', 'serving')", name=op.f('ck_consumed_items_unit')),
    sa.CheckConstraint('estimated_mass_g IS NULL OR estimated_mass_g > 0', name=op.f('ck_consumed_items_mass_positive')),
    sa.CheckConstraint('length(btrim(display_name)) > 0', name=op.f('ck_consumed_items_display_name_nonempty')),
    sa.CheckConstraint('menu_item_id IS NULL OR menu_meal_id IS NOT NULL', name=op.f('ck_consumed_items_menu_item_requires_meal')),
    sa.CheckConstraint('position >= 0', name=op.f('ck_consumed_items_position_nonnegative')),
    sa.CheckConstraint('quantity > 0 AND quantity <= 10000', name=op.f('ck_consumed_items_quantity_range')),
    sa.ForeignKeyConstraint(['food_id'], ['foods.id'], name=op.f('fk_consumed_items_food_id_foods'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['meal_log_id', 'menu_meal_id'], ['meal_logs.id', 'meal_logs.menu_meal_id'], name='fk_consumed_items_log_menu_meal', deferrable=True, initially='DEFERRED'),
    sa.ForeignKeyConstraint(['meal_log_id'], ['meal_logs.id'], name=op.f('fk_consumed_items_meal_log_id_meal_logs'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['menu_item_id', 'menu_meal_id'], ['menu_items.id', 'menu_items.meal_id'], name='fk_consumed_items_menu_item_meal', deferrable=True, initially='DEFERRED'),
    sa.ForeignKeyConstraint(['serving_id', 'food_id'], ['food_servings.id', 'food_servings.food_id'], name='fk_consumed_items_serving_food'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_consumed_items'))
    )
    op.create_index('ix_consumed_items_food_id', 'consumed_items', ['food_id'], unique=False)
    op.create_index('ix_consumed_items_meal_log_id', 'consumed_items', ['meal_log_id'], unique=False)
    op.create_table('recommendations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('explanation', sa.String(length=1000), nullable=False),
    sa.Column('reason_codes', postgresql.ARRAY(sa.String(length=40)), nullable=False),
    sa.Column('caveats', postgresql.ARRAY(sa.String(length=300)), server_default=sa.text("'{}'::varchar[]"), nullable=False),
    sa.Column('estimated_cost', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=True),
    sa.Column('menu_item_id', sa.UUID(), nullable=True),
    sa.Column('for_date', sa.Date(), nullable=False),
    sa.Column('rule_version', sa.String(length=20), nullable=False),
    sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("kind IN ('menu_option', 'log_reminder', 'data_gap', 'budget', 'spending_summary')", name=op.f('ck_recommendations_kind')),
    sa.CheckConstraint('cardinality(reason_codes) > 0', name=op.f('ck_recommendations_has_reason')),
    sa.CheckConstraint('estimated_cost IS NULL OR currency IS NOT NULL', name=op.f('ck_recommendations_cost_has_currency')),
    sa.CheckConstraint('estimated_cost IS NULL OR estimated_cost >= 0', name=op.f('ck_recommendations_cost_nonnegative')),
    sa.CheckConstraint('expires_at IS NULL OR expires_at > generated_at', name=op.f('ck_recommendations_expiry_after_generation')),
    sa.ForeignKeyConstraint(['menu_item_id'], ['menu_items.id'], name=op.f('fk_recommendations_menu_item_id_menu_items'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_recommendations_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_recommendations'))
    )
    op.create_index('ix_recommendations_user_id_for_date', 'recommendations', ['user_id', 'for_date'], unique=False)
    op.create_table('nutrition_estimates',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('consumed_item_id', sa.UUID(), nullable=False),
    sa.Column('food_nutrient_id', sa.UUID(), nullable=True),
    sa.Column('estimate_version', sa.Integer(), nullable=False),
    sa.Column('is_current', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('method', sa.String(length=24), nullable=False),
    sa.Column('engine_version', sa.String(length=20), nullable=False),
    sa.Column('confidence', sa.String(length=8), nullable=False),
    sa.Column('energy_kcal', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('protein_g', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('carbohydrate_g', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('fat_g', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('fibre_g', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('input_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('calculated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')", name=op.f('ck_nutrition_estimates_confidence')),
    sa.CheckConstraint("method <> 'per_reference_mass' OR food_nutrient_id IS NOT NULL", name=op.f('ck_nutrition_estimates_reference_method_has_source')),
    sa.CheckConstraint("method IN ('per_reference_mass', 'unavailable')", name=op.f('ck_nutrition_estimates_method')),
    sa.CheckConstraint('carbohydrate_g IS NULL OR carbohydrate_g >= 0', name=op.f('ck_nutrition_estimates_carbohydrate_g_nonnegative')),
    sa.CheckConstraint('energy_kcal IS NULL OR energy_kcal >= 0', name=op.f('ck_nutrition_estimates_energy_kcal_nonnegative')),
    sa.CheckConstraint('estimate_version >= 1', name=op.f('ck_nutrition_estimates_estimate_version_positive')),
    sa.CheckConstraint('fat_g IS NULL OR fat_g >= 0', name=op.f('ck_nutrition_estimates_fat_g_nonnegative')),
    sa.CheckConstraint('fibre_g IS NULL OR fibre_g >= 0', name=op.f('ck_nutrition_estimates_fibre_g_nonnegative')),
    sa.CheckConstraint('protein_g IS NULL OR protein_g >= 0', name=op.f('ck_nutrition_estimates_protein_g_nonnegative')),
    sa.ForeignKeyConstraint(['consumed_item_id'], ['consumed_items.id'], name=op.f('fk_nutrition_estimates_consumed_item_id_consumed_items'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['food_nutrient_id'], ['food_nutrients.id'], name=op.f('fk_nutrition_estimates_food_nutrient_id_food_nutrients'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_nutrition_estimates')),
    sa.UniqueConstraint('consumed_item_id', 'estimate_version', name=op.f('uq_nutrition_estimates_consumed_item_id_estimate_version'))
    )
    op.create_index('uq_nutrition_estimates_current', 'nutrition_estimates', ['consumed_item_id'], unique=True, postgresql_where=sa.text('is_current'))
    # ### end Alembic commands ###
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(DOWNGRADE_SQL)
    op.drop_constraint('fk_mess_menus_current_version', 'mess_menus', type_='foreignkey')
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index('uq_nutrition_estimates_current', table_name='nutrition_estimates', postgresql_where=sa.text('is_current'))
    op.drop_table('nutrition_estimates')
    op.drop_index('ix_recommendations_user_id_for_date', table_name='recommendations')
    op.drop_table('recommendations')
    op.drop_index('ix_consumed_items_meal_log_id', table_name='consumed_items')
    op.drop_index('ix_consumed_items_food_id', table_name='consumed_items')
    op.drop_table('consumed_items')
    op.drop_index('ix_budget_transactions_user_id_occurred_on', table_name='budget_transactions')
    op.drop_index('ix_budget_transactions_meal_log_id', table_name='budget_transactions')
    op.drop_table('budget_transactions')
    op.drop_index('ix_menu_items_food_id', table_name='menu_items')
    op.drop_table('menu_items')
    op.drop_index('ix_meal_logs_user_id_log_date', table_name='meal_logs')
    op.drop_index('ix_meal_logs_menu_meal_id', table_name='meal_logs')
    op.drop_table('meal_logs')
    op.drop_table('menu_meals')
    op.drop_index('ix_menu_days_menu_date', table_name='menu_days')
    op.drop_table('menu_days')
    op.drop_index('uq_menu_versions_one_draft', table_name='menu_versions', postgresql_where=sa.text("status = 'draft'"))
    op.drop_table('menu_versions')
    op.drop_index('ix_mess_menus_user_id', table_name='mess_menus')
    op.drop_table('mess_menus')
    op.drop_index('ix_student_profiles_institution_id', table_name='student_profiles')
    op.drop_table('student_profiles')
    op.drop_index('ix_messes_institution_id', table_name='messes')
    op.drop_table('messes')
    op.drop_index('ix_menu_extraction_jobs_user_id', table_name='menu_extraction_jobs')
    op.drop_index('ix_menu_extraction_jobs_upload_id', table_name='menu_extraction_jobs')
    op.drop_index('ix_menu_extraction_jobs_queue', table_name='menu_extraction_jobs', postgresql_where=sa.text("status IN ('queued', 'processing')"))
    op.drop_table('menu_extraction_jobs')
    op.drop_table('hostels')
    op.drop_index('ix_user_sessions_user_id', table_name='user_sessions')
    op.drop_table('user_sessions')
    op.drop_table('user_food_preferences')
    op.drop_index('uq_user_budgets_active', table_name='user_budgets', postgresql_where=sa.text('effective_to IS NULL'))
    op.drop_index('ix_user_budgets_user_id_effective_from', table_name='user_budgets')
    op.drop_table('user_budgets')
    op.drop_index('uq_user_allergies_user_allergen_label', table_name='user_allergies')
    op.drop_table('user_allergies')
    op.drop_index('uq_nutrition_targets_active', table_name='nutrition_targets', postgresql_where=sa.text('effective_to IS NULL'))
    op.drop_table('nutrition_targets')
    op.drop_index('ix_menu_uploads_user_id_created_at', table_name='menu_uploads')
    op.drop_table('menu_uploads')
    op.drop_table('institutions')
    op.drop_index('uq_food_servings_default', table_name='food_servings', postgresql_where=sa.text('is_default'))
    op.drop_table('food_servings')
    op.drop_index('uq_food_nutrients_current', table_name='food_nutrients', postgresql_where=sa.text('is_current'))
    op.drop_index('ix_food_nutrients_food_id', table_name='food_nutrients')
    op.drop_table('food_nutrients')
    op.drop_index('ix_food_aliases_food_id', table_name='food_aliases')
    op.drop_table('food_aliases')
    op.drop_table('users')
    op.drop_table('foods')
    # ### end Alembic commands ###
