# QA Report: Data Quality Issues

**Date:** 2026-03-18
**Tester:** Automated API analysis
**Severity:** MEDIUM

---

## Overview

The pantry database has 33 items with significant data quality problems. Many items appear to come from receipt scanning where the AI categorization failed or produced duplicates.

---

## 1. Duplicate Items (No Deduplication)

Multiple entries for the same product with different categories, units, or locations:

| Name | Duplicates | Categories | Locations |
|------|-----------|------------|-----------|
| Bananas | 4 entries | produce, other (×3) | counter, pantry (×3) |
| Milk/milk | 4 entries | dairy (×4) | fridge (×2), pantry (×2) |
| Whole Milk | 2 entries | other (×2) | pantry (×2) |
| Gala Apples | 2 entries | other (×2) | pantry (×2) |
| Ice Cream | 2 entries | frozen, other | freezer (×2) |
| Eggs | 3 entries | dairy, other (×2) | fridge, pantry (×2) |

**Root Cause:** No dedup logic when adding items. Receipt scanning and manual adds create separate entries for the same product. Case sensitivity also matters (`Milk` vs `milk`).

**Impact:** Item count inflated (33 shown vs ~20 unique). User sees confusing duplicates.

**Recommendation:**
1. Merge/consolidate existing duplicates
2. Add dedup-on-add: when adding "Bananas", check if "bananas" already exists and offer to update quantity instead
3. Normalize case on insert (title case or lowercase)

---

## 2. Massive "category=other" Problem

**16 of 33 items** (48%) are categorized as "other" — nearly half the pantry.

Items miscategorized as "other" that should be obvious:
- **Bananas** → should be produce
- **Cheddar Cheese** → should be dairy
- **Chicken Breasts** → should be meat
- **Gala Apples** → should be produce
- **Organic Carrots** → should be produce
- **Spaghetti Pasta** → should be dry_goods
- **Whole Milk** → should be dairy
- **chocolate ice cream** → should be frozen
- **ice cream** → should be frozen
- **lemonade** → should be beverages
- **tomatoes** → should be produce

**Root Cause:** Items added via receipt scanning (with capitalized units like "Bunch", "Pound", "Gallon", "Dozen") bypass the domain normalizer. The receipt parsing AI returns category "other" and the backend doesn't re-categorize.

**Impact:** Category emoji wrong (📦 box instead of 🥬/🥛/🍖), filter by category would be useless, expiry estimates wrong (falls back to 30 days generic).

**Recommendation:**
1. Run the catalog categorizer on all scanned items before persisting
2. Add a one-time migration to re-categorize existing "other" items
3. Ensure `normalizer.py` / `catalog.py` is called in the scan→confirm pipeline

---

## 3. Missing Expiry Dates

**11 of 33 items** have no expiry date — all are category "other" items from receipt scanning.

Items without expiry:
- Bananas (×2), Cheddar Cheese, Chicken Breasts, Gala Apples (×2), Organic Carrots, Spaghetti Pasta, Whole Milk (×2), test milk

**Root Cause:** `estimate_expiry_days` in `expiry.py` depends on correct category. When category is "other", the expiry estimation probably returns None or a generic fallback.

**Impact:** Dashboard "Use Soon!" section misses these items. No expiry warnings for perishable foods like chicken breasts or cheese.

---

## 4. Wrong Emoji for Produce Items

**Apples** displays 🥬 (leafy green) instead of 🍎 (apple). All produce items show 🥬 regardless of the specific item.

**Root Cause:** The emoji mapping uses the generic category emoji (`🥬` for produce) instead of item-specific emoji from the catalog.

**Evidence:** From screenshot — Apples, Avocados, Bananas, Grapes all show 🥬.

**Recommendation:** Use `catalog.get_emoji(item_name)` for item-specific emojis, fall back to category emoji only when no match.

---

## 5. Inconsistent Capitalization

Items have mixed case: `Milk` vs `milk`, `Ice Cream` vs `ice cream`, `Bananas` vs `bananas`.

**Impact:** Looks messy in the UI. Complicates dedup. Search may behave inconsistently.

**Recommendation:** Title-case normalize all item names on insert.

---

## 6. Test Data in Production DB

Items like `test butter`, `test milk`, and the "AAAAAA..." long string item (visible in dashboard activity) are test data that shouldn't be in the DB.

**Impact:** Clutters the real user experience, makes counts inaccurate.

**Recommendation:** Clean up test data. Add a `/pantry/reset` dev-only endpoint or admin tools.
