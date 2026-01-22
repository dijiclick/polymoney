"""Rate limiting utilities."""

import asyncio
from datetime import datetime
from typing import Optional


class RateLimiter:
    """Async rate limiter with sliding window."""

    def __init__(self, calls_per_minute: int = 60):
        self.calls_per_minute = calls_per_minute
        self.min_interval = 60.0 / calls_per_minute
        self._last_call: Optional[datetime] = None
        self._lock = asyncio.Lock()

    async def acquire(self):
        """Acquire a rate limit slot."""
        async with self._lock:
            now = datetime.now()
            if self._last_call is not None:
                elapsed = (now - self._last_call).total_seconds()
                if elapsed < self.min_interval:
                    wait_time = self.min_interval - elapsed
                    await asyncio.sleep(wait_time)
            self._last_call = datetime.now()

    async def __aenter__(self):
        await self.acquire()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass


class BucketRateLimiter:
    """Token bucket rate limiter for burst handling."""

    def __init__(self, rate: float, capacity: int):
        self.rate = rate  # tokens per second
        self.capacity = capacity
        self.tokens = capacity
        self._last_update = datetime.now()
        self._lock = asyncio.Lock()

    async def acquire(self, tokens: int = 1):
        """Acquire tokens from the bucket."""
        async with self._lock:
            now = datetime.now()
            elapsed = (now - self._last_update).total_seconds()

            # Refill tokens
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self._last_update = now

            if self.tokens >= tokens:
                self.tokens -= tokens
                return

            # Wait for tokens to become available
            wait_time = (tokens - self.tokens) / self.rate
            await asyncio.sleep(wait_time)
            self.tokens = 0
