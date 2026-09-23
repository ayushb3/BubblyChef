"""LLM prompts for the pantry-update chat path.

Feeds `bubbly_chef.workflows.pantry.nodes`: `parse_pantry_items` (free-text
grocery extraction) and `suggest_specifics` (turning a vague term like
"veggies" into concrete tappable suggestions). Edits here are CODEOWNERS-gated:
prompt wording changes model behavior even though the test suite can stay
green.
"""

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


SUGGEST_SPECIFICS_SYSTEM_PROMPT = """You help a grocery/pantry app turn vague terms into
concrete suggestions. For each vague term below, list 3-5 concrete, commonly-bought
grocery items it could plausibly mean. Be specific (e.g. "onion", "broccoli", not
"vegetable"). Keep each suggestion to 1-3 words."""

SUGGEST_SPECIFICS_USER_PROMPT = """The user said: "{text}"

These terms from that message were too vague to add to their pantry directly: {terms}

For each term, suggest 3-5 concrete grocery items it could mean."""
