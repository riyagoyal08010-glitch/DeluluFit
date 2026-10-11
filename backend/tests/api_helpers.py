"""Helpers for API tests: sign a client up and send CSRF-protected requests."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"
CSRF_HEADER = "X-CSRF-Token"


class ApiUser:
    """A signed-in test client plus the CSRF token its session was issued."""

    def __init__(self, client: TestClient, email: str, csrf: str, user_id: str) -> None:
        self.client = client
        self.email = email
        self.csrf = csrf
        self.id = user_id

    def _headers(self) -> dict[str, str]:
        return {CSRF_HEADER: self.csrf}

    def get(self, url: str, **kw: Any) -> Any:
        return self.client.get(url, **kw)

    def post(self, url: str, json: Any = None, **kw: Any) -> Any:
        return self.client.post(url, json=json, headers=self._headers(), **kw)

    def put(self, url: str, json: Any = None, **kw: Any) -> Any:
        return self.client.put(url, json=json, headers=self._headers(), **kw)

    def patch(self, url: str, json: Any = None, **kw: Any) -> Any:
        return self.client.patch(url, json=json, headers=self._headers(), **kw)

    def delete(self, url: str, **kw: Any) -> Any:
        return self.client.delete(url, headers=self._headers(), **kw)


def register(client: TestClient, email: str | None = None, *, display_name: str | None = "Test Student",
             password: str = PASSWORD) -> ApiUser:
    email = email or f"student-{uuid.uuid4().hex[:8]}@example.test"
    res = client.post("/api/v1/auth/register", json={"email": email, "password": password,
                                                     "display_name": display_name})
    assert res.status_code == 201, res.text
    body = res.json()
    return ApiUser(client, email, body["csrf_token"], body["user"]["id"])


def onboard(user: ApiUser, **profile: Any) -> None:
    body = {"display_name": "Test Student", **profile}
    assert user.put("/api/v1/profile", json=body).status_code == 200
    assert user.post("/api/v1/profile/complete-onboarding").status_code == 200


def error_code(res: Any) -> str:
    return str(res.json()["error"]["code"])
