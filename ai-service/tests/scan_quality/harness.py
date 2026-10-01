"""Live runner for the scan quality bar (issue #255).

Runs every fixture receipt through ``POST /v1/scan/receipt`` - the real route,
so the real Gemini vision OCR, the real parse workflow and the real confidence
bucketing, all through ``AIManager`` - and scores the result against that
fixture's expected-items file. See ``README.md`` for how to add a receipt.

Nothing here runs in the default suite: it needs a Gemini key and spends quota.
``test_scan_quality_live.py`` gates it behind ``BUBBLY_RUN_LIVE_TESTS=1``.
"""

from __future__ import annotations

import io
import json
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from tests.scan_quality.matching import (
    ExpectedItem,
    ReceiptScore,
    ScannedItem,
    median_seconds,
    overall_accuracy,
    score_receipt,
)

# The PRD scan bar (docs/plans/2026-09-23-v1-friend-ready-prd.md, Quality bars).
MAX_MEDIAN_SECONDS = 15.0
MIN_OVERALL_ACCURACY = 0.90

# Shared with the Playwright receipt-ingestion e2e: one corpus, two consumers.
FIXTURE_DIR = Path(__file__).resolve().parents[3] / "nextjs" / "e2e" / "fixtures" / "receipts"
IMAGE_SUFFIXES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}

# Mirrors nextjs/src/lib/api/scan.ts: the browser shrinks anything over 4 MB to
# a JPEG before upload, so the harness does too or it would time a request no
# real user can send.
_MAX_UPLOAD_BYTES = 4 * 1024 * 1024

_HARNESS_HOST = "scan-quality"


@dataclass
class Fixture:
    name: str
    image_path: Path
    expected: list[ExpectedItem]
    notes: str = ""


@dataclass
class ReceiptResult:
    fixture: str
    seconds: float
    score: ReceiptScore
    scanned_count: int
    skipped_count: int
    ai_requests: int
    warnings: list[str] = field(default_factory=list)


def discover_fixtures(directory: Path = FIXTURE_DIR) -> list[Fixture]:
    """Every image that has a sibling ``<stem>.expected.json``.

    An image without an expected file (the 69-byte ``grocery-mart-stub.png``
    used by the e2e suite) is not a scoring fixture and is skipped.
    """
    fixtures: list[Fixture] = []
    for image in sorted(directory.iterdir()):
        if image.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        expected_path = image.with_name(f"{image.stem}.expected.json")
        if not expected_path.exists():
            continue
        data = json.loads(expected_path.read_text(encoding="utf-8"))
        fixtures.append(
            Fixture(
                name=image.stem,
                image_path=image,
                expected=[ExpectedItem.from_json(i) for i in data["items"]],
                notes=str(data.get("notes", "")),
            )
        )
    return fixtures


def shrink_like_browser(image: bytes, mime: str) -> tuple[bytes, str]:
    """Reproduce ``compressImage`` from the Next.js scan client."""
    if len(image) <= _MAX_UPLOAD_BYTES:
        return image, mime
    from PIL import Image

    img = Image.open(io.BytesIO(image))
    scale = (_MAX_UPLOAD_BYTES / len(image)) ** 0.5 * 0.9
    resized = img.convert("RGB").resize((round(img.width * scale), round(img.height * scale)))
    out = io.BytesIO()
    resized.save(out, format="JPEG", quality=85)
    return out.getvalue(), "image/jpeg"


class AIRequestBudgetExceeded(RuntimeError):
    """Raised before sending a request that would pass the harness's call cap."""


@asynccontextmanager
async def count_ai_requests(max_requests: int | None = None) -> AsyncGenerator[list[int], None]:
    """Count every outbound HTTP request while the block runs.

    The scan is the only thing running, so each outbound request is an AI call
    (vision attempt, parse, or a provider retry/fallback). That is the number that
    spends quota, so it is the one reported. ``max_requests`` is a hard stop:
    the request that would exceed it raises instead of being sent.
    """
    counter = [0]
    original: Callable[..., Awaitable[httpx.Response]] = httpx.AsyncClient.send

    async def counting_send(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> httpx.Response:
        request = args[0] if args else kwargs["request"]
        if request.url.host == _HARNESS_HOST:  # the harness's own call into the app
            return await original(self, *args, **kwargs)
        if max_requests is not None and counter[0] >= max_requests:
            raise AIRequestBudgetExceeded(f"harness cap of {max_requests} AI requests reached")
        counter[0] += 1
        return await original(self, *args, **kwargs)

    httpx.AsyncClient.send = counting_send  # type: ignore[method-assign]
    try:
        yield counter
    finally:
        httpx.AsyncClient.send = original  # type: ignore[method-assign]


def _build_app() -> FastAPI:
    from bubbly_chef.api.auth import get_current_user_id
    from bubbly_chef.api.routes.scan import router

    @asynccontextmanager
    async def no_op_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    app = FastAPI(lifespan=no_op_lifespan)
    app.include_router(router)
    app.dependency_overrides[get_current_user_id] = lambda: "scan-quality-harness"
    return app


async def run_fixture(client: AsyncClient, fixture: Fixture) -> ReceiptResult:
    """Scan one fixture through the real route; time it and score it."""
    mime = IMAGE_SUFFIXES[fixture.image_path.suffix.lower()]
    image, mime = shrink_like_browser(fixture.image_path.read_bytes(), mime)

    async with count_ai_requests(_cap_from_env()) as counter:
        started = time.perf_counter()
        response = await client.post(
            "/v1/scan/receipt",
            files={"file": (fixture.image_path.name, image, mime)},
            timeout=120.0,
        )
        seconds = time.perf_counter() - started
    response.raise_for_status()
    body = response.json()

    surfaced = [ScannedItem.from_response(i) for i in body["ready_to_add"] + body["needs_review"]]
    return ReceiptResult(
        fixture=fixture.name,
        seconds=seconds,
        score=score_receipt(fixture.expected, surfaced),
        scanned_count=len(surfaced),
        skipped_count=len(body["skipped"]),
        ai_requests=counter[0],
        warnings=list(body.get("warnings", [])),
    )


def _cap_from_env() -> int | None:
    import os

    raw = os.environ.get("BUBBLY_SCAN_QUALITY_MAX_AI_REQUESTS")
    return int(raw) if raw else None


async def run_all(fixtures: list[Fixture]) -> list[ReceiptResult]:
    """Run fixtures one after another (sequential, so each time is uncontended)."""
    from bubbly_chef.api import deps

    deps._ai_manager = None  # fresh manager bound to this event loop
    results: list[ReceiptResult] = []
    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url=f"http://{_HARNESS_HOST}") as client:
        for fixture in fixtures:
            results.append(await run_fixture(client, fixture))
    return results


def format_report(results: list[ReceiptResult]) -> str:
    """Markdown block, pasteable into a PR body as evidence."""
    median = median_seconds([r.seconds for r in results])
    overall = overall_accuracy([r.score for r in results])
    lines = [
        "| Receipt | Time | Correct | Expected | Spurious | Accuracy | AI requests |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in results:
        s = r.score
        lines.append(
            f"| {r.fixture} | {r.seconds:.1f}s | {len(s.correct)} | {s.expected_count} | "
            f"{len(s.spurious)} | {s.accuracy:.0%} | {r.ai_requests} |"
        )
    time_ok = "PASS" if median <= MAX_MEDIAN_SECONDS else "FAIL"
    acc_ok = "PASS" if overall >= MIN_OVERALL_ACCURACY else "FAIL"
    lines += [
        "",
        f"- Median time: **{median:.1f}s** (bar: <= {MAX_MEDIAN_SECONDS:.0f}s) - {time_ok}",
        f"- Overall accuracy: **{overall:.0%}** (bar: >= {MIN_OVERALL_ACCURACY:.0%}) - {acc_ok}",
        f"- Total AI requests: {sum(r.ai_requests for r in results)}",
    ]
    for r in results:
        for name, why in r.score.missed:
            lines.append(f"- {r.fixture}: missed `{name}` ({why})")
        for name in r.score.spurious:
            lines.append(f"- {r.fixture}: spurious `{name}`")
        for w in r.warnings:
            lines.append(f"- {r.fixture}: warning: {w}")
    return "\n".join(lines)
