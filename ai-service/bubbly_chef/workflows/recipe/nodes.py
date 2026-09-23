"""
Recipe sub-graph nodes extracted from chat_ingest.py.

Contains all helpers and LangGraph node functions related to recipe
grounding: constraint extraction, pantry scoring, brainstorm, research,
and grounded recipe generation.
"""

import json as _json
import logging
import re
from datetime import date, datetime
from typing import Any

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.ai.provider import user_message_for_failure
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.domain.mealtime import meal_time_bucket
from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.domain.staples import is_staple
from bubbly_chef.domain.stock import filter_usable_pantry_rows
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.recipe import (
    Ingredient,
    IngredientAvailability,
    RecipeCard,
    RecipeCardProposal,
    RecipeConstraints,
)
from bubbly_chef.prompts.recipe import (
    BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY,
    _MODE_SYSTEM_PROMPTS,
    _RECIPE_MODE_PANTRY_LINE,
)
# Re-exported for callers that import these off this module (e.g.
# workflows/recipe/__init__.py) — `as`-aliasing makes the re-export explicit
# so mypy --strict's --no-implicit-reexport doesn't flag it.
from bubbly_chef.prompts.recipe import BRAINSTORM_SYSTEM_PROMPT as BRAINSTORM_SYSTEM_PROMPT
from bubbly_chef.prompts.recipe import (
    GROUNDED_RECIPE_SYSTEM_PROMPT as GROUNDED_RECIPE_SYSTEM_PROMPT,
)
from bubbly_chef.prompts.recipe import (
    RECIPE_CONSTRAINTS_SYSTEM_PROMPT as RECIPE_CONSTRAINTS_SYSTEM_PROMPT,
)
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.dietary_preferences import get_stored_dietary_preferences
from bubbly_chef.services.recipe_generator import generate_recipe as _generate_recipe_followup
from bubbly_chef.tools.web_search import search_recipe
from bubbly_chef.workflows.state import (
    LLMRecipeResult,
    WorkflowState,
    create_recipe_envelope,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Recipe Grounding — Cuisine Keyword Table
# =============================================================================

CUISINE_INGREDIENTS: dict[str, set[str]] = {
    "chinese": {
        "soy sauce", "ginger", "garlic", "rice", "sesame oil", "tofu",
        "bok choy", "hoisin sauce", "oyster sauce", "five spice", "scallion",
        "rice vinegar", "chili oil", "star anise", "wonton wrappers",
    },
    "italian": {
        "pasta", "olive oil", "garlic", "tomato", "basil", "parmesan",
        "mozzarella", "oregano", "prosciutto", "ricotta", "pancetta",
        "sun-dried tomato", "capers", "anchovies", "white wine",
    },
    "mexican": {
        "tortilla", "beans", "rice", "cilantro", "lime", "avocado",
        "jalapeño", "cumin", "chili powder", "salsa", "sour cream",
        "cotija cheese", "epazote", "ancho chili", "tomatillo",
    },
    "indian": {
        "cumin", "turmeric", "garam masala", "coriander", "ginger",
        "cardamom", "cloves", "mustard seeds", "curry leaves", "ghee",
        "lentils", "chickpeas", "basmati rice", "yogurt", "paneer",
    },
    "japanese": {
        "soy sauce", "mirin", "sake", "dashi", "miso", "tofu",
        "sesame", "nori", "rice vinegar", "wasabi", "panko",
        "edamame", "shiitake mushroom", "green tea",
    },
    "thai": {
        "fish sauce", "coconut milk", "lemongrass", "galangal",
        "thai basil", "kaffir lime", "chili", "shrimp paste",
        "pad thai sauce", "tamarind", "jasmine rice",
    },
    "mediterranean": {
        "olive oil", "feta", "olives", "lemon", "garlic", "hummus",
        "tahini", "chickpeas", "cucumber", "tomato", "oregano",
        "mint", "za'atar", "couscous", "pita",
    },
    "american": {
        "bacon", "cheddar", "bbq sauce", "ketchup", "mustard",
        "hot dogs", "burger", "bun", "ranch dressing", "buffalo sauce",
        "sweet potato", "cornbread", "maple syrup",
    },
    "french": {
        "butter", "cream", "dijon mustard", "thyme", "rosemary",
        "tarragon", "shallot", "white wine", "brie", "gruyere",
        "baguette", "cognac", "herbes de provence",
    },
    "korean": {
        "gochujang", "kimchi", "sesame oil", "soy sauce", "doenjang",
        "rice wine", "scallion", "garlic", "ginger", "napa cabbage",
        "rice", "sesame seeds", "daikon", "perilla",
    },
}


# =============================================================================
# Recipe Grounding — Helpers
# =============================================================================


def _format_pantry_item_for_prompt(item: dict[str, Any]) -> str:
    """Format a pantry item for the recipe grounding prompt.

    Includes base unit quantities when available so the LLM can reason
    about ingredient sufficiency.

    Examples:
        {"name": "eggs", "quantity": 1, "unit": "dozen", "quantity_base": 12, "unit_base": "count"}
        -> "eggs (1 dozen = 12.0 count)"

        {"name": "milk", "quantity": 2, "unit": "cup", "quantity_base": None}
        -> "milk (2 cup)"
    """
    name = str(item.get("name", ""))
    qty = item.get("quantity", "")
    unit = item.get("unit", "")
    display = f"{qty} {unit}".strip() if (qty or unit) else ""

    qty_base = item.get("quantity_base")
    unit_base = item.get("unit_base")
    if qty_base is not None and unit_base:
        return f"{name} ({display} = {float(qty_base):.1f} {unit_base})" if display else f"{name} ({float(qty_base):.1f} {unit_base})"
    return f"{name} ({display})" if display else name


def is_recipe_generation_request(state: WorkflowState) -> bool:
    """Distinguish 'what can I make?' from 'how long do I bake chicken?'"""
    # In recipe mode, always generate a recipe
    if state.get("input_mode") == "recipe":
        return True

    text_lower = state.get("input_text", "").lower()
    generation_keywords = [
        "what can i make",
        "what can i cook",
        "what should i make",
        "dinner idea",
        "lunch idea",
        "meal idea",
        "recipe for",
        "suggest a meal",
        "recipes with",
        "with what i have",
        "what's for dinner",
        "i'm feeling",
        "in the mood for",
        "surprise me",
        "what to cook",
        "make for dinner",
        "make for lunch",
        "under 30",
        "under 20",
        "under 15",
        "quick dinner",
        "quick lunch",
        "quick meal",
        "fast dinner",
        "fast meal",
        "easy dinner",
        "easy meal",
        "simple dinner",
        "simple meal",
        "healthy dinner",
        "healthy meal",
        "make me",
        "cook me",
        "something to eat",
        "what to make",
    ]
    return any(kw in text_lower for kw in generation_keywords)


def detect_brainstorm_followup(state: WorkflowState) -> bool:
    """Return True if the last assistant message had intent=recipe_brainstorm."""
    history: list[dict[str, Any]] = state.get("conversation_history") or []
    if not history:
        return False
    for turn in reversed(history):
        if turn.get("role") == "assistant":
            return turn.get("intent") == Intent.RECIPE_BRAINSTORM.value
    return False


# Word-boundary containment — a keyword/phrase must appear as a whole word (or
# whole phrase) in the text, never as a bare substring (e.g. "any" inside
# "many", "one" inside "someone"). #436 finding 1: the old `kw in text_lower`
# checks let "how many eggs do I need" match "any" and misfire a re-pick.
def _has_word(text_lower: str, phrase: str) -> bool:
    return re.search(r"\b" + re.escape(phrase) + r"\b", text_lower) is not None


# Pantry-update indicator words — mirrors the vocabulary the intent
# classifier prompt itself uses to detect pantry_update ("bought", "got",
# "purchased", "used", "consumed", "threw away", "add", "remove"). A message
# using this vocabulary is describing groceries, not selecting a brainstormed
# dish, even when a stored idea's name happens to appear in it as a literal
# substring (#436 finding 1: "add tomato soup to my pantry" and "I bought
# chicken curry paste" both fuzzy-match a stored idea at ~100 but are pantry
# statements, not picks). Erring toward excluding is safe: it only skips the
# repick shortcut, falling through to the LLM classifier rather than
# mis-selecting.
_PANTRY_UPDATE_WORDS = {
    "bought", "buy", "buying", "got", "purchased", "purchase",
    "used", "consumed", "add", "adding", "remove", "removing", "removed",
}
_PANTRY_UPDATE_PHRASES = {"threw away", "ran out"}


def _looks_like_pantry_update(text_lower: str) -> bool:
    return any(_has_word(text_lower, w) for w in _PANTRY_UPDATE_WORDS) or any(
        p in text_lower for p in _PANTRY_UPDATE_PHRASES
    )


# Modification-intent indicator words — words that signal the user wants to
# CHANGE the current dish rather than switch to a different offered idea.
# These comparative adjectives and modification verbs are clear enough to
# block a name-only re-pick under a pin (e.g. "make the Pesto Pasta one
# spicier" → modification, not a switch to Pesto Pasta from a different pin).
# Erring toward excluding is safe: it only skips the re-pick shortcut, falling
# through to the LLM classifier rather than mis-categorizing a modification as
# a dish switch.
#
# Comparatives — two-part approach to avoid false-positive food nouns:
#
# 1. -ier suffix regex: almost no food names end -ier, so a wildcard is safe.
#    Minimum 4 root chars (total word >= 7) avoids "tier", "pier".
#    Catches: spicier, creamier, gooier, zestier, smokier, crispier, saltier…
_MODIFICATION_COMPARATIVE_IER_RE = re.compile(r"\b\w{4,}ier\b")
#
# 2. Explicit -er comparatives: we can't wildcard -er because common food
#    nouns end -er (burger, butter, pepper, lobster, cheeseburger, chowder…).
#    Keep only adjectives that are unambiguously comparative in cooking context.
_MODIFICATION_COMPARATIVE_ER = {
    "sweeter", "hotter", "milder", "richer", "softer",
    "thicker", "warmer", "cooler", "drier", "lighter",
    "heavier", "stronger",
}
_MODIFICATION_WORDS = {
    "without", "substitute", "swap", "replace", "tweak",
    "adjust", "change",
}
_MODIFICATION_PHRASES = {"make it", "make this"}


def _looks_like_modification(text_lower: str) -> bool:
    """True when the text is clearly a request to modify an attribute of the
    current dish — not a switch to a different offered idea."""
    if _MODIFICATION_COMPARATIVE_IER_RE.search(text_lower):
        return True
    if any(_has_word(text_lower, w) for w in _MODIFICATION_COMPARATIVE_ER):
        return True
    if any(_has_word(text_lower, w) for w in _MODIFICATION_WORDS):
        return True
    if any(phrase in text_lower for phrase in _MODIFICATION_PHRASES):
        return True
    if _has_word(text_lower, "less") or _has_word(text_lower, "more"):
        return True
    return False


def extract_selected_recipe(
    user_text: str,
    history: list[dict[str, Any]],
    stored_ideas: list[str] | None = None,
) -> str | None:
    """Extract which recipe the user selected from the last brainstorm response.

    Returns the matched recipe name, or None when the message is a conversational
    follow-up (informational question), an unrelated statement that merely
    mentions an idea's name (e.g. "add tomato soup to my pantry"), rather than
    an actual selection.

    `stored_ideas` is the retained brainstorm set from the session (Q6). When the
    conversation history has been truncated and carries no **bold** idea names,
    the stored set is used as the candidate list so a re-pick still resolves
    without regeneration.
    """
    from rapidfuzz import fuzz  # local import — optional dep already in pyproject.toml

    brainstorm_text = ""
    for turn in reversed(history):
        if turn.get("role") == "assistant" and turn.get("intent") == Intent.RECIPE_BRAINSTORM.value:
            brainstorm_text = turn.get("content", "")
            break

    # Extract **bold** recipe names from brainstorm
    ideas: list[str] = re.findall(r"\*\*(.+?)\*\*", brainstorm_text)

    # Q6 fallback: history had no bold idea names (e.g. truncated history) —
    # resolve against the retained session set instead so a re-pick still works.
    if not ideas and stored_ideas:
        ideas = list(stored_ideas)

    text_lower = user_text.lower()

    # Guard: informational follow-ups are NOT selections.
    # If the text sounds like a question/elaboration request AND doesn't contain
    # an ordinal/selection word, treat it as a conversational follow-up.
    informational_phrases = {
        "tell me more",
        "more info",
        "more about",
        "explain",
        "what's in",
        "whats in",
        "how do i make",
        "how do you make",
        "what are",
        "details",
    }
    # Unambiguous ordinals ("the first", "2nd one") only. Bare cardinals
    # ("one"/"two"/...) are deliberately NOT here: "the porridge one" is a name
    # selection, not a request for idea index 0 (issue #442). They rejoin the
    # matcher only as a last-resort fallback below, after name matching fails.
    selection_words = {
        "first", "second", "third", "fourth",
        "1st", "2nd", "3rd", "4th",
    }
    # Multi-word/unambiguous quick-pick phrases only — a bare "any" or
    # "random" is too generic a word to ever safely stand for "pick one for
    # me" (#436 finding 1: "is any of this gluten free" is not a pick).
    quick_pick_phrases = {"surprise me", "any of them", "pick any", "you pick", "all of them"}
    has_informational = any(phrase in text_lower for phrase in informational_phrases)
    # A bare cardinal ("number one") also counts as a selection cue for the
    # informational guard, so "what's in idea one?" still resolves rather than
    # bailing — the cardinal only loses to a name match, it is not ignored.
    _cardinal_words = {"one", "two", "three", "four"}
    has_selection = (
        any(_has_word(text_lower, word) for word in selection_words)
        or any(_has_word(text_lower, word) for word in _cardinal_words)
        or any(phrase in text_lower for phrase in quick_pick_phrases)
    )
    if has_informational and not has_selection:
        return None

    if not ideas:
        return None  # no brainstorm context to match against

    # 1. Explicit ordinals win — unambiguous positional reference.
    ordinal_map = {
        "first": 0, "second": 1, "third": 2, "fourth": 3,
        "1st": 0, "2nd": 1, "3rd": 2, "4th": 3,
    }
    for word, idx in ordinal_map.items():
        if _has_word(text_lower, word) and idx < len(ideas):
            return ideas[idx]

    if any(phrase in text_lower for phrase in quick_pick_phrases):
        return ideas[0]

    # 2. Whole-phrase fuzzy match — high bar, catches when the user typed most
    #    of the idea name ("I want pasta primavera", "beef tacos sound great").
    #    Excluded when the message reads as a pantry statement rather than a
    #    pick (#436 finding 1).
    best_match = max(ideas, key=lambda idea: fuzz.partial_ratio(text_lower, idea.lower()))
    if (
        fuzz.partial_ratio(text_lower, best_match.lower()) >= 80
        and not _looks_like_pantry_update(text_lower)
    ):
        return best_match

    # 3. Distinctive-word match — a name buried in filler ("the tacos one
    #    instead", "show me the porridge one") dilutes the whole-phrase score
    #    below the bar, but a distinctive content word of the idea still names
    #    it unambiguously. Match when exactly ONE idea shares a content word
    #    (>=4 chars, not a generic food/filler word) with the text; ambiguous
    #    overlaps (two ideas both matching) fall through rather than guess (#442).
    _GENERIC = {
        "recipe", "dish", "bowl", "plate", "style", "quick", "easy",
        "fresh", "creamy", "savory", "sweet", "spicy", "with", "over",
    }
    text_words = set(re.findall(r"\b\w{4,}\b", text_lower))
    name_hits = [
        idea
        for idea in ideas
        if {
            w for w in re.findall(r"\b\w{4,}\b", idea.lower()) if w not in _GENERIC
        }
        & text_words
    ]
    if len(name_hits) == 1 and not _looks_like_pantry_update(text_lower):
        return name_hits[0]

    # 4. Bare-cardinal fallback, last: only when no name matched does "give me
    #    number two" mean an index. Word-boundary so "the <name> one" handled
    #    above never reaches here for idx 0.
    cardinal_map = {"one": 0, "two": 1, "three": 2, "four": 3}
    for word, idx in cardinal_map.items():
        if _has_word(text_lower, word) and idx < len(ideas):
            return ideas[idx]

    return None


def extract_selected_recipe_by_name(
    user_text: str,
    history: list[dict[str, Any]],
    stored_ideas: list[str] | None = None,
    picked_title: str | None = None,
) -> str | None:
    """Name-match-only variant of extract_selected_recipe.

    Runs ONLY the two name-based passes (whole-phrase fuzzy >=80 and
    single-hit distinctive-word overlap) — positional passes (ordinal_map,
    quick_pick_phrases, bare-cardinal fallback) are deliberately excluded.

    This is used when a recipe is already pinned: a bare ordinal or cardinal
    ("the first one", "number two") is too weak to override a pin and is
    ambiguous with modification intent.  Only a distinctive-name reference may
    trigger a switch to a different already-offered idea.

    `picked_title` — the title of the currently-pinned recipe. When provided,
    Pass 1 returns None if the pinned dish scores within 10 fuzzy points of the
    winner (near-tie = ambiguous; fall through to LLM).  Pass 2 returns None if
    the pinned dish shares any of the same decisive distinctive tokens as the
    winner (shared token = ambiguous).  This prevents a sibling idea that shares
    a token with the pinned dish from being silently substituted for it.

    Returns the matched idea name, or None when positional, informational,
    a pantry or modification statement, ambiguous with the pinned dish, or
    unresolvable.

    The caller still checks that the resolved name differs from the currently-
    picked recipe as a second belt.
    """
    from rapidfuzz import fuzz  # local import — optional dep already in pyproject.toml

    brainstorm_text = ""
    for turn in reversed(history):
        if turn.get("role") == "assistant" and turn.get("intent") == Intent.RECIPE_BRAINSTORM.value:
            brainstorm_text = turn.get("content", "")
            break

    ideas: list[str] = re.findall(r"\*\*(.+?)\*\*", brainstorm_text)
    if not ideas and stored_ideas:
        ideas = list(stored_ideas)

    if not ideas:
        return None

    text_lower = user_text.lower()

    # Informational guard (identical to the full function): if it reads as an
    # elaboration request and carries no selection cue, it is not a pick.
    informational_phrases = {
        "tell me more",
        "more info",
        "more about",
        "explain",
        "what's in",
        "whats in",
        "how do i make",
        "how do you make",
        "what are",
        "details",
    }
    # For the informational guard we deliberately do NOT include cardinals here:
    # a bare cardinal alone does NOT constitute a name match, and if the guard
    # would fire we want it to fire (return None) rather than a cardinal
    # rescuing a name match that doesn't exist.
    selection_words = {
        "first", "second", "third", "fourth",
        "1st", "2nd", "3rd", "4th",
    }
    has_informational = any(phrase in text_lower for phrase in informational_phrases)
    has_selection = any(_has_word(text_lower, word) for word in selection_words)
    if has_informational and not has_selection:
        return None

    _GENERIC = {
        "recipe", "dish", "bowl", "plate", "style", "quick", "easy",
        "fresh", "creamy", "savory", "sweet", "spicy", "with", "over",
    }

    # Pass 1: Whole-phrase fuzzy match (threshold >=80, pantry-update guard,
    # modification-intent guard, near-tie-with-pinned guard).
    best_match = max(ideas, key=lambda idea: fuzz.partial_ratio(text_lower, idea.lower()))
    winner_score = fuzz.partial_ratio(text_lower, best_match.lower())
    if (
        winner_score >= 80
        and not _looks_like_pantry_update(text_lower)
        and not _looks_like_modification(text_lower)
    ):
        # Ambiguity guard: if the pinned dish scores within 10 of the winner it
        # is a near-tie — the user may mean the pinned dish, not the sibling.
        # Return None so the LLM resolves the ambiguity rather than silently
        # switching to the wrong idea.
        if picked_title:
            pinned_score = fuzz.partial_ratio(text_lower, picked_title.lower())
            if pinned_score >= winner_score - 10:
                return None
        return best_match

    # Pass 2: Distinctive-word overlap (single-hit, pantry-update guard,
    # modification-intent guard, shared-token-with-pinned guard).
    text_words = set(re.findall(r"\b\w{4,}\b", text_lower))
    name_hits = [
        idea
        for idea in ideas
        if {
            w for w in re.findall(r"\b\w{4,}\b", idea.lower()) if w not in _GENERIC
        }
        & text_words
    ]
    if (
        len(name_hits) == 1
        and not _looks_like_pantry_update(text_lower)
        and not _looks_like_modification(text_lower)
    ):
        # Ambiguity guard: if the pinned dish shares any of the same decisive
        # non-generic tokens that caused the single hit, the match is ambiguous
        # (the user may be referring to the pinned dish, not the sibling).
        if picked_title:
            winning_tokens = {
                w for w in re.findall(r"\b\w{4,}\b", name_hits[0].lower())
                if w not in _GENERIC
            } & text_words
            pinned_tokens = {
                w for w in re.findall(r"\b\w{4,}\b", picked_title.lower())
                if w not in _GENERIC
            }
            if winning_tokens & pinned_tokens:
                return None
        return name_hits[0]

    return None


def score_and_rank(
    pantry_items: list[dict[str, Any]],
    constraints: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Deterministically score and rank pantry items for recipe grounding.

    Scoring:
    - item in must_use_ingredients: +20 (also tagged `_must_use`)
    - days_until_expiry <= 3: +4
    - days_until_expiry <= 7: +2
    - item in preferred_ingredients: +5
    - item name matches cuisine keywords: +3
    - item in excluded_ingredients: -100

    Expiry is now a tiebreaker, not the dominant axis. A strong cuisine +
    preference match (3 + 5 = 8) outranks a bare expiring item with no fit
    (4), aligning the ranking with the softened prompt wording from #288/#336.
    Must-use (20) still dominates everything; within the must-use group,
    expiry urgency still orders items.
    """
    cuisine = (constraints.get("cuisine") or "").lower()
    preferred = {p.lower() for p in (constraints.get("preferred_ingredients") or [])}
    excluded = {e.lower() for e in (constraints.get("excluded_ingredients") or [])}
    must_use = {m.lower() for m in (constraints.get("must_use_ingredients") or [])}
    cuisine_keywords = CUISINE_INGREDIENTS.get(cuisine, set())

    today = date.today()
    scored = []

    for item in pantry_items:
        name_lower = (item.get("name") or "").lower()
        score = 0.0
        is_expired = False

        # "Use up my X" — dominates expiry so the named ingredient leads the list
        is_must_use = any(m in name_lower or name_lower in m for m in must_use)
        if is_must_use:
            score += 20

        # Expiry urgency  # TODO(#395): Off=skip this block entirely; Aggressive=raise weights (+8/+5 instead of +4/+2)
        expiry_str = item.get("expiry_date")
        if expiry_str:
            try:
                expiry = date.fromisoformat(str(expiry_str))
                days_left = (expiry - today).days
                # `days_left` goes negative once an item is past its date, so an
                # unbounded `<= 3` also matched food that expired weeks ago and
                # handed it to the LLM as a priority ingredient to cook tonight
                # (#239). Expired stock scores neutral: still available to the
                # model as context, never promoted as "use this first".
                if days_left < 0:
                    is_expired = True
                elif days_left <= 3:
                    score += 4
                elif days_left <= 7:
                    score += 2
            except (ValueError, TypeError):
                pass

        # Cuisine match
        if cuisine_keywords and any(kw in name_lower for kw in cuisine_keywords):
            score += 3

        # User preference
        if any(p in name_lower or name_lower in p for p in preferred):
            score += 5

        # Exclusion
        if any(e in name_lower or name_lower in e for e in excluded):
            score -= 100

        scored.append(
            {**item, "_score": score, "_must_use": is_must_use, "_expired": is_expired}
        )

    scored.sort(key=lambda x: x.get("_score", 0), reverse=True)
    # Filter out excluded items (negative score)
    scored = [s for s in scored if s.get("_score", 0) >= 0]
    return scored[:15]


def _days_until_expiry(item: dict[str, Any]) -> int | None:
    """Return days from today to item's expiry_date, or None if no date."""
    expiry_str = item.get("expiry_date")
    if not expiry_str:
        return None
    try:
        return (date.fromisoformat(str(expiry_str)) - date.today()).days
    except (ValueError, TypeError):
        return None


# =============================================================================
# Recipe Grounding — Workflow Nodes
# =============================================================================


def is_pantry_grounded(constraints: dict[str, Any] | None) -> bool:
    """Whether pantry grounding is on for this turn.

    Only an explicit False turns it off. None means the user never said either
    way, so grounding stays on — the default the app has always had.
    """
    return (constraints or {}).get("use_pantry") is not False


def _default_meal_type() -> str:
    """Infer meal type from current time of day.

    Delegates to `domain/mealtime.py` — the single shared hour-to-bucket rule,
    also used by the dashboard suggestion ranking. See that module's docstring
    for why there must be exactly one such rule.
    """
    return meal_time_bucket(datetime.now().hour)


def _merge_constraints(
    prior: dict[str, Any],
    fresh: dict[str, Any],
) -> dict[str, Any]:
    """Merge freshly-extracted constraints with the prior turn's constraints.

    Rules (implement "inherit + override"):
    - Scalar fields (cuisine, mood, meal_type, max_time_minutes, servings,
      skill_level): fresh value wins when non-None/non-empty; otherwise
      inherit prior.
    - List fields (dietary, preferred_ingredients, excluded_ingredients):
      fresh list wins when non-empty; otherwise inherit prior.
    - must_use_ingredients: fresh list wins when non-empty; otherwise inherit
      prior. This ensures dietary restrictions AND must-use ingredients both
      survive a follow-up turn that doesn't repeat them.
    - use_pantry: tri-state. A fresh True or False wins; None means the user said
      nothing this turn, so the prior choice stands. Without this a user who said
      "don't look at my pantry" got the pantry back on their very next message
      (#287).
    """
    merged: dict[str, Any] = dict(prior)

    scalar_keys = ("cuisine", "mood", "meal_type", "max_time_minutes", "servings", "skill_level")
    list_keys = (
        "dietary",
        "preferred_ingredients",
        "excluded_ingredients",
        "must_use_ingredients",
    )

    for key in scalar_keys:
        fresh_val = fresh.get(key)
        if fresh_val is not None and fresh_val != "":
            merged[key] = fresh_val

    for key in list_keys:
        fresh_list = fresh.get(key) or []
        if fresh_list:
            merged[key] = fresh_list
        # else: keep prior value (already in merged)

    # Tri-state, so it cannot use the scalar rule above: False is a real choice
    # the user made, and only None means "no opinion this turn".
    fresh_use_pantry = fresh.get("use_pantry")
    if fresh_use_pantry is not None:
        merged["use_pantry"] = fresh_use_pantry

    return merged


# Deterministic dietary-contradiction table (#394). A stored preference now
# *combines* with whatever the message asks for rather than being replaced by
# it — it's only set aside, for that one reply, when the message unambiguously
# asks for an ingredient the stored diet forbids. Small and explicit on
# purpose: an LLM judgement call here would make the precedence unpredictable
# turn to turn.
_DIETARY_FORBIDDEN_INGREDIENTS: dict[str, frozenset[str]] = {
    "vegetarian": frozenset(
        {
            "meat", "beef", "pork", "chicken", "turkey", "lamb", "bacon",
            "sausage", "ham", "fish", "shrimp", "salmon", "tuna", "seafood",
        }
    ),
    "vegan": frozenset(
        {
            "meat", "beef", "pork", "chicken", "turkey", "lamb", "bacon",
            "sausage", "ham", "fish", "shrimp", "salmon", "tuna", "seafood",
            "dairy", "cheese", "milk", "butter", "cream", "yogurt",
            "egg", "eggs", "honey",
        }
    ),
    "pescatarian": frozenset(
        {"meat", "beef", "pork", "chicken", "turkey", "lamb", "bacon", "sausage", "ham"}
    ),
    "dairy-free": frozenset({"dairy", "cheese", "milk", "butter", "cream", "yogurt"}),
    "nut-free": frozenset(
        {
            "nuts", "peanut", "peanuts", "almond", "almonds", "cashew", "cashews",
            "walnut", "walnuts", "pecan", "pecans", "pistachio", "pistachios",
            "hazelnut", "hazelnuts",
        }
    ),
}

# A diet named on the left already satisfies every diet in its set — so when
# both appear together in a combined list, the looser one is redundant and is
# dropped rather than kept alongside it (e.g. a combined ["Vegan", "Vegetarian"]
# collapses to ["Vegan"], regardless of which side — stored or message —
# each label came from).
_DIETARY_SUBSUMES: dict[str, frozenset[str]] = {
    "vegan": frozenset({"vegetarian", "dairy-free"}),
}


def _dietary_contradicted(label: str, haystack: str) -> bool:
    """True if `haystack` names an ingredient the dietary label `label` forbids."""
    forbidden = _DIETARY_FORBIDDEN_INGREDIENTS.get(label.strip().lower(), frozenset())
    return any(re.search(rf"\b{re.escape(term)}\b", haystack) for term in forbidden)


def _drop_redundant_dietary(labels: list[str]) -> list[str]:
    """Drop any label a stricter label already subsumes, preserving order."""
    present = {label.strip().lower() for label in labels}
    result: list[str] = []
    for label in labels:
        key = label.strip().lower()
        subsumed = any(
            key in narrower and broad in present and broad != key
            for broad, narrower in _DIETARY_SUBSUMES.items()
        )
        if not subsumed:
            result.append(label)
    return result


def _combine_dietary_preferences(
    stored: list[str],
    requested: list[str],
    constraints: dict[str, Any],
    input_text: str,
) -> list[str]:
    """Union a stored dietary default with what this message asks for (#394).

    A stored preference stays in force unless the message names an ingredient
    it forbids — checked against both the raw message text and the extracted
    ingredient fields, since the constraint extractor may fold a request like
    "chicken curry" into a dish name rather than into `must_use_ingredients`.
    A requested label already implied by a surviving stricter label (see
    `_DIETARY_SUBSUMES`) is dropped as redundant rather than appended.
    """
    ingredient_terms = " ".join(
        [*(constraints.get("must_use_ingredients") or []), *(constraints.get("preferred_ingredients") or [])]
    )
    haystack = f"{input_text} {ingredient_terms}".lower()

    survivors: list[str] = []
    for label in stored:
        if _dietary_contradicted(label, haystack):
            logger.info(
                "Stored dietary preference %r set aside for this reply "
                "(message names a forbidden ingredient)",
                label,
            )
            continue
        survivors.append(label)

    combined = list(survivors)
    present_lower = {label.strip().lower() for label in combined}
    for label in requested:
        if label.strip().lower() not in present_lower:
            combined.append(label)
            present_lower.add(label.strip().lower())

    return _drop_redundant_dietary(combined)


def _prior_constraints_from_state(state: WorkflowState) -> dict[str, Any] | None:
    """Return recipe_constraints stored in the session metadata, if any."""
    session = state.get("session")
    if not isinstance(session, dict):
        return None
    metadata = session.get("metadata")
    if not isinstance(metadata, dict):
        return None
    prior = metadata.get("recipe_constraints")
    return prior if isinstance(prior, dict) else None


async def extract_recipe_constraints(state: WorkflowState) -> WorkflowState:
    """Node: Extract recipe constraints from user message via structured LLM call.

    On follow-up turns (e.g. user selects a brainstorm idea or refines a recipe),
    the newly-extracted constraints are merged with any constraints persisted in
    the session from the previous turn.  Fresh values override; fields that the
    user didn't re-mention inherit from the prior turn (#144).
    """
    input_text = state.get("input_text", "")
    ai_manager = get_ai_manager()
    logger.info("Extracting recipe constraints", extra={"message_preview": input_text[:80]})

    try:
        result = await ai_manager.complete(
            prompt=RECIPE_CONSTRAINTS_SYSTEM_PROMPT + "\n\nUser message: " + input_text,
            response_schema=RecipeConstraints,
            temperature=0.1,
        )
        if isinstance(result, RecipeConstraints):
            constraints: dict[str, Any] = result.model_dump()
        else:
            constraints = {}
    except Exception as e:
        logger.warning("Constraint extraction failed (using empty constraints): %s", e)
        constraints = {}

    # Merge with prior constraints from the session (inherit + override).
    prior = _prior_constraints_from_state(state)
    if prior:
        constraints = _merge_constraints(prior, constraints)
        logger.info(
            "Merged prior session constraints into fresh extraction "
            "(dietary=%s, must_use=%s, use_pantry=%s)",
            constraints.get("dietary"),
            constraints.get("must_use_ingredients"),
            constraints.get("use_pantry"),
        )

    # Default meal_type from time of day when user didn't specify
    if not constraints.get("meal_type"):
        constraints["meal_type"] = _default_meal_type()
        logger.info("Defaulted meal_type=%s from time of day", constraints["meal_type"])

    # Stored profile default (#394). A stored preference stays in force and
    # *combines* with whatever this message (or an earlier turn in the same
    # session, already folded in above by `_merge_constraints`) asks for. It
    # is only set aside — for this one reply — when the message explicitly
    # asks for an ingredient the stored diet forbids (see
    # `_combine_dietary_preferences`). It must never be silently dropped just
    # because this message didn't repeat it.
    stored_dietary = await get_stored_dietary_preferences(state.get("user_id") or "")
    if stored_dietary:
        requested_dietary = constraints.get("dietary") or []
        combined_dietary = _combine_dietary_preferences(
            stored_dietary, requested_dietary, constraints, input_text
        )
        if combined_dietary != requested_dietary:
            logger.info(
                "Combined stored dietary preferences with this turn's request: "
                "stored=%s requested=%s -> %s",
                stored_dietary,
                requested_dietary,
                combined_dietary,
            )
        constraints["dietary"] = combined_dietary

    return {
        **state,
        "recipe_constraints": constraints,
    }


async def score_pantry_ingredients(state: WorkflowState) -> WorkflowState:
    """Node: Score and rank pantry items by expiry urgency + constraint match."""
    pantry_items: list[dict[str, Any]] = state.get("pantry_snapshot") or []
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    logger.info("Scoring pantry ingredients", extra={"constraints": constraints})

    # The user asked us not to use their pantry. Return nothing rather than
    # scoring and letting a downstream node decide: an empty list means no
    # prompt-builder can reach for the stock even by accident (#287).
    if not is_pantry_grounded(constraints):
        logger.info("Pantry grounding is off for this turn; skipping scoring")
        return {**state, "scored_pantry_items": []}

    # Fetch from DB if no snapshot was passed in
    if not pantry_items:
        try:
            repo = await get_repository()
            db_items = await repo.get_all_pantry_items(state.get("user_id", ""))
            pantry_items = [it.model_dump(mode="json") for it in db_items]
        except Exception as e:
            logger.warning("Could not fetch pantry for scoring: %s", e)

    # Expired and zero-quantity rows are not stock: they never enter the
    # ranked pool, so no prompt-builder downstream can list them as available
    # (#443). Rows expiring today or later stay in and still get the urgency
    # bonus in score_and_rank.
    scored = score_and_rank(filter_usable_pantry_rows(pantry_items), constraints)

    return {
        **state,
        "scored_pantry_items": scored,
    }


def _get_mode_prefix(state: WorkflowState, *, pantry_grounded: bool = True) -> str:
    """Return the system prompt prefix for the current chat mode."""
    mode = state.get("input_mode", "chat")
    prefix = _MODE_SYSTEM_PROMPTS.get(mode, "")
    if not pantry_grounded:
        prefix = prefix.replace(_RECIPE_MODE_PANTRY_LINE, "")
    return prefix


def _format_history_context(state: WorkflowState, max_turns: int = 40) -> str:
    """Format recent conversation history for injection into LLM prompts.

    #384: raised from 10 (~5 exchanges) to 40 (~20 exchanges) — matches
    chat/nodes.py::format_history_context and SupabaseRepository.get_history's
    default fetch window, so recipe-mode conversations get the same context
    budget as plain chat.
    """
    history: list[dict[str, str]] = state.get("conversation_history") or []
    if not history:
        return ""
    recent = history[-max_turns:]
    lines = ["Previous conversation:"]
    for turn in recent:
        role = turn.get("role", "user").capitalize()
        content = turn.get("content", "").strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines) + "\n\n"


async def brainstorm_recipe_ideas(state: WorkflowState) -> WorkflowState:
    """Node: Generate 3-4 recipe ideas based on pantry + constraints."""
    input_text = state.get("input_text", "")
    scored_items: list[dict[str, Any]] = state.get("scored_pantry_items") or []
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    pantry_grounded = is_pantry_grounded(constraints)

    # Fall back to the time of day, same as the recipe-generate path does at
    # `extract_recipe_constraints`. Without this the brainstorm prompt says only
    # "if meal_type is specified" and the model picks freely — which produced
    # breakfast suggestions at midnight (#248).
    if not constraints.get("meal_type"):
        constraints = {**constraints, "meal_type": _default_meal_type()}

    # Build ingredient summary for the prompt
    if not pantry_grounded:
        # No pantry block at all — not an empty one. "No pantry items available"
        # would still invite the model to talk about the pantry.
        pantry_context = ""
    elif scored_items:
        # Expired stock is dropped from the suggestion pool entirely (#239):
        # scoring no longer promotes it, but leaving it under "Other available"
        # still let the model build a dish around two-week-old spinach — and on
        # a real pantry (29 of 49 items expired) it crowded out good ingredients.
        # Zero-quantity rows (cooked down by the cook flow, never deleted) go
        # the same way (#443). The filter is repeated here even though
        # score_pantry_ingredients already applies it, so pre-scored state can't
        # smuggle a dead row back in. A must-use item the user named still
        # binds the ideas through constraints_str below, so dropping its
        # expired/empty pantry row costs nothing — the request survives, the
        # false "you have this" claim does not.
        # Partition requires expiry_date to be present on scored items
        # (score_and_rank spreads {**item, ...} so original fields are preserved).
        usable_items = filter_usable_pantry_rows(scored_items)
        must_use = [i for i in usable_items if i.get("_must_use")]
        rest = [
            i for i in usable_items if not i.get("_must_use") and not i.get("_expired")
        ]
        expiring = [
            i for i in rest
            if (d := _days_until_expiry(i)) is not None and 0 <= d <= 7
        ]
        supporting = [i for i in rest if i not in expiring]
        expiring_str = ", ".join(i.get("name", "") for i in expiring[:5])
        supporting_str = ", ".join(i.get("name", "") for i in supporting[:10])
        pantry_context = ""
        if must_use:
            must_use_str = ", ".join(i.get("name", "") for i in must_use[:5])
            pantry_context += f"\nMust use (the user asked to cook with these): {must_use_str}"
        pantry_context += f"\nExpiring soon (weave in where it fits, not mandatory): {expiring_str or 'none'}"  # TODO(#395): suppress entirely when expiry_priority==Off; strengthen label when Aggressive
        pantry_context += f"\nOther available: {supporting_str or 'none'}"
    elif not constraints.get("must_use_ingredients"):
        # Reaching this branch means pantry_grounded is True, scored_items is
        # empty, AND the user has not named any specific ingredients to cook with.
        # Don't invent recipes — surface the three ingest paths so the user
        # can stock up first.
        #
        # When must_use_ingredients is set the user explicitly named what they
        # want to cook with, so we fall through to normal LLM generation even
        # though the pantry is empty (#265 regression fix).
        #
        # NOTE (known limitation): score_pantry_ingredients sets scored_pantry_items=[]
        # when the DB fetch raises an exception, so a transient Supabase error on a
        # stocked pantry will also trigger this branch — a confidently-wrong message.
        # That failure mode is pre-existing and tracked separately from #243.
        logger.info("Empty pantry with grounding on — returning ingest prompt (#243)")
        ingest_message = (
            "Your pantry is empty right now, so I don't want to just make something up! "
            "Here's how to stock it up so I can suggest recipes made from what you actually have:\n\n"
            "1. **Scan a receipt** — the fastest way! Head to the pantry page and tap "
            "\"Add items\" → \"Scan receipt\" (or go to `/pantry?add=scan`). "
            "Snap a photo of any grocery receipt and I'll parse everything in seconds.\n\n"
            "2. **Type items manually** — same sheet, \"Type\" tab. "
            "Just type item names and quantities at your own pace.\n\n"
            "3. **Tell me right here** — type something like \"I just bought milk, "
            "eggs, and cheddar\" and I'll add them to your pantry for you!\n\n"
            "Once you've got a few things in there, ask me again and I'll suggest "
            "recipes tailored to what you have."
        )
        # Use GENERAL_CHAT intent so update_session_node leaves the session in
        # DEFAULT mode. RECIPE_BRAINSTORM would flip to RECIPE_EXPLORING and
        # persist brainstorm_ideas=[] — a follow-up "the first one" then routes
        # as a brainstorm selection with no ideas to pick from (#243).
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": ingest_message,
            "brainstorm_ideas": [],
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
            "suggested_action": NextAction.NONE.value,
        }
    else:
        # pantry_grounded=True, scored_items=[], must_use_ingredients set.
        # The user named specific ingredients — let the LLM generate around them.
        # No pantry items to list; constraints_str below will inject Must use:.
        pantry_context = ""

    constraints_str = ""
    # Named ingredients that aren't in the pantry still bind the suggestions.
    if constraints.get("must_use_ingredients"):
        constraints_str += (
            f"\nMust use: {', '.join(constraints['must_use_ingredients'])}"
            " — every suggestion has to include these"
        )
    if constraints.get("meal_type"):
        constraints_str += f"\nMeal type: {constraints['meal_type']}"
    if constraints.get("cuisine"):
        constraints_str += f"\nCuisine preference: {constraints['cuisine']}"
    if constraints.get("mood"):
        constraints_str += f"\nMood/style: {constraints['mood']}"
    if constraints.get("dietary"):
        constraints_str += f"\nDietary: {', '.join(constraints['dietary'])}"
    if constraints.get("max_time_minutes"):
        constraints_str += f"\nMax time: {constraints['max_time_minutes']} minutes"
    if constraints.get("preferred_ingredients"):
        constraints_str += (
            f"\nPreferred flavors/ingredients (include if sensible): "
            f"{', '.join(constraints['preferred_ingredients'])}"
        )
    if constraints.get("excluded_ingredients"):
        constraints_str += f"\nExclude: {', '.join(constraints['excluded_ingredients'])}"

    history_context = _format_history_context(state)
    mode_prefix = _get_mode_prefix(state, pantry_grounded=pantry_grounded)
    system_prompt = (
        BRAINSTORM_SYSTEM_PROMPT if pantry_grounded else BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY
    )
    prompt = (
        mode_prefix
        + system_prompt
        + pantry_context
        + constraints_str
        + "\n\n"
        + history_context
        + f"User: {input_text}\n\nSuggest 3-4 recipes:"
    )

    ai_manager = get_ai_manager()
    try:
        result = await ai_manager.complete(prompt=prompt, temperature=0.7)
        response_text = (
            result if isinstance(result, str) else getattr(result, "response", str(result))
        )
    except NoProviderAvailableError as e:
        response_text = user_message_for_failure(e.kind, e.configured)
    except Exception as e:
        logger.error("Brainstorm error: %s", e)
        response_text = "Sorry, I ran into an error generating recipe ideas. Please try again."

    # Extract recipe names from bold text for state
    ideas = re.findall(r"\*\*(.+?)\*\*", response_text)

    return {
        **state,
        "intent": Intent.RECIPE_BRAINSTORM.value,
        "assistant_message": response_text,
        "brainstorm_ideas": ideas,
        "next_action": NextAction.PICK_RECIPE.value,
        "proposal": None,
        "requires_review": False,
        "confidence": 1.0,
        "workflow_status": WorkflowStatus.COMPLETED.value,
        "suggested_action": NextAction.PICK_RECIPE.value,
    }


async def research_recipe(state: WorkflowState) -> WorkflowState:
    """Node: Search DuckDuckGo for the selected recipe, store grounding context.

    This node runs on the brainstorm follow-up path which bypasses
    extract_recipe_constraints.  We load prior constraints from the session
    here so that generate_grounded_recipe always has them available (#144).
    """
    recipe_name: str = state.get("selected_recipe_name") or state.get("input_text", "")

    # Rehydrate constraints from the session when the brainstorm follow-up path
    # skipped extract_recipe_constraints.  Without this the constraints from
    # turn 1 (cuisine, dietary, must_use_ingredients, …) are silently dropped.
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    if not constraints:
        prior = _prior_constraints_from_state(state)
        if prior:
            constraints = prior
            logger.info(
                "research_recipe: inherited constraints from session "
                "(dietary=%s, must_use=%s)",
                constraints.get("dietary"),
                constraints.get("must_use_ingredients"),
            )

    # Same stored-preference fallback as extract_recipe_constraints, for the
    # (defensive) case this path is reached with no dietary signal in the
    # rehydrated session constraints either (#394).
    if not constraints.get("dietary"):
        stored_dietary = await get_stored_dietary_preferences(state.get("user_id") or "")
        if stored_dietary:
            constraints = {**constraints, "dietary": stored_dietary}
            logger.info(
                "research_recipe: applied stored profile dietary preferences as default: %s",
                stored_dietary,
            )

    cuisine_tag = constraints.get("cuisine")
    search_result = await search_recipe(recipe_name, cuisine_tag=cuisine_tag)

    return {
        **state,
        "recipe_constraints": constraints,
        "web_search_result": search_result.model_dump() if search_result else None,
    }


async def generate_grounded_recipe(state: WorkflowState) -> WorkflowState:
    """Node: Generate full structured recipe using research + pantry context."""
    recipe_name: str = state.get("selected_recipe_name") or state.get("input_text", "recipe")
    logger.info("Generating grounded recipe", extra={"recipe_name": recipe_name})
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    scored_items: list[dict[str, Any]] = state.get("scored_pantry_items") or []
    web_result: dict[str, Any] | None = state.get("web_search_result")
    pantry_grounded = is_pantry_grounded(constraints)

    # If pantry wasn't scored yet (direct recipe_card path), try to load & score now.
    # Skipped entirely when the user opted out — this is the path that would
    # otherwise re-fetch the pantry from the DB after scoring had been skipped.
    if not scored_items and pantry_grounded:
        pantry_snapshot: list[dict[str, Any]] = state.get("pantry_snapshot") or []
        if not pantry_snapshot:
            try:
                repo = await get_repository()
                items = await repo.get_all_pantry_items(state.get("user_id", ""))
                pantry_snapshot = [i.model_dump(mode="json") for i in items]
            except Exception as e:
                logger.warning("Could not fetch pantry for recipe generation: %s", e)
        if pantry_snapshot:
            scored_items = score_and_rank(filter_usable_pantry_rows(pantry_snapshot), constraints)

    # This is the path that told a user to cook "fresh spinach from your
    # pantry" from a row that was expired at quantity 0 (#443): expired stock
    # was only ever flagged by score_and_rank, never removed, so it landed in
    # the "Supporting ingredients available" line. Nothing below may see a
    # row that isn't cookable stock.
    scored_items = filter_usable_pantry_rows(scored_items)

    # Must-use names come from the constraint itself so ingredients the user
    # named but doesn't have in the pantry still bind the recipe.
    must_use_names: list[str] = list(constraints.get("must_use_ingredients") or [])
    for item in scored_items:
        name = str(item.get("name") or "")
        if item.get("_must_use") and name and name not in must_use_names:
            must_use_names.append(name)

    priority_items = [_format_pantry_item_for_prompt(i) for i in scored_items if i.get("_score", 0) >= 5]
    supporting_items = [
        _format_pantry_item_for_prompt(i) for i in scored_items
        if 0 <= i.get("_score", 0) < 5
    ]

    context = ""
    if web_result and web_result.get("snippet"):
        context = web_result["snippet"][:400]
    else:
        context = "Use your culinary knowledge to create an authentic recipe."

    # use_pantry is an instruction to us, not a constraint to hand the model; when
    # it is off the prompt below already omits every pantry field.
    constraints_json = _json.dumps(
        {k: v for k, v in constraints.items() if v and k != "use_pantry"}
    )
    preferred_ingredients_str = (
        ", ".join(constraints.get("preferred_ingredients") or []) or "none specified"
    )
    prompt = GROUNDED_RECIPE_SYSTEM_PROMPT.format(
        recipe_name=recipe_name,
        constraints_json=constraints_json,
        must_use_items=", ".join(must_use_names[:5]) or "none specified",
        priority_items=", ".join(priority_items[:8]) or "none specified",
        preferred_ingredients=preferred_ingredients_str,
        supporting_items=", ".join(supporting_items[:10]) or "none",
        context=context,
    )

    ai_manager = get_ai_manager()
    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=LLMRecipeResult,
            temperature=0.5,
        )
        if not isinstance(result, LLMRecipeResult):
            raise ValueError("Unexpected response type from AI provider")
        llm_result = result
    except NoProviderAvailableError as e:
        logger.error("Grounded recipe generation failed: %s", e)
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": user_message_for_failure(e.kind, e.configured),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Recipe generation error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }
    except Exception as e:
        logger.error("Grounded recipe generation failed: %s", e)
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": (
                f"Sorry, I couldn't generate a recipe for '{recipe_name}'. "
                "Please try again."
            ),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Recipe generation error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }

    # Build RecipeCard from LLM result
    ingredients_list: list[Ingredient] = []
    for ing_dict in llm_result.ingredients:
        if isinstance(ing_dict, str):
            # LLM returned a plain string instead of a dict — use it as name
            ingredients_list.append(Ingredient(name=ing_dict))
            continue
        if isinstance(ing_dict, dict):
            raw_qty = ing_dict.get("quantity")
            qty: float | None = None
            extra_note: str | None = None
            if raw_qty is not None:
                try:
                    qty = float(raw_qty)
                except (ValueError, TypeError):
                    # LLM returned non-numeric quantity like "to taste"
                    extra_note = str(raw_qty)

            prep = ing_dict.get("preparation") or ""
            if extra_note:
                prep = f"{extra_note}, {prep}" if prep else extra_note

            name = ing_dict.get("name") or ing_dict.get("ingredient") or ""
            ingredients_list.append(
                Ingredient(
                    name=name,
                    quantity=qty,
                    unit=ing_dict.get("unit"),
                    preparation=prep or None,
                    optional=ing_dict.get("optional", False),
                    substitutes=ing_dict.get("substitutes", []),
                )
            )

    recipe_card = RecipeCard(
        title=llm_result.title,
        description=llm_result.description,
        prep_time_minutes=llm_result.prep_time_minutes,
        cook_time_minutes=llm_result.cook_time_minutes,
        total_time_minutes=llm_result.total_time_minutes,
        servings=llm_result.servings,
        ingredients=ingredients_list,
        instructions=llm_result.instructions,
        cuisine=llm_result.cuisine,
        meal_type=llm_result.meal_type,
        dietary_tags=llm_result.dietary_tags,
        difficulty=llm_result.difficulty,
        tips=llm_result.tips,
    )
    logger.info(
        "Recipe card generated",
        extra={
            "title": recipe_card.title,
            "ingredient_count": len(ingredients_list),
            "step_count": len(llm_result.instructions),
            "confidence": llm_result.confidence,
        },
    )

    # Compute ingredient_availability against pantry
    pantry_names = {i.get("name", "").lower() for i in scored_items}
    availability: list[IngredientAvailability] = []
    missing: list[str] = []
    available: list[str] = []

    for ing in ingredients_list:
        ing_lower = ing.name.lower()
        if any(p in ing_lower or ing_lower in p for p in pantry_names):
            matched = next(
                (
                    i.get("name") for i in scored_items
                    if i.get("name", "").lower() in ing_lower
                    or ing_lower in i.get("name", "").lower()
                ),
                None,
            )
            availability.append(IngredientAvailability(
                name=ing.name,
                status="have",
                pantry_item_name=matched,
            ))
            available.append(ing.name)
        elif ing.substitutes:
            # Check if any substitute is in pantry
            sub_match = next(
                (
                    s for s in ing.substitutes
                    if any(p in s.lower() or s.lower() in p for p in pantry_names)
                ),
                None,
            )
            if sub_match:
                availability.append(IngredientAvailability(
                    name=ing.name,
                    status="substitute",
                    pantry_item_name=sub_match,
                    substitute_note=f"use {sub_match} instead",
                ))
            elif is_staple(normalize_food_name(ing.name)):
                availability.append(IngredientAvailability(name=ing.name, status="assumed"))
                available.append(ing.name)
            else:
                availability.append(IngredientAvailability(name=ing.name, status="missing"))
                missing.append(ing.name)
        else:
            if is_staple(normalize_food_name(ing.name)):
                availability.append(IngredientAvailability(name=ing.name, status="assumed"))
                available.append(ing.name)
            else:
                availability.append(IngredientAvailability(name=ing.name, status="missing"))
                missing.append(ing.name)

    pantry_match_score = len(available) / len(ingredients_list) if ingredients_list else 0.0

    proposal = RecipeCardProposal(
        recipe=recipe_card,
        pantry_match_score=pantry_match_score,
        missing_ingredients=missing,
        available_ingredients=available,
    )

    avail_dicts = [a.model_dump() for a in availability]

    envelope = create_recipe_envelope(
        proposal=proposal,
        confidence=llm_result.confidence,
        field_confidences={},
        warnings=state.get("warnings", []),
        errors=state.get("errors", []),
        assistant_message=f"Here's a recipe for {recipe_card.title}!",
        request_id=state.get("request_id"),
        workflow_id=state.get("workflow_id"),
    )

    return {
        **state,
        "intent": Intent.RECIPE_CARD.value,
        "assistant_message": envelope.assistant_message,
        "next_action": NextAction.REVIEW_PROPOSAL.value,
        "proposal": proposal,
        "requires_review": True,
        "confidence": llm_result.confidence,
        "ingredient_availability": avail_dicts,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
    }


async def refine_recipe_node(state: WorkflowState) -> WorkflowState:
    """Node: refine the currently-pinned recipe in place (#416 AC1).

    Reached when intent==recipe_card AND a full recipe is already pinned in
    session (`session.metadata.picked_recipe`) — i.e. this turn is a
    modification ("make it spicier", "add tomato") rather than a first pick
    from brainstorm (which still routes to research_recipe ->
    generate_grounded_recipe above).

    Reuses the existing, already-shipped follow-up engine —
    `services/recipe_generator.py::generate_recipe(previous_recipe=...)`,
    the same function `/v1/recipes/refine` calls — instead of reimplementing
    the follow-up prompt. Preserves the pinned recipe's id so the card
    replaces in place (same identity) rather than rendering as a distinct
    new card.
    """
    input_text = state.get("input_text", "")
    session = state.get("session") or {}
    picked_recipe_raw = (session.get("metadata") or {}).get("picked_recipe")

    if not picked_recipe_raw:
        # Defensive only: route_by_intent sends turns here exactly when
        # picked_recipe is set. Guards direct state construction (tests,
        # future callers) from crashing on a missing pin.
        logger.warning("refine_recipe_node reached with no picked_recipe in session")
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": (
                "I don't have a recipe pinned to refine yet — ask me for one first!"
            ),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }

    previous_recipe = RecipeCard.model_validate(picked_recipe_raw)

    pantry_items: list[Any] = []
    try:
        repo = await get_repository()
        pantry_items = await repo.get_all_pantry_items(state.get("user_id") or "")
    except Exception as e:
        logger.warning("Could not fetch pantry for recipe refinement: %s", e)

    ai_manager = get_ai_manager()
    try:
        result = await _generate_recipe_followup(
            prompt=input_text,
            pantry_items=pantry_items,
            ai_manager=ai_manager,
            previous_recipe=previous_recipe,
        )
    except NoProviderAvailableError as e:
        logger.error("Recipe refinement failed: %s", e)
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": user_message_for_failure(e.kind, e.configured),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Recipe refinement error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }
    except Exception as e:
        logger.error("Recipe refinement failed: %s", e)
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": (
                f"Sorry, I couldn't refine '{previous_recipe.title}'. Please try again."
            ),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Recipe refinement error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }

    # Preserve the pinned recipe's id so the card replaces in place instead
    # of rendering as a new, distinct card (identity requirement, #416 AC1).
    refined_recipe = result.recipe.model_copy(update={"id": previous_recipe.id})

    availability = [
        IngredientAvailability(
            name=s.ingredient_name,
            status="have" if s.status in ("have", "partial") else "missing",
            pantry_item_name=s.pantry_item_name,
        )
        for s in result.ingredients_status
    ]
    missing = [s.ingredient_name for s in result.ingredients_status if s.status == "missing"]
    available = [s.ingredient_name for s in result.ingredients_status if s.status != "missing"]

    proposal = RecipeCardProposal(
        recipe=refined_recipe,
        pantry_match_score=result.pantry_match_score,
        missing_ingredients=missing,
        available_ingredients=available,
    )

    envelope = create_recipe_envelope(
        proposal=proposal,
        confidence=0.9,
        field_confidences={},
        warnings=state.get("warnings", []),
        errors=state.get("errors", []),
        assistant_message=f"Updated {refined_recipe.title}!",
        request_id=state.get("request_id"),
        workflow_id=state.get("workflow_id"),
    )

    return {
        **state,
        "intent": Intent.RECIPE_CARD.value,
        "assistant_message": envelope.assistant_message,
        "next_action": NextAction.REVIEW_PROPOSAL.value,
        "proposal": proposal,
        "requires_review": True,
        "confidence": 0.9,
        "ingredient_availability": [a.model_dump() for a in availability],
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
    }
