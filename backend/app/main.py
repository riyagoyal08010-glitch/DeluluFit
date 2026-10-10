"""FastAPI application factory."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (auth, budget, foods, health, meals, menus, nutrition, profile,
                            recommendations, uploads)
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, request_id_var

logger = logging.getLogger("app.request")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    worker = None
    if settings.run_inline_worker:
        from app.workers.extraction_worker import BackgroundWorker

        worker = BackgroundWorker()
        worker.start()
    yield
    if worker is not None:
        worker.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    is_prod = settings.environment == "production"
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None if is_prod else "/api/docs",
        redoc_url=None,
        openapi_url=None if is_prod else "/api/openapi.json",
    )
    register_error_handlers(app)

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming if 8 <= len(incoming) <= 64 and incoming.isascii() else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers["X-Request-ID"] = request_id
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Cache-Control", "no-store")
        # Path only (no query string) so identifiers in queries are not logged.
        logger.info("request", extra={"request_id": request_id, "method": request.method,
                                      "path": request.url.path, "status": response.status_code,
                                      "duration_ms": duration_ms})
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", settings.csrf_header_name, "X-Request-ID", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )

    app.include_router(health.router, prefix="/api")
    for module in (auth, profile, uploads, menus, foods, meals, nutrition, budget, recommendations):
        app.include_router(module.router, prefix="/api/v1")
    return app


app = create_app()
