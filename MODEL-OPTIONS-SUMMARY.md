# Model Options Summary

> **Last verified:** 2026-09-08. This doc is a point-in-time snapshot of Gemini's
> model lineup — treat model names and benchmarks as stale after a few months and
> re-check `https://ai.google.dev/gemini-api/docs/models` before trusting them.

## Deprecation notice

`gemini-2.5-flash` (the app's former default) is **deprecated** by Google and
retires no earlier than **2026-10-16**. `ai-service/bubbly_chef/config.py` now
defaults to `gemini-3.1-flash-lite` (issue #231).

## TL;DR - What to Try

### Recommended
```bash
echo "BUBBLY_GEMINI_MODEL=gemini-3.1-flash-lite" >> ai-service/.env
# Restart the AI microservice - that's it!
```
**Result:** fastest and cheapest of the current lineup, still free tier, structured
JSON output verified correct.

### Best Local Option (5 minutes) — degraded fallback, not a primary
```bash
brew install ollama
ollama serve &
ollama pull qwen2.5:7b
# Comment out BUBBLY_GEMINI_API_KEY in ai-service/.env
# Restart the AI microservice
```
**Result:** no API limits, works offline, ~8GB RAM needed. **Caveat:** this
repo's Ollama provider (`ai-service/bubbly_chef/ai/ollama.py`) has no vision
implementation, so receipt scanning (`/v1/scan/receipt`) does not work when
Ollama is the active provider — chat and recipe generation still work, OCR
does not. Treat Ollama as a fallback for when Gemini is unavailable, not as
something to run primary.

---

## Smoke test: structured-output candidates (2026-09-08)

Four candidate models were run against this app's exact structured-output
pattern (JSON `responseMimeType` + `responseSchema`, the same shape
`ai-service/bubbly_chef/ai/gemini.py` sends) on a representative pantry-parse
prompt. All four returned correct extractions — the differentiator was
latency and token usage, not correctness.

| Model | Latency | Tokens | Notes |
|---|---|---|---|
| `gemini-2.5-flash` | 3021ms | 445 | previous default, deprecated |
| `gemini-3.5-flash` | 4195ms | 1071 | full reasoning model — most tokens |
| `gemini-3.7-flash` | 2390ms | 602 | full reasoning model |
| `gemini-3.1-flash-lite` | **1584ms** | **136** | **chosen** — fastest, 3.3x fewer tokens than the old default |

**Why flash-lite wins here:** the newer full Flash models (`3.5-flash`,
`3.7-flash`) do internal reasoning before responding, which burns more tokens
even on a simple structured-extraction task where reasoning adds nothing.
`gemini-3.1-flash-lite` skips that step, so it's both faster and cheaper for
this app's JSON-schema-constrained calls. Given the project's "zero cost AI"
principle (and that cost at this volume is a rounding error either way — the
token savings matter for latency more than for the bill), flash-lite is the
right default.

---

## Available Models (as of 2026-09-08)

### ☁️ Cloud (Gemini) — Free Tier
- ✅ `gemini-3.1-flash-lite` — **current default**, fastest + fewest tokens
- ✅ `gemini-3.7-flash` — full reasoning, more capable on complex tasks, slower
- ✅ `gemini-3.5-flash` — full reasoning, highest token cost of the three
- ⚠️ `gemini-2.5-flash` — deprecated, retires no earlier than 2026-10-16, do not
  configure for new deployments

### 💻 Local (Ollama) — No Limits, No Vision
- ✅ `qwen2.5:7b` — recommended for recipes/chat (8GB RAM)
- ✅ `llama3.1:8b` — great quality (8GB RAM)
- ✅ `gemma2:9b` — Google's local model (10GB RAM)
- ✅ `gemma2:2b` — low resource option (3GB RAM)
- ✅ `mistral:7b` — creative alternative (8GB RAM)
- ❌ None of these give you receipt scanning — the Ollama provider has no
  vision path in this codebase, only Gemini does.

---

## What Changed (historical, prior model-options pass)

✅ Added retry logic — automatically retries 2x on failure
✅ Fixed both prompts — initial + follow-up now have clear examples
✅ Documented all models — complete comparison table
✅ Easy switching — just edit `.env` and restart

---

See full details in: `docs/implementations/model-options-recipe-generation.md`
