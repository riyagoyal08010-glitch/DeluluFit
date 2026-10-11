"""Registration, login, logout, sessions, CSRF and account deletion through the HTTP API."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.security import hash_token
from app.db import models as m
from tests.api_helpers import CSRF_HEADER, PASSWORD, error_code, register


def test_register_sets_session_and_csrf_cookies(client: TestClient, db: Session) -> None:
    res = client.post("/api/v1/auth/register", json={"email": "  New.Student@Example.TEST ",
                                                     "password": PASSWORD, "display_name": "Asha"})
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "new.student@example.test"
    assert body["user"]["has_profile"] is True
    assert body["user"]["onboarding_completed"] is False
    cookies = res.headers.get_list("set-cookie")
    session_cookie = next(c for c in cookies if c.startswith("delulufit_session="))
    csrf_cookie = next(c for c in cookies if c.startswith("delulufit_csrf="))
    assert "HttpOnly" in session_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "samesite=lax" in session_cookie.lower()
    # The CSRF token in the body is the one the server stored for the session.
    session = db.scalar(select(m.UserSession))
    assert session is not None and session.csrf_token == body["csrf_token"]


def test_password_is_hashed_with_argon2id(client: TestClient, db: Session) -> None:
    user = register(client)
    row = db.scalar(select(m.User).where(m.User.email == user.email))
    assert row is not None
    assert row.password_hash.startswith("$argon2id$")
    assert PASSWORD not in row.password_hash


def test_session_token_is_stored_only_as_a_hash(client: TestClient, db: Session) -> None:
    register(client)
    token = client.cookies.get("delulufit_session")
    assert token
    session = db.scalar(select(m.UserSession))
    assert session is not None
    assert session.token_hash == hash_token(token)
    assert session.token_hash != token


def test_duplicate_email_is_rejected_case_insensitively(client: TestClient,
                                                        make_client: Callable[[], TestClient]) -> None:
    register(client, "dup@example.test")
    res = make_client().post("/api/v1/auth/register", json={"email": "DUP@example.test", "password": PASSWORD})
    assert res.status_code == 409
    assert error_code(res) == "email_taken"


def test_weak_or_invalid_registration_input_is_rejected(client: TestClient) -> None:
    for body in ({"email": "a@example.test", "password": "short"},
                 {"email": "a@example.test", "password": "aaaaaaaaaaaa"},
                 {"email": "a@example.test", "password": " leading-space-pass"},
                 {"email": "not-an-email", "password": PASSWORD}):
        res = client.post("/api/v1/auth/register", json=body)
        assert res.status_code == 422, body
        assert error_code(res) == "validation_failed"


def test_login_success_and_uniform_failure(client: TestClient, make_client: Callable[[], TestClient]) -> None:
    user = register(client, "login@example.test")
    fresh = make_client()
    wrong = fresh.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong password!"})
    unknown = fresh.post("/api/v1/auth/login", json={"email": "nobody@example.test", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    # Same message either way, so the API does not reveal which emails are registered.
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]
    assert error_code(wrong) == error_code(unknown) == "invalid_credentials"
    ok = fresh.post("/api/v1/auth/login", json={"email": "LOGIN@example.test", "password": PASSWORD})
    assert ok.status_code == 200
    assert fresh.get("/api/v1/auth/session").json()["user"]["email"] == user.email


def test_unauthenticated_requests_are_rejected(client: TestClient) -> None:
    res = client.get("/api/v1/profile")
    assert res.status_code == 401
    assert error_code(res) == "not_authenticated"
    client.cookies.set("delulufit_session", "forged-token-value")
    res = client.get("/api/v1/profile")
    assert res.status_code == 401
    assert error_code(res) == "session_expired"


def test_csrf_header_is_required_for_unsafe_methods(client: TestClient) -> None:
    user = register(client)
    body = {"display_name": "Asha"}
    missing = client.put("/api/v1/profile", json=body)
    wrong = client.put("/api/v1/profile", json=body, headers={CSRF_HEADER: "not-the-token"})
    assert missing.status_code == wrong.status_code == 403
    assert error_code(missing) == error_code(wrong) == "csrf_failed"
    # Safe methods need no token; the correct token is accepted.
    assert client.get("/api/v1/profile").status_code == 200
    assert user.put("/api/v1/profile", json=body).status_code == 200


def test_csrf_token_from_another_session_is_rejected(client: TestClient,
                                                     make_client: Callable[[], TestClient]) -> None:
    register(client)
    other = register(make_client())
    res = client.put("/api/v1/profile", json={"display_name": "X"}, headers={CSRF_HEADER: other.csrf})
    assert res.status_code == 403


def test_logout_revokes_the_session(client: TestClient, db: Session) -> None:
    user = register(client)
    token = client.cookies.get("delulufit_session")
    assert client.post("/api/v1/auth/logout").status_code == 403  # CSRF applies to logout too
    res = user.post("/api/v1/auth/logout")
    assert res.status_code == 204
    session = db.scalar(select(m.UserSession))
    assert session is not None and session.revoked_at is not None
    # Replaying the old cookie after logout does not work.
    client.cookies.set("delulufit_session", token)
    assert client.get("/api/v1/auth/session").status_code == 401


def test_expired_session_is_rejected(client: TestClient, db: Session) -> None:
    register(client)
    past = datetime.now(timezone.utc) - timedelta(days=30)
    db.execute(update(m.UserSession).values(created_at=past, expires_at=past + timedelta(hours=1)))
    db.commit()
    res = client.get("/api/v1/auth/session")
    assert res.status_code == 401
    assert error_code(res) == "session_expired"


def test_session_expiry_uses_configured_ttl(client: TestClient, db: Session) -> None:
    register(client)
    session = db.scalar(select(m.UserSession))
    assert session is not None
    ttl = session.expires_at - session.created_at
    assert timedelta(days=14) - timedelta(minutes=1) < ttl <= timedelta(days=14) + timedelta(minutes=1)


def test_disabled_account_cannot_sign_in_or_use_sessions(client: TestClient, db: Session,
                                                         make_client: Callable[[], TestClient]) -> None:
    user = register(client)
    db.execute(update(m.User).values(is_active=False))
    db.commit()
    assert client.get("/api/v1/auth/session").status_code == 401
    res = make_client().post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 401
    assert error_code(res) == "account_disabled"


def test_change_password_signs_out_other_sessions(client: TestClient,
                                                  make_client: Callable[[], TestClient]) -> None:
    user = register(client)
    other_device = make_client()
    assert other_device.post("/api/v1/auth/login", json={"email": user.email,
                                                         "password": PASSWORD}).status_code == 200
    new_password = "a different long passphrase"
    wrong = user.post("/api/v1/auth/change-password", json={"current_password": "nope nope nope",
                                                            "new_password": new_password})
    assert wrong.status_code == 401
    res = user.post("/api/v1/auth/change-password", json={"current_password": PASSWORD,
                                                          "new_password": new_password})
    assert res.status_code == 204
    assert client.get("/api/v1/auth/session").status_code == 200
    assert other_device.get("/api/v1/auth/session").status_code == 401
    fresh = make_client()
    assert fresh.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD}).status_code == 401
    assert fresh.post("/api/v1/auth/login", json={"email": user.email,
                                                  "password": new_password}).status_code == 200


def test_change_password_applies_registration_strength_rules(client: TestClient) -> None:
    user = register(client)
    res = user.post("/api/v1/auth/change-password", json={"current_password": PASSWORD,
                                                          "new_password": "aaaaaaaaaaaa"})
    assert res.status_code == 422


def test_delete_account_requires_confirmation_and_password(client: TestClient, db: Session) -> None:
    user = register(client)
    assert user.post("/api/v1/auth/delete-account", json={"password": PASSWORD,
                                                          "confirmation": "delete"}).status_code == 422
    assert user.post("/api/v1/auth/delete-account", json={"password": "wrong password!",
                                                          "confirmation": "DELETE"}).status_code == 401
    res = user.post("/api/v1/auth/delete-account", json={"password": PASSWORD, "confirmation": "DELETE"})
    assert res.status_code == 204
    assert db.scalar(select(func.count()).select_from(m.User)) == 0
    assert db.scalar(select(func.count()).select_from(m.UserSession)) == 0
    assert client.get("/api/v1/auth/session").status_code == 401


def test_login_is_rate_limited(client: TestClient) -> None:
    statuses = [client.post("/api/v1/auth/login", json={"email": "rl@example.test",
                                                        "password": "wrong password!"}).status_code
                for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
