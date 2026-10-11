"""Mess menus: photo upload, extraction jobs, review, confirmation, revision and deletion.

States (derived, never stored separately):

    processing    the draft has an extraction job that is queued or running
    failed        the draft's extraction job failed (retry, or type the dishes in)
    needs_review  a draft exists and nothing is running
    confirmed     no draft; the current version is confirmed

A menu has at most one draft version (unique index) and any number of
confirmed versions, which the database keeps immutable. Every query is scoped
to the signed-in student; another student's menu is simply "not found".
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.errors import (
    AppError,
    ConflictError,
    NotFoundError,
    ValidationFailedError,
)
from app.db import enums
from app.db.models import (
    ConsumedItem,
    Food,
    MealLog,
    MenuDay,
    MenuExtractionJob,
    MenuItem,
    MenuMeal,
    MenuUpload,
    MenuVersion,
    Mess,
    MessMenu,
)
from app.schemas.menus import (
    ExtractionJobOut,
    ExtractionStateOut,
    MenuDetailOut,
    MenuDraftIn,
    MenuFoodOut,
    MenuImageOut,
    MenuItemOut,
    MenuListOut,
    MenuStatus,
    MenuSummaryOut,
    MenuVersionOut,
)
from app.services import menu_images
from app.services.extraction import (
    ExtractionError,
    ExtractionProvider,
    ExtractionResult,
    get_provider,
)
from app.services.nutrition import catalog
from app.services.storage import get_storage
from app.services.timeutil import local_today

logger = logging.getLogger("app.menus")

MEAL_ORDER = {m: i for i, m in enumerate(enums.MEAL_TYPES)}
ACTIVE_JOB = ("queued", "processing")
# Extra runs a student may ask for after a job has used up its automatic attempts.
MAX_MANUAL_RETRIES = 3


class ExtractionUnavailableError(AppError):
    status_code = 503
    code = "extraction_unavailable"


# --- loading ----------------------------------------------------------------------------------

def _owned_menu(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID, *, lock: bool = False) -> MessMenu:
    stmt = select(MessMenu).where(MessMenu.id == menu_id, MessMenu.user_id == user_id)
    if lock:
        stmt = stmt.with_for_update()
    menu = db.scalar(stmt)
    if menu is None:
        raise NotFoundError("Menu not found.")
    return menu


def _versions(db: Session, menu: MessMenu) -> tuple[MenuVersion | None, MenuVersion | None]:
    """(draft, current confirmed) with days, meals and items loaded."""
    rows = db.scalars(select(MenuVersion).where(MenuVersion.menu_id == menu.id)
                      .options(selectinload(MenuVersion.days).selectinload(MenuDay.meals)
                               .selectinload(MenuMeal.items))).all()
    draft = next((v for v in rows if v.status == "draft"), None)
    current = next((v for v in rows if v.id == menu.current_version_id), None)
    return draft, current


def _job(db: Session, version: MenuVersion | None) -> MenuExtractionJob | None:
    if version is None or version.extraction_job_id is None:
        return None
    return db.get(MenuExtractionJob, version.extraction_job_id)


def _status(draft: MenuVersion | None, job: MenuExtractionJob | None) -> MenuStatus:
    if draft is None:
        return "confirmed"
    if job is not None and job.status in ACTIVE_JOB:
        return "processing"
    if job is not None and job.status == "failed":
        return "failed"
    return "needs_review"


def _day(version: MenuVersion) -> MenuDay:
    if not version.days:
        raise RuntimeError("menu version without a day")  # every version is created with exactly one
    return version.days[0]


def _items(version: MenuVersion) -> list[MenuItem]:
    meals = sorted(_day(version).meals, key=lambda m: MEAL_ORDER.get(m.meal_type, 99))
    return [i for m in meals for i in m.items]


def _food_names(db: Session, versions: list[MenuVersion | None]) -> dict[uuid.UUID, str]:
    ids = {i.food_id for v in versions if v for i in _items(v) if i.food_id}
    if not ids:
        return {}
    return dict(db.execute(select(Food.id, Food.canonical_name).where(Food.id.in_(ids))).all())


def _version_out(version: MenuVersion, foods: dict[uuid.UUID, str]) -> MenuVersionOut:
    day = _day(version)
    items = []
    for meal in sorted(day.meals, key=lambda m: MEAL_ORDER.get(m.meal_type, 99)):
        for i in meal.items:
            items.append(MenuItemOut(
                id=i.id, meal_id=meal.id, meal_type=meal.meal_type, position=i.position, name=i.display_name,
                source=i.source, is_user_corrected=i.is_user_corrected, extraction_confidence=i.extraction_confidence,
                section_heading=i.section_heading, serving_note=i.serving_note, price=i.price,
                food=MenuFoodOut(id=i.food_id, canonical_name=foods.get(i.food_id, "")) if i.food_id else None,
                match_confidence=i.match_confidence))
    return MenuVersionOut(id=version.id, version_number=version.version_number, status=version.status,
                          source=version.source, meal_type_hint=version.meal_type_hint, menu_date=day.menu_date,
                          confirmed_at=version.confirmed_at, items=items)


def _job_out(job: MenuExtractionJob) -> ExtractionJobOut:
    result = job.result or {}
    detected = result.get("menu_date")
    return ExtractionJobOut(
        status=job.status, attempt_count=job.attempt_count, max_attempts=get_settings().extraction_max_attempts,
        error_code=job.error_code, error_message=job.error_message, started_at=job.started_at,
        finished_at=job.finished_at, is_menu=result.get("is_menu") if job.result is not None else None,
        item_count=(job.metrics or {}).get("item_count") if job.status == "succeeded" else None,
        detected_date=date.fromisoformat(detected) if detected else None)


def _upload_of(db: Session, draft: MenuVersion | None, current: MenuVersion | None) -> MenuUpload | None:
    upload_id = (draft.upload_id if draft else None) or (current.upload_id if current else None)
    return db.get(MenuUpload, upload_id) if upload_id else None


def _summary_fields(menu: MessMenu, draft: MenuVersion | None, current: MenuVersion | None,
                    job: MenuExtractionJob | None, upload: MenuUpload | None) -> dict[str, object]:
    shown = draft or current
    assert shown is not None
    return dict(id=menu.id, title=menu.title, menu_date=_day(shown).menu_date, meal_type_hint=shown.meal_type_hint,
                mess_id=menu.mess_id, status=_status(draft, job), has_draft=draft is not None, has_confirmed=current is not None,
                item_count=len(_items(shown)), has_image=upload is not None, created_at=menu.created_at,
                updated_at=menu.updated_at)


def detail(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID) -> MenuDetailOut:
    menu = _owned_menu(db, user_id, menu_id)
    draft, current = _versions(db, menu)
    job = _job(db, draft)
    upload = _upload_of(db, draft, current)
    foods = _food_names(db, [draft, current])
    available = get_provider_available()
    manual_retries = int((job.metrics or {}).get("manual_retries", 0)) if job else 0
    extraction = ExtractionStateOut(
        available=available, job=_job_out(job) if job else None,
        can_start=available and draft is not None and draft.upload_id is not None and job is None,
        can_retry=available and job is not None and job.status == "failed" and manual_retries < MAX_MANUAL_RETRIES)
    return MenuDetailOut(
        **_summary_fields(menu, draft, current, job, upload),  # type: ignore[arg-type]
        image=MenuImageOut(width=upload.width_px, height=upload.height_px, size_bytes=upload.size_bytes)
        if upload else None,
        extraction=extraction, draft=_version_out(draft, foods) if draft else None,
        confirmed=_version_out(current, foods) if current else None)


def get_provider_available() -> bool:
    return get_settings().extraction_enabled


def list_menus(db: Session, user_id: uuid.UUID, *, limit: int, offset: int) -> MenuListOut:
    total = db.scalar(select(func.count()).select_from(MessMenu).where(MessMenu.user_id == user_id)) or 0
    # Newest menu date first: order on the date of the draft (or current) version's day.
    shown_date = (select(func.max(MenuDay.menu_date)).join(MenuVersion, MenuVersion.id == MenuDay.version_id)
                  .where(MenuVersion.menu_id == MessMenu.id).scalar_subquery())
    menus = db.scalars(select(MessMenu).where(MessMenu.user_id == user_id)
                       .order_by(shown_date.desc(), MessMenu.created_at.desc()).limit(limit).offset(offset)).all()
    out = []
    for menu in menus:
        draft, current = _versions(db, menu)
        out.append(MenuSummaryOut(**_summary_fields(menu, draft, current, _job(db, draft),  # type: ignore[arg-type]
                                                    _upload_of(db, draft, current))))
    return MenuListOut(items=out, total=total, limit=limit, offset=offset)


# --- create -----------------------------------------------------------------------------------

def _check_menu_date(db: Session, user_id: uuid.UUID, menu_date: date) -> None:
    today = local_today(db, user_id)
    if not (today - timedelta(days=366) <= menu_date <= today + timedelta(days=60)):
        raise ValidationFailedError("Choose a menu date within the past year or the next 60 days.",
                                    code="menu_date_out_of_range")


def _title(menu_date: date) -> str:
    return f"Menu for {menu_date.strftime('%d %b %Y')}"


def create_menu(db: Session, user_id: uuid.UUID, *, menu_date: date, meal_type: str | None,
                image: bytes | None, mess_id: uuid.UUID | None = None) -> MenuDetailOut:
    """Create a menu with a draft version, optionally from a photo. Photo-reading starts if configured."""
    _check_menu_date(db, user_id, menu_date)
    # Checked before any file is written. The composite FK (mess_id, user_id) backs this up.
    if mess_id is not None and db.scalar(select(Mess.id).where(Mess.id == mess_id, Mess.user_id == user_id)) is None:
        raise ValidationFailedError("Choose one of your own messes.", code="mess_unavailable")
    normalized = menu_images.normalize(image) if image is not None else None
    if normalized is not None:
        existing = db.scalar(select(MenuUpload.id).where(MenuUpload.user_id == user_id,
                                                         MenuUpload.sha256 == normalized.original_sha256))
        if existing is not None:
            raise _duplicate(db, existing)

    settings = get_settings()
    storage = get_storage()
    key = f"menus/{user_id.hex}/{uuid.uuid4().hex}" if normalized else None
    if key and normalized:
        storage.put(key, normalized.data, normalized.content_type)
    try:
        menu = MessMenu(user_id=user_id, mess_id=mess_id, title=_title(menu_date))
        db.add(menu)
        db.flush()
        upload = None
        job = None
        if normalized and key:
            upload = MenuUpload(user_id=user_id, storage_key=key, original_filename=None,
                                content_type=normalized.content_type, size_bytes=len(normalized.data),
                                sha256=normalized.original_sha256, width_px=normalized.width,
                                height_px=normalized.height)
            db.add(upload)
            db.flush()
            if settings.extraction_enabled:
                job = MenuExtractionJob(upload_id=upload.id, user_id=user_id, status="queued",
                                        provider=settings.extraction_provider, model=settings.anthropic_model)
                db.add(job)
                db.flush()
        version = MenuVersion(menu_id=menu.id, version_number=1, status="draft",
                              source="extraction" if job else "manual", upload_id=upload.id if upload else None,
                              extraction_job_id=job.id if job else None, meal_type_hint=meal_type)
        db.add(version)
        db.flush()
        db.add(MenuDay(version_id=version.id, menu_date=menu_date))
        db.commit()
    except IntegrityError:
        db.rollback()
        if key:
            _delete_objects([key])
        if normalized is not None:
            existing = db.scalar(select(MenuUpload.id).where(MenuUpload.user_id == user_id,
                                                             MenuUpload.sha256 == normalized.original_sha256))
            if existing is not None:  # the same photo was uploaded concurrently
                raise _duplicate(db, existing) from None
        raise
    except Exception:
        db.rollback()
        if key:
            _delete_objects([key])  # no orphaned file when the database write fails
        raise
    logger.info("menu_created", extra={"user_id": str(user_id), "menu_id": str(menu.id),
                                       "has_image": normalized is not None, "extraction_queued": job is not None})
    return detail(db, user_id, menu.id)


def _duplicate(db: Session, upload_id: uuid.UUID) -> ConflictError:
    menu_id = db.scalar(select(MenuVersion.menu_id).where(MenuVersion.upload_id == upload_id).limit(1))
    return ConflictError("You've already uploaded this photo.", code="duplicate_upload",
                         details={"menu_id": str(menu_id) if menu_id else None})


# --- image ------------------------------------------------------------------------------------

def image(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID) -> tuple[bytes, str]:
    menu = _owned_menu(db, user_id, menu_id)
    draft, current = _versions(db, menu)
    upload = _upload_of(db, draft, current)
    if upload is None:
        raise NotFoundError("This menu has no photo.", code="no_image")
    try:
        return get_storage().get(upload.storage_key), upload.content_type
    except (FileNotFoundError, KeyError):
        raise NotFoundError("The photo for this menu is no longer available.", code="image_unavailable") from None
    except Exception:
        logger.exception("menu_image_read_failed", extra={"menu_id": str(menu_id)})
        raise NotFoundError("The photo for this menu is no longer available.", code="image_unavailable") from None


# --- extraction: start / retry ----------------------------------------------------------------

def start_extraction(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID) -> MenuDetailOut:
    settings = get_settings()
    if not settings.extraction_enabled:
        raise ExtractionUnavailableError("Reading dishes from photos isn't available on this server. "
                                         "You can type the dishes in instead.")
    menu = _owned_menu(db, user_id, menu_id, lock=True)  # serializes concurrent starts for this menu
    draft, _ = _versions(db, menu)
    if draft is None or draft.upload_id is None:
        raise ConflictError("There's no unconfirmed photo to read for this menu.", code="nothing_to_extract")
    job = _job(db, draft)
    if job is None:
        job = MenuExtractionJob(upload_id=draft.upload_id, user_id=user_id, status="queued",
                                provider=settings.extraction_provider, model=settings.anthropic_model)
        db.add(job)
        db.flush()
        draft.source = "extraction"
        draft.extraction_job_id = job.id
    elif job.status in ACTIVE_JOB:
        raise ConflictError("This photo is already being read.", code="extraction_in_progress")
    elif job.status == "succeeded":
        raise ConflictError("This photo has already been read. Edit the dishes instead.", code="already_extracted")
    else:  # failed: queue it again, a bounded number of times
        retries = int((job.metrics or {}).get("manual_retries", 0))
        if retries >= MAX_MANUAL_RETRIES:
            raise ConflictError("This photo couldn't be read after several tries. Type the dishes in instead.",
                                code="retry_limit")
        # Conditional update: only one request can move it out of "failed".
        moved = db.execute(update(MenuExtractionJob)
                           .where(MenuExtractionJob.id == job.id, MenuExtractionJob.status == "failed")
                           .values(status="queued", attempt_count=0, available_at=func.now(), error_code=None,
                                   error_message=None, finished_at=None, lease_expires_at=None,
                                   metrics={**(job.metrics or {}), "manual_retries": retries + 1})).rowcount
        if moved != 1:
            raise ConflictError("This photo is already being read.", code="extraction_in_progress")
    db.commit()
    db.expire_all()
    return detail(db, user_id, menu_id)


# --- review: save draft, confirm, revise ------------------------------------------------------

def _assert_editable(db: Session, draft: MenuVersion | None) -> MenuVersion:
    if draft is None:
        raise ConflictError("This menu is confirmed. Choose “Edit menu” to make changes.", code="no_draft")
    job = _job(db, draft)
    if job is not None and job.status in ACTIVE_JOB:
        raise ConflictError("The photo is still being read. You can edit the dishes when it's done.",
                            code="extraction_in_progress")
    return draft


def save_draft(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID, data: MenuDraftIn) -> MenuDetailOut:
    """Replace the draft's dish list. Kept dishes keep their id and provenance; changed ones are marked corrected."""
    menu = _owned_menu(db, user_id, menu_id, lock=True)
    draft = _assert_editable(db, _versions(db, menu)[0])
    _check_menu_date(db, user_id, data.menu_date)
    day = _day(draft)
    existing = {i.id: (i, m.meal_type) for m in day.meals for i in m.items}
    for item in data.items:
        if item.id is not None and item.id not in existing:
            raise ValidationFailedError("A dish in this list doesn't belong to this menu.", code="unknown_item")
    food_ids = {i.food_id for i in data.items if i.food_id}
    active = set(db.scalars(select(Food.id).where(Food.id.in_(food_ids), Food.is_active.is_(True)))) if food_ids else set()
    if food_ids - active:
        raise ValidationFailedError("That food is not available. Search again.", code="food_unavailable")

    index = catalog.load_food_index(db) if food_ids else None
    snapshot = []
    for item in data.items:
        old = existing.get(item.id) if item.id else None
        snapshot.append((item, old))

    # Rebuild meals and items in canonical order, reusing ids so the client's references stay valid.
    db.execute(delete(MenuItem).where(MenuItem.meal_id.in_([m.id for m in day.meals])))
    db.execute(delete(MenuMeal).where(MenuMeal.day_id == day.id))
    db.flush()
    day.menu_date = data.menu_date
    menu.title = _title(data.menu_date)
    by_meal: dict[str, MenuMeal] = {}
    positions: dict[str, int] = {}
    for item, old in sorted(snapshot, key=lambda p: MEAL_ORDER[p[0].meal_type]):
        meal = by_meal.get(item.meal_type)
        if meal is None:
            meal = MenuMeal(day_id=day.id, meal_type=item.meal_type, sort_order=MEAL_ORDER[item.meal_type])
            db.add(meal)
            db.flush()
            by_meal[item.meal_type] = meal
        pos = positions.get(item.meal_type, 0)
        positions[item.meal_type] = pos + 1
        if item.food_id and index is not None:
            confidence = index.confirm(item.name, item.food_id).confidence
        else:
            confidence = "UNKNOWN"
        row = MenuItem(meal_id=meal.id, position=pos, display_name=item.name[:160], food_id=item.food_id,
                       match_confidence=confidence, price=item.price, source="manual")
        if old is not None:
            prev, prev_meal = old
            row.id = prev.id
            row.source = prev.source
            row.extraction_confidence = prev.extraction_confidence
            row.section_heading = prev.section_heading
            row.serving_note = prev.serving_note
            if prev.food_id == item.food_id:
                row.match_confidence = prev.match_confidence
            # A change to what the photo said (name, meal, food link) is a correction.
            row.is_user_corrected = prev.is_user_corrected or (
                prev.display_name != item.name or prev_meal != item.meal_type or prev.food_id != item.food_id)
        db.add(row)
    menu.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.expire_all()
    return detail(db, user_id, menu_id)


def confirm(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID) -> MenuDetailOut:
    menu = _owned_menu(db, user_id, menu_id, lock=True)
    draft, current = _versions(db, menu)
    if draft is None and current is not None:
        return detail(db, user_id, menu_id)  # already confirmed: a repeated click changes nothing
    draft = _assert_editable(db, draft)
    if not _items(draft):
        raise ValidationFailedError("Add at least one dish before confirming.", code="menu_empty")
    draft.status = "confirmed"
    draft.confirmed_at = datetime.now(timezone.utc)
    menu.current_version_id = draft.id
    menu.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.expire_all()
    return detail(db, user_id, menu_id)


def revise(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID) -> MenuDetailOut:
    """Start editing a confirmed menu: a new draft copied from it. Logged meals keep pointing at the old version."""
    menu = _owned_menu(db, user_id, menu_id, lock=True)
    draft, current = _versions(db, menu)
    if draft is not None:
        return detail(db, user_id, menu_id)
    if current is None:
        raise ConflictError("This menu has nothing to edit.", code="no_confirmed_version")
    number = (db.scalar(select(func.max(MenuVersion.version_number)).where(MenuVersion.menu_id == menu.id)) or 0) + 1
    new = MenuVersion(menu_id=menu.id, version_number=number, status="draft", source="revision",
                      upload_id=current.upload_id, based_on_version_id=current.id,
                      meal_type_hint=current.meal_type_hint)
    db.add(new)
    db.flush()
    day = MenuDay(version_id=new.id, menu_date=_day(current).menu_date)
    db.add(day)
    db.flush()
    for old_meal in _day(current).meals:
        meal = MenuMeal(day_id=day.id, meal_type=old_meal.meal_type, sort_order=old_meal.sort_order)
        db.add(meal)
        db.flush()
        for i in old_meal.items:
            db.add(MenuItem(meal_id=meal.id, position=i.position, display_name=i.display_name, food_id=i.food_id,
                            match_confidence=i.match_confidence, extraction_confidence=i.extraction_confidence,
                            is_user_corrected=i.is_user_corrected, price=i.price, source=i.source,
                            section_heading=i.section_heading, serving_note=i.serving_note))
    menu.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.expire_all()
    return detail(db, user_id, menu_id)


# --- delete -----------------------------------------------------------------------------------

def _delete_objects(keys: list[str]) -> None:
    storage = get_storage()
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            # The rows are already gone; an orphaned private file is logged for cleanup, never exposed.
            logger.exception("upload_delete_failed", extra={"storage_key": key})


def delete_menu(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID) -> None:
    """Delete the menu, its versions, dishes, photo and extraction jobs.

    Meals already logged from it are kept (they're the student's record of what they ate);
    their link to the deleted menu is removed and they become ordinary manual meals.
    """
    menu = _owned_menu(db, user_id, menu_id, lock=True)
    meal_ids = list(db.scalars(select(MenuMeal.id).join(MenuDay, MenuDay.id == MenuMeal.day_id)
                               .join(MenuVersion, MenuVersion.id == MenuDay.version_id)
                               .where(MenuVersion.menu_id == menu.id)))
    upload_ids = {u for u in db.scalars(select(MenuVersion.upload_id).where(MenuVersion.menu_id == menu.id)) if u}
    # Only files of uploads this student owns; any other upload is left alone.
    keys = list(db.scalars(select(MenuUpload.storage_key).where(MenuUpload.id.in_(upload_ids),
                                                                MenuUpload.user_id == user_id))) if upload_ids else []
    if meal_ids:
        db.execute(update(ConsumedItem).where(ConsumedItem.menu_meal_id.in_(meal_ids))
                   .values(menu_item_id=None, menu_meal_id=None))
        db.execute(update(MealLog).where(MealLog.menu_meal_id.in_(meal_ids), MealLog.user_id == user_id)
                   .values(menu_meal_id=None, source="manual"))
    menu.current_version_id = None
    db.flush()
    db.delete(menu)
    db.flush()
    if upload_ids:
        db.execute(delete(MenuUpload).where(MenuUpload.id.in_(upload_ids), MenuUpload.user_id == user_id))
    db.commit()
    _delete_objects(keys)  # after the commit, so a failed delete never leaves rows pointing at nothing
    logger.info("menu_deleted", extra={"user_id": str(user_id), "menu_id": str(menu_id), "files": len(keys)})


# --- extraction: worker -----------------------------------------------------------------------

def _claim(db: Session) -> uuid.UUID | None:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    job = db.scalar(select(MenuExtractionJob)
                    .where(((MenuExtractionJob.status == "queued") & (MenuExtractionJob.available_at <= now))
                           | ((MenuExtractionJob.status == "processing")
                              & (MenuExtractionJob.lease_expires_at < now)))
                    .order_by(MenuExtractionJob.available_at).limit(1).with_for_update(skip_locked=True))
    if job is None:
        db.rollback()
        return None
    if job.status == "processing" and job.attempt_count >= settings.extraction_max_attempts:
        # A worker died mid-attempt on the last try.
        job.status, job.error_code, job.finished_at, job.lease_expires_at = "failed", "timed_out", now, None
        job.error_message = "Reading the photo didn't finish."
        db.commit()
        return None
    job.status = "processing"
    job.attempt_count += 1
    job.started_at = job.started_at or now
    job.lease_expires_at = now + timedelta(seconds=settings.extraction_lease_seconds)
    db.commit()
    return job.id


def _apply_result(db: Session, job: MenuExtractionJob, result: ExtractionResult) -> int:
    """Append extracted dishes to the job's draft. Returns how many were added."""
    draft = db.scalar(select(MenuVersion).where(MenuVersion.extraction_job_id == job.id,
                                                MenuVersion.status == "draft")
                      .options(selectinload(MenuVersion.days).selectinload(MenuDay.meals)
                               .selectinload(MenuMeal.items)))
    if draft is None:
        return 0
    day = _day(draft)
    meals = {m.meal_type: m for m in day.meals}
    index = catalog.load_food_index(db)
    added = 0
    for section in result.sections:
        meal_type = section.meal_type or draft.meal_type_hint or "other"
        meal = meals.get(meal_type)
        if meal is None:
            meal = MenuMeal(day_id=day.id, meal_type=meal_type, sort_order=MEAL_ORDER[meal_type])
            db.add(meal)
            db.flush()
            meals[meal_type] = meal
        position = max((i.position for i in meal.items), default=-1) + 1
        for item in section.items:
            # Only an unambiguous name match links a food; anything else stays unlinked for review.
            match = index.match(item.name)
            food = match.food
            db.add(MenuItem(meal_id=meal.id, position=position, display_name=item.name, source="extraction",
                            food_id=food.food_id if food else None, match_confidence=match.confidence,
                            extraction_confidence=Decimal(str(round(item.confidence, 3)))
                            if item.confidence is not None else None,
                            section_heading=section.heading, serving_note=item.serving_note))
            position += 1
            added += 1
    menu = db.get(MessMenu, draft.menu_id)
    if menu is not None:
        menu.updated_at = datetime.now(timezone.utc)
    return added


def run_next_job(session_factory: Callable[[], Session], provider: ExtractionProvider) -> bool:
    """Claim and process one job. Returns False when there was nothing to do."""
    settings = get_settings()
    with session_factory() as db:
        job_id = _claim(db)
    if job_id is None:
        return False

    with session_factory() as db:
        job = db.get(MenuExtractionJob, job_id)
        if job is None:
            return True
        upload = db.get(MenuUpload, job.upload_id)
        hint = db.scalar(select(MenuVersion.meal_type_hint).where(MenuVersion.extraction_job_id == job.id))
        attempt = job.attempt_count
        key, content_type = (upload.storage_key, upload.content_type) if upload else (None, None)

    started = time.monotonic()
    result: ExtractionResult | None = None
    error: ExtractionError | None = None
    try:
        if key is None or content_type is None:
            raise ExtractionError("image_unavailable", "The photo is no longer available.", retryable=False)
        try:
            data = get_storage().get(key)
        except Exception:
            raise ExtractionError("image_unavailable", "The photo is no longer available.", retryable=False) from None
        result = provider.extract(data, content_type, meal_hint=hint)
    except ExtractionError as exc:
        error = exc
    except Exception:
        logger.exception("extraction_unexpected_error", extra={"job_id": str(job_id)})
        error = ExtractionError("internal_error", "Something went wrong while reading the photo.", retryable=True)
    duration_ms = round((time.monotonic() - started) * 1000)

    with session_factory() as db:
        job = db.scalar(select(MenuExtractionJob).where(MenuExtractionJob.id == job_id).with_for_update())
        # Gone (menu deleted) or taken over by another worker after a lease expiry: drop this result.
        if job is None or job.status != "processing" or job.attempt_count != attempt:
            db.rollback()
            return True
        now = datetime.now(timezone.utc)
        job.lease_expires_at = None
        metrics = dict(job.metrics or {})
        metrics["duration_ms"] = duration_ms
        if result is not None:
            added = _apply_result(db, job, result)
            job.status, job.finished_at, job.error_code, job.error_message = "succeeded", now, None, None
            job.result = result.model_dump(mode="json")
            metrics["item_count"] = added
        elif error is not None and error.retryable and attempt < settings.extraction_max_attempts:
            job.status = "queued"
            job.available_at = now + timedelta(seconds=15 * attempt * attempt)
            job.error_code, job.error_message = error.code, error.message
        else:
            assert error is not None
            job.status, job.finished_at = "failed", now
            job.error_code, job.error_message = error.code, error.message
        job.metrics = metrics
        db.commit()
        logger.info("extraction_finished", extra={"job_id": str(job_id), "status": job.status,
                                                  "attempt": attempt, "error_code": job.error_code,
                                                  "duration_ms": duration_ms})
    return True


__all__ = ["create_menu", "list_menus", "detail", "image", "start_extraction", "save_draft", "confirm", "revise",
           "delete_menu", "run_next_job", "get_provider", "ExtractionUnavailableError"]
