"""Application import, startup, health and readiness endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_application_imports_and_registers_routes() -> None:
    from app.main import app

    paths = set(app.openapi()["paths"])
    assert {"/api/health", "/api/ready", "/api/v1/auth/login", "/api/v1/profile", "/api/v1/budget"} <= paths


def test_startup_and_health(make_client) -> None:  # type: ignore[no-untyped-def]
    # Entering the client context runs the lifespan (startup and shutdown).
    with make_client() as client:
        res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert len(res.headers["X-Request-ID"]) >= 8
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["Cache-Control"] == "no-store"


def test_request_id_is_echoed_when_well_formed(client: TestClient) -> None:
    assert client.get("/api/health", headers={"X-Request-ID": "abc12345-req"}).headers["X-Request-ID"] == \
        "abc12345-req"
    assert client.get("/api/health", headers={"X-Request-ID": "short"}).headers["X-Request-ID"] != "short"


def test_readiness_checks_database_and_storage(client: TestClient) -> None:
    res = client.get("/api/ready")
    assert res.status_code == 200, res.text
    assert res.json() == {"status": "ok", "checks": {"database": "ok", "storage": "ok",
                                                     "extraction": "disabled"}}


def test_unknown_route_uses_error_envelope(client: TestClient) -> None:
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"
