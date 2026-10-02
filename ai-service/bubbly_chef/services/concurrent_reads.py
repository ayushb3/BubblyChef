"""Run independent repository reads at the same time (issue #888).

`SupabaseRepository` is declared `async` but wraps the SYNCHRONOUS supabase client:
every `.execute()` blocks the event loop until the HTTP round trip returns, and the
coroutine never yields in between. So `asyncio.gather(repo.a(), repo.b())` runs `a`
to completion, then `b`: the reads are sequential no matter how they are scheduled,
and each one also stalls every other request the worker is serving.

This helper moves each coroutine onto its own worker thread (with its own event
loop), which is what makes independent reads overlap. It is meant ONLY for the
repository-backed reads on the meal pick and add-a-side paths: those touch nothing
but the sync client (an `httpx.Client`, safe to share across threads). Never use it
for anything that holds an object bound to the main loop, such as the `AIManager`'s
async HTTP client, and never pass it a write: its callers rely on a failed read
surfacing as an exception, and a write needs its own error handling.
"""

import asyncio
from collections.abc import Coroutine, Sequence
from typing import Any, TypeVar, overload

A = TypeVar("A")
B = TypeVar("B")
C = TypeVar("C")
T = TypeVar("T")


def _run(coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


async def gather_reads(coros: Sequence[Coroutine[Any, Any, T]]) -> list[T]:
    """Await same-typed read coroutines concurrently, results in input order.

    The first exception propagates; reads already started on other threads finish
    on their own (they are plain reads, so nothing is left half-written).
    """
    return list(await asyncio.gather(*(asyncio.to_thread(_run, c) for c in coros)))


@overload
async def concurrent_reads(
    a: Coroutine[Any, Any, A], b: Coroutine[Any, Any, B], /
) -> tuple[A, B]: ...


@overload
async def concurrent_reads(
    a: Coroutine[Any, Any, A],
    b: Coroutine[Any, Any, B],
    c: Coroutine[Any, Any, C],
    /,
) -> tuple[A, B, C]: ...


async def concurrent_reads(*coros: Coroutine[Any, Any, Any]) -> tuple[Any, ...]:
    """Two or three differently-typed reads at once, as a tuple in argument order."""
    return tuple(await gather_reads(coros))
