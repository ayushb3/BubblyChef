# Demos — common user flows

Screen recordings of the core BubblyChef flows, captured against a live Supabase
session on a mobile viewport (430×932) via `playwright-cli`. These exist so a
reviewer can validate that flows actually *work* end-to-end — something static
screenshots can't show.

| Flow | File | What it shows |
|---|---|---|
| Auth → dashboard | [`01-auth-dashboard.webm`](01-auth-dashboard.webm) | Login against Supabase → dashboard renders with real pantry data. |
| Cook → chat handoff | [`02-cook-chat-handoff.webm`](02-cook-chat-handoff.webm) | Open a recipe → **Cook this** → cook modal (ingredient matching: `eggs`/`cheese` Ready, `rigatoni`→`pasta` substituted) → **Confirm** → lands in chat with the "COOKING NOW" card + recipe-contextual quick prompts. |
| Recipe library | [`03-recipe-library.webm`](03-recipe-library.webm) | Search, page-turn navigation between recipes, favourite toggle. |
| Pantry + tip → chat | [`04-pantry-tip-chat.webm`](04-pantry-tip-chat.webm) | Pantry browse with category tints + location filters, then the dashboard tip card seeding chat ("TODAY'S TIP" card + auto-asked explain prompt, Bubbles streaming a reply). |
| Theme switch | [`05-theme-switch.webm`](05-theme-switch.webm) | Cycling all five palettes (Sakura → Mint → Lavender → Yuzu → Bluebell) via the ThemePicker. |
| Expiry loop alive | [`06-expiry-loop.webm`](06-expiry-loop.webm) | Dashboard "Use Soon" widget + "N items · N expiring", then the pantry with expiry badges on every item and a "Cook this" affordance on urgent-but-not-expired items. |

## Notes

- Format is `.webm` (VP8/VP9), ~4.2 MB total. Playable in any modern browser and
  in GitHub's file preview.
- **`02` re-recorded (2026-07-29)** after #157 landed. The previous take only
  demonstrated intent *routing* to the chat; this one shows the recipe context
  actually pinned — the recipe is resolved server-side from its id, so the
  "COOKING NOW" card and recipe-specific prompts survive the handoff (no
  fetch race).
- **`06` is new (2026-07-29)** and captures the payoff of #158/#159: every
  pantry add now gets a default expiry, so the expiry → cook loop is visibly
  alive (badges + "Cook this"). Before that fix, items landed with
  `expiry_date: null` and the whole surface was blank. It also reflects #146 —
  already-expired items keep the "Expired" badge but no longer get the
  incoherent "Cook this" strip.
- The cook modal's Confirm/Cancel buttons sit above the fixed bottom nav
  (`z-[60]`, #152), so the flow is confirmable on mobile.
- To regenerate: run the app (`cd nextjs && npm run dev -- -p 3100`, AI service
  on 8888), then drive the flows with `playwright-cli` (`video-start` …
  `video-stop --filename …`) at a 430×932 viewport. Note: `run-code`/`eval` may
  fail to expose `page` in some sessions — use the dedicated `click`/`mousewheel`/
  `press` commands and shell `sleep` for pacing instead.
