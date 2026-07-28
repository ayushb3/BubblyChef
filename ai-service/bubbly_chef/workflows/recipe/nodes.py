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
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.recipe import (
    Ingredient,
    IngredientAvailability,
    RecipeCard,
    RecipeCardProposal,
    RecipeConstraints,
)
from bubbly_chef.repository.supabase_repo import get_repository
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
# Recipe Grounding — LLM Prompts
# =============================================================================

RECIPE_CONSTRAINTS_SYSTEM_PROMPT = (
    "Extract cooking constraints from the user's message. "
    "Return structured data: cuisine preference, meal_type (breakfast/lunch/dinner/snack), "
    "mood/style, dietary restrictions, time limit, servings, skill level, "
    "and any ingredients they specifically want to include or exclude. "
    "If a field is not mentioned, leave it as null/empty.\n\n"
    "Distinguish the two ingredient-inclusion fields carefully:\n"
    "- must_use_ingredients: the user names a specific ingredient they want to USE UP "
    "or cook WITH. Any phrasing that anchors the request to a named ingredient counts — "
    "'what can I make with my eggs', 'use up my spinach before it goes bad', "
    "'I need to finish the chicken', 'something with the leftover rice', "
    "'recipe using my tomatoes'.\n"
    "- preferred_ingredients: a softer nice-to-have — 'I'm in the mood for something "
    "with cheese', 'maybe add mushrooms'.\n\n"
    "Record only the ingredient name in must_use_ingredients (e.g. 'eggs', not "
    "'my eggs' or 'eggs before they go bad'). Leave it empty if the user names no "
    "specific ingredient (e.g. 'what's for dinner?', 'give me a quick pasta recipe' — "
    "'pasta' there is a dish, not an ingredient the user is using up)."
)

BRAINSTORM_SYSTEM_PROMPT = """\
You are a creative cooking assistant. Given the user's available ingredients \
and constraints, suggest 3-4 recipe ideas.

Rules:
- Each idea should be a recipe name (2-5 words), not a full recipe
- If "Must use" ingredients are listed, EVERY idea must actually use them — \
this overrides every other preference
- Prioritize ingredients marked as expiring soon
- Match the cuisine/mood if specified
- ALL suggestions must be for the same meal type — if meal_type is specified, \
every idea must fit that meal (don't mix breakfast and dinner)
- Only suggest recipes that can realistically be made with 60%+ of the listed ingredients
- Format: conversational text with **bold** recipe names in a numbered list
- End with a prompt like "Which one sounds good?" or "Want me to make any of these?"\
"""

GROUNDED_RECIPE_SYSTEM_PROMPT = """\
Generate a complete recipe card for "{recipe_name}".

Constraints: {constraints_json}
Must-use ingredients (the user asked to cook with these — the recipe MUST \
include them): {must_use_items}
Priority ingredients (expiring soon — use first): {priority_items}
Supporting ingredients available: {supporting_items}
Context: {context}

Generate a full recipe with:
- title, description
- ingredients: a list of objects, each with keys:
    "name" (ingredient name, e.g. "chicken breast"),
    "quantity" (numeric amount, e.g. 2),
    "unit" (measurement unit, e.g. "cups", "medium", "tablespoon"),
    "preparation" (optional prep note, e.g. "diced"),
    "optional" (boolean, default false),
    "substitutes" (list of substitute ingredient names, default [])
- step-by-step instructions
- prep_time_minutes, cook_time_minutes, total_time_minutes
- difficulty (easy/medium/hard)
- servings
- cuisine, meal_type, dietary_tags
- tips

Prioritize using the listed available ingredients. \
For any missing ingredients, suggest pantry substitutes where possible.\
"""


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


def extract_selected_recipe(
    user_text: str,
    history: list[dict[str, Any]],
) -> str:
    """Extract which recipe the user selected from the last brainstorm response."""
    from rapidfuzz import fuzz  # local import — optional dep already in pyproject.toml

    brainstorm_text = ""
    for turn in reversed(history):
        if turn.get("role") == "assistant" and turn.get("intent") == Intent.RECIPE_BRAINSTORM.value:
            brainstorm_text = turn.get("content", "")
            break

    # Extract **bold** recipe names from brainstorm
    ideas: list[str] = re.findall(r"\*\*(.+?)\*\*", brainstorm_text)

    if not ideas:
        return user_text  # fallback: use raw user text as recipe name

    ordinal_map = {
        "first": 0, "second": 1, "third": 2, "fourth": 3,
        "1st": 0, "2nd": 1, "3rd": 2, "4th": 3,
        "one": 0, "two": 1, "three": 2, "four": 3,
    }
    text_lower = user_text.lower()

    for word, idx in ordinal_map.items():
        if word in text_lower and idx < len(ideas):
            return ideas[idx]

    if any(kw in text_lower for kw in ["surprise", "any", "random", "you pick", "all of them"]):
        return ideas[0]

    # Fuzzy match against idea names
    best_match = max(ideas, key=lambda idea: fuzz.partial_ratio(text_lower, idea.lower()))
    if fuzz.partial_ratio(text_lower, best_match.lower()) > 50:
        return best_match

    return user_text


def score_and_rank(
    pantry_items: list[dict[str, Any]],
    constraints: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Deterministically score and rank pantry items for recipe grounding.

    Scoring:
    - item in must_use_ingredients: +20 (also tagged `_must_use`)
    - days_until_expiry <= 3: +10
    - days_until_expiry <= 7: +5
    - item name matches cuisine keywords: +3
    - item in preferred_ingredients: +5
    - item in excluded_ingredients: -100

    Scores compose — a must-use item that is also expiring outranks one that
    isn't, so expiry urgency still orders items within the must-use group.
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

        # "Use up my X" — dominates expiry so the named ingredient leads the list
        is_must_use = any(m in name_lower or name_lower in m for m in must_use)
        if is_must_use:
            score += 20

        # Expiry urgency
        expiry_str = item.get("expiry_date")
        if expiry_str:
            try:
                expiry = date.fromisoformat(str(expiry_str))
                days_left = (expiry - today).days
                if days_left <= 3:
                    score += 10
                elif days_left <= 7:
                    score += 5
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

        scored.append({**item, "_score": score, "_must_use": is_must_use})

    scored.sort(key=lambda x: x.get("_score", 0), reverse=True)
    # Filter out excluded items (negative score)
    scored = [s for s in scored if s.get("_score", 0) >= 0]
    return scored[:15]


# =============================================================================
# Recipe Grounding — Workflow Nodes
# =============================================================================


def _default_meal_type() -> str:
    """Infer meal type from current time of day."""
    hour = datetime.now().hour
    if 5 <= hour < 10:
        return "breakfast"
    elif 10 <= hour < 14:
        return "lunch"
    elif 14 <= hour < 17:
        return "snack"
    elif 17 <= hour < 21:
        return "dinner"
    else:
        return "late-night snack"


async def extract_recipe_constraints(state: WorkflowState) -> WorkflowState:
    """Node: Extract recipe constraints from user message via structured LLM call."""
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
            constraints = result.model_dump()
        else:
            constraints = {}
    except Exception as e:
        logger.warning("Constraint extraction failed (using empty constraints): %s", e)
        constraints = {}

    # Default meal_type from time of day when user didn't specify
    if not constraints.get("meal_type"):
        constraints["meal_type"] = _default_meal_type()
        logger.info("Defaulted meal_type=%s from time of day", constraints["meal_type"])

    return {
        **state,
        "recipe_constraints": constraints,
    }


async def score_pantry_ingredients(state: WorkflowState) -> WorkflowState:
    """Node: Score and rank pantry items by expiry urgency + constraint match."""
    pantry_items: list[dict[str, Any]] = state.get("pantry_snapshot") or []
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    logger.info("Scoring pantry ingredients", extra={"constraints": constraints})

    # Fetch from DB if no snapshot was passed in
    if not pantry_items:
        try:
            repo = await get_repository()
            db_items = await repo.get_all_pantry_items(state.get("user_id", ""))
            pantry_items = [it.model_dump(mode="json") for it in db_items]
        except Exception as e:
            logger.warning("Could not fetch pantry for scoring: %s", e)

    scored = score_and_rank(pantry_items, constraints)

    return {
        **state,
        "scored_pantry_items": scored,
    }


_MODE_SYSTEM_PROMPTS: dict[str, str] = {
    "chat": "",
    "text": "",
    "voice": "",
    "recipe": (
        "You are in RECIPE MODE. The user wants recipe suggestions.\n"
        "Always respond with a structured recipe when possible — include title, "
        "ingredients with quantities, step-by-step instructions, prep/cook time, "
        "and difficulty level.\n"
        "Prioritize ingredients the user already has in their pantry.\n"
        "If they ask something non-recipe, still help but gently steer back "
        "toward cooking.\n\n"
    ),
    "learn": (
        "You are in LEARN TO COOK MODE. The user wants to learn cooking skills.\n"
        "Explain the 'why' behind techniques, not just the 'how'. Use analogies.\n"
        "Break complex techniques into small, approachable steps.\n"
        "Be encouraging and patient — assume the user is a beginner unless they "
        "show otherwise.\n"
        "Suggest practice exercises when appropriate.\n\n"
    ),
}


def _get_mode_prefix(state: WorkflowState) -> str:
    """Return the system prompt prefix for the current chat mode."""
    mode = state.get("input_mode", "chat")
    return _MODE_SYSTEM_PROMPTS.get(mode, "")


def _format_history_context(state: WorkflowState, max_turns: int = 10) -> str:
    """Format recent conversation history for injection into LLM prompts."""
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

    # Build ingredient summary for the prompt
    if scored_items:
        must_use = [i for i in scored_items if i.get("_must_use")]
        rest = [i for i in scored_items if not i.get("_must_use")]
        expiring = [i for i in rest if i.get("_score", 0) >= 10]
        supporting = [
            i for i in rest
            if i.get("_score", 0) < 10 and i.get("_score", 0) >= 0
        ]
        expiring_str = ", ".join(i.get("name", "") for i in expiring[:5])
        supporting_str = ", ".join(i.get("name", "") for i in supporting[:10])
        pantry_context = ""
        if must_use:
            must_use_str = ", ".join(i.get("name", "") for i in must_use[:5])
            pantry_context += f"\nMust use (the user asked to cook with these): {must_use_str}"
        pantry_context += f"\nExpiring soon (prioritize): {expiring_str or 'none'}"
        pantry_context += f"\nOther available: {supporting_str or 'none'}"
    else:
        pantry_context = "\nNo pantry items available — suggest general recipes."

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
    if constraints.get("excluded_ingredients"):
        constraints_str += f"\nExclude: {', '.join(constraints['excluded_ingredients'])}"

    history_context = _format_history_context(state)
    mode_prefix = _get_mode_prefix(state)
    prompt = (
        mode_prefix
        + BRAINSTORM_SYSTEM_PROMPT
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
    except NoProviderAvailableError:
        response_text = (
            "I'd love to suggest some recipes, but no AI provider is configured. "
            "Please add a Gemini API key or start Ollama."
        )
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
    """Node: Search DuckDuckGo for the selected recipe, store grounding context."""
    recipe_name: str = state.get("selected_recipe_name") or state.get("input_text", "")
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    cuisine_tag = constraints.get("cuisine")

    search_result = await search_recipe(recipe_name, cuisine_tag=cuisine_tag)

    return {
        **state,
        "web_search_result": search_result.model_dump() if search_result else None,
    }


async def generate_grounded_recipe(state: WorkflowState) -> WorkflowState:
    """Node: Generate full structured recipe using research + pantry context."""
    recipe_name: str = state.get("selected_recipe_name") or state.get("input_text", "recipe")
    logger.info("Generating grounded recipe", extra={"recipe_name": recipe_name})
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    scored_items: list[dict[str, Any]] = state.get("scored_pantry_items") or []
    web_result: dict[str, Any] | None = state.get("web_search_result")

    # If pantry wasn't scored yet (direct recipe_card path), try to load & score now
    if not scored_items:
        pantry_snapshot: list[dict[str, Any]] = state.get("pantry_snapshot") or []
        if not pantry_snapshot:
            try:
                repo = await get_repository()
                items = await repo.get_all_pantry_items(state.get("user_id", ""))
                pantry_snapshot = [i.model_dump(mode="json") for i in items]
            except Exception as e:
                logger.warning("Could not fetch pantry for recipe generation: %s", e)
        if pantry_snapshot:
            scored_items = score_and_rank(pantry_snapshot, constraints)

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

    constraints_json = _json.dumps({k: v for k, v in constraints.items() if v})
    prompt = GROUNDED_RECIPE_SYSTEM_PROMPT.format(
        recipe_name=recipe_name,
        constraints_json=constraints_json,
        must_use_items=", ".join(must_use_names[:5]) or "none specified",
        priority_items=", ".join(priority_items[:8]) or "none specified",
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
            else:
                availability.append(IngredientAvailability(name=ing.name, status="missing"))
                missing.append(ing.name)
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
