"""General utility functions."""

import asyncio
from typing import Any, AsyncGenerator, Callable, Iterable, TypeVar

T = TypeVar("T")


def chunks(iterable: Iterable[T], size: int) -> Iterable[list[T]]:
    """Split an iterable into chunks of a given size."""
    chunk = []
    for item in iterable:
        chunk.append(item)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def flatten(nested: Iterable[Iterable[T]]) -> list[T]:
    """Flatten a nested iterable."""
    return [item for sublist in nested for item in sublist]


async def retry_async(
    func: Callable,
    *args,
    max_retries: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    **kwargs
) -> Any:
    """Retry an async function with exponential backoff."""
    last_exception = None
    current_delay = delay

    for attempt in range(max_retries):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            last_exception = e
            if attempt < max_retries - 1:
                await asyncio.sleep(current_delay)
                current_delay *= backoff

    raise last_exception


async def run_with_concurrency(
    tasks: list,
    concurrency: int = 10
) -> list[Any]:
    """Run tasks with a concurrency limit."""
    semaphore = asyncio.Semaphore(concurrency)

    async def bounded_task(task):
        async with semaphore:
            return await task

    return await asyncio.gather(*[bounded_task(t) for t in tasks], return_exceptions=True)


def safe_divide(numerator: float, denominator: float, default: float = 0) -> float:
    """Safely divide two numbers, returning default if division by zero."""
    if denominator == 0:
        return default
    return numerator / denominator


def calculate_percentage(part: float, whole: float, default: float = 0) -> float:
    """Calculate percentage safely."""
    return safe_divide(part * 100, whole, default)
