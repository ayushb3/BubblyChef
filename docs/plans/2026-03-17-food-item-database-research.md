# Food/Grocery Item Database Research
**Date:** 2026-03-17
**Goal:** Find a static, bundleable catalog of ~500–1000 common grocery items with canonical name, synonyms, food category, and emoji — for use in BubblyChef's pantry normalization layer.

---

## Requirements Recap

| Requirement | Notes |
|---|---|
| Item count | ~500–1000 common grocery items |
| Fields needed | Canonical name, alt names/synonyms, food category, emoji |
| Bundleable? | Yes — static file shipped with the app, no runtime API calls |
| Nutritional data | Not needed |
| Brand-specific SKUs | Not needed |
| License | Open / permissive (MIT, CC0, ODbL) |
| Stack | Python 3.12 backend + React/TypeScript frontend |

---

## Candidates Evaluated

### 1. USDA FoodData Central — Foundation Foods subset

**URL:** https://fdc.nal.usda.gov/download-datasets/

**License:** CC0 1.0 Universal (public domain — no restrictions)

**Item count:**
- Foundation Foods: ~467 KB zipped / 6.5 MB unzipped — estimated ~500–1000 "foundation" ingredients (real, unbranded foods like "raw chicken breast", "whole milk")
- SR Legacy (2018): larger set of ~7,800 basic foods
- Full dataset with Branded Foods: 195 MB–3.1 GB (way more than needed)

**Data format:** CSV and JSON downloads, both available. JSON schema documented via SwaggerHub.

**Relevant fields:**
- `description` — canonical ingredient name (e.g., "Milk, whole")
- `foodCategory` — mapped to USDA food groups (Dairy and Egg Products, Vegetables, etc.)
- No emoji field (would need to add manually or via mapping)
- No synonyms/alt-names field (names follow a formal "commodity, modifier" convention)

**Bundleable?** Yes. Foundation Foods zipped is only 467 KB — trivially bundleable.

**Cost:** Free. API key from data.gov required for live API; static download requires no key.

**Verdict:** Best raw ingredient list. CC0 means zero legal friction. Foundation Foods subset (~500 items) is exactly the right scale. Lacks emoji and synonyms — those must be hand-curated or mapped. USDA category names (e.g., "Dairy and Egg Products") need remapping to BubblyChef's `FoodCategory` enum.

---

### 2. Open Food Facts

**URL:** https://world.openfoodfacts.org/data

**License:** Database structure: Open Database License (ODbL). Individual records: Database Contents License (DbCL). Images: CC-BY-SA. Attribution required; share-alike clause applies to derivative databases.

**Item count:** Millions of UPC-barcoded consumer products (full dump is ~9 GB uncompressed CSV).

**Data format:** MongoDB dump (JSONL), CSV (tab-separated), Parquet (via Hugging Face), nightly delta exports. Also a live JSON API.

**Relevant fields:** Product name, ingredients text, categories (folksonomy tags), images. No emoji. No synonym list. Category quality is inconsistent (user-contributed).

**Bundleable?** Technically yes, but the full dump (9 GB CSV, ~0.9 GB MongoDB) is far too large. A filtered subset could be extracted, but requires significant ETL work and the share-alike ODbL license means any derivative database must also be ODbL.

**Cost:** Free.

**Verdict:** Wrong scale for this use case. Designed for UPC product lookup, not common-ingredient normalization. ODbL share-alike is a concern. Not recommended unless barcode scanning is added in a future phase.

---

### 3. Spoonacular Food API

**URL:** https://spoonacular.com/food-api

**License:** Commercial SaaS — no data download or bundling rights.

**Item count:** 2,600+ ingredients, 600,000+ branded products, 5,000+ recipes, 115,000+ menu items.

**Data format:** REST API only.

**Relevant fields:** Ingredient names, food categories, substitutions, allergen flags, a "complex food ontology" that understands ingredient relationships. No emoji in public docs.

**Bundleable?** No. API-only service. Terms of service prohibit data scraping or offline caching beyond minimal use.

**Cost:** $10/month academic plan (5,000 req/day). Standard pricing not published on landing page; likely $29–$149/month for production tiers.

**Verdict:** Best-in-class ontology but requires live API calls and paid subscription. Ruled out — violates the bundleable static-file requirement.

---

### 4. Edamam Food Database API

**URL:** https://developer.edamam.com/food-database-api

**License:** Commercial SaaS with strict terms. Prohibits automated data collection. Caching limited to 4 macro nutrient fields + food ID + label. Attribution linking mandatory. Breach = immediate suspension.

**Item count:** ~900,000 foods (basic foods + restaurant + packaged).

**Data format:** REST API only.

**Relevant fields:** Food names, nutrient profiles, 70+ diet/allergy filters, categories. No emoji. No synonym list.

**Bundleable?** Explicitly prohibited by terms.

**Cost:** $14/month minimum (100,000 calls/month), 30-day trial. $299/month for premium.

**Verdict:** Ruled out. License prohibits static bundling. Paid tiers add cost with no benefit for this use case.

---

### 5. ingredient-parser-nlp (PyPI)

**URL:** https://pypi.org/project/ingredient-parser-nlp/

**License:** MIT

**What it is:** A trained NLP sequence-labeling model (v2.5.0) that parses free-text recipe ingredient sentences into structured fields: ingredient name, quantity, unit, prep instructions.

**Item count:** Not a static database — it's a parsing model trained on 81,000 examples.

**Relevant fields:** Extracts `name`, `amount`, `preparation`, `comment` from text. Not a lookup database.

**Bundleable?** Ships as a Python package with a bundled model file. ~MIT licensed.

**Cost:** Free.

**Verdict:** Solves a different problem (parsing "2 cups diced onion" → structured data), not item-to-category/emoji mapping. Worth keeping in mind for receipt parsing improvements, but not what's needed here.

---

## Ranked Recommendation

### Rank 1 (Recommended): USDA FoodData Central — Foundation Foods + hand-curated emoji/synonym layer

**Why:**
- CC0 public domain — zero legal friction, no attribution clause, no share-alike
- Foundation Foods subset is exactly the right scale (~500 "real" unbranded ingredients)
- Available as a 467 KB zipped JSON/CSV — trivially bundleable as a static file in the repo
- Clean, formal ingredient names suitable as canonical references
- USDA food groups map cleanly to BubblyChef's `FoodCategory` enum

**What you need to add on top:**
- Emoji mapping (hand-curated or via a small script matching Unicode food emoji to USDA descriptions)
- Synonym/alt-name list (e.g., "Milk, whole" → alt names: ["whole milk", "full-fat milk"])
- Category remapping from USDA food groups → BubblyChef `FoodCategory` enum values

**Implementation path:**
1. Download Foundation Foods JSON from FDC
2. Extract `description` + `foodCategory.description` fields
3. Write a one-time Python script to produce `pantry_catalog.json` with:
   - `canonical_name`
   - `synonyms: []`
   - `category: FoodCategory`
   - `emoji: str`
4. Commit `pantry_catalog.json` to `bubbly_chef/domain/` — no runtime API dependency

---

### Rank 2 (Supplement): Hand-curated emoji mapping from Unicode CLDR / GitHub repos

**Why:** USDA has no emoji. The Unicode CLDR project (https://github.com/unicode-org/cldr) contains official emoji short names and group assignments. There are also community repos (e.g., emoji-data, emojilib) that map ~1,500 emoji to keyword lists including food terms. These can be used to auto-match USDA ingredient names to emoji with a fuzzy string match script, covering ~70–80% of items automatically.

**License:** Unicode CLDR is Unicode License (permissive). `emojilib` is MIT.

---

### Rank 3 (Alternative if more coverage needed): SR Legacy dataset from USDA

**Why:** SR Legacy has ~7,800 items (vs ~500 for Foundation Foods), all still CC0. Useful if Foundation Foods proves too sparse. Downside: larger file size and more noise (highly specific entries like "Beef, chuck eye roast, boneless, separable lean and fat, trimmed to 0\" fat, choice, cooked, braised").

---

## What to Build

Given the above, the recommended approach for BubblyChef is:

```
bubbly_chef/domain/pantry_catalog.json   ← static bundled file, ~500-1000 items
bubbly_chef/domain/catalog.py            ← loader + lookup helpers
```

Each entry in `pantry_catalog.json`:
```json
{
  "canonical": "whole milk",
  "synonyms": ["milk", "full-fat milk", "homo milk"],
  "category": "DAIRY",
  "emoji": "🥛",
  "usda_fdc_id": 173410
}
```

The `catalog.py` module provides:
```python
def lookup(name: str) -> CatalogEntry | None
def categorize(name: str) -> FoodCategory | None
def get_emoji(name: str) -> str | None
```

Using fuzzy matching (e.g., `rapidfuzz`) against `canonical` + `synonyms` for normalized lookups.

This replaces the current ad-hoc emoji/category logic in `bubbly_chef/domain/normalizer.py` and `defaults.py` with a data-driven approach.

---

## Sources

- USDA FoodData Central: https://fdc.nal.usda.gov/
- Open Food Facts: https://world.openfoodfacts.org/data
- Spoonacular: https://spoonacular.com/food-api
- Edamam: https://developer.edamam.com/food-database-api
- ingredient-parser-nlp: https://pypi.org/project/ingredient-parser-nlp/
- Unicode CLDR (emoji): https://github.com/unicode-org/cldr
- emojilib: https://github.com/muan/emojilib
