"""LLM prompt for the cook-flow ingredient substitution matcher.

Feeds `bubbly_chef.services.cook_matcher` — the pass that decides, for each
recipe ingredient with no pantry match, whether a pantry item (or a
combination of pantry items) can stand in for it. Prompt wording changes
model behavior even though the test suite can stay green, so a change here
needs a `verify` run exercising the affected output (see
`ai-service/bubbly_chef/prompts/README.md`), and the fresh-context review
reads the change as a behavior change.
"""

_SUBSTITUTION_PROMPT = """You are helping a home cook decide whether anything in their \
pantry can stand in for recipe ingredients they appear to be missing.

Recipe ingredients with no pantry match:
{unmatched}

Everything currently in their pantry, with the unit its quantity is tracked in \
(a bracketed unit means we know it; "[unit unknown]" means we don't):
{pantry}

For each unmatched ingredient:

1. PREFER a single pantry item when one genuinely works:
   - Use match_type "exact" when it is the same ingredient under a different name \
(scallion and green onion are the same; pecorino romano and parmesan are NOT).
   - Use match_type "substitute" when a different ingredient would still work; note \
briefly what changes — flavour, texture, sweetness.
   - Set best_match to the pantry item name. Leave compound_components null.

2. If NO single item works but 2-3 pantry items COMBINED can approximate the missing \
ingredient, set match_type "none", best_match null, and populate compound_components \
with the pantry item names and compound_note with a short instruction (under 20 words).
   You may also estimate how much of EACH named component to use, in compound_quantities \
— a plain number — paired with compound_units giving the unit that number is in, both \
keyed by the exact same spelling used in compound_components. The unit in compound_units \
MUST be copied EXACTLY from that item's bracketed unit above (e.g. "g", "ml", or "count") \
— never a different unit, and never a unit of your own choosing. If an item is listed as \
"[unit unknown]", or you are not confident of the amount, omit it from BOTH \
compound_quantities and compound_units entirely — an empty box the cook fills in \
themselves is better than a wrong number they might not double-check, and a quantity in \
the wrong unit is worse than no quantity at all.
   Example: heavy cream (1 cup, ~240ml) is missing, pantry has butter [g], milk [ml], and \
flour [g] →
     compound_components: ["butter", "milk", "flour"]
     compound_quantities: {{"butter": 80, "milk": 180, "flour": 15}}
     compound_units: {{"butter": "g", "milk": "ml", "flour": "g"}}
     compound_note: "Melt butter, whisk in flour, stir in milk until thickened"
   ONLY list items the user actually has. Do not invent ingredients.

3. If nothing works, set match_type "none", best_match null, compound_components null.

Do not suggest a swap that would change the dish into something else, and do not treat \
derivatives as interchangeable: lemon juice cannot replace lemon zest, and vice versa. \
Set confidence below {threshold} for anything you are unsure about.

Always fill substitution_note, including when match_type is "none" — there, say what the \
cook should do about it: whether the dish works without it, what it costs them, or what \
they would need to buy. "No good stand-in; the sauce will be thinner" is more use than \
silence.

Keep substitution_note and compound_note under 20 words each. Return one result per \
unmatched ingredient."""
