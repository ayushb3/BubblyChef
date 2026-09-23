# Agent loop: tokens, cost and ceremony, night of 2026-09-22/23

Read-only analysis. Window: 2026-09-22 10:00Z onward. Real activity ran from 23:57Z to about 10:10Z
(16:57 to 03:10 PT). All dollar figures are **API list-price equivalents**. Ayush is on a **Pro plan**,
so the real limit is plan usage, not dollars. The weekly all-models window stood at 80% at the time of
writing. Tonight the sessions hit the usage limit once (it reset at 21:40 PT). They ran out again at
about 23:56 PT, and the orchestrator paused everything for the night.

## TL;DR

- **The night cost about $289** across the five sessions. **About $125 of that is attributable to the
  agent loop.** That buys 5 merged loop PRs (**about $25 per merged PR, fully loaded**) and 3 more
  opened. Inside the workflow alone the figure is $63 for 9 runs, about $7 per run.
- **Inside the workflow, ceremony is modest:** about 18% (Preflight, Setup, Plan, Decide, waiting on
  Respond, Finish). Implement, Verify and fixes take 68%.
- **The expensive ceremony is outside the workflow:** the supervising sessions (the orchestrator, plus
  Loop A and Loop B babysitting their runs) cost about $53. That is **43% of the loop's cost**. Counting
  in-loop ceremony too, **about half of the loop's cost is ceremony**. The main driver is context size.
  The orchestrator re-read 365k tokens on an average turn, and 634k in its worst hour.
- **The size tiers from PR #534 did kick in:** 2 runs were small tier, 1 protected, 2 standard (2 runs
  predate it). The small run for issue #539 was the cheapest of the night ($3.48, 21 min). That is about
  10% below the earlier small-run baseline.
- **The in-loop review is the best value in the pipeline.** It caught a real bug or fabricated evidence
  in 7 of 9 runs, for about $0.30 per review agent. The GitHub second review is where rounds pile up
  (25 verdicts on 7 loop PRs). The loop's own Respond stage missed the GitHub review in 3 of 5 runs.
- **Caveman would save roughly nothing here.** Output is 21% of workflow cost, hidden thinking is a
  quarter of that output, and prose is only 5% of the visible output. The realistic saving is $0.3 to
  $1.7 a night, against about $0.5 to $1 of added ruleset tokens. It would also degrade the text Ayush
  reviews.

## Cast of PRs and issues cited

| Ref | Title | What it is |
|---|---|---|
| Issue #520 → PR #543 (merged) | Bubbles ledger | Earn 🫧 for scan, pantry add, recipe save, cook and daily visit; API routes + ledger writes |
| Issue #521 → PR #546 (merged) | Kitchen scene on the home screen | 12-slot kitchen scene component on Home with a balance pill |
| Issue #518 → PR #552 (open) | Guest walkthrough e2e | Playwright spec proving core flows work for a fresh guest; test-only |
| Issue #539 → PR #556 (merged) | Surface stream-callback failures | Chat shows an error instead of an empty bubble when a stream callback throws |
| Issue #389 → PR #561 (open) | Guest → Google sign-in links identity | Stop guest Google sign-in forking a new account; touches auth (protected) |
| Issue #522 → PR #569 (opened 10:07Z) | Milestone decoration picks | Pick 1 of 3 decorations at each 🫧 milestone; run still in its last stages |
| Issue #524 (run in progress) | Rescue bonus + waste-free streak | Extra 🫧 for using food before expiry; weekly streak; run was in a review-fix round |
| Issue #513 → PR #537 (merged) | Recipe-card empty bubble | useChat read proposal.actions on every proposal, so recipe cards rendered empty |
| Issue #493 → PR #536 (merged) | Saved-recipe lookup | New chat intent + search for saved recipes; touches prompts (protected) |
| PR #534 (merged) | Loop size tiers | Small/standard/protected tiers; small skips Decide-if-clear and the GitHub-review wait |
| PR #506 (merged, Drafts) | Context-aware follow-up chips | Chat chips generated from the reply; merged with PR #556 and broke main |
| PR #568 (merged) | Restore main's typecheck | One-line fix for the TS2339 that PR #506 + PR #556 caused together |
| PR #492 (merged, Drafts) | Stop offering expired rows as stock | Chat ignores expired/zero-qty pantry rows; merged over a "needs changes" verdict |
| PR #484 (merged, Drafts) | Plain tab labels, Type → Manual | Add-sheet tab polish; merged over a "needs changes" verdict (partial fix used `Fixes`) |
| PRs #482, #491, #505, #479, #509 (merged, Drafts) | Pantry and scan fix-ups | Edit-modal autocomplete, collapse add rows, remove kitchen location, Gemini vision retry, receipt budget |
| Issue #547 (open) | Respond misreads a failed verdict check | Loop bug: Respond treats a failed verdict check as "no review" and skips real findings |
| Issue #550 (open) | Ledger date-key bugs | Follow-up from PR #543: daily_visit claimable ahead; cook_confirm can pay twice over UTC midnight |
| Issue #563 (open) | Guest e2e never runs in CI | Follow-up from PR #552: the spec is gated off in CI, so it proves little on each PR |
| Issue #565 (open) | PR-body screenshots use relative paths | Images in loop PR bodies don't render on GitHub |
| Issues #467 / #567 (open) | Reusable verify helper | Shared Playwright helper so Verify and Reproduce stop hand-writing scripts |

## Prices used

| Model | Input | Cache write (5 min) | Cache read | Output | Source |
|---|---|---|---|---|---|
| Opus 5.5 (`claude-opus-5-5`) | $4.00 | $5.00 (assumed 1.25× input) | $0.20 | $20.00 | claude-api skill, 2026-06-24 cache |
| Opus 5 (`claude-opus-5`) | $5.00 | $6.25 | $0.50 (assumed 0.1× input) | $25.00 | same |
| Sonnet 5 | $2.00 | $2.50 | $0.20 | $10.00 | same |
| Haiku 4.5 | $1.00 | $1.25 | $0.10 | $5.00 | same |

Every cache write in these transcripts is the 5-minute kind (checked: `ephemeral_1h_input_tokens` = 0).
Each API message is counted once, using its last reported usage, per `loop_cost.py`. I extended that
script with pricing and stage buckets in `scratchpad/cost2.py`, and wrote the raw output to
`scratchpad/cost.json`.

## 1. Per-run table

"Input processed" = fresh input + cache write + cache read. "Wall" is first to last agent timestamp.
For the two runs that sat through the usage-limit pause, it also shows active time.

| Run | Issue | Tier | Agents | Fresh in | Cache write | Cache read | Output | **$** | Wall | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| wf_5d6fdf44-67f | #520 bubbles ledger | (pre-#534) | 19 | 1k | 0.82M | 21.5M | 165k | **$8.54** | 76 min (46 active) | 2 review rounds, 2 Respond waits |
| wf_37f3542c-64f | #521 kitchen scene | (pre-#534) | 23 | 1k | 1.12M | 28.7M | 239k | **$11.31** | 117 min (89 active) | resumed once; 2 Respond fix rounds |
| wf_dbeede90-146 | #518 guest e2e | small (260 lines) | 11 | 0k | 0.75M | 17.4M | 122k | **$6.81** | 42 min | Decide ran (2 open questions); no Respond |
| wf_6018c0df-cf5 | #389 Google linking | protected | 13 | 0k | 0.51M | 6.4M | 78k | **$3.55** | 20 min | Reproduce ran; plan said 90 lines, got 272 |
| wf_06fcf4ba-ccd | #539 (PR #556) | small (55→156 lines) | 12 | 0k | 0.47M | 6.9M | 75k | **$3.48** | 21 min | no Decide, no Respond wait |
| wf_29fd2d58-c79 | #522 **partial** | standard (750→885) | 14 | 0k | 0.56M | 9.4M | 115k | **$4.81+** | 28 min active (217 wall, paused) | at Ship when read |
| wf_4d7b5c00-6a1 | #524 **partial** | standard (520→998) | 13 | 1k | 0.72M | 20.0M | 163k | **$7.92+** | 32 min active (221 wall, paused) | 4 Decide agents; in fix-1 when read |
| *7 requested runs* | | | *105* | | *4.95M* | *110.3M* | *957k* | ***$46.43*** | | |
| wf_fe0d338d-393 | #513 (PR #537) | (pre-#534) | 14 | 1k | 0.87M | 17.9M | 159k | $7.62 | 54 min | also in the 24h window |
| wf_5a870b9f-2ca | #493 (PR #536) | (pre-#534) | 13 | 1k | 0.97M | 21.6M | 152k | $8.54 | 48 min | also in the 24h window |
| ***All 9 loop runs*** | | | *132* | | *6.79M* | *149.8M* | *1.27M* | ***$62.59*** | | |

**Where the money goes inside a run:** cache reads are 36–51% of each run's cost, cache writes 27–41%,
and output 19–26%. Fresh input rounds to zero.

**Against the earlier baseline** (`handoff-loop-efficiency.md`, priced with the same script):
- Small frontend fixes before tiers: issue #405 cost $3.79 and issue #406 $4.06, 20 min each.
- Issue #402, which was blocked after 3 review rounds: $6.67, 37 min.
- Tonight's small-tier run on issue #539: $3.48 and 21 min, so about 10% cheaper for a similar size.
  Preflight, Setup and Finish together fell from about $0.5 to $0.27. Two Opus reviews now cost $0.44,
  down from $0.74–0.85.
- Tonight's issues were mostly much bigger (500–1,100 changed lines), so their $7–11 is not a
  regression against the baseline.

### Per-stage totals

| Stage | Agents (9 runs) | $ (9 runs) | Share | $ (7 requested) | Agent-minutes (9) | Model |
|---|---|---|---|---|---|---|
| Preflight (capability + preflight) | 16 | 1.13 | 1.8% | 1.00 | 3 | Sonnet, low |
| Setup | 9 | 0.72 | 1.1% | 0.54 | 3 | Sonnet, low |
| Plan | 9 | 4.84 | 7.7% | 3.03 | 27 | dev role (Sonnet) |
| Decide | 17 | 2.93 | 4.7% | 2.43 | 7 | Opus, high |
| Reproduce | 2 | 1.67 | 2.7% | 0.46 | 8 | dev role |
| **Implement** | 11 | **17.29** | **27.6%** | 12.96 | 90 | dev role |
| **Verify** (incl. recheck) | 16 | **11.93** | **19.1%** | 8.39 | 95 | dev role |
| Review (in-loop) | 14 | 4.41 | 7.0% | 3.51 | 11 | Opus |
| **Fix after in-loop review** | 8 | **8.37** | **13.4%** | 6.30 | 47 | dev role |
| Ship (PR body, push) | 10 | 4.68 | 7.5% | 3.56 | 29 | Sonnet |
| Respond: read GitHub review | 8 | 1.04 | 1.7% | 0.77 | 37 (mostly waiting) | Sonnet, low |
| Respond: fix | 2 | 3.26 | 5.2% | 3.26 | 26 | dev role |
| Finish | 10 | 0.31 | 0.5% | 0.24 | 3 | Haiku |

Top 3 stages by cost: **Implement (28%), Verify (19%), Fix after in-loop review (13%).** Add the
Respond fixes and all fix work comes to $11.63, or 19%. That is as much as Verify.

## 2. Ceremony vs work

### Inside the workflow (9 runs, $62.59)

| Bucket | $ | Share |
|---|---|---|
| Ceremony: Preflight, Setup, Plan, Decide, Respond-read, Finish | 10.97 | 18% |
| Ship (writes the PR body, which is the review surface) | 4.68 | 7% |
| In-loop review | 4.41 | 7% |
| Work: Reproduce, Implement, Verify, Fix, Respond-fix | 42.53 | 68% |

In $ terms the pipeline itself is not ceremony-heavy. Preflight, Setup and Finish together are under 4%.
Plan and Decide are about 12%. Decide is cheap per agent (about $0.17) but it runs at Opus high effort.

### The loop, fully loaded (about $125)

| Component | $ | How it was measured |
|---|---|---|
| Workflow agents (9 runs) | 63.04 | transcripts, exact |
| Loop A + Loop B session main threads (launch, monitor, resume, relay) | 23.41 | transcripts, exact (Opus 5.5) |
| Orchestrator main thread, loop-related turns | ≈ 30 | heuristic: turns that mention loop issue/PR numbers ($27.6), plus half of mixed turns |
| Drafts session fixing loop PRs after the loop ended (PR #536, PR #552) | 7.53 | time slices of the Drafts transcript |
| Orchestrator subagent resolving a PR #536 merge conflict | 1.12 | exact |
| GitHub Action reviews on loop PRs (25 verdicts, Opus 5, up to 40 turns) | **unmeasured** | runs on `CLAUDE_CODE_OAUTH_TOKEN`, i.e. Ayush's plan |
| **Total (measured)** | **≈ 125** | |

- **Supervision** (Loop A/B main threads plus the orchestrator's loop share) is about $53, **43%**.
- Adding in-loop ceremony ($11) brings **ceremony to about $64, roughly half**.
- Implement, Verify and fixes are about $42.5, about a third.

**Why supervision is expensive: context size, not message count.**

| Session | Turns | Avg context re-read per turn | $ | Notes |
|---|---|---|---|---|
| Bubbly Agent Loop, main thread | 708 | 365k (634k in its worst hour) | 74.64 | 03:00Z hour: $0.156/turn at 634k; after the session rotated at 04:06Z: $0.060/turn at 203k |
| Drafts | 465 | 385k (658k in its last hour) | 45.61 | single long-lived Opus 5.5 context |
| Loop B setup, main | 217 | 205k | 14.16 | |
| Loop A setup, main | 149 | 150k | 8.07 | |

Of the orchestrator's $74.64 main-thread spend:
- **$14.90** went on 155 text-only replies (status updates to Ayush).
- **$5.95** went on 58 turns sending messages to other sessions.
- **$5.75** went on 58 edits to the "Live Sprint Status" doc.
- **$1.47** went on file sends.

That is **about $28 of communication**, much of it status. Doc edits to handoff/.md files were another
$1.66.

### Did the tiers from PR #534 kick in?

Yes, for every run launched after PR #534 merged at 03:41Z:
- Issue #539 was **small** (55 lines planned, 156 actual). Decide was skipped (no open questions), and
  Respond skipped the GitHub-review wait. It was the cheapest run of the night.
- Issue #518 was **small** (260 lines). Decide still ran twice, because Plan raised 2 open questions.
  That is correct per the rule.
- Issue #389 was **protected**.
- Issues #522 and #524 were **standard**. Issue #524's plan said 520 lines; the change reached 998.
- The runs for issues #520 and #521 started at 03:35 and 03:40Z, on the old script, so no tier.

## 3. Outcome quality per run

| Run / PR | In-loop review caught | GitHub review rounds (verdicts) | Fix pushes after PR open | Open → merge | Shipped broken or with known gaps |
|---|---|---|---|---|---|
| Issue #520 → PR #543 | **Real bug:** `?date=` let any user mint unlimited daily_visit bubbles | 5 (needs changes ×2, needs a human, looks mergeable ×2) | 3 | 1h45m | **Yes, waived by Ayush:** date-key bugs tracked as issue #550 |
| Issue #521 → PR #546 | Acceptance criterion not met (screenshots at 480px, filled slots never seen) | **6** (needs changes ×3, needs a human ×2, looks mergeable) | ~7 fix + 4 re-verify commits | 1h32m | Design call (pill placement) escalated to Ayush. Branch was 66 commits stale, and the loop wrongly disputed the test-count guard as infra |
| Issue #518 → PR #552 (open) | Minor only (banner checked on /profile, not /) | 4 (needs a human ×4) | 3 (made by Drafts, not the loop) | open | GitHub review found cleanup bugs the loop missed (chunked cookie, uid captured too late). **Spec never runs in CI** (issue #563) |
| Issue #539 → PR #556 | **Real bug:** onError fired twice when a callback threw | 2 (needs changes, needs a human: Vercel account) | 1 | 53m | **Broke main together with PR #506:** TS2339 in chat.ts, red for 3h11m (06:55Z to 10:06Z, fixed by PR #568) |
| Issue #389 → PR #561 (open) | Flagged a failed getUser → fork path, but **rated it "minor"** | 2 (needs a human ×2); GitHub rated the same finding "important" | 1 | open (protected) | The loop under-rated the exact bug the issue exists to close; fixed after the loop ended |
| Issue #522 (partial) | **Real bug:** isSuccess hid the next milestone offer until reload | — | — | — | — |
| Issue #524 (partial) | **Real bug:** date check returned 400 before resolve/cook, blocking core flows for stale tabs | — | — | — | — |
| Issue #513 → PR #537 | **Fabricated evidence:** the "after" screenshot never reached the recipe-card path | 1 (looks mergeable) | 0 | 27m | Clean |
| Issue #493 → PR #536 | Stopword bug: "show me my saved recipes" returned nothing | 5 (needs a human ×5; protected prompts path) | 5 | 2h18m | Follow-ups filed |

What this shows:
- **The in-loop review earns its cost.** It found a real correctness bug or false evidence in 7 of 9
  runs, for $4.41 in total. It also missed things the GitHub review then found: the #518 cleanup bugs,
  and the severity of the #389 fail-open.
- **The loop's Respond stage is not closing the loop.** The GitHub-review reader returned
  `verdict: none, findings: []` in 3 of the 5 runs that waited (#520, #513, #493). That is issue #547.
  The orchestrator and the Drafts session then relayed the findings by hand, which is part of why
  supervision is so expensive.
- **Nobody re-tests against other open PRs.** PR #556 and PR #506 each passed CI alone and were merged
  26 seconds apart. Neither the loop, the GitHub review nor the orchestrator rebuilt main with both.
- **Recurring process misses:** relative-path screenshots in 3 loop PR bodies (issue #565), a stale
  branch, and an e2e spec that CI doesn't run.

## 4. Loop vs Drafts style (rough)

The Drafts session tonight did **finishing passes** on PRs that were written days earlier: merge main,
make one targeted fix, run one real-build verify, push once. The loop **writes from scratch**. So this is
not like-for-like; it compares two kinds of work.

| | Loop | Drafts (non-loop PRs) |
|---|---|---|
| PRs merged tonight | 5 (PR #537, #536, #543, #546, #556) | 9 (PR #436, #492, #484, #482, #491, #505, #479, #509, #506) |
| Measured $ | ≈ $125 fully loaded; $63 in workflow | $37.9 in Drafts, plus an unmeasured share of orchestrator coordination (perhaps $10–15) |
| **$ per merged PR** | **≈ $25** (≈ $7 per run in workflow only) | **≈ $4–6** (a 6-PR stack cost $12.88, about $2.15 each, thanks to warm context) |
| GitHub review verdicts per PR | 25 on 7 PRs → **3.6** | 7 on 8 PRs → **0.9** |
| Fix pushes after open | 0–11 (median about 3) | about 1 each |
| "Looks mergeable" reached | 3 of 5 merged | **0 of 8.** All merged on "needs a human" plus Ayush's sign-off, or over "needs changes" |
| Defects | PR #543 shipped known ledger gaps (issue #550). PR #556 co-broke main | **PR #492 was merged about a minute after a "needs changes" verdict.** The verdict said an all-expired pantry now reads "Your pantry is empty right now", the opposite of the PR body. No follow-up issue exists. PR #484 was merged over "needs changes" (it used `Fixes` on a partial fix, so the parent issue auto-closed with part unshipped). PR #506 co-broke main |

Verdict: Drafts style is 4–6× cheaper per merged PR, and needs about a quarter of the review rounds. That
is because it works warm on code that already exists, and it merges on human sign-off rather than
iterating to "looks mergeable". It was not cleaner: it shipped one flagged, unaddressed defect. The loop
is the better tool for from-scratch issues with a spec. It is overkill for rebase, fix-up and
merge-conflict work, and that work flowed back to Drafts anyway.

## 5. The "caveman" skill

**What it is.** Julius Brussee's `caveman` (GitHub `juliusbrussee/caveman`) is a Claude Code skill. It
makes the agent answer in clipped prose (no articles, filler or pleasantries) and leaves code, commands,
paths and errors intact. It has levels lite / full / ultra, plus a Classical-Chinese variant. The repo
also ships `/caveman-compress` for memory files, and a proxy that compresses tool output (logs, JSON,
diffs) before it reaches the model.

**What it claims, and what was measured.**
- The headline claim is about 65% fewer output tokens.
- JetBrains measured about **8.5% fewer output tokens on 82 real agentic tasks**. Per-task cost fell
  about 10% "in expectation", but that figure was fragile. Quality showed no detectable change.
- Third-party write-ups put whole-session savings at **4–10%**, because prose is a small part of a
  session.
- The author's own caveat: the ruleset adds **about 1,000 input tokens per call**.

**Would it help here? Barely, and it could hurt.**
- In the loop workflows, output is **21%** of cost ($13.7 of $63).
- Of those output tokens, **24% are hidden thinking** (reported `thinking_tokens`: 313k of 1.29M). The
  skill does not touch thinking.
- Visible output by character: code/file writes 29%, other tool calls 28%, structured stage results
  handed back to the script 20%, heredocs (PR bodies, comments, issue bodies) 18%. **Prose is 5%.**
- If caveman trimmed prose only: about **$0.30 a night**. If it also squeezed the structured stage
  results: at most **$1.3–1.7**.
- The ruleset's roughly 1k tokens × 2,563 calls, cached, costs about **$0.5–1** in reads and writes.
  **Net ≈ zero.**
- Shorter text barely shrinks later context. Tool results are 16.6M characters against 2M characters of
  output, so trimming prose moves cache reads by under 1%.
- In the orchestrator, prose is 24% of visible output, but that prose *is* the review surface.

**Risk.**
- CLAUDE.md says the PR body is the review surface, and it asks for full issue/PR citations and a
  plain-language TL;DR. Caveman style breaks all three.
- Loop Ship output (PR bodies) and the Decide rationale (which is quoted into PR bodies) must stay in
  plain English.

**Where terse is safe:**
- Agent-to-agent `SendMessage` (9% of the orchestrator's visible output).
- Internal-only structured fields, such as status flags and machine-read summaries.
- Loop-runner plumbing chatter.

A one-line "be terse in internal fields" instruction in those prompts gets this without installing a
skill.

**The part that targets the real driver is the input proxy,** since tool output is what fills the
context. But it routes Claude Code traffic, authenticated with Ayush's subscription, through a
third-party proxy, and it can hide log detail that Verify needs. Not recommended. The built-in version
is cheaper and safer: quieter commands (`tail -n`, `--quiet`, grep before cat) in the dev-role and
Verify prompts.

**Verdict: don't install caveman for the loop.** Savings are within noise, and the downside lands on
the text Ayush reviews.

## 6. Recommendations, ranked by $ saved per night, then risk

| # | Change | Est. saving | Risk | Evidence |
|---|---|---|---|---|
| 1 | **Rotate long-lived supervisor contexts** (orchestrator, Drafts, Loop A/B) at about 200–250k, via the existing handoff pattern | **$30–40** (10–14% of the night) | Low | Orchestrator turns cost $0.156 at 634k vs $0.060 at 203k; Drafts averaged 385k and ended at 658k |
| 2 | **One supervisor, not three.** The loop sessions launch and resume; the orchestrator only reads final results. Run Loop A/B supervisors on Sonnet 5. Cut status traffic: batch updates, and edit the status doc once an hour rather than 58 times | **$15–25** | Low | Loop A/B mains $23.4 on Opus 5.5; orchestrator status/messages/doc turns about $28 |
| 3 | **Fix Respond (issue #547) and make one review authoritative per tier.** For small/standard unprotected PRs, the GitHub review runs once on the final commit and the loop answers it properly. Stop re-reviewing each fix push | $5–10 in fix/relay, plus unmeasured Opus reviews on Ayush's plan (25 on loop PRs tonight) | Medium | Respond returned "none" in 3/5 runs; loop PRs averaged 3.6 verdicts |
| 4 | **Cheaper fix rounds.** Give the Fix agent a narrow brief (finding, files, the failing check), or continue the Implement agent warm instead of cold-starting a dev agent that re-reads 3M+ tokens | $4–5 | Low–Medium | 8 in-loop fix agents averaged $1.05 and 3.2M cache reads each; 2 Respond fixes cost $1.63 each |
| 5 | **Reuse verify infrastructure** (issues #467/#567): a shared Playwright helper, the Plan checklist handed to Verify, and the stack kept up between verify and recheck | $3–5, and about 30 min of wall time | Low | Verify cost $11.9 over 16 agents and 95 agent-minutes |
| 6 | **Integration gate:** GitHub merge queue, or "require branch up to date", so PRs merged close together are built together. Never merge within minutes of a verdict without reading it | ≈ $0 (saves rework) | Low | PR #506 + PR #556 red main for 3h11m; PR #492 merged over "needs changes" |
| 7 | **Rebase on main before Plan**, and skip Decide when the issue already carries Ayush's triage answers | about $1–2 | Low | Issue #524's decide-1 found the plan built on stale main; Decide is only $2.9 in total |
| 8 | **Model choices:** keep Opus on the in-loop review (highest value per $). Leave the workflow's dev roles on Sonnet. Moving Preflight/Setup to Haiku saves under $1, not worth the churn | <$1 | — | Opus is only about $7 of the $63 in workflow spend |
| 9 | **Skip the loop for:** fix-ups and rebases of existing PRs, merge conflicts, and test-only e2e specs that need product judgement. Send them straight to a Drafts-style warm session | Avoids about $25 per PR for work Drafts does for $2–6 | Low | Drafts stack of 6 PRs: $12.88; loop PR #552 still needed Drafts fixes and 4 review rounds |

Items 1 and 2 are not changes to `.claude/workflows/agent-loop.js`. They change how the sessions around
it are run, and that is where most of tonight's money went.

## Gaps and caveats

- **Dollars are API-equivalent.** Ayush is on Pro, where the constraint is usage windows (weekly
  all-models at 80%, limit hit twice tonight).
- **GitHub Action reviews are unmeasured.** They run Opus 5 with up to 40 turns on
  `CLAUDE_CODE_OAUTH_TOKEN`, which draws on the same plan. There were about 25 verdicts on loop PRs and 7
  on Drafts PRs.
- **Two cache prices are assumed,** not quoted: the Opus 5.5 cache write (1.25× input) and the Opus 5
  cache read (0.1× input).
- **Two runs are partial:** issue #522's run (at Ship) and issue #524's run (in fix-1) were still going.
  Issue #521's run was resumed once, and both attempts' agents are counted.
- **The orchestrator's loop vs non-loop split is heuristic,** by which PR/issue numbers each turn
  mentions. Its subagents ($54) were mostly non-loop work (PR #475 verification, issue breakdown, the
  art prompt pack) and are excluded from the loop total.
- **`get_usage` returns only plan percentages and context size,** not per-session spend. Session totals
  were computed from the transcripts instead.
  - Bubbly Agent Loop: $131.00, including about $2–3 for this report's own agent.
  - Loop A setup: $32.02.
  - Loop B setup: $54.44.
  - Drafts: $45.61.
  - Ayush Orchestrator: $28.28.
- **The Drafts PRs' authoring cost** (days earlier) is outside the window, so the loop vs Drafts
  comparison is authoring vs finishing.
- **"Real bug" is my judgement** from the review text. I did not re-verify each fix.
- **Wall times for issues #522 and #524** include the usage-limit pause, so use active time.

---

## Day 2 (2026-09-23 daytime): dev agents directly, no loop workflow

**Setup.** Loop A and Loop B were paused. One orchestrator session spawned Sonnet dev agents (frontend,
backend, ui-ux) straight from the ready queue, about two at a time, with no agent-loop workflow: the
daily cap had been hit, 16 loop PRs in 24h against 15. Merging went through a "guarded merge" script:
CI green AND the latest claude[bot] review says "looks mergeable".

**Output, about 17:45Z to 18:50Z autonomous (plus the morning's supervised merges).**
- 14 PRs opened: #594–#607.
- Merged: #594/#598 (kitchen themes, #523), #599 (#549), #601 (#465), #602 (#515), #603 (#566) and
  #604 (#541). That's 6 issues.
- Still open after review rounds: #596, #600, #605 and #606.
- Held for Ayush's design call: #595 (#550) and #607 (#444). Draft #597 is the home layout prototypes.
- Earlier the same day, the orchestrator merged the overnight loop's PRs once Ayush approved them:
  #569, #552, #583, #577, #575, #574, #570 and #591.

**Usage (Pro plan).** The 5-hour window went from 38% to about 85% during the autonomous stretch. The
weekly all-models window ended the day at 16%. The orchestrator's own context reached about 485k
tokens, well past the ~250k handoff point. That's the same "big supervising context" cost driver
identified above, now concentrated in one session instead of three.

**What went wrong, and why.**
1. **Fixes weren't re-reviewed (mechanical).** `claude-review.yml` re-reviews on a push *only* for PRs
   labelled `agent-loop`. Dev-agent PRs are reviewed once, on open. Every fix round sat unreviewed
   until the orchestrator noticed (about an hour lost). Workaround: close and reopen the PR. Adding the
   label would also count toward the loop's daily cap.
2. **Skipping the in-loop review moved the cost, it didn't remove it.** The loop's own pre-PR review
   (Opus, about $0.30, catching real problems in 7 of 9 overnight runs) was dropped along with the
   rest of the ceremony. The GitHub review became the *first* reviewer, and nearly every PR needed
   1–3 rounds, each costing an agent pass plus a review wait.
3. **The orchestrator's briefs caused some of the rework.** One brief contradicted the triage (#542:
   "keep fuzzy matching"). The #550 design trusted the client's timezone offset, and its 20h-cooldown
   redesign broke #570's judge-once streak lock. #594 was queued before its review had posted and
   merged over "needs changes".
4. **Agents lacked standing rules** that the loop encodes: rebase before pushing (stale bases caused
   most of the "Test suite did not shrink" failures), never self-apply `test-removal-approved`, claim
   in the PR body only what the tests prove, and cover every code path, not just the easy one.

**Recommendation: a lighter loop, not no loop.** Keep: a standard dev-agent brief (the four rules
above, "follow the triage comment exactly", and failing-test-first); a fresh-context review agent before
the PR opens; and a re-review on every push (label such PRs, or fix the trigger in
`claude-review.yml`, which is a protected path). Drop or shrink: Plan and Decide for ready issues whose
triage already decides the approach, and Preflight beyond identity plus the cap. Keep the
supervising context small: hand off at ~250k, and delegate reading to subagents.
