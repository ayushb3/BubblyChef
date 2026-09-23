"""Per-request wall-clock budget for the receipt scan pipeline (issue #481).

``POST /v1/scan/receipt`` is two AI calls in one HTTP request: a vision/OCR
leg (bounded per attempt by #476) and a structured text parse of the OCR
output. The Next.js client aborts the whole request at a fixed
``SCAN_TIMEOUT_MS`` (``nextjs/src/lib/api/scan.ts``), so the server has to
keep the *sum* of both legs under that figure, not each leg separately.

``RequestBudget`` is the one clock both legs draw down from. The route starts
it before preprocessing/OCR and, once OCR returns, hands ``remaining()`` to
the parse leg as its ceiling. It is deliberately tiny and pure so the
arithmetic can be unit-tested with an injected clock instead of real sleeps.
"""

from __future__ import annotations

import time
from collections.abc import Callable


class RequestBudget:
    """Wall-clock budget for a single request, drawn down from creation.

    Args:
        total_seconds: The full budget available to this request.
        clock: Monotonic time source; injectable for tests. Defaults to
            :func:`time.monotonic`.
    """

    def __init__(
        self,
        total_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if total_seconds < 0:
            raise ValueError(f"total_seconds must be >= 0, got {total_seconds}")
        self.total_seconds = total_seconds
        self._clock = clock
        self._started_at = clock()

    def elapsed(self) -> float:
        """Seconds spent since the budget was started."""
        return max(0.0, self._clock() - self._started_at)

    def remaining(self) -> float:
        """Seconds left, clamped at zero once the budget is exhausted.

        A zero return is meaningful to the parse leg: it means "do not start
        another AI call at all" rather than "start one with no time".
        """
        return max(0.0, self.total_seconds - self.elapsed())

    @property
    def exhausted(self) -> bool:
        """True once nothing is left to spend."""
        return self.remaining() <= 0.0
