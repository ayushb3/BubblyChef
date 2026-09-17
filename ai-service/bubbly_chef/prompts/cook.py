"""LLM prompt for the cook-flow ingredient substitution matcher.

Feeds `bubbly_chef.services.cook_matcher` — the pass that decides, for each
recipe ingredient with no pantry match, whether a pantry item (or a
combination of pantry items) can stand in for it. Edits here are
CODEOWNERS-gated: prompt wording changes model behavior even though the
test suite can stay green.
"""

_SUBSTITUTION_PROMPT = """You are helping a home cook decide whether anything in their \
pantry can stand in for recipe ingredients they appear to be missing.

Recipe ingredients with no pantry match:
{unmatched}

Everything currently in their pantry:
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
with the pantry item names AND compound_note with a short instruction (under 20 words).
   Example: heavy cream is missing, pantry has butter, milk, and flour →
     compound_components: ["butter", "milk", "flour"]
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
