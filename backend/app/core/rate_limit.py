"""Small in-process sliding-window rate limiter.

Suitable for a single API instance. When running multiple instances, put a
shared limiter (e.g. at the reverse proxy) in front; see docs/SECURITY.md.
"""

from __future__ import annotations

import threading
import time
from collections import deque

from app.core.errors import RateLimitedError


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float) -> None:
        now = time.monotonic()
        with self._lock:
            events = self._events.setdefault(key, deque())
            while events and now - events[0] > window_seconds:
                events.popleft()
            if len(events) >= limit:
                retry_after = int(window_seconds - (now - events[0])) + 1
                raise RateLimitedError(
                    "Too many attempts. Please wait a moment and try again.",
                    details={"retry_after_seconds": retry_after},
                )
            events.append(now)

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


limiter = SlidingWindowLimiter()
