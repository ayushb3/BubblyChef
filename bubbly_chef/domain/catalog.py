"""Pantry catalog lookup backed by USDA Foundation Foods + emojilib."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from rapidfuzz import fuzz, process


@dataclass(frozen=True)
class CatalogEntry:
    canonical: str
    synonyms: tuple[str, ...]
    category: str
    emoji: str
    fdc_id: int | None


@lru_cache(maxsize=1)
def _load_catalog() -> list[CatalogEntry]:
    """Load pantry_catalog.json once and cache it."""
    path = Path(__file__).parent / "pantry_catalog.json"
    raw: list[dict[str, object]] = json.loads(path.read_text())
    entries: list[CatalogEntry] = []
    for item in raw:
        syns_raw = item.get("synonyms", [])
        syns: tuple[str, ...] = (
            tuple(str(s) for s in syns_raw) if isinstance(syns_raw, list) else ()
        )
        fdc_raw = item.get("fdc_id")
        fdc_id: int | None = int(fdc_raw) if isinstance(fdc_raw, (int, float)) else None
        entries.append(
            CatalogEntry(
                canonical=str(item["canonical"]),
                synonyms=syns,
                category=str(item["category"]),
                emoji=str(item["emoji"]),
                fdc_id=fdc_id,
            )
        )
    return entries


@lru_cache(maxsize=1)
def _build_lookup_index() -> dict[str, CatalogEntry]:
    """Build canonical+synonym → entry index for O(1) exact lookup."""
    index: dict[str, CatalogEntry] = {}
    for entry in _load_catalog():
        index[entry.canonical] = entry
        for syn in entry.synonyms:
            if syn not in index:
                index[syn] = entry
    return index


def lookup(name: str, threshold: int = 80) -> CatalogEntry | None:
    """
    Look up a food item by name with fuzzy matching.

    1. Exact match in canonical/synonym index
    2. rapidfuzz WRatio fuzzy match (score >= threshold)

    Returns None if no match above threshold.
    """
    name_lower = name.lower().strip()
    if not name_lower:
        return None

    index = _build_lookup_index()

    # Exact match
    if name_lower in index:
        return index[name_lower]

    # Fuzzy match against all keys
    result = process.extractOne(
        name_lower,
        index.keys(),
        scorer=fuzz.WRatio,
        score_cutoff=threshold,
    )
    if result:
        matched_key: str = result[0]
        return index[matched_key]
    return None


def categorize(name: str) -> str | None:
    """Return FoodCategory string for a food name, or None if not in catalog.

    Uses threshold=95 to reduce false positives. Returns None when not
    confident, allowing callers to fall back to keyword matching.
    """
    entry = lookup(name, threshold=95)
    return entry.category if entry else None


def get_emoji(name: str) -> str | None:
    """Return emoji for a food name, or None if not in catalog."""
    entry = lookup(name)
    return entry.emoji if entry else None
