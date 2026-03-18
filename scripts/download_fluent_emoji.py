#!/usr/bin/env python3
"""Download Microsoft Fluent Emoji 3D PNGs for food items in pantry_catalog.json.

Fluent Emoji folder naming convention:
  - First word title-cased, rest lowercase
  - e.g. "Red apple", "Glass of milk", "Leafy green"
  - URL: https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/{Folder}/3D/{slug}_3d.png

Usage:
    python3 scripts/download_fluent_emoji.py

Output:
    web/public/food-icons/fluent/{slug}.png  -- downloaded PNGs
    bubbly_chef/domain/icon_map.py           -- updated FOOD_ICON_MAP dict
"""

from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
CATALOG_PATH = PROJECT_ROOT / "bubbly_chef" / "domain" / "pantry_catalog.json"
OUTPUT_DIR = PROJECT_ROOT / "web" / "public" / "food-icons" / "fluent"
ICON_MAP_PATH = PROJECT_ROOT / "bubbly_chef" / "domain" / "icon_map.py"
FLUENT_BASE = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets"

# ── Overrides: Unicode CLDR name → Fluent Emoji folder name ──────────────────
# Some emojis have Fluent Emoji folder names that differ from Unicode CLDR names.
FOLDER_OVERRIDES: dict[str, str] = {
    "EAR OF RICE": "Sheaf of rice",         # 🌾 Unicode says "ear", Fluent says "sheaf"
    "COOKING": "Pot of food",               # 🍳 remap if needed
    "BEVERAGE BOX": "Juice box",            # 🧃 multi-codepoint fallback
    "JAR": "Jar",                            # 🫙 already single word
}

# ── Category fallback slugs (must exist in OUTPUT_DIR) ───────────────────────
CATEGORY_ICONS: dict[str, str] = {
    "produce": ("Leafy green", "leafy_green"),
    "dairy": ("Glass of milk", "glass_of_milk"),
    "meat": ("Cut of meat", "cut_of_meat"),
    "seafood": ("Fish", "fish"),
    "frozen": ("Snowflake", "snowflake"),
    "canned": ("Canned food", "canned_food"),
    "dry_goods": ("Sheaf of rice", "sheaf_of_rice"),
    "condiments": ("Jar", "jar"),
    "beverages": ("Beverage box", "beverage_box"),
    "snacks": ("Popcorn", "popcorn"),
    "bakery": ("Bread", "bread"),
    "other": ("Package", "package"),
}


# ── Slug helpers ──────────────────────────────────────────────────────────────

def emoji_to_fluent_folder(emoji: str) -> str | None:
    """Return Fluent Emoji folder name for a (possibly multi-codepoint) emoji.

    Fluent convention: first word Title-cased, rest lowercase.
    Falls back to override dict for known mismatches.
    """
    # Use first significant codepoint (skip variation selectors U+FE0F etc.)
    significant = [c for c in emoji if ord(c) not in (0xFE0F, 0x200D)]
    if not significant:
        return None

    first = significant[0]
    try:
        cldr = unicodedata.name(first)
    except ValueError:
        return None

    # Check override dict first
    if cldr in FOLDER_OVERRIDES:
        return FOLDER_OVERRIDES[cldr]

    # Standard: first letter uppercase, rest lowercase
    return cldr[0].upper() + cldr[1:].lower()


def folder_to_slug(folder: str) -> str:
    """Convert 'Leafy green' → 'leafy_green'."""
    slug = re.sub(r"[^a-z0-9]", "_", folder.lower())
    return re.sub(r"_+", "_", slug).strip("_")


def fluent_url(folder: str, slug: str) -> str:
    encoded = urllib.parse.quote(folder)
    return f"{FLUENT_BASE}/{encoded}/3D/{slug}_3d.png"


# ── Download helpers ──────────────────────────────────────────────────────────


def download_png(url: str, dest: Path, retries: int = 2) -> bool:
    """Download PNG from url to dest. Returns True on success."""
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "BubblyChef/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                dest.write_bytes(resp.read())
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False  # not found, no point retrying
            log.warning("HTTP %d for %s (attempt %d)", e.code, url, attempt + 1)
        except Exception as e:
            log.warning("Error downloading %s: %s (attempt %d)", url, e, attempt + 1)
        if attempt < retries:
            time.sleep(0.5)
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    catalog: list[dict] = json.loads(CATALOG_PATH.read_text())
    log.info("Loaded %d catalog entries", len(catalog))

    # Build unique emoji → (canonical_name, folder, slug) mapping
    # Prefer the first canonical name that maps to this emoji
    emoji_to_info: dict[str, tuple[str, str, str]] = {}
    for item in catalog:
        emoji = item["emoji"]
        canonical = item["canonical"]
        if emoji in emoji_to_info:
            continue  # already have a mapping for this emoji
        folder = emoji_to_fluent_folder(emoji)
        if folder is None:
            log.warning("Cannot resolve folder for emoji %r (%s)", emoji, canonical)
            continue
        slug = folder_to_slug(folder)
        emoji_to_info[emoji] = (canonical, folder, slug)

    # Also ensure all category fallback slugs are in our download list
    extra_downloads: list[tuple[str, str]] = []
    for cat, (folder, slug) in CATEGORY_ICONS.items():
        dest = OUTPUT_DIR / f"{slug}.png"
        if not dest.exists():
            extra_downloads.append((folder, slug))

    # Download phase
    successful: dict[str, str] = {}   # canonical_name → slug
    failed: list[str] = []

    log.info("Downloading %d unique food emojis + %d category fallbacks",
             len(emoji_to_info), len(extra_downloads))

    # Download unique food emojis
    for emoji, (canonical, folder, slug) in emoji_to_info.items():
        dest = OUTPUT_DIR / f"{slug}.png"
        if dest.exists():
            log.debug("Cached: %s → %s", canonical, slug)
            successful[canonical] = slug
            continue

        url = fluent_url(folder, slug)
        log.info("  %s  %s → %s", emoji, canonical, slug)
        if download_png(url, dest):
            successful[canonical] = slug
            time.sleep(0.1)  # be polite to GitHub CDN
        else:
            log.warning("SKIP: %s (%s) — not found at %s", canonical, emoji, url)
            failed.append(canonical)

    # Now map ALL catalog entries to their slug (via emoji lookup)
    # Multiple canonicals may share the same emoji
    canonical_to_slug: dict[str, str] = {}
    for item in catalog:
        emoji = item["emoji"]
        canonical = item["canonical"]
        if emoji in emoji_to_info:
            _, _, slug = emoji_to_info[emoji]
            if canonical not in successful:
                # Still counts as successful if emoji was downloaded
                dest = OUTPUT_DIR / f"{slug}.png"
                if dest.exists():
                    canonical_to_slug[canonical] = slug
        elif canonical in successful:
            canonical_to_slug[canonical] = successful[canonical]

    # Add directly successful ones
    for canonical, slug in successful.items():
        canonical_to_slug[canonical] = slug

    # Download category fallbacks
    for folder, slug in extra_downloads:
        dest = OUTPUT_DIR / f"{slug}.png"
        url = fluent_url(folder, slug)
        log.info("  [category] %s → %s", folder, slug)
        if download_png(url, dest):
            log.info("  OK: %s", slug)
        else:
            log.warning("  SKIP: category fallback %s not found", slug)
        time.sleep(0.1)

    # Summary
    png_count = len(list(OUTPUT_DIR.glob("*.png")))
    log.info("\n=== Download Summary ===")
    log.info("PNGs downloaded: %d", png_count)
    log.info("Mapped entries:  %d / %d", len(canonical_to_slug), len(catalog))
    log.info("Failed emojis:   %d", len(failed))
    if failed:
        log.info("  %s", ", ".join(failed[:20]))

    # Write icon_map.py
    write_icon_map(canonical_to_slug)
    log.info("Wrote bubbly_chef/domain/icon_map.py")


def write_icon_map(canonical_to_slug: dict[str, str]) -> None:
    """Write FOOD_ICON_MAP, CATEGORY_ICON_MAP, CATEGORY_EMOJI_MAP to icon_map.py."""
    lines = [
        '"""Static mapping of canonical food names → Fluent Emoji slug.',
        "",
        "Generated by scripts/download_fluent_emoji.py.",
        "Slug matches filename in web/public/food-icons/fluent/{slug}.png.",
        "To regenerate: python3 scripts/download_fluent_emoji.py",
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "# Generated from pantry_catalog.json",
        "# Format: canonical_name → fluent_slug (matches filename without .png)",
        "FOOD_ICON_MAP: dict[str, str] = {",
    ]
    for canonical, slug in sorted(canonical_to_slug.items()):
        lines.append(f'    "{canonical}": "{slug}",')
    lines.append("}")
    lines.append("")

    # Category icon map
    lines.append("# Category fallback slugs — one per category")
    lines.append("CATEGORY_ICON_MAP: dict[str, str] = {")
    for cat, (_, slug) in CATEGORY_ICONS.items():
        lines.append(f'    "{cat}": "{slug}",')
    lines.append("}")
    lines.append("")

    # Category emoji map
    category_emojis = {
        "produce": "🥬",
        "dairy": "🥛",
        "meat": "🥩",
        "seafood": "🐟",
        "frozen": "❄️",
        "canned": "🥫",
        "dry_goods": "🌾",
        "condiments": "🫙",
        "beverages": "🧃",
        "snacks": "🍿",
        "bakery": "🍞",
        "other": "📦",
    }
    lines.append("# Category emoji text fallback (used when PNG unavailable)")
    lines.append("CATEGORY_EMOJI_MAP: dict[str, str] = {")
    for cat, emoji in category_emojis.items():
        lines.append(f'    "{cat}": "{emoji}",')
    lines.append("}")
    lines.append("")

    ICON_MAP_PATH.write_text("\n".join(lines))


if __name__ == "__main__":
    main()
