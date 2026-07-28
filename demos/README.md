# Demos — common user flows

Screen recordings of the core BubblyChef flows, captured against a live Supabase
session on a mobile viewport (430×932) via `playwright-cli`. These exist so a
reviewer can validate that flows actually *work* end-to-end — something static
screenshots can't show.

| Flow | File | What it shows |
|---|---|---|
| Auth → dashboard | [`01-auth-dashboard.webm`](01-auth-dashboard.webm) | Login against Supabase → dashboard renders with real pantry data. |
| Cook → chat handoff | [`02-cook-chat-handoff.webm`](02-cook-chat-handoff.webm) | Open a recipe → **Cook this** → cook modal (ingredient matching, `eggs`/`cheese` Ready) → **Confirm** → lands in chat with the "COOKING NOW" card + recipe-contextual quick prompts. |
| Recipe library | [`03-recipe-library.webm`](03-recipe-library.webm) | Search, page-turn navigation between recipes, favourite toggle. |
| Pantry + tip → chat | [`04-pantry-tip-chat.webm`](04-pantry-tip-chat.webm) | Pantry browse with category tints + location filters, then the dashboard tip card seeding chat ("TODAY'S TIP" card + auto-asked explain prompt, Bubbles streaming a reply). |
| Theme switch | [`05-theme-switch.webm`](05-theme-switch.webm) | Cycling all five palettes (Sakura → Mint → Lavender → Yuzu → Bluebell) via the ThemePicker. |

## Notes

- Format is `.webm` (VP8/VP9), ~3.8 MB total. Playable in any modern browser and
  in GitHub's file preview.
- **Recording the cook flow surfaced a real bug** (#152): the CookModal's
  Confirm/Cancel buttons were covered by the fixed bottom nav on mobile
  (both at `z-50`), so a cook couldn't be confirmed. Fixed by raising modal
  overlays to `z-[60]` before these demos were captured — so `02` shows the
  working, fixed flow.
- To regenerate: run the app (`cd nextjs && npm run dev`, AI service on 8888),
  then drive the flows with `playwright-cli` (`video-start` … `video-stop
  --filename …`) at a mobile viewport.
