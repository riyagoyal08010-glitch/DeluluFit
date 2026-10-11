"""Database-level integrity: FKs, uniques, checks, triggers and deletion policy."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.db import models as m
from tests import factories as f


def expect_db_error(db: Session, fn, exc=(IntegrityError, DBAPIError)) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(exc):
        fn()
        db.flush()
        db.commit()
    db.rollback()


def test_foreign_key_rejects_unknown_user(db: Session) -> None:
    expect_db_error(db, lambda: db.add(m.UserAllergy(user_id=uuid.uuid4(), allergen="peanut")))


def test_unique_email(db: Session) -> None:
    f.make_user(db, "a@example.test")
    db.commit()
    expect_db_error(db, lambda: f.make_user(db, "a@example.test"))


def test_email_must_be_normalized(db: Session) -> None:
    expect_db_error(db, lambda: f.make_user(db, "Mixed@Example.test"))


def test_profile_checks(db: Session) -> None:
    user = f.make_user(db)
    db.commit()
    expect_db_error(db, lambda: db.add(m.StudentProfile(user_id=user.id, display_name="A", height_cm=Decimal("10"))))
    expect_db_error(db, lambda: db.add(m.StudentProfile(user_id=user.id, display_name="A", currency="inr")))
    expect_db_error(db, lambda: db.add(m.StudentProfile(user_id=user.id, display_name="A",
                                                        dietary_pattern="carnivore")))


def test_session_csrf_token_is_required_and_bounded(db: Session) -> None:
    user = f.make_user(db)
    db.commit()
    expires = datetime(2099, 1, 1, tzinfo=timezone.utc)

    def session(**kw):  # type: ignore[no-untyped-def]
        base = dict(user_id=user.id, token_hash=uuid.uuid4().hex * 2, csrf_token="c" * 43, expires_at=expires)
        base.update(kw)
        return m.UserSession(**base)

    expect_db_error(db, lambda: db.add(session(csrf_token=None)))
    expect_db_error(db, lambda: db.add(session(csrf_token="x" * 65)))
    db.add(session())
    db.commit()
    stored = db.scalar(select(m.UserSession.csrf_token))
    assert stored == "c" * 43


def test_food_alias_confidence_is_validated(db: Session) -> None:
    food = f.make_food(db)
    db.commit()
    for bad in ("UNKNOWN", "high", "", "VERY_HIGH"):
        expect_db_error(db, lambda bad=bad: db.add(m.FoodAlias(food_id=food.id, alias="x", normalized_alias="x",
                                                               confidence=bad)))
    # The server default applies when the column is omitted from the INSERT.
    db.execute(text("INSERT INTO food_aliases (food_id, alias, normalized_alias) VALUES (:f, 'dal', 'dal')"),
               {"f": food.id})
    db.add(m.FoodAlias(food_id=food.id, alias="rajma", normalized_alias="rajma", confidence="MEDIUM"))
    db.commit()
    rows = dict(db.execute(select(m.FoodAlias.normalized_alias, m.FoodAlias.confidence)).all())
    assert rows == {"dal": "HIGH", "rajma": "MEDIUM"}


def test_hostel_must_belong_to_selected_institution(db: Session) -> None:
    user = f.make_user(db)
    inst_a = m.Institution(name="Inst A", normalized_name="inst a")
    inst_b = m.Institution(name="Inst B", normalized_name="inst b")
    db.add_all([inst_a, inst_b])
    db.flush()
    hostel_a = m.Hostel(institution_id=inst_a.id, name="H1", normalized_name="h1")
    db.add(hostel_a)
    db.commit()
    expect_db_error(db, lambda: db.add(m.StudentProfile(user_id=user.id, display_name="S",
                                                        institution_id=inst_b.id, hostel_id=hostel_a.id)))
    expect_db_error(db, lambda: db.add(m.StudentProfile(user_id=user.id, display_name="S", hostel_id=hostel_a.id)))
    db.add(m.StudentProfile(user_id=user.id, display_name="S", institution_id=inst_a.id, hostel_id=hostel_a.id))
    db.commit()


def test_current_version_must_belong_to_same_menu_and_be_confirmed(db: Session) -> None:
    user = f.make_user(db)
    menu1, v1, _ = f.make_draft_menu(db, user)
    menu2, v2, _ = f.make_draft_menu(db, user)
    f.confirm(db, menu1, v1)
    db.commit()
    v2.status = "confirmed"
    v2.confirmed_at = datetime.now(timezone.utc)
    db.commit()
    # Pointing menu1 at menu2's version violates the composite FK.
    menu1.current_version_id = v2.id
    expect_db_error(db, lambda: None)
    # A draft can never be the current version.
    menu3, v3, _ = f.make_draft_menu(db, user)
    menu3.current_version_id = v3.id
    expect_db_error(db, lambda: None)


def test_confirmed_version_is_immutable(db: Session) -> None:
    user = f.make_user(db)
    menu, version, meal = f.make_draft_menu(db, user)
    f.confirm(db, menu, version)
    db.commit()
    item = db.scalars(select(m.MenuItem).where(m.MenuItem.meal_id == meal.id)).first()
    assert item is not None
    item.display_name = "Changed"
    expect_db_error(db, lambda: None)
    expect_db_error(db, lambda: db.add(m.MenuItem(meal_id=meal.id, position=9, display_name="Sneaky")))
    version = db.get(m.MenuVersion, version.id)
    assert version is not None
    version.notes = "edit"
    expect_db_error(db, lambda: None)


def test_one_draft_per_menu(db: Session) -> None:
    user = f.make_user(db)
    menu, _, _ = f.make_draft_menu(db, user)
    db.commit()
    expect_db_error(db, lambda: db.add(m.MenuVersion(menu_id=menu.id, version_number=2, source="manual")))


def test_extraction_provenance_must_match_upload(db: Session) -> None:
    user = f.make_user(db)
    other = f.make_user(db)
    upload = f.make_upload(db, user)
    upload2 = f.make_upload(db, user)
    db.commit()
    # A job cannot claim a different owner than its upload.
    expect_db_error(db, lambda: db.add(m.MenuExtractionJob(upload_id=upload.id, user_id=other.id,
                                                           provider="test")))
    job = m.MenuExtractionJob(upload_id=upload.id, user_id=user.id, provider="test")
    db.add(job)
    menu = m.MessMenu(user_id=user.id, title="T")
    db.add(menu)
    db.commit()
    # A version cannot cite a job together with a different upload.
    expect_db_error(db, lambda: db.add(m.MenuVersion(menu_id=menu.id, version_number=1, source="extraction",
                                                     upload_id=upload2.id, extraction_job_id=job.id)))
    db.add(m.MenuVersion(menu_id=menu.id, version_number=1, source="extraction", upload_id=upload.id,
                         extraction_job_id=job.id))
    db.commit()


def test_consumed_menu_item_must_belong_to_logged_meal(db: Session) -> None:
    user = f.make_user(db)
    menu, version, meal = f.make_draft_menu(db, user)
    _, _, other_meal = f.make_draft_menu(db, user)
    db.commit()
    other_item = db.scalars(select(m.MenuItem).where(m.MenuItem.meal_id == other_meal.id)).first()
    assert other_item is not None
    log = f.make_meal_log(db, user, menu_meal=meal)
    db.commit()
    # Claiming another meal's item, even while also claiming that meal, is rejected.
    expect_db_error(db, lambda: db.add(m.ConsumedItem(
        meal_log_id=log.id, menu_meal_id=other_meal.id, menu_item_id=other_item.id, display_name="x",
        quantity=Decimal(1), unit="serving", mass_source="unknown", match_confidence="UNKNOWN")))
    expect_db_error(db, lambda: db.add(m.ConsumedItem(
        meal_log_id=log.id, menu_meal_id=meal.id, menu_item_id=other_item.id, display_name="x",
        quantity=Decimal(1), unit="serving", mass_source="unknown", match_confidence="UNKNOWN")))


def test_consumed_item_checks(db: Session) -> None:
    user = f.make_user(db)
    log = f.make_meal_log(db, user)
    db.commit()

    def item(**kw):  # type: ignore[no-untyped-def]
        base = dict(meal_log_id=log.id, display_name="Tea", quantity=Decimal(1), unit="ml",
                    estimated_mass_g=None, mass_source="unknown", match_confidence="UNKNOWN")
        base.update(kw)
        return m.ConsumedItem(**base)

    expect_db_error(db, lambda: db.add(item(quantity=Decimal(0))))
    expect_db_error(db, lambda: db.add(item(unit="cups")))
    expect_db_error(db, lambda: db.add(item(estimated_mass_g=Decimal(50))))  # mass without a mass source
    db.add(item())
    db.commit()


def test_serving_must_belong_to_food(db: Session) -> None:
    user = f.make_user(db)
    food_a, food_b = f.make_food(db, "A"), f.make_food(db, "B")
    serving_b = m.FoodServing(food_id=food_b.id, label="1 bowl", mass_g=Decimal(150), source_name="t")
    db.add(serving_b)
    log = f.make_meal_log(db, user)
    db.commit()
    expect_db_error(db, lambda: db.add(m.ConsumedItem(
        meal_log_id=log.id, food_id=food_a.id, serving_id=serving_b.id, display_name="A", quantity=Decimal(1),
        unit="serving", estimated_mass_g=Decimal(150), mass_source="serving_reference", match_confidence="HIGH")))


def test_idempotency_key_unique_per_user(db: Session) -> None:
    user = f.make_user(db)
    log = f.make_meal_log(db, user)
    db.commit()
    dup = m.MealLog(user_id=user.id, idempotency_key=log.idempotency_key, request_fingerprint="0" * 64,
                    meal_type="lunch", source="outside", consumed_at=datetime.now(timezone.utc),
                    log_date=date(2026, 10, 12))
    expect_db_error(db, lambda: db.add(dup))


def test_food_nutrients_and_estimates_are_immutable(db: Session) -> None:
    user = f.make_user(db)
    food = f.make_food(db)
    nutrient = f.make_nutrient(db, food)
    log = f.make_meal_log(db, user)
    item = m.ConsumedItem(meal_log_id=log.id, food_id=food.id, display_name="x", quantity=Decimal(100), unit="g",
                          estimated_mass_g=Decimal(100), mass_source="user_grams", match_confidence="HIGH")
    db.add(item)
    db.flush()
    est = m.NutritionEstimate(consumed_item_id=item.id, food_nutrient_id=nutrient.id, estimate_version=1,
                              method="per_reference_mass", engine_version="t", confidence="HIGH",
                              energy_kcal=Decimal(100), input_snapshot={"mass_g": "100"})
    db.add(est)
    db.commit()
    nutrient.energy_kcal = Decimal(999)
    expect_db_error(db, lambda: None)
    est = db.get(m.NutritionEstimate, est.id)
    assert est is not None
    est.energy_kcal = Decimal(1)
    expect_db_error(db, lambda: None)
    # Flipping the "current" flag is allowed (that is how new versions supersede old ones).
    nutrient = db.get(m.FoodNutrient, nutrient.id)
    assert nutrient is not None
    nutrient.is_current = False
    db.commit()
    # Reference data used by an estimate cannot be deleted.
    expect_db_error(db, lambda: db.delete(nutrient))


def test_one_current_nutrient_profile_per_food(db: Session) -> None:
    food = f.make_food(db)
    f.make_nutrient(db, food)
    db.commit()
    expect_db_error(db, lambda: f.make_nutrient(db, food))


def test_budget_and_transaction_checks(db: Session) -> None:
    user = f.make_user(db)
    db.commit()
    expect_db_error(db, lambda: db.add(m.UserBudget(user_id=user.id, period="yearly", amount=Decimal(10),
                                                    currency="INR", effective_from=date(2026, 1, 1))))
    expect_db_error(db, lambda: db.add(m.UserBudget(user_id=user.id, period="daily", amount=Decimal(10),
                                                    currency="INR", effective_from=date(2026, 2, 1),
                                                    effective_to=date(2026, 1, 1))))
    db.add(m.UserBudget(user_id=user.id, period="daily", amount=Decimal(0), currency="INR",
                        effective_from=date(2026, 1, 1)))
    db.commit()
    expect_db_error(db, lambda: db.add(m.UserBudget(user_id=user.id, period="weekly", amount=Decimal(10),
                                                    currency="INR", effective_from=date(2026, 1, 1))))
    expect_db_error(db, lambda: db.add(m.BudgetTransaction(user_id=user.id, kind="expense", amount=Decimal(-5),
                                                           currency="INR", category="mess",
                                                           occurred_on=date(2026, 1, 1))))


def test_transaction_cannot_link_another_users_meal_log(db: Session) -> None:
    owner, other = f.make_user(db), f.make_user(db)
    log = f.make_meal_log(db, owner)
    db.commit()
    expect_db_error(db, lambda: db.add(m.BudgetTransaction(
        user_id=other.id, kind="expense", amount=Decimal(5), currency="INR", category="mess",
        occurred_on=date(2026, 1, 1), meal_log_id=log.id)))


def test_target_requires_a_value_and_sane_ranges(db: Session) -> None:
    user = f.make_user(db)
    db.commit()
    expect_db_error(db, lambda: db.add(m.NutritionTarget(user_id=user.id, source="self_set",
                                                         effective_from=date(2026, 1, 1))))
    expect_db_error(db, lambda: db.add(m.NutritionTarget(user_id=user.id, source="self_set", energy_kcal=Decimal(100),
                                                         effective_from=date(2026, 1, 1))))


def test_user_deletion_cascades_private_data_but_keeps_shared_reference_data(db: Session) -> None:
    user = f.make_user(db)
    food = f.make_food(db)
    nutrient = f.make_nutrient(db, food)
    inst = m.Institution(name="Shared U", normalized_name="shared u", created_by_user_id=user.id)
    db.add(inst)
    db.add(m.StudentProfile(user_id=user.id, display_name="S"))
    upload = f.make_upload(db, user)
    db.add(m.MenuExtractionJob(upload_id=upload.id, user_id=user.id, provider="t"))
    menu, version, meal = f.make_draft_menu(db, user)
    f.confirm(db, menu, version)
    log = f.make_meal_log(db, user, menu_meal=meal)
    item_row = db.scalars(select(m.MenuItem).where(m.MenuItem.meal_id == meal.id)).first()
    assert item_row is not None
    ci = m.ConsumedItem(meal_log_id=log.id, menu_meal_id=meal.id, menu_item_id=item_row.id, food_id=food.id,
                        display_name="Poha", quantity=Decimal(100), unit="g", estimated_mass_g=Decimal(100),
                        mass_source="user_grams", match_confidence="HIGH")
    db.add(ci)
    db.flush()
    db.add(m.NutritionEstimate(consumed_item_id=ci.id, food_nutrient_id=nutrient.id, estimate_version=1,
                               method="per_reference_mass", engine_version="t", confidence="HIGH",
                               input_snapshot={}))
    exp = m.BudgetTransaction(user_id=user.id, kind="expense", amount=Decimal(50), currency="INR",
                              category="mess", occurred_on=date(2026, 1, 1), meal_log_id=log.id)
    db.add(exp)
    db.flush()
    db.add(m.BudgetTransaction(user_id=user.id, kind="refund", amount=Decimal(10), currency="INR",
                               category="mess", occurred_on=date(2026, 1, 2), refund_of_id=exp.id))
    db.add(m.Recommendation(user_id=user.id, kind="data_gap", title="t", explanation="e", reason_codes=["X"],
                            for_date=date(2026, 1, 1), rule_version="t", menu_item_id=item_row.id))
    db.commit()

    db.delete(user)
    db.commit()

    for model in (m.StudentProfile, m.MenuUpload, m.MenuExtractionJob, m.MessMenu, m.MenuVersion, m.MenuItem,
                  m.MealLog, m.ConsumedItem, m.NutritionEstimate, m.BudgetTransaction, m.Recommendation):
        assert db.scalar(select(func.count()).select_from(model)) == 0, model.__tablename__
    # Shared reference data survives; attribution is cleared.
    assert db.scalar(select(func.count()).select_from(m.FoodNutrient)) == 1
    db.refresh(inst)
    assert inst.created_by_user_id is None


def test_historical_versions_remain_after_new_version(db: Session) -> None:
    user = f.make_user(db)
    menu, v1, _ = f.make_draft_menu(db, user, items=("Poha",))
    f.confirm(db, menu, v1)
    db.commit()
    v2 = m.MenuVersion(menu_id=menu.id, version_number=2, source="revision", based_on_version_id=v1.id)
    db.add(v2)
    db.flush()
    day = m.MenuDay(version_id=v2.id, menu_date=date(2026, 10, 12))
    db.add(day)
    db.flush()
    meal = m.MenuMeal(day_id=day.id, meal_type="breakfast")
    db.add(meal)
    db.flush()
    db.add(m.MenuItem(meal_id=meal.id, position=0, display_name="Upma"))
    db.flush()
    f.confirm(db, menu, v2)
    db.commit()
    names = db.execute(text(
        "SELECT v.version_number, i.display_name FROM menu_items i JOIN menu_meals ml ON ml.id = i.meal_id "
        "JOIN menu_days d ON d.id = ml.day_id JOIN menu_versions v ON v.id = d.version_id "
        "WHERE v.menu_id = :mid ORDER BY v.version_number"), {"mid": menu.id}).all()
    assert [(r[0], r[1]) for r in names] == [(1, "Poha"), (2, "Upma")]
