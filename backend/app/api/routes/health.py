from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import engine
from app.services.storage import get_storage

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness: the process is up. Does not touch dependencies."""
    return {"status": "ok"}


@router.get("/ready")
def ready() -> JSONResponse:
    """Readiness: database reachable and migrated, storage writable."""
    checks: dict[str, str] = {}
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        checks["database"] = "ok" if version else "not_migrated"
    except Exception:  # noqa: BLE001
        checks["database"] = "unavailable"
    try:
        get_storage().check()
        checks["storage"] = "ok"
    except Exception:  # noqa: BLE001
        checks["storage"] = "unavailable"
    checks["extraction"] = "enabled" if get_settings().extraction_enabled else "disabled"
    healthy = checks["database"] == "ok" and checks["storage"] == "ok"
    return JSONResponse({"status": "ok" if healthy else "degraded", "checks": checks},
                        status_code=200 if healthy else 503)
