# UI Adversarial Review — 2026-07-25

**Scope:** diff `1c0d802` (main) → `HEAD` (`claude/project-status-gamification-cpn7rg`, currently at `e3693d2`), covering:
- `c7b6dcf` — recipe action cluster (heart, overflow menu, action bar reorder)
- `6f02d07` — `EmptyState.tsx` (rewrite of stale #120)
- `0065bc3` — chat bubble tails + `PostMessageChips.tsx` (rewrite of stale #119)
- `feat/ui-overhaul` merge — `Chip`, `ThemePicker`, `lib/motion.ts`, `CookModal`, `PageTransition`, 5-palette theming

**Reviewer role:** qa-reviewer (adversarial). No code was changed. Write scope was limited to this file and `docs/media/**`.

---

## Verdict: **SHIP WITH FIXES**

Nothing here is a data-loss or crash-level defect, but there is one outright broken feature signal (favorited-heart / delete-menu color silently resolves to nothing) and a systemic, easily-reproduced contrast failure that touches the login screen, chat bubbles, filter chips, and the empty-state header banner across **all five palettes, not just one**. None of it needs a redesign — the fixes are small and mechanical — but it shouldn't ship as-is.

---

## Findings

| Sev | Location | Issue | Concrete failure scenario |
|---|---|---|---|
| **CRITICAL** | `nextjs/src/components/recipes/RecipeBook.tsx:506,549,630,673`; `nextjs/src/components/recipes/RecipeImportModal.tsx:182,191` | `var(--color-coral)` is used with **no fallback**, and `--color-coral` is **never defined** anywhere in `globals.css` (not in `:root`, not in any `[data-theme]` block). | A `var()` referencing an undeclared custom property with no fallback resolves to the property's inherited/initial value — for `color` that means "inherit," not red. Result: the favorited heart never actually renders coral (it silently inherits the ambient text color, so favorited vs. not-favorited become visually indistinguishable except for fill-vs-outline weight), the "Delete" row in the overflow menu loses its red danger cue, and `RecipeImportModal`'s error border/text loses its red state entirely. This is exactly the feature PR #121 claims to add ("44×44 heart w/ pop animation") — the pop animation still fires, but the color signal it's supposed to deliver doesn't. Proof the intended value was `#ff9aa2`: `RecipeDeleteConfirm.tsx:36-37` (untouched by this branch) uses `var(--color-coral, #ff9aa2)` — same token, but with the fallback that was left off everywhere else. |
| **HIGH** | `nextjs/src/components/ui/Chip.tsx:64` (`selected` state → `color: '#fff'`); `nextjs/src/components/recipes/RecipeBook.tsx:418` (hamburger tab icon, `color: '#fff'` on `background: var(--color-primary)`); `nextjs/src/components/ui/EmptyState.tsx:47` (chowder-panel header, `text-white` on `.chowder-panel` = `--color-primary`) | White text/icon on `var(--color-primary)` fails WCAG contrast in **all five** themes, not just the "weak" ones. Computed contrast ratios (white vs. each theme's `--color-primary`): sakura 1.64:1, mint 1.41:1, lavender 1.87:1, yuzu 1.35:1, bluebell 1.78:1 — all below both the 4.5:1 text minimum and the 3:1 UI-component minimum. | Consumed directly in production by `nextjs/src/app/pantry/page.tsx:191-198` — the active location-filter chip (`tone="primary" selected={true}`) becomes low-legibility in every palette. Same defect shows up on `/login`'s "Sign In" button (`bg-[var(--color-primary)] text-white`, a pre-existing pattern, not part of this diff, but the *same shared bug family* — see screenshots `login-yuzu.png` and `login-mint.png`, where the button label is visibly washed out; `login-sakura.png` is merely mediocre by comparison). This is a **theme rollout** problem: a single fixed pink might have scraped by, but the theming work (in scope per this review) turned one marginal color pairing into five confirmed failures. |
| **HIGH** | `nextjs/src/lib/motion.ts` (`useMotionConfig`, `reducedTransition`) | Dead code. `grep -rn "useMotionConfig\|useReducedMotion"` across `nextjs/src` returns only the definition in `motion.ts` itself — **zero call sites**. Every consumer of the module (`Chip.tsx:5`, `RecipeBook.tsx:14`, `BottomNav.tsx:13`) imports the raw `springs` constant directly, and `MessageBubble.tsx`, `PageTransition.tsx`, `CookModal.tsx` hardcode their own `transition={{ duration: ... }}` — none of them check `prefers-reduced-motion`. | A user with `prefers-reduced-motion: reduce` set (motion sickness / vestibular disorder — the exact population this API exists for) still gets the heart-pop spring, the nav-pill slide, the chip tap-scale, and the 200-320ms page/modal transitions at full amplitude. The task brief specifically asked "is it actually used?" — the answer is no. |
| **HIGH** | `nextjs/src/components/ui/ThemePicker.tsx:55-58` | Active-swatch indicator is `outline: 2px solid white`, rendered with `outlineOffset: 2px` so the gap shows through to whatever sits behind the picker. In every place `<ThemePicker />` is mounted (`pantry/page.tsx:172`, `chat/page.tsx`, `recipes/page.tsx`, dashboard `page.tsx`), it sits inside `BubblesHeader`, which has no background of its own and inherits `body`'s `background: var(--color-bg)` — a near-white/cream color in **every** theme (`#FFF0F5`, `#F0FBF5`, `#F5F0FF`, `#FFFBF0`, `#F0F5FF`). White-on-near-white contrast ≈ 1.0:1. | The one piece of UI whose entire job is "show which of the 5 themes is currently active" is effectively invisible in all 5 themes — the ring blends into the page background it's drawn on. This isn't a "readable on sakura, invisible on yuzu" bug — it's broken everywhere, uniformly, because the ring's target background was never accounted for. |
| **MEDIUM** | `nextjs/src/components/recipes/RecipeBook.tsx:92-101, 511-556` | Overflow menu (`DotsThree`) outside-click dismissal is implemented correctly and cleans up its listener on unmount (`removeEventListener` in the `useEffect` cleanup — no leak). However there is **no Escape-key handler** and **no focus management** into the menu on open (`aria-haspopup`/`aria-expanded` are present, but nothing moves focus to "Edit" when it opens, and nothing closes it on Escape or on programmatic blur/focus-out). | A keyboard user can Tab into "Edit"/"Delete" (they're real `<button>`s, so basic reachability holds), but pressing Escape after opening the menu does nothing — it stays open until an outside click or an item is chosen. Falls short of the "keyboard reachability" bar the review brief called out explicitly. |
| **MEDIUM** | `nextjs/src/components/ui/Chip.tsx:26-42` (default `tone="muted"`) | Default/unset tone renders `background: var(--color-bg)`, `color: var(--color-muted)`. Computed contrast for this pairing is ~3.0–3.3:1 across all five themes (checked yuzu: 3.22:1) — below the 4.5:1 AA minimum for the 12px (`text-xs`) label size Chip actually uses. | Any `<Chip>` left at its default tone (e.g. `Chip tone="muted"` used explicitly for "Serves N" in `RecipeBook.tsx:476,598`, or any future caller that omits `tone`) renders a legible-but-marginal label — passes the lower "large text/graphics" bar, fails the bar that actually applies to a 12px chip label, in every theme. |
| **LOW** | `nextjs/src/components/chat/MessageBubble.tsx:22-53` | Assistant bubble fill is `bg-[var(--color-accent)]/30` (30% opacity) with a `border-[var(--color-accent)]` outline, but the tail `<span>` (lines 31-41) is a solid, full-opacity `var(--color-accent)` wedge. | Cosmetic only: the tail reads as noticeably more saturated than the translucent body it's attached to, so it looks like a separate colored triangle rather than a seamless continuation of the bubble. Not theme-breaking (consistent across all 5 palettes), just an inconsistency between fill and pointer. |
| **LOW** | `nextjs/src/lib/tag-tone.ts:13-14,25,29` | `spicy`, `hot`, `italian`, `chinese` are mapped to `tone: 'expired'` — the same token CLAUDE.md documents as theme-invariant "red = bad" semantics for pantry expiry state. | Semantic overload: a recipe tagged "spicy" or "Italian" renders in the identical red/danger-tinted chip as a pantry item that has actually gone bad. Not a contrast bug, but a confusing reuse of a token whose meaning is supposed to be fixed ("expired = bad") outside the pantry context it was designed for. |
| **LOW (nitpick)** | `nextjs/src/components/recipes/CookModal.tsx:268`; `RecipeBook.tsx:418,445,450` | Hardcoded `#4a4a4a`, `#fff`, `rgba(0,0,0,0.72/0.18/0.4)` instead of design tokens. | Verified these specific instances sit on theme-invariant backgrounds (`--color-fresh`/`--color-expiring`/`--color-border` swatches, or a dark image-gradient overlay) so they don't currently break legibility in any of the 5 palettes — but they're inconsistent with "always use tokens" and would silently go stale if those backgrounds' relationship to the palette ever changed. |

---

## Screenshot index

All captured at 390×844 (mobile viewport), `docs/media/`:

| File | Shows |
|---|---|
| `login-sakura.png` | `/login`, sakura theme (default pink/mint). Baseline. |
| `login-mint.png` | `/login`, mint theme. "Sign In" button white label visibly weaker than sakura. |
| `login-lavender.png` | `/login`, lavender theme. |
| `login-yuzu.png` | `/login`, yuzu theme. **Worst contrast case** — white "Sign In" label on `#FFD98C` is the clearest visual confirmation of the HIGH finding above. |
| `login-bluebell.png` | `/login`, bluebell theme. |

All five renders confirm the theme system itself works correctly (five genuinely distinct palettes applied via `data-theme`), which is the main thing this screenshot set was asked to prove. The white-text-on-pastel-primary legibility problem is visible on this very page even though `/login` itself predates the reviewed commits — it's the same shared Tailwind pattern (`bg-[var(--color-primary)] text-white`) that the in-scope `Chip.tsx`, `RecipeBook.tsx` hamburger button, and `EmptyState.tsx` header all reuse.

## Coverage gaps — what could NOT be verified visually

- **No Supabase credentials exist in this environment.** Direct navigation to `/`, `/pantry`, `/recipes`, `/chat`, `/profile`, and `/scan` all 200'd through to a redirect and landed on `/login` (confirmed via Playwright, each logged its final resolved URL). None of the actually-changed, gated UI could be screenshotted directly:
  - `RecipeBook.tsx`'s heart/overflow-menu action cluster (PR #121's core deliverable)
  - `MessageBubble.tsx` bubble tails and `PostMessageChips.tsx` (PR #119 rewrite)
  - `EmptyState.tsx` in its real chat/recipes empty-state habitats
  - `ThemePicker.tsx` mounted in its real header context (the invisible-ring finding above is derived from static CSS analysis — computed contrast math plus tracing the DOM/CSS cascade — not from a screenshot of the picker itself)
- **`/chip-demo`** (an in-repo playground route that renders `Chip` in isolation, added in this same diff) is also behind the auth middleware — it redirected to `/login` exactly like every other route, because the middleware matcher excludes only `_next/static`, `_next/image`, `favicon.ico`, and image file extensions, not app routes. I did not attempt to work around this (e.g., by patching middleware or stubbing an authenticated session) because doing so would mean editing code, which is out of scope for this review's write permissions.
- **Net result:** only `/login`, across all 5 themes, was actually photographed. Every finding above about `Chip`, `EmptyState`, `RecipeBook`'s action cluster, `MessageBubble`, `PostMessageChips`, and `ThemePicker` is backed by direct source review plus contrast-ratio computation against the exact hex values in `globals.css`, not by a screenshot of the component itself. Where the same code pattern is visible on `/login`, I've cross-referenced it explicitly; where it isn't (e.g. the `ThemePicker` ring, `--color-coral`), treat those as verified-by-static-analysis rather than verified-by-eye, and worth a quick visual sanity check with real credentials before shipping.

---

## Dropped-behaviour analysis — the two rewrites

### #120 → `6f02d07` (`EmptyState.tsx`)

Diffed `$(git merge-base origin/feat/w2-empty-state HEAD)...origin/feat/w2-empty-state` against current `HEAD`.

**No behaviour dropped.** The original component took a fixed prop set (`mascotState`, `headerLabel`, `headline`, `subline`, `cta`) and rendered exactly one thing. The rewrite is a strict superset: same fields (renamed `mascotState`→`state`, `headerLabel`→`header` — cosmetic), plus a new `children` slot. Both call sites were re-checked on `HEAD`:
- `chat/page.tsx:194-211` — still renders the `SUGGESTIONS` chip row below the `EmptyState`, now passed as `children` instead of being hardcoded inline in the old version. Same four suggestion strings, same click handler.
- `RecipeBook.tsx:777-786` — still renders the "Start chatting" CTA exactly as before, routing to `/chat` via `router.push`.

No regression here. The rewrite is arguably an improvement (more reusable, generic `children` slot instead of a bespoke suggestion-chip layout baked into the component).

### #119 → `0065bc3` (chat bubble tails + `PostMessageChips.tsx`)

Diffed `$(git merge-base origin/feat/w2-chat-bubble HEAD)...origin/feat/w2-chat-bubble` against current `HEAD`.

**One prop removed, but it was already dead in the original — not a regression.** The stale branch's `PostMessageChips` declared an `onSave?: () => void` prop and rendered a "Save this 🔖" chip when it was set. Tracing that branch's only call site (`chat/page.tsx`'s `<PostMessageChips onTryAnother={...} onTellMore={...} />`), `onSave` was **never passed** — it was an unreachable prop even in the original stale PR. The rewrite dropping it entirely is a cleanup, not a lost feature. (Worth a note to whoever picks up "save from chat" as future work: the affordance was drafted once already and abandoned before it was wired up — same intent likely still applies.)

**One improvement**: the rewrite's tail `<span>`s (`MessageBubble.tsx:32,44`) carry `aria-hidden`; the original's did not. Correct call — these are purely decorative and shouldn't be exposed to assistive tech.

**One cosmetic regression worth flagging** (see LOW finding above): the original kept the assistant bubble at opaque `bg-[var(--color-surface)]` with the tail matching that same solid fill (`borderRight: '8px solid var(--color-surface)'`) — fill and tail were the same color, by construction. The current version switched the assistant bubble to a translucent `--color-accent/30` fill (a `feat/ui-overhaul` design decision, not itself from PR #119) but kept the tail at full-opacity `--color-accent`, which is is the bubble's *border* color, not its *fill* color — so the tail no longer visually matches the body the way it used to in the original. Purely cosmetic, not present in every rewrite decision, but it's a visible seam introduced by combining the tail feature with the separately-landed translucent-bubble redesign.

---

## Summary

Two systemic root causes account for most of the findings above:
1. **A CSS custom property (`--color-coral`) that was referenced without ever being declared**, breaking three separate color signals (favorited heart, delete-menu danger color, import-error state) — silent, no console warning, no lint catch, because `var()` fallback-to-inherit is valid CSS.
2. **The `text-white`-on-`--color-primary` pattern surviving the jump from one fixed color to five theme-selectable pastels** without anyone re-checking contrast against all five — visible on the shared `Chip` component, the new hamburger tab button, the new `EmptyState` header banner, and (pre-existing, but same family) the login button.

Both are mechanical, scoped fixes: add the missing token (with the fallback already proven correct in `RecipeDeleteConfirm.tsx`), and swap the white text/ring for a token that's been contrast-checked against all five `--color-primary` values (or move to `--color-text`/`--color-primary-dark`, which the non-selected `Chip` state already does correctly at ~5–6:1 across all five themes).
