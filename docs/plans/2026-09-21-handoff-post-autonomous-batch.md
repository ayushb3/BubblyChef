# Handoff — BubblyChef, after the 2026-09-20 autonomous batch

**From:** Claude Code cloud session `session_0175ENom4NNfbyGGG6bFTzGF`, 2026-09-20 → 21
**For:** the next agent picking up this repo
**Repo:** ayushb3/BubblyChef
**State at handoff:** 11 open PRs from this batch, all green, **none merged**. `main` is at `9c02d37`.

Written to be read offline. Everything you need is inline — no link-chasing.

---

## 1. Read this before you touch the queue

**41 issues are labelled `ready-for-agent`. Roughly 24 of them are already in an open
PR.** The label is not a work queue; it lies. The previous two sessions both lost time
to this.

Before picking anything up, check it against the PR table in §4. In particular, **PR
#475 alone closes nine issues** (#402, #440, #441, #394, #398, #403, #400, #363, #439)
and they are all still labelled `ready-for-agent`.

Genuinely unblocked and unclaimed right now:

| Issue | What it is |
|---|---|
| **#493** | Spec B.1 — saved-recipe lookup, backend half of #186 (search method, intent, classifier disambiguation) |
| **#494** | Spec B.2 — render those matches as tappable ranked cards. Blocked by #493 |
| **#495** | Spec B.3 — cooking timers, multi-timer dock + step chips. No backend |
| **#496** | Spec B.4 — lite notification centre, header bell, compute-on-load, no persistence |
| **#497** | Spec B.5 — grocery list on `/grocery`, regenerated on demand, localStorage only |
| **#499** | Spec B.7 — meal structure in brainstorm (entrée + sides). Brainstorm half of #289 only |
| **#510** | Receipt parse failure returns `200` with zero items and empty `warnings` |
| **#284** | Compound substitution deduction. Its blocker #424 has closed |

Blocked, and by what:

- **#488** (Start over / Edit chips) — needs PR #436 merged
- **#489** (amendment reaches the deduction) — needs PR #360 and #487/PR #503
- **#490** (amendment survives reload) — needs #489 and PR #475
- **#500** (profile allergies + the one migration) — needs PR #475; **#501 and #502 need #500**
- **#444** (pending proposal lost on nav) — needs a human to confirm what PR #436 covers
- **#337** (`middleware` deprecation) — `module:auth`, a CODEOWNERS path; see §6
- **#321, #129** — `priority:defer`

---

## 2. Agent loop status: laptop-only, and now it says so

**`.claude/workflows/agent-loop.js` cannot run in a Claude Code cloud session, and no
credential will fix it.** Don't spend a session trying.

The 2026-09-19 handoff believed the blocker was a missing `bubblychef-bot` token. It
isn't. **The session proxy replaces GitHub credentials in transit:**

```
$ curl -H "Authorization: Bearer ghp_totallyFakeToken000…" https://api.github.com/user
{ "login": "ayushb3", … }

$ curl https://api.github.com/user          # no Authorization header at all
{ "login": "ayushb3", … }
```

A forged token and *no* token both authenticate as `ayushb3`. A bot PAT delivered as an
env secret gets written to disk, read by `gh`, sent, and **discarded in transit** — while
the provisioning hook reports success and every PR silently skips code-owner review.
That outcome is worse than not running at all.

Two more cloud blocks, for completeness:

- **The kill switch is unreadable.** The proxy 403s every `/actions/*` path, so
  `AGENTS_ENABLED` cannot be read from cloud by any route.
- **apt's `gh` is 2.45.0**, which has no `gh variable get` — the subcommand the
  kill-switch read uses. `gh` itself installs through the proxy fine (~1s).

**What changed (PR #486, open):** Preflight now probes the resolved identity *first* and
hard-stops unless it is `bubblychef-bot`, instead of interpolating a `gh` error into the
kill-switch message. A *failed read* of the kill switch is now distinct from the switch
being *set*. And every `AS_BOT` command clears `GH_TOKEN`/`GITHUB_TOKEN` — `gh` reads
those **ahead of** `GH_CONFIG_DIR`, so an ambient token silently outranked the bot config
dir. **That last one was latent on the laptop too.**

**Still untested:** only Preflight has ever run. Setup / Plan / Decide / Reproduce /
Implement / Verify / Ship / Respond remain unexercised end to end. Verify is the most
likely next break — it runs a production build and drives a browser.

**Known limitation, documented in PR #486:** the identity gate rests on the probe agent's
self-report. The script matches `cap.botLogin` exactly and lookalike tests pin that, but
the script never runs the command itself. Prompt hardening is mitigation, not enforcement.

---

## 3. Merge order — this matters

Six PRs are stacked. **Merge #475 first, with a real merge commit, not a squash.** A
squash breaks the history of everything below it.

```
main
 ├─ #475  nine queue issues          ← MERGE FIRST
 │   ├─ #479  #476 vision retry
 │   │   └─ #509  #481 scan budget
 │   ├─ #482  #404 row collapse
 │   ├─ #484  #399 tab labels
 │   └─ #491  #478 edit modal
 │       └─ #505  #397 kitchen-location
 ├─ #436  #416 classifier routing    ← see the gate warning below
 │   └─ #492  #443 expired items
 └─ #486, #503, #504, #506, #507, #508, #511   (all on main, independent)
```

**⚠️ PR #436 has never run the agent gates.** Its branch predates
`.github/workflows/agent-gates.yml`, and GitHub resolves `pull_request` workflows from
the **base** ref — so `Test suite did not shrink`, `F2P exemption`, `Bug fix fails on
base` and `Agent loop limits hold` are never scheduled. It looks green with 5 checks
instead of 10, while rewriting chat/session code and its tests. **Merge `main` into that
branch before merging it.**

---

## 4. The open PRs

All green. All authored by `ayushb3`, so **the CODEOWNERS gate does not fire on any of
them** — review deliberately rather than relying on it.

| PR | Closes | Base | Summary |
|---|---|---|---|
| **#486** | Related #474 | main | Preflight identity gate + kill-switch read fix + `GH_TOKEN` clearing. See §2. |
| **#491** | #478 | #475 | Edit-modal autocomplete fixed via `FoodAutocomplete`; dead add branch removed; `PUT`/`DELETE` moved into `lib/api/pantry.ts`; three drifted `LOCATIONS` copies folded into one. **Deviates from the recorded decision — see §5.** |
| **#492** | *Related* #443 | #436 | One domain rule (`domain/stock.py`) at every pantry→prompt read. Also fixes `days_until_expiry <= 3`, which is *negative* for past dates and was **promoting expired food** into "EXPIRING SOON (use first!)". Five tests pin that "expires tomorrow" is still prioritised. No closing keyword — the other half of #443 is in #436. |
| **#503** | #487 | main | Discriminated `proposal_type` for the chat amendment at **both** emit sites (the issue named one). Two `type: ignore`s gone. **Note: on `main` the amendment never reaches a chat envelope at all** — both envelope builders hardcode `proposal=None`. This types it; it does not make it reach the UI. That's #489. |
| **#504** | #417, #376 | main | `get_recipe` declares the dict it actually returns. Three workarounds removed. `dict[str, Any]` over a TypedDict, because the latter needs a new `cast()` and duplicates a schema mypy can't check against Postgres. |
| **#505** | #397 | #491 | Location gone from every UI surface; column untouched (has a DEFAULT, no migration). **Scan/chat still forward it** — `domain/expiry.py` scales shelf-life by `LOCATION_MODIFIERS` with `freezer: 6.0`, so dropping it everywhere would make frozen peas expire in ~7 days instead of ~42. Carries `test-removal-approved`. |
| **#506** | #498 | main | Follow-up chips from the reply. **Wired into the nodes *and* the streaming path** — `/v1/chat/stream` never runs the chat nodes, so a node-only change would pass every test and never appear in the app. Validation consumer-side, never throws on junk. |
| **#507** | #477 | main | `/proc/net/tcp` lookup instead of lsof. Root cause: the kernel truncates `next-server (v16.2.2)` to `next-server (v1`, and the unbalanced paren makes **lsof 4.95 drop the process silently**. Reproduced directly. **macOS still falls through to lsof** — if its lsof shares the limitation, the bug persists there. |
| **#508** | #391 | main | Phosphor icons (already in `package.json` via the bottom nav — **no new dependency**) and two distinct tip pills. "Read more" only renders when the text actually overflows. **Nothing was rendered — needs an eyeball.** |
| **#509** | #481 | #479 | One 40s server budget both legs draw down from, capped by a single `asyncio.wait_for` enclosing all retries *and* the Ollama fallback. Worst case asserted from live `Settings` defaults, so moving a knob past 45s fails a test. |
| **#511** | — | main | The session report (`docs/plans/2026-09-20-autonomous-session-report.md`). |

---

## 5. Things that will bite you

**The issues themselves are often wrong about the cause.** Seven cases in one night. The
briefs that said *"the issue may be wrong, verify first"* are the ones that produced good
work. Notably:

- **#478 said "delete `AddItemModal`"** — a recorded decision from the repo owner. It is
  the **only edit/delete UI** for pantry items and the sole caller of `PUT`/`DELETE` on
  `/api/pantry/[id]`. Deleting it would make every pantry card a dead button. An agent
  sent to delete it stopped and refused; PR #491 fixes it in place instead. **If Ayush
  reinstates the delete, an edit surface has to be built first.**
- **#397 called location presentational.** It scales the expiry heuristic (see #505).
- **#477's stated cause was wrong** (see #507).

**Gate mechanics that cost red CI cycles:**

- **`test-removal-approved` applied *after* opening a PR does nothing.** `agent-gates.yml`
  reads labels from the **frozen event payload**; a re-run replays the same payload, and
  the workflow triggers on `opened`/`synchronize`/`reopened`, **not** `labeled`. Only a
  new push clears it. Label *before* opening.
- **`no-f2p` only covers docs-only diffs.** `exemption-check.sh` fails the PR if the diff
  touches code. It is not an escape hatch for "hard to test" — write the test.
- **`mypy_gate.sh` reports `fixed: 0` when you remove a `type: ignore`.** A suppression
  was never a baselined error. Don't read it as "no effect", don't `--sync` the baseline.
- **Run `scripts/agent-gates/agent-loop-harness.cjs` before pushing any `agent-loop.js`
  edit.** Its mock returns `'none'` for unknown labels, so a new stage fails its own gate
  and collapses all 54 downstream assertions. This turned CI red once.

**Environment traps (these killed 3 of 15 agents outright):**

- **Agent worktrees start with no `node_modules` and no venv.** The main checkout's
  `nextjs/node_modules` is lockfile-identical and gitignored — symlink it. Build
  `ai-service/.venv` from `.[dev]`, **not** `requirements.lock` (numpy pin conflict).
- **Tell implementers to commit early and often.** Three agents died after 60+ minutes
  with nothing committed. One agent's excellent work survived only because a stop hook
  forced a checkpoint.
- **A long gap with no completion notification means dead, not busy.** Check `git log` on
  the agent's branch rather than waiting.
- **Never run `npx prettier`** — there is no prettier config in this repo, so it defaults
  to double quotes and rewrites a single-quote file wholesale. It turned a 10-line change
  into 144 insertions / 108 deletions.
- **`scripts/dev/stack.sh` calls a bare `python -m uvicorn`**, which resolves to system
  python with no deps. Put `ai-service/.venv/bin` on PATH or the AI service silently fails
  to start.
- **Playwright needs `PLAYWRIGHT_CHROMIUM_PATH`** — the container ships `chromium-1194`,
  the repo's Playwright wants `-1234`. Do **not** run `playwright install`.
- Env files are gitignored and absent in a fresh container, but **all credentials exist as
  environment variables** — write `nextjs/.env.local` and `ai-service/.env` from them.

**The frontend gate set is three commands, not two:** `npx tsc --noEmit` **and**
`npx eslint src/ --max-warnings=-1` **and** `npx jest`. CI runs eslint; tsc and jest both
pass things eslint rejects. ai-service needs the venv binaries: `.venv/bin/pytest`,
`.venv/bin/ruff`, `./scripts/mypy_gate.sh`.

---

## 6. Waiting on Ayush — do not guess these

1. **#474 direction.** Laptop-only, a GitHub Action holding the bot PAT and triggered
   `on: push` (the container can't reach the Actions API to dispatch), or move the
   protected-path gate off authorship onto a required status check. **The last is the
   recommendation** — it stops authorship being a security property at all.
2. **`dryRun` exemption.** The new identity gate blocks it too, so the loop can't be
   exercised *at all* outside a provisioned laptop. Exempting it adds a second path
   through a security gate.
3. **PR #491's deviation** from the recorded "delete `AddItemModal`" decision.
4. **What PR #436 actually closes.** Its body carries only `Fixes #416` / `Fixes #442`,
   but Spec 0 lists #266 and #408 as folded in — they will stay open after merge, which
   is the exact failure CLAUDE.md warns about (PR #251 left six issues open).
5. **Production Supabase: is anonymous sign-in enabled?** #332 was closed because guest
   mode exists in code (`middleware.ts:59` calls `signInAnonymously()`), but that toggle
   is a dashboard fact no session can see. If it's off, the login wall is still up.
6. **#337 is `module:auth`, a CODEOWNERS path.** An agent PR there would touch auth *and*
   bypass the one gate meant to catch mistakes. Left alone deliberately; unblocks when
   #474 is resolved.

**Five provisional product calls** were made overnight by a Fable stand-in acting as
product owner, each posted with an explicit banner saying it is **not** Ayush's decision
and is reversible: on **#489** (an applied amendment lives in the session snapshot; draft
rows may be PATCHed, library rows never), **#444** (two tickets, #358 closed as duplicate,
#311 stays), **#332** (guest mode already shipped — closed), **#410** (the
`WorkflowState.session: dict[str, Any]` residual is a follow-up, not accepted),
**#408** (PR #436 closes #266; #408 is only half-fixed). **Treat all five as unratified.**

---

## 7. Lessons proposed, not yet in `lessons.md`

`docs/agents/lessons.md` forbids direct agent appends — these are proposed in PR bodies
for the nightly job. They are listed in full in
`docs/plans/2026-09-20-autonomous-session-report.md` §9 (PR #511). The load-bearing ones
are already inlined in §5 above.

---

## 8. If you only do one thing

**Get PR #475 merged, with a real merge commit.** It closes nine issues, unblocks five
stacked PRs, and removes most of the lying from the `ready-for-agent` queue. Everything
else in this handoff is downstream of it.

Second: merge `main` into PR #436's branch so it actually runs the gates before it lands.

---

## 9. Suggested skills

- **`/handoff`** — to hand off again when your session ends.
- **`/code-review`** — two-axis (standards + spec). It found four real issues on PR #486
  in this session, including one I'd wrongly dismissed in my own PR body.
- **`/verify`** — the stage most likely to break next, and the thing every PR in §4 is
  missing. Nothing visual was rendered all night.
- **`/triage`** — a pass before any pickup is cheap insurance; see §1.
- **`/agent-loop`** — the thing being fixed. It will hard-stop at Preflight here, by
  design. `dryRun: true` does not help (see §6 item 2).
