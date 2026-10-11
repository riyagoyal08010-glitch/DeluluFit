"""In-process background worker for menu extraction jobs.

Runs in a daemon thread when RUN_INLINE_WORKER is true and a provider is
configured. Jobs are claimed with row locks (SKIP LOCKED) and leases, so a
separate worker process could run the same loop safely.
"""

from __future__ import annotations

import logging
import threading

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services import menu_service
from app.services.extraction import get_provider

logger = logging.getLogger("app.worker")


class BackgroundWorker:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="menu-extraction-worker", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=10)

    def _run(self) -> None:
        provider = get_provider()
        if provider is None:
            return
        interval = get_settings().worker_poll_interval_seconds
        logger.info("extraction_worker_started", extra={"provider": provider.name})
        while not self._stop.is_set():
            try:
                worked = menu_service.run_next_job(SessionLocal, provider)
            except Exception:
                logger.exception("extraction_worker_error")
                worked = False
            if not worked:
                self._stop.wait(interval)
