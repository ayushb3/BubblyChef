# Autonomous session report — 2026-09-20

**Session:** Claude Code cloud, 06:41 → 09:07 UTC
**Output:** 10 draft PRs (all green), 15 issues filed, 2 closed, 0 merged
**Model:** Opus orchestrating, Fable implementers/triage (15 dispatches)

This doubles as the handoff for the next session. It supersedes nothing; the
2026-09-19 handoff (`session_01TzwhqpuA8tMPa5gK2soT8J`) is still accurate on the
agent loop's laptop-only status, which this session confirmed and explained.

---

## 1. The headline: the loop cannot run in cloud, and no token will fix it

The previous session filed [#474] believing the blocker was a missing
`bubblychef-bot` credential. **It isn't.** The session proxy *replaces* GitHub
credentials in transit:

```
$ curl -H "Authorization: Bearer ghp_totallyFakeToken000…" https://api.github.com/user
{ "login": "ayushb3", … }

$ curl https://api.github.com/user          # no Authorization header at all
{ "login": "ayushb3", … }
```

A forged token and *no* token both authenticate as `ayushb3`. A bot PAT delivered
as an environment secret would be written to disk, read by `gh`, sent, and
**discarded in transit** — while the provisioning hook reported success and every
PR silently skipped code-owner review.

Two further cloud blocks found on the way:

- **The kill switch is unreadable.** The proxy 403s every `/actions/*` path, so
  `AGENTS_ENABLED` cannot be read from a cloud session by any route.
- **apt's `gh` is 2.45.0**, which has no `gh variable get` — the subcommand the
  kill-switch read depends on. `gh` itself installs through the proxy fine.

**Do not spend another session building token plumbing for cloud.** The surviving
options are on [#474]; the recommendation is to move the protected-path gate off
authorship onto a required status check, so authorship stops being a security
property.

---

## 2. What went well

**Briefs that said "the issue may be wrong" paid for themselves.** Six premises
turned out false — see §4. The most valuable single output was an agent
*declining* its instruction.

**Stacking on the correct base.** Every PR branched off whatever open PR it
actually depended on (#475, #479, #436, #491) rather than `main`, so nothing
conflicts at merge time. Merge order matters — see §6.

**Gates re-run on the settled tree.** Every gate claim in an agent report was
re-run by the orchestrator on the pushed commit. Two reports would otherwise have
been misleading.

**Triage refused to manufacture work.** Spec C and Spec 0.5 decomposition filed
**zero** tickets, because every story already mapped to an existing issue or open
PR. That is the right answer and it was said plainly.

## 3. What went wrong

**3 of 15 agents died silently** — no commit, no report, 60+ minutes. Cause was
almost certainly environment setup: agent worktrees start with **no
`node_modules` and no venv**, and the first briefs didn't say so. Both re-runs
*with* that warning succeeded. Mitigations for next time:

- Tell every implementer brief: worktrees start bare; symlink
  `nextjs/node_modules` from the main checkout (gitignored, lockfile-identical);
  build `ai-service/.venv` from `.[dev]`, **not** `requirements.lock` (numpy pin
  conflict).
- Tell them to **commit early and often** — a WIP commit is fine. The one death
  whose work survived did so only because a stop hook forced a checkpoint.
- Detect death: a long gap with no notification means dead, not busy. Check
  `git log` on the agent's branch rather than waiting.

**CI turned red twice, both orchestrator error.** Once by not running the loop's
own `agent-loop-harness.cjs` before pushing; once by running `npx prettier` with
no repo config, which defaults to double quotes and rewrote a single-quote file —
144/108 churn for a 10-line change.

**Over-escalation.** Nine issues were relabelled `ready-for-human` without any
attempt. Several were real agent work. Try first; escalate when genuinely stuck.

**Two agent outputs needed correcting:** one swapped the commit attribution line
to its own model name; #397 kept test names verbatim to dodge the count guard,
leaving tests called *"renders one toggle per shared location"* asserting that no
toggle exists.

---

## 4. Premises the issues got wrong

| Issue | The issue said | What was true |
|---|---|---|
| #478 | "delete `AddItemModal`" | It is the **only** edit/delete UI for pantry items — sole caller of `PUT`/`DELETE` on `/api/pantry/[id]`. Deleting it makes every pantry card a dead button. Agent **refused**. |
| #477 | "`up` records the launcher pid" | It already records the listener. Real cause: the kernel truncates `next-server (v16.2.2)` to `next-server (v1`; the unbalanced paren makes **lsof 4.95 drop the process silently**. |
| #443 | one defect | Also `days_until_expiry <= 3`, which is *negative* for past dates — expired food was being **promoted** into "EXPIRING SOON (use first!)". Two copies of that predicate. |
| #487 | one emit site | **Two** (single-shot and ReAct paths). |
| #498 | "populate the field in the node" | `/v1/chat/stream` **never runs the chat nodes** — it builds its own prompt and envelope. Node-only changes pass every test and never reach the UI. |
| #481 | per-leg timeout | A per-attempt timeout is **not a budget when the caller retries**: `AIManager.complete` runs up to 3 attempts *and* falls back to Ollama (120s). |
| #397 | "location is presentational" | `domain/expiry.py` scales shelf-life by `LOCATION_MODIFIERS` — `freezer: 6.0`. Dropping it everywhere would make frozen peas expire in ~7 days instead of ~42. |

---

## 5. Cost

Delegated agent compute: **1.83M tokens / ~81 min** across 13 reporting agents.
Wall clock 2h26m; parallelism is why those differ.

| Agent | Tokens | Time | Tools |
|---|---:|---:|---:|
| Specs 0.5/B/C triage | 240,202 | 8m37s | 83 |
| Spec 0/A triage | 202,676 | 6m57s | 49 |
| #397 kitchen-location | 191,174 | 9m39s | 44 |
| #498 chips | 159,857 | 10m53s | 51 |
| #481 scan budget (v2) | 153,869 | 9m47s | 33 |
| Product-owner stand-in | 143,576 | 5m16s | 46 |
| #478 edit modal | 130,147 | 6m39s | 47 |
| #443 expired items | 125,277 | 7m06s | 32 |
| #391 polish (v2) | 121,284 | 5m42s | 23 |
| #487 proposal union | 121,110 | 5m38s | 49 |
| #417 honest dict | 90,491 | 3m27s | 27 |
| `/code-review` standards | 76,379 | 0m51s | 9 |
| `/code-review` spec | 70,972 | 0m43s | 8 |
| **Reported total** | **1,827,014** | **~81m** | |
| #477 v1, #391 v1, #481 v1 | *died — never reported* | | |

Implementation 60%, triage 24%, product decisions 8%, review 8%.

**PR cadence:** #486 06:47 · #491 07:16 · #492 07:19 · #503 07:25 · #504 07:30 ·
#505 07:32 · #506 07:38 · **74-minute gap** · #507 08:52 · #508 08:59 · #509 09:04.

That gap is the cost of the silent deaths — nothing was running and nobody knew.

---

## 6. The PRs, and the order to merge them

**Merge #475 first, with a real merge commit, not a squash.** Six of these are
stacked on it or on branches stacked on it; a squash breaks their history.

| PR | Closes | Base | What it does |
|---|---|---|---|
| #486 | Related #474 | `main` | Preflight probes GitHub identity **first** and hard-stops unless `bubblychef-bot`. Separates a *failed* kill-switch read from the switch being *set*. Clears `GH_TOKEN`/`GITHUB_TOKEN` in every `AS_BOT` command — `gh` reads those ahead of `GH_CONFIG_DIR`, so this was latent on the laptop too. |
| #491 | Fixes #478 | #475 | Fixes the autocomplete by reusing `FoodAutocomplete`; removes the genuinely-dead add branch; moves `PUT`/`DELETE` into `lib/api/pantry.ts`; folds three drifted `LOCATIONS` copies into one. **Deviates from the recorded "delete it" decision** — see §4. |
| #492 | Related #443 | #436 | One domain rule (`domain/stock.py`) at every pantry→prompt read; fixes the `days <= 3` sign bug. Five named tests pin that "expires tomorrow" is still prioritised. No closing keyword — the other half of #443 is in #436. |
| #503 | Fixes #487 | `main` | Discriminated `proposal_type` for the chat amendment at **both** emit sites; two `type: ignore`s removed; a test pins that the old undiscriminated dict is now *rejected*. |
| #504 | Fixes #417, #376 | `main` | `get_recipe` declares the dict it returns. Three workarounds removed. `dict[str, Any]` over a TypedDict — the latter needs a new `cast()` and duplicates the schema. |
| #505 | Fixes #397 | #491 | Location gone from every UI surface; column untouched (has a DEFAULT, no migration). Scan/chat still forward it for the expiry heuristic. Needs `test-removal-approved` (applied). |
| #506 | Fixes #498 | `main` | Follow-up chips from the reply, wired into the nodes **and** the streaming path. Validation consumer-side, never throws on junk. |
| #507 | Fixes #477 | `main` | `/proc/net/tcp` lookup on Linux instead of lsof. F2P test verified failing on base by hand. **macOS still falls through to lsof** — if its lsof shares the limitation, the bug persists there. |
| #508 | Fixes #391 | `main` | Phosphor icons (already in `package.json` via the bottom nav — no new dependency); two distinct tip pills; "Read more" only when the text actually overflows. |
| #509 | Fixes #481 | #479 | One 40s server budget both legs draw down from, capped by a single `asyncio.wait_for` enclosing all retries and the Ollama fallback. Worst case asserted from live `Settings` defaults. |

**Every PR is authored by `ayushb3`, so the CODEOWNERS gate does not fire on any
of them.** #486 touches `.claude/`, #505 and #491 touch pantry code. Review
deliberately rather than relying on the gate.

**Nothing visual was rendered.** #508 especially is pure polish with no
screenshots — no agent had a browser.

---

## 7. Issues filed, and why

**Spec 0 / Spec A** — both were already sliced in prose on 2026-09-14 and never as
sub-issues; most slices had shipped. Four real gaps remained:

- **#487** — `CookProposal` closed story 15, but that is the *cook* proposal;
  chat emits an untyped dict. *(now PR #503)*
- **#488** — PR #436 landed `forced_intent` and explicitly skipped the
  `[Start over]` / `[Edit this recipe]` chips.
- **#489** — PR #360's body claims the deduction uses the amended list. **It does
  not**: `cookRecipe(recipeId)` re-reads the stored row. Commented on #360.
- **#490** — an applied amendment dies on reload; `cook-session.ts` persists only
  `{recipeId, step}`.

**Spec B** — #493–#502, ten vertical slices. #500 deliberately owns the **single**
migration for all five of #395's columns so CODEOWNERS reviews once.

**Spec C and Spec 0.5** — zero filed. Everything already had an issue or PR.

**From #481's implementation:**

- **#510** — a parse failure returns `200` with zero items and empty `warnings`,
  **byte-identical to a receipt that genuinely had nothing on it**. The naive fix
  (forward `errors`) leaks provider strings and re-opens #396, so it needs its own
  user-safe surface.

**Closed:** #358 (duplicate of #444, after carrying its reproduction and
acceptance criteria across).

**Not closed, contrary to an earlier draft of this report:** #332. The call was
that guest mode already ships (`middleware.ts:59` calls `signInAnonymously()`),
but the issue was only relabelled `ready-for-human` — it is still open, and the
production toggle was never verified.

---

## 8. Gate mechanics learned the hard way

- **`test-removal-approved` applied *after* opening a PR does nothing.**
  `agent-gates.yml` reads labels from the **frozen event payload**; a re-run
  replays the same payload, and the workflow triggers on
  `opened`/`synchronize`/`reopened`, not `labeled`. Only a new push clears it.
  Label before opening.
- **The `no-f2p` exemption only covers docs-only diffs.** `exemption-check.sh`
  fails the PR if the diff touches code. It is not an escape hatch for "this is
  hard to test".
- **PR #436 has never run the agent gates at all.** Its branch predates
  `agent-gates.yml`, and GitHub resolves `pull_request` workflows from the *base*
  ref — so the jobs are never scheduled and the PR looks green with 5 checks
  instead of 10. Merge `main` into it before merging it.
- **`mypy_gate.sh` reports `fixed: 0` when you remove a `type: ignore`.** A
  suppression was never a baselined error. Don't read that as "no effect" and
  don't `--sync` the baseline for it.

---

## 9. Lessons proposed for `docs/agents/lessons.md`

`lessons.md` forbids direct agent appends — these are proposed here for the
nightly job, per that file's own rule.

**Git and GitHub**

- A cloud session cannot be anyone but `ayushb3`; the proxy discards client
  credentials. Don't build token plumbing for it.
- `gh` reads `GH_TOKEN`/`GITHUB_TOKEN` ahead of `GH_CONFIG_DIR` — an ambient
  token silently outranks the bot config dir while the command still *looks* like
  a bot command.
- Ubuntu apt ships `gh` 2.45.0, which has no `gh variable get`. The Actions REST
  API is no substitute in cloud: the proxy 403s every `/actions/*` path.

**Tests and gates**

- Run `scripts/agent-gates/agent-loop-harness.cjs` before pushing any
  `agent-loop.js` edit; its mock returns `'none'` for unknown labels, so a new
  stage fails its own gate and collapses every downstream assertion.
- Keeping a test's name while inverting its body to dodge the count guard leaves
  a passing test that lies. Take the exemption instead.
- Changing `it('name', () =>` to `async () =>` reads as a deleted test to the
  guard, which greps whole `it(` lines.

**Frontend**

- There is no prettier config in this repo. `npx prettier --write` defaults to
  double quotes and will rewrite a single-quote file wholesale. Match style by
  hand.
- Agent worktrees start without `node_modules`; the main checkout's is
  lockfile-identical and gitignored, so a symlink is enough.
- A component named `Add…` may be mounted only in edit mode. Grep for its trigger
  and the props it is mounted with, not just its render site.

**Backend**

- A per-attempt timeout is not a budget when the caller retries. Bound a leg with
  one `asyncio.wait_for` around the `AIManager` call and put the arithmetic in the
  `Settings` comment.
- `/v1/chat/stream` bypasses the chat nodes entirely — a change made only in
  `workflows/chat/nodes.py` passes tests and never reaches the UI.
- Leg-2 errors in the receipt workflow never reach the client: `parse_receipt_llm`
  writes to `errors`, `routes/scan.py` forwards only `warnings`.
- "Flagged but not removed" is a half-fix: `score_and_rank` tagged `_expired` and
  only one of three consumers honoured it.
- `requirements.lock` cannot be installed alongside `pyproject.toml` in a fresh
  venv (numpy pin conflict); build from `.[dev]`.

---

## 10. Open decisions

1. **#474 direction** — laptop-only, a GitHub Action holding the bot PAT, or move
   the protected-path gate off authorship onto a required status check
   (recommended).
2. **`dryRun` exemption** — the new identity gate blocks it too, so the loop
   cannot be exercised at all outside a provisioned laptop. Exempting it adds a
   second path through a security gate.
3. **Five provisional product calls** made by an AI stand-in, each banner-marked
   as *not* Ayush's and reversible: #489 (where an applied amendment lives),
   #444 (fold #311, close #358), #332 (guest mode judged already shipped, though
   the issue was only relabelled, not closed),
   #410 (`WorkflowState.session` dict residual), #408 (what PR #436 actually
   closes).
4. **Production Supabase** — is anonymous sign-in actually enabled? #332 is still
   open (relabelled `ready-for-human`, not closed); that toggle is a dashboard fact
   no session can see. If it is off, the login wall is still up despite the code.

[#474]: https://github.com/ayushb3/BubblyChef/issues/474
