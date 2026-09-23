# Offline review notes — BubblyChef, 2026-09-21

**Written for you, to read on the plane with no GitHub and no network.** Everything
you need to decide is quoted inline. Nothing here asks you to open a link.

> **This is a point-in-time snapshot taken 2026-09-21.** Commit SHAs, PR counts and
> merge states below were true then and go stale as soon as anything merges. The
> *decisions* in §6 and §12 stay valid; the *numbers* do not. Re-check against GitHub
> before acting on any count.

Two sibling docs exist and are written for an *agent*, not for you:
`2026-09-20-autonomous-session-report.md` (what the run did) and
`2026-09-21-handoff-post-autonomous-batch.md` (how the next agent should pick it up).
This one is the decision surface. Where they disagree with this file, this file is newer.

---

## 0. The sixty-second version

An autonomous batch produced **11 new draft PRs**. All 11 are green. **None are merged.**
Nothing has shipped, so nothing is at risk — the whole batch is still reversible by closing it.

Three things actually need you:

1. **PR #475 must merge with a real merge commit, not a squash.** Six other PRs are
   branched off it — four directly (#479, #482, #484, #491) and two one level further
   down (#509 behind #479, #505 behind #491). A squash rewrites its commits and
   orphans all six. Retarget each child to `main` before merging it (see §3).
2. **PR #436 has developed a merge conflict** (this is new — it was clean yesterday).
   It blocks PR #492. Three real code files conflict. Details in §4.
3. **Five product calls were made by an AI standing in for you.** They are provisional
   and marked as such. If you disagree with any, the PR has to change. §6 lists them
   with the actual decision made, not just the issue number.

Everything else can wait until you land.

---

## 1. The repo right now, honestly

| | Count |
|---|---|
| Open PRs, total | **22** |
| ...from this batch | 11 |
| ...pre-existing, untouched by this run | 11 |
| Open issues | 101 |
| Branches merged to `main` this run | **0** |

`main` is at `9c02d37` and has not moved.

> **Correction to what I told you earlier:** I said "11 open draft PRs" in a status
> message. That was the batch's PRs only. The repo actually has **22** open PRs — the
> other 11 predate this run and I did not review them. §8 lists them so they aren't a
> surprise.

---

## 2. The dependency graph — read this before merging anything

This is the single most load-bearing fact in the whole batch. PRs are **stacked on each
other's branches**, not all on `main`. Merging out of order, or squashing, breaks them.

```
main
│
├── #475  claude/session-recovery-0sp6sv          ← LOAD-BEARING (4 PRs behind it)
│   ├── #479  fix/issue-476-vision-retry
│   │   └── #509  ← batch
│   ├── #482  collapse filled manual add rows
│   ├── #484  plain tab labels
│   └── #491  fix/issue-478-edit-modal-autocomplete  ← batch
│       └── #505  ← batch
│
├── #436  feat/issue-416-classifier-primary-routing   ← ⚠ CONFLICTED, 1 PR behind it
│   └── #492  ← batch
│
├── #486 #503 #504 #506 #507 #508 #511   ← batch, straight off main, independent
│
└── #124 #360 #421 #437 #452 #483        ← older, not reviewed this run
```

**What this means in practice:**

- **#475 and #436 are chokepoints.** Nine PRs total sit behind them.
- The seven batch PRs on the right (#486, #503, #504, #506, #507, #508, #511) are
  **independent**. You can merge those in any order, any time, with no coordination.
  If you want progress with zero thinking, merge those seven.
- **Squashing #475 or #436 will orphan their children.** GitHub will either show a
  huge bogus diff on the child or refuse it. Use a real merge commit.

---

## 3. Suggested merge order

Safe, boring, and each step is independently revertible:

1. **#511** (docs only — the three planning docs, including this file). Zero code risk.
2. **#507, #504, #503, #506, #486, #508** — independent, green, straight off main.
   #508 is the only one with a visual change you may want to eyeball first (§6).
3. **#475** — *real merge commit.* Then #479, #482, #484, #491 retarget to main
   automatically, then #505 behind #491, then #509 behind #479.
4. **#436** — only after resolving its conflict (§4) and after it has actually run the
   agent gates once (§5). Then #492.

---

## 4. ⚠ PR #436 is conflicted — new since yesterday

**PR #436**, *classifier-primary session routing + confirm band* — reworks how chat
decides which sub-workflow handles a message, and adds a confirmation band for
mid-confidence classifications. It is **+4281/−178 across 27 files**, and it is the only
PR in the repo that is **not a draft**.

It now conflicts with `main`. The conflict is in **three real code files**:

- `ai-service/bubbly_chef/config.py`
- `ai-service/bubbly_chef/workflows/recipe/nodes.py`
- `ai-service/bubbly_chef/workflows/router.py`

(A pile of binary conflicts also show up — those are just PNG screenshots under
`docs/media/`, and they resolve by picking either side.)

**Why this is awkward:** those three files are *exactly* the files PR #492 also touches.
So #492 will likely conflict too once #436 is resolved, and the resolution of #436
determines what #492's diff should even look like.

**I did not resolve it.** Resolving a 4,281-line router conflict by merge on your branch
is a judgement call about routing behaviour, not a mechanical fix — and #436 was already
on your decision list. It needs someone who knows which routing behaviour is intended to
win. Flagging rather than guessing.

---

## 5. PR #436 has never run the agent gates

#436's branch was cut **before** `.github/workflows/agent-gates.yml` existed. GitHub
Actions resolves workflow files from the **base** ref for some events and the head for
others, with the practical result that this branch has never once been through the
test-count guard, the fail-to-pass check, or the exemption check.

So **#436 is the least-verified PR in the repo despite being the largest and the only
non-draft one.** Merging `main` into it fixes both problems at once — it clears the
conflict and makes the gates run. Do that before trusting its green checks; right now
"green" mostly means "the gates never ran."

---

## 6. Decisions only you can make

These are the real content of this document. Each one says what was decided *on your
behalf* so you can ratify or reverse it.

### 6.1 — Five product calls made by an AI standing in for you

You asked for Fable to be used "as the human." It made these calls. All are **provisional**
and each is recorded in its PR. Reversing any of them means changing that PR.

| Issue | The question | The call that was made |
|---|---|---|
| **#489** *Spec A.1 — applied amendment must reach the deduction* | When you amend a recipe mid-cook, should the deduction use the amended recipe or the saved one? | **Amended.** The DB re-read was treated as the bug. |
| **#444** *pending pantry proposal lost on navigate-away* | Should an unconfirmed proposal survive navigation? | **Yes, persist it to the session.** Judged as data loss, not a fresh-start feature. |
| **#332** *the app is a hard login wall* | Ship a guest/demo mode? | **Escalated to you, not decided.** Code evidence suggests anonymous sign-in already exists. ⚠ See 6.2. |
| **#410** *Spec 0 — chat state machine* | How much of the typed-session foundation is in scope? | Decomposed into #487–#490 rather than built as one unit. |
| **#408** *brainstorm defaults to 'snack ideas'* | Is the welded-on framing a bug or a default? | **Bug.** Framing should not persist across follow-ups. |

**#489 is the one worth your attention.** It changes what gets deducted from your pantry
after cooking. If the call is wrong, the pantry silently drifts from reality — the exact
class of bug that is miserable to notice later.

### 6.2 — Confirm anonymous sign-in is actually on in production

Issue **#332** is **open**, labelled `ready-for-human`, and waiting on you. Code evidence
suggests anonymous sign-in is already supported, which would make the "hard login wall"
framing wrong — but nobody checked the **production Supabase dashboard** to confirm the
provider is actually enabled. Code support and an enabled provider are different things.

**Check the Supabase dashboard when you land.** If the provider is on, #332 can be closed
as already-satisfied. If it is off, #332 is a real piece of work and the code support is
dead weight.

> An earlier note of mine said #332 had been closed on code evidence. That was wrong —
> it is open. Nothing was closed prematurely; the decision simply hasn't been made.

### 6.3 — PR #508 is visual and nobody looked at it

**PR #508**, *line icons on quick-action cards, expandable daily tip* — swaps the
dashboard quick-action emoji for Phosphor line icons and makes the daily tip expandable.
+269/−34. It passes its tests, but **tests do not tell you whether it looks right**, and
the Sanrio/kawaii direction is a taste call that is yours. Nobody has rendered it.

### 6.4 — PR #491 deviated from a recorded decision

Issue **#478** said the `AddItemModal` autocomplete was broken. A previously recorded
decision said to **delete** `AddItemModal`. **PR #491 fixed it in place instead**
(+487/−219), because deleting it would have broken the pantry edit path that still
mounts it.

I think fixing was right. But it *is* a deviation from something you recorded, so you
should either ratify it or say the deletion still stands.

### 6.5 — Issue #474's direction

**#474**, *agent loop can't run in cloud sessions*, cannot be fixed as written. §7.

---

## 7. Agent loop: it cannot run in the cloud, and that is now provable

**The finding:** a Claude Code cloud session **cannot act as `bubblychef-bot`**, and no
token fixes it. The outbound HTTPS proxy **discards client credentials** to
`api.github.com` and injects the session's own identity. So any `gh` call from a cloud
session is attributed to the session, never to the bot — regardless of what you put in
`GH_TOKEN` or `GH_CONFIG_DIR`.

**Why it matters beyond the loop:** the bot identity was how the CODEOWNERS gate was
meant to be satisfied. If writes are attributed to you rather than a bot, a PR touching
a protected path can end up with you as its sole code owner, which **skips the review
gate entirely**. That is a review-integrity hole, not just an automation inconvenience.

**This invalidates issue #474's stated fix.** #474 says to supply the bot credential.
That is not achievable as specified. #474 needs a *direction* decision from you:

- **(a)** accept that the loop is laptop-only and document it that way, or
- **(b)** move the loop to a runner that isn't behind the credential-replacing proxy
  (a GitHub Action, or your own machine), or
- **(c)** drop the bot identity requirement and rethink the CODEOWNERS gate.

**PR #486** does the honest partial thing: it makes the loop **detect this and stop in
Preflight with a clear message**, instead of running and silently attributing work to the
wrong identity. It deliberately does **not** close #474, because the credential half is
unachievable and the direction is yours. +150/−15, mostly test coverage of the new stop
branches.

---

## 8. The 11 pre-existing PRs I did not touch

Not reviewed this run. Listed so they aren't a surprise, oldest first:

| PR | What it is |
|---|---|
| **#124** | *docs: gamification + live kitchen plan* — the design doc for the decoration feature. Previously held as high-risk / not-MVP. |
| **#360** | *render 'Update what I'm cooking' block for recipe amendments* — overlaps #489's territory; check for conflict. |
| **#421** | *docs: architecture explainer* — two services, one database. |
| **#436** | *classifier-primary routing* — see §4, §5. Conflicted, non-draft, gates never ran. |
| **#437** | *first-run coach-mark guided tour* — onboarding. |
| **#452** | *pass encoding="utf-8" on every text file read/write* — small correctness sweep. |
| **#475** | *nine queue issues in one PR* — the load-bearing one. §2. |
| **#479** | *retry transient Gemini vision failures* — stacked on #475; #509 sits behind it. |
| **#482** | *collapse filled manual add rows into summaries* — stacked on #475. |
| **#483** | *idempotent backfill for rows missing an expiry date* — touches data; worth real review. |
| **#484** | *plain tab labels, Type renamed to Manual* — stacked on #475. |

**#483 is the one I would read carefully.** A backfill writes to every pantry row missing
an expiry. It claims idempotence. That claim is worth verifying before it runs against
real data — it is the only PR in the repo that mutates existing user rows.

---

## 9. The batch: what each PR actually does

All 11 are green and draft. "Fixes" means the issue auto-closes on merge.

| PR | Size | Closes | What it actually does |
|---|---|---|---|
| **#486** | +150/−15 | *(none — deliberate)* | Makes the agent loop stop in Preflight when it can't act as the bot, rather than running under the wrong identity. §7. |
| **#491** | +487/−219 | **#478** | Pantry edit modal's ingredient autocomplete was wired to the wrong response shape and silently returned nothing. Fixed, and its writes now go through the API client instead of ad-hoc fetch. See 6.4. |
| **#492** | +528/−10 | *(none — half)* | Chat was offering **expired and zero-quantity** pantry rows as available stock. Adds a `stock.py` domain filter. Only half of #443 — the other half is in #436, so no closing keyword. |
| **#503** | +233/−22 | **#487** | The chat recipe-amendment proposal wasn't in the discriminated proposal union, so it round-tripped as the wrong type. Adds the discriminator + a round-trip test. |
| **#504** | +110/−13 | **#417, #376** | `get_recipe` claimed a return type it didn't honour. Declares the honest dict contract and fixes the three call sites. |
| **#505** | +259/−260 | **#397** | Removes the kitchen-location field from every UI surface. Net-zero size because it's mostly deletion + test rewrites. |
| **#506** | +714/−13 | **#498** | Follow-up chips under a chat reply are now generated from the actual reply, with the old static list as fallback. |
| **#507** | +159/−3 | **#477** | `stack.sh down` left the frontend running, then warned about it as if it were someone else's process. Cause was **not** what the issue said — see §10. |
| **#508** | +269/−34 | **#391** | Dashboard: Phosphor line icons + expandable daily tip. Visual, unreviewed — 6.3. |
| **#509** | +642/−3 | **#481** | Receipt scan budget now covers the **whole request**, not just the vision leg, so the text-parse step can't blow the 45s deadline on its own. |
| **#511** | +556/−0 | *(docs)* | The three planning docs, this file included. |

---

## 10. Six issues were wrong, and were caught before becoming code

Worth knowing because it says something about the issue backlog's reliability — roughly
a third of what the agents picked up had a wrong premise in the ticket:

- **#477** blamed `stack.sh` logic. Real cause: `lsof` can't parse the Next.js process
  title, because the kernel truncates `comm` to 15 characters and the title is
  `next-server (v16.2.2)`. Fixed by reading `/proc/net/tcp` directly.
- **#478** said to delete `AddItemModal`. Deleting it breaks the still-live pantry edit
  path. Fixed in place instead.
- **#443** was written as a single defect. It is two unrelated ones.
- **#487** said there was one emit site. There were several.
- **#498** was scoped as a Node-only change. It needed backend changes too.
- **#481** assumed a per-leg timeout was the fix. A per-leg timeout can't bound total
  wall-clock; it needed a single budget enclosing retries **and** provider fallback.

**Takeaway for the backlog:** the `ready-for-agent` label is not trustworthy on its own.
**41 open issues carry it**, and a large share of those are **already covered by an open
PR** (my earlier estimate was ~24; I did not re-verify that number, so treat it as an
order-of-magnitude claim, not a count). An agent picking by label alone will redo finished
work. Re-triage before the next run.

---

## 11. Things I got wrong this session

For calibration — take the rest of this document with the appropriate amount of salt:

- I **claimed GitHub Actions had stopped running repo-wide.** It hadn't. I queried the
  checks API ~20 seconds after a push, before runs register, and read an overnight gap
  (just nobody pushing) as a fault. Corrected in commit `0d06704`.
- I **said "11 open PRs"** when the repo has 22. The 11 was my batch. Corrected in §1.
- I **over-escalated nine issues** to `ready-for-human` without attempting them, which
  is the opposite of what you asked for. Un-escalated five (#443, #417, #284, #444, #337).
- I **wrote a false claim into my own PR #486 body** — said a code path was unreachable
  when it is live on a laptop with apt's gh 2.45.0. Fixed, and two tests now pin it.
- I **appended to `docs/agents/lessons.md`**, which that file explicitly forbids agents
  from doing. Reverted; lessons now ride in PR bodies instead.
- I ran **`npx prettier --write` with no repo config**, which reformatted a whole file
  from single to double quotes — 144/108 lines of churn for a 10-line change. Redid by
  hand: 12/14.

---

## 12. If you only do three things on the plane

1. **Decide #489** (6.1) — it changes what gets deducted from your pantry. Wrong answer
   means silent pantry drift.
2. **Decide #474's direction** (§7) — (a) laptop-only, (b) different runner, or
   (c) drop the bot identity. Everything about the loop's future waits on this.
3. **Skim PR #483** (§8) — the only PR that writes to existing user rows.

Then when you land: check anonymous sign-in in the Supabase dashboard (6.2), and eyeball
PR #508 (6.3).

---

## 13. Nothing is merged

Worth repeating, because it changes how much any of this matters. `main` is untouched.
Every one of the 22 PRs is revertible by closing it. If the whole batch is wrong, closing
11 PRs costs nothing but the tokens already spent. Decide accordingly — this is a review
of proposals, not of anything live.
