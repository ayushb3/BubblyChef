# bubbly_chef/prompts/

Every LLM prompt string used by the AI microservice lives here, grouped by
domain: `router.py` (intent classification), `chat.py` (general chat +
cooking help), `recipe.py` (constraint extraction, brainstorm, grounded
generation, the standalone recipe-generator service), `pantry.py`
(pantry-update parsing + vague-term suggestions), `ingest.py` (receipt +
product parsing), `cook.py` (ingredient substitution), `recipe_url.py`
(URL-based recipe extraction), `dashboard.py` (dashboard copy).

**The one rule: prompt text only, no logic.** These modules hold module-level
string constants and nothing else — no prompt assembly, no `.format()` calls,
no branching on state. The code that builds and sends prompts (routes,
workflow nodes, services) stays in its existing location and imports the
constant it needs from here.

**Changes here need human review even when CI is green.** `pytest`, `mypy`,
and `ruff` all pass on a prompt edit that quietly makes the model worse —
none of them evaluate output quality. A rewording, a dropped constraint, a
reflowed paragraph can silently change what the assistant says or does
without failing a single test. This is why the path is CODEOWNERS-protected:
someone has to actually read the diff and judge the behavior change, because
the test suite can't.

If you're adding a new prompt, put it in the matching domain module (or add
one) as a module-level constant, then import it at the call site under its
existing name — do not inline prompt text anywhere else in `bubbly_chef/`.
