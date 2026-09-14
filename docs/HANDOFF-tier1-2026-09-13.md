# Handoff: Tier 1 Implementation — 2026-09-13

**For:** New session implementing Tier 1 issues using agent teams + worktrees per `/start-work`.
**Branch strategy:** `feat/issue-<n>-<slug>` per issue, each in its own worktree.
**Agent team:** `frontend`, `backend`, `ui-ux` as needed per issue; `qa-reviewer` gates before PR.

---

## Context

Deep triage just completed. All issues are labelled. Four architectural decisions are recorded on their issues. PR #411 (housekeeping: mypy baseline + numpy pin) is open — merge it first before branching for any implementation.

Full triage report: **issue #409** (dependency map, priority rationale, full per-issue verdicts).
Queue state: `docs/QUEUE.md`.

---

## Tier 1 — fix before showing anyone the app

These are sequenced. Each is `ready-for-agent`. Do them in order — #331 unblocks testing of everything else.

### 1. Issue #331 — sign-out

**Title:** bug(auth): there is no way to sign out of the app
**What:** No `supabase.auth.signOut()` call anywhere. No sign-out control anywhere in the UI.
**Fix:**
- Add a "Sign out" button to `/profile` (primary) and optionally the bottom nav.
- Call `supabase.auth.signOut()`, then `router.push('/login')`.
- Client comes from `lib/supabase/client.ts` — never a fresh ad-hoc client.
- Middleware already redirects unauthenticated users to `/login` — no routing changes needed.
**Files:** `nextjs/src/app/profile/page.tsx` (add the button), `nextjs/src/lib/supabase/client.ts` (client import).
**Test:** `nextjs/e2e/` — add a sign-out spec once the button exists.
**Acceptance:** Signed-in user can sign out; `/pantry` redirects to `/login` after; signing back in as a different account shows that account's data.

---

### 2. Issue #390 (items 1 + 2 only) — greeting comma + profile link from home

**Title:** First-run experience: no onboarding, blank guest greeting, and no way to reach profile/account from home
**Scope for this ticket:** Item (1) and (2) only. Item (3) (onboarding explainer) is `needs-info` and separate.

**Item 1 — dangling comma greeting:**
- Home screen greeting shows `"Good afternoon, ☀️"` when no name is set (blank or empty string).
- Fix: handle null, undefined, AND empty-string name. Default to `"Good afternoon!"` or `"Good afternoon, chef"` — never a trailing comma.
- Profile screen shows "Guest" for the no-name case; align the home greeting to use the same fallback so both screens agree.
- QA add-on from issue: add an editable display name field on `/profile`; setting it drives both the profile heading and the home greeting.
- File: `nextjs/src/app/page.tsx` (home dashboard greeting).

**Item 2 — no path to profile from home:**
- Top-right circle is the theme switcher, not a profile link. Nothing in the bottom nav links to `/profile`.
- Fix: add a profile/account icon link (top-right or bottom nav) that routes to `/profile`.
- Files: home layout, bottom nav component.

---

### 3. Issue #393 — guest save-account persistent button

**Title:** Guest save-account flow is only reachable via the dismissible reminder banner
**What:** On `/profile`, a guest's only path to save their account is the dismissible banner. Dismissing it leaves no other control.
**Fix:** Add a permanent "Save account" button/section on `/profile`, independent of the dismissible banner.
- The save flow itself works (PR #388, `SaveAccountBanner` → `updateUser`).
- This is a second entry point, not a rewrite.
- File: `nextjs/src/app/profile/page.tsx`.
**Dependency:** Pair with #331 (sign-out on same page) and #390 item 2 (profile reachable from home). Can batch all three profile-page changes into one PR.

---

### 4. Issues #402 + #406 — tab state loss + footer count desync (fix together)

**#402 title:** Add-to-Pantry: switching between Scan and Type tabs wipes typed input but the 'ready to add' count survives
**#406 title:** Scan review: unchecking an item does not update the footer 'Add N Items' count

**Root cause (both):** `PantryAddSheet` uses `AnimatePresence` — inactive tabs are unmounted, destroying all local state. Count state and form/scan state are tracked independently and drift apart.

**Fix:**
- Keep both tabs mounted (remove unmount-on-switch from `AnimatePresence`, or lift state up to `PantryAddSheet`).
- Derive footer count from the checked set only — never from the total found/ready count.
- QA add-on on #402: the Scan tab case is worse — switching away destroys a completed scan, forcing a re-upload that hits the paid Gemini vision API. Both tabs in scope.
- After fix, confirm the actual Add operation gates on checked items, not all-found items.

**Files:**
- `nextjs/src/components/pantry/PantryAddSheet.tsx` — tab mounting / state lift
- `nextjs/src/components/scan/ReviewSurface.tsx` — footer count derivation
- `nextjs/src/components/pantry/ScanTab.tsx` — scan state preservation

---

## Agent team guidance

- Use one worktree per issue (`feat/issue-<n>-<slug>`).
- `frontend` agent owns all four — these are all Next.js frontend changes.
- `qa-reviewer` gates each PR before it opens: run `npx tsc --noEmit` + jest + the relevant e2e spec.
- PRs must use `Fixes #<n>` in the body (one keyword per issue, on its own line).
- Do NOT run dev server or tests from inside the worktree — see CLAUDE.md "Worktrees don't have a dev env".

## What NOT to start yet

Issues #396 (scan error UX), #398 (autocomplete), #183 (expiry backfill), #363 (estimated_expiry flag) — these are Tier 2. Do Tier 1 first.

Issues #356, #357, #395, #284 have recorded decisions but are not yet `ready-for-agent` for full implementation — they need design work or reserved-session coordination first.
