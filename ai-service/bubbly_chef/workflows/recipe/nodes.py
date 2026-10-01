"""
Recipe sub-graph nodes extracted from chat_ingest.py.

Contains all helpers and LangGraph node functions related to recipe
grounding: constraint extraction, pantry scoring, brainstorm, research,
and grounded recipe generation.
"""

import json as _json
import logging
import re
from datetime import date
from typing import Any, NamedTuple

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.ai.provider import user_message_for_failure
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.domain.allergens import allergens_named
from bubbly_chef.domain.diet_terms import (
    FORBIDDEN_FOODS,
    join_fields,
    names_forbidden_food,
    norm_label,
)
from bubbly_chef.domain.expiry_priority import (
    DEFAULT_EXPIRY_PRIORITY,
    ExpiryPriority,
    coerce_expiry_priority,
    urgency_weights,
)
from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.domain.staples import is_staple
from bubbly_chef.domain.stock import filter_usable_pantry_rows
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.recipe import (
    DietChanges,
    Ingredient,
    IngredientAvailability,
    RecipeCard,
    RecipeCardProposal,
    RecipeConstraints,
    build_structured_steps,
)
from bubbly_chef.prompts.recipe import (
    _MODE_SYSTEM_PROMPTS,
    _RECIPE_MODE_PANTRY_LINE,
    BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY,
    REMEMBERED_DIETS_CHAT_PREFIX,
    REMEMBERED_DIETS_PROFILE_PREFIX,
    brainstorm_system_prompt,
    expiring_context_label,
    grounded_recipe_system_prompt,
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
from bubbly_chef.services.allergen_guard import (
    AllergenViolation,
    allergen_refusal_message,
    allergen_safe_note,
    card_allergens,
    generate_allergen_safe,
)
from bubbly_chef.services.dietary_preferences import get_stored_dietary_preferences
from bubbly_chef.services.expiry_priority import get_stored_expiry_priority
from bubbly_chef.services.food_exclusions import (
    allergy_never_block,
    get_stored_food_exclusions,
)
from bubbly_chef.services.recipe_generator import generate_recipe as _generate_recipe_followup
from bubbly_chef.tools.web_search import search_recipe
from bubbly_chef.workflows.recipe.diet_change import diet_change_reply, resolve_diet_change
from bubbly_chef.workflows.recipe.exclusions import apply_food_exclusions, union_case_insensitive
from bubbly_chef.workflows.recipe.refine_diet import added_clauses, added_text, negated_text
from bubbly_chef.workflows.recipe_result import complete_recipe
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


def _llm_ingredient_names(result: LLMRecipeResult) -> list[str]:
    """Every food an LLM card's ingredient list names, substitutes included (#500).

    The allergen guard reads these: a suggested substitute is still something the
    card tells the user they may cook with. Tolerates the plain-string and
    `ingredient`-keyed shapes `generate_grounded_recipe` also accepts.
    """
    names: list[str] = []
    for ing in result.ingredients:
        if isinstance(ing, str):
            names.append(ing)
        elif isinstance(ing, dict):
            names.append(str(ing.get("name") or ing.get("ingredient") or ""))
            names.extend(str(s) for s in ing.get("substitutes") or [])
    return [n for n in names if n]


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
    allergies: list[str] | None = None,
    expiry_priority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY,
) -> list[dict[str, Any]]:
    """
    Deterministically score and rank pantry items for recipe grounding.

    Scoring:
    - item in must_use_ingredients: +20 (also tagged `_must_use`)
    - days_until_expiry <= 3: +4 (Gentle, the default; Aggressive +8; Off 0)
    - days_until_expiry <= 7: +2 (Gentle, the default; Aggressive +5; Off 0)
    - item in preferred_ingredients: +5
    - item name matches cuisine keywords: +3
    - item in excluded_ingredients: -100
    - item naming one of `allergies` (#500): removed outright, so a stocked allergen is
      never offered to the model as an ingredient to cook with

    Expiry is now a tiebreaker, not the dominant axis. A strong cuisine +
    preference match (3 + 5 = 8) outranks a bare expiring item with no fit
    (4), aligning the ranking with the softened prompt wording from #288/#336.
    Must-use (20) still dominates everything; within the must-use group,
    expiry urgency still orders items.

    `expiry_priority` is the profile's expiry-priority setting (#502). Off awards no
    urgency points, so the ranking is what it would be if nothing were expiring;
    expired stock is still flagged `_expired` at every level.
    """
    near_points, soon_points = urgency_weights(expiry_priority)
    cuisine = (constraints.get("cuisine") or "").lower()
    preferred = {p.lower() for p in (constraints.get("preferred_ingredients") or [])}
    excluded = {e.lower() for e in (constraints.get("excluded_ingredients") or [])}
    must_use = {m.lower() for m in (constraints.get("must_use_ingredients") or [])}
    cuisine_keywords = CUISINE_INGREDIENTS.get(cuisine, set())

    if allergies:
        pantry_items = [
            i for i in pantry_items if not allergens_named(allergies, str(i.get("name") or ""))
        ]

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

        # Expiry urgency, scaled by the user's expiry priority (#502).
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
                    score += near_points
                elif days_left <= 7:
                    score += soon_points
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


async def _expiry_priority(state: WorkflowState) -> ExpiryPriority:
    """The user's expiry priority: this turn's, if a node already read it, else the profile's.

    Gentle when there is no profile, no such column yet, or the read fails (#502).
    """
    stored = state.get("expiry_priority")
    if stored is not None:
        return coerce_expiry_priority(stored)
    return await get_stored_expiry_priority(state.get("user_id") or "")


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
    - kitchen_limits (#650): the same list rule. "I only have one pan" said on
      a later turn applies, and it stays true for the rest of the conversation
      unless restated.
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
        "kitchen_limits",
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
#
# The table and its matcher now live in `domain.diet_terms` (issue #684), shared
# by every caller with the plant-based guard inside it. The alias keeps the name
# for imports and tests.
_DIETARY_FORBIDDEN_INGREDIENTS = FORBIDDEN_FOODS

# A diet named on the left already satisfies every diet in its set — so when
# both appear together in a combined list, the looser one is redundant and is
# dropped rather than kept alongside it (e.g. a combined ["Vegan", "Vegetarian"]
# collapses to ["Vegan"], regardless of which side — stored or message —
# each label came from).
_DIETARY_SUBSUMES: dict[str, frozenset[str]] = {
    "vegan": frozenset({"vegetarian", "dairy-free"}),
}


def _dietary_contradicted(label: str, haystack: str, *, plant_markers: bool = True) -> bool:
    """True if `haystack` names an ingredient the dietary label `label` forbids."""
    return names_forbidden_food(label, haystack, plant_markers=plant_markers)


def _drop_redundant_dietary(labels: list[str]) -> list[str]:
    """Drop any label a stricter label already subsumes, preserving order."""
    present = {norm_label(label) for label in labels}
    result: list[str] = []
    for label in labels:
        key = norm_label(label)
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
    it forbids — checked against both the message text and the extracted
    ingredient fields, since the constraint extractor may fold a request like
    "chicken curry" into a dish name rather than into `must_use_ingredients`.
    The message half is the two-part test of `_inherited_diet_contradicted`
    (issue #690): "pizza without pepperoni" names pepperoni but doesn't ask for it.
    A requested label already implied by a surviving stricter label (see
    `_DIETARY_SUBSUMES`) is dropped as redundant rather than appended.
    """
    survivors: list[str] = []
    for label in stored:
        if _inherited_diet_contradicted(label, input_text, constraints):
            logger.info(
                "Stored dietary preference %r set aside for this reply "
                "(message names a forbidden ingredient)",
                label,
            )
            continue
        survivors.append(label)

    combined = list(survivors)
    present_keys = {norm_label(label) for label in combined}
    for label in requested:
        if norm_label(label) not in present_keys:
            combined.append(label)
            present_keys.add(norm_label(label))

    return _drop_redundant_dietary(combined)


_norm_label = norm_label


def _diets_set_aside(stored: list[str], final: list[str]) -> list[str]:
    """The stored diet labels the final `constraints["dietary"]` doesn't cover (#544).

    The one definition of a card's `diets_set_aside`. A stored label is covered
    by an equal final label, or by a final label that subsumes it (a final Vegan
    covers a stored Vegetarian).
    """
    covered = _covered_keys(final)
    return [label for label in stored if _norm_label(label) not in covered]


def _covered_keys(labels: list[str]) -> set[str]:
    """Normalised `labels` plus every label they subsume (a Vegan covers a Vegetarian)."""
    covered = {_norm_label(label) for label in labels}
    for broad, narrower in _DIETARY_SUBSUMES.items():
        if _norm_label(broad) in covered:
            covered |= {_norm_label(n) for n in narrower}
    return covered


_NEGATED_NAME_PREFIXES = ("non-", "non ", "not ", "no longer ")


def _tweak_names_label(label: str, tweak_lower: str) -> bool:
    """True if the tweak names `label` as a whole word, and not as "non-X"/"not X" (#544)."""
    words = [re.escape(w) for w in _norm_label(label).split("-") if w]
    if not words:
        return False
    body = r"[\s_-]+".join(words)
    for match in re.finditer(rf"(?<!\w){body}(?!\w)", tweak_lower):
        before = tweak_lower[: match.start()]
        if not before.endswith(_NEGATED_NAME_PREFIXES):
            return True
    return False


def _dedupe_labels(labels: list[str]) -> list[str]:
    """De-duplicate case-insensitively (through `_norm_label`), preserving order."""
    seen: set[str] = set()
    result: list[str] = []
    for label in labels:
        key = _norm_label(label)
        if key not in seen:
            seen.add(key)
            result.append(label)
    return result


def _without_labels(labels: list[str], removed: list[str]) -> list[str]:
    """`labels` minus `removed`, compared through `_norm_label`."""
    gone = {_norm_label(x) for x in removed}
    return [label for label in labels if _norm_label(label) not in gone]


def _message_sets_label_aside(label: str, text: str) -> bool:
    """True when `text` uses `label` as a "non-LABEL" dish modifier (issue #685).

    "make it non-vegan" and "a non-vegetarian pasta" set the label aside for this
    turn only. A message that also names the label plainly ("a vegan dinner my
    non-vegan family will enjoy") keeps it. A bare "not (a) LABEL" ("that's not
    vegetarian!", "I'm not vegetarian any more") does nothing: there is no
    permanent clearing here, so the diet is still sent.
    """
    words = [re.escape(w) for w in _norm_label(label).split("-") if w]
    if not words:
        return False
    lowered = text.lower().replace("’", "'")
    body = r"[\s_-]+".join(words)
    if not re.search(rf"\bnon[- ]{body}(?![\w-])", lowered):
        return False
    return not _tweak_names_label(label, lowered)


def _inherited_diet_contradicted(label: str, input_text: str, fresh: dict[str, Any]) -> bool:
    """True when this turn asks for a food the diet `label` forbids (inherited or stored).

    Used for the conversation's inherited diet (#685) and, since #690, for a stored
    profile diet in `_combine_dietary_preferences`.

    Reads this turn's message and this turn's FRESHLY extracted ingredients, never
    the ones a session carried over, so an inherited "use up my chicken" can't
    undo a later "actually make it vegetarian".

    The message half is refine's two-part test: the negation-aware per-clause text
    (so "pasta with no meat" is fine) must name the food, and so must the whole
    message under the default guards (so "vegan pulled pork tacos" and "meat and
    dairy free pasta" keep the diet). The field half uses the default guards, so a
    fresh preferred "tempeh bacon" keeps it too.
    """
    message = _dietary_contradicted(
        label, join_fields(*added_clauses(input_text)), plant_markers=False
    ) and _dietary_contradicted(label, input_text)
    fields = _dietary_contradicted(
        label,
        join_fields(
            *(fresh.get("must_use_ingredients") or []),
            *(fresh.get("preferred_ingredients") or []),
        ),
    )
    return message or fields


def constraints_to_persist(state: WorkflowState) -> dict[str, Any] | None:
    """The `recipe_constraints` the session should remember after this turn (issue #685).

    Persisting only what the generator was handed would make the conversation
    forget "I'm vegetarian" for good after one "chicken curry". So the diet the
    conversation held (`session_dietary`) and the diet named this turn
    (`fresh_dietary`) are always kept, plus every label in the final diet that
    isn't stored-only: a stored label only the profile read supplied is never
    written back, so a profile diet can't get stuck in the session after the
    profile drops it. A label already in the session counts as conversation-origin.

    It sets `dietary` even to `[]`: the router saves only a truthy dict, and
    `{"dietary": []}` overwrites a stale persisted value where `{}` would be
    skipped. Returned unchanged when `stored_dietary` isn't in state (neither
    extract nor research ran, e.g. a refine turn).
    """
    constraints = state.get("recipe_constraints")
    if "stored_dietary" not in state:
        return constraints

    stored_keys = {_norm_label(x) for x in state.get("stored_dietary") or []}
    fresh = list(state.get("fresh_dietary") or [])
    session = list(state.get("session_dietary") or [])
    conversation_keys = {_norm_label(x) for x in [*fresh, *session]}
    kept_final = [
        label
        for label in (constraints or {}).get("dietary") or []
        if _norm_label(label) not in stored_keys or _norm_label(label) in conversation_keys
    ]
    persisted = {**(constraints or {}), "dietary": _dedupe_labels([*fresh, *session, *kept_final])}
    # An exclusion only the profile supplied (#500) is read again next turn; writing
    # it into the session would keep it after the profile drops it.
    from_profile = {x.strip().lower() for x in state.get("profile_excluded") or []}
    if from_profile and persisted.get("excluded_ingredients"):
        persisted["excluded_ingredients"] = [
            x for x in persisted["excluded_ingredients"] if x.strip().lower() not in from_profile
        ]
    if state.get("brainstorm_ideas") and state.get("next_action") == NextAction.PICK_RECIPE.value:
        # A brainstorm's options are waiting for a pick: the pick continues this
        # request, so it keeps the foods the request named (issue #719).
        return persisted
    final_dietary = list((constraints or {}).get("dietary") or [])
    return _without_turn_scoped_foods(persisted, state, final_dietary)


def _without_turn_scoped_foods(
    persisted: dict[str, Any], state: WorkflowState, final_dietary: list[str]
) -> dict[str, Any]:
    """`persisted` minus the foods that set a diet aside on this turn (issue #719).

    `final_dietary` is the diet this turn's reply was generated under (not the
    persisted one, which puts a set-aside session diet back).

    A diet set aside because this turn named a food it forbids ("we're not vegan
    tonight, can I use butter?", "chicken curry" under a stored Vegetarian) is
    set aside for this reply only. The food was recorded as a preferred or
    must-use ingredient, and persisting it would hand it to every later turn,
    whose diet check reads the merged ingredients and would set the diet aside
    again for as long as the session lives: the one-turn relaxation of #687 would
    never expire.

    So the foods the set-aside labels forbid are left out of what the session
    remembers. Foods that don't clash with the diet are kept. Refining the same
    card is unaffected: it reads the card's own `diets_set_aside` and ingredients,
    not these lists, so it keeps the diet set aside. A new request sees neither the
    food nor the set-aside.
    """
    held = [*(state.get("stored_dietary") or []), *(state.get("session_dietary") or [])]
    set_aside = _diets_set_aside(held, final_dietary)
    if not set_aside:
        return persisted
    result = dict(persisted)
    for key in ("preferred_ingredients", "must_use_ingredients"):
        foods = persisted.get(key)
        if foods:
            result[key] = [
                food
                for food in foods
                if not any(_dietary_contradicted(label, str(food)) for label in set_aside)
            ]
    return result


def _tag_key(tag: str) -> str:
    return re.sub(r"[\s_]+", "-", tag.strip().lower())


def _tweak_adds_forbidden_food(label: str, added_haystack: str, tweak_lower: str) -> bool:
    """True when a refine tweak really adds a food `label` forbids (issue #684).

    Two checks, and both must say yes, so the second can only keep a diet: the
    per-clause `added_haystack` (negations and swaps already removed, plant
    markers already stripped by `added_text`, so `plant_markers=False`), and the
    whole tweak. The second exists because `added_text` strips a `-free` span
    before the matcher's coordinated-list rule can see it: "make it meat and dairy
    free" becomes "make it meat and", which names meat.
    """
    return _dietary_contradicted(
        label, added_haystack, plant_markers=False
    ) and _dietary_contradicted(label, tweak_lower, plant_markers=False)


class RefineDiet(NamedTuple):
    """What `refine_dietary_constraints` decided for one refine turn (#544)."""

    constraints: dict[str, Any]
    diets_set_aside_now: list[str]
    exclusions_set_aside_now: list[str]
    diets_restored: list[str]
    exclusions_restored: list[str]
    # The profile allergies (#500): always sent, never set aside by a tweak, and what
    # the caller's post-generation guard enforces.
    allergies: tuple[str, ...] = ()


async def refine_dietary_constraints(
    user_id: str,
    input_text: str,
    prior: dict[str, Any] | None,
    previous_recipe: RecipeCard | None,
    *,
    library: bool = False,
) -> "RefineDiet":
    """The constraints a refine hands the generator, plus what this turn set aside (#544).

    A refine *remembers* the diet decision the first turn already made rather
    than re-guessing it. Labels are the stored preferences followed by the
    conversation's (`prior["dietary"]`). Chat refine keeps every label except
    those already in `previous_recipe.diets_set_aside` and those the tweak
    *adds* a forbidden food for. The library route (`library=True`, no session
    and no carried field) also drops labels whose forbidden food appears in the
    saved recipe's ingredient names, unless a `dietary_tags` entry names the
    label. A label the tweak itself names is never set aside.

    An exclusion ("no peanuts") is dropped only when the tweak adds it or an
    earlier tweak already did (`previous_recipe.exclusions_set_aside`). It is
    never dropped because the previous card happens to contain it: a first-turn
    model ignoring "no peanuts" looks the same as a deliberate add, and letting
    that silently delete an allergen exclusion is the worse failure.

    A set-aside is not permanent. A label the tweak names ("actually make it
    vegetarian") is sent, and removed from the card's carried `diets_set_aside`
    so the restore holds for the rest of the chat. Likewise a tweak that negates
    a carried exclusion ("no peanuts" after "add peanuts") sends it again and
    removes it from `exclusions_set_aside`.

    Returns a `RefineDiet`: `constraints` is `{"dietary": ..., "excluded_ingredients": ...}`
    with empty keys omitted; the other fields say what to add to, or remove
    from, the refined card's carried lists.
    """
    stored = await get_stored_dietary_preferences(user_id)
    food_exclusions = await get_stored_food_exclusions(user_id)
    prior = prior or {}
    labels = _dedupe_labels([*stored, *(prior.get("dietary") or [])])

    tweak_lower = input_text.lower()
    added = added_text(input_text)
    # Diet checks match per clause (issue #684): `added_text` joins clauses with a
    # space, which would let a guard read across "add mushrooms, bacon too".
    added_haystack = join_fields(*added_clauses(input_text))

    carried = {_norm_label(x) for x in (previous_recipe.diets_set_aside if previous_recipe else [])}
    ingredient_names = join_fields(
        *(ing.name for ing in (previous_recipe.ingredients if previous_recipe else []))
    ).lower()
    # A tag keeps its label, and a stricter tag keeps the looser labels it
    # subsumes (a "vegan" tag keeps a stored Vegetarian).
    tag_keys = _covered_keys(
        [_tag_key(t) for t in (previous_recipe.dietary_tags if previous_recipe else [])]
    )

    kept: list[str] = []
    set_aside_now: list[str] = []
    diets_restored: list[str] = []
    for label in labels:
        key = _norm_label(label)
        if _tweak_names_label(label, tweak_lower):
            # The tweak names the label ("make it dairy free"): never set aside,
            # even if the card carries it as set aside. "non-vegetarian" and
            # "not vegetarian" name it too, but to reject it.
            kept.append(label)
            if not library and key in carried:
                diets_restored.append(label)
            continue
        if not library and key in carried:
            continue
        if _tweak_adds_forbidden_food(label, added_haystack, tweak_lower):
            set_aside_now.append(label)
            continue
        if (
            library
            and previous_recipe is not None
            and key not in tag_keys
            and _dietary_contradicted(label, ingredient_names)
        ):
            set_aside_now.append(label)
            continue
        kept.append(label)

    carried_exclusions = {
        str(x).strip().lower()
        for x in (previous_recipe.exclusions_set_aside if previous_recipe else [])
    }
    negated = negated_text(input_text)
    excluded: list[str] = []
    exclusions_set_aside_now: list[str] = []
    exclusions_restored: list[str] = []
    # A profile dislike rides the same set-aside rules as an exclusion the user typed
    # (#500): dropped when the tweak adds it ("add cilantro on top"), carried on the
    # card so later tweaks don't quietly re-exclude it, restored when negated. An
    # allergy is not in this list; it is appended after the loop and nothing drops it.
    prior_excluded = union_case_insensitive(
        list(prior.get("excluded_ingredients") or []), list(food_exclusions.dislikes)
    )
    prior_keys = {str(e).strip().lower() for e in prior_excluded}
    carried_only = [
        x
        for x in (previous_recipe.exclusions_set_aside if previous_recipe else [])
        if str(x).strip().lower() not in prior_keys
    ]
    for entry in [*prior_excluded, *carried_only]:
        entry_key = str(entry).strip().lower()
        if entry_key in carried_exclusions:
            if re.search(rf"\b{re.escape(entry_key)}\b", negated):
                # The tweak negates it again ("no peanuts"): send it from now on.
                exclusions_restored.append(entry)
                excluded.append(entry)
            continue
        if re.search(rf"\b{re.escape(entry_key)}\b", added):
            exclusions_set_aside_now.append(entry)
            continue
        excluded.append(entry)

    excluded = union_case_insensitive(excluded, list(food_exclusions.allergies))
    constraints: dict[str, Any] = {}
    if kept:
        constraints["dietary"] = kept
    if excluded:
        constraints["excluded_ingredients"] = excluded
    return RefineDiet(
        constraints,
        set_aside_now,
        exclusions_set_aside_now,
        diets_restored,
        exclusions_restored,
        food_exclusions.allergies,
    )


def carry_dietary_tags(
    previous_recipe: RecipeCard | None, tweak: str, set_aside_now: list[str]
) -> list[str]:
    """The `dietary_tags` a library refine carries onto the card it returns (#544).

    The generator never emits tags, so without this a second refine of the same
    recipe would lose the tag that rescued its diet the first time. A tag is
    dropped when the tweak set its label aside, or adds a food the tag forbids.
    """
    if previous_recipe is None:
        return []
    added_haystack = join_fields(*added_clauses(tweak))
    tweak_lower = tweak.lower()
    dropped = {_norm_label(label) for label in set_aside_now}
    return [
        tag
        for tag in previous_recipe.dietary_tags
        if _norm_label(tag) not in dropped
        and not _tweak_adds_forbidden_food(tag, added_haystack, tweak_lower)
    ]


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


def _brainstorm_pending(state: WorkflowState) -> bool:
    """True when the session still holds a brainstorm's options awaiting a pick (#719)."""
    session = state.get("session")
    metadata = session.get("metadata") if isinstance(session, dict) else None
    return isinstance(metadata, dict) and bool(metadata.get("brainstorm_ideas"))


def _constraints_prompt(input_text: str, session_held: list[str], stored: list[str]) -> str:
    """The extractor prompt for one message (#687).

    When the conversation or the profile already holds a diet, the labels go in front
    of the message so the extractor can name a dropped diet by the label it is
    remembered under. Nothing is added when nothing is held, so a first turn's prompt
    is the base prompt plus the message.
    """
    held = ""
    if session_held:
        held += REMEMBERED_DIETS_CHAT_PREFIX + ", ".join(session_held)
    if stored:
        held += REMEMBERED_DIETS_PROFILE_PREFIX + ", ".join(stored)
    return RECIPE_CONSTRAINTS_SYSTEM_PROMPT + held + "\n\nUser message: " + input_text


async def _extract_constraints(
    input_text: str, session_held: list[str], stored: list[str]
) -> dict[str, Any]:
    """One structured extraction call; `{}` when it fails, which keeps every diet."""
    ai_manager = get_ai_manager()
    try:
        result = await ai_manager.complete(
            prompt=_constraints_prompt(input_text, session_held, stored),
            response_schema=RecipeConstraints,
            temperature=0.1,
        )
        if isinstance(result, RecipeConstraints):
            return result.model_dump()
    except Exception as e:
        logger.warning("Constraint extraction failed (using empty constraints): %s", e)
    return {}


async def apply_diet_change(state: WorkflowState) -> WorkflowState:
    """Node: a message about dropping a diet that has no recipe request with it (#687).

    "I'm not vegetarian any more" is food talk with no dish, so it classifies as
    general chat and constraint extraction would never run. The classifier's
    `diet_change_mentioned` flag sends it here instead. This runs the same structured
    extraction and applies only what `diet_changes` says (`resolve_diet_change`); it
    never decides from the text. When nothing is applied, `diet_change_applied` stays
    unset and the graph returns to the reply for the intent the classifier chose. When
    something is applied the turn still gets that reply, with the short diet sentence
    (`diet_change_notice`) in front, so a question in the same message is answered.

    On a conversation-scope removal the session's remaining constraints are handed to
    `update_session_node` as `diet_change_constraints`, which is the only thing that
    writes the session. The profile is never touched: a profile diet stays in force
    and the reply says so.
    """
    input_text = state.get("input_text", "")
    prior = _prior_constraints_from_state(state)
    session_held = list((prior or {}).get("dietary") or [])
    stored_dietary = await get_stored_dietary_preferences(state.get("user_id") or "")
    # Profile allergies (#500) are not a diet chat can drop: a removal of "nut-free"
    # while the profile says peanut is answered "kept", never applied.
    allergies = list((await get_stored_food_exclusions(state.get("user_id") or "")).allergies)
    if not session_held and not stored_dietary and not allergies:
        # Nothing remembered anywhere, so there is nothing a removal could clear.
        return state

    extracted = await _extract_constraints(input_text, session_held, stored_dietary)
    changes = DietChanges.model_validate(extracted.get("diet_changes") or {})
    outcome = resolve_diet_change(
        changes,
        session_held,
        stored_dietary,
        list(extracted.get("dietary") or []),
        allergies,
    )
    if not outcome.acted:
        return state

    logger.info(
        "Diet change (no recipe request): dropped=%s relaxed=%s kept_by_profile=%s",
        outcome.dropped,
        outcome.relaxed,
        outcome.kept_by_profile,
    )
    # The turn is never answered here: the diet sentence goes on as a notice, and the
    # graph continues into the reply for the intent the classifier chose (general chat
    # or cooking help), which prepends it. So a question in the same message still gets
    # its answer.
    update: dict[str, Any] = {
        **state,
        "diet_change_applied": True,
        "diet_change_notice": diet_change_reply(outcome),
    }
    if outcome.dropped:
        update["diet_change_constraints"] = {
            **(prior or {}),
            "dietary": _without_labels(session_held, outcome.dropped),
        }
    return update  # type: ignore[return-value]


async def extract_recipe_constraints(state: WorkflowState) -> WorkflowState:
    """Node: Extract recipe constraints from user message via structured LLM call.

    On follow-up turns (e.g. user selects a brainstorm idea or refines a recipe),
    the newly-extracted constraints are merged with any constraints persisted in
    the session from the previous turn.  Fresh values override; fields that the
    user didn't re-mention inherit from the prior turn (#144).
    """
    input_text = state.get("input_text", "")
    logger.info("Extracting recipe constraints", extra={"message_preview": input_text[:80]})

    # Read before the extraction so the extractor can name a diet the user drops by
    # the label it is remembered under (#687). Both reads also feed the diet checks
    # below.
    prior = _prior_constraints_from_state(state)
    session_held = list((prior or {}).get("dietary") or [])
    stored_dietary = await get_stored_dietary_preferences(state.get("user_id") or "")

    constraints = await _extract_constraints(input_text, session_held, stored_dietary)
    # The structured "I no longer follow this diet" (#687). Taken off here so it is a
    # per-turn instruction: it must not reach the merge, the generator's constraints
    # JSON, or the session, where a stale removal would be replayed next turn.
    diet_changes = DietChanges.model_validate(constraints.pop("diet_changes", None) or {})

    # A diet the message turns down as a dish modifier ("make it non-vegan") isn't
    # sent this turn even when the extractor returned it (issue #685). Filtered
    # before the merge, so if nothing fresh remains the session's diet still
    # inherits instead of being overridden by a label the user just turned down.
    fresh_dietary = [
        label
        for label in (constraints.get("dietary") or [])
        if not _message_sets_label_aside(label, input_text)
    ]
    if "dietary" in constraints:
        constraints["dietary"] = fresh_dietary
    # This turn's own extraction, before the merge: what the inherited-diet check
    # reads, never the ingredients a session carried over.
    fresh = dict(constraints)

    # Merge with prior constraints from the session (inherit + override).
    if prior:
        constraints = _merge_constraints(prior, constraints)
        logger.info(
            "Merged prior session constraints into fresh extraction "
            "(dietary=%s, must_use=%s, use_pantry=%s)",
            constraints.get("dietary"),
            constraints.get("must_use_ingredients"),
            constraints.get("use_pantry"),
        )

    # No meal_type fill-in from the clock (#408): a meal type is only one the
    # user named this turn or an earlier one (inherited through the merge
    # above). Unset means any dish -- see the brainstorm prompts' neutral rule.

    # Stored profile default (#394). A stored preference stays in force and
    # *combines* with whatever this message (or an earlier turn in the same
    # session, already folded in above by `_merge_constraints`) asks for. It
    # is only set aside — for this one reply — when the message explicitly
    # asks for an ingredient the stored diet forbids (see
    # `_combine_dietary_preferences`). It must never be silently dropped just
    # because this message didn't repeat it. (Read above, before the extraction.)

    # Issue #687: what the extractor said about dropping a diet. Applied only to the
    # conversation's own diet, never to the profile's, and never decided from the
    # message text (see `diet_change.resolve_diet_change`).
    food_exclusions = await get_stored_food_exclusions(state.get("user_id") or "")
    diet_outcome = resolve_diet_change(
        diet_changes,
        session_held,
        stored_dietary,
        fresh_dietary,
        list(food_exclusions.allergies),
    )
    if diet_outcome.acted:
        logger.info(
            "Diet change from structured extraction: dropped=%s relaxed=%s kept_by_profile=%s",
            diet_outcome.dropped,
            diet_outcome.relaxed,
            diet_outcome.kept_by_profile,
        )

    # Issue #685: when this turn names no diet, the merged `dietary` IS the
    # conversation's diet, inherited from the session. It gets the same
    # contradiction check the stored diet gets, against this turn's message and
    # freshly extracted ingredients (a diet named this turn is an explicit ask and
    # is never checked). A label set aside here comes back next turn: see
    # `constraints_to_persist`.
    #
    # `inherited` is also what the session remembers (`session_dietary`), so a
    # conversation-scope removal leaves it here, and a this_request removal stays in
    # it and is only left out of `requested_dietary` (#687).
    inherited = (
        []
        if fresh_dietary
        else _without_labels(list(constraints.get("dietary") or []), diet_outcome.dropped)
    )
    requested_dietary = fresh_dietary or _dedupe_labels(
        [
            label
            for label in _without_labels(inherited, diet_outcome.relaxed)
            if not _message_sets_label_aside(label, input_text)
            and not _inherited_diet_contradicted(label, input_text, fresh)
        ]
    )
    # A "non-LABEL" modifier sets a stored label aside for this reply only; the
    # profile is never changed, so the next turn's read brings it back.
    stored_now = [
        label for label in stored_dietary if not _message_sets_label_aside(label, input_text)
    ]
    if stored_dietary:
        combined_dietary = _combine_dietary_preferences(
            stored_now, requested_dietary, constraints, input_text
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
    elif inherited or diet_outcome.dropped:
        constraints["dietary"] = requested_dietary

    # Profile allergies and dislikes (#500): merged into `excluded_ingredients` on
    # every turn, from the profile, never from what the session remembered.
    applied = apply_food_exclusions(constraints, food_exclusions, input_text)
    constraints = applied.constraints

    return {
        **state,
        "recipe_constraints": constraints,
        # Per-turn, never persisted (#502): the profile's expiry priority, read once
        # here so scoring, brainstorm and the recipe card all see the same level.
        "expiry_priority": await _expiry_priority(state),
        # Per-turn markers, never persisted (#500): the allergies the guard enforces,
        # the dislikes this message set aside, and which `excluded_ingredients`
        # entries came from the profile (`constraints_to_persist` leaves them out).
        "profile_allergies": applied.allergies,
        "dislikes_set_aside": applied.dislikes_set_aside,
        "profile_excluded": applied.profile_excluded,
        # Per-turn markers, never persisted (#544, #685): research_recipe reads
        # `constraints_extracted` to know the stored diet was already combined with
        # this turn's message; the three diet lists feed research's
        # `diets_set_aside` and `constraints_to_persist`.
        "constraints_extracted": True,
        "session_dietary": inherited,
        "fresh_dietary": fresh_dietary,
        "stored_dietary": stored_dietary,
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
    expiry_priority = await _expiry_priority(state)
    scored = score_and_rank(
        filter_usable_pantry_rows(pantry_items),
        constraints,
        state.get("profile_allergies"),
        expiry_priority,
    )

    return {
        **state,
        "expiry_priority": expiry_priority,
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


async def _profile_allergies(state: WorkflowState) -> list[str]:
    """The user's allergies: this turn's, if extraction already read them, else the profile's."""
    stored = state.get("profile_allergies")
    if stored is not None:
        return list(stored)
    exclusions = await get_stored_food_exclusions(state.get("user_id") or "")
    return list(exclusions.allergies)


def _allergen_refusal_state(
    state: WorkflowState, violation: AllergenViolation, what: str
) -> WorkflowState:
    """The honest reply when generation still names an allergen after one regeneration (#500).

    A plain chat reply with no proposal: nothing that names an allergen is ever returned.
    """
    return {
        **state,
        "intent": Intent.GENERAL_CHAT.value,
        "assistant_message": allergen_refusal_message(violation.allergens, what),
        "next_action": NextAction.NONE.value,
        "proposal": None,
        "requires_review": False,
        "confidence": 1.0,
        "errors": state.get("errors", []) + [f"Allergen guard: {violation}"],
        "workflow_status": WorkflowStatus.COMPLETED.value,
    }


async def brainstorm_recipe_ideas(state: WorkflowState) -> WorkflowState:
    """Node: Generate 3-4 recipe ideas based on pantry + constraints."""
    input_text = state.get("input_text", "")
    scored_items: list[dict[str, Any]] = state.get("scored_pantry_items") or []
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    pantry_grounded = is_pantry_grounded(constraints)
    expiry_priority = await _expiry_priority(state) if pantry_grounded else DEFAULT_EXPIRY_PRIORITY
    expiring_label = expiring_context_label(expiry_priority)

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
        # Off (#502): no "Expiring soon" block at all, so expiring items are simply
        # listed with the rest of what's available.
        expiring = (
            [
                i for i in rest
                if (d := _days_until_expiry(i)) is not None and 0 <= d <= 7
            ]
            if expiring_label
            else []
        )
        supporting = [i for i in rest if i not in expiring]
        expiring_str = ", ".join(i.get("name", "") for i in expiring[:5])
        supporting_str = ", ".join(i.get("name", "") for i in supporting[:10])
        pantry_context = ""
        if must_use:
            must_use_str = ", ".join(i.get("name", "") for i in must_use[:5])
            pantry_context += f"\nMust use (the user asked to cook with these): {must_use_str}"
        if expiring_label:
            pantry_context += f"\n{expiring_label}: {expiring_str or 'none'}"
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
    allergies = await _profile_allergies(state)
    constraints_str += allergy_never_block(allergies)

    history_context = _format_history_context(state)
    mode_prefix = _get_mode_prefix(state, pantry_grounded=pantry_grounded)
    system_prompt = (
        brainstorm_system_prompt(expiry_priority)
        if pantry_grounded
        else BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY
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

    async def _brainstorm(extra: str) -> str:
        result = await ai_manager.complete(prompt=prompt + extra, temperature=0.7)
        return result if isinstance(result, str) else getattr(result, "response", str(result))

    # Set when the reply is a canned AI-failure message, so the envelope can say so (#732).
    ai_failure: NoProviderAvailableError | None = None
    try:
        # The guard reads the idea names (the bold titles), the concrete thing offered:
        # a closing note like "I left out the peanuts" isn't an idea (#500).
        response_text = await generate_allergen_safe(
            _brainstorm,
            lambda text: allergens_named(allergies, *re.findall(r"\*\*(.+?)\*\*", text)),
            allergies,
        )
    except AllergenViolation as e:
        return {**_allergen_refusal_state(state, e, "recipe ideas for that"), "brainstorm_ideas": []}
    except NoProviderAvailableError as e:
        response_text = user_message_for_failure(e.kind, e.configured)
        ai_failure = e
    except Exception as e:
        logger.error("Brainstorm error: %s", e)
        response_text = "Sorry, I ran into an error generating recipe ideas. Please try again."

    # Extract recipe names from bold text for state
    ideas = re.findall(r"\*\*(.+?)\*\*", response_text)

    result: WorkflowState = {
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
    if ai_failure is not None:
        result["ai_failure_kind"] = ai_failure.kind
        result["ai_failure_configured"] = ai_failure.configured
    return result


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

    # The stored diet, read once: it drives the diet below and the card's
    # `diets_set_aside` (#544).
    stored_dietary = await get_stored_dietary_preferences(state.get("user_id") or "")

    if not state.get("constraints_extracted"):
        # A brainstorm pick (or the defensive case): extract did not run this
        # turn, so re-check the diet ourselves rather than blindly re-applying
        # the stored one (#544). The picked name is the only message text checked.
        # A diet set aside for a "Chicken Tikka" pick stays set aside, and one set
        # aside by the brainstorm reasserts once the pick stops contradicting
        # it (the #394 design).
        #
        # The exception is the food the brainstorm request itself asked for
        # (issue #719): "give me some chicken ideas" under a Vegetarian diet is
        # still a chicken request when the user picks "Honey Garlic Thighs", whose
        # title doesn't say chicken. The session keeps those foods while the
        # brainstorm's options are pending (`constraints_to_persist`), so while
        # they are pending the foods are read here as part of the pick and keep the
        # diet set aside. Without pending options a stored must_use food doesn't
        # count as the pick naming it. Once the pick is made they are no longer
        # persisted.
        #
        # The same filter applies to the rehydrated conversation diet, not only
        # the stored one: a session "Vegetarian" doesn't survive a "Chicken
        # Tikka" pick either.
        rehydrated_dietary = list(constraints.get("dietary") or [])
        session_dietary = rehydrated_dietary
        name_lower = recipe_name.lower()
        request_foods = (
            {
                key: constraints[key]
                for key in ("must_use_ingredients", "preferred_ingredients")
                if constraints.get(key)
            }
            if _brainstorm_pending(state)
            else {}
        )
        foods_text = join_fields(
            *request_foods.get("must_use_ingredients", []),
            *request_foods.get("preferred_ingredients", []),
        )
        rehydrated_kept = [
            label
            for label in rehydrated_dietary
            if not _dietary_contradicted(label, name_lower)
            and not _dietary_contradicted(label, foods_text)
        ]
        dietary = _combine_dietary_preferences(
            stored_dietary, rehydrated_kept, request_foods, recipe_name
        )
        if dietary != rehydrated_dietary:
            logger.info(
                "research_recipe: combined stored dietary preferences for the pick: "
                "stored=%s rehydrated=%s -> %s",
                stored_dietary,
                rehydrated_dietary,
                dietary,
            )
        if dietary:
            constraints = {**constraints, "dietary": dietary}
        elif "dietary" in constraints:
            constraints = {k: v for k, v in constraints.items() if k != "dietary"}
        # Profile allergies and dislikes (#500), re-read on the pick path exactly as
        # extract does on the direct one. The picked name stands in for the message:
        # picking "Cilantro Lime Chicken" is an explicit ask for a disliked cilantro,
        # never for an allergen.
        applied = apply_food_exclusions(
            constraints, await get_stored_food_exclusions(state.get("user_id") or ""), recipe_name
        )
        constraints = applied.constraints
        profile_allergies = applied.allergies
        dislikes_set_aside = applied.dislikes_set_aside
        profile_excluded = applied.profile_excluded
    else:
        # extract already folded the profile in and left these in state.
        profile_allergies = list(state.get("profile_allergies") or [])
        dislikes_set_aside = list(state.get("dislikes_set_aside") or [])
        profile_excluded = list(state.get("profile_excluded") or [])
        # The direct path -- extract already combined the stored diet with this
        # turn's message, so leave `dietary` alone. Its conversation labels were
        # handed over in state.
        session_dietary = list(state.get("session_dietary") or [])

    # Stored labels first, then the conversation's (issue #685): a conversation
    # diet set aside this turn is recorded too, so a refine of this card skips it.
    dietary_set_aside = _diets_set_aside(
        _dedupe_labels([*stored_dietary, *session_dietary]), constraints.get("dietary") or []
    )

    cuisine_tag = constraints.get("cuisine")
    search_result = await search_recipe(recipe_name, cuisine_tag=cuisine_tag)

    return {
        **state,
        "recipe_constraints": constraints,
        "dietary_set_aside": dietary_set_aside,
        "session_dietary": session_dietary,
        "stored_dietary": stored_dietary,
        "profile_allergies": profile_allergies,
        "dislikes_set_aside": dislikes_set_aside,
        "profile_excluded": profile_excluded,
        # Read here on the pick path (extract didn't run) so the card sees the level (#502).
        "expiry_priority": await _expiry_priority(state),
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
    allergies = await _profile_allergies(state)
    expiry_priority = await _expiry_priority(state) if pantry_grounded else DEFAULT_EXPIRY_PRIORITY

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
            scored_items = score_and_rank(
                filter_usable_pantry_rows(pantry_snapshot), constraints, allergies, expiry_priority
            )

    # This is the path that told a user to cook "fresh spinach from your
    # pantry" from a row that was expired at quantity 0 (#443): expired stock
    # was only ever flagged by score_and_rank, never removed, so it landed in
    # the "Supporting ingredients available" line. Nothing below may see a
    # row that isn't cookable stock.
    scored_items = filter_usable_pantry_rows(scored_items)
    if allergies:
        # Pre-scored state can't smuggle a stocked allergen back in as an ingredient (#500).
        scored_items = [
            i for i in scored_items if not allergens_named(allergies, str(i.get("name") or ""))
        ]

    # Must-use names come from the constraint itself so ingredients the user
    # named but doesn't have in the pantry still bind the recipe.
    must_use_names: list[str] = list(constraints.get("must_use_ingredients") or [])
    for item in scored_items:
        name = str(item.get("name") or "")
        if item.get("_must_use") and name and name not in must_use_names:
            must_use_names.append(name)

    if expiry_priority == "off":
        # Off (#502): there is no "Priority ingredients (expiring soon)" line, so nothing
        # is singled out; every cookable item is listed as available (must-use items
        # already have their own line).
        priority_items: list[str] = []
        supporting_items = [
            _format_pantry_item_for_prompt(i)
            for i in scored_items
            if not i.get("_must_use") and i.get("_score", 0) >= 0
        ]
    else:
        priority_items = [
            _format_pantry_item_for_prompt(i) for i in scored_items if i.get("_score", 0) >= 5
        ]
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
    prompt = grounded_recipe_system_prompt(expiry_priority).format(
        recipe_name=recipe_name,
        constraints_json=constraints_json,
        must_use_items=", ".join(must_use_names[:5]) or "none specified",
        priority_items=", ".join(priority_items[:8]) or "none specified",
        preferred_ingredients=preferred_ingredients_str,
        supporting_items=", ".join(supporting_items[:10]) or "none",
        context=context,
    )
    prompt += allergy_never_block(allergies)

    ai_manager = get_ai_manager()

    async def _generate(extra: str) -> LLMRecipeResult:
        return await complete_recipe(
            ai_manager,
            prompt=prompt + extra,
            response_schema=LLMRecipeResult,
            temperature=0.5,
        )

    try:
        # The model is not the only line of defence against an allergen (#500): a card
        # that names one is regenerated once, then refused.
        llm_result = await generate_allergen_safe(
            _generate,
            lambda r: card_allergens(allergies, r.title, _llm_ingredient_names(r)),
            allergies,
        )
    except AllergenViolation as e:
        logger.warning("Grounded recipe refused by the allergen guard: %s", e)
        return _allergen_refusal_state(state, e, f"'{recipe_name}'")
    except NoProviderAvailableError as e:
        logger.error("Grounded recipe generation failed: %s", e)
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": user_message_for_failure(e.kind, e.configured),
            "ai_failure_kind": e.kind,
            "ai_failure_configured": e.configured,
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Recipe generation error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }
    except Exception as e:
        # Includes `BlankRecipeError` (#720): a card with no ingredients or steps,
        # twice, is a failed generation. It is reported as one, never shipped.
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
        steps=build_structured_steps(llm_result.steps, llm_result.instructions),
        cuisine=llm_result.cuisine,
        meal_type=llm_result.meal_type,
        dietary_tags=llm_result.dietary_tags,
        difficulty=llm_result.difficulty,
        tips=llm_result.tips,
        diets_set_aside=list(state.get("dietary_set_aside") or []),
        exclusions_set_aside=list(state.get("dislikes_set_aside") or []),
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
        assistant_message=f"Here's a recipe for {recipe_card.title}!{allergen_safe_note(allergies)}",
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

    # Keep the diet through the tweak (#544). This never writes back to
    # `state["recipe_constraints"]`: a diet set aside for one reply must not be
    # persisted into the session by update_session_node.
    decision = await refine_dietary_constraints(
        state.get("user_id") or "",
        input_text,
        _prior_constraints_from_state(state),
        previous_recipe,
    )
    refine_constraints = decision.constraints

    ai_manager = get_ai_manager()
    try:
        result = await _generate_recipe_followup(
            prompt=input_text,
            pantry_items=pantry_items,
            ai_manager=ai_manager,
            previous_recipe=previous_recipe,
            constraints=refine_constraints,
            allergies=list(decision.allergies),
        )
    except AllergenViolation as e:
        # The pinned card stays as it was: nothing that names an allergen is returned (#500).
        logger.warning("Recipe refinement refused by the allergen guard: %s", e)
        return _allergen_refusal_state(state, e, f"that change to '{previous_recipe.title}'")
    except NoProviderAvailableError as e:
        logger.error("Recipe refinement failed: %s", e)
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": user_message_for_failure(e.kind, e.configured),
            "ai_failure_kind": e.kind,
            "ai_failure_configured": e.configured,
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
    # The set-aside decision carries across every later tweak (#544).
    refined_recipe = result.recipe.model_copy(
        update={
            "id": previous_recipe.id,
            "diets_set_aside": _without_labels(
                _dedupe_labels([*previous_recipe.diets_set_aside, *decision.diets_set_aside_now]),
                decision.diets_restored,
            ),
            "exclusions_set_aside": _without_labels(
                _dedupe_labels(
                    [*previous_recipe.exclusions_set_aside, *decision.exclusions_set_aside_now]
                ),
                decision.exclusions_restored,
            ),
        }
    )

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

    # "I kept out X" only for allergens that really are out of the card: one the user's own
    # recipe still carries is named by the warning instead, never both (#500).
    carried = card_allergens(
        list(decision.allergies),
        refined_recipe.title,
        [i.name for i in refined_recipe.ingredients],
    )
    kept_out = [a for a in decision.allergies if a not in carried]

    envelope = create_recipe_envelope(
        proposal=proposal,
        confidence=0.9,
        field_confidences={},
        warnings=state.get("warnings", []),
        errors=state.get("errors", []),
        assistant_message=(
            f"Updated {refined_recipe.title}!{allergen_safe_note(kept_out)}"
            + (f" {result.allergy_warning}" if result.allergy_warning else "")
        ),
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
