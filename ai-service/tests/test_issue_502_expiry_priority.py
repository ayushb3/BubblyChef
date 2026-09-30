"""Issue #502 (Spec B.10): the expiry-priority profile setting (Off / Gentle / Aggressive),
and issue #499: the brainstorm's kitchen-sink "60%+ of the listed ingredients" rule.

As in #288 / #336, these are prompt-level tests: they assert on the rendered text the
model actually sees and on `score_and_rank`'s deterministic points, never on a mocked
model's output (which proves nothing about real behaviour).

What each level means:
* Off        -- no urgency points, no "expiring soon" block or rule anywhere in a prompt.
* Gentle     -- the default; today's wording minus the `TODO(#395)` developer notes that
                used to sit inside the prompt strings and leak to the model.
* Aggressive -- urgency +8/+5 and a stronger prompt; the #288 coherence guard stays, and an
                explicit dish request still wins.
"""

import re
from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.domain.expiry_priority import (
    DEFAULT_EXPIRY_PRIORITY,
    coerce_expiry_priority,
    urgency_weights,
)
from bubbly_chef.prompts.recipe import (
    BRAINSTORM_SYSTEM_PROMPT,
    BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY,
    GROUNDED_RECIPE_SYSTEM_PROMPT,
    RECIPE_GENERATION_PROMPT,
    brainstorm_system_prompt,
    grounded_recipe_system_prompt,
    recipe_generation_prompt,
)
from bubbly_chef.workflows.recipe.nodes import (
    brainstorm_recipe_ideas,
    generate_grounded_recipe,
    score_and_rank,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.state import LLMRecipeResult

LEVELS = ["off", "gentle", "aggressive"]


# ---------------------------------------------------------------------------
# Gentle == today's text minus the leaked TODO lines (the exact expected text)
# ---------------------------------------------------------------------------

GENTLE_BRAINSTORM = (
    "You are a creative cooking assistant. Given the user's available ingredients "
    "and constraints, suggest 3-4 recipe ideas.\n"
    "\n"
    "Rules:\n"
    "- Each idea should be a recipe name (2-5 words), not a full recipe\n"
    '- If "Must use" ingredients are listed, EVERY idea must actually use them — '
    "this overrides every other preference\n"
    "- Ingredients marked as expiring soon are a strong preference, not a "
    "requirement: try to build at least one idea around them, but it's fine to "
    "leave an expiring item out of a specific idea when it doesn't belong there. "
    "If none of your ideas can sensibly use the expiring items, say so briefly "
    "instead of forcing one in.\n"
    "- Every idea has to make culinary sense on its own terms — don't weld an "
    "ingredient into a dish just because it's expiring. In particular, don't "
    "wedge a sweet ingredient like fruit into a savoury dish unless the user "
    "asked for that combination or it's a genuine part of the cuisine in play.\n"
    "- Match the cuisine/mood if specified\n"
    "- ALL suggestions must be for the same meal type — if meal_type is specified, "
    "every idea must fit that meal (don't mix breakfast and dinner). If no meal "
    "type is given, don't assume one from the time of day or frame the ideas as "
    "snacks; suggest ordinary dishes for any meal.\n"
    "- Ideas may use a sensible subset of the listed ingredients: each should be "
    "realistically makeable from what's listed plus everyday staples (oil, salt, "
    "spices), but don't try to use as many of them as possible. A focused dish "
    "beats a kitchen-sink one, and it's fine for an idea to leave most of the list "
    "unused.\n"
    '- Format: conversational text with **bold** recipe names in a numbered list\n'
    '- End with a prompt like "Which one sounds good?" or "Want me to make any of these?"'
)

GENTLE_GROUNDED = (
    'Generate a complete recipe card for "{recipe_name}".\n'
    "\n"
    "Constraints: {constraints_json}\n"
    "Must-use ingredients (the user asked to cook with these — the recipe MUST "
    "include them): {must_use_items}\n"
    "Priority ingredients (expiring soon — a strong preference, not a "
    "requirement): {priority_items}\n"
    "Preferred flavors/ingredients (include if sensible): {preferred_ingredients}\n"
    "Supporting ingredients available: {supporting_items}\n"
    "Context: {context}\n"
    "\n"
    "Priority ingredients are a strong preference, not a requirement: favor "
    "building this recipe around them, but it's fine to leave one out if it "
    "doesn't belong in \"{recipe_name}\" — include a priority ingredient only if it "
    "genuinely fits the dish. In particular, don't wedge a sweet ingredient like "
    "fruit into a savoury dish unless the user asked for that combination or it's "
    "a genuine part of the cuisine in play. This does not apply to must-use "
    "ingredients above, which remain a hard requirement regardless of fit.\n"
    "\n"
    "Generate a full recipe with:\n"
)


class TestGentleIsTodaysTextMinusTheLeakedNotes:
    def test_brainstorm_gentle_text_is_exact(self) -> None:
        assert brainstorm_system_prompt("gentle") == GENTLE_BRAINSTORM

    def test_brainstorm_constant_is_gentle(self) -> None:
        assert BRAINSTORM_SYSTEM_PROMPT == GENTLE_BRAINSTORM

    def test_default_level_is_gentle(self) -> None:
        assert DEFAULT_EXPIRY_PRIORITY == "gentle"
        assert brainstorm_system_prompt() == GENTLE_BRAINSTORM
        assert grounded_recipe_system_prompt() == GROUNDED_RECIPE_SYSTEM_PROMPT
        assert recipe_generation_prompt() == RECIPE_GENERATION_PROMPT

    def test_grounded_gentle_header_is_exact(self) -> None:
        head, sep, _tail = grounded_recipe_system_prompt("gentle").partition(
            "Generate a full recipe with:\n"
        )
        assert sep
        assert head + sep == GENTLE_GROUNDED

    def test_grounded_constant_is_gentle(self) -> None:
        assert GROUNDED_RECIPE_SYSTEM_PROMPT == grounded_recipe_system_prompt("gentle")

    @pytest.mark.parametrize("level", LEVELS)
    def test_no_developer_notes_reach_the_model(self, level: str) -> None:
        """The TODO(#395) notes sat inside the prompt strings and were sent to the model."""
        for text in (
            brainstorm_system_prompt(level),  # type: ignore[arg-type]
            grounded_recipe_system_prompt(level),  # type: ignore[arg-type]
            recipe_generation_prompt(level),  # type: ignore[arg-type]
        ):
            assert "TODO" not in text
            assert "#395" not in text
            assert "expiry_priority" not in text
            assert not re.search(r"^# ", text, flags=re.MULTILINE)


# ---------------------------------------------------------------------------
# The brainstorm prompt, per level
# ---------------------------------------------------------------------------


class TestBrainstormPromptByLevel:
    def test_off_has_no_expiry_language_at_all(self) -> None:
        text = brainstorm_system_prompt("off")
        assert "expir" not in text.lower()
        assert "weld an ingredient" not in text
        # The rest of the prompt is intact.
        assert '"Must use" ingredients are listed' in text
        assert "Match the cuisine/mood" in text

    def test_aggressive_is_stronger_than_gentle(self) -> None:
        text = brainstorm_system_prompt("aggressive")
        assert "high priority" in text
        assert "strong preference, not a requirement" not in text
        assert "say so briefly instead of forcing one in" not in text

    def test_aggressive_keeps_the_288_coherence_guard(self) -> None:
        text = brainstorm_system_prompt("aggressive")
        assert "make culinary sense" in text
        assert "sweet ingredient" in text
        assert "savoury dish" in text
        assert "unless the user asked for that combination" in text
        assert "genuine part of the cuisine" in text

    def test_aggressive_explicit_dish_request_still_wins(self) -> None:
        text = brainstorm_system_prompt("aggressive")
        assert "explicit request" in text
        assert "only where it fits" in text
        assert (
            'If "Must use" ingredients are listed, EVERY idea must actually use them — '
            "this overrides every other preference"
        ) in text

    def test_no_pantry_prompt_is_unchanged_by_the_setting(self) -> None:
        """#287: no expiring reference there, and Off must not add one."""
        assert "expir" not in BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY.replace(
            "anything expiring", ""
        )


# ---------------------------------------------------------------------------
# #499: the kitchen-sink 60% rule
# ---------------------------------------------------------------------------


class TestKitchenSinkRuleRelaxed:
    @pytest.mark.parametrize("level", LEVELS)
    def test_the_60_percent_rule_is_gone(self, level: str) -> None:
        text = brainstorm_system_prompt(level)  # type: ignore[arg-type]
        assert "60%" not in text
        assert "60+" not in text

    @pytest.mark.parametrize("level", LEVELS)
    def test_ideas_may_use_a_sensible_subset(self, level: str) -> None:
        text = brainstorm_system_prompt(level)  # type: ignore[arg-type]
        assert "sensible subset of the listed ingredients" in text
        assert "kitchen-sink" in text
        # Still grounded in what's actually there.
        assert "realistically makeable from what's listed" in text

    @pytest.mark.asyncio
    async def test_rendered_brainstorm_prompt_carries_the_subset_rule(self) -> None:
        scored = [
            {"name": n, "_score": 1, "_must_use": False, "_expired": False}
            for n in ("chicken", "rice", "spinach", "banana", "yogurt")
        ]
        with _mock_ai() as ai:
            await brainstorm_recipe_ideas(
                {"input_text": "dinner ideas", "scored_pantry_items": scored}
            )
        prompt = _captured_prompt(ai)
        assert "sensible subset of the listed ingredients" in prompt
        assert "60%" not in prompt
        assert "chicken, rice, spinach, banana, yogurt" in prompt


# ---------------------------------------------------------------------------
# The grounded recipe-card prompt, per level
# ---------------------------------------------------------------------------


class TestGroundedPromptByLevel:
    def test_off_has_no_priority_line_or_paragraph(self) -> None:
        text = grounded_recipe_system_prompt("off")
        assert "Priority ingredients" not in text
        assert "expiring" not in text.lower()
        assert "{priority_items}" not in text
        # Must-use and the placeholders the node fills are intact.
        assert "Must-use ingredients" in text
        for field in ("{recipe_name}", "{must_use_items}", "{supporting_items}", "{context}"):
            assert field in text

    def test_aggressive_is_stronger_than_gentle(self) -> None:
        text = grounded_recipe_system_prompt("aggressive")
        assert "strong preference, not a requirement" not in text
        assert "fine to leave one out" not in text
        assert "use them up" in text
        assert "{priority_items}" in text

    def test_aggressive_keeps_the_288_336_coherence_guard(self) -> None:
        text = grounded_recipe_system_prompt("aggressive")
        assert "sweet ingredient" in text
        assert "savoury dish" in text
        assert "unless the user asked for that combination" in text
        assert "genuine part of the cuisine" in text

    def test_aggressive_named_dish_and_must_use_win(self) -> None:
        text = grounded_recipe_system_prompt("aggressive")
        assert "named a dish" in text
        assert "only where it fits" in text
        assert "must-use ingredients above, which remain a hard requirement" in text

    @pytest.mark.parametrize("level", LEVELS)
    def test_every_level_formats_cleanly(self, level: str) -> None:
        rendered = grounded_recipe_system_prompt(level).format(  # type: ignore[arg-type]
            recipe_name="Chicken Bake",
            constraints_json="{}",
            must_use_items="none specified",
            priority_items="banana",
            preferred_ingredients="none specified",
            supporting_items="rice",
            context="ctx",
        )
        assert "Chicken Bake" in rendered
        assert "{" not in rendered.replace("{}", "")


# ---------------------------------------------------------------------------
# The standalone generation prompt (RECIPE_GENERATION_PROMPT)
# ---------------------------------------------------------------------------


def _render_generation(level: str) -> str:
    return recipe_generation_prompt(level).format(  # type: ignore[arg-type]
        pantry_items_formatted="- banana\n- chicken",
        expiring_items="- ⚠️ banana - expires tomorrow!",
        user_prompt="make me a savoury chicken dish",
        constraints="None specified.",
    )


class TestRecipeGenerationPromptByLevel:
    def test_gentle_is_softened_and_has_the_coherence_guard(self) -> None:
        text = _render_generation("gentle")
        assert "prioritize using these" not in text.lower()
        assert "Prioritizes items that are expiring soon" not in text
        assert "strong preference, not a requirement" in text
        assert "sweet ingredient" in text
        assert "savoury dish" in text
        assert "unless the user asked for that combination" in text
        assert "banana" in text  # the expiring list still reaches the model

    def test_off_drops_the_expiring_section_and_rule(self) -> None:
        text = _render_generation("off")
        assert "Items Expiring Soon" not in text
        assert "expires tomorrow" not in text
        assert "expiring" not in text.lower()
        assert "User's Pantry" in text
        assert "savoury chicken dish" in text

    def test_off_criteria_are_renumbered(self) -> None:
        text = _render_generation("off")
        numbers = [int(n) for n in re.findall(r"^(\d+)\. ", text, flags=re.MULTILINE)]
        assert numbers == list(range(1, len(numbers) + 1))
        # Gentle has exactly one more criterion than Off (the expiring one).
        gentle_numbers = re.findall(r"^(\d+)\. ", _render_generation("gentle"), flags=re.MULTILINE)
        assert len(gentle_numbers) == len(numbers) + 1

    def test_aggressive_is_stronger_but_still_coherent(self) -> None:
        text = _render_generation("aggressive")
        assert "strong preference, not a requirement" not in text
        assert "use them up" in text
        assert "sweet ingredient" in text
        assert "savoury dish" in text
        assert "request wins" in text

    def test_a_savoury_chicken_request_with_an_expiring_banana_keeps_the_guard(self) -> None:
        """The #288 scenario on the standalone path: the guard is present at every level
        that mentions expiring food at all."""
        for level in ("gentle", "aggressive"):
            text = _render_generation(level)
            assert "make me a savoury chicken dish" in text
            assert "sweet ingredient" in text and "savoury dish" in text

    @pytest.mark.parametrize("level", LEVELS)
    def test_formats_and_keeps_its_json_example(self, level: str) -> None:
        text = _render_generation(level)
        assert "Honey Garlic Chicken Stir-Fry" in text
        assert '"title"' in text


# ---------------------------------------------------------------------------
# score_and_rank: urgency points
# ---------------------------------------------------------------------------


def _item(name: str, days: int | None) -> dict[str, Any]:
    row: dict[str, Any] = {"name": name, "quantity": 1}
    if days is not None:
        row["expiry_date"] = (date.today() + timedelta(days=days)).isoformat()
    return row


def _scores(ranked: list[dict[str, Any]]) -> dict[str, float]:
    return {r["name"]: r["_score"] for r in ranked}


class TestScoreAndRankUrgency:
    ITEMS = [_item("soon", 2), _item("week", 6), _item("later", 30), _item("undated", None)]

    def test_weights_table(self) -> None:
        assert urgency_weights("off") == (0, 0)
        assert urgency_weights("gentle") == (4, 2)
        assert urgency_weights("aggressive") == (8, 5)

    def test_default_is_gentle_and_unchanged(self) -> None:
        assert _scores(score_and_rank(self.ITEMS, {})) == {
            "soon": 4,
            "week": 2,
            "later": 0,
            "undated": 0,
        }
        assert score_and_rank(self.ITEMS, {}) == score_and_rank(
            self.ITEMS, {}, expiry_priority="gentle"
        )

    def test_aggressive_weights_are_8_and_5(self) -> None:
        scores = _scores(score_and_rank(self.ITEMS, {}, expiry_priority="aggressive"))
        assert scores == {"soon": 8, "week": 5, "later": 0, "undated": 0}

    def test_off_applies_no_urgency_points(self) -> None:
        scores = _scores(score_and_rank(self.ITEMS, {}, expiry_priority="off"))
        assert scores == {"soon": 0, "week": 0, "later": 0, "undated": 0}

    def test_off_ranks_the_same_as_if_nothing_were_expiring(self) -> None:
        dated = [_item("a", 1), _item("b", 5), _item("c", 40)]
        undated = [_item("a", None), _item("b", None), _item("c", None)]
        off = score_and_rank(dated, {"preferred_ingredients": ["c"]}, expiry_priority="off")
        none_expiring = score_and_rank(undated, {"preferred_ingredients": ["c"]})
        assert [r["name"] for r in off] == [r["name"] for r in none_expiring]
        assert [r["_score"] for r in off] == [r["_score"] for r in none_expiring]

    def test_off_still_marks_expired_stock_so_it_is_never_offered(self) -> None:
        """Expired food stays flagged at every level (#239): Off skips only the points."""
        ranked = score_and_rank([_item("old", -5)], {}, expiry_priority="off")
        assert ranked[0]["_expired"] is True

    def test_must_use_still_dominates_at_every_level(self) -> None:
        items = [_item("soon", 1), _item("chicken", 30)]
        for level in LEVELS:
            ranked = score_and_rank(
                items, {"must_use_ingredients": ["chicken"]}, expiry_priority=level  # type: ignore[arg-type]
            )
            assert ranked[0]["name"] == "chicken"

    def test_aggressive_lets_a_bare_expiring_item_outrank_a_preference_match(self) -> None:
        """Gentle: a preferred item (+5) beats a bare expiring one (+4).
        Aggressive: the expiring item (+8) leads."""
        items = [_item("milk", 2), _item("rice", 30)]
        constraints = {"preferred_ingredients": ["rice"]}
        assert score_and_rank(items, constraints)[0]["name"] == "rice"
        aggressive = score_and_rank(items, constraints, expiry_priority="aggressive")
        assert aggressive[0]["name"] == "milk"


# ---------------------------------------------------------------------------
# Coercion of the stored value
# ---------------------------------------------------------------------------


class TestCoerce:
    @pytest.mark.parametrize("level", LEVELS)
    def test_known_levels_pass_through(self, level: str) -> None:
        assert coerce_expiry_priority(level) == level

    @pytest.mark.parametrize("raw", [None, "", "  ", "maximum", 3, [], {}, "GENTLE ", "Off"])
    def test_anything_else_is_gentle_or_a_normalised_level(self, raw: object) -> None:
        got = coerce_expiry_priority(raw)
        if isinstance(raw, str) and raw.strip().lower() in LEVELS:
            assert got == raw.strip().lower()
        else:
            assert got == "gentle"


# ---------------------------------------------------------------------------
# Nodes: the rendered prompts the model sees
# ---------------------------------------------------------------------------


def _mock_ai(return_value: Any = "**Idea**\nWhich one sounds good?") -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=return_value)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _captured_prompt(mock_mgr: Any) -> str:
    return str(mock_mgr.return_value.complete.call_args.kwargs["prompt"])


def _stock() -> list[dict[str, Any]]:
    return [
        {"name": "chicken", "_score": 0, "_must_use": False, "_expired": False},
        {
            "name": "banana",
            "_score": 4,
            "_must_use": False,
            "_expired": False,
            "expiry_date": (date.today() + timedelta(days=2)).isoformat(),
        },
        {
            "name": "spinach",
            "_score": 2,
            "_must_use": False,
            "_expired": False,
            "expiry_date": (date.today() + timedelta(days=5)).isoformat(),
        },
    ]


async def _brainstorm_prompt(level: str | None, input_text: str = "dinner ideas") -> str:
    state: dict[str, Any] = {"input_text": input_text, "scored_pantry_items": _stock()}
    if level is not None:
        state["expiry_priority"] = level
    with _mock_ai() as ai:
        await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]
    return _captured_prompt(ai)


class TestBrainstormNode:
    @pytest.mark.asyncio
    async def test_gentle_block_is_todays_text(self) -> None:
        prompt = await _brainstorm_prompt("gentle")
        assert (
            "\nExpiring soon (weave in where it fits, not mandatory): banana, spinach"
            in prompt
        )
        assert "\nOther available: chicken" in prompt
        assert GENTLE_BRAINSTORM in prompt

    @pytest.mark.asyncio
    async def test_unset_level_is_gentle(self) -> None:
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_expiry_priority",
            AsyncMock(return_value="gentle"),
        ):
            assert await _brainstorm_prompt(None) == await _brainstorm_prompt("gentle")

    @pytest.mark.asyncio
    async def test_off_has_no_expiring_block_and_keeps_the_items_available(self) -> None:
        prompt = await _brainstorm_prompt("off")
        assert "xpir" not in prompt
        assert "Expiring soon" not in prompt
        # The food is still there to cook with, just not singled out.
        assert "Other available:" in prompt
        for name in ("chicken", "banana", "spinach"):
            assert name in prompt

    @pytest.mark.asyncio
    async def test_aggressive_label_is_the_stronger_wording(self) -> None:
        prompt = await _brainstorm_prompt("aggressive")
        assert "weave in where it fits, not mandatory" not in prompt
        assert "\nExpiring soon (use these up" in prompt
        assert "banana, spinach" in prompt

    @pytest.mark.asyncio
    async def test_aggressive_savoury_chicken_request_keeps_the_sweet_guard(self) -> None:
        prompt = await _brainstorm_prompt("aggressive", "make me a savoury chicken dish")
        assert "make me a savoury chicken dish" in prompt
        assert "banana" in prompt
        assert "sweet ingredient like fruit into a savoury dish" in prompt
        assert "explicit request" in prompt

    @pytest.mark.asyncio
    async def test_a_level_read_from_the_profile_when_state_has_none(self) -> None:
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_expiry_priority",
            AsyncMock(return_value="off"),
        ):
            prompt = await _brainstorm_prompt(None)
        assert "Expiring soon" not in prompt

    @pytest.mark.asyncio
    async def test_no_pantry_turn_is_untouched_at_every_level(self) -> None:
        for level in LEVELS:
            with _mock_ai() as ai:
                await brainstorm_recipe_ideas(
                    {
                        "input_text": "just give me a pasta recipe",
                        "scored_pantry_items": [],
                        "recipe_constraints": {"use_pantry": False},
                        "expiry_priority": level,  # type: ignore[typeddict-unknown-key]
                    }
                )
            prompt = _captured_prompt(ai)
            assert BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY in prompt
            assert "Expiring soon" not in prompt


def _grounded_ai() -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=LLMRecipeResult(
            title="Chicken Bake", description="d", ingredients=[], instructions=["step"]
        )
    )
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


async def _grounded_prompt(level: str | None) -> str:
    scored = score_and_rank(
        [_item("banana", 2), _item("chicken", 30), _item("rice", 30)],
        {},
        expiry_priority=level or "gentle",  # type: ignore[arg-type]
    )
    state: dict[str, Any] = {
        "selected_recipe_name": "Chicken Bake",
        "scored_pantry_items": scored,
        "recipe_constraints": {},
    }
    if level is not None:
        state["expiry_priority"] = level
    with _grounded_ai() as ai:
        await generate_grounded_recipe(state)  # type: ignore[arg-type]
    return _captured_prompt(ai)


class TestGroundedNode:
    @pytest.mark.asyncio
    async def test_gentle_lists_the_expiring_item_as_a_priority(self) -> None:
        prompt = await _grounded_prompt("gentle")
        assert "strong preference, not a requirement" in prompt

    @pytest.mark.asyncio
    async def test_off_has_no_priority_line_and_keeps_every_item_available(self) -> None:
        prompt = await _grounded_prompt("off")
        assert "Priority ingredients" not in prompt
        assert "xpir" not in prompt
        assert "banana" in prompt and "chicken" in prompt and "rice" in prompt

    @pytest.mark.asyncio
    async def test_aggressive_promotes_a_bare_expiring_item_and_keeps_the_guard(self) -> None:
        """Gentle scores a bare expiring item 4 (below the priority cut of 5); Aggressive 8."""
        gentle = await _grounded_prompt("gentle")
        assert re.search(r"Priority ingredients \(.*\): none specified", gentle)
        aggressive = await _grounded_prompt("aggressive")
        assert re.search(r"Priority ingredients \(.*\): banana", aggressive)
        assert "sweet ingredient like fruit into a savoury dish" in aggressive
        assert "named a dish" in aggressive

    @pytest.mark.asyncio
    async def test_a_level_read_from_the_profile_when_state_has_none(self) -> None:
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_expiry_priority",
            AsyncMock(return_value="off"),
        ):
            prompt = await _grounded_prompt(None)
        assert "Priority ingredients" not in prompt


class TestScoreNode:
    @pytest.mark.asyncio
    async def test_the_level_reaches_score_and_rank(self) -> None:
        snapshot = [_item("banana", 2), _item("chicken", 30)]
        results = {}
        for level in LEVELS:
            out = await score_pantry_ingredients(
                {  # type: ignore[typeddict-unknown-key]
                    "pantry_snapshot": snapshot,
                    "recipe_constraints": {},
                    "expiry_priority": level,
                }
            )
            results[level] = _scores(out["scored_pantry_items"])["banana"]
        assert results == {"off": 0, "gentle": 4, "aggressive": 8}


# ---------------------------------------------------------------------------
# The standalone generator
# ---------------------------------------------------------------------------


class TestGenerateRecipeService:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("level", LEVELS)
    async def test_the_level_shapes_the_rendered_prompt(self, level: str) -> None:
        from bubbly_chef.models.pantry import PantryItem
        from bubbly_chef.services.recipe_generator import AIRecipeOutput, generate_recipe

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Chicken Bake",
                description="d",
                ingredients=[],
                instructions=["step"],
            )
        )
        pantry = [
            PantryItem(
                name="banana",
                quantity=1,
                unit="count",
                category="produce",
                expiry_date=date.today() + timedelta(days=1),
            )
        ]
        await generate_recipe(
            prompt="a savoury chicken dish",
            pantry_items=pantry,
            ai_manager=ai,
            expiry_priority=level,  # type: ignore[arg-type]
        )
        prompt = str(ai.complete.call_args.kwargs["prompt"])
        if level == "off":
            assert "Items Expiring Soon" not in prompt
        else:
            assert "Items Expiring Soon" in prompt
            assert "sweet ingredient" in prompt


# ---------------------------------------------------------------------------
# The profile read degrades to Gentle
# ---------------------------------------------------------------------------


class TestStoredExpiryPriority:
    @pytest.mark.asyncio
    async def test_reads_the_column(self) -> None:
        from bubbly_chef.services.expiry_priority import get_stored_expiry_priority

        repo = MagicMock()
        repo.get_profile = AsyncMock(return_value={"expiry_priority": "aggressive"})
        with patch(
            "bubbly_chef.services.expiry_priority.get_repository", AsyncMock(return_value=repo)
        ):
            assert await get_stored_expiry_priority("u1") == "aggressive"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "profile",
        [None, {}, {"expiry_priority": None}, {"expiry_priority": "max"}, {"username": "x"}],
    )
    async def test_missing_column_or_row_is_gentle(self, profile: Any) -> None:
        """Migration 00018 may not have run: a row with no such column reads as Gentle."""
        from bubbly_chef.services.expiry_priority import get_stored_expiry_priority

        repo = MagicMock()
        repo.get_profile = AsyncMock(return_value=profile)
        with patch(
            "bubbly_chef.services.expiry_priority.get_repository", AsyncMock(return_value=repo)
        ):
            assert await get_stored_expiry_priority("u1") == "gentle"

    @pytest.mark.asyncio
    async def test_a_failing_read_is_gentle_not_an_error(self) -> None:
        from bubbly_chef.services.expiry_priority import get_stored_expiry_priority

        with patch(
            "bubbly_chef.services.expiry_priority.get_repository",
            AsyncMock(side_effect=RuntimeError("db down")),
        ):
            assert await get_stored_expiry_priority("u1") == "gentle"

    @pytest.mark.asyncio
    async def test_no_user_is_gentle(self) -> None:
        from bubbly_chef.services.expiry_priority import get_stored_expiry_priority

        assert await get_stored_expiry_priority("") == "gentle"


class TestGenerateRoute:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("level", LEVELS)
    async def test_the_route_reads_the_profile_level_into_the_prompt(self, level: str) -> None:
        from bubbly_chef.api.routes.recipes_ai import GenerateRequest, generate_recipe
        from bubbly_chef.services.food_exclusions import FoodExclusions
        from bubbly_chef.services.recipe_generator import AIRecipeOutput

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Noodles", description="d", ingredients=[], instructions=["cook"]
            )
        )
        repo = MagicMock()
        repo.get_all_pantry_items = AsyncMock(return_value=[])
        with (
            patch("bubbly_chef.api.deps.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.api.routes.recipes_ai.get_repository", AsyncMock(return_value=repo)),
            patch(
                "bubbly_chef.api.routes.recipes_ai.get_stored_food_exclusions",
                AsyncMock(return_value=FoodExclusions()),
            ),
            patch(
                "bubbly_chef.api.routes.recipes_ai.get_stored_expiry_priority",
                AsyncMock(return_value=level),
            ),
        ):
            await generate_recipe(GenerateRequest(prompt="noodles"), user_id="u-502")
        prompt = ai.complete.call_args.kwargs["prompt"]
        assert ("Items Expiring Soon" in prompt) == (level != "off")
