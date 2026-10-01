"""LLM prompts for recipe constraint extraction, brainstorming, and generation.

Feeds `bubbly_chef.workflows.recipe.nodes` (the pantry-grounded recipe
workflow: `extract_recipe_constraints`, `brainstorm_recipe_ideas`,
`generate_grounded_recipe`) and `bubbly_chef.services.recipe_generator`
(the standalone/legacy recipe-generation + follow-up service). Edits here are
fresh-context reviewed and `verify`-checked: prompt wording changes model behavior even though the test
suite can stay green.
"""

from bubbly_chef.domain.expiry_priority import DEFAULT_EXPIRY_PRIORITY, ExpiryPriority

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
    "'pasta' there is a dish, not an ingredient the user is using up).\n\n"
    "use_pantry: set to false ONLY when the user asks us not to use their pantry "
    "-- 'don't look at my pantry', 'ignore what I have', 'forget my pantry', "
    "'just give me a recipe'. Set it to true ONLY when they ask us to start using "
    "it again -- 'use my pantry', 'what can I make with what I have'. If they say "
    "nothing either way, leave it null: null means 'no opinion this turn', and a "
    "choice they made earlier stays in force.\n\n"
    "diet_changes: the ONLY way a diet the conversation already remembered gets "
    "dropped. Fill it ONLY when the user says plainly, about THEMSELVES, that they no "
    "longer follow a diet. Put the diet in `remove` (one label each, e.g. "
    "'Vegetarian'); never put a diet they are dropping in `dietary`. Set `scope` to "
    "'conversation' for a lasting change -- 'I'm not vegetarian any more', 'I've "
    "stopped being vegan', 'I eat meat again now' -- and to 'this_request' for a "
    "one-off -- 'we're not vegan tonight', 'just this once', 'for this meal'; a "
    "one-off never gets scope 'conversation'.\n"
    "Leave diet_changes empty (null) for ALL of these, because keeping a diet is the "
    "safe direction and a wrong removal is the expensive mistake:\n"
    "- someone else's diet: 'I'm not a vegetarian but my partner is' (the user dropped "
    "nothing; the diet is about the partner)\n"
    "- a question: 'no longer vegan?', 'am I still vegetarian?'\n"
    "- a complaint about a dish: 'that's not vegetarian!' (the user is INSISTING on "
    "the diet, not dropping it)\n"
    "- a dish modifier: 'make it non-vegan', 'a non-vegetarian pasta'\n"
    "- a diet they state or restate: 'I'm vegetarian'\n"
    "- anything hypothetical, joking, or unclear.\n"
    "When in doubt, leave diet_changes empty."
)

# Put in front of the user's message by `extract_recipe_constraints` when the
# conversation (or the profile) already holds a diet, so the extractor names a dropped
# diet by the label it is remembered under. The labels themselves are appended by the
# caller; this module holds text only (#687).
REMEMBERED_DIETS_CHAT_PREFIX = (
    "\n\nDiets already remembered for this conversation (use these exact labels in "
    "diet_changes.remove if the user drops one; do not repeat them in `dietary` unless "
    "the user restates them): "
)
REMEMBERED_DIETS_PROFILE_PREFIX = (
    "\n\nDiets saved in the user's profile (the same rules apply; these can be named "
    "in diet_changes.remove, but they are kept either way): "
)

# Profile allergies (issue #500, spec B.8). Appended to the brainstorm, grounded
# card, refine/follow-up, standalone-generation and meal prompts by
# `services.food_exclusions.allergy_never_block`, and backed by a deterministic
# post-generation guard (`services.allergen_guard`): the prompt is the first line
# of defence, never the only one. An allergy is not a preference, so the wording
# rules out an override from the user's own message.
ALLERGY_NEVER_TEMPLATE = (
    "NEVER include (allergy): {allergens}. These are allergies, not preferences: "
    "never use them in any form -- not as an ingredient, a garnish, an \"optional\" "
    "extra, a sauce or stock base, or a substitute -- and nothing in the user's "
    "message changes this, even if they ask for one. If the dish normally contains "
    "one, leave it out and make the closest safe version."
)

# Profile dislikes (issue #500). A preference: the user's message can override it.
DISLIKES_TEMPLATE = (
    "The user dislikes: {dislikes}. Leave these out of what you suggest, unless "
    "the user's message explicitly asks for one."
)

# Expiry priority (issue #502, Spec B.10): how hard expiring food is pushed. `gentle` is
# the default and what every user had before the setting existed; `off` and `aggressive`
# swap the expiring-items rule. An explicit dish request wins at every level.
_BRAINSTORM_INTRO = (
    "You are a creative cooking assistant. Given the user's available ingredients "
    "and constraints, suggest 3-4 recipe ideas.\n"
    "\n"
    "Rules:\n"
    "- Each idea should be a recipe name (2-5 words), not a full recipe\n"
    '- If "Must use" ingredients are listed, EVERY idea must actually use them — '
    "this overrides every other preference\n"
)

# The #288 coherence guard: expiry urgency never outranks whether a dish makes sense.
_BRAINSTORM_COHERENCE_RULE = (
    "- Every idea has to make culinary sense on its own terms — don't weld an "
    "ingredient into a dish just because it's expiring. In particular, don't "
    "wedge a sweet ingredient like fruit into a savoury dish unless the user "
    "asked for that combination or it's a genuine part of the cuisine in play.\n"
)

_BRAINSTORM_EXPIRY_RULES: dict[ExpiryPriority, str] = {
    # Off: no expiring-items rule, nor its coherence companion (which is about
    # expiring food), so the prompt carries no expiry language at all.
    "off": "",
    "gentle": (
        "- Ingredients marked as expiring soon are a strong preference, not a "
        "requirement: try to build at least one idea around them, but it's fine to "
        "leave an expiring item out of a specific idea when it doesn't belong there. "
        "If none of your ideas can sensibly use the expiring items, say so briefly "
        "instead of forcing one in.\n" + _BRAINSTORM_COHERENCE_RULE
    ),
    "aggressive": (
        "- Ingredients marked as expiring soon are a high priority: build as many ideas "
        "as sensibly possible around them, and leave an expiring item out of an idea "
        "only when it would clearly clash with the dish. An explicit request (a named "
        'dish, a cuisine, or "Must use" ingredients) still wins: add an expiring item '
        "to that dish only where it fits.\n" + _BRAINSTORM_COHERENCE_RULE
    ),
}

_BRAINSTORM_RULES_TAIL = (
    "- Match the cuisine/mood if specified\n"
    "- ALL suggestions must be for the same meal type — if meal_type is specified, "
    "every idea must fit that meal (don't mix breakfast and dinner). If no meal "
    "type is given, don't assume one from the time of day or frame the ideas as "
    "snacks; suggest ordinary dishes for any meal.\n"
    # Issue #499: the old "60%+ of the listed ingredients" rule read as "use most of
    # the pantry", which pushed the model toward kitchen-sink dishes.
    "- Ideas may use a sensible subset of the listed ingredients: each should be "
    "realistically makeable from what's listed plus everyday staples (oil, salt, "
    "spices), but don't try to use as many of them as possible. A focused dish "
    "beats a kitchen-sink one, and it's fine for an idea to leave most of the list "
    "unused.\n"
    "- Format: conversational text with **bold** recipe names in a numbered list\n"
    '- End with a prompt like "Which one sounds good?" or '
    '"Want me to make any of these?"'
)


def brainstorm_system_prompt(expiry_priority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY) -> str:
    """The pantry-grounded brainstorm prompt for one expiry-priority level."""
    return _BRAINSTORM_INTRO + _BRAINSTORM_EXPIRY_RULES[expiry_priority] + _BRAINSTORM_RULES_TAIL


# The Gentle (default) rendering, kept under its old name for importers.
BRAINSTORM_SYSTEM_PROMPT = brainstorm_system_prompt("gentle")

# The label over the expiring items in the brainstorm's pantry block. Off has none:
# the block isn't rendered, and those items are listed with the rest of the pantry.
_EXPIRING_CONTEXT_LABELS: dict[ExpiryPriority, str | None] = {
    "off": None,
    "gentle": "Expiring soon (weave in where it fits, not mandatory)",
    "aggressive": "Expiring soon (use these up, building ideas around them where they fit)",
}


def expiring_context_label(expiry_priority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY) -> str | None:
    """The "Expiring soon (...)" label for the brainstorm's pantry block, or None for Off."""
    return _EXPIRING_CONTEXT_LABELS[expiry_priority]


# Used when the user has asked us not to look at their pantry (#287). The two
# pantry-dependent rules are dropped rather than softened: "prioritize expiring"
# and the "make something from the listed ingredients" rule both refer to a list
# that is not in this prompt, and leaving them in is what pulled the pantry back
# into a conversation the user had explicitly excluded it from.
BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY = """\
You are a creative cooking assistant. Suggest 3-4 recipe ideas from the user's \
request alone.

The user has asked you NOT to use their pantry. Do not mention their pantry, \
their stock, or anything expiring, and do not steer the suggestions toward \
ingredients you think they might have. Work only from what they asked for.

Rules:
- Each idea should be a recipe name (2-5 words), not a full recipe
- If "Must use" ingredients are listed, EVERY idea must actually use them — \
this overrides every other preference
- Match the cuisine/mood if specified
- ALL suggestions must be for the same meal type — if meal_type is specified, \
every idea must fit that meal (don't mix breakfast and dinner). If no meal type is given, don't assume one from the time of day or frame the ideas as snacks; suggest ordinary dishes for any meal.
- Format: conversational text with **bold** recipe names in a numbered list
- End with a prompt like "Which one sounds good?" or "Want me to make any of these?"\
"""

# The recipe-card prompt generates full cards (not just names): the primary
# expiry-priority touch point. It is a `str.format` template; the node fills the
# placeholders. Off omits the "Priority ingredients" line and paragraph entirely.
_GROUNDED_HEAD = (
    'Generate a complete recipe card for "{recipe_name}".\n'
    "\n"
    "Constraints: {constraints_json}\n"
    "Must-use ingredients (the user asked to cook with these — the recipe MUST "
    "include them): {must_use_items}\n"
)

_GROUNDED_PRIORITY_LINES: dict[ExpiryPriority, str] = {
    "off": "",
    "gentle": (
        "Priority ingredients (expiring soon — a strong preference, not a "
        "requirement): {priority_items}\n"
    ),
    "aggressive": (
        "Priority ingredients (expiring soon — use them up if you can): {priority_items}\n"
    ),
}

_GROUNDED_MID = (
    "Preferred flavors/ingredients (include if sensible): {preferred_ingredients}\n"
    "Supporting ingredients available: {supporting_items}\n"
    "Context: {context}\n"
    "\n"
)

_GROUNDED_PRIORITY_PARAGRAPHS: dict[ExpiryPriority, str] = {
    "off": "",
    "gentle": (
        "Priority ingredients are a strong preference, not a requirement: favor "
        "building this recipe around them, but it's fine to leave one out if it "
        'doesn\'t belong in "{recipe_name}" — include a priority ingredient only if it '
        "genuinely fits the dish. In particular, don't wedge a sweet ingredient like "
        "fruit into a savoury dish unless the user asked for that combination or it's "
        "a genuine part of the cuisine in play. This does not apply to must-use "
        "ingredients above, which remain a hard requirement regardless of fit.\n"
        "\n"
    ),
    "aggressive": (
        "Priority ingredients are expiring: build this recipe around them and use them "
        "up, leaving one out only if it would clearly clash with "
        '"{recipe_name}". In particular, don\'t wedge a sweet ingredient like fruit '
        "into a savoury dish unless the user asked for that combination or it's a "
        "genuine part of the cuisine in play. If the user named a dish or asked for "
        "specific ingredients, that request wins: add a priority ingredient only where "
        "it fits. This does not apply to must-use ingredients above, which remain a "
        "hard requirement regardless of fit.\n"
        "\n"
    ),
}


def grounded_recipe_system_prompt(
    expiry_priority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY,
) -> str:
    """The recipe-card prompt template (unformatted) for one expiry-priority level."""
    return (
        _GROUNDED_HEAD
        + _GROUNDED_PRIORITY_LINES[expiry_priority]
        + _GROUNDED_MID
        + _GROUNDED_PRIORITY_PARAGRAPHS[expiry_priority]
        + _GROUNDED_TAIL
    )


_GROUNDED_TAIL = """\
Generate a full recipe with:
- title, description
- ingredients: a list of objects, each with keys:
    "name" (ingredient name, e.g. "chicken breast"),
    "quantity" (numeric amount, e.g. 2),
    "unit" (measurement unit ONLY — e.g. "cups", "tablespoon", "g", "count"; do NOT
      write size descriptors like "medium", "large", or "small" here; those belong in
      "preparation" or can be omitted),
    "preparation" (optional prep note, e.g. "diced", or size hint like "medium"),
    "optional" (boolean, default false),
    "substitutes" (list of substitute ingredient names, default [])
- step-by-step instructions
- steps: one entry per instruction, same order and count, each with
    "label" (a short imperative, 2-5 words, e.g. "Boil the pasta"),
    "ongoing_label" (a short subject+verb clause for a step in progress, e.g.
      "the pasta boils" — required when hands_on is false, optional otherwise),
    "duration_minutes" (whole minutes, 1-240; omit only if genuinely unknown),
    "hands_on" (true if the cook must be actively engaged for this step),
    "depends_on" (indices of earlier steps that must finish first; omit for
      "just the previous step", use [] for "can start at the beginning"),
    "exclusive" (kitchen-limit tags this step needs, usually [])
  Do not repeat the instruction text inside a steps entry — that comes from
  "instructions" at the same index.
- prep_time_minutes, cook_time_minutes, total_time_minutes
- difficulty (easy/medium/hard)
- servings
- cuisine, meal_type, dietary_tags
- tips

Build the recipe from the listed ingredients where you can. \
For any missing ingredients, suggest pantry substitutes where possible.\
"""

# The Gentle (default) rendering, kept under its old name for importers.
GROUNDED_RECIPE_SYSTEM_PROMPT = grounded_recipe_system_prompt("gentle")


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


# Recipe mode's own instruction to lean on the pantry. Dropped from the prefix
# when the user has opted out, otherwise it contradicts the rest of the prompt.
_RECIPE_MODE_PANTRY_LINE = "Prioritize ingredients the user already has in their pantry.\n"


# The standalone generation prompt (`services.recipe_generator`), a `str.format`
# template. The "Items Expiring Soon" section and its criterion follow the user's
# expiry priority (#502); Off drops both and renumbers. It used to say "prioritize
# using these!" with no coherence guard, so a sweet ingredient could be welded into
# a savoury dish exactly as #288 reported for brainstorm.
_GENERATION_HEAD = """\
You are a helpful cooking assistant.
Generate a recipe based on the user's request.

## User's Pantry
The user has these ingredients available:
{pantry_items_formatted}

"""

_GENERATION_EXPIRING_SECTIONS: dict[ExpiryPriority, str] = {
    "off": "",
    "gentle": (
        "## Items Expiring Soon (a strong preference, not a requirement)\n"
        "{expiring_items}\n"
        "Favor using these, but only where they genuinely fit the dish: don't wedge "
        "a sweet ingredient like fruit into a savoury dish unless the user asked for "
        "that combination or it's a genuine part of the cuisine in play. If the "
        "request below names a dish or specific ingredients, that request wins: add "
        "an expiring item only where it fits.\n"
        "\n"
    ),
    "aggressive": (
        "## Items Expiring Soon (use them up if you can)\n"
        "{expiring_items}\n"
        "Build the recipe around these and use them up, leaving one out only if it "
        "would clearly clash with the dish. Still don't wedge a sweet ingredient like "
        "fruit into a savoury dish unless the user asked for that combination or it's "
        "a genuine part of the cuisine in play. If the request below names a dish or "
        "specific ingredients, that request wins: add an expiring item only where it "
        "fits.\n"
        "\n"
    ),
}

_GENERATION_MID = """\
## User Request
{user_prompt}

## Constraints
{constraints}

Generate a recipe that:
"""

_GENERATION_EXPIRY_CRITERIA: dict[ExpiryPriority, str | None] = {
    "off": None,
    "gentle": "Favors items that are expiring soon where they fit the dish",
    "aggressive": "Builds the dish around items that are expiring soon where it makes sense",
}

_GENERATION_TAIL = """\

IMPORTANT: You MUST return actual recipe data, NOT a schema or template.
Generate a real recipe with actual values.

Example of what to return:
{{
  "title": "Honey Garlic Chicken Stir-Fry",
  "description": "A quick and delicious stir-fry with tender chicken and crisp vegetables",
  "prep_time_minutes": 10,
  "cook_time_minutes": 15,
  "servings": 4,
  "ingredients": [
    {{"name": "chicken breast", "quantity": 1, "unit": "lb",
      "preparation": "sliced thin", "optional": false}},
    {{"name": "garlic", "quantity": 3, "unit": "cloves",
      "preparation": "minced", "optional": false}},
    {{"name": "soy sauce", "quantity": 3, "unit": "tablespoons",
      "preparation": null, "optional": false}}
  ],
  "instructions": [
    "Slice chicken into thin strips, season with salt and pepper",
    "Mince garlic and prepare your vegetables",
    "Heat oil in a large wok or skillet over high heat"
  ],
  "steps": [
    {{"label": "Slice the chicken", "ongoing_label": null,
      "duration_minutes": 4, "hands_on": true, "depends_on": [], "exclusive": []}},
    {{"label": "Prep the vegetables", "ongoing_label": null,
      "duration_minutes": 3, "hands_on": true, "depends_on": null, "exclusive": []}},
    {{"label": "Heat the wok", "ongoing_label": "the wok heats",
      "duration_minutes": 2, "hands_on": false, "depends_on": null, "exclusive": ["pan"]}}
  ],
  "tips": [
    "Add extra honey for a sweeter sauce",
    "Use a very hot wok for best results"
  ],
  "cuisine": "Asian",
  "difficulty": "easy"
}}

Now generate YOUR recipe following this same structure with ACTUAL VALUES (not the schema).
"""


def recipe_generation_prompt(expiry_priority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY) -> str:
    """The standalone generation prompt template (unformatted) for one expiry-priority level."""
    criteria = [
        "Uses ingredients from the user's pantry when possible",
        _GENERATION_EXPIRY_CRITERIA[expiry_priority],
        "Clearly lists all ingredients with quantities and units",
        "Provides clear, numbered step-by-step instructions",
        "Estimates prep and cook time realistically",
        "Gives each instruction a `steps` entry at the same index with its label, "
        "ongoing_label, duration_minutes, hands_on, depends_on and exclusive tags -- "
        "do not repeat the instruction text there, only the metadata",
    ]
    numbered = "\n".join(
        f"{n}. {text}" for n, text in enumerate((c for c in criteria if c is not None), start=1)
    )
    return (
        _GENERATION_HEAD
        + _GENERATION_EXPIRING_SECTIONS[expiry_priority]
        + _GENERATION_MID
        + numbered
        + "\n"
        + _GENERATION_TAIL
    )


# The Gentle (default) rendering, kept under its old name for importers.
RECIPE_GENERATION_PROMPT = recipe_generation_prompt("gentle")

RECIPE_FOLLOWUP_PROMPT = """\
You are a helpful cooking assistant.
The user wants to modify the previous recipe.

## Previous Recipe
{previous_recipe}

## User's Pantry
{pantry_items_formatted}

## User's Modification Request
{user_prompt}

Modify the recipe according to the user's request.{dietary_requirements}

This is an EDIT of the previous recipe, not a new recipe. Change only what the
user asked for and leave everything else exactly as it is. Every ingredient the
request does not mention keeps its exact name and amount: do not rename it
(Pasta stays Pasta, it does not become Spaghetti), do not swap it for something
similar (Butter stays Butter, it does not become Olive Oil), and do not rescale
it. Do not regenerate the ingredient list from scratch.

Report exactly which ingredients the request touched:
- "added": ingredients the request introduces (full details).
- "removed": names of previous-recipe ingredients the request takes out. Give
  the ingredient name alone, exactly as the previous recipe above names it,
  without its amount, unit or preparation: "cheddar cheese", not "250 g
  cheddar cheese, shredded".
- "changed": previous-recipe ingredients whose amount, unit or preparation the
  request changes -- the ingredient name alone, as above, plus the new values.
A substitution ("swap the butter for olive oil") is a removal plus an addition:
put the old one in "removed" and the new one in "added". Never report a
different name under "changed"; it only ever updates an existing ingredient.
Leave a list empty when the request did not touch anything in it. An
ingredient you removed must not appear in the instructions or steps any more.

IMPORTANT: You MUST return actual recipe data with real values,
NOT a schema or template. Give each instruction a matching `steps` entry
at the same index -- label, ongoing_label, duration_minutes, hands_on,
depends_on and exclusive tags, never the instruction text itself.

Example of the output format only (not a recipe to copy):
{{
  "title": "Spicy Honey Garlic Chicken Stir-Fry",
  "description": "A quick and delicious stir-fry with tender chicken,
crisp vegetables, and a spicy kick",
  "prep_time_minutes": 10,
  "cook_time_minutes": 15,
  "servings": 4,
  "ingredients": [
    {{"name": "chicken breast", "quantity": 1, "unit": "lb",
      "preparation": "sliced thin", "optional": false}},
    {{"name": "garlic", "quantity": 4, "unit": "cloves",
      "preparation": "minced", "optional": false}},
    {{"name": "red pepper flakes", "quantity": 1,
      "unit": "teaspoon", "preparation": null,
      "optional": false}},
    {{"name": "soy sauce", "quantity": 3,
      "unit": "tablespoons", "preparation": null,
      "optional": false}}
  ],
  "instructions": [
    "Slice chicken breast into thin strips and season with salt and pepper",
    "Mince garlic and add red pepper flakes to your prep",
    "Heat oil in a large wok or skillet over high heat",
    "Add chicken and stir-fry for 5-6 minutes until cooked through"
  ],
  "steps": [
    {{"label": "Slice the chicken", "ongoing_label": null,
      "duration_minutes": 4, "hands_on": true, "depends_on": [], "exclusive": []}},
    {{"label": "Prep the aromatics", "ongoing_label": null,
      "duration_minutes": 2, "hands_on": true, "depends_on": null, "exclusive": []}},
    {{"label": "Heat the wok", "ongoing_label": "the wok heats",
      "duration_minutes": 2, "hands_on": false, "depends_on": null, "exclusive": ["pan"]}},
    {{"label": "Stir-fry the chicken", "ongoing_label": "the chicken cooks",
      "duration_minutes": 6, "hands_on": false, "depends_on": null, "exclusive": ["pan"]}}
  ],
  "tips": ["Adjust red pepper flakes to taste", "Use a very hot wok for best results"],
  "cuisine": "Asian",
  "difficulty": "easy",
  "added": [
    {{"name": "red pepper flakes", "quantity": 1, "unit": "teaspoon",
      "preparation": null, "optional": false}}
  ],
  "removed": [],
  "changed": [
    {{"name": "garlic", "quantity": 4, "unit": "cloves",
      "preparation": "minced", "optional": false}}
  ]
}}

Now generate YOUR modified recipe following this same structure with ACTUAL VALUES (not the schema).
"""

# Used by the structured-steps lazy-upgrade route (issue #648,
# services/structured_steps.py::ensure_structured_steps). Asks only for step
# *metadata* -- the instruction text is shown for context but must never be
# echoed back; it's copied verbatim from `instructions` by the caller, not
# taken from the model.
STRUCTURED_STEPS_ENSURE_PROMPT = """\
You are annotating an existing recipe's steps with cooking metadata -- you \
are NOT rewriting the recipe.

Recipe: {title}

Instructions:
{instructions_formatted}

For each instruction above, in the same order, return one steps entry with:
- "label": a short imperative, 2-5 words, e.g. "Boil the pasta"
- "ongoing_label": a short subject+verb clause for a step in progress, e.g. \
"the pasta boils" -- required when hands_on is false, optional otherwise
- "duration_minutes": whole minutes, 1-240; omit only if genuinely unknown
- "hands_on": true if the cook must be actively engaged for this step, \
false if it's mostly waiting (simmering, baking, resting, marinating)
- "depends_on": indices (0-based) of earlier steps in THIS list that must \
finish before this one can start; omit for "just the previous step", use \
[] for "can start at the beginning"
- "exclusive": kitchen-limit tags this step needs (e.g. "pan", "oven"), \
usually []

Return exactly one steps entry per instruction, in the same order. Do not \
include the instruction text itself in your response -- only the metadata \
listed above.
"""
