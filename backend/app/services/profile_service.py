"""Student profile, onboarding, preferences, allergies, institutions and targets."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import (Food, FoodAlias, Hostel, Institution, Mess, NutritionTarget, StudentProfile,
                           UserAllergy, UserFoodPreference)
from app.schemas.profile import (AllergyIn, HostelIn, InstitutionIn, MessIn, PreferenceIn, ProfileBundle,
                                 ProfileUpdate, TargetIn)
from app.services.text import clean_display, normalize_label
from app.services.timeutil import local_today

# Self-set energy targets below this level are refused: DeluluFit is not a
# tool for extreme restriction. Professionals may set any value the DB allows.
MIN_SELF_SET_ENERGY_KCAL = 1200


def get_profile(db: Session, user_id: uuid.UUID) -> StudentProfile | None:
    return db.get(StudentProfile, user_id)


def _validate_institution(db: Session, institution_id: uuid.UUID | None, hostel_id: uuid.UUID | None) -> None:
    if institution_id and db.get(Institution, institution_id) is None:
        raise ValidationFailedError("Selected institution was not found.")
    if hostel_id:
        hostel = db.get(Hostel, hostel_id)
        if hostel is None or hostel.institution_id != institution_id:
            raise ValidationFailedError("Selected hostel does not belong to the selected institution.")


def upsert_profile(db: Session, user_id: uuid.UUID, data: ProfileUpdate) -> StudentProfile:
    _validate_institution(db, data.institution_id, data.hostel_id)
    profile = db.get(StudentProfile, user_id)
    values = data.model_dump(exclude={"onboarding_step"})
    if profile is None:
        profile = StudentProfile(user_id=user_id, **values, onboarding_step=data.onboarding_step or 1)
        db.add(profile)
    else:
        for key, value in values.items():
            setattr(profile, key, value)
        if data.onboarding_step is not None and profile.onboarding_completed_at is None:
            profile.onboarding_step = max(profile.onboarding_step, data.onboarding_step)
    db.commit()
    return profile


def complete_onboarding(db: Session, user_id: uuid.UUID) -> StudentProfile:
    profile = db.get(StudentProfile, user_id)
    if profile is None:
        raise ValidationFailedError("Add your name and food preferences before finishing setup.",
                                    code="profile_incomplete")
    if profile.onboarding_completed_at is None:
        profile.onboarding_completed_at = datetime.now(timezone.utc)
    db.commit()
    return profile


def replace_preferences(db: Session, user_id: uuid.UUID, items: list[PreferenceIn]) -> list[UserFoodPreference]:
    seen: dict[str, PreferenceIn] = {}
    for item in items:
        key = normalize_label(item.label)
        if not key:
            raise ValidationFailedError(f"'{item.label}' is not a usable food name.")
        seen[key] = item  # last one wins for duplicates
    alias_map = dict(db.execute(select(FoodAlias.normalized_alias, FoodAlias.food_id)
                                .where(FoodAlias.normalized_alias.in_(list(seen)))).all())
    name_map = dict(db.execute(select(Food.normalized_name, Food.id)
                               .where(Food.normalized_name.in_(list(seen)))).all())
    db.execute(delete(UserFoodPreference).where(UserFoodPreference.user_id == user_id))
    rows = [UserFoodPreference(user_id=user_id, label=clean_display(i.label, 80), normalized_label=k,
                               preference=i.preference, food_id=name_map.get(k) or alias_map.get(k))
            for k, i in seen.items()]
    db.add_all(rows)
    db.commit()
    return rows


def replace_allergies(db: Session, user_id: uuid.UUID, items: list[AllergyIn]) -> list[UserAllergy]:
    unique: dict[tuple[str, str], AllergyIn] = {}
    for item in items:
        unique[(item.allergen, (item.custom_label or "").strip().lower())] = item
    db.execute(delete(UserAllergy).where(UserAllergy.user_id == user_id))
    rows = [UserAllergy(user_id=user_id, allergen=i.allergen,
                        custom_label=clean_display(i.custom_label, 80) if i.custom_label else None,
                        severity=i.severity, notes=i.notes) for i in unique.values()]
    db.add_all(rows)
    db.commit()
    return rows


def list_preferences(db: Session, user_id: uuid.UUID) -> list[UserFoodPreference]:
    return list(db.scalars(select(UserFoodPreference).where(UserFoodPreference.user_id == user_id)
                           .order_by(UserFoodPreference.label)))


def list_allergies(db: Session, user_id: uuid.UUID) -> list[UserAllergy]:
    return list(db.scalars(select(UserAllergy).where(UserAllergy.user_id == user_id)
                           .order_by(UserAllergy.allergen)))


def bundle(db: Session, user_id: uuid.UUID) -> ProfileBundle:
    from app.schemas.profile import (AllergyOut, HostelOut, InstitutionOut, PreferenceOut, ProfileOut,
                                     TargetOut)

    profile = get_profile(db, user_id)
    institution = db.get(Institution, profile.institution_id) if profile and profile.institution_id else None
    hostel = db.get(Hostel, profile.hostel_id) if profile and profile.hostel_id else None
    target = active_target(db, user_id)
    return ProfileBundle(
        profile=ProfileOut.model_validate(profile) if profile else None,
        preferences=[PreferenceOut.model_validate(p) for p in list_preferences(db, user_id)],
        allergies=[AllergyOut.model_validate(a) for a in list_allergies(db, user_id)],
        institution=InstitutionOut.model_validate(institution) if institution else None,
        hostel=HostelOut.model_validate(hostel) if hostel else None,
        active_target=TargetOut.model_validate(target) if target else None,
    )


# --- institutions -----------------------------------------------------------------------------

def search_institutions(db: Session, query: str, limit: int = 20) -> list[Institution]:
    stmt = select(Institution).order_by(Institution.name).limit(limit)
    q = normalize_label(query)
    if q:
        stmt = stmt.where(Institution.normalized_name.contains(q, autoescape=True))
    return list(db.scalars(stmt))


def create_institution(db: Session, user_id: uuid.UUID, data: InstitutionIn) -> Institution:
    normalized = normalize_label(data.name)
    if len(normalized) < 2:
        raise ValidationFailedError("Enter the institution's name.")
    existing = db.scalar(select(Institution).where(Institution.normalized_name == normalized))
    if existing:
        return existing
    inst = Institution(name=clean_display(data.name, 160), normalized_name=normalized, city=data.city,
                       state=data.state, created_by_user_id=user_id)
    db.add(inst)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        found = db.scalar(select(Institution).where(Institution.normalized_name == normalized))
        if found is None:
            raise
        return found
    return inst


def list_hostels(db: Session, institution_id: uuid.UUID) -> list[Hostel]:
    if db.get(Institution, institution_id) is None:
        raise NotFoundError("Institution not found.")
    return list(db.scalars(select(Hostel).where(Hostel.institution_id == institution_id).order_by(Hostel.name)))


def create_hostel(db: Session, user_id: uuid.UUID, institution_id: uuid.UUID, data: HostelIn) -> Hostel:
    if db.get(Institution, institution_id) is None:
        raise NotFoundError("Institution not found.")
    normalized = normalize_label(data.name) or data.name.strip().lower()
    existing = db.scalar(select(Hostel).where(Hostel.institution_id == institution_id,
                                              Hostel.normalized_name == normalized))
    if existing:
        return existing
    hostel = Hostel(institution_id=institution_id, name=clean_display(data.name, 120), normalized_name=normalized,
                    created_by_user_id=user_id)
    db.add(hostel)
    db.commit()
    return hostel


def list_messes(db: Session, user_id: uuid.UUID) -> list[Mess]:
    return list(db.scalars(select(Mess).where(Mess.user_id == user_id).order_by(Mess.name)))


def create_mess(db: Session, user_id: uuid.UUID, data: MessIn) -> Mess:
    _validate_institution(db, data.institution_id, data.hostel_id)
    mess = Mess(user_id=user_id, name=clean_display(data.name, 120), institution_id=data.institution_id,
                hostel_id=data.hostel_id)
    db.add(mess)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("You already have a mess with this name.") from exc
    return mess


# --- nutrition targets -----------------------------------------------------------------------

def active_target(db: Session, user_id: uuid.UUID) -> NutritionTarget | None:
    return db.scalar(select(NutritionTarget).where(NutritionTarget.user_id == user_id,
                                                   NutritionTarget.effective_to.is_(None)))


def target_history(db: Session, user_id: uuid.UUID) -> list[NutritionTarget]:
    return list(db.scalars(select(NutritionTarget).where(NutritionTarget.user_id == user_id)
                           .order_by(NutritionTarget.effective_from.desc(), NutritionTarget.created_at.desc())
                           .limit(50)))


def set_target(db: Session, user_id: uuid.UUID, data: TargetIn) -> NutritionTarget:
    if data.source == "reference_estimate":
        # Reserved for targets the app calculates from cited general references. That
        # calculation does not exist yet, so a client may not label its own numbers this way.
        raise ValidationFailedError("Reference estimates are not available yet. Choose 'self_set' for a target "
                                    "you chose, or 'professional' for one given to you.", code="unsupported_source")
    if (data.source == "self_set" and data.energy_kcal is not None
            and data.energy_kcal < MIN_SELF_SET_ENERGY_KCAL):
        raise ValidationFailedError(
            f"Self-set energy targets below {MIN_SELF_SET_ENERGY_KCAL} kcal are not supported. If a qualified "
            "professional gave you this target, choose that source instead.", code="unsafe_target")
    today = local_today(db, user_id)
    start = data.effective_from or today
    current = active_target(db, user_id)
    if current is not None:
        if start < current.effective_from:
            raise ValidationFailedError("A new target cannot start before your current target started.")
        if start == current.effective_from:
            db.delete(current)  # replacing a target set on the same day
            db.flush()
        else:
            current.effective_to = start - timedelta(days=1)
    target = NutritionTarget(user_id=user_id, **data.model_dump(exclude={"effective_from"}), effective_from=start)
    db.add(target)
    db.commit()
    return target


def end_target(db: Session, user_id: uuid.UUID) -> None:
    current = active_target(db, user_id)
    if current is None:
        raise NotFoundError("No active target.")
    today = local_today(db, user_id)
    if current.effective_from >= today:
        db.delete(current)
    else:
        current.effective_to = today - timedelta(days=1)
    db.commit()


def target_for_date(db: Session, user_id: uuid.UUID, day: date) -> NutritionTarget | None:
    return db.scalar(select(NutritionTarget).where(
        NutritionTarget.user_id == user_id, NutritionTarget.effective_from <= day,
        (NutritionTarget.effective_to.is_(None)) | (NutritionTarget.effective_to >= day)))
