"""Issue #852 eval: do meal options come back seasoned, honest and varied?

Two modes, so the same live capture can be run against two checkouts of the code:

  run     Drive the real `meal_options_stage` against two stub pantries with the REAL
          Gemini provider for the options call only (constraint extraction is stubbed, so
          one stage run is one live call). Writes the raw model output, the final options
          and the prompt to a JSON file. Run it once from a `git archive origin/main`
          checkout (label "before") and once from the feature worktree (label "after").
  report  Read those JSON files and print a markdown table. Needs the feature checkout.

A hard call budget is kept in a counter file shared across invocations and enforced at the
provider boundary (every HTTP request, including structured-output retries, counts).

    cd <checkout>/ai-service
    PYTHONPATH=<checkout>/ai-service python <worktree>/ai-service/scripts/eval_issue_852_meal_variety.py \
        run --root <checkout>/ai-service --label after --pantry A --out after-A.json \
        --counter calls.json --budget 6
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

ENV_SOURCE_KEYS = (
    "BUBBLY_GEMINI_API_KEY",
    "BUBBLY_GEMINI_MODEL",
    "BUBBLY_SUPABASE_URL",
    "BUBBLY_SUPABASE_SECRET_KEY",
    "BUBBLY_SUPABASE_JWT_SECRET",
)

# (name, category) -- two pantries chosen so a lazy model has an obvious default dish.
PANTRIES: dict[str, dict[str, Any]] = {
    "A": {
        "label": "A: stew-prone (tomato/chickpea/spices)",
        "items": [
            "canned tomatoes", "chickpeas", "onion", "garlic", "spinach", "rice", "red lentils",
            "cumin", "smoked paprika", "turmeric", "olive oil", "salt", "black pepper",
            "feta cheese", "eggs", "lemon",
        ],
        # the issue's "6+ near-identical tomato-chickpea stews" in the library
        "avoid": [
            "Tomato Chickpea Stew", "Spicy Tomato and Chickpea Stew",
            "Smoky Chickpea Tomato Stew", "Moroccan Chickpea Stew",
            "Tomato Chickpea Spinach Stew", "Hearty Chickpea and Tomato Stew",
        ],
    },
    "B": {
        "label": "B: chicken/pasta/veg (aromatics + dried herbs)",
        "items": [
            "chicken thighs", "potatoes", "broccoli", "pasta", "parmesan cheese", "butter",
            "garlic", "ginger", "soy sauce", "dried oregano", "chili flakes", "lemon", "eggs",
            "olive oil", "salt", "black pepper", "carrots",
        ],
        "avoid": [
            "Lemon Herb Roast Chicken", "Chicken Alfredo Pasta", "Garlic Parmesan Potatoes",
            "Lemon Garlic Chicken Thighs", "Chicken and Broccoli Pasta Bake",
        ],
    },
}

REQUEST = "Plan dinner for tonight"


def _load_env_from(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() in ENV_SOURCE_KEYS:
            os.environ.setdefault(key.strip(), value.strip())
    os.environ["BUBBLY_OLLAMA_BASE_URL"] = "http://127.0.0.1:1"  # never a local model


def _spend(counter: Path, budget: int) -> int:
    used = json.loads(counter.read_text(encoding="utf-8"))["used"] if counter.exists() else 0
    if used >= budget:
        raise SystemExit(f"live Gemini budget exhausted ({used}/{budget})")
    counter.write_text(json.dumps({"used": used + 1}), encoding="utf-8")
    return used + 1


async def run(args: argparse.Namespace) -> None:
    root = Path(args.root).resolve()
    sys.path.insert(0, str(root))  # this checkout's package wins over any editable install
    _load_env_from(Path(args.env_file))

    import bubbly_chef  # imported only after the env is set

    pkg = Path(bubbly_chef.__file__).resolve()
    if root not in pkg.parents:
        raise SystemExit(f"wrong package: {pkg} is not under {root}")
    print(f"package: {pkg}")

    from bubbly_chef.ai.gemini import GeminiProvider
    from bubbly_chef.api.deps import get_ai_manager
    from bubbly_chef.models.meal import MealOptionsLLMResult
    from bubbly_chef.models.pantry import FoodCategory, PantryItem
    from bubbly_chef.models.recipe import RecipeConstraints
    from bubbly_chef.workflows.meal.nodes import meal_options_stage

    counter = Path(args.counter)
    original = GeminiProvider.complete
    http_calls = 0

    async def counted(self: Any, *a: Any, **k: Any) -> Any:
        nonlocal http_calls
        _spend(counter, args.budget)
        http_calls += 1
        return await original(self, *a, **k)

    GeminiProvider.complete = counted  # type: ignore[method-assign]

    pantry_def = PANTRIES[args.pantry]
    pantry = [
        PantryItem(name=n, category=FoodCategory.OTHER, quantity=2.0) for n in pantry_def["items"]
    ]
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=pantry)
    repo.get_recent_meal_servings = AsyncMock(return_value=[])
    repo.get_recent_cuisines = AsyncMock(return_value=[])
    repo.get_recent_dish_titles = AsyncMock(return_value=list(pantry_def["avoid"]))
    repo.get_profile = AsyncMock(return_value={})

    if args.dry:  # offline wiring check: a canned answer, no network, no budget spent
        from bubbly_chef.models.meal import MealDishOutlineLLM, MealOptionLLM

        canned = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Dry Run",
                    blurb="Crispy chicken with garlic.",
                    dishes=[
                        MealDishOutlineLLM(role="main", name="Chicken", key_ingredients=["chicken"])
                    ],
                )
            ]
        )
        real = MagicMock()
        real.complete = AsyncMock(return_value=canned)
        real.close = AsyncMock()
    else:
        real = get_ai_manager()
    captured: dict[str, Any] = {"prompt": None, "raw": None}

    class Proxy:
        async def complete(
            self, *, prompt: str, response_schema: type, temperature: float = 0.7
        ) -> Any:
            if response_schema is MealOptionsLLMResult:
                captured["prompt"] = prompt
                result = await real.complete(
                    prompt=prompt, response_schema=response_schema, temperature=temperature
                )
                captured["raw"] = result.model_dump()
                return result
            if response_schema is RecipeConstraints:
                return RecipeConstraints()  # stubbed: keeps one stage run to one live call
            raise AssertionError(f"unexpected model call {response_schema!r}")

    get_repo = AsyncMock(return_value=repo)
    proxy = MagicMock(return_value=Proxy())
    no_diet = AsyncMock(return_value=[])
    patches = [
        patch(f"bubbly_chef.{mod}.get_repository", get_repo)
        for mod in (
            "workflows.meal.nodes",
            "workflows.meal.fixed_main",
            "workflows.recipe.nodes",
            "services.expiry_priority",
            "services.food_exclusions",
        )
    ] + [
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", proxy),
        patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", proxy),
        patch("bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences", no_diet),
        patch("bubbly_chef.workflows.meal.fixed_main.get_stored_dietary_preferences", no_diet),
    ]
    for p in patches:
        p.start()
    try:
        state: Any = {
            "input_text": REQUEST,
            "user_id": "eval-user",
            "context": None,
            "session": None,
            "errors": [],
            "warnings": [],
        }
        out = await meal_options_stage(state)
    finally:
        for p in patches:
            p.stop()
        await real.close()

    proposal = out.get("proposal")
    final = [o.model_dump(mode="json") for o in proposal.options] if proposal else []
    Path(args.out).write_text(
        json.dumps(
            {
                "label": args.label,
                "pantry": args.pantry,
                "package": str(pkg),
                "http_calls": http_calls,
                "prompt": captured["prompt"],
                "raw": captured["raw"],
                "final": final,
                "avoid": pantry_def["avoid"],
                "pantry_items": pantry_def["items"],
                "error": out.get("assistant_message") if not final else None,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"{args.label}/{args.pantry}: {len(final)} options, {http_calls} live call(s)")


SEASONING_WORDS = (
    "salt", "pepper", "oil", "garlic", "ginger", "cumin", "paprika", "oregano", "thyme", "basil",
    "rosemary", "parsley", "cilantro", "coriander", "turmeric", "cinnamon", "chili", "curry",
    "cayenne", "mustard", "lemon", "lime", "soy sauce", "vinegar", "herb", "spice", "dill",
    "mint", "sage", "harissa", "chive", "scallion", "green onion", "bay leaf", "nutmeg",
    "cardamom", "fennel", "za'atar", "sumac",
)


def _seasoned(dish_ingredients: list[str]) -> bool:
    text = " ".join(dish_ingredients).lower()
    return any(w in text for w in SEASONING_WORDS)


def report(args: argparse.Namespace) -> None:
    sys.path.insert(0, str(Path(args.root).resolve()))
    from bubbly_chef.workflows.meal.variety import (
        _repeats,
        _title_words,
        unsupported_claims,
    )

    rows: list[dict[str, Any]] = [json.loads(Path(f).read_text(encoding="utf-8")) for f in args.files]
    header = (
        "| run | options | seasoned options | seasoned dishes | blurb claims unbacked "
        "(as the model wrote) | unbacked (as shipped) | options repeating an avoided title "
        "(model) | repeating (shipped) |"
    )
    print(header)
    print("|" + "---|" * 8)
    detail: list[str] = []
    for r in rows:
        avoid_words = [_title_words(t) for t in r["avoid"]]

        def opts(kind: str, r: dict[str, Any] = r) -> list[dict[str, Any]]:
            return list(r[kind]["options"]) if kind == "raw" else list(r[kind])

        def stats(options: list[dict[str, Any]]) -> tuple[int, int, int, int, int]:
            seasoned_opts = seasoned_dishes = dishes = unbacked = repeats = 0
            for o in options:
                ingredients = [i for d in o["dishes"] for i in d.get("key_ingredients", [])]
                names = [d["name"] for d in o["dishes"]]
                seasoned_opts += _seasoned(ingredients)
                for d in o["dishes"]:
                    dishes += 1
                    seasoned_dishes += _seasoned(d.get("key_ingredients", []))
                unbacked += len(unsupported_claims(o.get("blurb") or "", names + ingredients, r["pantry_items"]))
                main = next((d["name"] for d in o["dishes"] if d["role"] == "main"), "")
                repeats += any(_repeats(main, a) for a in avoid_words)
            return seasoned_opts, seasoned_dishes, dishes, unbacked, repeats

        if not r["raw"] or not r["final"]:
            print(f"| {r['label']}/{r['pantry']} | no options ({r['error']}) | | | | | | |")
            continue
        raw, fin = opts("raw"), opts("final")
        so, sd, nd, ub_raw, rep_raw = stats(raw)
        _, _, _, ub_fin, rep_fin = stats(fin)
        print(
            f"| {r['label']}/{r['pantry']} | {len(raw)} -> {len(fin)} | {so}/{len(raw)} "
            f"| {sd}/{nd} | {ub_raw} | {ub_fin} | {rep_raw} | {rep_fin} |"
        )
        detail.append(f"\n**{r['label']}/{r['pantry']}**")
        for o in raw:
            main = next((d["name"] for d in o["dishes"] if d["role"] == "main"), "?")
            detail.append(f"- {o['title']} (main: {main}) -- {o.get('blurb')!r}")
    print("\n".join(detail))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    p_run = sub.add_parser("run")
    p_run.add_argument("--root", required=True)
    p_run.add_argument("--label", required=True)
    p_run.add_argument("--pantry", required=True, choices=sorted(PANTRIES))
    p_run.add_argument("--out", required=True)
    p_run.add_argument("--counter", required=True)
    p_run.add_argument("--budget", type=int, default=6)
    p_run.add_argument("--env-file", required=True)
    p_run.add_argument("--dry", action="store_true", help="canned model answer; no live call")
    p_rep = sub.add_parser("report")
    p_rep.add_argument("--root", required=True)
    p_rep.add_argument("files", nargs="+")
    args = parser.parse_args()
    if args.mode == "run":
        asyncio.run(run(args))
    else:
        report(args)


if __name__ == "__main__":
    sys.exit(main())
