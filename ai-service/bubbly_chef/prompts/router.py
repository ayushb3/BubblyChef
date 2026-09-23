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
    "- Everything else -> general_chat"
)

INTENT_CLASSIFICATION_USER_PROMPT = """Classify this message:

"{text}"

Return the intent, confidence (0-1), brief reasoning, and any key entities you detected."""

# Session-mode bias appended to the classifier system prompt as a soft prior
# (#416). The classifier can still return any intent; these only tilt it.

MODE_BIAS_RECIPE_PICKED_PROMPT = (
    "\n\nSESSION CONTEXT: The user is in recipe-exploring mode with a picked recipe. "
    "Bias toward 'recipe_card' for a follow-up that COMMANDS a tweak, "
    "substitution, or refinement of the current recipe (e.g. 'make it spicier', "
    "'no cheese', 'add a fig glaze', 'swap the cream for yoghurt'). "
    "Only classify as 'recipe_brainstorm' if the user clearly wants to start fresh "
    "(e.g. 'actually something else', 'show me different options', 'start over'). "
    "CRITICAL — question vs. command: a follow-up that ASKS ABOUT the current "
    "recipe rather than telling you to change it is 'cooking_help', NOT 'recipe_card'. "
    "Do NOT rewrite the card to answer a question. Examples that are 'cooking_help': "
    "'does it have yogurt?', 'is this a traditional stroganoff?', 'why sourdough?', "
    "'can I use butter instead of oil?' (asking whether, not instructing), "
    "'how long will it keep?', 'what does the flour do?'. "
    "The line: an IMPERATIVE that changes the recipe is 'recipe_card'; an "
    "INTERROGATIVE about the recipe (does/is/why/what/can-I/should-I as a genuine "
    "question) is 'cooking_help'. "
    "A modification phrased as a question ('add a fig glaze?') is still a "
    "command to modify — that stays 'recipe_card'. But a genuine question seeking "
    "an answer ('does it have X?') is 'cooking_help'. "
    "CRITICAL: adding, removing, or substituting a NAMED INGREDIENT is ALWAYS a plain "
    "tweak (recipe_card), no matter how tentatively it is phrased — 'add mushrooms', "
    "'can we add mushrooms', 'could we throw in some garlic', 'swap the cream for yoghurt' "
    "are all clear tweaks and do NOT get the ambiguous flag. "
    "IMPORTANT: set modify_or_new_ambiguous:true ONLY when the follow-up names a "
    "DIFFERENT DISH or DISH-TYPE rather than editing the current one — i.e. it could "
    "plausibly mean 'make me a different recipe instead' "
    "(e.g. 'hmm what about something with mushrooms', 'what about a pasta dish?', "
    "'could we do something lighter?'). That is the only fuzzy middle ground; "
    "ingredient edits, clear tweaks, and clear new-dish requests all do NOT get this flag."
)

MODE_BIAS_RECIPE_BROWSING_PROMPT = (
    "\n\nSESSION CONTEXT: The user is browsing recipe brainstorm ideas. "
    "Bias toward 'recipe_card' if the user is selecting or refining a specific idea. "
    "Use 'recipe_brainstorm' if they want new ideas."
)

MODE_BIAS_COOKING_PROMPT = (
    "\n\nSESSION CONTEXT: The user is actively cooking a recipe. "
    "Bias toward 'cooking_help' for questions about technique, timing, or substitutions. "
    "Do NOT classify as 'recipe_brainstorm' or 'recipe_generation' mid-cook."
)

MODE_BIAS_PANTRY_PROMPT = (
    "\n\nSESSION CONTEXT: The user is in the middle of a pantry update. "
    "Bias toward 'pantry_update' for grocery or food item mentions."
)
