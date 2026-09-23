"""Issue #540: "do I have spinach?" is classified as pantry_update — the user
gets an add-to-pantry proposal instead of an answer.

Following the `test_issue_493_saved_recipe_lookup.py` pattern: an LLM's actual
classification isn't deterministically testable without hitting the live
model, so the disambiguation itself is checked by asserting the classifier
system prompt carries explicit stock-question examples (cooking_help) next to
contrasting pantry-mutation examples (pantry_update) — the boundary the LLM
is currently missing, per the issue.

This file currently only reproduces the bug: the prompt has no dedicated
"distinguish cooking_help from pantry_update" block and no stock-question
examples, so every assertion below fails on unfixed code.
"""

from __future__ import annotations

from bubbly_chef.prompts.router import INTENT_CLASSIFICATION_SYSTEM_PROMPT


class TestStockQuestionDisambiguationInPrompt:
    """The prompt must explicitly show the LLM both sides of the boundary:
    a stock question ("do I have spinach?") is cooking_help, not
    pantry_update, even though it names a food item like a pantry_update
    message would."""

    def test_disambiguation_block_present(self) -> None:
        assert "Distinguish cooking_help from pantry_update" in INTENT_CLASSIFICATION_SYSTEM_PROMPT

    def test_stock_question_examples_present(self) -> None:
        for phrase in (
            "do I have spinach?",
            "is there any milk left?",
            "what cheese do I have?",
        ):
            assert phrase in INTENT_CLASSIFICATION_SYSTEM_PROMPT, phrase

    def test_contrasting_pantry_update_examples_present(self) -> None:
        """The same block should show the mutation-phrased counterexamples so
        the LLM sees both sides, not just the new one."""
        for phrase in (
            "I bought spinach",
            "add 2 eggs",
            "used up the last of the milk",
        ):
            assert phrase in INTENT_CLASSIFICATION_SYSTEM_PROMPT, phrase
