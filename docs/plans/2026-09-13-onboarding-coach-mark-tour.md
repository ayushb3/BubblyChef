# First-Run Coach-Mark Onboarding Tour

## Context

New users land on BubblyChef with no explanation of what the app does. There is
no onboarding, tutorial, or feature explainer anywhere in the codebase (confirmed
by grep — zero `onboarding`/`tour`/`tutorial`/`walkthrough` references). The four
bottom-nav tabs (Home, Pantry, Chat, Recipes), the receipt scanner, and the
profile page are all discoverable only by poking around. Issue #390 already
flagged first-run experience gaps; the greeting + profile-reachability parts
shipped in PR #419, but the "no onboarding" part remains.

This plan adds a **first-run coach-mark guided tour**: a dimmed overlay that
spotlights one real UI element at a time with a short callout ("Your pantry lives
here"), with Back / Next / Skip. It auto-opens the first time any user (guest or
signed-in) lands on home `/`, persists a "seen" flag so it never nags again, and
is re-openable later from the profile page.

Intended outcome: a first-time user understands the six core features within a few
taps, without a forced multi-page walkthrough.

## Decisions (locked with user)

- **Style:** coach marks — spotlight real elements, not a full-screen carousel.
- **Trigger:** first run, auto, dismissible; re-openable from profile.
- **Anchoring:** stay on `/`. Spotlight the persistent bottom-nav tabs + home's
  own elements + the header profile button, describing each destination in copy.
  No route-to-route navigation — it fights `PageTransition` animation and races
  rect measurement against route mounts for no real benefit.
- **Flag storage:** Supabase `user_metadata.onboarding_completed: boolean` via
  `supabase.auth.updateUser({ data: { onboarding_completed: true } })`. No schema
  migration. Guests have a session + metadata, so this works for them too.

## Approach

### Target references — `data-tour` attributes

Add a `data-tour` attribute to each spotlight target; the provider resolves the
active step via `document.querySelector('[data-tour="..."]')` and reads
`getBoundingClientRect()`. No brittle class selectors.

| `data-tour` | Element | File |
|---|---|---|
| `hero` | HeroHome speech-bubble wrapper | `components/dashboard/HeroHome.tsx` |
| `quick-actions` | the 3-card action grid | `components/dashboard/HeroHome.tsx` |
| `nav-pantry` | Pantry bottom-nav `<Link>` | `components/layout/BottomNav.tsx` |
| `nav-recipes` | Recipes bottom-nav `<Link>` | `components/layout/BottomNav.tsx` |
| `nav-chat` | Chat bottom-nav `<Link>` | `components/layout/BottomNav.tsx` |
| `profile` | header profile button | `components/layout/ProfileHeaderButton.tsx` |

`ProfileHeaderButton` already exists (added in PR #419) and is wired into every
page's header `rightSlot`, so the profile anchor is already present — do not add a
new profile nav element.

### Spotlight mechanic — single SVG mask

One `<svg class="fixed inset-0 z-[60]">` containing a `<mask>`: a white
full-viewport rect minus a black rounded `<rect>` at the target bounds (+8px
padding, `rx=16`). A dim rect (`fill="black"` `opacity≈0.5`) uses that mask, so
everything dims except the cutout. Cheaper and cleaner than 4 framing divs (no
seams, trivial rounded corners) or a box-shadow trick (can't round the hole
across the viewport).

The tooltip is a separate absolutely-positioned `motion.div`, placed **below** the
target for header/hero targets and **above** for bottom-nav targets (which sit at
the screen bottom). Must sit above `BottomNav` (`z-50`) — use `z-[60]`, matching
the `PantryAddSheet` overlay idiom.

### State + persistence — `TourProvider`

A client `TourProvider` mounted in `components/Providers.tsx` (inside
`ThemeProvider`), so it is global and the profile "Take the tour" button can open
it from any route:

- Holds `{ isOpen, stepIndex }`; exposes `openTour()` via context.
- On mount: `createClient().auth.getUser()`; if
  `user.user_metadata.onboarding_completed !== true` **and**
  `window.location.pathname === '/'`, auto-open. The pathname guard keeps
  auto-open home-only despite the global mount.
- Finish / Skip → `updateUser({ data: { onboarding_completed: true } })`, then
  close. (There is no existing user hook — the provider fetches the user itself.)

### Scroll / resize / missing targets

Keep the measured `rect` in state; recompute on `resize` + `scroll` and on
`stepIndex` change via `requestAnimationFrame`. `scrollIntoView({ block: 'nearest' })`
the target before measuring. If `querySelector` returns null, auto-skip to the
next step. Trap focus in the tooltip (reuse existing `useModalFocusTrap` if
present; otherwise a minimal trap); Esc = Skip. Respect `prefers-reduced-motion`
(the codebase already uses `motion-reduce:` utilities).

### Step list (all on `/`)

1. `hero` — "Hi! I'm Bubbles, your kitchen assistant." (tooltip below)
2. `quick-actions` — "Quick actions: find a recipe, scan a receipt, or ask me anything." (below)
3. `nav-pantry` — "Your pantry lives here — and tap Scan inside it to add receipts fast." (above) — scan folded in, no separate spotlight since scan isn't a nav tab.
4. `nav-recipes` — "Browse and save recipes here." (above)
5. `nav-chat` — "Ask me anything about cooking, anytime." (above)
6. `profile` — "Your profile and settings — re-take this tour here whenever you like." (below)

Controls: Back / Next / Skip; last step's Next reads "Done." Step-count dots.

## Files

**New — `components/onboarding/`:**
- `TourProvider.tsx` — context, state, auto-open logic, persistence, resize/scroll.
- `TourOverlay.tsx` — SVG-mask spotlight + tooltip + Back/Next/Skip; consumes context; `motion` + `AnimatePresence`.
- `steps.ts` — `TourStep[]` = `{ id, selector, copy, placement }`.
- (`openTour()` exported from the provider module as a `useTour()` hook.)

**New — `components/profile/`:**
- `TakeTourButton.tsx` — tiny client component; calls `openTour()` then routes to `/` (profile page is a server component, so the button must be a client child).

**Modified:**
- `components/Providers.tsx` — wrap children in `<TourProvider>`, render `<TourOverlay/>`.
- `components/layout/BottomNav.tsx` — add `data-tour` to the Pantry/Recipes/Chat `<Link>`s (add a `tourId?` to `TabDef`).
- `components/dashboard/HeroHome.tsx` — `data-tour="hero"` on the speech-bubble wrapper, `data-tour="quick-actions"` on the grid.
- `components/layout/ProfileHeaderButton.tsx` — add `data-tour="profile"`.
- `app/profile/page.tsx` — render `<TakeTourButton />` (in the Account or About section).

**Reuse:** overlay/animation idiom from `components/pantry/PantryAddSheet.tsx`;
`SpringButton` for tour controls; `createClient` from `@/lib/supabase/client`;
`isGuestUser` from `@/lib/auth/guest` (optional, for guest-flavoured copy only).

## Verification

**Manual (run in primary checkout, not the worktree — needs the dev env):**
1. `git checkout main && git pull`, then check out this branch; `cd nextjs && npm run dev`.
2. New/guest session on `/` → tour auto-opens on step 1. Next through all 6, confirm each spotlight lands on the right element and copy reads right on mobile width (≤480px).
3. Skip on any step → overlay closes; reload `/` → does **not** reappear.
4. Resize / rotate mid-tour → spotlight rect tracks the target.
5. `/profile` → "Take the tour" → lands on `/` with the tour open.
6. `prefers-reduced-motion` on → no jarring animation.

**Automated — `e2e/onboarding.spec.ts` (Playwright, reuse `fixtures/auth`):**
- First-run auto-open: storage state without the flag → `goto('/')` → step-1 copy visible.
- Next ×5 through all steps; assert each step copy; final control reads "Done."
- Skip: intercept `**/auth/v1/user`, assert the `updateUser` write fired; overlay gone.
- Flag set in storage state → `goto('/')` → overlay absent.
- Profile re-open: `/profile` → Take the tour → `/` with overlay open.

**Unit (`src/__tests__/` or alongside):**
- Auto-skip when a step's target is missing from the DOM.
- Pathname guard blocks auto-open when not on `/`.

**Gates before commit:** `cd nextjs && npx tsc --noEmit` and the Next.js test run.

## Out of scope

- No multi-page/route-navigating tour.
- No `user_profiles` migration (using `user_metadata`).
- No per-step analytics.
- Onboarding content beyond the 6 feature callouts (no sample-data seeding, no
  interactive "try it" steps).
