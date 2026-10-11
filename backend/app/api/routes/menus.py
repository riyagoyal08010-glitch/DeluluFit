from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile, status

from app.api.deps import Auth, DbSession
from app.core.config import get_settings
from app.core.errors import AppError, ValidationFailedError
from app.core.rate_limit import limiter
from app.schemas.meals import MealType
from app.schemas.menus import (
    MenuDetailOut,
    MenuDraftIn,
    MenuListOut,
    MenuSuggestionsOut,
)
from app.services import menu_service, suggestion_service

router = APIRouter(prefix="/menus", tags=["menus"])

# Multipart overhead allowed on top of the image size limit.
_FORM_OVERHEAD = 64 * 1024


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "upload_too_large"


@router.post("", response_model=MenuDetailOut, status_code=status.HTTP_201_CREATED)
async def create_menu(request: Request, auth: Auth, db: DbSession,
                      menu_date: Annotated[date, Form()],
                      meal_type: Annotated[MealType | None, Form()] = None,
                      mess_id: Annotated[uuid.UUID | None, Form()] = None,
                      image: Annotated[UploadFile | None, File()] = None) -> MenuDetailOut:
    """Create a menu for a date, from a photo (JPEG, PNG or WebP, up to MAX_UPLOAD_BYTES) or typed in later.

    `mess_id` optionally names one of the student's own messes (which carries the institution and hostel).
    """
    settings = get_settings()
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > settings.max_upload_bytes + _FORM_OVERHEAD:
        raise PayloadTooLargeError(f"The photo is larger than {settings.max_upload_bytes // (1024 * 1024)} MB.")
    raw = None
    if image is not None and (image.filename or image.size):
        limiter.hit(f"menu-upload:{auth.user.id}", settings.upload_rate_limit_per_hour, 3600)
        raw = await image.read(settings.max_upload_bytes + 1)
        await image.close()
        if len(raw) > settings.max_upload_bytes:
            raise PayloadTooLargeError(f"The photo is larger than {settings.max_upload_bytes // (1024 * 1024)} MB.")
        if not raw:
            raise ValidationFailedError("The file is empty.", code="upload_empty")
    return menu_service.create_menu(db, auth.user.id, menu_date=menu_date, meal_type=meal_type, image=raw,
                                    mess_id=mess_id)


@router.get("", response_model=MenuListOut)
def list_menus(auth: Auth, db: DbSession, limit: int = Query(default=20, ge=1, le=50),
               offset: int = Query(default=0, ge=0)) -> MenuListOut:
    return menu_service.list_menus(db, auth.user.id, limit=limit, offset=offset)


@router.get("/{menu_id}", response_model=MenuDetailOut)
def get_menu(menu_id: uuid.UUID, auth: Auth, db: DbSession) -> MenuDetailOut:
    return menu_service.detail(db, auth.user.id, menu_id)


@router.get("/{menu_id}/image")
def get_image(menu_id: uuid.UUID, auth: Auth, db: DbSession) -> Response:
    """The menu photo, only for its owner. Never cached by shared caches; no public URL exists."""
    data, content_type = menu_service.image(db, auth.user.id, menu_id)
    return Response(content=data, media_type=content_type, headers={
        "Cache-Control": "private, no-store", "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin"})


@router.post("/{menu_id}/extraction", response_model=MenuDetailOut, status_code=status.HTTP_202_ACCEPTED)
def start_extraction(menu_id: uuid.UUID, auth: Auth, db: DbSession) -> MenuDetailOut:
    limiter.hit(f"menu-extract:{auth.user.id}", get_settings().upload_rate_limit_per_hour, 3600)
    return menu_service.start_extraction(db, auth.user.id, menu_id)


@router.put("/{menu_id}/draft", response_model=MenuDetailOut)
def save_draft(menu_id: uuid.UUID, body: MenuDraftIn, auth: Auth, db: DbSession) -> MenuDetailOut:
    return menu_service.save_draft(db, auth.user.id, menu_id, body)


@router.post("/{menu_id}/confirm", response_model=MenuDetailOut)
def confirm(menu_id: uuid.UUID, auth: Auth, db: DbSession) -> MenuDetailOut:
    return menu_service.confirm(db, auth.user.id, menu_id)


@router.post("/{menu_id}/revise", response_model=MenuDetailOut)
def revise(menu_id: uuid.UUID, auth: Auth, db: DbSession) -> MenuDetailOut:
    return menu_service.revise(db, auth.user.id, menu_id)


@router.delete("/{menu_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_menu(menu_id: uuid.UUID, auth: Auth, db: DbSession) -> Response:
    menu_service.delete_menu(db, auth.user.id, menu_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{menu_id}/suggestions", response_model=MenuSuggestionsOut)
def suggestions(menu_id: uuid.UUID, auth: Auth, db: DbSession,
                meal_type: MealType | None = None) -> MenuSuggestionsOut:
    return suggestion_service.suggestions(db, auth.user.id, menu_id, meal_type)
