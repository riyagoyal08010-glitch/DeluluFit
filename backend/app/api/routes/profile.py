from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response, status

from app.api.deps import Auth, DbSession
from app.schemas.profile import (AllergiesReplace, AllergyOut, HostelIn, HostelOut, InstitutionIn,
                                 InstitutionOut, MessIn, MessOut, PreferenceOut, PreferencesReplace,
                                 ProfileBundle, ProfileOut, ProfileUpdate, TargetIn, TargetOut)
from app.services import profile_service

router = APIRouter(tags=["profile"])


@router.get("/profile", response_model=ProfileBundle)
def get_profile(auth: Auth, db: DbSession) -> ProfileBundle:
    return profile_service.bundle(db, auth.user.id)


@router.put("/profile", response_model=ProfileOut)
def put_profile(body: ProfileUpdate, auth: Auth, db: DbSession) -> ProfileOut:
    return ProfileOut.model_validate(profile_service.upsert_profile(db, auth.user.id, body))


@router.post("/profile/complete-onboarding", response_model=ProfileOut)
def complete_onboarding(auth: Auth, db: DbSession) -> ProfileOut:
    return ProfileOut.model_validate(profile_service.complete_onboarding(db, auth.user.id))


@router.put("/profile/preferences", response_model=list[PreferenceOut])
def put_preferences(body: PreferencesReplace, auth: Auth, db: DbSession) -> list[PreferenceOut]:
    rows = profile_service.replace_preferences(db, auth.user.id, body.items)
    return [PreferenceOut.model_validate(r) for r in rows]


@router.put("/profile/allergies", response_model=list[AllergyOut])
def put_allergies(body: AllergiesReplace, auth: Auth, db: DbSession) -> list[AllergyOut]:
    rows = profile_service.replace_allergies(db, auth.user.id, body.items)
    return [AllergyOut.model_validate(r) for r in rows]


@router.get("/institutions", response_model=list[InstitutionOut])
def search_institutions(auth: Auth, db: DbSession, q: str = Query(default="", max_length=80)) -> list[InstitutionOut]:
    return [InstitutionOut.model_validate(i) for i in profile_service.search_institutions(db, q)]


@router.post("/institutions", response_model=InstitutionOut, status_code=status.HTTP_201_CREATED)
def create_institution(body: InstitutionIn, auth: Auth, db: DbSession) -> InstitutionOut:
    return InstitutionOut.model_validate(profile_service.create_institution(db, auth.user.id, body))


@router.get("/institutions/{institution_id}/hostels", response_model=list[HostelOut])
def list_hostels(institution_id: uuid.UUID, auth: Auth, db: DbSession) -> list[HostelOut]:
    return [HostelOut.model_validate(h) for h in profile_service.list_hostels(db, institution_id)]


@router.post("/institutions/{institution_id}/hostels", response_model=HostelOut, status_code=status.HTTP_201_CREATED)
def create_hostel(institution_id: uuid.UUID, body: HostelIn, auth: Auth, db: DbSession) -> HostelOut:
    return HostelOut.model_validate(profile_service.create_hostel(db, auth.user.id, institution_id, body))


@router.get("/messes", response_model=list[MessOut])
def list_messes(auth: Auth, db: DbSession) -> list[MessOut]:
    return [MessOut.model_validate(m) for m in profile_service.list_messes(db, auth.user.id)]


@router.post("/messes", response_model=MessOut, status_code=status.HTTP_201_CREATED)
def create_mess(body: MessIn, auth: Auth, db: DbSession) -> MessOut:
    return MessOut.model_validate(profile_service.create_mess(db, auth.user.id, body))


@router.get("/targets", response_model=list[TargetOut])
def list_targets(auth: Auth, db: DbSession) -> list[TargetOut]:
    return [TargetOut.model_validate(t) for t in profile_service.target_history(db, auth.user.id)]


@router.put("/targets/active", response_model=TargetOut)
def set_target(body: TargetIn, auth: Auth, db: DbSession) -> TargetOut:
    return TargetOut.model_validate(profile_service.set_target(db, auth.user.id, body))


@router.delete("/targets/active", status_code=status.HTTP_204_NO_CONTENT)
def end_target(auth: Auth, db: DbSession) -> Response:
    profile_service.end_target(db, auth.user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
