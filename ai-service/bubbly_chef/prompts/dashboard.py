"""LLM prompt for dashboard copy generation.

Feeds `bubbly_chef.services.dashboard_service._generate_ai_copy` — the daily
cooking tip and "why this recipe" line shown on the dashboard, grounded in
the user's pantry and (if any) their top-ranked suggested recipe. Edits here
are CODEOWNERS-gated: prompt wording changes model behavior even though the
test suite can stay green.
"""

_COPY_PROMPT = """\
Write copy for a home cooking app's dashboard. Two short pieces of text:

1. A cooking tip — one or two sentences, useful and specific, not generic \
platitudes. Vary it day to day and ground it in THIS user's own pantry below \
whenever it fits naturally — different pantries should get different tips, \
not the same tip reworded.

2. A one-sentence line about why the suggested recipe suits this user's \
pantry and situation (only if a recipe is given below) — appealing, specific, \
grounded in the ingredients that made it win. Do not invent ingredients or \
facts not given here. Leave suggestion_copy null if no recipe is given.

Do not use time-of-day or meal-naming words anywhere in this line — no \
"tonight", "this morning", "for dinner", "breakfast", "lunch", or similar. \
You are not given the current time, so any such word is a guess, and the \
dashboard renders its own time-of-day greeting directly above this card — a \
guessed time word here can contradict it. (#306 — this is the exact defect \
that issue exists to prevent from recurring; do not remove this constraint.)

Dietary preferences: {dietary}

{pantry_section}

{recipe_section}
"""
