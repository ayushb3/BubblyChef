"""Default-suite tests for the scan quality harness (issue #255).

Everything here is offline: the matching rule, fixture discovery, the call
counter and the report format. The live run itself is
``test_scan_quality_live.py`` (opt-in).
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from bubbly_chef.models.base import (
    ConfidenceScore,
    Intent,
    NextAction,
    ProposalEnvelope,
    WorkflowStatus,
)
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
)
from tests.scan_quality import harness
from tests.scan_quality.matching import (
    ExpectedItem,
    ScannedItem,
    names_match,
    overall_accuracy,
    quantity_ok,
    score_receipt,
)


def _exp(name: str, quantity: float | list[float] | None = None) -> ExpectedItem:
    return ExpectedItem(name=name, quantity=quantity)


def _got(name: str, quantity: float | None = 1.0, **kw: str) -> ScannedItem:
    return ScannedItem(name=name, quantity=quantity, confidence=0.9, **kw)


# --- name matching -----------------------------------------------------------


@pytest.mark.parametrize(
    ("expected", "scanned"),
    [
        ("gala apples", "apple"),  # plural + parser dropped the variety
        ("whole milk", "Milk"),
        ("ground beef", "Ground Beef 80/20"),
        ("roma tomatoes", "tomato"),
        ("spaghetti pasta", "spaghetti"),
    ],
)
def test_names_match(expected: str, scanned: str) -> None:
    assert names_match(expected, scanned)


@pytest.mark.parametrize(
    ("expected", "scanned"),
    [("spinach", "spaghetti"), ("greek yogurt", "soy milk"), ("eggs", ""), ("", "eggs")],
)
def test_names_do_not_match(expected: str, scanned: str) -> None:
    assert not names_match(expected, scanned)


# --- quantity tolerance ------------------------------------------------------


def test_quantity_tolerance() -> None:
    assert quantity_ok(None, None)  # not checked
    assert quantity_ok(1, 1.5)  # inside the absolute tolerance
    assert not quantity_ok(1, 2)
    assert not quantity_ok(1, None)  # expected a quantity, scan had none
    assert quantity_ok(12, 12.9)  # inside the relative tolerance
    assert not quantity_ok(12, 14)
    assert quantity_ok([1, 12], 12)  # any listed reading passes
    assert not quantity_ok(1, 80)  # the '80/20' beef trap


# --- scoring -----------------------------------------------------------------


def test_perfect_scan_scores_100_percent() -> None:
    score = score_receipt([_exp("eggs", [1, 12]), _exp("milk", 1)], [_got("egg", 12), _got("milk")])
    assert score.correct == ["eggs", "milk"]
    assert score.accuracy == 1.0


def test_missed_wrong_quantity_and_spurious_each_cost_one() -> None:
    score = score_receipt(
        [_exp("eggs", 1), _exp("milk", 1), _exp("bread", 1)],
        [_got("eggs", 1), _got("milk", 12), _got("total", 28.08)],
    )
    assert score.correct == ["eggs"]
    assert [name for name, _ in score.missed] == ["milk", "bread"]
    assert score.spurious == ["total"]
    # 1 correct of 3 expected + 1 invented
    assert score.accuracy == pytest.approx(1 / 4)


def test_one_scanned_item_cannot_pay_for_two_expected() -> None:
    score = score_receipt([_exp("milk", 1), _exp("whole milk", 1)], [_got("milk")])
    assert len(score.correct) == 1


def test_wrong_quantity_duplicate_does_not_shadow_a_right_one() -> None:
    score = score_receipt([_exp("milk", 1)], [_got("milk", 12), _got("milk", 1)])
    assert score.correct == ["milk"]
    assert score.spurious == ["milk"]  # the leftover duplicate line still counts against it


def test_matches_on_original_name_or_source_line() -> None:
    score = score_receipt(
        [_exp("greek yogurt", 1)],
        [_got("dairy item", 1, source_line="GREEK YOGURT 32oz - $5.99")],
    )
    assert score.correct == ["greek yogurt"]


def test_overall_accuracy_pools_every_line_item() -> None:
    a = score_receipt([_exp("rice")], [_got("rice")])
    b = score_receipt([_exp("salt"), _exp("flour"), _exp("sugar")], [_got("salt")])
    assert overall_accuracy([a, b]) == pytest.approx(2 / 4)


# --- fixtures ----------------------------------------------------------------


def test_every_fixture_with_an_expected_file_is_well_formed() -> None:
    fixtures = harness.discover_fixtures()
    names = {f.name for f in fixtures}
    assert {"grocery-mart", "city-harvest"} <= names
    for f in fixtures:
        assert f.image_path.stat().st_size > 1000, f"{f.name} is a stub, not a receipt"
        assert f.expected, f"{f.name} lists no expected items"
        assert len({e.name for e in f.expected}) == len(f.expected), f"{f.name} repeats an item"


def test_image_without_expected_file_is_skipped(tmp_path: Path) -> None:
    (tmp_path / "stub.png").write_bytes(b"x")
    (tmp_path / "real.png").write_bytes(b"x")
    (tmp_path / "real.expected.json").write_text(
        json.dumps({"items": [{"name": "milk", "quantity": 1}]}), encoding="utf-8"
    )
    assert [f.name for f in harness.discover_fixtures(tmp_path)] == ["real"]


def test_large_images_are_shrunk_like_the_browser_does() -> None:
    from PIL import Image

    big = Image.effect_noise((2400, 2400), 80).convert("RGB")
    buf = io.BytesIO()
    big.save(buf, format="PNG")
    data = buf.getvalue()
    assert len(data) > harness._MAX_UPLOAD_BYTES

    shrunk, mime = harness.shrink_like_browser(data, "image/png")
    assert mime == "image/jpeg"
    assert len(shrunk) <= harness._MAX_UPLOAD_BYTES

    small = b"tiny"
    assert harness.shrink_like_browser(small, "image/png") == (small, "image/png")


# --- AI request counter ------------------------------------------------------


@pytest.mark.asyncio
async def test_counter_counts_outbound_requests_and_enforces_the_cap() -> None:
    transport = httpx.MockTransport(lambda req: httpx.Response(200))
    async with harness.count_ai_requests(max_requests=2) as counter:
        async with httpx.AsyncClient(transport=transport) as client:
            await client.get("http://gemini.example/a")
            await client.get("http://gemini.example/b")
            with pytest.raises(harness.AIRequestBudgetExceeded):
                await client.get("http://gemini.example/c")
            # the harness's own call into the app is never counted
            await client.get(f"http://{harness._HARNESS_HOST}/v1/scan/receipt")
    assert counter[0] == 2
    # and the patch is undone afterwards
    assert httpx.AsyncClient.send.__name__ == "send"


# --- end to end with the network mocked --------------------------------------


def _envelope(*names: str) -> ProposalEnvelope[PantryProposal]:
    actions = [
        PantryUpsertAction(
            action_type=ActionType.ADD,
            item=PantryItem(name=n, quantity=1, unit="item", category=FoodCategory.OTHER),
            confidence=0.9,
            source_line=n.upper(),
        )
        for n in names
    ]
    return ProposalEnvelope[PantryProposal](
        schema_version="1.0.0",
        intent=Intent.PANTRY_UPDATE,
        proposal=PantryProposal(actions=actions),
        assistant_message="",
        confidence=ConfidenceScore(overall=0.9),
        requires_review=False,
        next_action=NextAction.REVIEW_PROPOSAL,
        workflow_status=WorkflowStatus.AWAITING_REVIEW,
    )


@pytest.mark.asyncio
async def test_run_all_drives_the_scan_route_and_reports(tmp_path: Path) -> None:
    from PIL import Image

    from bubbly_chef.api.ingest_dispatcher import dispatcher
    from bubbly_chef.services.ocr import MockOCR, set_ocr_service

    Image.new("RGB", (40, 40), "white").save(tmp_path / "r.png")
    (tmp_path / "r.expected.json").write_text(
        json.dumps({"items": [{"name": "milk", "quantity": 1}, {"name": "eggs", "quantity": 1}]}),
        encoding="utf-8",
    )
    fixtures = harness.discover_fixtures(tmp_path)

    set_ocr_service(MockOCR("MILK\nTOTAL"))
    try:
        with patch.object(dispatcher, "dispatch", AsyncMock(return_value=_envelope("milk", "total"))):
            results = await harness.run_all(fixtures)
    finally:
        set_ocr_service(None)  # type: ignore[arg-type]

    (result,) = results
    assert result.score.correct == ["milk"]
    assert [n for n, _ in result.score.missed] == ["eggs"]
    assert result.score.spurious == ["total"]
    assert result.ai_requests == 0  # mocked: nothing left the process
    assert result.seconds >= 0

    report = harness.format_report(results)
    assert "| r |" in report
    assert "Median time" in report and "Overall accuracy" in report
    assert "FAIL" in report  # 1 of 3 is below the 90% bar
    assert "missed `eggs`" in report and "spurious `total`" in report
