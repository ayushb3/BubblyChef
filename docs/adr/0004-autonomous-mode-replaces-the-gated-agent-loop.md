# Autonomous mode replaces the risk-tiered, gated agent loop

**Date:** 2026-09-29 · **Decided by:** Ayush · **Lands in:** PR #644 (issue #640), alongside
the signature PRD (`docs/plans/2026-09-29-signature-prd.md`, PR #643).

From 2026-09-29, Claude merges every PR itself. Nothing waits for a human approval, no path
is protected, and the heavy CI gates are gone. Ayush's job moves upstream: he sets high-level
goals and iterates on the UI in Claude Design, with Claude guiding him. Everything after that
is Claude's: PRDs, grilling each goal into decisions, specs, slicing into tickets, triage,
building, reviewing and merging. Slices get bigger, one PR per vertical feature.

This record says what the old process was, what it was good at, when it is worth bringing
back, and why we are trading it for speed now.

## What the old process was (through 2026-09-28)

It was built to answer one question: *can agents ship to `main` unattended without making a
mess?* Every layer was a piece of evidence that didn't depend on trusting the agent.

- **Gate at risk, judged by path.** Agents merged their own PRs unless the diff touched a
  path in `.github/CODEOWNERS`: migrations, the auth boundary, `prompts/`, `.github/`,
  `.claude/` config and hooks, `scripts/agent-gates/`, manifests, deploy config. Those needed
  Ayush's code-owner review, enforced by GitHub rather than by convention. Agent PRs opened
  as `bubblychef-bot` so that the rule applied to them.
- **Required checks that proved the work, not just that it compiled.**
  - *Bug fix fails on base:* CI copied the PR's tests onto the base commit and demanded that
    one fail. That caught tests written to match the code instead of the bug.
  - *Test suite did not shrink:* no deleted or skipped tests without a
    `test-removal-approved` label.
  - *F2P exemption is legitimate:* the `no-f2p` label was only valid on a docs-only diff.
  - *Agent loop limits hold:* a harness test that the loop's caps were still in place.
  - *Claude review verdict:* on `agent-loop` PRs, a fresh-context review had to say
    `looks mergeable` for the exact head commit.
- **The agent loop** (`.claude/workflows/agent-loop.js`): one `ready-for-agent` issue, end
  to end, through fixed stages. Preflight (bot identity, kill switch, at most 15 loop PRs a
  day), plan, an Opus decision stage, reproduce, implement and verify (2 attempts), an Opus
  review (up to 3 fix rounds), ship, then respond to the GitHub review (up to 2 rounds).
  Anything stuck took the blocked path: a draft PR labelled `agent-blocked` and the issue
  back to triage. The script sat behind CODEOWNERS so an agent couldn't raise its own limits.
- **Small slices.** `/to-tickets` cut work thin, so each PR changed one behaviour and could
  be reviewed from its body on a phone.
- **Ayush in the loop for product calls.** Anything beyond the issue's scope went to him as
  `needs-decision`, and protected-path PRs waited in "Ayush's pile".

## What it did well

- **It made unattended merging trustworthy.** Every rule traces back to a real failure. The
  chat action that posted to a route that didn't exist is why `verify` exercises changes in
  a running app. PR #616's five review rounds are why there's a three-round cap and the
  "fix the class, sweep for siblings" rule. PR #251's six issues left open are why closing
  keywords are strict.
- **Agents couldn't weaken their own guardrails.** Putting the gates, the loop script and the
  agent config behind CODEOWNERS answered the self-modification problem structurally, not
  by asking nicely.
- **Evidence over confidence.** Fail-to-pass and test-count checks are re-run by CI, never
  self-reported, which counters the known failure where agents satisfy a check without
  solving the task.
- **It scaled to input nobody vetted.** Small, well-shaped tickets meant an issue from a user
  report or a teammate could go through the loop without a planning conversation, and the
  caps stopped one bad issue from eating a day.
- **It produced the tooling we're keeping:** the bot identity, the review workflow and its
  verdict marker, `verify`, the PR-body-as-review-surface rule, and the `/health` git-SHA
  plumbing meant for a post-merge smoke test that was never actually built (issue #646).

## When the old process is the right one

Bring it back, whole or in part, when any of these become true:

- **There are real users or data that can't be lost.** Then schema, auth and deploy config
  genuinely don't roll back, and a human on those paths earns its cost again.
- **Issues arrive from people who aren't in the planning conversation:** user reports,
  teammates, external contributors. Small slices and the loop's fixed stages handle a queue
  of independently filed issues far better than big strides do.
- **Agents run unattended at volume**, several sessions at once overnight. The daily PR cap,
  round caps and blocked path are what keep that from snowballing.
- **Spend is per token**, not a flat subscription. The caps double as a budget.
- **Review keeps missing the same class of bug.** Fail-to-pass is the cheapest fix for a
  review that trusts tests it shouldn't.

Restoring is mechanical. The deleted files (`.github/workflows/agent-gates.yml`,
`.github/CODEOWNERS`, `scripts/agent-gates/f2p-check.sh`,
`scripts/agent-gates/exemption-check.sh`, `scripts/agent-gates/test-count-guard.sh`) are
on `main` at `64fa18a`, the commit before PR #644 merged. `agent-loop-harness.cjs`
was never deleted — it still tests `agent-loop.js`'s control flow and runs in CI. The
ruleset's earlier required checks are in the git history of
`.github/rulesets/main-protection.json`.

## Why we're changing

- **There is no prod to protect.** No real users, no data anyone would miss. Both services
  can be rolled back in minutes by redeploying the previous commit or reverting (an
  automated post-merge smoke test that does this on its own isn't built yet — issue #646).
  The CODEOWNERS list existed to guard things that don't undo, and right now nothing is at
  stake if they don't.
- **The bottleneck became Ayush, not safety.** Most interesting AI work touches `prompts/`, so
  it waited for his review. Gate labels held up PRs that were otherwise done (PR #595 sat
  blocked by the test-count gate alone). Small product calls queued up for him. Each wait
  was cheap on its own. Together they set the pace.
- **Small slices built a complete app, not a distinctive one.** After the friend-ready PRD
  the app works, has a theme and some good features, but it still reads as a chat app with a
  scan feature. The most distinctive ideas, the full pixel kitchen and a real multi-dish
  meal with a timeline, were exactly the ones that got scoped down to fit thin tickets. They
  need to be designed and built as whole features.
- **Ayush's time is best spent upstream.** Goals and visual design are where his judgement
  changes the outcome most. Reading diffs and approving labels is where it changes it least.
- **Cost isn't the constraint.** On a Claude Max subscription the limit is throughput, not
  spend, so caps that exist to save money only slow things down.

## What stays

- The required checks that prove the code works, `Next.js (typecheck + test)` and
  `AI service (lint + typecheck + test)`, plus `Claude review verdict`, on a branch up
  to date with `main`.
- A **fresh-context Claude review** on every PR; Claude merges only on `looks mergeable`. The
  reviewer now lists every deleted or skipped test and judges the reason, replacing the
  test-count gate with a reading.
- **`verify`** on the final commit for anything a user can see or trigger.
- **The PR body carries the review**: what changed, what was verified and how, what isn't
  covered.
- Real merge commits, one PR at a time. Both services can be rolled back in minutes by
  redeploying the previous commit or reverting; an automated post-merge smoke test and
  auto-revert are not built yet (issue #646).
- **Still human, regardless of path:** force-pushing a shared branch, deleting data, sending
  external messages, rotating credentials, and changing v1 scope or anything that costs
  money. A migration still waits until it has been applied, because merging first puts code
  live against a schema that lacks it. Since 2026-09-29 Claude applies additive migrations
  itself through the Supabase CLI (see implement-issue §3.1). Destructive ones stay human.
- **Visibility instead of approval:** any PR that changes CI, the gates or agent config is
  named in the sprint doc, and every reversible product call Claude makes is logged there
  with the alternative it rejected.

## What we give up, knowingly

- **Nothing structurally stops an agent from changing its own rules.** Ayush weighed that
  and accepted it (2026-09-29). The sprint-doc callout is how he sees it happen.
- **A test can be written to match the code.** Without fail-to-pass, the reviewer and
  `verify` are the only defence against it.
- **Bigger PRs are harder to review.** The trade is intentional: one PR per feature can be
  verified end to end, where five thin ones each only prove a corner.
- **A PR that edits `.github/workflows/claude-review.yml` gets no automated review.** The
  action refuses to run when its workflow file differs from `main`'s. For those PRs, Claude
  runs a fresh-context review in a separate agent that never saw the implementation, posts
  its verdict on the PR, and merges on that.

## Still to tidy

- `.claude/workflows/agent-loop.js` still runs in shadow mode and tiers PRs by CODEOWNERS,
  still assumes the deleted fail-to-pass CI job, and still escalates protected-path
  decisions to a human — issue #645, "agent-loop.js still follows the gated policy".
- A few comments in `ai-service/bubbly_chef/prompts/` and tests still say "CODEOWNERS-gated"
  (rolled into issue #645).
- The post-merge smoke test and auto-revert described under "What stays" were never
  actually built — issue #646, "Post-merge smoke test + auto-revert".
