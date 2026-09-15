# Manual test plan + forward sequence

**Written:** 2026-09-15 · state verified against live GitHub, not `docs/QUEUE.md`

This replaces the "Spec 0 and Spec A should be done" impression. Neither is.
Spec A closed its front half; its back half is untouched. Spec 0's foundation
landed but its user-facing stories are failing in a browser.

The ordering principle throughout: **merged code that doesn't work outranks
code that was never written.** A shipped feature that fails in the app costs
more than a missing one, because it has already spent the reviewer's trust.

---

## Where things actually stand

### Landed and real

- **Spec 0 foundation** — issues #413 (typed proposal union + `CookProposal`),
  #414 (typed `SessionContext`, no more `dict[str, Any]` blobs), #415 (pin the
  picked recipe by real id), #375.
- **Spec A front half** — issues #273 (the cook-flow prototype; its output is
  `nextjs/src/app/cook-prototype/VariantA–F.tsx`), #263 (guided step-by-step
  cooking), #264 (expired-ingredient pre-cook warning), #209 (unit-conflict
  soft fallback + assume basic seasonings), #424, #425, #426.

### Open PRs

| PR | What it is | State |
|---|---|---|
| **#436** — *feat(router): classifier-primary session routing + confirm band* | Closes issues #416 and #266. Chat routes by classifier instead of a hardcoded mode→intent table; adds the one-tap confirm band; refines a pinned recipe in place instead of generating an unrelated dish. | Open, non-draft, awaiting the human thermo gate |
| **#437** — *feat(onboarding): first-run coach-mark guided tour* | Closes issue #390 (blank guest greeting, no onboarding, no route to profile). | Draft |
| **#360** — *feat: render "Update what I'm cooking" block* | Issue #303. Merges clean (zero conflicts, all gates green) but **lands dead** — see Phase 3. | Draft |
| **#421** — *docs: architecture explainer* | Docs only, CI green. | Draft |
| **#124** — gamification plan | Held deliberately. | — |

### Found by a real browser, not yet fixed

Seven issues filed 2026-09-14 (#438–#444). Three cite spec story numbers:

- **#442** — re-picking a brainstormed idea by name selects the wrong dish or
  regenerates it — **Spec 0 story 9**
- **#444** — a pending pantry proposal is lost on navigating away and back,
  never persisted to the session — **Spec 0 story 13**
- **#440** — the COOKING banner lingers after a finished cook and allows a
  second deduction of the same recipe — **Spec A stories 4 and 5**
- **#441** — the guided cook session is lost on reload; step position and
  banner both vanish
- **#443** — recipes recommend expired, zero-quantity pantry items as "fresh",
  and ignore the ingredient the user asked for
- **#439** — AI-estimated expiry dates are stored as user-supplied, so the
  "(est.)" marker never appears
- **#438** — flaky chat-deep-links test

---

## The sequence

### Phase 1 — Land #436 (unblocks the most, costs the least)

PR #436 closes issues #416 and #266 (*follow-up on a selected recipe restarts
brainstorm instead of modifying it* — the founding bug of Spec 0), and fixes
half of issue #443: `preferred_ingredients` was extracted from the user's
message but never reached the generation prompt, which is why asking for tomato
got you buttered rice.

The merge gate is human-only (`thermo-nuclear-review`, `WORKFLOW.md` §7) because
`main` auto-deploys. Run it against the **current** head — markers are per-commit
and every push re-arms the gate.

**Do not skip the manual pass in Phase 1's test plan below.** This branch was
already caught once with green gates and a real regression: the widened re-pick
shortcut was routing *"how many eggs do I need"* to a recipe card.

### Phase 2 — Fix the regressions on freshly-merged work (#440, #441)

Issues #440 and #441 are failures in PR #431's guided cook flow, merged hours
earlier. #440 is the serious one: **the banner lingering and permitting a second
deduction means a user can deduct the same recipe from their pantry twice.**
That is data loss, and it defeats Spec A stories 4 and 5 — the clean done-state
and the recipe-card lock, which were the two things that flow existed to deliver.

Fix these before building anything new. They are regressions on code that is
already in production.

### Phase 3 — Unblock the amendment path (the real Spec A blocker)

Spec A stories 6, 7 and 8 are blocked, and **PR #360 is not the blocker** —
two things underneath it are.

**3a. File and fix the envelope gap.** `create_general_chat_envelope`
(`ai-service/bubbly_chef/workflows/shared_state.py:271`) hardcodes
`proposal=None`, `requires_review=False`, `next_action=NONE`. It does not even
accept a proposal parameter. `_detect_amendment` sets `state["proposal"]`, and
the envelope discards it on the way to the browser. The only override in
`router.py` (~:1702) is for `CONFIRM_CHOICE` — the code comment says so outright.

So PR #360's render gate (`requires_review && next_action === 'review_proposal'`)
can never be satisfied. **This is not rebase drift** — it was equally true when
the branch was written. PR #355 landed the detection node and never the envelope
plumbing, and the backend tests assert on the workflow *state dict*, not the
envelope, which is why nobody caught it.

**3b. Decide the apply write path.** Issue #412 reserved this and forbids
silently mutating a saved library recipe: does confirming an amendment PATCH a
draft row, or the pinned cook-session row? Nothing downstream can be built
correctly until this is settled.

Second-order problem to settle with it: even if the card rendered, confirming
mutates React state, while "Finished cooking" passes only `recipeId` and
`recipes_ai.py:207` refetches from the DB. The amended list never reaches the
matcher, so issue #279 stays open regardless.

**Then** land PR #360. The branch is already current — 34 commits behind, not 65;
PRs #420 and #422 are already ancestors; zero merge conflicts; `tsc` clean,
`jest` 422/422, `eslint` 0 errors. Its card component and 8 tests are good work
worth keeping. Only the ~63 lines of `chat/page.tsx` wiring need rewriting,
against the contract 3a creates.

*(The `cde66fa` → `0e68d63` revert that stalled this PR is settled: `cde66fa`
was a single-parent commit straight onto `main`, reverted 4 minutes later. An
accidental direct push, not a rejection of the code.)*

### Phase 4 — The proposal-persistence cluster (probably one root cause)

Four issues that look separate and likely are not:

- **#311** — high-confidence proposals (`requires_review: false`) render a card
  whose approve button silently no-ops. Cause already identified at
  `nextjs/src/hooks/useChat.ts:426-443`.
- **#358** — unapproved pantry proposal cards vanish from chat history after
  navigating away and back.
- **#444** — a pending proposal is never persisted to the session (story 13).
- **#442** — re-picking a brainstormed idea selects the wrong dish (story 9).

`useChat.ts`'s history restore hardcodes `requires_review: false,
next_action: 'none'` on every restored turn. Investigate these together before
assigning them separately — fixing one may close three.

This is Spec 0 stories 9, 12 and 13, i.e. the last user-facing part of Spec 0.

### Phase 5 — Spec 0's remaining contract work

- **#417 / #376** — `get_recipe` declares `-> RecipeCard | None` but returns a
  raw dict, and every caller carries a `type: ignore` workaround. The decision
  is already made (honest dict, not parsing to `RecipeCard`). Pure cleanup, no
  user-visible behaviour, safe to defer but cheap to do.
- **#408** — recipe brainstorm defaults to "snack ideas" when no dish type is
  given, and welds that framing onto every follow-up.

### Phase 6 — Spec A's back half

In the order issue #412 specifies:

- **#281** — *"Not in pantry" is a dead end* (stories 13, 15). Three separable
  parts: compound substitutions expressible in the schema, say *why* when
  there's no substitute, and separate "missing" from "assumed".
- **#222 + #298** — piece-unit deduction. ADR 0003 governs and is decided: a
  piece against a package is incommensurable, so it reports `imprecise`
  (satisfied, nothing deducted, row stamped) rather than destroying the package.
  #222 stays open until #298's stamp column lands. **Do not re-litigate the ADR.**
- **#284** — deduct compound substitutions, not just suggest them. Has an
  unsettled design question on per-component quantities; issue #412 recommends
  treating compound swaps as always-unresolved and reusing the existing
  unit-conflict input path.

### Phase 7 — Only then, Spec B (#418) and Spec C (#435)

Both are `ready-for-agent` and can run in parallel once Spec A closes.

---

## Manual test plan

Run both services. `nextjs/.env.local` and `ai-service/.env` must be populated —
`CLAUDE.md` lists every key. Note the trap: Next.js spells the credential
`SUPABASE_SERVICE_ROLE_KEY`, ai-service spells the same thing
`BUBBLY_SUPABASE_SECRET_KEY`, and the ai-service config model forbids unknown
keys, so a typo kills the service at import with `extra_forbidden`.

```bash
cd nextjs && npm run dev                                      # :3000
cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888
cd ai-service && ./.venv/bin/python -m pytest -q              # venv, not system pytest
```

**Keep `tail -f` on the ai-service log in a second pane.** Most of Phase 1 is
routing behaviour, and the log tells you which LangGraph node a turn actually
hit. That is the difference between a useful bug report and "chat seemed weird".

**Check issue #407 first** — *ai-service/.env pins gemini-2.5-flash, silently
overriding PR #374's gemini-3.1-flash-lite default*. If your local `.env` still
pins the old model, you are testing a different model than production runs, and
every AI-quality judgement below is against the wrong thing.

---

### Test set 1 — PR #436, before you merge it

On branch `feat/issue-416-classifier-primary-routing`.

**1.1 Refine in place (Spec 0 stories 1, 2).** Ask for "a recipe for creamy
garlic spaghetti". Then send "make it spicier". Then "add a fig glaze?" — a
modification phrased as a question, the case a brittle prefix list used to miss.
*Expect:* the same dish, modified, replacing the card in place with the same
identity. *Wrong:* a new unrelated dish, a second card alongside the first, or a
restarted brainstorm. Confirm in the log that the turn hit the refine node, not
`generate_grounded_recipe`.

**1.2 The re-pick shortcut does not hijack ordinary turns (regression, fixed —
verify it holds).** After a brainstorm, with ideas on screen and nothing pinned
yet, send each of these. **None may produce a recipe card:**
- "how many eggs do I need"
- "is any of this gluten free"
- "add tomato soup to my pantry" — must be a pantry update
- "I bought chicken curry paste" — must be a pantry update

**1.3 Genuine re-picks still work (Spec 0 stories 9, 10).** From the same
brainstorm: "show me the pesto one instead", "the second one". *Expect:* the
right dish, resolved from the ideas already on screen, **with no regeneration**
— watch the log, a regeneration is a failure. Then run a genuinely new
brainstorm and confirm the old idea set is gone, so you cannot re-pick from a
stale menu. Cross-check against issue #442, which reported exactly this broken.

**1.4 Stale pin does not hijack a fresh pick.** Pin a recipe, ask "what else
could I make?", then pick one of the *new* ideas. *Expect:* the new dish.
*Wrong:* your original dish "refined" toward the new one.

**1.5 The confirm band (Spec 0 stories 5, 6).** On an ambiguous follow-up,
expect a one-tap "tweak this / start fresh" rather than a guess. Then: pick a
recipe, run a new brainstorm, and send an ambiguous follow-up. The band must
**not** offer "Tweak this recipe" when there is no longer a picked recipe —
and if it does appear, tapping it must not dead-end in generic chat.
*Judgement call worth recording:* is the band tuned right? Constant asking on
obvious modifications is annoying; never asking means it is guessing. The cutoff
was left to be tuned in implementation and nobody has felt it in a real session.

**1.6 Start over.** The affordance must be present at any point and must
guarantee a fresh brainstorm regardless of classifier confidence.

**1.7 #408 did not regress.** Ask "give me a pad thai recipe" — a high-confidence
generation must be served as one single new recipe, not downgraded to a brainstorm.

**1.8 Requested ingredients reach the model (half of #443).** Pin a recipe, then
"something with tomato flavor instead". Tomato must actually appear. The other
half of #443 — expired, zero-quantity pantry items recommended as fresh — is
**not** fixed by this PR; expect it to still fail.

### Test set 2 — Phase 2 regressions (#440, #441)

**2.1 Clean done-state (#440, Spec A story 4).** Cook a recipe through the
guided flow to "Finished cooking". *Expect:* the COOKING banner clears and the
mode exits. *Wrong:* the banner lingers.

**2.2 No double deduction (#440, Spec A story 5).** After finishing, try to cook
the same recipe again. *Expect:* the source recipe card is locked and a second
deduction is impossible. **Then open `/pantry` and verify quantities were
deducted exactly once.** This is the data-loss case — it matters more than
anything cosmetic in this plan.

**2.3 Reload mid-cook (#441).** Start a guided cook, advance two or three steps,
refresh the page. *Expect:* your step position and the COOKING banner both
survive. *Wrong (current):* both vanish.

**2.4 While you are in the flow**, confirm the rest of story 1: you can go back
a step, and the final step has a real done action rather than a dead end.

### Test set 3 — deduction correctness (already merged, never browser-tested)

**3.1 Unit mismatch must not corrupt stock (#209 / PR #430).** Recipe wants
"2 cups rice", pantry holds "1 kg rice". Cook it, confirm, **then open `/pantry`
and check the number actually left.** A silently wrong quantity here destroys the
user's data with no error surfaced. Highest-risk item in this document after 2.2.

**3.2 Seasonings assumed (#209 / #426).** Cook something needing salt, pepper or
oil. They must not be reported as blocking shortfalls.

**3.3 A small use must not destroy a package (#222 / ADR 0003).** Cook "4 slices
bread" against a one-loaf pantry row. *Expect:* `imprecise` — ingredient
satisfied, **nothing deducted**. *Not* a shortfall, and above all not the whole
loaf removed. Read ADR 0003 before judging; this behaviour is deliberate.

**3.4 Expired warning (#264 / PR #429).** Put a deliberately expired item in the
pantry, use it in a recipe, hit cook. *Expect:* a warning and an offer to clear
it. *Wrong:* no warning, a warning that blocks with no way past, or one firing
on non-expired items.

**3.5 No substitute → a reason (#425).** When nothing can stand in, expect a
one-line explanation, not a bare warning chip.

**3.6 End to end (Spec A story 17).** Generate a recipe → cook → mark cooked →
confirm → verify the pantry in **both** directions: what you used went down by
the right amount, and what you did not use is untouched.

### Test set 4 — the proposal cluster (Phase 4, expect failures)

These are known-broken; the goal is characterising them, not discovering them.

**4.1 (#311, story 12)** Say "I bought apples". If the card renders with
`requires_review: false`, tap approve and check whether the pantry actually
updated.

**4.2 (#358, #444, story 13)** Get a proposal card, navigate to `/pantry`, come
back to `/chat`. *Expect (spec):* still there, still actionable. *Expect
(reality):* gone. Note precisely what survives and what does not — that detail
is what makes the shared root cause findable.

### Test set 5 — never verified at all

- **#366** — real OpenFoodFacts barcode lookup. **Its live API has never been
  called once**; the cloud sandbox could not reach it. Scan a real barcode.
- **#371** — the `/scan` route and the pantry sheet's scan tab (`/pantry?add=scan`)
  now share one review component. **Test both** — the whole risk of that refactor
  is that they diverge.
- **#374** — the live model swap to `gemini-3.1-flash-lite`. Nobody has compared
  real output before and after. Judge quality directly: coherent recipes, sensible
  chat, correct receipt parsing. See the #407 warning above first.
- **#368** — the shared modal focus trap. Keyboard-only pass: Tab must not escape
  an open modal, Escape closes it, focus returns to the opening button. **Test in
  Safari and Firefox**, not just Chrome — neither natively focuses a clicked
  button, which is exactly where this broke before.

---

## Working rules

Test as a cook would, not as a checklist. Start with an empty pantry and a fresh
session and actually try to make dinner. The last local session filed 15 real
bugs (#390–#406) and most only appeared when steps were strung together.

Capture evidence into `docs/media/`, named for the issue. A PR body here has to
be approvable without opening the diff, and visual evidence is what makes that
possible — it is the one artifact no cloud session can produce.

File findings as issues tied to the spec and story they violate ("Spec A story
9"). Follow `CLAUDE.md`'s citation rule: issue-or-PR, title, and a plain-language
line on what it means. Bare numbers are not acceptable.

Do not fix what you find, with one exception: a one-line obvious fix is fine if
you also write a regression test. Opening a PR needs a `/code-review` marker;
merging needs `thermo-nuclear-review`, which is human-only because `main`
auto-deploys. Browser time is the scarce resource — every minute spent fixing is
a flow left untested.
