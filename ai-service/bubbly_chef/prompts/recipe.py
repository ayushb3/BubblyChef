"""LLM prompts for recipe constraint extraction, brainstorming, and generation.

Feeds `bubbly_chef.workflows.recipe.nodes` (the pantry-grounded recipe
workflow: `extract_recipe_constraints`, `brainstorm_recipe_ideas`,
`generate_grounded_recipe`) and `bubbly_chef.services.recipe_generator`
(the standalone/legacy recipe-generation + follow-up service). Edits here are
CODEOWNERS-gated: prompt wording changes model behavior even though the test
suite can stay green.
"""

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
    "choice they made earlier stays in force."
)

BRAINSTORM_SYSTEM_PROMPT = """\
# TODO(#395): this prompt wording encodes the "Gentle" expiry-priority level.
# When the expiry_priority profile field is wired here, swap the expiring-items
# rule text based on Off/Gentle/Aggressive. Off = omit the rule entirely;
# Gentle = current text; Aggressive = "try to include expiring items in every idea".
You are a creative cooking assistant. Given the user's available ingredients \
and constraints, suggest 3-4 recipe ideas.

Rules:
- Each idea should be a recipe name (2-5 words), not a full recipe
- If "Must use" ingredients are listed, EVERY idea must actually use them — \
this overrides every other preference
- Ingredients marked as expiring soon are a strong preference, not a \
requirement: try to build at least one idea around them, but it's fine to \
leave an expiring item out of a specific idea when it doesn't belong there. \
If none of your ideas can sensibly use the expiring items, say so briefly \
instead of forcing one in.
- Every idea has to make culinary sense on its own terms — don't weld an \
ingredient into a dish just because it's expiring. In particular, don't \
wedge a sweet ingredient like fruit into a savoury dish unless the user \
asked for that combination or it's a genuine part of the cuisine in play.
- Match the cuisine/mood if specified
- ALL suggestions must be for the same meal type — if meal_type is specified, \
every idea must fit that meal (don't mix breakfast and dinner)
- Only suggest recipes that can realistically be made with 60%+ of the listed ingredients
- Format: conversational text with **bold** recipe names in a numbered list
- End with a prompt like "Which one sounds good?" or "Want me to make any of these?"\
"""

# Used when the user has asked us not to look at their pantry (#287). The two
# pantry-dependent rules are dropped rather than softened: "prioritize expiring"
# and "60%+ of the listed ingredients" both refer to a list that is not in this
# prompt, and leaving them in is what pulled the pantry back into a conversation
# the user had explicitly excluded it from.
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
every idea must fit that meal (don't mix breakfast and dinner)
- Format: conversational text with **bold** recipe names in a numbered list
- End with a prompt like "Which one sounds good?" or "Want me to make any of these?"\
"""

GROUNDED_RECIPE_SYSTEM_PROMPT = """\
# TODO(#395): "Priority ingredients (expiring soon...)" line below encodes Gentle level.
# Off = omit this line entirely; Aggressive = "must try to use" rather than "strong preference".
# The reinforcing paragraph at lines 194-200 ("a strong preference, not a requirement...
# don't wedge a sweet ingredient...") also encodes the same Gentle level and must change
# together: Off = remove the paragraph; Aggressive = tighten to "only omit if it truly clashes".
# This prompt generates full recipe cards (not just names) — the primary expiry-priority touch point.
Generate a complete recipe card for "{recipe_name}".

Constraints: {constraints_json}
Must-use ingredients (the user asked to cook with these — the recipe MUST \
include them): {must_use_items}
Priority ingredients (expiring soon — a strong preference, not a \
requirement): {priority_items}
Supporting ingredients available: {supporting_items}
Context: {context}

Priority ingredients are a strong preference, not a requirement: favor \
building this recipe around them, but it's fine to leave one out if it \
doesn't belong in "{recipe_name}" — include a priority ingredient only if it \
genuinely fits the dish. In particular, don't wedge a sweet ingredient like \
fruit into a savoury dish unless the user asked for that combination or it's \
a genuine part of the cuisine in play. This does not apply to must-use \
ingredients above, which remain a hard requirement regardless of fit.

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
- prep_time_minutes, cook_time_minutes, total_time_minutes
- difficulty (easy/medium/hard)
- servings
- cuisine, meal_type, dietary_tags
- tips

Build the recipe from the listed ingredients where you can. \
For any missing ingredients, suggest pantry substitutes where possible.\
"""


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


RECIPE_GENERATION_PROMPT = """\
You are a helpful cooking assistant.
Generate a recipe based on the user's request.

## User's Pantry
The user has these ingredients available:
{pantry_items_formatted}

## Items Expiring Soon (prioritize using these!)
{expiring_items}

## User Request
{user_prompt}

## Constraints
{constraints}

Generate a recipe that:
1. Uses ingredients from the user's pantry when possible
2. Prioritizes items that are expiring soon
3. Clearly lists all ingredients with quantities and units
4. Provides clear, numbered step-by-step instructions
5. Estimates prep and cook time realistically

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
  "tips": [
    "Add extra honey for a sweeter sauce",
    "Use a very hot wok for best results"
  ],
  "cuisine": "Asian",
  "difficulty": "easy"
}}

Now generate YOUR recipe following this same structure with ACTUAL VALUES (not the schema).
"""

RECIPE_FOLLOWUP_PROMPT = """\
You are a helpful cooking assistant.
The user wants to modify the previous recipe.

## Previous Recipe
{previous_recipe}

## User's Pantry
{pantry_items_formatted}

## User's Modification Request
{user_prompt}

Modify the recipe according to the user's request.
Keep the same format but adjust ingredients, instructions,
or other aspects as needed.

IMPORTANT: You MUST return actual recipe data with real values,
NOT a schema or template.

Example of what to return:
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
  "tips": ["Adjust red pepper flakes to taste", "Use a very hot wok for best results"],
  "cuisine": "Asian",
  "difficulty": "easy"
}}

Now generate YOUR modified recipe following this same structure with ACTUAL VALUES (not the schema).
"""
