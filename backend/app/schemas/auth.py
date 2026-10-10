from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

_EMAIL_MAX = 254


def _normalize_email(value: str) -> str:
    value = value.strip().lower()
    local, sep, domain = value.partition("@")
    if not sep or not local or "." not in domain or " " in value or len(value) > _EMAIL_MAX:
        raise ValueError("Enter a valid email address.")
    return value


class RegisterRequest(BaseModel):
    email: str = Field(max_length=_EMAIL_MAX)
    password: str = Field(min_length=10, max_length=128)
    display_name: str | None = Field(default=None, max_length=80)

    _email = field_validator("email")(_normalize_email)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, value: str) -> str:
        if value.strip() != value or len(set(value)) < 4:
            raise ValueError("Choose a less predictable password without leading or trailing spaces.")
        return value


class LoginRequest(BaseModel):
    email: str = Field(max_length=_EMAIL_MAX)
    password: str = Field(min_length=1, max_length=128)

    _email = field_validator("email")(_normalize_email)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    confirmation: str = Field(description='Must be the exact text "DELETE".')


class SessionUser(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    created_at: datetime
    has_profile: bool
    onboarding_completed: bool


class SessionResponse(BaseModel):
    user: SessionUser
    csrf_token: str
