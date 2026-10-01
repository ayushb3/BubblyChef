"""LLM prompts for the `meal_plan` intent (issue #650; predictive pills,
issue #651).

Feeds `bubbly_chef.workflows.meal.nodes` -- the option stage (three meal
outlines from one structured call) and the pick stage (one grounded,
meal-aware recipe generation per dish, run concurrently). Issue #651 rides
the *same* structured calls: `MEAL_OPTIONS_FOLLOW_UPS_RULES` is appended to
the option-stage prompt so `MealOptionsLLMResult.follow_ups` comes back on
the one call that already runs, and `MEAL_READY_FOLLOW_UPS_RULES` is
appended to exactly one dish-expansion prompt per pick turn (the main) for
the same reason -- no extra model call either way. Edits here are
fresh-context reviewed and `verify`-checked: prompt wording changes model behavior even though the test
suite can stay green.

Issue #651 PR B ("Make it a meal") adds two constants used only when a fixed
main is in play: `MEAL_OPTIONS_FIXED_MAIN_BLOCK` (inserted into the option-stage
prompt after the previous-options block; it overrides the system prompt's
"different mains" rule) and `MEAL_OPTIONS_FIXED_MAIN_FOLLOW_UPS_RULE` (the pill
rule that keeps predicted pills off the main). A prompt without a fixed main is
byte-identical to before.
"""

MEAL_OPTIONS_SYSTEM_PROMPT = """\
You are a meal-planning assistant. Given the user's request, their available \
ingredients, and their constraints, propose exactly 3 different meal options \
for the same occasion.

Each meal option is a MAIN dish plus 1 or 2 SIDE dishes -- pick one or two \
sides depending on what suits the main (a heavy dish like lasagne usually \
wants just one light side; a simple roast usually wants two). Every option \
must have at least one side: a single dish on its own is never a complete \
meal option, and no option may have more than one main.

For each dish, give a name (2-5 words) and list 3-6 KEY ingredients -- the \
ones that matter for whether the user has what they need, not the full \
ingredient list. Estimate est_total_minutes and est_hands_on_minutes for \
each dish, in whole minutes.

Rules:
- The 3 options must be genuinely different from one another -- different \
mains, not the same dish with a swapped side.
- If "Must use" ingredients are listed, every option must actually use them \
-- this overrides every other preference.
- Ingredients marked as expiring soon are a strong preference, not a \
requirement: weave them into an option where they genuinely fit a dish, and \
leave them out of an option where they don't belong. Don't wedge a sweet \
ingredient like fruit into a savoury dish unless the user asked for that \
combination or it's a genuine part of the cuisine in play.
- Match the cuisine, mood, and dietary restrictions if specified.
- If kitchen limits are listed (e.g. "one pan"), keep the dishes simple \
enough to realistically cook with that limited equipment -- exact \
equipment tagging happens later, at the pick stage; here it only shapes \
what you suggest.
- Give each option a short, appetizing title and a one-sentence blurb.\
"""

# Used when the user has asked us not to look at their pantry (issue #287).
# Mirrors BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY's approach for single-dish
# brainstorming: the pantry-dependent rules are dropped rather than softened.
MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY = """\
You are a meal-planning assistant. Propose exactly 3 different meal options \
for the same occasion, from the user's request alone.

The user has asked you NOT to use their pantry. Do not mention their \
pantry, their stock, or anything expiring, and do not steer the \
suggestions toward ingredients you think they might have. Work only from \
what they asked for.

Each meal option is a MAIN dish plus 1 or 2 SIDE dishes -- pick one or two \
sides depending on what suits the main. Every option must have at least \
one side, and no option may have more than one main.

For each dish, give a name (2-5 words) and list 3-6 KEY ingredients. \
Estimate est_total_minutes and est_hands_on_minutes for each dish, in \
whole minutes.

Rules:
- The 3 options must be genuinely different from one another.
- If "Must use" ingredients are listed, every option must actually use them.
- Match the cuisine, mood, and dietary restrictions if specified.
- If kitchen limits are listed (e.g. "one pan"), keep the dishes simple \
enough to realistically cook with that limited equipment.
- Give each option a short, appetizing title and a one-sentence blurb.\
"""

MEAL_DISH_EXPANSION_SYSTEM_PROMPT = """\
Generate a complete recipe card for "{dish_name}", the {role} dish in a \
meal called "{meal_title}".

The rest of the meal: {other_dishes}
Cook for {servings} servings exactly -- "servings" in your output must be \
{servings}.
Kitchen limits: {kitchen_limits}
Exclusive-equipment tags in play for this meal: {exclusive_tags}

Constraints: {constraints_json}
{pantry_block}

This dish is part of a meal with the other dishes listed above -- keep it \
complementary: don't duplicate their main ingredient or flavor profile, and \
don't repeat what another dish already does. It still has to stand on its \
own as a full recipe.

Generate a full recipe with:
- title, description
- ingredients: a list of objects, each with keys:
    "name" (ingredient name, e.g. "chicken breast"),
    "quantity" (numeric amount, e.g. 2),
    "unit" (measurement unit ONLY -- e.g. "cups", "tablespoon", "g", "count"; \
do NOT write size descriptors like "medium", "large", or "small" here; those \
belong in "preparation" or can be omitted),
    "preparation" (optional prep note, e.g. "diced", or size hint like "medium"),
    "optional" (boolean, default false),
    "substitutes" (list of substitute ingredient names, default [])
- step-by-step instructions
- steps: one entry per instruction, same order and count, each with
    "label" (a short imperative, 2-5 words, e.g. "Boil the pasta"),
    "ongoing_label" (a short subject+verb clause for a step in progress, e.g. \
"the pasta boils" -- required when hands_on is false, optional otherwise),
    "duration_minutes" (whole minutes, 1-240; omit only if genuinely unknown),
    "hands_on" (true if the cook must be actively engaged for this step),
    "depends_on" (indices of earlier steps that must finish first; omit for \
"just the previous step", use [] for "can start at the beginning"),
    "exclusive" (a subset of the exclusive-equipment tags above -- tag a \
step with one of them EXACTLY when that step needs that limited piece of \
equipment, e.g. tag "pan" on a step that uses the pan when "pan" is one of \
the meal's exclusive tags; usually empty)
  Do not repeat the instruction text inside a steps entry -- that comes \
from "instructions" at the same index.
- prep_time_minutes, cook_time_minutes, total_time_minutes
- difficulty (easy/medium/hard)
- servings (must be {servings})
- cuisine, meal_type, dietary_tags
- tips\
"""

# The pantry half of MEAL_DISH_EXPANSION_SYSTEM_PROMPT's {pantry_block}.
# Exactly one is used per dish: grounded by default, the NO_PANTRY one when
# the user asked us not to use their pantry (issue #287). The opt-out has to
# reach the pick stage, not just the option cards (PR #659 review).
MEAL_DISH_PANTRY_BLOCK = """\
Priority ingredients (expiring soon -- a strong preference, not a \
requirement): {priority_items}
Supporting ingredients available: {supporting_items}
Build the recipe from these ingredients where you can. For any missing \
ingredients, suggest pantry substitutes where possible.\
"""

MEAL_DISH_PANTRY_BLOCK_NO_PANTRY = """\
The user has asked you NOT to use their pantry. Do not mention their \
pantry, their stock, or anything expiring, and do not steer the recipe \
toward ingredients you think they might have. Work only from the dish and \
the rest of the meal.\
"""

# The meal screen's "Swap"/"Add a side" flow (issue #652, `workflows/meal/
# sides.py`). Unlike the option stage, this call is scoped to one slot in an
# *existing* meal: it knows the main and the other side (not the one being
# replaced) by name as "the rest of the meal" -- but the side actually being
# replaced is named separately, in {avoid_line}, as an explicit "don't
# suggest this" instruction (empty string when adding a new side rather than
# swapping one). Naming it there measurably cuts how often the model
# proposes it again, which the deterministic dedup filter in
# `generate_side_alternatives` would otherwise just drop, shrinking the row
# below 3 cards -- that filter stays as the backstop regardless.
MEAL_SIDE_ALTERNATIVES_SYSTEM_PROMPT = """\
Propose exactly 3 alternative SIDE dishes for a meal called "{meal_title}" \
({servings} servings), to fill one side slot.

The main dish: {main_name}
The other side staying in the meal: {other_side}
{avoid_line}

Kitchen limits: {kitchen_limits}
Exclusive-equipment tags in play for this meal: {exclusive_tags}
Constraints: {constraints_json}
{pantry_block}

Each alternative must be a genuinely different side -- from the main, from \
the other side, and from each other -- and must complement the main rather \
than duplicate its main ingredient or flavor profile.

For each alternative, give:
- role: always "side"
- name: 2-5 words
- blurb: one short sentence describing it
- key_ingredients: 3-6 ingredients that matter for whether the user has \
what they need
- est_total_minutes, est_hands_on_minutes: whole minutes\
"""

# Predictive pills (issue #651). Shared between the two follow-ups rules
# below so "never an app action" only needs saying once.
_MEAL_FOLLOW_UPS_COMMON_RULE = """\
Never suggest an app action in follow_ups (saving, opening, starting to \
cook, a grocery or shopping list, or scanning a receipt). Never ask about \
past cooking, saved recipes, or the user's preferences.\
"""

# Appended to the option-stage prompt (`meal_options_stage`) so
# `MealOptionsLLMResult.follow_ups` rides the same structured call that
# already returns the 3 options -- no extra model call.
MEAL_OPTIONS_FOLLOW_UPS_RULES = f"""\

Also return follow_ups: 2-4 short next asks in the user's own voice that \
would change or re-ask these options, e.g. "Something with less prep", \
"Make the pasta one vegetarian", "Can the sides be lighter?". Each under \
60 characters, no emoji, no numbering. {_MEAL_FOLLOW_UPS_COMMON_RULE}\
"""

# Appended to exactly one dish-expansion prompt per pick turn -- the main
# dish's (`_expand_dish_result(..., with_follow_ups=True)`) -- so the pills
# ride that one extra structured field rather than a separate call.
MEAL_READY_FOLLOW_UPS_RULES = f"""\

Also return follow_ups: 2-4 short cooking questions about this whole meal, \
e.g. "Can I prep any of this ahead?", "What should I start first?". Never \
ask to change a single dish (the meal screen owns swaps) and never re-ask \
for meal options (a fixed pill already does that). Each under 60 \
characters, no emoji, no numbering. {_MEAL_FOLLOW_UPS_COMMON_RULE}\
"""

# Appended to either follow-ups rule above when the user opted out of the
# pantry (issue #287) -- mirrors MEAL_DISH_PANTRY_BLOCK_NO_PANTRY's approach
# for the recipe body: the pills must stay pantry-blind too.
MEAL_FOLLOW_UPS_NO_PANTRY_RULE = """\
 Never mention the pantry, stock, the fridge, or expiring items in \
follow_ups.\
"""

# Appended to the option-stage prompt on a `context.meal_followup` turn
# (issue #651 §5e), naming the options already offered this conversation so
# a "Make it vegetarian" tap builds on them instead of starting over blind.
MEAL_OPTIONS_PREVIOUS_BLOCK = (
    "\nAlready suggested in this conversation: {options}. If the user's "
    "request refers to one of these (most likely one just shown), build on "
    "it; otherwise suggest meals different from all of them."
)

# Inserted after MEAL_OPTIONS_PREVIOUS_BLOCK when a "Make it a meal" flow fixes
# the main dish (issue #651 PR B). `{title}` is the outline name with `"`
# replaced by `'` so a title can't close the quotes; `{cuisine_part}` is
# ` ({cuisine})` or ""; `{ingredients}` is the first 20 names or "not listed".
# The server overwrites every option's main with the fixed one regardless, so
# this only steers the model toward good, distinct sides.
MEAL_OPTIONS_FIXED_MAIN_BLOCK = (
    "\nThe main dish is fixed: \"{title}\"{cuisine_part}. Its ingredients: "
    "{ingredients}. Every option must use exactly this main, unchanged, as its "
    "one main dish, named \"{title}\". The options differ ONLY in their sides: "
    "give each option 1-2 sides that complement this main (don't repeat its main "
    "ingredient or its starch), and make each option's sides genuinely different "
    "from the other options' sides. This overrides the rule about different "
    "mains. The constraints above apply to the sides; never change the main."
)

# Appended right after MEAL_OPTIONS_FOLLOW_UPS_RULES (and before the no-pantry
# rule) when the main is fixed: the pills must not offer to change it.
MEAL_OPTIONS_FIXED_MAIN_FOLLOW_UPS_RULE = (
    " The main is fixed, so follow_ups may only change the sides or the whole "
    "meal's timing, e.g. \"Make the sides lighter\", \"Something green on the "
    "side\" — never ask to change or replace the main."
)
