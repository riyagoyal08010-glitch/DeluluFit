from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import Auth, DbSession
from app.core.config import get_settings
from app.core.errors import ValidationFailedError
from app.core.rate_limit import limiter
from app.db.models import StudentProfile, User
from app.schemas.auth import (ChangePasswordRequest, DeleteAccountRequest, LoginRequest, RegisterRequest,
                              SessionResponse, SessionUser)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_cookies(response: Response, issued: auth_service.IssuedSession) -> None:
    s = get_settings()
    max_age = s.session_ttl_hours * 3600
    common = dict(max_age=max_age, secure=s.cookie_secure, samesite=s.cookie_samesite, domain=s.cookie_domain,
                  path="/")
    response.set_cookie(s.session_cookie_name, issued.token, httponly=True, **common)  # type: ignore[arg-type]
    # Readable by same-site JS; cross-site frontends use the csrf_token in the response body.
    response.set_cookie(s.csrf_cookie_name, issued.csrf_token, httponly=False, **common)  # type: ignore[arg-type]


def _clear_cookies(response: Response) -> None:
    s = get_settings()
    for name in (s.session_cookie_name, s.csrf_cookie_name):
        response.delete_cookie(name, path="/", domain=s.cookie_domain, secure=s.cookie_secure,
                               samesite=s.cookie_samesite)


def _session_response(db: DbSession, user: User, csrf_token: str) -> SessionResponse:
    profile = db.get(StudentProfile, user.id)
    return SessionResponse(
        user=SessionUser(id=user.id, email=user.email, role=user.role, created_at=user.created_at,
                         has_profile=profile is not None,
                         onboarding_completed=bool(profile and profile.onboarding_completed_at)),
        csrf_token=csrf_token,
    )


@router.post("/register", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, request: Request, response: Response, db: DbSession) -> SessionResponse:
    limiter.hit(f"register:{_client_key(request)}", get_settings().auth_rate_limit_per_minute, 60)
    user = auth_service.register(db, email=body.email, password=body.password, display_name=body.display_name)
    issued = auth_service.create_session(db, user)
    _set_cookies(response, issued)
    return _session_response(db, user, issued.csrf_token)


@router.post("/login", response_model=SessionResponse)
def login(body: LoginRequest, request: Request, response: Response, db: DbSession) -> SessionResponse:
    limit = get_settings().auth_rate_limit_per_minute
    limiter.hit(f"login-ip:{_client_key(request)}", limit, 60)
    limiter.hit(f"login-email:{body.email}", limit, 60)
    user = auth_service.authenticate(db, email=body.email, password=body.password)
    issued = auth_service.create_session(db, user)
    _set_cookies(response, issued)
    return _session_response(db, user, issued.csrf_token)


@router.get("/session", response_model=SessionResponse)
def current_session(auth: Auth, db: DbSession) -> SessionResponse:
    return _session_response(db, auth.user, auth.session.csrf_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(auth: Auth, response: Response, db: DbSession) -> Response:
    auth_service.revoke_session(db, auth.session.id)
    _clear_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: ChangePasswordRequest, auth: Auth, db: DbSession) -> Response:
    limiter.hit(f"change-password:{auth.user.id}", get_settings().auth_rate_limit_per_minute, 60)
    auth_service.change_password(db, auth.user, current_password=body.current_password,
                                 new_password=body.new_password, keep_session_id=auth.session.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: DeleteAccountRequest, auth: Auth, response: Response, db: DbSession) -> Response:
    if body.confirmation != "DELETE":
        raise ValidationFailedError('Type DELETE to confirm account deletion.')
    limiter.hit(f"delete-account:{auth.user.id}", 5, 60)
    auth_service.delete_account(db, auth.user, password=body.password)
    _clear_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
