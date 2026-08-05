# Demos — common user flows

Screen recordings of the core BubblyChef flows, captured against a live Supabase
session on a mobile viewport (430×932). These exist so a reviewer can validate
that flows actually *work* end-to-end — something static screenshots can't show.

| Flow | File | What it shows |
|---|---|---|
| Auth → dashboard | [`01-auth-dashboard.webm`](01-auth-dashboard.webm) | Authenticated dashboard rendering with real pantry data — urgent-item hero, quick actions, tip card, pantry totals. |
| Cook → pantry match | [`02-cook-pantry-match.webm`](02-cook-pantry-match.webm) | Open a recipe → **Cook this** → "Mark as cooked" resolves every ingredient against the pantry, splitting them into matched rows, unit conflicts, and "Not in pantry". |
| Recipe library | [`03-recipe-library.webm`](03-recipe-library.webm) | Search, page-turn navigation between recipes, favourite toggle. |
| Pantry + tip → chat | [`04-pantry-tip-chat.webm`](04-pantry-tip-chat.webm) | Pantry browse with category tints + location filters, then the dashboard tip card seeding chat ("TODAY'S TIP" card + auto-asked prompt, Bubbles streaming a full reply + follow-up pills). |
| Theme switch | [`05-theme-switch.webm`](05-theme-switch.webm) | Cycling all five palettes (Mint → Lavender → Yuzu → Bluebell → back to Sakura) via the ThemePicker. |
| Expiry loop alive | [`06-expiry-loop.webm`](06-expiry-loop.webm) | Dashboard "Use Soon" widget, then the pantry with expiry badges on every item and a "Cook this" affordance on urgent-but-not-expired items. |

## Regenerating

Recording is scripted — see [`nextjs/scripts/record-demos.mjs`](../nextjs/scripts/record-demos.mjs):

```bash
# Both servers up first
cd nextjs && npm run dev                                   # :3000
cd ai-service && uvicorn bubbly_chef.main:app --port 8888  # :8888

# Auth state is shared with the Playwright suite; create it once
cd nextjs && npx playwright test e2e/smoke.spec.ts

cd nextjs && node scripts/record-demos.mjs             # all flows
cd nextjs && node scripts/record-demos.mjs theme cook  # a subset
```

Each flow records into its own browser context and is written to
`demos/<name>.webm`. A flow that throws has its video discarded rather than
committed half-finished, and the script exits non-zero.

## Notes

- Format is `.webm` (VP8/VP9), ~7 MB total. Playable in any modern browser and
  in GitHub's file preview.
- **All six re-recorded (2026-08-05)**, replacing takes that had gone stale
  against the current UI.
- **`02` changed shape.** The old `02-cook-chat-handoff` take ended by confirming
  the cook and landing in chat. The recipe-page action is now a "Mark as cooked"
  modal whose confirm (**"Yes, I cooked this"**) *deducts real quantities from the
  live pantry*, so the script deliberately stops at **Cancel** — re-recording a
  demo should not destroy stock. The pantry matching, which is the part worth
  demonstrating, has already run by then.
- The `02` recording currently shows every matched ingredient as **Unit conflict**
  (e.g. recipe wants `200 g salmon fillet`, pantry holds `salmon fillet` in
  another unit). That is the missing unit-conversion work in issue #6, with the
  UX side tracked in #209 — not a recording artifact.
- `01`/`06` reflect the dashboard expiry fix: the hero only claims "expires
  today/tomorrow" for items that genuinely have 0–1 days left, and already-expired
  stock no longer inflates the "expiring" count. Expired items still show an
  "Expired" badge in the pantry and correctly get no "Cook this" strip (#146).
- The cook modal's Confirm/Cancel buttons sit above the fixed bottom nav
  (`z-[60]`, #152), so the flow is confirmable on mobile.
- In a container whose bundled Chromium doesn't match the pinned Playwright
  version, set `PLAYWRIGHT_CHROMIUM_PATH` (see `nextjs/e2e/browser.ts`).
