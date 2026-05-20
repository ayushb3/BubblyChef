# Recipe Import Pipeline — Retro

## Summary

Investigation into the recipe URL import pipeline covering scraper behavior, image handling, duplicate detection, and site compatibility. AllRecipes and Serious Eats block bot scrapers entirely — Gemini handles extraction for those sites. BBC Good Food, NYT Cooking, and Food Network work via recipe-scrapers and return real images. Proxy-based image storage was attempted but blocked by CDN hotlink protection.

---

## Scraper Tier Behavior

Three-tier extraction strategy in `ai-service/bubbly_chef/services/recipe_url_ingestor.py`:

| Tier | Method | Notes |
|---|---|---|
| 1 | `scrape_me` (recipe-scrapers strict) | Internal fetch — blocked by AllRecipes/Serious Eats |
| 2 | `scrape_html` (supported_only=False) | Needs HTML from our httpx_get — also blocked if tier 1 is |
| 3 | Gemini AI via AIManager | Always works, ~12-15s, no image for blocked sites |

**Site compatibility:**

| Site | Tier Used | Image Available |
|---|---|---|
| AllRecipes `/recipe/<id>/` | Gemini (403) | ❌ |
| Serious Eats | Gemini (403) | ❌ |
| BBC Good Food | recipe-scrapers strict | ✅ |
| NYT Cooking | recipe-scrapers strict | ✅ |
| Food Network | recipe-scrapers strict | ✅ |

---

## Image Handling

**Root cause of missing images:** AllRecipes and Serious Eats return 403 on both `scrape_me` and `httpx_get`. Gemini (no-fetch path) hallucinates plausible-but-invalid CDN URLs — these return 400 when the browser tries to load them.

**Fixes applied:**
- `_AI_NO_FETCH_PROMPT` explicitly instructs Gemini to omit `image_url`
- AI no-fetch result path forcibly nulls `image_url` and `thumbnail_url` regardless of what Gemini returns
- `RecipeBook.tsx` uses `thumbError` state — on `onError`, falls back to plain title header instead of showing broken image
- `thumbError` resets on `selectedId` change so navigating to a recipe with a real image works correctly

**Server-side proxy attempt:** Added `proxyThumbnail()` in `POST /api/recipes` — fetches external image, uploads to Supabase Storage `recipe-images` bucket, stores public URL. AllRecipes CDN returns `400 text/html` even with Chrome UA — hotlink protection is token/referer-based, not UA-based. Proxy silently falls back to original URL on failure, never blocks save.

**Conclusion:** For AllRecipes and Serious Eats, no image is the correct behavior. The plain header fallback is good UX.

---

## Duplicate Detection

Added `source_url` uniqueness check in `POST /api/recipes` before insert:
- Returns `409 { error: 'duplicate', existing_id, existing_title }`
- `handleImportSave` in `RecipeBook.tsx` handles 409: closes modal, navigates to existing recipe, shows toast `"<title> is already in your book."` (auto-dismisses 5s)
- No DB schema change needed — query is a simple `.eq('source_url', ...)` filter

---

## Debug Logging Added

- `recipe_url_ingestor.py`: `[scraper]` log after Tier 1/2 success showing title + image
- `recipe_url_ingestor.py`: `[ai]` log after Gemini extraction showing image_url + thumbnail_url
- `ingest.py` route: success log now includes `thumbnail_url`
- `api/recipes/route.ts`: `[import]` log shows title + both URL fields from AI service
- `api/recipes/route.ts`: `[proxy]` logs show fetch status, content-type, buffer size, upload result
- Both servers log to `/private/tmp/ai-service.log` and `/private/tmp/nextjs-dev.log`

---

## Other Changes

**Import modal UX:** Plain site name text replaced with clickable pill chips (AllRecipes, Serious Eats, BBC Good Food, NYT Cooking, Food Network) opening in new tabs. Instruction copy updated to "Browse a site, copy the recipe URL, and paste it below."

**Thumbnail hero layout:** `RecipeBook.tsx` shows 180px full-bleed hero with gradient title overlay when `thumbnail_url` is present and loads. Falls back to plain header on load failure.

**Thumbnail preservation in import modal:** `RecipeImportModal.tsx` extracts `image_url` from raw AI response as `thumbnail_url` fallback before `Partial<Recipe>` cast drops it.

---

## References

- `ai-service/bubbly_chef/services/recipe_url_ingestor.py`
- `nextjs/src/app/api/recipes/route.ts`
- `nextjs/src/app/api/recipes/import/route.ts`
- `nextjs/src/components/recipes/RecipeImportModal.tsx`
- `nextjs/src/components/recipes/RecipeBook.tsx`
