"""LLM prompts for AI-based recipe extraction from a URL.

Feeds `bubbly_chef.services.recipe_url_ingestor.ingest_recipe_from_url`'s
Tier-3 fallback: extracting a structured RecipeCard from fetched HTML, or
(when the page could not be fetched) from the model's own training knowledge
of the URL. ``_AI_VIDEO_PROMPT`` is the YouTube path (issue #528): the model
watches the video itself and signals "not a recipe" with an empty card. Edits here are fresh-context reviewed and `verify`-checked: prompt wording changes model
behavior even though the test suite can stay green.
"""

_AI_EXTRACTION_PROMPT = """\
You are a recipe extraction assistant. Extract the recipe from the HTML below and return \
a structured JSON object matching the RecipeCard schema exactly.

Rules:
- title: string (required)
- description: string or null
- ingredients: list of objects with "name" (required), "quantity" (float|null), \
"unit" (measurement unit only — e.g. "cups", "g", "tablespoon"; do NOT put size \
descriptors like "medium" or "large" in unit; use "preparation" for those instead), \
"preparation" (str|null), "optional" (bool), "substitutes" (list[str])
- instructions: list of strings, each a single step
- prep_time_minutes: integer or null
- cook_time_minutes: integer or null
- total_time_minutes: integer or null
- servings: integer or null
- cuisine: string or null (e.g. "Italian", "Mexican")
- dietary_tags: list of strings (e.g. ["vegan", "gluten-free"])
- image_url: string or null (the recipe's primary image URL, if present in the page)
- source_type: "url"
- source_url: "{source_url}"

HTML (truncated to first 8000 chars):
{html}
"""

_AI_NO_FETCH_PROMPT = """\
Extract the recipe at the URL below. The page could not be fetched directly, so use your
training knowledge of this specific recipe page to fill in details accurately.

Return a JSON object with these fields:
- title: string (required)
- description: string or null
- ingredients: list of objects with "name" (required), "quantity" (float|null), \
"unit" (measurement unit only — e.g. "cups", "g", "tablespoon"; do NOT put size \
descriptors like "medium" or "large" in unit; use "preparation" for those instead), \
"preparation" (str|null), "optional" (bool), "substitutes" (list[str])
- instructions: list of strings, each a single step
- prep_time_minutes: integer or null
- cook_time_minutes: integer or null
- total_time_minutes: integer or null
- servings: integer or null
- cuisine: string or null
- dietary_tags: list of strings
- source_type: "url"
- source_url: "{source_url}"

Do NOT include image_url — omit it entirely or set it to null.

URL: {source_url}
"""

_AI_VIDEO_PROMPT = """\
You are watching a cooking video (usually a short vertical clip). Extract the recipe \
from what is SHOWN and what is SAID: on-screen text, captions, spoken instructions, and \
what you see being cooked. Many videos show a recipe without ever naming the amounts, so \
when a quantity is only visible (a spoonful, a handful, a pour), give your best estimate \
as a number plus a unit. Estimate only amounts — never invent an ingredient or a step \
that does not appear in the video.

If the video is NOT a recipe (no food being prepared, no ingredients or cooking steps — \
for example a vlog, a review, a restaurant tour, a meme or music), do NOT invent one. \
Return title "Not a recipe", an empty ingredients list and an empty instructions list.

Return a JSON object matching the RecipeCard schema:
- title: string (required)
- description: string or null (one short sentence)
- ingredients: list of objects with "name" (required), "quantity" (float|null), \
"unit" (measurement unit only — e.g. "cups", "g", "tablespoon"; do NOT put size \
descriptors like "medium" or "large" in unit; use "preparation" for those instead), \
"preparation" (str|null), "optional" (bool), "substitutes" (list[str])
- instructions: list of strings, each a single step, in the order shown
- prep_time_minutes: integer or null
- cook_time_minutes: integer or null
- total_time_minutes: integer or null
- servings: integer or null
- cuisine: string or null
- dietary_tags: list of strings

Do NOT include image_url, source_url or source_type.
"""
