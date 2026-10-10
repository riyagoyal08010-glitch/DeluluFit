"""Registration, sign-in, server-side sessions and account deletion."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AuthenticationError, ConflictError, ValidationFailedError
from app.core.security import hash_password, hash_token, needs_rehash, new_token, verify_password
from app.db.models import MenuUpload, StudentProfile, User, UserSession
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

_LAST_SEEN_GRANULARITY = timedelta(minutes=5)


@dataclass(frozen=True)
class IssuedSession:
    token: str
    csrf_token: str
    expires_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def register(db: Session, *, email: str, password: str, display_name: str | None) -> User:
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise ConflictError("An account with this email already exists. Try signing in.", code="email_taken")
    user = User(email=email, password_hash=hash_password(password))
    db.add(user)
    try:
        db.flush()
        if display_name and display_name.strip():
            db.add(StudentProfile(user_id=user.id, display_name=display_name.strip(), onboarding_step=1))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("An account with this email already exists. Try signing in.",
                            code="email_taken") from exc
    logger.info("user_registered", extra={"user_id": str(user.id)})
    return user


def authenticate(db: Session, *, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    # verify_password runs a full hash even for unknown emails (timing equalization).
    if not verify_password(user.password_hash if user else None, password) or user is None:
        raise AuthenticationError("Email or password is incorrect.", code="invalid_credentials")
    if not user.is_active:
        raise AuthenticationError("This account is disabled.", code="account_disabled")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = _now()
    db.commit()
    return user


def create_session(db: Session, user: User) -> IssuedSession:
    settings = get_settings()
    token, csrf = new_token(), new_token()
    expires = _now() + timedelta(hours=settings.session_ttl_hours)
    db.add(UserSession(user_id=user.id, token_hash=hash_token(token), csrf_token=csrf, expires_at=expires))
    db.commit()
    return IssuedSession(token=token, csrf_token=csrf, expires_at=expires)


def resolve_session(db: Session, token: str) -> tuple[UserSession, User] | None:
    row = db.execute(
        select(UserSession, User).join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == hash_token(token))
    ).first()
    if row is None:
        return None
    session, user = row
    now = _now()
    if session.revoked_at is not None or session.expires_at <= now or not user.is_active:
        return None
    if now - session.last_seen_at > _LAST_SEEN_GRANULARITY:
        session.last_seen_at = now
        db.commit()
    return session, user


def revoke_session(db: Session, session_id: uuid.UUID) -> None:
    db.execute(update(UserSession).where(UserSession.id == session_id, UserSession.revoked_at.is_(None))
               .values(revoked_at=_now()))
    db.commit()


def change_password(db: Session, user: User, *, current_password: str, new_password: str,
                    keep_session_id: uuid.UUID) -> None:
    if not verify_password(user.password_hash, current_password):
        raise AuthenticationError("Current password is incorrect.", code="invalid_credentials")
    if current_password == new_password:
        raise ValidationFailedError("Choose a password you have not just used.")
    user.password_hash = hash_password(new_password)
    # Sign out every other device.
    db.execute(update(UserSession).where(UserSession.user_id == user.id, UserSession.id != keep_session_id,
                                         UserSession.revoked_at.is_(None)).values(revoked_at=_now()))
    db.commit()


def delete_account(db: Session, user: User, *, password: str) -> None:
    """Permanently delete the user and all private data (rows cascade in one transaction).

    Stored upload binaries are removed after the database commit; a failure
    there is logged for operator cleanup but does not resurrect the account.
    """
    if not verify_password(user.password_hash, password):
        raise AuthenticationError("Password is incorrect.", code="invalid_credentials")
    keys = list(db.scalars(select(MenuUpload.storage_key).where(MenuUpload.user_id == user.id)))
    user_id = user.id
    db.delete(user)
    db.commit()
    storage = get_storage()
    for key in keys:
        try:
            storage.delete(key)
        except Exception:  # noqa: BLE001 - best effort, reported for cleanup
            logger.exception("upload_delete_failed", extra={"user_id": str(user_id)})
    logger.info("account_deleted", extra={"user_id": str(user_id), "uploads_removed": len(keys)})
