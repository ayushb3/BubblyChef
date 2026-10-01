"""Live scan quality bar - call the real Gemini API (issue #255).

Every fixture receipt in nextjs/e2e/fixtures/receipts/ that has a
<name>.expected.json goes through POST /v1/scan/receipt (real vision OCR + real
parse, via AIManager). Asserts the PRD scan bar:

  * median wall time per receipt <= 15 s
  * overall line-item accuracy   >= 90 %

Skipped unless BUBBLY_RUN_LIVE_TESTS=1, so default pytest and CI never spend
quota. Run it (the report prints with -s, ready to paste into a PR body):

    cd ai-service
    BUBBLY_RUN_LIVE_TESTS=1 pytest tests/test_scan_quality_live.py -v -s

Cap the spend with BUBBLY_SCAN_QUALITY_MAX_AI_REQUESTS=<n>. See
tests/scan_quality/README.md.
"""

from __future__ import annotations

import pytest

from bubbly_chef.config import settings
from tests.scan_quality import harness
from tests.scan_quality.matching import median_seconds, overall_accuracy

_LIVE = getattr(settings, "run_live_tests", False)
_SKIP = pytest.mark.skipif(not _LIVE, reason="set BUBBLY_RUN_LIVE_TESTS=1 to run live tests")


@_SKIP
@pytest.mark.live
@pytest.mark.asyncio
async def test_scan_quality_bar() -> None:
    fixtures = harness.discover_fixtures()
    assert fixtures, f"no <name>.expected.json fixtures found in {harness.FIXTURE_DIR}"

    results = await harness.run_all(fixtures)
    print("\n" + harness.format_report(results))  # noqa: T201 - the evidence block

    median = median_seconds([r.seconds for r in results])
    accuracy = overall_accuracy([r.score for r in results])
    assert median <= harness.MAX_MEDIAN_SECONDS, f"median {median:.1f}s is over the bar"
    assert accuracy >= harness.MIN_OVERALL_ACCURACY, f"accuracy {accuracy:.0%} is under the bar"
