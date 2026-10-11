"""Meal logging: meals, items, versioned nutrition estimates and summaries.

Rules
- Ownership comes only from the authenticated user; every lookup filters by user_id.
- A meal and its items and estimates are written in one transaction.
- A food is linked only when the student selected it (`food_id`); free text is
  never auto-matched here. Unlinked items are kept with unknown nutrition.
- Editing a portion or food records a new estimate version; old versions stay.
- Dates: `consumed_at` must carry a timezone. `log_date` is its calendar date in
  the student's profile timezone at the time of logging and is not rewritten if
  the profile timezone changes later. Summaries group by `log_date`.
- Deleting a meal does not delete money records: linked expenses are unlinked.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import (BudgetTransaction, ConsumedItem, Food, FoodServing, MealLog, MenuDay, MenuItem, MenuMeal,
                           MenuVersion, MessMenu, NutritionEstimate)
from app.schemas.meals import (MAX_ITEMS_PER_MEAL, DayMealsOut, DayTotalsOut, ItemFoodOut, ItemPreviewOut,
                               ItemServingOut, MealIn,
                               MealItemIn, MealItemOut, MealItemUpdate, MealOut, MealUpdate, RangeSummaryOut)
from app.schemas.nutrition import (EstimateOut, EstimateProvenanceOut, NutrientTotalOut, NutrientValueOut,
                                   TotalsOut)
from app.services.nutrition import catalog
from app.services.nutrition.calculator import NUTRIENTS, UNITS, NutrientAmounts, NutrientTotals, display_value, total
from app.services.nutrition.estimates import compute_estimate, record_estimate
from app.services.nutrition.matching import FoodIndex
from app.services.nutrition.units import InvalidQuantityError, MassResolution, UnitConversionError, resolve_mass
from app.services.timeutil import local_date_of, local_today, user_tz

MAX_RANGE_DAYS = 92
MAX_MEALS_PER_PAGE = 100
EARLIEST_CONSUMED_AT = datetime(2000, 1, 1, tzinfo=timezone.utc)
# Allows for clock skew; a meal cannot be logged as eaten in the future.
FUTURE_TOLERANCE = timedelta(minutes=10)


# --- validation helpers ------------------------------------------------------------------------

def _check_consumed_at(value: datetime) -> None:
    now = datetime.now(timezone.utc)
    if value > now + FUTURE_TOLERANCE:
        raise ValidationFailedError("A meal cannot be logged for a time in the future.", code="future_meal")
    if value < EARLIEST_CONSUMED_AT:
        raise ValidationFailedError("That date is too far in the past.")


def _owned_meal(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID, *, lock: bool = False) -> MealLog:
    stmt = select(MealLog).where(MealLog.id == meal_id, MealLog.user_id == user_id)
    meal = db.scalar(stmt.with_for_update() if lock else stmt)
    if meal is None:
        raise NotFoundError("Meal not found.")
    return meal


def _owned_item(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID, item_id: uuid.UUID) -> ConsumedItem:
    item = db.scalar(select(ConsumedItem).join(MealLog, MealLog.id == ConsumedItem.meal_log_id)
                     .where(ConsumedItem.id == item_id, ConsumedItem.meal_log_id == meal_id,
                            MealLog.user_id == user_id))
    if item is None:
        raise NotFoundError("Meal item not found.")
    return item


class _Indexer:
    """Loads the food index at most once per request, only if a food is referenced."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self._index: FoodIndex | None = None

    def get(self) -> FoodIndex:
        if self._index is None:
            self._index = catalog.load_food_index(self.db)
        return self._index


def _resolve(db: Session, indexer: _Indexer, *, food_id: uuid.UUID | None, display_name: str | None,
             quantity: Decimal, unit: str, serving_id: uuid.UUID | None) -> tuple[Food | None, str, str, MassResolution]:
    """Return (food, display_name, match_confidence, mass) for an item, or raise a 422."""
    food = None
    servings = []
    if food_id is not None:
        food = db.get(Food, food_id)
        if food is None or not food.is_active:
            raise ValidationFailedError("That food is not available. Search again or enter it manually.",
                                        code="food_unavailable")
        servings = catalog.food_servings(db, food.id)
    try:
        mass = resolve_mass(quantity, unit, food_id=food.id if food else None, servings=servings,
                            serving_id=serving_id)
    except (InvalidQuantityError, UnitConversionError) as exc:
        raise ValidationFailedError(str(exc), code="invalid_portion") from exc
    name = display_name or (food.canonical_name if food else "")
    if not name:
        raise ValidationFailedError("Enter the food's name.")
    # Selecting a food is the student's confirmation of which food was meant.
    confidence = indexer.get().confirm(name, food.id).confidence if food else "UNKNOWN"
    return food, name[:160], confidence, mass


def _apply(item: ConsumedItem, food: Food | None, name: str, confidence: str, mass: MassResolution) -> None:
    item.food_id = food.id if food else None
    item.display_name = name
    item.quantity = mass.quantity
    item.unit = mass.unit
    # A serving is stored only for the serving unit; ml conversions keep their basis in the estimate snapshot.
    item.serving_id = mass.serving.id if mass.unit == "serving" and mass.serving else None
    item.estimated_mass_g = mass.mass_g
    item.mass_source = mass.mass_source
    item.match_confidence = confidence


def _add_item(db: Session, indexer: _Indexer, meal: MealLog, data: MealItemIn, position: int) -> None:
    food, name, confidence, mass = _resolve(db, indexer, food_id=data.food_id, display_name=data.display_name,
                                            quantity=data.quantity, unit=data.unit, serving_id=data.serving_id)
    item = ConsumedItem(meal_log_id=meal.id, position=position, note=data.note)
    if data.menu_item_id is not None:
        on_meal = meal.menu_meal_id is not None and db.scalar(
            select(MenuItem.id).where(MenuItem.id == data.menu_item_id, MenuItem.meal_id == meal.menu_meal_id))
        if not on_meal:
            raise ValidationFailedError("A dish isn't on this meal's menu.", code="menu_item_mismatch")
        item.menu_meal_id = meal.menu_meal_id
        item.menu_item_id = data.menu_item_id
    _apply(item, food, name, confidence, mass)
    db.add(item)
    db.flush()
    record_estimate(db, item, mass=mass)


def _fingerprint(data: MealIn) -> str:
    payload = data.model_dump(mode="json", exclude={"idempotency_key"})
    # Menu links are left out when unset, so requests made before they existed keep their fingerprint.
    if payload.get("menu_meal_id") is None:
        payload.pop("menu_meal_id", None)
    for item in payload.get("items", []):
        if item.get("menu_item_id") is None:
            item.pop("menu_item_id", None)
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


# --- commands ------------------------------------------------------------------------------------

def _check_menu_links(db: Session, user_id: uuid.UUID, data: MealIn) -> None:
    """A menu-linked meal must point at a meal of one of this student's confirmed menus."""
    if data.menu_meal_id is None:
        return
    owned = db.scalar(select(MenuMeal.id).join(MenuDay, MenuDay.id == MenuMeal.day_id)
                      .join(MenuVersion, MenuVersion.id == MenuDay.version_id)
                      .join(MessMenu, MessMenu.id == MenuVersion.menu_id)
                      .where(MenuMeal.id == data.menu_meal_id, MessMenu.user_id == user_id,
                             MenuVersion.status == "confirmed"))
    if owned is None:
        raise ValidationFailedError("That menu isn't available. Confirm the menu first.", code="menu_unavailable")
    item_ids = {i.menu_item_id for i in data.items if i.menu_item_id}
    if item_ids:
        found = set(db.scalars(select(MenuItem.id).where(MenuItem.id.in_(item_ids),
                                                         MenuItem.meal_id == data.menu_meal_id)))
        if found != item_ids:
            raise ValidationFailedError("A dish isn't on that menu meal.", code="menu_item_mismatch")


def create_meal(db: Session, user_id: uuid.UUID, data: MealIn) -> tuple[MealOut, bool]:
    """Returns (meal, created). Replaying an idempotency key returns the original meal."""
    _check_consumed_at(data.consumed_at)
    key = data.idempotency_key or uuid.uuid4()
    fingerprint = _fingerprint(data)
    if data.idempotency_key:
        existing = db.scalar(select(MealLog).where(MealLog.user_id == user_id, MealLog.idempotency_key == key))
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise ConflictError("This request key was already used for a different meal.",
                                    code="idempotency_conflict")
            return get_meal(db, user_id, existing.id), False
    _check_menu_links(db, user_id, data)
    meal = MealLog(user_id=user_id, idempotency_key=key, request_fingerprint=fingerprint, meal_type=data.meal_type,
                   source="mess_menu" if data.menu_meal_id else "manual", menu_meal_id=data.menu_meal_id,
                   consumed_at=data.consumed_at,
                   log_date=local_date_of(data.consumed_at, user_tz(db, user_id)), notes=data.note,
                   location_note=data.location_note)
    try:
        db.add(meal)
        db.flush()
        indexer = _Indexer(db)
        for position, item in enumerate(data.items):
            _add_item(db, indexer, meal, item, position)
        db.commit()
    except IntegrityError:
        db.rollback()
        if data.idempotency_key:  # a concurrent replay won the race
            existing = db.scalar(select(MealLog).where(MealLog.user_id == user_id, MealLog.idempotency_key == key))
            if existing is not None and existing.request_fingerprint == fingerprint:
                return get_meal(db, user_id, existing.id), False
        raise
    except Exception:
        db.rollback()
        raise
    return get_meal(db, user_id, meal.id), True


def update_meal(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID, data: MealUpdate) -> MealOut:
    meal = _owned_meal(db, user_id, meal_id)
    changes = data.model_dump(exclude_unset=True)
    if "meal_type" in changes:
        if changes["meal_type"] is None:
            raise ValidationFailedError("Choose a meal type.")
        meal.meal_type = changes["meal_type"]
    if "consumed_at" in changes:
        if changes["consumed_at"] is None:
            raise ValidationFailedError("Enter when the meal was eaten.")
        _check_consumed_at(changes["consumed_at"])
        meal.consumed_at = changes["consumed_at"]
        meal.log_date = local_date_of(changes["consumed_at"], user_tz(db, user_id))
    if "note" in changes:
        meal.notes = changes["note"]
    if "location_note" in changes:
        meal.location_note = changes["location_note"]
    meal.updated_at = func.now()
    db.commit()
    return get_meal(db, user_id, meal.id)


def delete_meal(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID) -> None:
    meal = _owned_meal(db, user_id, meal_id, lock=True)
    # Spending is a separate record: keep the expense, drop only its link to this meal.
    db.execute(update(BudgetTransaction)
               .where(BudgetTransaction.user_id == user_id, BudgetTransaction.meal_log_id == meal.id)
               .values(meal_log_id=None))
    db.delete(meal)
    db.commit()


def add_item(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID, data: MealItemIn) -> MealOut:
    meal = _owned_meal(db, user_id, meal_id, lock=True)  # serializes position assignment
    count, last = db.execute(select(func.count(), func.max(ConsumedItem.position))
                             .where(ConsumedItem.meal_log_id == meal.id)).one()
    if count >= MAX_ITEMS_PER_MEAL:
        raise ValidationFailedError(f"A meal can have at most {MAX_ITEMS_PER_MEAL} items.", code="too_many_items")
    try:
        _add_item(db, _Indexer(db), meal, data, 0 if last is None else last + 1)
        meal.updated_at = func.now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_meal(db, user_id, meal.id)


def update_item(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID, item_id: uuid.UUID,
                data: MealItemUpdate) -> MealOut:
    _owned_meal(db, user_id, meal_id, lock=True)
    item = _owned_item(db, user_id, meal_id, item_id)
    changes = data.model_dump(exclude_unset=True)
    if "note" in changes:
        item.note = changes["note"]
    portion_fields = {"food_id", "quantity", "unit", "serving_id"}
    try:
        if portion_fields & changes.keys():
            if changes.get("quantity", item.quantity) is None or changes.get("unit", item.unit) is None:
                raise ValidationFailedError("Quantity and unit are required.")
            food_id = changes["food_id"] if "food_id" in changes else item.food_id
            unit = changes.get("unit", item.unit)
            if "serving_id" in changes:
                serving_id = changes["serving_id"]
            else:  # keep the chosen serving only while the food and unit stay the same
                serving_id = item.serving_id if (unit == "serving" and food_id == item.food_id) else None
            name = changes.get("display_name") or item.display_name
            if "food_id" in changes and changes["food_id"] != item.food_id and not changes.get("display_name"):
                name = None  # a different food: default to its canonical name
            food, name, confidence, mass = _resolve(db, _Indexer(db), food_id=food_id, display_name=name,
                                                    quantity=changes.get("quantity", item.quantity), unit=unit,
                                                    serving_id=serving_id)
            if food_id != item.food_id:
                item.is_user_corrected = True
            _apply(item, food, name, confidence, mass)
            item.updated_at = func.now()
            db.flush()
            record_estimate(db, item, mass=mass)
        elif changes.get("display_name"):
            item.display_name = changes["display_name"]
            item.updated_at = func.now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_meal(db, user_id, meal_id)


def delete_item(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID, item_id: uuid.UUID) -> MealOut:
    meal = _owned_meal(db, user_id, meal_id, lock=True)
    db.delete(_owned_item(db, user_id, meal_id, item_id))
    meal.updated_at = func.now()
    db.commit()
    return get_meal(db, user_id, meal_id)


def preview_item(db: Session, food_id: uuid.UUID, *, quantity: Decimal, unit: str,
                 serving_id: uuid.UUID | None) -> ItemPreviewOut:
    """Estimate for a portion of a selected food, using the same rules as saving. Writes nothing."""
    food, _name, confidence, mass = _resolve(db, _Indexer(db), food_id=food_id, display_name=None,
                                              quantity=quantity, unit=unit, serving_id=serving_id)
    assert food is not None
    draft = compute_estimate(match_confidence=confidence, mass=mass,
                             profile=catalog.current_nutrient_profile(db, food.id))
    ref = draft.snapshot.get("reference") or {}
    serving = mass.serving if mass.unit == "serving" else None
    return ItemPreviewOut(
        food=ItemFoodOut(id=food.id, canonical_name=food.canonical_name), quantity=mass.quantity, unit=mass.unit,
        serving=ItemServingOut(id=serving.id, label=serving.label, mass_g=serving.mass_g) if serving else None,
        estimated_mass_g=mass.mass_g, mass_source=mass.mass_source, match_confidence=confidence,
        method=draft.method, confidence=draft.confidence, reason=draft.reason,
        nutrients={n: NutrientValueOut(value=draft.amounts.values[n], display=display_value(n, draft.amounts.values[n]),
                                       unit=UNITS[n], status=draft.amounts.statuses[n]) for n in NUTRIENTS},
        provenance=EstimateProvenanceOut(
            food_nutrient_id=draft.profile.food_nutrient_id if draft.profile else None,
            source_name=ref.get("source_name"), source_reference=ref.get("source_reference"),
            source_food_id=ref.get("source_food_id"), dataset_version=ref.get("dataset_version"),
            portion_basis=mass.basis or None, mass_source=mass.mass_source))


# --- presentation --------------------------------------------------------------------------------

def _amounts(est: NutritionEstimate | None) -> NutrientAmounts | None:
    if est is None:
        return None
    statuses = (est.input_snapshot or {}).get("nutrient_status", {})
    values = {n: getattr(est, n) for n in NUTRIENTS}
    return NutrientAmounts(values, {n: statuses.get(n) or ("estimated" if values[n] is not None else "unknown")
                                    for n in NUTRIENTS})


def _totals_out(totals: NutrientTotals) -> TotalsOut:
    nutrients = {n: NutrientTotalOut(total=t.total, display=display_value(n, t.total), unit=t.unit, status=t.status,
                                     known_items=t.known_items, missing_items=t.missing_items)
                 for n, t in totals.nutrients.items()}
    partial = [n for n, t in totals.nutrients.items() if t.status in ("incomplete", "unavailable")]
    note = None
    if partial and totals.item_count:
        note = ("Some items have no data for: " + ", ".join(partial) + ". Those totals include only the items "
                "with data (or are unavailable), so they are lower bounds, not complete amounts.")
    return TotalsOut(item_count=totals.item_count, complete=totals.complete, nutrients=nutrients, note=note)


def _estimate_out(est: NutritionEstimate) -> EstimateOut:
    snap = est.input_snapshot or {}
    ref = snap.get("reference") or {}
    portion = snap.get("portion") or {}
    amounts = _amounts(est)
    assert amounts is not None
    return EstimateOut(
        version=est.estimate_version, method=est.method, confidence=est.confidence,
        engine_version=est.engine_version, calculated_at=est.calculated_at, reason=snap.get("reason"),
        nutrients={n: NutrientValueOut(value=amounts.values[n], display=display_value(n, amounts.values[n]),
                                       unit=UNITS[n], status=amounts.statuses[n]) for n in NUTRIENTS},
        provenance=EstimateProvenanceOut(
            food_nutrient_id=est.food_nutrient_id, source_name=ref.get("source_name"),
            source_reference=ref.get("source_reference"), source_food_id=ref.get("source_food_id"),
            dataset_version=ref.get("dataset_version"), portion_basis=portion.get("basis"),
            mass_source=portion.get("mass_source", "unknown")))


def _load(db: Session, meals: Sequence[MealLog]) -> list[MealOut]:
    ids = [m.id for m in meals]
    items_by_meal: dict[uuid.UUID, list[ConsumedItem]] = defaultdict(list)
    items = list(db.scalars(select(ConsumedItem).where(ConsumedItem.meal_log_id.in_(ids))
                            .order_by(ConsumedItem.position))) if ids else []
    for it in items:
        items_by_meal[it.meal_log_id].append(it)
    item_ids = [it.id for it in items]
    estimates = {e.consumed_item_id: e for e in db.scalars(
        select(NutritionEstimate).where(NutritionEstimate.consumed_item_id.in_(item_ids),
                                        NutritionEstimate.is_current.is_(True)))} if item_ids else {}
    food_ids = {it.food_id for it in items if it.food_id}
    foods = {f.id: f for f in db.scalars(select(Food).where(Food.id.in_(food_ids)))} if food_ids else {}
    serving_ids = {it.serving_id for it in items if it.serving_id}
    servings = {s.id: s for s in db.scalars(select(FoodServing).where(FoodServing.id.in_(serving_ids)))} \
        if serving_ids else {}

    out = []
    for meal in meals:
        rows = []
        for it in items_by_meal[meal.id]:
            est = estimates.get(it.id)
            food = foods.get(it.food_id) if it.food_id else None
            serving = servings.get(it.serving_id) if it.serving_id else None
            rows.append(MealItemOut(
                id=it.id, position=it.position, display_name=it.display_name,
                food=ItemFoodOut(id=food.id, canonical_name=food.canonical_name) if food else None,
                is_manual=it.food_id is None, quantity=it.quantity, unit=it.unit,
                serving=ItemServingOut(id=serving.id, label=serving.label, mass_g=serving.mass_g) if serving else None,
                estimated_mass_g=it.estimated_mass_g, mass_source=it.mass_source,
                match_confidence=it.match_confidence, note=it.note,
                estimate=_estimate_out(est) if est else None, created_at=it.created_at, updated_at=it.updated_at))
        totals = total(_amounts(estimates.get(it.id)) for it in items_by_meal[meal.id])
        out.append(MealOut(id=meal.id, meal_type=meal.meal_type, source=meal.source, consumed_at=meal.consumed_at,
                           log_date=meal.log_date, note=meal.notes,
                           location_note=meal.location_note, items=rows, totals=_totals_out(totals),
                           created_at=meal.created_at, updated_at=meal.updated_at))
    return out


def get_meal(db: Session, user_id: uuid.UUID, meal_id: uuid.UUID) -> MealOut:
    db.expire_all()  # read what was committed, including server-side timestamps
    return _load(db, [_owned_meal(db, user_id, meal_id)])[0]


def _check_range(start: date, end: date) -> None:
    if end < start:
        raise ValidationFailedError("The end date must be on or after the start date.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ValidationFailedError(f"Choose a range of at most {MAX_RANGE_DAYS} days.", code="range_too_long")


def list_meals(db: Session, user_id: uuid.UUID, *, start: date | None, end: date | None, limit: int,
               offset: int) -> tuple[list[MealOut], int]:
    cond = [MealLog.user_id == user_id]
    if start and end:
        _check_range(start, end)
    if start:
        cond.append(MealLog.log_date >= start)
    if end:
        cond.append(MealLog.log_date <= end)
    total_count = db.scalar(select(func.count()).select_from(MealLog).where(*cond)) or 0
    meals = list(db.scalars(select(MealLog).where(*cond)
                            .order_by(MealLog.consumed_at.desc(), MealLog.id).limit(limit).offset(offset)))
    return _load(db, meals), total_count


def day(db: Session, user_id: uuid.UUID, on: date | None) -> DayMealsOut:
    on = on or local_today(db, user_id)
    meals = list(db.scalars(select(MealLog).where(MealLog.user_id == user_id, MealLog.log_date == on)
                            .order_by(MealLog.consumed_at, MealLog.id).limit(MAX_MEALS_PER_PAGE)))
    loaded = _load(db, meals)
    items = _day_amounts(db, user_id, on, on).get(on, [])
    return DayMealsOut(date=on, meals=loaded, totals=_totals_out(total(items)))


def _day_amounts(db: Session, user_id: uuid.UUID, start: date, end: date) -> dict[date, list[NutrientAmounts | None]]:
    rows = db.execute(
        select(MealLog.log_date, NutritionEstimate)
        .join(ConsumedItem, ConsumedItem.meal_log_id == MealLog.id)
        .outerjoin(NutritionEstimate, (NutritionEstimate.consumed_item_id == ConsumedItem.id)
                   & NutritionEstimate.is_current.is_(True))
        .where(MealLog.user_id == user_id, MealLog.log_date >= start, MealLog.log_date <= end)).all()
    out: dict[date, list[NutrientAmounts | None]] = defaultdict(list)
    for log_date, est in rows:
        out[log_date].append(_amounts(est))
    return out


def summary(db: Session, user_id: uuid.UUID, *, start: date | None, end: date | None,
            days: int | None) -> RangeSummaryOut:
    """Per-day totals over an inclusive range of local dates. `days=7` means today and the 6 days before."""
    if days is not None:
        end = end or local_today(db, user_id)
        start = end - timedelta(days=days - 1)
    if start is None or end is None:
        raise ValidationFailedError("Give start and end dates, or a number of days.")
    _check_range(start, end)
    by_day = _day_amounts(db, user_id, start, end)
    count_rows = db.execute(select(MealLog.log_date, func.count()).where(
        MealLog.user_id == user_id, MealLog.log_date >= start, MealLog.log_date <= end)
        .group_by(MealLog.log_date)).all()
    meal_counts: dict[date, int] = {log_date: count for log_date, count in count_rows}
    out_days = []
    cur = start
    all_items: list[NutrientAmounts | None] = []
    while cur <= end:
        items = by_day.get(cur, [])
        all_items.extend(items)
        out_days.append(DayTotalsOut(date=cur, meal_count=meal_counts.get(cur, 0), totals=_totals_out(total(items))))
        cur += timedelta(days=1)
    return RangeSummaryOut(start=start, end=end, days=out_days, totals=_totals_out(total(all_items)),
                           days_with_meals=len(meal_counts))
