"""Timezone helpers: calendar dates are always interpreted in the student's timezone."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import StudentProfile

DEFAULT_TZ = "Asia/Kolkata"


def user_tz(db: Session, user_id: uuid.UUID) -> ZoneInfo:
    name = db.scalar(select(StudentProfile.timezone).where(StudentProfile.user_id == user_id))
    return ZoneInfo(name or DEFAULT_TZ)


def local_today(db: Session, user_id: uuid.UUID) -> date:
    return datetime.now(timezone.utc).astimezone(user_tz(db, user_id)).date()


def local_date_of(instant: datetime, tz: ZoneInfo) -> date:
    if instant.tzinfo is None:
        raise ValueError("timestamps must be timezone-aware")
    return instant.astimezone(tz).date()
