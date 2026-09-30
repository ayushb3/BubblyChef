"""Issue #684: the shared diet matcher (`bubbly_chef.domain.diet_terms`), pure API.

Contract: `docs/plans/2026-09-30-diet-matcher-contract.md` (R6), §3.1
plus the pure rows S9 and S10b. It imports the new symbols, so it can't run on main;
the caller rows that demonstrate main's behaviour live in
`test_issues_684_685_callers.py`.
"""

import re
from typing import Any

import pytest

from bubbly_chef.domain import diet_terms
from bubbly_chef.domain.diet_terms import (
    FIELD_SEP,
    FORBIDDEN_FOODS,
    IRREGULAR_PLURALS,
    join_fields,
    mentions,
    names_forbidden_food,
    norm_label,
    term_pattern,
)
from bubbly_chef.workflows.recipe import refine_diet
from bubbly_chef.workflows.recipe.nodes import (
    _combine_dietary_preferences,
    _drop_redundant_dietary,
    _message_sets_label_aside,
    constraints_to_persist,
)
from bubbly_chef.workflows.recipe.refine_diet import added_clauses, added_text

VEG = "vegetarian"
VEGAN = "vegan"
DAIRY_FREE = "dairy-free"
NUT_FREE = "nut-free"


def _hit(pattern: str, text: str) -> bool:
    return re.search(pattern, text) is not None


# ---------------------------------------------------------------------------
# T-P1 / T-P2: term_pattern
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("term", "text"),
    [
        ("anchovy", "anchovies"),
        ("anchovy", "anchovy"),
        ("turkey", "turkeys"),
        ("tomato", "tomatoes"),
        ("tomato", "tomatos"),
        ("berry", "berries"),
        ("fish", "fishes"),
        ("prawn", "prawns"),
        ("octopus", "octopuses"),
        ("octopus", "octopi"),
        ("goose", "geese"),
        ("goose", "goose"),
        ("sausage", "sausages"),
        ("meatball", "meatballs"),
        ("sea bass", "sea basses"),
        ("sea bass", "sea bass"),
    ],
)
def test_term_pattern_matches_the_forms_of_a_term(term: str, text: str) -> None:
    assert _hit(term_pattern(term), text)


@pytest.mark.parametrize(
    ("term", "text"),
    [
        ("cod", "codes"),
        ("ham", "hamburger"),
        ("ham", "graham"),
        ("egg", "eggplant"),
        ("egg", "eggless"),
        ("nut", "nutmeg"),
        ("nut", "coconut"),
        ("nut", "butternut"),
        ("nut", "doughnut"),
        ("nut", "chestnut"),
        ("lard", "larder"),
        ("scallop", "scalloped"),
        ("goose", "gooseberry"),
        ("pepperoni", "pepper"),
        ("chicken", "chickpea"),
        ("berry", "berrie"),
    ],
)
def test_term_pattern_does_not_match_lookalikes(term: str, text: str) -> None:
    assert not _hit(term_pattern(term), text)


# ---------------------------------------------------------------------------
# T-P3: table hygiene
# ---------------------------------------------------------------------------

# main's `_DIETARY_FORBIDDEN_INGREDIENTS` (recipe/nodes.py:718-744), copied verbatim.
_MAIN_TABLE: dict[str, set[str]] = {
    "vegetarian": {
        "meat", "beef", "pork", "chicken", "turkey", "lamb", "bacon",
        "sausage", "ham", "fish", "shrimp", "salmon", "tuna", "seafood",
    },
    "vegan": {
        "meat", "beef", "pork", "chicken", "turkey", "lamb", "bacon",
        "sausage", "ham", "fish", "shrimp", "salmon", "tuna", "seafood",
        "dairy", "cheese", "milk", "butter", "cream", "yogurt",
        "egg", "eggs", "honey",
    },
    "pescatarian": {"meat", "beef", "pork", "chicken", "turkey", "lamb", "bacon", "sausage", "ham"},
    "dairy-free": {"dairy", "cheese", "milk", "butter", "cream", "yogurt"},
    "nut-free": {
        "nuts", "peanut", "peanuts", "almond", "almonds", "cashew", "cashews",
        "walnut", "walnuts", "pecan", "pecans", "pistachio", "pistachios",
        "hazelnut", "hazelnuts",
    },
}


def test_no_table_entry_is_another_entrys_generated_plural() -> None:
    for label, terms in FORBIDDEN_FOODS.items():
        for a in terms:
            for b in terms:
                if a != b:
                    assert not re.fullmatch(term_pattern(a), b), (label, a, b)


def test_every_term_on_main_is_still_matched_by_its_label() -> None:
    for label, terms in _MAIN_TABLE.items():
        for term in terms:
            assert names_forbidden_food(label, term), (label, term)


def test_every_irregular_plural_key_is_a_table_term() -> None:
    every_term = set().union(*FORBIDDEN_FOODS.values())
    assert set(IRREGULAR_PLURALS) <= every_term


def test_the_table_keys_are_normalised() -> None:
    assert set(FORBIDDEN_FOODS) == {VEG, VEGAN, "pescatarian", DAIRY_FREE, NUT_FREE}
    assert all(norm_label(k) == k for k in FORBIDDEN_FOODS)


# ---------------------------------------------------------------------------
# T-TP: true positives
# ---------------------------------------------------------------------------

_VEG_TERMS = [
    "pancetta", "chorizo", "prosciutto", "salami", "pepperoni", "steak", "duck", "lamb",
    "anchovies", "prawns", "shrimp", "crab", "gelatin", "lard",
]


@pytest.mark.parametrize("term", _VEG_TERMS)
def test_tp_vegetarian_forbidden_terms_in_a_sentence(term: str) -> None:
    assert names_forbidden_food(VEG, f"pasta with {term}")


@pytest.mark.parametrize(
    "text",
    [
        "steaks", "anchovy", "salamis", "sausages", "shrimps", "crabs", "ducks", "lamb chops",
        "meatballs", "non-vegetarian chicken curry", "tofu and chicken", "mushroom chicken",
        "coconut shrimp", "oyster sauce", "soy sauce chicken", "fish sauce",
    ],
)
def test_tp_vegetarian_forms_and_lookalike_dishes(text: str) -> None:
    assert names_forbidden_food(VEG, f"pasta with {text}")


@pytest.mark.parametrize(
    "term",
    [
        "halibut", "tilapia", "haddock", "catfish", "swordfish", "monkfish", "sea bass", "snapper",
        "herring", "eel", "caviar", "roe", "crawfish", "crayfish", "bonito", "brisket",
        "bratwurst", "kielbasa", "andouille", "mortadella", "nduja", "quail", "foie gras",
        "jerky", "tallow", "geese", "octopi",
    ],
)
def test_tp_r1_terms(term: str) -> None:
    assert names_forbidden_food(VEG, f"a dish with {term}")


@pytest.mark.parametrize(
    "text", ["lox", "chicken liver pâté", "suet", "bresaola", "speck", "oxtail", "tripe"]
)
def test_tp_r4_vegetarian_terms(text: str) -> None:
    assert names_forbidden_food(VEG, f"a dish with {text}")


@pytest.mark.parametrize("text", ["eggs", "honey", "ghee", "buttermilk", "cheese", "duck eggs"])
def test_tp_vegan(text: str) -> None:
    assert names_forbidden_food(VEGAN, f"a dish with {text}")


@pytest.mark.parametrize("text", ["apple cheese", "pumpkin cream"])
def test_tp_vegan_butter_only_bases_do_not_cover_other_dairy(text: str) -> None:
    assert names_forbidden_food(VEGAN, text)


def test_tp_dairy_free_buttermilk_pancakes() -> None:
    assert names_forbidden_food(DAIRY_FREE, "buttermilk pancakes")


@pytest.mark.parametrize(
    "text", ["peanut butter", "almond milk", "pine nuts", "walnuts", "macadamia cookies"]
)
def test_tp_nut_free(text: str) -> None:
    assert names_forbidden_food(NUT_FREE, text)


@pytest.mark.parametrize(
    "text",
    [
        "vegetarian but chicken curry",
        "vegan then chicken wings",
        "veggie also chicken wings",
        "vegan except chicken",
        "tofu plus chicken",
    ],
)
def test_tp_r5_the_marker_window_stops_at_but_then_also(text: str) -> None:
    assert names_forbidden_food(VEG, text)


# ---------------------------------------------------------------------------
# T-FP: false positives
# ---------------------------------------------------------------------------

_BOTH = [
    "coconut milk", "butter beans", "oyster mushrooms", "cauliflower steak", "tempeh bacon",
    "vegan chorizo", "eggplant", "chickpeas", "peanut butter", "cream of tartar",
    "crab apples", "lamb's lettuce", "meat-free", "egg-free", "chickpea tuna",
    "jackfruit pulled pork", "coconut bacon", "mushroom meatballs", "mushroom jerky",
    "eggplant caviar", "vegan pulled pork", "veggie sausages", "soya milk", "hazelnut milk",
    "macadamia milk", "flax milk", "walnut milk", "pistachio milk", "beef tomatoes",
    "steak fries", "steak-cut fries", "oyster crackers", "lobster mushroom",
    "meat and dairy free", "egg and dairy free", "egg, dairy and nut free",
    "chicken of the woods", "duck sauce", "cream soda", "butter lettuce", "chia egg",
    "cocoa butter", "shea butter", "non-dairy milk", "non-dairy creamer",
    "salad with beef steak tomatoes", "beef-steak tomato salad",
    "texas caviar", "cowboy caviar", "meat substitute", "meat alternatives",
    "rice paper bacon",
]
# Foods that are only plant-based for a diet that doesn't forbid the base
# ("duck eggs" and "quail eggs" are eggs, so a Vegan still hits `egg`).
_VEG_ONLY = ["duck eggs", "quail eggs", "vegetable suet", "a speck of salt", "specks of pepper"]


@pytest.mark.parametrize("text", _BOTH)
@pytest.mark.parametrize("label", [VEG, VEGAN])
def test_fp_plant_and_lookalike_foods_name_nothing(label: str, text: str) -> None:
    # A Vegetarian only forbids meat and seafood, so the dairy rows trivially pass;
    # the Vegan rows are the ones that need the guards.
    assert not names_forbidden_food(label, text)


@pytest.mark.parametrize("text", _VEG_ONLY)
def test_fp_vegetarian_only_rows(text: str) -> None:
    assert not names_forbidden_food(VEG, text)


@pytest.mark.parametrize(
    "text",
    [
        "coconut milk", "butter beans", "peanut butter", "cream of tartar", "soya milk",
        "hazelnut milk", "macadamia milk", "flax milk", "walnut milk", "pistachio milk",
        "cream soda", "butter lettuce", "cocoa butter", "shea butter", "non-dairy milk",
        "non-dairy creamer", "vegan cheese", "dairy-free yogurt", "plant-based butter",
    ],
)
def test_fp_dairy_free_rows(text: str) -> None:
    assert not names_forbidden_food(DAIRY_FREE, text)
    assert not names_forbidden_food(VEGAN, text)


@pytest.mark.parametrize("text", ["hazelnut milk", "macadamia milk", "walnut milk", "peanut butter"])
def test_fp_nut_milks_still_hit_nut_free(text: str) -> None:
    assert names_forbidden_food(NUT_FREE, text)


def test_fp_flax_egg_is_not_an_egg_for_vegan() -> None:
    assert not names_forbidden_food(VEGAN, "flax egg pancakes")
    assert not names_forbidden_food(VEGAN, "chia eggs")


def test_the_field_separator_pins_why_it_exists() -> None:
    assert names_forbidden_food(VEG, join_fields("pasta", "mushrooms", "bacon"))
    assert names_forbidden_food(VEG, join_fields("tofu", "chicken thighs"))
    # Space-joined, the guards read across the neighbouring fields.
    assert not names_forbidden_food(VEG, "pasta mushrooms bacon")
    assert not names_forbidden_food(VEG, "tofu chicken thighs")


def test_join_fields_uses_the_separator() -> None:
    assert join_fields("a", "b", "c") == FIELD_SEP.join(["a", "b", "c"])
    assert FIELD_SEP == " | "


# ---------------------------------------------------------------------------
# T-F1: guard 1's closed set
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text", ["pasta with chicken, dairy free", "a chicken and dairy-free dinner"]
)
def test_f1_chicken_is_not_a_free_list_item(text: str) -> None:
    assert names_forbidden_food(VEG, text)


@pytest.mark.parametrize(
    ("label", "text"),
    [
        (VEG, "meat and dairy free"),
        (VEGAN, "egg, dairy and nut free"),
        (VEG, "fish and gluten free"),
        (VEG, "meat, dairy and gluten free"),
        (VEG, "meat, dairy, and gluten free"),
        (VEG, "meat or dairy free"),
        (VEGAN, "egg & dairy free"),
        (DAIRY_FREE, "dairy/gluten free"),
        (VEG, "meat- and dairy-free"),
        (VEGAN, "egg, dairy and tree nut free"),
        (NUT_FREE, "tree-nut and peanut free"),
        (VEG, "meat-and-dairy-free lasagne"),
    ],
)
def test_f1_a_coordinated_free_list_names_nothing(label: str, text: str) -> None:
    assert not names_forbidden_food(label, text)


@pytest.mark.parametrize("text", ["pasta with fish, dairy free", "meat, dairy free"])
def test_f1_a_bare_two_item_comma_is_not_a_list(text: str) -> None:
    assert names_forbidden_food(VEG, text)


def test_f1_the_dairy_half_of_a_free_list_is_still_free() -> None:
    assert not names_forbidden_food(DAIRY_FREE, "meat, dairy and gluten free")


def test_mentions_and_term_pattern_ignore_an_empty_term() -> None:
    assert not mentions("", "anything at all")
    assert not mentions("   ", "anything at all")
    assert not re.search(term_pattern(""), "anything at all")


def test_f1_mentions_normalises_itself() -> None:
    assert mentions("chicken", "Chicken")
    assert mentions("lamb", "lamb’s shoulder")


# ---------------------------------------------------------------------------
# T-M1: guard 5's markers by term
# ---------------------------------------------------------------------------


def test_m1_vegetarian_cheese_toastie_hits_vegan_and_dairy_free() -> None:
    assert names_forbidden_food(VEGAN, "vegetarian cheese toastie")
    assert names_forbidden_food(DAIRY_FREE, "vegetarian cheese toastie")


@pytest.mark.parametrize("text", ["meatless egg bake", "veggie honey glaze"])
def test_m1_meatless_and_veggie_do_not_cover_egg_or_honey(text: str) -> None:
    assert names_forbidden_food(VEGAN, text)


@pytest.mark.parametrize(
    "text", ["vegan cheese", "plant-based butter", "tofu egg scramble", "dairy-free yogurt"]
)
def test_m1_dairy_and_egg_markers(text: str) -> None:
    assert not names_forbidden_food(VEGAN, text)


def test_m1_vegetarian_sausage_is_not_a_forbidden_food_for_vegetarian() -> None:
    assert not names_forbidden_food(VEG, "vegetarian sausage")


def test_m1_nuts_ignore_the_plant_markers() -> None:
    assert names_forbidden_food(NUT_FREE, "vegan almond cake")


# ---------------------------------------------------------------------------
# T-D1: dedupe through norm_label
# ---------------------------------------------------------------------------


def test_d1_combine_dedupes_spellings() -> None:
    assert _combine_dietary_preferences(["Dairy Free"], ["dairy-free"], {}, "pasta") == [
        "Dairy Free"
    ]


def test_d1_drop_redundant_dedupes_spellings() -> None:
    assert _drop_redundant_dietary(["Vegan", "Dairy Free"]) == ["Vegan"]


# ---------------------------------------------------------------------------
# T-G1: the plant_markers flag
# ---------------------------------------------------------------------------


def test_g1_plant_markers_flag() -> None:
    assert names_forbidden_food(VEG, "tempeh bacon", plant_markers=False)
    assert not names_forbidden_food(VEG, "tempeh bacon")
    # Guard 2 is always on.
    assert not names_forbidden_food(VEGAN, "butter beans", plant_markers=False)
    assert not names_forbidden_food(VEGAN, "butter beans")


# ---------------------------------------------------------------------------
# T-ID1 / T-ID2: refine identity
# ---------------------------------------------------------------------------

# Copied verbatim from main's refine_diet.py:36-41.
_MAIN_PLANT_COMPOUND = (
    r"\b(?:coconut|oat|almond|soy|cashew|rice|hemp|pea|plant[- ]based|vegan|dairy[- ]free"
    r"|non[- ]dairy)\s+(?:milk|cream|butter|cheese|yogurt|yoghurt|mayo|mayonnaise)\b"
)
_MAIN_PLANT_MARKER = (
    r"\b(?:vegan|veggie|vegetarian|plant[- ]based|meatless|mock|faux|tofu|tempeh|seitan)\s+\w+"
)


def test_id1_refine_patterns_are_byte_identical_to_main() -> None:
    assert refine_diet._PLANT_COMPOUND.pattern == _MAIN_PLANT_COMPOUND
    assert refine_diet._PLANT_MARKER.pattern == _MAIN_PLANT_MARKER


def test_id2_added_text_keeps_the_clause_join() -> None:
    assert "chicken" in added_text("add tofu, chicken too")
    assert added_text("add tofu, chicken too") == " ".join(added_clauses("add tofu, chicken too"))


def test_the_plant_word_lists_moved_verbatim() -> None:
    assert diet_terms.PLANT_MARKER_WORDS == (
        "vegan", "veggie", "vegetarian", "plant[- ]based", "meatless", "mock", "faux",
        "tofu", "tempeh", "seitan",
    )
    assert diet_terms.PLANT_COMPOUND_NOUNS == (
        "milk", "cream", "butter", "cheese", "yogurt", "yoghurt", "mayo", "mayonnaise",
    )
    assert diet_terms.PLANT_COMPOUND_BASES == (
        "coconut", "oat", "almond", "soy", "cashew", "rice", "hemp", "pea",
        "plant[- ]based", "vegan", "dairy[- ]free", "non[- ]dairy",
    )


# ---------------------------------------------------------------------------
# T-Q1 / T-L1
# ---------------------------------------------------------------------------


def test_q1_curly_apostrophes() -> None:
    assert not names_forbidden_food(VEG, "lamb’s lettuce")
    assert names_forbidden_food(VEG, "add the lamb’s shoulder")


@pytest.mark.parametrize("label", ["Dairy Free", "dairy_free", "DAIRY-FREE"])
def test_l1_labels_reach_dairy_free(label: str) -> None:
    assert names_forbidden_food(label, "buttermilk pancakes")


def test_norm_label() -> None:
    assert norm_label("  Dairy Free ") == "dairy-free"
    assert norm_label("dairy_free") == "dairy-free"


# ---------------------------------------------------------------------------
# S9: constraints_to_persist
# ---------------------------------------------------------------------------


def _persist(**state: Any) -> dict[str, Any] | None:
    return constraints_to_persist(state)  # type: ignore[arg-type]


def test_s9_without_stored_dietary_the_constraints_are_unchanged() -> None:
    constraints = {"dietary": ["Vegetarian"], "cuisine": "thai"}

    assert _persist(recipe_constraints=constraints) == constraints
    assert _persist() is None


def test_s9_a_covered_label_is_not_duplicated() -> None:
    out = _persist(
        recipe_constraints={"dietary": ["Vegetarian"]},
        stored_dietary=[],
        fresh_dietary=[],
        session_dietary=["Vegetarian"],
    )

    assert out == {"dietary": ["Vegetarian"]}


def test_s9_a_held_vegetarian_is_persisted_even_when_the_final_vegan_covers_it() -> None:
    out = _persist(
        recipe_constraints={"dietary": ["Vegan"]},
        session_dietary=["Vegetarian"],
        stored_dietary=[],
        fresh_dietary=[],
    )

    assert out is not None
    assert out["dietary"] == ["Vegetarian", "Vegan"]


def test_s9_a_stored_origin_label_is_dropped_unless_fresh_or_in_the_session() -> None:
    base: dict[str, Any] = {"recipe_constraints": {"dietary": ["Vegetarian"]}}

    dropped = _persist(**base, stored_dietary=["Vegetarian"], fresh_dietary=[], session_dietary=[])
    fresh = _persist(
        **base, stored_dietary=["Vegetarian"], fresh_dietary=["Vegetarian"], session_dietary=[]
    )
    held = _persist(
        **base, stored_dietary=["Vegetarian"], fresh_dietary=[], session_dietary=["Vegetarian"]
    )

    assert dropped == {"dietary": []}
    assert fresh == {"dietary": ["Vegetarian"]}
    assert held == {"dietary": ["Vegetarian"]}


def test_s9_back_returns_a_stored_origin_session_label_the_final_diet_does_not_cover() -> None:
    out = _persist(
        recipe_constraints={"dietary": []},
        stored_dietary=["Vegetarian"],
        fresh_dietary=[],
        session_dietary=["Vegetarian"],
    )

    assert out == {"dietary": ["Vegetarian"]}


def test_s9_the_dietary_key_is_always_present_even_when_empty() -> None:
    out = _persist(
        recipe_constraints={}, stored_dietary=["Vegetarian"], fresh_dietary=[], session_dietary=[]
    )

    assert out == {"dietary": []}


def test_s9_other_constraint_fields_pass_through() -> None:
    out = _persist(
        recipe_constraints={"cuisine": "thai", "dietary": ["Gluten-free"]},
        stored_dietary=[],
        fresh_dietary=["Gluten-free"],
        session_dietary=[],
    )

    assert out == {"cuisine": "thai", "dietary": ["Gluten-free"]}


# ---------------------------------------------------------------------------
# S10b: _message_sets_label_aside
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "label"),
    [
        ("make it non-vegan", "Vegan"),
        ("non vegetarian pasta", "Vegetarian"),
        ("I’d like it non-vegan", "Vegan"),
    ],
)
def test_s10b_a_non_label_modifier_sets_the_label_aside(text: str, label: str) -> None:
    assert _message_sets_label_aside(label, text)


@pytest.mark.parametrize(
    ("text", "label"),
    [
        ("that's not vegetarian!", "Vegetarian"),
        ("is this not vegan?", "Vegan"),
        ("is honey not vegan?", "Vegan"),
        ("not vegetarian-friendly enough", "Vegetarian"),
        ("I'm not a vegetarian but my partner is", "Vegetarian"),
        ("not vegan tonight", "Vegan"),
        ("no longer vegan? ok", "Vegan"),
        ("I'm not vegetarian any more", "Vegetarian"),
        ("a vegan dinner my non-vegan family will enjoy", "Vegan"),
        ("vegetarian chili for my non-vegetarian friends", "Vegetarian"),
        ("pasta", "Vegan"),
    ],
)
def test_s10b_everything_else_does_nothing(text: str, label: str) -> None:
    assert not _message_sets_label_aside(label, text)


@pytest.mark.parametrize("label", ["", "-"])
def test_s10b_a_label_with_no_words_is_never_set_aside(label: str) -> None:
    assert not _message_sets_label_aside(label, "make it non-")


def test_s10b_a_label_with_regex_characters_does_not_raise() -> None:
    assert _message_sets_label_aside("Low carb (keto)", "non-low carb (keto) please")
    assert not _message_sets_label_aside("Low carb (keto)", "pasta")
