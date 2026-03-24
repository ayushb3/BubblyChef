#!/usr/bin/env python3
"""
Build pantry_catalog.json from USDA Foundation Foods + emojilib.

Run from project root:
    python3 scripts/build_catalog.py

Output: bubbly_chef/domain/pantry_catalog.json
"""

import json
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("httpx not installed. Run: pip install httpx")
    sys.exit(1)

EMOJILIB_URL = (
    "https://raw.githubusercontent.com/muan/emojilib/main/dist/emoji-en-US.json"
)

USDA_JSON = Path("bubbly_chef/data/FoodData_Central_foundation_food_json_2025-12-18.json")
OUTPUT_JSON = Path("bubbly_chef/domain/pantry_catalog.json")

USDA_TO_BUBBLY: dict[str, str] = {
    "Vegetables and Vegetable Products": "produce",
    "Fruits and Fruit Juices": "produce",
    "Dairy and Egg Products": "dairy",
    "Beef Products": "meat",
    "Pork Products": "meat",
    "Poultry Products": "meat",
    "Lamb, Veal, and Game Products": "meat",
    "Sausages and Luncheon Meats": "meat",
    "Finfish and Shellfish Products": "seafood",
    "Cereal Grains and Pasta": "dry_goods",
    "Legumes and Legume Products": "dry_goods",
    "Nut and Seed Products": "snacks",
    "Baked Products": "bakery",
    "Beverages": "beverages",
    "Fats and Oils": "condiments",
    "Soups, Sauces, and Gravies": "condiments",
    "Spices and Herbs": "condiments",
    "Sweets": "snacks",
    "Restaurant Foods": "other",
}

CATEGORY_EMOJI_DEFAULTS: dict[str, str] = {
    "produce": "🥦",
    "dairy": "🧀",
    "meat": "🥩",
    "seafood": "🐟",
    "frozen": "🧊",
    "dry_goods": "🌾",
    "canned": "🥫",
    "beverages": "🥤",
    "condiments": "🫙",
    "bakery": "🍞",
    "snacks": "🍿",
    "other": "🛒",
}


def fetch_emojilib() -> dict[str, list[str]]:
    """Fetch emojilib and return {emoji_char: [keyword, ...]}."""
    print("Fetching emojilib from GitHub...")
    try:
        response = httpx.get(EMOJILIB_URL, timeout=30, follow_redirects=True)
        response.raise_for_status()
        data: dict[str, list[str]] = response.json()
        print(f"  Loaded {len(data)} emojis")
        return data
    except httpx.HTTPError as e:
        print(f"  WARNING: Could not fetch emojilib: {e}")
        return {}


def build_reverse_emoji_index(emojilib: dict[str, list[str]]) -> dict[str, str]:
    """Build keyword → first-matching-emoji reverse index."""
    reverse: dict[str, str] = {}
    for emoji_char, keywords in emojilib.items():
        for kw in keywords:
            kw_lower = kw.lower().replace("_", " ")
            if kw_lower not in reverse:
                reverse[kw_lower] = emoji_char
    return reverse


def usda_to_canonical(description: str) -> str:
    """
    Convert USDA description to canonical name.

    For items with a meaningful second segment (not just cooking state),
    uses "modifier base" form to keep entries distinct.
    e.g. "Flour, whole grain, wheat" → "whole grain flour"
         "Tomatoes, raw" → "tomatoes"
         "Beef, ground, 80% lean" → "ground beef"
    """
    parts = [p.strip().lower() for p in description.split(",")]
    base = parts[0]

    # Skip-words that don't add useful distinctiveness
    skip_modifiers = {
        "raw", "cooked", "boiled", "fresh", "dried", "canned", "frozen",
        "commercial", "ns as to type", "unenriched", "enriched", "uncooked",
        "ready-to-eat", "plain", "unsalted", "salted",
    }

    if len(parts) >= 2:
        mod = parts[1].strip().lower()
        if mod and mod not in skip_modifiers and len(mod) > 1:
            # Use "modifier base" as canonical (more descriptive)
            return f"{mod} {base}"

    return base


def usda_to_synonyms(description: str, canonical: str) -> list[str]:
    """Extract synonym list from USDA description."""
    parts = [p.strip().lower() for p in description.split(",")]
    base = parts[0]
    synonyms: list[str] = []

    # Full original description (lowercased)
    synonyms.append(description.lower())

    # Base name (e.g. "tomatoes" for "grape tomatoes")
    if base != canonical:
        synonyms.append(base)

    # Additional modifier combos
    for modifier in parts[1:]:
        mod = modifier.strip().lower()
        if mod and len(mod) > 1:
            # "modifier base" form
            combined = f"{mod} {base}"
            if combined not in synonyms and combined != canonical:
                synonyms.append(combined)
            # "base modifier" form
            full = f"{base} {mod}"
            if full not in synonyms and full != canonical:
                synonyms.append(full)

    # Add each word from the second segment as a standalone synonym
    # e.g. "Fish, Salmon, sockeye" → add "salmon" as synonym of "salmon fish"
    # But skip common/ambiguous single words that would cause false positives
    SKIP_STANDALONE = {
        "whole", "raw", "cooked", "fresh", "dried", "frozen", "canned",
        "plain", "salted", "unsalted", "organic", "natural", "commercial",
        "ground", "mixed", "type", "form", "all", "and", "or", "the",
        "with", "without", "low", "high", "fat", "free",
    }
    if len(parts) >= 2:
        for word in parts[1].strip().lower().split():
            if len(word) > 3 and word not in SKIP_STANDALONE and word not in synonyms and word != canonical:
                synonyms.append(word)

    # Remove duplicates while preserving order, skip canonical itself
    seen: set[str] = {canonical}
    unique: list[str] = []
    for s in synonyms:
        s = s.strip()
        if s and s not in seen:
            seen.add(s)
            unique.append(s)

    return unique


def find_emoji(
    canonical: str,
    synonyms: list[str],
    category: str,
    reverse_index: dict[str, str],
) -> str:
    """Find best emoji for a food item."""
    # Direct lookup on canonical
    if canonical in reverse_index:
        return reverse_index[canonical]

    # Try each word in canonical
    for word in canonical.split():
        if word in reverse_index:
            return reverse_index[word]

    # Try synonyms (first synonym that matches)
    for syn in synonyms[:3]:  # only check first 3 to keep it fast
        syn_lower = syn.lower()
        if syn_lower in reverse_index:
            return reverse_index[syn_lower]
        for word in syn_lower.split():
            if word in reverse_index:
                return reverse_index[word]

    # Category fallback
    return CATEGORY_EMOJI_DEFAULTS.get(category, "🛒")


def build_catalog() -> list[dict[str, object]]:
    """Build the full catalog from USDA data + emojilib."""
    # Load USDA data
    if not USDA_JSON.exists():
        print(f"ERROR: USDA data file not found at {USDA_JSON}")
        sys.exit(1)

    print(f"Loading USDA data from {USDA_JSON}...")
    raw = json.loads(USDA_JSON.read_text())
    foods = raw["FoundationFoods"]
    print(f"  Loaded {len(foods)} USDA items")

    # Fetch emojilib
    emojilib = fetch_emojilib()
    reverse_emoji = build_reverse_emoji_index(emojilib)
    print(f"  Built reverse emoji index: {len(reverse_emoji)} keywords")

    # Deduplicate by canonical name (keep first occurrence)
    seen_canonicals: set[str] = set()
    catalog: list[dict[str, object]] = []

    skipped_category = 0
    for food in foods:
        description: str = food.get("description", "")
        fdc_id: int = food.get("fdcId", 0)
        usda_category: str = food.get("foodCategory", {}).get("description", "")

        bubbly_category = USDA_TO_BUBBLY.get(usda_category)
        if not bubbly_category:
            skipped_category += 1
            continue

        canonical = usda_to_canonical(description)
        if not canonical:
            continue

        # Skip if we already have this canonical name
        if canonical in seen_canonicals:
            continue
        seen_canonicals.add(canonical)

        synonyms = usda_to_synonyms(description, canonical)
        emoji = find_emoji(canonical, synonyms, bubbly_category, reverse_emoji)

        catalog.append(
            {
                "canonical": canonical,
                "synonyms": synonyms,
                "category": bubbly_category,
                "emoji": emoji,
                "fdc_id": fdc_id,
            }
        )

    print(f"  Skipped {skipped_category} items (unmapped USDA category)")
    print(f"  Built {len(catalog)} unique catalog entries")
    return catalog


def main() -> None:
    catalog = build_catalog()

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(catalog, ensure_ascii=False, indent=2))
    print(f"\nWrote {len(catalog)} entries to {OUTPUT_JSON}")

    # Quick sanity check
    sample = catalog[0]
    print(f"Sample entry: {json.dumps(sample, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
