"""Regression tests for #300 — the catalog emoji field was unreliable.

A full-catalog emoji regeneration (LLM-classified against a fixed allow-list,
mechanically validated, then merged by hand — see the PR for the process)
replaced 241 of 303 entries. These tests pin the structural guarantees that
process relied on, so a future edit to the catalog can't silently reintroduce
nonsense emoji (a monkey for banana peppers, a tiger for canned chickpeas,
butter for every cooking oil) without a test noticing.
"""

from __future__ import annotations

import json
from pathlib import Path

CATALOG_PATH = (
    Path(__file__).resolve().parents[1] / "bubbly_chef" / "domain" / "pantry_catalog.json"
)

# The exact allow-list every entry's emoji was chosen from. Not exhaustive of
# all food emoji that could ever be valid — it's the actual constraint the
# regeneration ran under, so this test also pins that no entry drifted
# outside it via an unrelated future edit.
ALLOWED_EMOJI = {
    "🍎", "🍏", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑",
    "🥭", "🍍", "🥥", "🥝", "🍅", "🫒",
    "🥑", "🍆", "🥔", "🥕", "🌽", "🌶️", "🫑", "🥒", "🥬", "🥦", "🧄", "🧅", "🥜",
    "🫘", "🍄", "🥗", "🫛",
    "🍞", "🥐", "🥖", "🫓", "🥨", "🥯", "🥞", "🧇", "🌾", "🍚", "🍙",
    "🥚", "🧀", "🥛", "🍦", "🍨",
    "🥩", "🍗", "🍖", "🥓", "🌭", "🍔", "🥪", "🍳", "🍤", "🦐", "🦀", "🦞", "🐟",
    "🐠", "🐔", "🦃", "🐷", "🐮", "🐑",
    "🍕", "🌮", "🌯", "🥙", "🥘", "🍲", "🍱", "🍜", "🍝", "🍛", "🍣", "🍿", "🧈",
    "🍯", "🧂", "🫙", "🥫",
    "🫗", "🥣",
    "🥤", "🧃", "🍷", "🍺", "☕", "🍵", "🧊", "🥂",
    "🌰",
    "🍽️",
}


def _load_catalog() -> list[dict]:
    return json.loads(CATALOG_PATH.read_text())


def test_every_emoji_is_from_the_curated_allow_list() -> None:
    catalog = _load_catalog()
    offenders = [(e["canonical"], e["emoji"]) for e in catalog if e["emoji"] not in ALLOWED_EMOJI]
    assert offenders == [], f"emoji outside the curated set: {offenders}"


def test_no_animal_emoji_on_a_non_animal_food() -> None:
    """The exact failure mode #300 reported: a monkey for banana peppers, a
    tiger for canned chickpeas, a dolphin for pollock fish (dolphin is an
    animal that is not the food itself). Live/whole-animal emoji are reserved
    for meat categories where they represent the source animal, not sprinkled
    across produce or dry goods.
    """
    catalog = _load_catalog()
    animal_emoji = {"🐅", "🐒", "🐬", "🙈", "🙉", "🙊", "😈", "🤱", "💃", "👏", "👩", "🎐", "🐴", "☺️"}
    offenders = [(e["canonical"], e["emoji"]) for e in catalog if e["emoji"] in animal_emoji]
    assert offenders == [], f"nonsense emoji reintroduced: {offenders}"


def test_beef_cuts_share_one_consistent_emoji() -> None:
    """All raw beef CUTS should read as the same food at a glance, regardless
    of which specific cut. Regression guard for the pre-#300 state where
    ribeye, chuck, and flank each carried an unrelated wrong emoji.

    Excludes "beef frankfurter": a hot dog is a processed sausage, not a raw
    cut, and correctly carries its own emoji rather than the raw-meat one.
    """
    catalog = _load_catalog()
    beef_cuts = [
        e
        for e in catalog
        if "beef" in e["canonical"].lower() and "frankfurter" not in e["canonical"].lower()
    ]
    assert beef_cuts, "expected at least one raw beef cut in the catalog"
    beef_emoji = {e["emoji"] for e in beef_cuts}
    assert beef_emoji == {"🥩"}, f"beef cuts disagree on emoji: {beef_emoji}"


def test_chicken_cuts_share_one_consistent_emoji() -> None:
    catalog = _load_catalog()
    chicken_emoji = {
        e["emoji"]
        for e in catalog
        if "chicken" in e["canonical"].lower() and "broth" not in e["canonical"].lower()
    }
    assert chicken_emoji == {"🍗"}, f"chicken cuts disagree on emoji: {chicken_emoji}"


def test_cooking_oils_are_not_all_butter() -> None:
    """The regeneration's own blanket "oils -> butter" instruction was too
    coarse: it put the same wrong, specific-substance emoji on all 8 oil
    entries. Fixed by hand post-generation. Pin it so it can't quietly
    regress back to one emoji for every oil.
    """
    catalog = _load_catalog()
    oil_emoji = {e["canonical"]: e["emoji"] for e in catalog if e["canonical"].endswith(" oil")}
    assert oil_emoji, "expected at least one '<x> oil' entry in the catalog"
    assert oil_emoji.get("olive oil") == "🫒"
    assert oil_emoji.get("coconut oil") == "🥥"
    assert oil_emoji.get("peanut oil") == "🥜"
    # Not every oil has a specific fruit/plant emoji available; those may
    # legitimately share a generic pour emoji. What must NOT happen is every
    # oil sharing butter's emoji, which implies they are all the same
    # substance.
    assert "🧈" not in oil_emoji.values(), "an oil entry still carries the butter emoji"
