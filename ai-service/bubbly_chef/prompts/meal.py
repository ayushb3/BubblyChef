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

Issue #718: the expiring-items wording follows the profile's `expiry_priority`
(issue #502, `domain.expiry_priority`). `meal_options_system_prompt` and
`meal_dish_pantry_block` render the option-stage rule and the dish pantry block
per level (Off / Gentle / Aggressive); Gentle is the text this module always had,
so `MEAL_OPTIONS_SYSTEM_PROMPT` and `MEAL_DISH_PANTRY_BLOCK` stay as aliases of it.
The #288 coherence guard and the "explicit request wins" rule hold at every level.
"""

from bubbly_chef.domain.expiry_priority import DEFAULT_EXPIRY_PRIORITY, ExpiryPriority

# Shared by both option-stage system prompts (issue #758). The model used to read
# "every option must have at least one side" and return exactly one side every
# time, and to stop at 2 options. This names the 3-option target, when 2 is
# acceptable, and an example of each side count so 0, 1 and 2 are all live shapes.
_MEAL_OPTION_SHAPE_RULES = """\
Propose 3 meal options. Return only 2 when the request or the ingredients \
genuinely leave room for no more (a thin pantry or tight constraints), and \
only 1 if there is truly a single sensible meal; never return more than 3.

Each meal option is exactly one MAIN dish plus 0, 1 or 2 SIDE dishes, fitted \
to the main. Never default to exactly one side: the number of sides is a \
judgement about what that main needs, and the options in one set should \
often have different numbers of sides. The three shapes:
- no side: a main that is already a whole plate, e.g. a loaded ramen bowl or \
a hearty beef stew.
- one side: a main that wants one contrast, e.g. lasagne with a crisp green \
salad.
- two sides: a simple main that needs building out, e.g. a roast chicken \
with roast potatoes and green beans.
No option may have more than one main.\
"""

_MEAL_OPTIONS_INTRO = f"""\
You are a meal-planning assistant. Given the user's request, their available \
ingredients, and their constraints, propose meal options for the same \
occasion.

{_MEAL_OPTION_SHAPE_RULES}

For each dish, give a name (2-5 words) and list 3-6 KEY ingredients -- the \
ones that matter for whether the user has what they need, not the full \
ingredient list. Estimate est_total_minutes and est_hands_on_minutes for \
each dish, in whole minutes.

Rules:
- The options must be genuinely different from one another -- different \
mains, not the same dish with a swapped side. Each option's main has to \
differ from the other options' mains in its main protein or its cuisine; \
three variations on one stew are one option, not three. Even when the pantry \
is mostly one protein, at most two options may be built on it, and set each \
option's cuisine.
- If "Must use" ingredients are listed, every option must actually use them \
-- this overrides every other preference.
"""

# Expiry priority (issue #718, mirroring #502's brainstorm rules): how hard expiring
# food is pushed into the options. Off carries no expiring-items rule at all.
_MEAL_OPTIONS_EXPIRY_RULES: dict[ExpiryPriority, str] = {
    "off": "",
    "gentle": (
        "- Ingredients marked as expiring soon are a strong preference, not a "
        "requirement: weave them into an option where they genuinely fit a dish, and "
        "leave them out of an option where they don't belong. Don't wedge a sweet "
        "ingredient like fruit into a savoury dish unless the user asked for that "
        "combination or it's a genuine part of the cuisine in play.\n"
    ),
    # The #288 coherence guard stays; an explicit request still wins.
    "aggressive": (
        "- Ingredients marked as expiring soon are a high priority: build as many "
        "options as sensibly possible around them, and leave an expiring ingredient "
        "out of an option only when it would clearly clash with the dish. An explicit "
        'request (a named dish, a cuisine, or "Must use" ingredients) still wins: add '
        "an expiring ingredient to that dish only where it fits. Every option has to "
        "make culinary sense on its own terms -- don't weld an ingredient into a dish "
        "just because it's expiring. In particular, don't wedge a sweet ingredient "
        "like fruit into a savoury dish unless the user asked for that combination or "
        "it's a genuine part of the cuisine in play.\n"
    ),
}

# Seasoning and honesty (issue #852). Both option prompts share the honesty rule; the
# seasoning rule differs only in where seasonings may come from, and the no-pantry
# prompt's must not mention the pantry at all (issue #287).
_MEAL_OPTIONS_NAMED_INGREDIENTS_RULE = """\
- Every ingredient you name in a title or blurb must also be in the \
key_ingredients of one of that option's dishes. Name nothing the dishes \
won't contain.
"""

_MEAL_OPTIONS_SEASONING_RULE = """\
- Treat salt, pepper, cooking oil and any spices, herbs or aromatics listed as \
available as stocked. Every dish must be properly seasoned, never bland: put \
the seasonings that define its flavour (e.g. garlic, cumin, lemon) in its \
key_ingredients, drawn from what is available or from salt, pepper and oil. \
Those seasonings may take a dish past 6 key ingredients.
"""

_MEAL_OPTIONS_RULES_TAIL = """\
- Match the cuisine, mood, and dietary restrictions if specified.
- If kitchen limits are listed (e.g. "one pan"), keep the dishes simple \
enough to realistically cook with that limited equipment -- exact \
equipment tagging happens later, at the pick stage; here it only shapes \
what you suggest.
- Give each option a short, appetizing title and a one-sentence blurb.\
"""


def meal_options_system_prompt(expiry_priority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY) -> str:
    """The pantry-grounded option-stage system prompt for one expiry-priority level."""
    return (
        _MEAL_OPTIONS_INTRO
        + _MEAL_OPTIONS_EXPIRY_RULES[expiry_priority]
        + _MEAL_OPTIONS_SEASONING_RULE
        + _MEAL_OPTIONS_NAMED_INGREDIENTS_RULE
        + _MEAL_OPTIONS_RULES_TAIL
    )


# The Gentle (default) rendering, kept under its old name for importers.
MEAL_OPTIONS_SYSTEM_PROMPT = meal_options_system_prompt("gentle")

# Used when the user has asked us not to look at their pantry (issue #287).
# Mirrors BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY's approach for single-dish
# brainstorming: the pantry-dependent rules are dropped rather than softened.
MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY = f"""\
You are a meal-planning assistant. Propose meal options for the same \
occasion, from the user's request alone.

The user has asked you NOT to use their pantry. Do not mention their \
pantry, their stock, or anything expiring, and do not steer the \
suggestions toward ingredients you think they might have. Work only from \
what they asked for.

{_MEAL_OPTION_SHAPE_RULES}

For each dish, give a name (2-5 words) and list 3-6 KEY ingredients. \
Estimate est_total_minutes and est_hands_on_minutes for each dish, in \
whole minutes.

Rules:
- The options must be genuinely different from one another. Each option's \
main has to differ from the other options' mains in its main protein or its \
cuisine; three variations on one stew are one option, not three. At most two \
options may share a main protein, and set each option's cuisine.
- If "Must use" ingredients are listed, every option must actually use them.
- Treat salt, pepper and cooking oil as on hand. Every dish must be properly \
seasoned, never bland: put the seasonings that define its flavour (e.g. \
garlic, cumin, lemon) in its key_ingredients. Those seasonings may take a \
dish past 6 key ingredients.
""" + _MEAL_OPTIONS_NAMED_INGREDIENTS_RULE + """\
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
"just the previous step", use [] for "can start at the beginning". A \
hands-off wait like "Preheat the oven" is a prerequisite of only the steps \
that need it (the roast), so prep that can happen meanwhile (chopping, \
seasoning) depends on what it really uses, not on the step before it),
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
# reach the pick stage, not just the option cards (PR #659 review). The grounded
# block follows the expiry-priority level (issue #718): Off lists every item as
# plain stock, with no "Priority ingredients (expiring soon)" line.
_MEAL_DISH_PANTRY_BLOCKS: dict[ExpiryPriority, str] = {
    "off": """\
Ingredients available: {supporting_items}
Build the recipe from these ingredients where you can. For any missing \
ingredients, suggest pantry substitutes where possible.\
""",
    "gentle": """\
Priority ingredients (expiring soon -- a strong preference, not a \
requirement): {priority_items}
Supporting ingredients available: {supporting_items}
Build the recipe from these ingredients where you can. For any missing \
ingredients, suggest pantry substitutes where possible.\
""",
    "aggressive": """\
Priority ingredients (expiring soon -- use them up if you can): {priority_items}
Supporting ingredients available: {supporting_items}
Build the recipe around the priority ingredients and use the other ingredients \
where you can. Leave a priority ingredient out only if it would clearly clash \
with the dish, and don't wedge a sweet ingredient like fruit into a savoury \
dish unless the user asked for that combination or it's a genuine part of the \
cuisine in play. The dish itself is already chosen and still wins: add a \
priority ingredient only where it fits. For any missing ingredients, suggest \
pantry substitutes where possible.\
""",
}


def meal_dish_pantry_block(expiry_priority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY) -> str:
    """The grounded pantry-block template (unformatted) for one expiry-priority level."""
    return _MEAL_DISH_PANTRY_BLOCKS[expiry_priority]


# The Gentle (default) rendering, kept under its old name for importers.
MEAL_DISH_PANTRY_BLOCK = meal_dish_pantry_block("gentle")

MEAL_DISH_PANTRY_BLOCK_NO_PANTRY = """\
The user has asked you NOT to use their pantry. Do not mention their \
pantry, their stock, or anything expiring, and do not steer the recipe \
toward ingredients you think they might have. Work only from the dish and \
the rest of the meal.\
"""

# Appended to every dish-expansion prompt (issue #852). The option card promised these
# seasonings; the recipe has to list them, and has to be seasoned even when the card
# listed none. Pantry-neutral wording so it is safe under the no-pantry opt-out (#287).
MEAL_DISH_SEASONING_RULE = """
Season the dish properly: use salt, pepper, cooking oil and the spices, herbs or \
aromatics that suit it, and list every one you use in "ingredients". A recipe with \
no seasoning is not acceptable.\
"""

# `{ingredients}` is the dish outline's key_ingredients, comma-joined. Omitted when the
# outline has none.
MEAL_DISH_PROMISED_INGREDIENTS_RULE = """
The meal card promised these ingredients for this dish, so the recipe must include \
every one of them: {ingredients}.\
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

# The user's last ~10 saved and cooked recipe/meal titles (issue #852), so a library of six
# tomato-chickpea stews stops producing a seventh. `{titles}` is `"; "`-joined, already
# cleaned by `workflows.meal.variety.avoid_titles_block`. Not pantry data, so it rides the
# opt-out prompt too. Omitted entirely when there is no history or on a fixed-main turn.
MEAL_OPTIONS_AVOID_BLOCK = (
    "\nDishes the user already has saved or has cooked recently: {titles}. Don't "
    "suggest any of these or a close variant of one -- offer something new. If the "
    "user's own request names one of them, that request wins."
)

# The one bounded replacement call (issue #877), appended to the option prompt when two
# options shared a main protein and cuisine. `{kept}` is the options that stay, one line
# each; `{count}` how many are missing; `{avoid}` the protein(s) to steer away from.
MEAL_OPTIONS_REPLACE_BLOCK = (
    "\n\nREPLACEMENT ROUND. These options are settled and stay exactly as they are: {kept}. "
    "{count} more option(s) are needed, so ignore \"Propose 3\" above and propose exactly "
    "{count}. Each new option's main dish must be built on a main protein other than "
    "{avoid}, and must differ from every settled option. "
    "Keep every rule above, including seasoning and the pantry."
)

# Added to the option prompt when a typed message changes the meal on screen (issue
# #846), so the model reads it as an adjustment of what is already agreed rather than a
# fresh brief. The constraints and pantry above already carry the saved state.
MEAL_OPTIONS_REFINEMENT_BLOCK = (
    "\nThe user is refining the meals above, not starting over. Every constraint and "
    "pantry item listed above still applies; their latest message changes something on "
    "top of that. Follow it literally -- \"quicker\" means a shorter total time than "
    "the meals already shown, \"fewer dishes\" means fewer dishes in each option, and an "
    "ingredient they don't have or don't want appears in no dish. Answer with new "
    "meal options; never ask what ingredients they have, you already know."
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
    "mains and the no-side shape: here every option has sides, never none. The "
    "constraints above apply to the sides; never change the main."
)

# Appended to the fixed-main block on a follow-up turn, when "Already suggested"
# lists earlier sides (issue #762). On production a "different sides" tap
# reused earlier sides in every option despite the soft "different from all of
# them" line, so this is stated as a hard rule; the option stage also drops any
# repeated side in code, so this is the first of two defences.
MEAL_OPTIONS_FIXED_MAIN_NO_REPEAT_RULE = (
    "\nHard rule for this turn: no side from the \"Just shown\" or \"Earlier\" "
    "lists above may appear in any option, alone or beside a new side, however "
    "it is worded. Every side you give must be a dish not yet suggested in this "
    "conversation."
)

# Appended right after MEAL_OPTIONS_FOLLOW_UPS_RULES (and before the no-pantry
# rule) when the main is fixed: the pills must not offer to change it.
MEAL_OPTIONS_FIXED_MAIN_FOLLOW_UPS_RULE = (
    " The main is fixed, so follow_ups may only change the sides or the whole "
    "meal's timing, e.g. \"Make the sides lighter\", \"Something green on the "
    "side\" — never ask to change or replace the main."
)
