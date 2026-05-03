"""Capture real Gemini responses for each canonical intent test case.

Run once (or after any prompt change) to refresh fixtures:
    cd ai-service
    BUBBLY_GEMINI_API_KEY=... python tests/capture_intent_fixtures.py

Requires a real BUBBLY_GEMINI_API_KEY. Writes results to
tests/fixtures/intent_classifications.json. Prints a unified diff if the
file already exists so you can review changes before overwriting.
"""

import asyncio
import difflib
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow running from repo root or ai-service/
sys.path.insert(0, str(Path(__file__).parent.parent))

from bubbly_chef.workflows.router import (
    INTENT_CLASSIFICATION_SYSTEM_PROMPT,
    classify_intent,
)

FIXTURES_PATH = Path(__file__).parent / "fixtures" / "intent_classifications.json"

# History injected for session-context (recipe_card) cases so classify_intent
# takes the LLM path rather than the session-mode shortcut.
_BRAINSTORM_HISTORY = [
    {"role": "user", "content": "what pasta dishes can you make me?"},
    {
        "role": "assistant",
        "content": (
            "Here are three pasta options: "
            "1. Spaghetti Carbonara, 2. Penne Arrabbiata, 3. Tagliatelle Bolognese"
        ),
    },
]

# Each entry: input text + optional state overrides + expected intent (for annotation only).
CASES: list[dict[str, Any]] = [
    # pantry_update
    {"input": "I bought milk", "expected": "pantry_update"},
    {"input": "picked up some eggs and bread today", "expected": "pantry_update"},
    {"input": "threw away the old yogurt", "expected": "pantry_update"},
    # receipt_ingest
    {"input": "I scanned a receipt", "expected": "receipt_ingest"},
    {"input": "here's my receipt from Costco", "expected": "receipt_ingest"},
    # product_ingest
    {"input": "scan this barcode", "expected": "product_ingest"},
    {"input": "look up this product", "expected": "product_ingest"},
    # recipe_ingest (URL shortcut — LLM not called, captured as-is)
    {
        "input": "save this recipe https://allrecipes.com/123",
        "expected": "recipe_ingest",
    },
    # recipe_ingest (no URL, LLM path)
    {"input": "import this recipe for me", "expected": "recipe_ingest"},
    # recipe_brainstorm
    {"input": "what can I make tonight?", "expected": "recipe_brainstorm"},
    {"input": "what should I cook with what I have?", "expected": "recipe_brainstorm"},
    {"input": "recipe ideas please", "expected": "recipe_brainstorm"},
    # recipe_generation
    {"input": "give me a pasta recipe", "expected": "recipe_generation"},
    {"input": "dinner ideas for tonight", "expected": "recipe_generation"},
    {"input": "make me something with chicken", "expected": "recipe_generation"},
    {"input": "I'm craving something spicy", "expected": "recipe_generation"},
    {"input": "quick easy meal under 30 minutes", "expected": "recipe_generation"},
    # cooking_help
    {"input": "how do I caramelise onions?", "expected": "cooking_help"},
    {"input": "how long does chicken last in the fridge?", "expected": "cooking_help"},
    {"input": "substitute for butter in baking?", "expected": "cooking_help"},
    {"input": "can I freeze cooked pasta?", "expected": "cooking_help"},
    # general_chat
    {"input": "hello, how are you?", "expected": "general_chat"},
    {"input": "what does this app do?", "expected": "general_chat"},
    # recipe_card — session-context cases: inject history, no session_mode
    {
        "input": "no cheese on that",
        "expected": "recipe_card",
        "state_overrides": {
            "session_mode": None,
            "conversation_history": _BRAINSTORM_HISTORY,
        },
    },
    {
        "input": "make it more spicy",
        "expected": "recipe_card",
        "state_overrides": {
            "session_mode": None,
            "conversation_history": _BRAINSTORM_HISTORY,
        },
    },
    {
        "input": "the second one",
        "expected": "recipe_card",
        "state_overrides": {
            "session_mode": None,
            "conversation_history": _BRAINSTORM_HISTORY,
        },
    },
]


def _prompt_hash() -> str:
    return hashlib.sha256(INTENT_CLASSIFICATION_SYSTEM_PROMPT.encode()).hexdigest()


def _base_state(input_text: str, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    state: dict[str, Any] = {
        "input_text": input_text,
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
    }
    if overrides:
        state.update(overrides)
    return state


async def _capture_all() -> dict[str, Any]:
    fixtures: dict[str, Any] = {
        "_meta": {
            "prompt_hash": _prompt_hash(),
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "model": os.getenv("BUBBLY_GEMINI_MODEL", "gemini-2.5-flash"),
        }
    }

    for case in CASES:
        text: str = case["input"]
        overrides: dict[str, Any] = case.get("state_overrides", {})  # type: ignore[assignment]
        expected: str = case["expected"]

        print(f"  {text!r:<55} → ", end="", flush=True)
        state = _base_state(text, overrides)
        result = await classify_intent(state)

        got_intent = result.get("intent", "unknown")
        confidence = result.get("intent_confidence", 0.0)
        reasoning = result.get("intent_reasoning", "")
        entities = result.get("detected_entities", [])

        status = "✓" if got_intent == expected else f"✗ (expected {expected})"
        print(f"{got_intent}  [{confidence:.2f}]  {status}")

        fixtures[text] = {
            "intent": got_intent,
            "confidence": confidence,
            "reasoning": reasoning,
            "entities": entities,
            "expected": expected,
        }

    return fixtures


def _diff(old: str, new: str) -> str:
    return "".join(
        difflib.unified_diff(
            old.splitlines(keepends=True),
            new.splitlines(keepends=True),
            fromfile="existing",
            tofile="new",
        )
    )


async def main() -> None:
    if not os.getenv("BUBBLY_GEMINI_API_KEY"):
        print("ERROR: BUBBLY_GEMINI_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    print(f"Capturing {len(CASES)} intent classifications against Gemini...\n")
    fixtures = await _capture_all()

    new_json = json.dumps(fixtures, indent=2) + "\n"

    if FIXTURES_PATH.exists():
        old_json = FIXTURES_PATH.read_text()
        delta = _diff(old_json, new_json)
        if delta:
            print("\n--- diff from existing fixtures ---")
            print(delta)
            print("-----------------------------------")
        else:
            print("\nNo changes from existing fixtures.")

    FIXTURES_PATH.write_text(new_json)
    print(f"\nWrote {FIXTURES_PATH}")
    print(f"Prompt hash: {fixtures['_meta']['prompt_hash'][:16]}...")


if __name__ == "__main__":
    asyncio.run(main())
