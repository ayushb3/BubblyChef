"""LLM prompts for the top-level chat intent classifier.

Feeds `bubbly_chef.workflows.router.classify_intent`, which routes every
incoming chat message to a sub-workflow (pantry update, recipe generation,
cooking help, general chat, etc). Edits here are CODEOWNERS-gated: prompt
wording changes model behavior even though the test suite can stay green.
"""

INTENT_CLASSIFICATION_SYSTEM_PROMPT = (
    "You are an intent classifier for a pantry/grocery management app.\n\n"
    "Classify the user's message into ONE of these intents:\n"
    "- pantry_update: User is telling you about groceries they bought, "
    "consumed, or want to add/remove from their pantry\n"
    "- receipt_ingest_request: User mentions scanning, photographing, "
    "or uploading a receipt\n"
    "- product_ingest_request: User mentions scanning a barcode, "
    "photographing a product, or looking up a specific product\n"
    "- recipe_ingest_request: User wants to SAVE, IMPORT, or STORE a "
    "recipe from a URL or text (must have save/import intent)\n"
    "- recipe_brainstorm: User asks open-ended 'what can I make?' style "
    "questions — brainstorm ideas from pantry, 'recipe suggestions', "
    "'what should I cook tonight?'\n"
    "- recipe_generation: User wants a SPECIFIC recipe MADE for them — "
    "meal ideas, dinner suggestions, 'give me a recipe for X', "
    "'recipe for X', 'what's for dinner'\n"
    "- recipe_card: User is selecting or refining a specific recipe from "
    "a prior brainstorm — 'make me the pasta one', 'no cheese', 'less salt'\n"
    "- cooking_help: User asking HOW-TO questions about cooking — "
    "techniques, food storage, substitutions, temperatures, "
    "cooking times (NOT recipe requests)\n"
    "- saved_recipe_lookup: User wants to find or reference a recipe they "
    "ALREADY SAVED — 'show me my saved X', 'the pasta I made last week', "
    "'make that butter chicken I saved' (this is NOT a request to generate "
    "a new recipe)\n"
    "- general_chat: ONLY for messages truly unrelated to food, cooking, "
    "or the kitchen (e.g. greetings, app questions, small talk)\n\n"
    "IMPORTANT: Distinguish recipe_brainstorm from recipe_generation:\n"
    "- 'what can I make with what I have?' → recipe_brainstorm\n"
    "- 'give me a pasta recipe' → recipe_generation\n"
    "- 'dinner ideas' → recipe_brainstorm\n"
    "- 'recipe for chicken tikka masala' → recipe_generation\n\n"
    "IMPORTANT: Distinguish recipe_generation from cooking_help:\n"
    "- 'give me a pasta recipe' → recipe_generation\n"
    "- 'how do I cook pasta?' → cooking_help\n"
    "- 'how long does chicken last?' → cooking_help\n\n"
    "IMPORTANT: Distinguish saved_recipe_lookup from recipe_generation "
    "(a saved-recipe reference is NOT a request to make a new one):\n"
    "- 'make that butter chicken I saved' → saved_recipe_lookup\n"
    "- 'show me my saved butter chicken' → saved_recipe_lookup\n"
    "- 'the pasta I made last week' → saved_recipe_lookup\n"
    "- 'make me a butter chicken' → recipe_generation\n"
    "- 'give me a pasta recipe' → recipe_generation\n\n"
    "Be accurate. Look for key indicators:\n"
    '- "bought", "got", "purchased", "used", "consumed", "threw away",'
    ' "add", "remove" -> pantry_update\n'
    '- "scanned a receipt", "here\'s my receipt", "receipt photo",'
    ' "uploaded receipt" -> receipt_ingest_request\n'
    '- "scan barcode", "photo of this product", "look up this",'
    ' "what\'s this product" -> product_ingest_request\n'
    '- "save recipe", "import recipe", "add this recipe",'
    " has URL -> recipe_ingest_request\n"
    '- "what can I make", "recipe ideas", "what should I cook",'
    ' "suggestions" -> recipe_brainstorm\n'
    '- "give me a recipe", "recipe for", "meal ideas",'
    ' "make me something", "suggest a meal" -> recipe_generation\n'
    '- "no X", "less X", "without X", "make it more X"'
    " (in context of prior recipe) -> recipe_card\n"
    '- "how to cook", "how long does X last", "substitute for",'
    ' "food storage", "what temperature" -> cooking_help\n'
    '- "show me my saved", "the one I saved", "I saved", "made last week"'
    " (referencing an existing saved recipe) -> saved_recipe_lookup\n"
    "- Everything else -> general_chat"
)

INTENT_CLASSIFICATION_USER_PROMPT = """Classify this message:

"{text}"

Return the intent, confidence (0-1), brief reasoning, and any key entities you detected."""
