"""Pure text helper for the chat/library refine diet rule (issue #544).

`added_text` answers "what food does this tweak *add*?" so the existing
`_dietary_contradicted` matcher only sees additions, not things the user is
removing or swapping out. It is deliberately small and clause-scoped; it is
not a general NLU pass.
"""

import re

_FREE_SPAN = re.compile(r"\b\w+[- ]?free\b")
_CLAUSE_SPLIT = re.compile(r"[.,;!?]|\bbut\b")
# `swap X for Y` / `replace X with Y`: X goes out, Y comes in.
_SWAP = re.compile(r"\b(?:swap|replace)\s+.+?\s+(?:with|for)\s+")
# The direction of "substitute" is ambiguous in everyday speech, so neither
# side counts as an add. Ends at and/then/clause end. `sub` is a whole word.
_SUBSTITUTE = re.compile(r"\b(?:substitute|sub)\b.*?\bfor\b.*?(?=\band\b|\bthen\b|$)")
_INSTEAD_OF = re.compile(r"\binstead of\b.*?(?=\b(?:use|add|try|with)\b|$)")
_NEGATION = re.compile(
    r"(?:\b(?:no|not|never|without|remove|don't|dont|do not|avoid|skip|hold|drop|lose"
    r"|minus|less|fewer|cut|exclude|omit)\b"
    r"|\bleave out\b|\btake out\b|\bget rid of\b|\btake away\b).*$"
)
# Plant-based foods aren't the forbidden food they're named after (#544): "oat
# milk" is not milk, "tempeh bacon" is not bacon. Refine-only -- the shared
# matcher and the #394 first-turn path stay as they are. The compound form is
# stripped first (before the `-free` span, so "dairy free cheese" is covered);
# the marker-word form runs per clause AFTER the structural rules, since
# stripping "tofu for" earlier would break "substitute tofu for chicken".
_PLANT_COMPOUND = re.compile(
    r"\b(?:coconut|oat|almond|soy|cashew|rice|hemp|pea|plant[- ]based|vegan|dairy[- ]free"
    r"|non[- ]dairy)\s+(?:milk|cream|butter|cheese|yogurt|yoghurt|mayo|mayonnaise)\b"
)
_PLANT_MARKER = re.compile(
    r"\b(?:vegan|veggie|vegetarian|plant[- ]based|meatless|mock|faux|tofu|tempeh|seitan)\s+\w+"
)


def added_text(tweak: str) -> str:
    """The part of a refine tweak that adds foods, with negated spans removed."""
    text = tweak.lower().replace("’", "'")
    text = _PLANT_COMPOUND.sub(" ", text)
    text = _FREE_SPAN.sub(" ", text)

    kept: list[str] = []
    for clause in _CLAUSE_SPLIT.split(text):
        clause = _SWAP.sub(" ", clause)
        clause = _SUBSTITUTE.sub(" ", clause)
        clause = _INSTEAD_OF.sub(" ", clause)
        clause = _NEGATION.sub(" ", clause)
        clause = _PLANT_MARKER.sub(" ", clause)
        clause = " ".join(clause.split())
        if clause:
            kept.append(clause)
    return " ".join(kept)
