# URL import uses recipe-scrapers for known sites, LLM fallback for unknowns

For URL recipe import, we use the `recipe-scrapers` library as the primary extraction path. It handles ~300 well-known recipe sites (NYT Cooking, AllRecipes, Serious Eats, etc.) deterministically and reliably. For URLs the library doesn't recognise, we fall back to fetching the raw HTML, stripping it to readable text, and asking the LLM to extract the recipe card.

This mirrors the existing `AIManager` pattern: try the fast, reliable path first; only invoke the LLM when the deterministic path can't handle it. Going LLM-only was considered but rejected — it would reinvent what `recipe-scrapers` already does well for the common case, add unnecessary latency and API cost for popular sites, and reduce reliability on well-structured pages where the scraper is essentially perfect.
