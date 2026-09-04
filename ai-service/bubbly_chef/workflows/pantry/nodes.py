"""
Pantry workflow nodes extracted from chat_ingest.py.

These are the pure node functions for the pantry-update path of the
chat router graph. They operate on WorkflowState (not a sub-state) so
they can be dropped directly into the existing StateGraph.
"""

import logging
from datetime import date
from uuid import uuid4

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.config import settings
from bubbly_chef.domain.normalizer import (
    normalize_food_name,
    normalize_to_base_unit,
    resolve_category,
)
from bubbly_chef.models.base import NextAction, WorkflowStatus
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
)
from bubbly_chef.tools.expiry import get_expiry_heuristics
from bubbly_chef.workflows.state import (
    LLMParseResult,
    WorkflowState,
    map_action_type,
    map_category,
)

logger = logging.getLogger(__name__)


# =============================================================================
# LLM Prompts (pantry-specific)
# =============================================================================

PANTRY_PARSE_SYSTEM_PROMPT = """You are a grocery/pantry item extractor.

Extract ALL grocery items mentioned in the text. For each item:
- name: the item name (e.g., "milk", "eggs", "bread")
- quantity: numeric amount (default 1 if not specified)
- unit: unit of measurement (e.g., "gallon", "dozen", "lb", "item")
- category: food category (produce, dairy, meat, seafood, frozen,
  canned, dry_goods, condiments, beverages, snacks, bakery, other)
- action: "add" for purchases, "remove" for items used/thrown out,
  "use" for partial consumption
- confidence: how confident you are about this item (0-1)

Rules:
1. Be conservative - only extract items you're confident about
2. Default quantity to 1 if unclear
3. Default unit to "item" if not specified
4. Be specific with categories
5. Mark low confidence (< 0.7) for ambiguous items"""

PANTRY_PARSE_USER_PROMPT = """Extract grocery items from:

"{text}"

Return a list of items with name, quantity, unit, category, action, and confidence."""


# =============================================================================
# Generic-term detection
# =============================================================================

# Category-level words that don't identify a specific food — "veggies" or
# "dairy" can't be given an expiry estimate or matched against a recipe
# ingredient list the way "broccoli" or "yogurt" can.
_GENERIC_CATEGORY_WORDS = {
    "veggie", "veggies", "vegetable", "vegetables", "produce",
    "dairy", "meat", "meats", "fruit", "fruits", "snack", "snacks",
    "drink", "drinks", "beverage", "beverages", "seafood",
    "condiment", "condiments", "grocery", "groceries",
    "food", "foods", "supplies", "ingredient", "ingredients",
}
# Filler nouns that turn a category word into an even vaguer phrase
# ("dairy stuff", "dairy things") without adding any specificity.
_GENERIC_FILLER_WORDS = {"stuff", "things", "products", "items", "item"}


def _is_generic_pantry_term(name: str) -> bool:
    """True for a category-level word with no specific food identified.

    Catches "veggies", "dairy stuff", "dairy things", bare "stuff" — terms
    broad enough that writing them to the pantry as a literal item name
    would be meaningless. Specific foods ("greek yogurt", "cheddar cheese")
    are untouched.
    """
    words = name.strip().lower().split()
    if not words:
        return False
    if len(words) == 1:
        return words[0] in _GENERIC_CATEGORY_WORDS or words[0] in _GENERIC_FILLER_WORDS
    if len(words) == 2 and words[1] in _GENERIC_FILLER_WORDS:
        return words[0] in _GENERIC_CATEGORY_WORDS
    return False


# =============================================================================
# Node Functions
# =============================================================================


async def parse_pantry_items(state: WorkflowState) -> WorkflowState:
    """
    Node: Use LLM to parse free text into structured pantry items.

    This is the second LLM call in the pantry update path.
    """
    input_text = state.get("input_text", "")
    ai_manager = get_ai_manager()
    prompt = PANTRY_PARSE_SYSTEM_PROMPT + "\n\n" + PANTRY_PARSE_USER_PROMPT.format(text=input_text)

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=LLMParseResult,
            temperature=0.1,
        )

        if not isinstance(result, LLMParseResult) or len(result.items) == 0:
            return {
                **state,
                "parsed_items": [],
                "parse_error": "No items found",
                "assistant_message": (
                    "I couldn't identify any specific grocery items."
                    " Could you be more specific?"
                    " For example: 'I bought 2 gallons of milk'"
                ),
                "next_action": NextAction.REQUEST_CLARIFICATION.value,
                "clarifying_questions": ["What items would you like to add or update?"],
                "requires_review": True,
            }

        parsed_items = [item.model_dump() for item in result.items]
        per_item_confidences = [item.confidence for item in result.items]
        logger.info(f"Parsed {len(parsed_items)} items with confidence {result.confidence}")

        return {
            **state,
            "parsed_items": parsed_items,
            "parse_error": None,
            "confidence": result.confidence,
            "per_item_confidences": per_item_confidences,
        }

    except NoProviderAvailableError as e:
        logger.error(f"No AI provider available for pantry parsing: {e}")
        return {
            **state,
            "parsed_items": [],
            "parse_error": str(e),
            "errors": state.get("errors", []) + ["no_ai_provider"],
            "confidence": 0.0,
            "requires_review": True,
        }
    except Exception as e:
        logger.error(f"Pantry parse error: {e}")
        return {
            **state,
            "parsed_items": [],
            "parse_error": str(e),
            "errors": state.get("errors", []) + [f"LLM error: {e}"],
            "confidence": 0.0,
            "requires_review": True,
        }


def normalize_items(state: WorkflowState) -> WorkflowState:
    """
    Node: Normalize item names and categories (deterministic).

    No LLM calls here - pure rule-based normalization.

    The display name a chat user typed is written to the pantry unchanged —
    see issue #257. ``normalize_food_name`` is a *match key* for internal
    lookups (category, unit/density resolution), not a display-name rewriter:
    it used to overwrite "chicken" with "chicken breast" and similar, which is
    data loss the user never asked for. It is still used here, but only to
    resolve those internal lookups; ``normalized_name`` never reaches the
    ``name`` field written to the pantry row. See
    ``receipt_ingest.normalize_receipt_items`` for the same fix applied to
    receipts.
    """
    parsed_items = state.get("parsed_items", [])

    normalized = []
    warnings = list(state.get("warnings", []))
    updated_confidences = list(state.get("per_item_confidences", []))

    for idx, item in enumerate(parsed_items):
        name = item.get("name", "")
        original_name = name

        # Match key only (category/unit lookups below) — never written back as
        # the display name. See the node docstring.
        normalized_name = normalize_food_name(name)

        # Get category (use resolve_category's head-noun/catalog fallback if
        # the LLM didn't provide a good one)
        llm_category = item.get("category")
        if llm_category and llm_category.lower() != "other":
            category = map_category(llm_category)
        else:
            resolved = resolve_category(normalized_name)
            category = map_category(resolved) if resolved else FoodCategory.OTHER
            if category == FoodCategory.OTHER:
                warnings.append(f"Could not determine category for '{original_name}'")

        # Check for missing/ambiguous data that might lower confidence
        item_confidence = item.get("confidence", 0.8)

        if not item.get("quantity") or item.get("quantity") == 1:
            # Default quantity - might be correct but lower confidence
            item_confidence = min(item_confidence, 0.75)

        if item.get("unit", "item") == "item":
            # Default unit - might need clarification
            pass  # Keep confidence as-is for now

        if category == FoodCategory.OTHER:
            item_confidence = min(item_confidence, 0.65)

        is_generic = _is_generic_pantry_term(original_name)
        if is_generic:
            # create_actions drops is_generic_term items from the proposal
            # outright, regardless of confidence — this cap isn't what keeps
            # the item off the card. It exists because `confidence` below is
            # an average over every parsed item including this one: without
            # it, a batch like "veggies" + "2 apples" (apples scored 0.9)
            # could average out high enough to slip past review_gate's
            # overall-confidence threshold even though a term went unresolved.
            item_confidence = min(item_confidence, 0.1)

        # Update confidence
        if idx < len(updated_confidences):
            updated_confidences[idx] = item_confidence
        else:
            updated_confidences.append(item_confidence)

        normalized_item = {
            **item,
            "name": name,
            "original_name": original_name,
            "category": category.value,
            "confidence": item_confidence,
            "is_generic_term": is_generic,
        }

        # Compute base unit quantities for math operations (dual-store)
        qty_base, unit_base = normalize_to_base_unit(
            name=normalized_name,
            quantity=float(item.get("quantity", 1.0)),
            unit=str(item.get("unit", "item")),
            category=category.value,
        )
        # F6: guard before assignment — mypy strict requires None check
        if qty_base is not None:
            normalized_item["quantity_base"] = qty_base
            normalized_item["unit_base"] = unit_base
        else:
            normalized_item["quantity_base"] = None
            normalized_item["unit_base"] = None

        normalized.append(normalized_item)

        if normalized_name != original_name:
            logger.debug(f"Normalized '{original_name}' -> '{normalized_name}'")

    # Recalculate overall confidence
    if updated_confidences:
        overall_confidence = sum(updated_confidences) / len(updated_confidences)
    else:
        overall_confidence = state.get("confidence", 0.0)

    return {
        **state,
        "normalized_items": normalized,
        "warnings": warnings,
        "per_item_confidences": updated_confidences,
        "confidence": overall_confidence,
    }


def apply_expiry_heuristics(state: WorkflowState) -> WorkflowState:
    """
    Node: Apply expiry date estimates (deterministic).

    Uses category-based heuristics to estimate expiry dates.
    """
    normalized_items = state.get("normalized_items", [])
    expiry = get_expiry_heuristics()

    with_expiry = []

    for item in normalized_items:
        category = map_category(item.get("category", "other"))
        storage = expiry.get_default_storage(category)

        # Estimate expiry
        expiry_date, is_estimated = expiry.estimate_expiry(
            category=category,
            storage=storage,
            name=item.get("name"),
            purchase_date=date.today(),
        )

        updated_item = {
            **item,
            "storage_location": storage.value,
            "expiry_date": expiry_date.isoformat(),
            "estimated_expiry": is_estimated,
            "purchase_date": date.today().isoformat(),
        }
        with_expiry.append(updated_item)

    return {
        **state,
        "normalized_items": with_expiry,
    }


def check_for_duplicates(state: WorkflowState) -> WorkflowState:
    """
    Node: Check for potential duplicates in the proposal.

    If pantry_snapshot is provided, check against it.
    Also check for duplicates within the current batch.
    """
    normalized_items = state.get("normalized_items", [])
    pantry_snapshot = state.get("pantry_snapshot", [])
    warnings = list(state.get("warnings", []))

    # Check for duplicates within batch
    seen_names = set()
    for item in normalized_items:
        name_lower = item.get("name", "").lower()
        if name_lower in seen_names:
            warnings.append(f"Duplicate item detected: '{item.get('name')}'")
        seen_names.add(name_lower)

    # Check against pantry snapshot if provided
    if pantry_snapshot:
        pantry_names = {p.get("name", "").lower() for p in pantry_snapshot}
        for item in normalized_items:
            name_lower = item.get("name", "").lower()
            if name_lower in pantry_names and item.get("action") == "add":
                warnings.append(
                    f"'{item.get('name')}' may already be in your "
                    "pantry. Consider updating quantity instead."
                )

    return {
        **state,
        "warnings": warnings,
    }


def create_actions(state: WorkflowState) -> WorkflowState:
    """
    Node: Convert normalized items to PantryUpsertAction objects.

    Items flagged ``is_generic_term`` by ``normalize_items`` (e.g. "veggies",
    "dairy stuff") are excluded here rather than merely down-weighted — a
    generic term must never reach the proposal actions list, because that
    list is exactly what the "Add to Pantry" button on the chat card writes
    to the database. They're surfaced instead as a name in
    ``generic_pantry_terms`` for review_gate to turn into a clarifying
    question.
    """
    normalized_items = state.get("normalized_items", [])
    per_item_confidences = state.get("per_item_confidences", [])

    actions = []
    field_confidences = {}
    generic_pantry_terms: list[str] = []
    seen_keys: dict[str, int] = {}  # Track key counts for dedup

    for idx, item_data in enumerate(normalized_items):
        if item_data.get("is_generic_term"):
            generic_pantry_terms.append(item_data.get("original_name") or item_data.get("name", ""))
            continue

        category = map_category(item_data.get("category"))
        name = item_data.get("name", "unknown")

        # Create deterministic client_item_key
        base_key = f"{category.value}:{name.lower().strip().replace(' ', '_')}"

        # Handle duplicate keys within same batch
        if base_key in seen_keys:
            seen_keys[base_key] += 1
            client_key = f"{base_key}#{seen_keys[base_key]}"
        else:
            seen_keys[base_key] = 1
            client_key = base_key

        # Create PantryItem (without DB ID - that's assigned at apply time)
        pantry_item = PantryItem(
            id=uuid4(),  # Temporary ID for reference in proposal
            client_item_key=client_key,
            name=name,
            original_name=item_data.get("original_name"),
            category=category,
            storage_location=item_data.get("storage_location", "pantry"),
            quantity=item_data.get("quantity", 1.0),
            unit=item_data.get("unit", "item"),
            quantity_base=item_data.get("quantity_base"),
            unit_base=item_data.get("unit_base"),
            purchase_date=date.fromisoformat(item_data["purchase_date"])
            if item_data.get("purchase_date")
            else None,
            expiry_date=date.fromisoformat(item_data["expiry_date"])
            if item_data.get("expiry_date")
            else None,
            estimated_expiry=item_data.get("estimated_expiry", True),
        )

        # Create action
        action_type = map_action_type(item_data.get("action", "add"))

        # Get per-item confidence
        item_confidence = per_item_confidences[idx] if idx < len(per_item_confidences) else 0.5

        action = PantryUpsertAction(
            action_type=action_type,
            item=pantry_item,
            confidence=item_confidence,
            reasoning=f"Parsed from text: '{item_data.get('original_name', pantry_item.name)}'",
        )
        actions.append(action)

        # Track field confidence
        field_confidences[f"item_{idx}_name"] = item_confidence
        field_confidences[f"item_{idx}_quantity"] = item_confidence

    return {
        **state,
        "actions": actions,
        "field_confidences": field_confidences,
        "generic_pantry_terms": generic_pantry_terms,
    }


def review_gate(state: WorkflowState) -> WorkflowState:
    """
    Node: Determine if review is required and build clarifying questions.

    This implements the human-in-the-loop pattern.

    Policy:
    - REQUEST_CLARIFICATION: Cannot proceed safely without user input
      (low confidence, missing fields, ambiguous items)
    - REVIEW_PROPOSAL: Usable proposal but needs user approval
      (medium confidence, normalization applied, dedup warnings)
    - NONE: High confidence, can auto-apply
    """
    actions = state.get("actions", [])
    confidence = state.get("confidence", 0.0)
    errors = state.get("errors", [])
    generic_pantry_terms = state.get("generic_pantry_terms", [])

    clarifying_questions = []
    requires_review = False
    needs_clarification = False
    should_interrupt = False

    # Threshold for per-item "we're not sure" flag
    item_clarification_threshold = 0.6

    # Check for low confidence items that need clarification. Reads
    # action.confidence (set per-action in create_actions) rather than
    # zipping per_item_confidences back onto actions by index — actions can
    # be shorter than the normalized/per-item lists now that generic terms
    # are dropped before this point, so a positional zip would silently pair
    # the wrong confidence with the wrong item.
    low_confidence_items = [
        action.item.name for action in actions if action.confidence < item_clarification_threshold
    ]

    if low_confidence_items:
        # Ask about specific ambiguous items
        if len(low_confidence_items) == 1:
            clarifying_questions.append(
                f"I'm not sure about '{low_confidence_items[0]}'"
                " - what size or quantity did you mean?"
            )
        else:
            clarifying_questions.append(
                f"I'm not sure about: {', '.join(low_confidence_items)}. Could you clarify?"
            )
        needs_clarification = True

    # Check for default quantity + unit (ambiguous amount)
    for action in actions:
        item = action.item
        if item.quantity == 1 and item.unit == "item":
            # Only flag if also low confidence
            if action.confidence < item_clarification_threshold:
                if item.name not in low_confidence_items:
                    clarifying_questions.append(
                        f"How much {item.name} did you mean? (e.g., '1 jar', '2 cans')"
                    )
                    needs_clarification = True
        elif item.quantity > 50:
            clarifying_questions.append(
                f"You mentioned {item.quantity} {item.unit}"
                f" of {item.name}. Did you mean this quantity?"
            )
            needs_clarification = True

    # Generic category terms ("veggies", "dairy stuff") never made it into
    # `actions` (create_actions drops them) — surface them as their own
    # clarifying question rather than silently going unaddressed. Inserted
    # at the front: assistant_message below only ever shows
    # clarifying_questions[0], and explaining a dropped item outranks a
    # quantity nuance on an item that's still in the proposal — otherwise a
    # message mixing "2 eggs" (low-confidence quantity) with "veggies"
    # (dropped entirely) could surface the eggs question and never mention
    # that veggies didn't make it in at all.
    if generic_pantry_terms:
        if len(generic_pantry_terms) == 1:
            clarifying_questions.insert(
                0,
                f"'{generic_pantry_terms[0]}' is pretty broad — what did you actually pick up?"
                " (e.g. onions, broccoli, milk, yogurt)",
            )
        else:
            clarifying_questions.insert(
                0,
                f"{', '.join(generic_pantry_terms)} are pretty broad — what did you actually"
                " pick up? Naming the specific items lets me add them for real.",
            )
        needs_clarification = True

    # Determine overall status based on confidence
    if not actions:
        # No actions - definitely need clarification
        next_action = NextAction.REQUEST_CLARIFICATION.value
        requires_review = True
        needs_clarification = True
    elif confidence < settings.review_confidence_threshold:
        # Overall low confidence - need clarification
        next_action = NextAction.REQUEST_CLARIFICATION.value
        requires_review = True
        needs_clarification = True
        should_interrupt = True
        if not clarifying_questions:
            clarifying_questions.append(
                "I'm not confident about this. Could you confirm or provide more details?"
            )
    elif needs_clarification:
        # Some items need clarification
        next_action = NextAction.REQUEST_CLARIFICATION.value
        requires_review = True
        should_interrupt = True
    elif confidence < settings.auto_apply_confidence_threshold:
        # Medium confidence - usable but needs review
        next_action = NextAction.REVIEW_PROPOSAL.value
        requires_review = True
    elif errors:
        # Has errors - needs review
        next_action = NextAction.REVIEW_PROPOSAL.value
        requires_review = True
    else:
        # High confidence - can auto-apply
        next_action = NextAction.NONE.value
        requires_review = False

    # Build assistant message
    num_items = len(actions)
    if num_items == 0:
        if generic_pantry_terms:
            assistant_message = (
                "I don't want to add anything that vague to your pantry."
            )
        else:
            assistant_message = "I couldn't identify any pantry items. Could you be more specific?"
    elif num_items == 1:
        item = actions[0].item
        action_verb = "add" if actions[0].action_type == ActionType.ADD else "update"
        assistant_message = (
            f"I found 1 item to {action_verb}: {item.quantity} {item.unit} of {item.name}."
        )
    else:
        assistant_message = f"I found {num_items} items. Please review before updating your pantry."

    if clarifying_questions:
        assistant_message += f" {clarifying_questions[0]}"

    # Context continuity: `session.pending_proposal` (written by
    # update_session_node the *previous* turn — this node runs before this
    # turn's own session update) carries item names raised earlier in the
    # conversation that the user hasn't resolved yet, either a real proposal
    # still sitting unapproved or a generic term never clarified. Without
    # this, each pantry-update turn reads as if it started a brand new
    # conversation.
    session = state.get("session") or {}
    pending = session.get("pending_proposal") or {}
    current_names_lower = {action.item.name.lower() for action in actions}
    current_generic_lower = {term.lower() for term in generic_pantry_terms}

    still_pending_items = [
        name
        for name in pending.get("item_names", [])
        if name.lower() not in current_names_lower
    ]
    still_unclear_terms = [
        term
        for term in pending.get("unclear_terms", [])
        if term.lower() not in current_generic_lower
    ]

    context_note = None
    if still_pending_items and still_unclear_terms:
        context_note = (
            f"(Still with {', '.join(still_pending_items)} from earlier, and I still "
            f"don't know what you meant by {', '.join(still_unclear_terms)}.)"
        )
    elif still_pending_items:
        context_note = f"(Still with {', '.join(still_pending_items)} from earlier in this chat.)"
    elif still_unclear_terms:
        context_note = (
            f"(Also still waiting to hear what you meant by {', '.join(still_unclear_terms)}.)"
        )

    if context_note:
        assistant_message = f"{context_note} {assistant_message}"

    return {
        **state,
        "requires_review": requires_review,
        "should_interrupt": should_interrupt,
        "clarifying_questions": clarifying_questions,
        "next_action": next_action,
        "assistant_message": assistant_message,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value
        if requires_review
        else WorkflowStatus.COMPLETED.value,
    }


def finalize_pantry_proposal(state: WorkflowState) -> WorkflowState:
    """
    Node: Create final PantryProposal from state.
    """
    actions = state.get("actions", [])
    input_text = state.get("input_text", "")

    proposal = PantryProposal(
        actions=actions,
        source_text=input_text,
        dedup_applied=bool(state.get("pantry_snapshot")),
        normalization_applied=True,
    )

    return {
        **state,
        "proposal": proposal,
    }
