# Expiring Soon — closing the waste-prevention loop

_Brainstorm, 2026-07-28. Framed by the user's steer: the feature feels "lost" because it is **not actionable** (seeing "expires tomorrow" doesn't take you anywhere) and **not proactive** (it only surfaces when you happen to open the app — usually too late). Scope for now: **ideate + file issues**, not build._

---

## The problem, precisely

BubblyChef's whole promise is **scan → stock → cook before it goes to waste**. Expiry is the mechanism that should make that promise real. Today it's a **read-only stat**:

- Data is solid: `pantry-helpers.ts` computes `days_until_expiry`, `is_expiring_soon` (≤3 days), `is_expired`; there's a `/api/pantry/expiring?days=N` route and `buildPantryListResponse` returns `expiring_soon_count` / `expired_count`.
- Surfaces are passive and scattered: dashboard hero *sometimes* leads with the most-urgent item, a "Use Soon" count card, a status-bar footnote, and card tints on the pantry page.
- The loop never closes. It tells you *that* something is expiring; it never (a) walks you into cooking it, nor (b) reaches out before you forget.

Two gaps, matching the user's read:

1. **Not actionable** — every expiry surface should be a launchpad into the cook/recipe flow seeded with the expiring ingredient, and should let you resolve the item ("cooked it" / "used it" / "tossed it").
2. **Not proactive** — the app must reach out (notification/nudge) so expiry works when the user *isn't* already looking. This is partially owned by existing issue **#43** (in-app notification center).

---

## Direction A — Make it ACTIONABLE (in-app, when the user is looking)

### A1. Expiry surfaces deep-link into "cook this now" (highest ROI, small)
The dashboard urgent-item CTA and each expiring pantry card should launch the recipe/chat flow **pre-seeded with the expiring ingredient**. The cook flow already exists on PR #74 (`CookModal`, `/chat?cooking=`), so this is mostly wiring a query param + a prompt seed, not new infrastructure.

- Dashboard hero: "2 eggs expire tomorrow" → button → `/chat?mode=recipe&use=eggs` (or `/recipes?use=eggs`) that opens with "recipes using eggs, cookable now."
- Pantry card (expiring): tap → same seeded flow, scoped to that item.
- Acceptance: from any expiring surface, ≤1 tap to a recipe suggestion that actually uses that ingredient.

### A2. A dedicated "Use Soon" triage view (medium)
Not a count — a real screen (or a filtered pantry mode) listing everything expiring, sorted by urgency, each row with:
- one-tap **Find a recipe** (→ A1 seeded flow),
- one-tap **resolve**: "Used it up" (decrement/remove) / "Tossed it" (remove + optional waste-log).
Turns diffuse anxiety into a clearable checklist. Reachable from the "Use Soon" card and bottom nav.

### A3. Resolve/close-the-loop actions everywhere (small–medium, enables the reward loop)
Give every expiring item a lightweight way to say what happened to it. Without this the app can never know it *helped* — which is what makes proactive nudges feel earned rather than nagging. Minimal: "Used it up" / "Tossed" buttons that mutate stock. Data captured here feeds a future "you saved N items this week" payoff (out of scope now, but design the mutation so it's recordable).

---

## Direction B — Make it PROACTIVE (when the user is NOT looking)

> Owned largely by existing issue **#43** (in-app notification center for expiry alerts and pantry nudges). This section is the *expiry-specific* framing to fold into / cross-link with #43 — do not file a duplicate.

### B1. Morning nudge / digest
A once-daily surface (in-app notification bell to start; push later) — "3 things expiring today, dinner ideas inside" — that opens straight into the A2 triage or an A1 seeded recipe. In-app-only first (no push infra, no permissions) so it's shippable without native work.

### B2. Threshold escalation
Tiered urgency, not a flat ≤3-day flag: `expiring_soon` (≤3d) vs `expires_today`/`expired`. Copy + Bubbles mood escalate with the tier. `pantry-helpers.ts` already computes the raw days; add a tier derivation.

### B3. Trust the dates (prerequisite, links #3)
Proactive nudges built on wrong dates train users to ignore them. Produce expiry estimation is filed as **#3**. Flag as a dependency: the nudge feature's value is capped by estimation accuracy.

---

## Sequencing / dependencies

- **A1** is the wedge: small, rides on PR #74's cook flow, immediately makes expiry feel alive. Do first.
- **A3** (resolve actions) unlocks the eventual reward loop and should land near A1/A2.
- **A2** is the natural home once A1 + A3 exist.
- **B1/B2** fold into **#43**; gated in value by **#3** (estimation accuracy).
- Cross-cutting: **#131/#110** (category vs expiry color collision — in flight) matters here because expiry tinting and category tinting currently fight each other; a clean category palette makes expiry tint legible as an *urgency* signal.

## Explicitly out of scope for now
- Native push notifications / permissions (in-app bell first).
- The "you saved N items / waste stats" reward screen (A3 captures the data; the payoff UI is a later pass).
- Any expiry-estimation ML work beyond what #3 covers.
