# PROTOTYPE — #273 guided cooking mode

Throwaway. Delete this folder once the verdict is captured and folded into #263.

**Question (#273):** What is "guided cooking" — the mode entered by "Cook with me"?
Decides the shape the rest of Spec A (#412) hangs off.

**Run:** `cd nextjs && npm run dev` → http://localhost:3000/cook-prototype
Switch variants: floating bottom bar, or `←`/`→` keys, or `?variant=A|B|C|D`.

## The five axes each variant answers

| Axis | A — Checklist column | B — One-step card | C — Hybrid strip+body | D — Chat-anchored sheet |
|---|---|---|---|---|
| **Step presentation** | All steps, one scrollable column; tap to check off | One full-screen step at a time, Next/Back | Pinned tappable step-strip + active body | Persistent bottom sheet over chat, Next/Back |
| **Deduction preview** | Collapsible header block (before steps) | Dedicated mise-en-place screen before step 1 | Inline per-step ("this step uses X") | In the sheet's raised/peek state |
| **Done-state** | Appears when all steps checked | Dedicated final screen | Footer "Finish" → done screen | Done state inside the sheet |
| **Recipe-card lock** | Locked card shown at top | (implied — flow replaces card) | (implied) | Card replaced by sheet |
| **Timers** | Placeholder chip on timed steps | Placeholder chip, centered | Placeholder chip inline | Placeholder chip in sheet header |

Placeholder timers are decoration only — real timers are #45 / Spec B. The axis
being tested is only *whether steps should carry a timer affordance at all*.

## Mock data
`mock.ts` — Creamy Tomato Pasta, 6 steps, deductions covering every match
status (clean / substitute / imprecise / assumed / missing-with-reason) so the
preview reads like the real cook flow.

## VERDICT (resolved 2026-09-13)

**Winner: Variant E — "Recipe-native card".** Composed from the best of the others:
- **B's** one-step focus, but in a **content-sized card** (not full-page) — short
  steps no longer sit in a void; real `instructions: list[str]` steps grow the card.
- **A's** check-off satisfaction — progress dots fill ✓ as steps complete.
- **C's** per-step ingredient list, reframed as **"You'll need"** (recipe language,
  not an inventory diff).
- **D's** intent (ask Bubbles mid-cook) as a **persistent per-step button** →
  chat overlay → returns to the same step. Chat always one tap away.

**Per-axis decisions:**
- **Step presentation:** one step at a time, content-sized card.
- **Deduction preview placement:** optional skippable **mise-en-place screen first**
  (before step 1), reusing the deduction list. Per-step "You'll need" repeats only
  the ingredients that step touches.
- **Pantry framing:** "You'll need" header; pantry subtraction shown as a grey
  sub-line **only when notable** (substitute / missing / approx). Clean matches get
  no sub-line. Missing carries a one-line reason.
- **Done-state:** dedicated done-screen, banner cleared on exit (#268).
- **Recipe-card lock (#269):** the flow replaces the card — strongest lock.
- **Timers:** **OUT of v1.** Chip shown to prove placement only; real timers = #45 / Spec B.

**E folds into #263 as single-dish** (no multi-dish plumbing now, by decision).

**Variant F — multi-dish meal (explores #289):** built to test whether E's idiom
survives the real two-dish Gemini meal (cumin potatoes + pork stir-fry, plated
together). It does — dish switcher + a **plating-timeline strip** carry the
cross-dish coordination. BubblyChef cannot represent this today (one flat
`RecipeCard`); that's **issue #289 / Spec B**. F is NOT folded — it informs how
#289 should be shaped. Findings captured on #289.

**Decision captured to:** issue #273 (verdict + this artifact), #289 (F findings).

