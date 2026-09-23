"""Round-trip serialization tests for the discriminated proposal union.

Each concrete proposal type must survive:
  build → model_dump(mode="json") → AnyProposalAdapter.validate_python → concrete type

This exercises acceptance criterion #3 from issue #413.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from bubbly_chef.models.cook import CookProposal, IngredientMatch
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
    StorageLocation,
)
from bubbly_chef.models.proposals import (
    AnyProposalAdapter,
    HandoffKind,
    HandoffProposal,
    RecipeAmendmentDetection,
    RecipeAmendmentProposal,
    RecipeIngredientAmendment,
)
from bubbly_chef.models.recipe import Ingredient, RecipeCard, RecipeCardProposal


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pantry_item() -> PantryItem:
    return PantryItem(
        id=uuid.uuid4(),
        name="whole milk",
        category=FoodCategory.DAIRY,
        storage_location=StorageLocation.FRIDGE,
        quantity=2.0,
        unit="litre",
    )


def _pantry_proposal() -> PantryProposal:
    action = PantryUpsertAction(
        action_type=ActionType.ADD,
        item=_pantry_item(),
        confidence=0.9,
    )
    return PantryProposal(actions=[action], source_text="I bought milk")


def _handoff_proposal() -> HandoffProposal:
    return HandoffProposal(
        kind=HandoffKind.RECEIPT,
        instructions="Upload a photo of your receipt.",
        required_inputs=["receipt_image"],
    )


def _recipe_card_proposal() -> RecipeCardProposal:
    card = RecipeCard(
        title="Tomato Pasta",
        ingredients=[Ingredient(name="pasta", quantity=200.0, unit="g")],
        instructions=["Boil pasta", "Add sauce"],
    )
    return RecipeCardProposal(recipe=card, pantry_match_score=0.8)


def _cook_proposal() -> CookProposal:
    match = IngredientMatch(
        ingredient_name="eggs",
        ingredient_qty=3.0,
        ingredient_unit="item",
        pantry_item_id=uuid.uuid4(),
        pantry_item_name="eggs",
        pantry_qty_available=6.0,
        deduct_qty=3.0,
        base_unit="item",
        status="ready",
    )
    return CookProposal(
        recipe_id=uuid.uuid4(),
        recipe_title="Scrambled Eggs",
        matches=[match],
    )


def _recipe_amendment_proposal() -> RecipeAmendmentProposal:
    return RecipeAmendmentProposal(
        amended_ingredients=[
            RecipeIngredientAmendment(name="pasta", quantity=200.0, unit="g"),
            RecipeIngredientAmendment(
                name="milk", quantity=200.0, unit="ml", notes="substituted for heavy cream"
            ),
        ],
        change_summary="Replaced heavy cream with milk.",
        recipe_id="recipe-487",
        recipe_title="Creamy Pasta",
    )


# ---------------------------------------------------------------------------
# Round-trip tests
# ---------------------------------------------------------------------------


class TestPantryProposalRoundTrip:
    def test_proposal_type_tag(self) -> None:
        p = _pantry_proposal()
        assert p.proposal_type == "pantry"

    def test_round_trip(self) -> None:
        original = _pantry_proposal()
        dumped = original.model_dump(mode="json")
        reloaded = AnyProposalAdapter.validate_python(dumped)
        assert isinstance(reloaded, PantryProposal)
        assert reloaded.source_text == "I bought milk"
        assert len(reloaded.actions) == 1
        assert reloaded.actions[0].item.name == "whole milk"


class TestHandoffProposalRoundTrip:
    def test_proposal_type_tag(self) -> None:
        p = _handoff_proposal()
        assert p.proposal_type == "handoff"

    def test_round_trip(self) -> None:
        original = _handoff_proposal()
        dumped = original.model_dump(mode="json")
        reloaded = AnyProposalAdapter.validate_python(dumped)
        assert isinstance(reloaded, HandoffProposal)
        assert reloaded.kind == HandoffKind.RECEIPT
        assert reloaded.instructions == "Upload a photo of your receipt."

    def test_kind_field_preserved(self) -> None:
        """Ensure the domain-specific 'kind' field is distinct from proposal_type."""
        p = _handoff_proposal()
        dumped = p.model_dump(mode="json")
        assert dumped["kind"] == "receipt"
        assert dumped["proposal_type"] == "handoff"


class TestRecipeCardProposalRoundTrip:
    def test_proposal_type_tag(self) -> None:
        p = _recipe_card_proposal()
        assert p.proposal_type == "recipe_card"

    def test_round_trip(self) -> None:
        original = _recipe_card_proposal()
        dumped = original.model_dump(mode="json")
        reloaded = AnyProposalAdapter.validate_python(dumped)
        assert isinstance(reloaded, RecipeCardProposal)
        assert reloaded.recipe.title == "Tomato Pasta"
        assert reloaded.pantry_match_score == pytest.approx(0.8)


class TestCookProposalRoundTrip:
    def test_proposal_type_tag(self) -> None:
        p = _cook_proposal()
        assert p.proposal_type == "cook"

    def test_round_trip(self) -> None:
        original = _cook_proposal()
        dumped = original.model_dump(mode="json")
        reloaded = AnyProposalAdapter.validate_python(dumped)
        assert isinstance(reloaded, CookProposal)
        assert reloaded.recipe_title == "Scrambled Eggs"
        assert len(reloaded.matches) == 1
        assert reloaded.matches[0].ingredient_name == "eggs"


class TestRecipeAmendmentProposalRoundTrip:
    """Issue #487: the chat amendment is a real union member, not a bare dict."""

    def test_proposal_type_tag(self) -> None:
        p = _recipe_amendment_proposal()
        assert p.proposal_type == "recipe_amendment"

    def test_round_trip(self) -> None:
        original = _recipe_amendment_proposal()
        dumped = original.model_dump(mode="json")
        reloaded = AnyProposalAdapter.validate_python(dumped)
        assert isinstance(reloaded, RecipeAmendmentProposal)
        assert reloaded == original
        assert reloaded.recipe_id == "recipe-487"
        assert reloaded.change_summary == "Replaced heavy cream with milk."
        assert [i.name for i in reloaded.amended_ingredients] == ["pasta", "milk"]

    def test_wire_shape_keeps_detection_fields(self) -> None:
        """Frontend duck-types on these keys; proposal_type is added, nothing renamed."""
        dumped = _recipe_amendment_proposal().model_dump(mode="json")
        assert dumped["is_amendment"] is True
        assert dumped["proposal_type"] == "recipe_amendment"
        assert set(dumped) >= {"is_amendment", "amended_ingredients", "change_summary"}

    def test_from_detection_converts_amendment(self) -> None:
        detection = RecipeAmendmentDetection(
            is_amendment=True,
            amended_ingredients=[RecipeIngredientAmendment(name="milk")],
            change_summary="Swap cream for milk.",
        )
        proposal = RecipeAmendmentProposal.from_detection(
            detection, recipe_id="r1", recipe_title="Pasta"
        )
        assert isinstance(proposal, RecipeAmendmentProposal)
        assert proposal.recipe_id == "r1"
        assert proposal.recipe_title == "Pasta"
        assert proposal.change_summary == "Swap cream for milk."

    @pytest.mark.parametrize(
        "detection",
        [
            RecipeAmendmentDetection(is_amendment=False),
            RecipeAmendmentDetection(is_amendment=True, amended_ingredients=None),
            RecipeAmendmentDetection(is_amendment=True, amended_ingredients=[]),
        ],
        ids=["not-amendment", "no-ingredients", "empty-ingredients"],
    )
    def test_from_detection_returns_none_when_nothing_to_propose(
        self, detection: RecipeAmendmentDetection
    ) -> None:
        assert RecipeAmendmentProposal.from_detection(detection) is None

    def test_detection_dict_is_not_a_union_member(self) -> None:
        """The pre-#487 shape (no discriminator) is rejected, not silently accepted."""
        detection = RecipeAmendmentDetection(
            is_amendment=True, amended_ingredients=[RecipeIngredientAmendment(name="milk")]
        )
        with pytest.raises(ValidationError):
            AnyProposalAdapter.validate_python(detection.model_dump(mode="json"))


class TestDiscriminatorIntegrity:
    """Ensure the discriminator field itself does not break existing constructors."""

    def test_pantry_proposal_no_explicit_tag(self) -> None:
        """Constructors that don't pass proposal_type still get the default."""
        p = PantryProposal(actions=[])
        assert p.proposal_type == "pantry"

    def test_handoff_proposal_no_explicit_tag(self) -> None:
        p = HandoffProposal(
            kind=HandoffKind.PRODUCT,
            instructions="Scan barcode",
            required_inputs=["barcode"],
        )
        assert p.proposal_type == "handoff"

    def test_recipe_card_proposal_no_explicit_tag(self) -> None:
        card = RecipeCard(title="Plain", ingredients=[], instructions=[])
        p = RecipeCardProposal(recipe=card)
        assert p.proposal_type == "recipe_card"

    def test_cook_proposal_no_explicit_tag(self) -> None:
        p = CookProposal(recipe_id=uuid.uuid4(), recipe_title="Test", matches=[])
        assert p.proposal_type == "cook"

    def test_recipe_amendment_proposal_no_explicit_tag(self) -> None:
        p = RecipeAmendmentProposal(amended_ingredients=[RecipeIngredientAmendment(name="x")])
        assert p.proposal_type == "recipe_amendment"
