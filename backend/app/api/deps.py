"""Request dependencies: database session, authenticated user, CSRF, onboarding gate."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.security import constant_time_equals
from app.db.models import StudentProfile, User, UserSession
from app.db.session import get_db
from app.services import auth_service

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

DbSession = Annotated[Session, Depends(get_db)]


@dataclass
class AuthContext:
    user: User
    session: UserSession

    @property
    def user_id(self):  # type: ignore[no-untyped-def]
        return self.user.id


def get_auth(request: Request, db: DbSession) -> AuthContext:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise AuthenticationError("Please sign in to continue.")
    resolved = auth_service.resolve_session(db, token)
    if resolved is None:
        raise AuthenticationError("Your session has expired. Please sign in again.", code="session_expired")
    session, user = resolved
    if request.method not in SAFE_METHODS:
        header = request.headers.get(settings.csrf_header_name, "")
        if not header or not constant_time_equals(header, session.csrf_token):
            raise PermissionDeniedError("Security check failed. Refresh the page and try again.",
                                        code="csrf_failed")
    return AuthContext(user=user, session=session)


Auth = Annotated[AuthContext, Depends(get_auth)]


def get_onboarded_auth(auth: Auth, db: DbSession) -> AuthContext:
    profile = db.get(StudentProfile, auth.user.id)
    if profile is None or profile.onboarding_completed_at is None:
        raise PermissionDeniedError("Finish setting up your profile first.", code="onboarding_required")
    return auth


OnboardedAuth = Annotated[AuthContext, Depends(get_onboarded_auth)]


def get_admin_auth(auth: Auth) -> AuthContext:
    if auth.user.role != "admin":
        raise PermissionDeniedError("Administrator access required.")
    return auth


AdminAuth = Annotated[AuthContext, Depends(get_admin_auth)]
