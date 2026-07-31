# Dev Testing & Seeding

Practical guide for exercising BubblyChef against realistic data locally — the
test account, the pantry seed script, and how to live-test the AI service
(including the R3 cooking companion).

---

## Test account

| | |
|---|---|
| **Email** | `test@bubbly.local` |
| **user_id** | `1136277c-9ee3-4fbc-a8c5-448d7a835237` |
| **Supabase project** | `obmbwuqwpvntxhhbdfsg` (dev) |

This is the throwaway account used for manual/live testing. It's distinct from
the real user accounts in the same project — **only seed/wipe `test@bubbly.local`**.

---

## Seeding a realistic pantry

`scripts/seed_pantry.py` populates a believable ~32-item weekly-shop kitchen
(staples, produce, proteins, condiments) with quantities, storage locations,
categories, and **expiry dates computed relative to today** — 7 items expiring
within 3 days so the expiring-soon / "cook this before it goes bad" features and
R3's `check_pantry` tool always have live data to work against.

```bash
cd ai-service
# Wipe the test user's pantry, then seed ~32 fresh items:
./.venv/bin/python ../scripts/seed_pantry.py --email test@bubbly.local

# Other modes:
./.venv/bin/python ../scripts/seed_pantry.py --user-id <uuid>          # target by id
./.venv/bin/python ../scripts/seed_pantry.py --email test@bubbly.local --keep  # add on top, don't wipe
```

Run it **from `ai-service/`** with that venv — the script reads Supabase creds
(`BUBBLY_SUPABASE_URL`, `BUBBLY_SUPABASE_SECRET_KEY`) from `ai-service/.env` via
`bubbly_chef.config.settings`, and uses the service-role key to look up the auth
user by email and bypass RLS on the write.

### Re-run to keep it fresh

Because expiry dates are offsets from `date.today()`, **re-run the seed whenever
the dates drift stale** (e.g. everything's "expired" after a week away). Same
command; it wipes and re-seeds with dates recomputed from the current day.

---

## Live-testing the AI service

The dev default routes all LLM calls through the **SAP proxy** (Anthropic),
which is tool-calling-capable — so R3 runs the real ReAct loop, not the
degraded single-shot fallback.

### Proxy auth (one-time)

The SAP proxy requires an `Authorization: Bearer <token>` header. `ai-service/.env`
must set `BUBBLY_ANTHROPIC_API_KEY` to the proxy token (the same
`ANTHROPIC_AUTH_TOKEN` the terminal Claude CLI uses, from
`~/.claude/settings.json`). Without it, every call returns
`401 MISSING_AUTHORIZATION_HEADER`. `BUBBLY_USE_ANTHROPIC_PROXY=true` selects
this path. (`.env` is gitignored — this token is never committed.)

### Run the stack

```bash
# terminal 1 — AI service
cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888

# terminal 2 — frontend
cd nextjs && npm run dev
```

Log in at `localhost:3000` as `test@bubbly.local`, open `/chat`.

### R3 cooking-companion prompts

- **Triggers the `check_pantry` tool** (pantry-grounded): *"I'm out of buttermilk,
  what can I use instead?"*, *"do I have enough for an omelette?"*
- **Answers directly, no tool** (a valid loop outcome): *"how do I fold egg
  whites?"*, *"how do I caramelise onions?"*

Watch the uvicorn logs to see the ReAct loop iterate and `check_pantry` fire on
the pantry-specific questions.

---

## Live test suite

`ai-service/tests/test_intent_live.py` calls the real proxy (gated on
`BUBBLY_RUN_LIVE_TESTS=1`). Tests pass individually; a full-suite run currently
has a shared-singleton event-loop teardown flaw — see issue #208. Run a single
one to sanity-check the proxy:

```bash
cd ai-service && ./.venv/bin/python -m pytest tests/test_intent_live.py -k cooking_help -q
```
