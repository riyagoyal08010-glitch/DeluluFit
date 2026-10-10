"""Minimal ORM factories for database-level tests. Test-only data."""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db import models as m


def make_user(db: Session, email: str | None = None) -> m.User:
    user = m.User(email=email or f"user-{uuid.uuid4().hex[:8]}@example.test",
                  password_hash=hash_password("correct horse battery"))
    db.add(user)
    db.flush()
    return user


def make_upload(db: Session, user: m.User) -> m.MenuUpload:
    digest = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
    upload = m.MenuUpload(user_id=user.id, storage_key=f"test/{digest}", content_type="image/png",
                          size_bytes=100, sha256=digest)
    db.add(upload)
    db.flush()
    return upload


def make_food(db: Session, name: str = "Test food") -> m.Food:
    food = m.Food(canonical_name=name, normalized_name=f"{name.lower()} {uuid.uuid4().hex[:6]}")
    db.add(food)
    db.flush()
    return food


def make_nutrient(db: Session, food: m.Food, kcal: str | None = "100") -> m.FoodNutrient:
    row = m.FoodNutrient(food_id=food.id, reference_mass_g=Decimal("100"),
                         energy_kcal=Decimal(kcal) if kcal else None, protein_g=Decimal("3"),
                         source_name="Test fixture", dataset_version="test")
    db.add(row)
    db.flush()
    return row


def make_draft_menu(db: Session, user: m.User, *, menu_date: date = date(2026, 10, 12),
                    items: tuple[str, ...] = ("Poha", "Milk")) -> tuple[m.MessMenu, m.MenuVersion, m.MenuMeal]:
    menu = m.MessMenu(user_id=user.id, title="Test menu")
    db.add(menu)
    db.flush()
    version = m.MenuVersion(menu_id=menu.id, version_number=1, source="manual")
    db.add(version)
    db.flush()
    day = m.MenuDay(version_id=version.id, menu_date=menu_date)
    db.add(day)
    db.flush()
    meal = m.MenuMeal(day_id=day.id, meal_type="breakfast")
    db.add(meal)
    db.flush()
    for pos, name in enumerate(items):
        db.add(m.MenuItem(meal_id=meal.id, position=pos, display_name=name))
    db.flush()
    return menu, version, meal


def confirm(db: Session, menu: m.MessMenu, version: m.MenuVersion) -> None:
    version.status = "confirmed"
    version.confirmed_at = datetime.now(timezone.utc)
    db.flush()
    menu.current_version_id = version.id
    db.flush()


def make_meal_log(db: Session, user: m.User, *, menu_meal: m.MenuMeal | None = None) -> m.MealLog:
    log = m.MealLog(user_id=user.id, idempotency_key=uuid.uuid4(), request_fingerprint="0" * 64,
                    meal_type="breakfast", source="mess_menu" if menu_meal else "outside",
                    consumed_at=datetime.now(timezone.utc), log_date=date(2026, 10, 12),
                    menu_meal_id=menu_meal.id if menu_meal else None)
    db.add(log)
    db.flush()
    return log
