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
    r"(?:\b(?:no|without|remove|don't|avoid|skip|hold|drop|lose|minus|less|fewer|cut)\b"
    r"|\bleave out\b|\btake out\b).*$"
)


def added_text(tweak: str) -> str:
    """The part of a refine tweak that adds foods, with negated spans removed."""
    text = tweak.lower().replace("’", "'")
    text = _FREE_SPAN.sub(" ", text)

    kept: list[str] = []
    for clause in _CLAUSE_SPLIT.split(text):
        clause = _SWAP.sub(" ", clause)
        clause = _SUBSTITUTE.sub(" ", clause)
        clause = _INSTEAD_OF.sub(" ", clause)
        clause = _NEGATION.sub(" ", clause)
        clause = " ".join(clause.split())
        if clause:
            kept.append(clause)
    return " ".join(kept)
