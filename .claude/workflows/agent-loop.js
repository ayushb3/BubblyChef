export const meta = {
  name: 'agent-loop',
  description: 'Take one ready-for-agent issue to a reviewed PR opened as bubblychef-bot: plan, decide, reproduce, implement, verify, review, ship, respond to the GitHub review',
  whenToUse: 'One issue per run. args: {issue: <number>}. Optional: shadow (default true), dryRun (stop after Decide). See docs/plans/2026-09-17-autonomous-agent-loop.md.',
  phases: [
    { title: 'Preflight', detail: 'kill switch, daily cap, issue readiness, classify' },
    { title: 'Setup', detail: "fresh branch from main in the session's own checkout" },
    { title: 'Plan', detail: 'dev role reads issue, lessons and code; lists open questions' },
    { title: 'Decide', detail: 'Opus decides each open question, or escalates to Ayush' },
    { title: 'Reproduce', detail: 'bugs: failing test first, before-screenshots' },
    { title: 'Implement', detail: 'implement and pass quality gates, max 2 attempts' },
    { title: 'Verify', detail: 'run the real app and walk the flow (verify skill)' },
    { title: 'Review', detail: 'fresh-context Opus review, up to 3 fix rounds' },
    { title: 'Ship', detail: 'commit and PR as bubblychef-bot; or the blocked path' },
    { title: 'Respond', detail: 'read the GitHub review and answer it, max 2 fix rounds; then finish' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// The agent loop (step 6 of docs/plans/2026-09-17-autonomous-agent-loop.md).
//
// Control flow lives here, in code, so the loop behaves the same every run.
// Judgement lives in the agents. Every stage has a way out: nothing retries
// forever, and a run that can't finish leaves a draft PR saying where it stuck
// rather than a silent half-done branch.
//
// Hard rules encoded below, not left to any agent's discretion:
//   - Never merges, and in shadow mode never requests auto-merge.
//   - PRs, pushes and commits are made as bubblychef-bot, never as ayushb3.
//     GitHub skips code-owner review when the author is the only code owner, so
//     a PR opened as ayushb3 would bypass the protected-path gate entirely.
//   - Questions touching a protected path, or changing product behaviour beyond
//     the issue, go to Ayush. Everything else the decision agent settles.
// ─────────────────────────────────────────────────────────────────────────────

const A = args || {}
const ISSUE = Number(A.issue)
const SHADOW = A.shadow !== false
const DRY_RUN = A.dryRun === true

if (!Number.isInteger(ISSUE) || ISSUE <= 0) throw new Error('args.issue must be an issue number')

const REPO = 'ayushb3/BubblyChef'
// At most this many loop PRs in any rolling 24 hours. Rolling rather than per
// calendar day, so it can't be sidestepped by the UTC/local date boundary.
const DAILY_CAP = 3
const MAX_IMPLEMENT_ATTEMPTS = 2
// Fix rounds after review: up to 3 fixes, so up to 4 reviews.
const MAX_REVIEW_ROUNDS = 3

// How every agent acts as the bot. Kept in one place so no stage improvises it.
const AS_BOT = `
ACTING AS THE BOT — follow exactly; never use Ayush's identity for writes.
- GitHub CLI writes (PRs, comments, labels): prefix with
    GH_CONFIG_DIR="$HOME/.config/gh-bubblychef-bot" gh ...
- Commits: git -c user.name="bubblychef-bot" -c user.email="330798838+bubblychef-bot@users.noreply.github.com" commit ...
- Pushes: git -c credential.helper= -c 'credential.helper=!f() { GH_CONFIG_DIR="$HOME/.config/gh-bubblychef-bot" gh auth git-credential "$@"; }; f' push ...
- NEVER run \`gh auth setup-git\`, never change global git config, never merge a PR,
  never run \`gh pr merge\` in any form.`

const WORKTREE_RULES = (wt) => `
Work ONLY inside the checkout at: ${wt.path}, on branch ${wt.branch}. Do not switch branches
while you work; the only exception is an explicit numbered cleanup step below telling you to
return to the original branch at the end, which you must carry out.
Start every shell command with: cd "${wt.path}" && ...
Read docs/agents/lessons.md in that checkout before you start; it lists mistakes
agents have already made in this repo.`

// ── Schemas ──────────────────────────────────────────────────────────────────
// Preflight returns RAW FACTS only. The script decides whether to proceed (see
// "Preflight" below): the kill switch and the cap must bind in code, not rest on an
// agent's judgement of its own limits. (Found by the independent review on PR #461.)
const PREFLIGHT = {
  type: 'object',
  properties: {
    agentsEnabled: { type: 'string', description: 'exact output of gh variable get AGENTS_ENABLED, trimmed' },
    runsLast24h: { type: 'integer' },
    issueState: { type: 'string', description: 'OPEN or CLOSED, exactly as gh reports it' },
    issueLabels: { type: 'array', items: { type: 'string' } },
    openPrsForIssue: { type: 'array', items: { type: 'integer' }, description: 'open PR numbers that target this issue' },
    title: { type: 'string' },
    kind: { type: 'string', enum: ['bug', 'feature', 'refactor', 'docs'] },
    devRole: { type: 'string', enum: ['frontend', 'backend', 'ui-ux'] },
    slug: { type: 'string', description: 'kebab-case, <= 5 words' },
    summary: { type: 'string', description: 'what the issue asks for, 2-3 sentences' },
  },
  required: ['agentsEnabled', 'runsLast24h', 'issueState', 'issueLabels', 'openPrsForIssue', 'title', 'kind', 'devRole', 'slug', 'summary'],
}

const SETUP = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    branchCreated: { type: 'boolean', description: 'true if the issue branch was created, even if a later step failed' },
    path: { type: 'string', description: "this session's checkout (git rev-parse --show-toplevel)" },
    branch: { type: 'string' },
    originalBranch: { type: 'string', description: 'the branch the checkout was on before Setup, to return to at the end' },
    problem: { type: 'string' },
  },
  required: ['ok', 'branchCreated', 'path', 'branch', 'originalBranch', 'problem'],
}

const FIX = {
  type: 'object',
  properties: {
    gatesPassed: { type: 'boolean' },
    gateOutput: { type: 'string' },
    fixed: { type: 'array', items: { type: 'string' }, description: 'each finding you actually fixed, quoted, with what you changed' },
    disputed: {
      type: 'array',
      items: {
        type: 'object',
        properties: { finding: { type: 'string' }, reason: { type: 'string' } },
        required: ['finding', 'reason'],
      },
      description: 'findings you are certain are wrong, with why; never use this to skip hard ones',
    },
  },
  required: ['gatesPassed', 'gateOutput', 'fixed', 'disputed'],
}

const PLAN = {
  type: 'object',
  properties: {
    plan: { type: 'string', description: 'the approach, concretely, in steps' },
    filesToChange: { type: 'array', items: { type: 'string' } },
    protectedPaths: { type: 'array', items: { type: 'string' }, description: 'files in the plan that match a .github/CODEOWNERS entry' },
    userVisible: { type: 'boolean', description: 'can a user see or trigger the change in the app?' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          implementerTake: { type: 'string', description: 'which option you would pick and why' },
        },
        required: ['question', 'options', 'implementerTake'],
      },
    },
  },
  required: ['plan', 'filesToChange', 'protectedPaths', 'userVisible', 'questions'],
}

const DECISION = {
  type: 'object',
  properties: {
    decision: { type: 'string' },
    reasoning: { type: 'string' },
    escalate: { type: 'boolean' },
    escalateReason: { type: 'string', description: 'empty unless escalate' },
  },
  required: ['decision', 'reasoning', 'escalate', 'escalateReason'],
}

const REPRO = {
  type: 'object',
  properties: {
    failedAsExpected: { type: 'boolean', description: 'the new test FAILS on the unfixed code, for the reason the bug describes' },
    testFiles: { type: 'array', items: { type: 'string' } },
    failureOutput: { type: 'string', description: 'the relevant lines of the failing run' },
    beforeScreenshots: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['failedAsExpected', 'testFiles', 'failureOutput', 'beforeScreenshots', 'notes'],
}

const IMPLEMENT = {
  type: 'object',
  properties: {
    gatesPassed: { type: 'boolean' },
    gateOutput: { type: 'string', description: 'summary lines of each gate: pass/fail counts, first errors' },
    summary: { type: 'string', description: 'what you changed, in behavioural terms' },
    filesChanged: { type: 'array', items: { type: 'string' } },
  },
  required: ['gatesPassed', 'gateOutput', 'summary', 'filesChanged'],
}

const VERIFY = {
  type: 'object',
  properties: {
    verified: { type: 'boolean' },
    applicable: { type: 'boolean', description: 'false only for no-runtime-change work, with the reason in evidence' },
    commitVerified: { type: 'string' },
    evidence: { type: 'string', description: 'markdown: user steps taken, outcomes, neighbours walked, smoke result' },
    screenshots: { type: 'array', items: { type: 'string' } },
    problems: { type: 'string', description: 'what did not work; empty if verified' },
    couldNotVerify: { type: 'string' },
  },
  required: ['verified', 'applicable', 'commitVerified', 'evidence', 'screenshots', 'problems', 'couldNotVerify'],
}

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['mergeable', 'needs-changes'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'important', 'minor'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'why'],
      },
    },
  },
  required: ['verdict', 'findings'],
}

const GH_REVIEW = {
  type: 'object',
  properties: {
    reviewRan: { type: 'boolean', description: 'a GitHub review run for the head commit finished and posted a review' },
    verdict: { type: 'string', enum: ['looks mergeable', 'needs changes', 'needs a human', 'none'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'important', 'minor'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'why'],
      },
    },
    note: { type: 'string', description: 'why reviewRan is false, or anything notable; else empty' },
  },
  required: ['reviewRan', 'verdict', 'findings', 'note'],
}

const SHIP = {
  type: 'object',
  properties: {
    prUrl: { type: 'string' },
    prNumber: { type: 'integer' },
    protectedPaths: { type: 'array', items: { type: 'string' } },
    wouldAutoMerge: { type: 'boolean' },
    lessonsProposed: { type: 'array', items: { type: 'string' } },
  },
  required: ['prUrl', 'prNumber', 'protectedPaths', 'wouldAutoMerge', 'lessonsProposed'],
}

// ── The blocked path ─────────────────────────────────────────────────────────
// A stuck run is a normal outcome. It must leave something Ayush can pick up:
// a draft PR with the work so far and exactly where it stopped.
async function blocked(wt, stage, detail, pre) {
  log(`Blocked at ${stage}: ${detail.slice(0, 160)}`)
  phase('Ship')
  const result = await agent(
    `${AS_BOT}
${wt ? WORKTREE_RULES(wt) : ''}

The agent loop working on issue #${ISSUE} ("${pre ? pre.title : ''}") is stuck at the ${stage} stage and must stop cleanly.

What happened:
${detail}

Do this:
1. ${wt ? `If the branch ${wt.branch} has commits beyond origin/main, commit any remaining work-in-progress (as the bot), push the branch as the bot, and open a DRAFT PR as the bot with labels "agent-loop" and "agent-blocked". Title: "WIP (agent-blocked): <issue title>". Body: what was attempted, the exact point and reason it stopped (quote the failing output), what a human should look at first, and "Related to #${ISSUE}" (NOT a closing keyword). End the body with the line: 🤖 Generated with [Claude Code](https://claude.com/claude-code)` : 'There is no branch to push.'}
2. As the bot, comment on issue #${ISSUE}: one short paragraph on where the loop stopped and why, linking the draft PR if there is one.
3. As the bot, on issue #${ISSUE}: remove the label "ready-for-agent" and add "needs-triage", so the loop does not pick it up again until a human has looked.
${wt ? `4. Stop any stack you started (scripts/dev/stack.sh down in ${wt.path}). Then, once everything is committed and pushed (or there was nothing to commit), return the checkout to its original branch: git checkout "${wt.originalBranch}". If nothing was ever committed on ${wt.branch}, also delete it: git branch -D "${wt.branch}".` : ''}

Return the draft PR URL, or "none".`,
    { label: 'blocked-path', phase: 'Ship', model: 'sonnet', effort: 'low' },
  )
  return { status: 'agent-blocked', issue: ISSUE, stage, detail, pr: result }
}

// ── Preflight ────────────────────────────────────────────────────────────────
phase('Preflight')
const pre = await agent(
  `Gather facts for the agent loop on ${REPO} issue #${ISSUE}. Read-only: change nothing,
and do not judge whether the run should proceed: report the raw values exactly.
Use the default \`gh\` (Ayush's login) for these reads.

1. agentsEnabled: the trimmed output of  gh variable get AGENTS_ENABLED --repo ${REPO}
2. runsLast24h: PRs by bubblychef-bot labelled "agent-loop" created in the last 24 hours.
   Get the cutoff in UTC:  date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ
   then: gh pr list --repo ${REPO} --state all --author bubblychef-bot --label agent-loop --search "created:>=<cutoff>" --json number --jq length
3. issueState and issueLabels:  gh issue view ${ISSUE} --repo ${REPO} --json state,labels,title,body,comments
4. openPrsForIssue: the union of exactly these two lists, nothing else. Do NOT search PR text
   for the number: other PRs mention issues in passing (the dry run on #405 once matched the
   loop's own PR, which only suggested #405 as a pilot).
   a. Open PRs GitHub has linked to close this issue:
      gh api graphql -f query='query{repository(owner:"ayushb3",name:"BubblyChef"){issue(number:${ISSUE}){closedByPullRequestsReferences(first:20,includeClosedPrs:false){nodes{number}}}}}' --jq '[.data.repository.issue.closedByPullRequestsReferences.nodes[].number]'
   b. Open PRs on a branch named for this issue:
      gh pr list --repo ${REPO} --state open --json number,headRefName --jq '[.[] | select(.headRefName | test("issue-${ISSUE}-")) | .number]'

Then classify from the issue's labels, title, body and comments:
- kind: "bug" if it has the "bug" label; else feature/refactor/docs by content.
- devRole: which role owns the files the change will mostly touch —
  frontend (nextjs routes, API routes, data wiring), backend (ai-service/),
  ui-ux (nextjs/src/components visual/design-system work).
- slug: short kebab-case for the branch name.
- summary: what the issue actually asks for, in your own words.`,
  { label: 'preflight', phase: 'Preflight', schema: PREFLIGHT, model: 'sonnet', effort: 'low' },
)
if (!pre) throw new Error('preflight agent died')
log(`Issue #${ISSUE}: ${pre.title} — ${pre.kind}, ${pre.devRole}; runs in last 24h ${pre.runsLast24h}/${DAILY_CAP}`)

// The go/no-go is decided HERE, from the raw facts — not by the agent.
const stopReason =
  pre.agentsEnabled !== 'true' ? `kill switch: AGENTS_ENABLED is "${pre.agentsEnabled}", not "true"`
  : pre.runsLast24h >= DAILY_CAP ? `daily cap: ${pre.runsLast24h} loop PRs in the last 24h (cap ${DAILY_CAP})`
  : pre.issueState !== 'OPEN' ? `issue #${ISSUE} is ${pre.issueState}`
  : !pre.issueLabels.includes('ready-for-agent') ? `issue #${ISSUE} is not labelled ready-for-agent`
  : pre.openPrsForIssue.length ? `issue #${ISSUE} already has open PR(s): ${pre.openPrsForIssue.map(n => '#' + n).join(', ')}`
  : ''
if (stopReason) {
  log(`Not starting: ${stopReason}`)
  return { status: 'skipped', issue: ISSUE, reason: stopReason }
}

// ── Setup ────────────────────────────────────────────────────────────────────
phase('Setup')
const prefix = pre.kind === 'bug' ? 'fix' : 'feat'
const branch = `${prefix}/issue-${ISSUE}-${pre.slug}`
// The loop works IN THIS SESSION'S OWN CHECKOUT, on a fresh branch. It does not create
// a separate worktree: the host only lets a session (and every agent it launches) write
// inside its own worktree, so agents could read a new worktree but never write to it.
// That is how the first pilot run on issue #405 blocked. It also matches WORKFLOW.md §5:
// isolation belongs to the session. Running issues in parallel means parallel sessions.
const wt = await agent(
  `Prepare this session's own checkout for the agent loop. Do not create worktrees, and do
not touch any other checkout.
1. path = \`git rev-parse --show-toplevel\` (run it from your current directory).
2. \`git status --porcelain\` in path must print NOTHING. If the checkout has any uncommitted
   or untracked-but-unignored files, ok=false with the list: never stash, reset or clean them,
   they may be someone's work.
3. originalBranch = \`git branch --show-current\`; if that prints nothing (detached HEAD), use
   \`git rev-parse HEAD\` instead. Cleanup returns to it with git checkout, which accepts either.
4. git fetch origin && git switch -c "${branch}" origin/main
   If that branch already exists locally or on origin, ok=false with the reason — do not reuse or delete it.
5. If nextjs/.env.local or ai-service/.env is missing: when this checkout is NOT the main
   checkout (the parent of \`git rev-parse --path-format=absolute --git-common-dir\`), copy it
   from there; when it IS the main checkout, there is nowhere to copy from, so set ok=false
   and say which file is missing. Never print their contents.
6. If nextjs/node_modules is missing, run in nextjs/: npm ci --prefer-offline --no-audit
Set branchCreated=true whenever step 4 succeeded, even if a later step failed, and always
return path, branch and originalBranch.`,
  { label: 'setup', phase: 'Setup', schema: SETUP, model: 'sonnet', effort: 'low' },
)
if (!wt || !wt.ok) {
  // A half-finished Setup must not leave the issue branch checked out: the next run would
  // find the branch already exists and block on this issue forever. Nothing has been
  // committed yet, so dropping it loses nothing. (Found by the independent review on PR #461.)
  if (wt && wt.branchCreated) {
    await agent(
      `A failed setup left an issue branch behind. In ${wt.path}: git checkout "${wt.originalBranch}" then git branch -D "${wt.branch}". Nothing was committed on it. Nothing else.`,
      { label: 'setup-cleanup', phase: 'Setup', model: 'haiku', effort: 'low' },
    )
  }
  return await blocked(null, 'Setup', wt ? wt.problem : 'setup agent died', pre)
}

// ── Plan ─────────────────────────────────────────────────────────────────────
phase('Plan')
const plan = await agent(
  `${WORKTREE_RULES(wt)}

Plan the change for issue #${ISSUE}: "${pre.title}". Do not write code yet.
Read the issue in full (gh issue view ${ISSUE} --repo ${REPO} --comments), the code it
concerns, and .github/CODEOWNERS.

Issue summary: ${pre.summary}

Return:
- plan: concrete steps.
- filesToChange, and which of them match a CODEOWNERS entry (protectedPaths).
- userVisible: can a user see or trigger this in the app?
- questions: ONLY genuine ambiguities the issue does not settle and that change
  what you would build. For each, the options and your own take. Do not invent
  questions; an issue that is clear gets an empty list.`,
  { label: 'plan', phase: 'Plan', schema: PLAN, agentType: pre.devRole },
)
if (!plan) return await blocked(wt, 'Plan', 'plan agent died', pre)
log(`Plan: ${plan.filesToChange.length} files, ${plan.protectedPaths.length} protected, ${plan.questions.length} open questions`)

// ── Decide ───────────────────────────────────────────────────────────────────
// A strong model settles ambiguity with the implementer's view as input. It
// escalates to Ayush only for protected areas or product behaviour the issue
// doesn't describe — those need him at merge anyway, so asking up front is cheaper.
phase('Decide')
const decisions = await parallel(plan.questions.map((q, i) => () => agent(
  `You are the decision agent for BubblyChef's agent loop. A developer agent planning
issue #${ISSUE} ("${pre.title}") hit an ambiguity the issue does not settle.

Issue summary: ${pre.summary}
The plan: ${plan.plan}
Protected paths in the plan: ${plan.protectedPaths.join(', ') || 'none'}

Question: ${q.question}
Options: ${q.options.map((o, j) => `(${j + 1}) ${o}`).join('  ')}
The implementer's take: ${q.implementerTake}

Read whatever you need (the issue with comments via gh, CONTEXT.md, docs/adr/, the code)
and decide. Weigh the implementer's take but do not defer to it.

Set escalate=true ONLY if deciding either (a) requires changing a path in
.github/CODEOWNERS (migrations, auth, ai-service/bubbly_chef/prompts/, .github/,
.claude/ config, dependency manifests, deploy config), or (b) changes product
behaviour a user would notice beyond what the issue describes. Otherwise decide.`,
  { label: `decide-${i + 1}`, phase: 'Decide', schema: DECISION, model: 'opus', effort: 'high' },
)))
const settled = decisions.map((d, i) => d && ({ ...d, question: plan.questions[i].question, implementerTake: plan.questions[i].implementerTake }))
if (settled.some(d => !d)) return await blocked(wt, 'Decide', 'a decision agent died', pre)

const escalations = settled.filter(d => d.escalate)
if (escalations.length) {
  phase('Ship')
  await agent(
    `${AS_BOT}

The agent loop on issue #${ISSUE} needs a human decision before it can continue.
As the bot, comment on issue #${ISSUE} with, for each question below: the question,
the implementer's take, the decision agent's recommendation and reasoning, and why it
needs Ayush. Keep it readable on a phone. Then, as the bot, remove "ready-for-agent" and
add "needs-decision". Finally, in ${wt.path}: git checkout "${wt.originalBranch}" and then
git branch -D "${wt.branch}". Nothing was committed on it.

${escalations.map(d => `- Question: ${d.question}\n  Implementer: ${d.implementerTake}\n  Recommendation: ${d.decision}\n  Reasoning: ${d.reasoning}\n  Why escalated: ${d.escalateReason}`).join('\n')}`,
    { label: 'escalate', phase: 'Ship', model: 'sonnet', effort: 'low' },
  )
  return { status: 'needs-decision', issue: ISSUE, questions: escalations.map(d => d.question) }
}
const DECIDED = settled.length
  ? `Decisions already made for you (follow them; do not reopen them):\n${settled.map(d => `- ${d.question} → ${d.decision}`).join('\n')}`
  : 'No open questions: the issue is clear.'

if (DRY_RUN) {
  log('Dry run: stopping after Decide and removing the issue branch.')
  await agent(`In ${wt.path}: git checkout "${wt.originalBranch}" and then git branch -D "${wt.branch}". Nothing was committed on it. Nothing else.`,
    { label: 'dry-run-cleanup', phase: 'Decide', model: 'haiku', effort: 'low' })
  return { status: 'dry-run', issue: ISSUE, pre, plan, decisions: settled }
}

// ── Reproduce (bugs only) ────────────────────────────────────────────────────
let repro = null
if (pre.kind === 'bug') {
  phase('Reproduce')
  for (let attempt = 1; attempt <= MAX_IMPLEMENT_ATTEMPTS && !(repro && repro.failedAsExpected); attempt++) {
    repro = await agent(
      `${WORKTREE_RULES(wt)}
${AS_BOT}

Issue #${ISSUE} is a bug: "${pre.title}". Before any fix, prove the bug exists.
Plan: ${plan.plan}
${DECIDED}
${repro ? `Your previous attempt did not produce a correctly failing test: ${repro.notes}\n${repro.failureOutput}` : ''}

1. Write the smallest unit test that reproduces the bug (Jest for nextjs, pytest for
   ai-service). It must FAIL on the current code, for the reason the bug describes —
   not because of a typo or a missing import you could have avoided.
2. Run it and confirm it fails. Put the relevant failing lines in failureOutput.
3. ${plan.userVisible ? 'The bug is user-visible: follow .claude/skills/verify/SKILL.md steps 1-2 to capture BEFORE screenshots into docs/media/issue-' + ISSUE + '/ (names ending -before.png), then scripts/dev/stack.sh down.' : 'Not user-visible: no screenshots needed.'}
4. Commit ONLY the test (and screenshots) as the bot: "test: reproduce #${ISSUE} (fails before the fix)". Do not push.

Do not fix the bug in this step.`,
      { label: `reproduce-${attempt}`, phase: 'Reproduce', schema: REPRO, agentType: pre.devRole },
    )
    if (!repro) return await blocked(wt, 'Reproduce', 'reproduce agent died', pre)
  }
  if (!repro.failedAsExpected) {
    return await blocked(wt, 'Reproduce', `Could not write a test that fails for the reported reason after ${MAX_IMPLEMENT_ATTEMPTS} attempts.\n${repro.notes}\n${repro.failureOutput}`, pre)
  }
  log(`Reproduced: ${repro.testFiles.join(', ')} fails on the unfixed code`)
}

// ── Implement ↔ Verify ───────────────────────────────────────────────────────
// Verification failures feed back into implementation, and share its attempt
// budget: two tries total, not two per stage multiplied together.
const GATES = `Quality gates (run the ones for what you touched; all must pass):
  cd ai-service && python -m pytest -q && python -m ruff check bubbly_chef/ && ./scripts/mypy_gate.sh
  cd nextjs && npx tsc --noEmit && npm test -- --ci && npx eslint src/ --max-warnings=-1
Known and NOT yours: 5 failures in ai-service/tests/test_issue_300_catalog_emoji.py on Windows only,
and 2 pre-existing eslint errors from @ts-nocheck in e2e specs (issue #149). Report them, don't chase them.`

let impl = null
let verify = null
let feedback = ''
for (let attempt = 1; attempt <= MAX_IMPLEMENT_ATTEMPTS; attempt++) {
  phase('Implement')
  impl = await agent(
    `${WORKTREE_RULES(wt)}
${AS_BOT}

Implement issue #${ISSUE}: "${pre.title}".
Plan: ${plan.plan}
${DECIDED}
${repro ? `A failing test already reproduces the bug: ${repro.testFiles.join(', ')}. Make it pass by fixing the cause. Do not weaken, skip or delete it.` : 'Add tests for the new behaviour alongside the code.'}
${feedback ? `\nThis is attempt ${attempt}. The previous attempt failed:\n${feedback}\nFix the cause, not the symptom.` : ''}

Follow CLAUDE.md's Dev Guidelines. Stay within the issue: if you find an unrelated bug,
note it in your summary instead of fixing it. Never delete or skip an existing test.

${GATES}

When the gates pass, commit as the bot with a message that says what changed and why.
Do not push.`,
    { label: `implement-${attempt}`, phase: 'Implement', schema: IMPLEMENT, agentType: pre.devRole },
  )
  if (!impl) return await blocked(wt, 'Implement', 'implement agent died', pre)
  if (!impl.gatesPassed) {
    feedback = `Quality gates failed:\n${impl.gateOutput}`
    log(`Attempt ${attempt}: gates failed`)
    continue
  }

  phase('Verify')
  verify = await agent(
    `${WORKTREE_RULES(wt)}
${AS_BOT}

Verify issue #${ISSUE} ("${pre.title}") by following .claude/skills/verify/SKILL.md exactly,
in the checkout above. What was implemented: ${impl.summary}
${repro && repro.beforeScreenshots.length ? `Before-screenshots already exist: ${repro.beforeScreenshots.join(', ')}. Take the matching -after.png shots.` : ''}
${plan.userVisible ? '' : 'The change is not user-visible: verify its observable effect as the skill describes for backend-only changes, or mark applicable=false only if there is genuinely no runtime behaviour to check.'}

Walk the flow the issue describes AND its neighbours. Check both health endpoints report
the checkout's HEAD. Run the smoke suite. Always run scripts/dev/stack.sh down at the end.
Commit screenshots as the bot. Never report verified=true for anything you did not run.`,
    { label: `verify-${attempt}`, phase: 'Verify', schema: VERIFY, agentType: pre.devRole },
  )
  if (!verify) return await blocked(wt, 'Verify', 'verify agent died', pre)
  if (verify.verified || verify.applicable === false) break
  feedback = `The implementation passed its gates but failed verification in the running app:\n${verify.problems}`
  log(`Attempt ${attempt}: verification failed`)
  verify = null
}
if (!impl || !impl.gatesPassed) return await blocked(wt, 'Implement', `Quality gates still failing after ${MAX_IMPLEMENT_ATTEMPTS} attempts:\n${impl ? impl.gateOutput : ''}`, pre)
if (!verify) return await blocked(wt, 'Verify', `Still failing verification after ${MAX_IMPLEMENT_ATTEMPTS} attempts:\n${feedback}`, pre)

// ── Review ───────────────────────────────────────────────────────────────────
// Fresh context: the reviewer never sees the implementing session, only the diff,
// the issue and the evidence. This is what caught the stack.sh bugs in PR #457.
// MAX_REVIEW_ROUNDS counts FIX rounds: up to that many fixes, each followed by a
// fresh review, so there are up to MAX_REVIEW_ROUNDS + 1 reviews in total.
//
// Fixed and disputed findings are tracked separately and reported separately. A
// dispute is not a win: it goes back to the reviewer, and if the reviewer still
// raises it, it counts against the round limit like any other unresolved finding.
// (Earlier, every finding was reported as "fixed" whether it was or not — found by
// the independent review on PR #461.)
let review = null
const fixedFindings = []
const disputedFindings = []
for (let round = 1; round <= MAX_REVIEW_ROUNDS + 1; round++) {
  phase('Review')
  review = await agent(
    `You are reviewing a change you did not write. Work in ${wt.path} (cd into it); do not edit anything.
Diff: git diff origin/main...HEAD. The issue: gh issue view ${ISSUE} --repo ${REPO} --comments.
What the implementer says it did: ${impl.summary}
Verification evidence: ${verify.evidence}
${disputedFindings.length ? `\nThe implementer disputed these earlier findings. Judge each on its merits; raise it again only if the dispute is wrong:\n${disputedFindings.map(d => `- ${d.finding} — implementer says: ${d.reason}`).join('\n')}` : ''}

Review against the issue and CLAUDE.md. In priority order: behaviour that doesn't match
the issue or the claims; bugs (anything that passes tests but is wrong); security
(missing requireAuth, RLS, data crossing users); tests that don't really test the change
or were weakened; guideline violations. Only concrete problems, each with why it matters.
Skip style the linters enforce.
verdict=mergeable only if nothing blocking or important remains.`,
    { label: `review-${round}`, phase: 'Review', schema: REVIEW, model: 'opus' },
  )
  if (!review) return await blocked(wt, 'Review', 'review agent died', pre)
  const serious = review.findings.filter(f => f.severity !== 'minor')
  if (review.verdict === 'mergeable' || !serious.length) break
  if (round > MAX_REVIEW_ROUNDS) {
    return await blocked(wt, 'Review', `Review still needs changes after ${MAX_REVIEW_ROUNDS} fix rounds:\n${serious.map(f => `- [${f.severity}] ${f.file}: ${f.problem}`).join('\n')}`, pre)
  }
  const fix = await agent(
    `${WORKTREE_RULES(wt)}
${AS_BOT}

An independent reviewer found these problems in your change for issue #${ISSUE}.
Fix each one. If you are CERTAIN a finding is wrong, put it in \`disputed\` with the reason
instead; a dispute goes back to the reviewer, so never use it to skip a hard fix.
List every finding you actually fixed in \`fixed\`, with what you changed. Re-run the gates.
${GATES}
${serious.map(f => `- [${f.severity}] ${f.file}: ${f.problem} — ${f.why}`).join('\n')}
Commit as the bot. Do not push.`,
    { label: `fix-${round}`, phase: 'Review', schema: FIX, agentType: pre.devRole },
  )
  if (!fix || !fix.gatesPassed) return await blocked(wt, 'Review', `Fixing review findings broke the gates:\n${fix ? fix.gateOutput : 'fix agent died'}`, pre)
  fixedFindings.push(...fix.fixed)
  disputedFindings.push(...fix.disputed)
}

// ── Ship ─────────────────────────────────────────────────────────────────────
phase('Ship')
const ship = await agent(
  `${WORKTREE_RULES(wt)}
${AS_BOT}

Open the PR for issue #${ISSUE}: "${pre.title}".

1. Work out which changed files match .github/CODEOWNERS (git diff --name-only origin/main...HEAD).
2. Push the branch as the bot.
3. Open a PR (NOT draft) as the bot against main, labelled "agent-loop". Title in the
   repo's conventional style. The body is the review surface — write it for someone who
   will not open the diff (CLAUDE.md, "The PR body is the review surface"):
   - If any protected paths: a first line "> ⚠️ Touches protected paths: <list> — needs Ayush's approval."
     Otherwise a first line: "> ${SHADOW ? 'Shadow mode: no protected paths — would auto-merge once checks pass. Ayush merges during the shadow period.' : 'No protected paths: eligible for auto-merge.'}"
   - Summary in behavioural terms: ${impl.summary}
   - Verified: ${verify.evidence}
     Embed the screenshots (${verify.screenshots.concat(repro ? repro.beforeScreenshots : []).join(', ') || 'none'}), before/after side by side where both exist.
   ${repro ? `- Fail-to-pass: ${repro.testFiles.join(', ')} failed on the unfixed code:\n     ${repro.failureOutput.slice(0, 600)}` : ''}
   - Decisions made during the run: ${settled.length ? settled.map(d => `${d.question} → ${d.decision} (${d.reasoning})`).join('; ') : 'none needed'}
   - Review — report these three lists separately and truthfully; never call a disputed finding fixed:
       fixed: ${fixedFindings.length ? fixedFindings.join('; ') : 'none'}${!fixedFindings.length && !disputedFindings.length ? ' (passed the first review)' : ''}
       disputed and accepted by the re-review: ${disputedFindings.length ? disputedFindings.map(d => `${d.finding} (${d.reason})`).join('; ') : 'none'}
       minor, not addressed: ${review && review.findings.length ? review.findings.filter(f => f.severity === 'minor').map(f => f.problem).join('; ') || 'none' : 'none'}
   - Not covered: ${verify.couldNotVerify || 'state explicitly what this does not handle'}
   - Lessons proposed (for the nightly curation into docs/agents/lessons.md — do NOT edit that file): anything a future run should know, or "none".
   - "Fixes #${ISSUE}" on its own line if this fully resolves it; "Related to #${ISSUE}" if only partly.
   - End with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
4. ${SHADOW ? 'Shadow mode: do NOT enable auto-merge. Do not run any gh pr merge command.' : 'Do NOT enable auto-merge here: the loop decides that after the GitHub review (Respond). Do not run any gh pr merge command.'}
5. Stop any stack you started. STAY on ${wt.branch}: the Respond stage may still need to fix
   and push. A final step returns the checkout to its original branch.`,
  { label: 'ship', phase: 'Ship', schema: SHIP, model: 'sonnet' },
)
if (!ship) return await blocked(wt, 'Ship', 'ship agent died before the PR was confirmed', pre)

// ── Respond ──────────────────────────────────────────────────────────────────
// The GitHub reviewer (claude-review.yml) reviews the PR from a context that never saw
// this run, and in practice it finds things the in-loop review missed. Its findings used
// to sit unread on the PR until a human got to them, which kept the human as the
// bottleneck. Respond reads that review and answers it, with the same rules as the
// in-loop review: each finding fixed or disputed with a reason, reported separately,
// and a hard cap on rounds.
//
// Re-reviews: claude-review.yml also fires on pushes to PRs labelled `agent-loop`, so
// each fix push gets a fresh GitHub review of the new commit.
phase('Respond')
const MAX_RESPOND_ROUNDS = 2
let ghReview = null
let respondOutcome = 'looks mergeable'
const respondFixed = []
const respondDisputed = []
for (let round = 0; round <= MAX_RESPOND_ROUNDS; round++) {
  ghReview = await agent(
    `Read the GitHub review of ${REPO} PR #${ship.prNumber}. Read-only: change nothing.
1. Get the PR's head commit: gh pr view ${ship.prNumber} --repo ${REPO} --json headRefOid --jq .headRefOid
2. Find the "Claude PR review" workflow run for THAT commit:
     gh run list --repo ${REPO} --workflow claude-review.yml --commit <sha> --json databaseId,status,conclusion
   If none exists yet, check again every 30s for up to 5 minutes. If still none, reviewRan=false.
3. Wait for it to finish: gh run watch <id> --repo ${REPO}  (it can take several minutes; keep
   waiting up to 25 minutes in total). If the run was skipped or failed without posting a review,
   reviewRan=false and say why in note.
4. Read the review it posted for this commit. The summary is ONE "sticky" comment by claude
   that each review run edits in place, so check its last-updated time, not its creation time:
     gh api repos/${REPO}/issues/${ship.prNumber}/comments --jq '.[] | select(.user.login=="claude[bot]" or .user.login=="claude") | {updated_at, body}'
   Inline comments are new for each run: gh api repos/${REPO}/pulls/${ship.prNumber}/comments
   Use only the summary UPDATED after the run started, and inline comments CREATED after it,
   so an older round's review is never re-read as current. If the summary wasn't updated by
   this run, reviewRan=false.
5. verdict: exactly the review's own verdict — "looks mergeable", "needs changes" or
   "needs a human". findings: each concrete problem it raised (file, problem, why, severity as
   it states or implies it: blocking/important/minor).`,
    { label: `gh-review-${round + 1}`, phase: 'Respond', schema: GH_REVIEW, model: 'sonnet', effort: 'low' },
  )
  if (!ghReview || !ghReview.reviewRan) {
    respondOutcome = 'no-review'
    log(`GitHub review did not run or could not be read: ${ghReview ? ghReview.note : 'agent died'}`)
    break
  }
  const serious = ghReview.findings.filter(f => f.severity !== 'minor')
  log(`GitHub review round ${round + 1}: ${ghReview.verdict}, ${serious.length} serious finding(s)`)
  if (ghReview.verdict === 'looks mergeable' || (ghReview.verdict === 'needs changes' && !serious.length)) {
    respondOutcome = 'looks mergeable'
    break
  }
  if (ghReview.verdict === 'needs a human') {
    // Expected for protected paths; the loop does not argue with it.
    respondOutcome = 'needs a human'
    break
  }
  if (round === MAX_RESPOND_ROUNDS) {
    respondOutcome = 'unresolved'
    break
  }
  const fix = await agent(
    `${WORKTREE_RULES(wt)}
${AS_BOT}

The independent GitHub reviewer found these problems in PR #${ship.prNumber} (issue #${ISSUE}).
Fix each one. If you are CERTAIN a finding is wrong, put it in \`disputed\` with the reason; a
dispute goes back to the reviewer, so never use it to skip a hard fix. List every finding you
actually fixed in \`fixed\`, with what you changed.
${serious.map(f => `- [${f.severity}] ${f.file}: ${f.problem} — ${f.why}`).join('\n')}

${GATES}

Then, as the bot: commit, push the branch (this triggers a fresh GitHub review of the new
commit), and post ONE comment on PR #${ship.prNumber} listing each finding with one line:
"fixed: <what changed>" or "disputed: <why>". Never call a disputed finding fixed.`,
    { label: `respond-fix-${round + 1}`, phase: 'Respond', schema: FIX, agentType: pre.devRole },
  )
  if (!fix || !fix.gatesPassed) {
    respondOutcome = 'unresolved'
    log(`Respond fix round ${round + 1} failed: ${fix ? fix.gateOutput : 'agent died'}`)
    break
  }
  respondFixed.push(...fix.fixed)
  respondDisputed.push(...fix.disputed)
}

// ── Finish ───────────────────────────────────────────────────────────────────
// Always runs once a PR exists: labels an unresolved PR for Ayush, requests
// auto-merge only when every condition holds, and returns the caller's checkout.
const mayAutoMerge = !SHADOW && respondOutcome === 'looks mergeable' && ship.protectedPaths.length === 0
await agent(
  `${WORKTREE_RULES(wt)}
${AS_BOT}

Finish the agent loop run for PR #${ship.prNumber} (issue #${ISSUE}). Do exactly these steps.
1. ${respondOutcome === 'unresolved'
    ? `The GitHub review still needs changes after ${MAX_RESPOND_ROUNDS} rounds. As the bot: add the label "agent-blocked" to PR #${ship.prNumber}, convert it to draft (gh pr ready ${ship.prNumber} --repo ${REPO} --undo), and comment which findings remain and why the loop stopped.`
    : respondOutcome === 'no-review'
      ? `The GitHub review did not run or could not be read. As the bot, comment on PR #${ship.prNumber} saying so, so a human knows it is unreviewed by the GitHub reviewer.`
      : 'Nothing to label.'}
2. ${mayAutoMerge
    ? `Every condition holds (not shadow mode, the GitHub review says mergeable, no protected paths): as the bot, enable auto-merge with gh pr merge ${ship.prNumber} --repo ${REPO} --auto --merge. GitHub still waits for every required check.`
    : 'Do NOT enable auto-merge and do not run any gh pr merge command.'}
3. Stop any stack you started, then return the checkout to its original branch:
   git checkout "${wt.originalBranch}"  (keep the local issue branch; it is pushed).`,
  { label: 'finish', phase: 'Respond', model: 'haiku', effort: 'low' },
)

return {
  status: respondOutcome === 'unresolved' ? 'agent-blocked' : 'pr-opened',
  issue: ISSUE,
  pr: ship.prUrl,
  protectedPaths: ship.protectedPaths,
  wouldAutoMerge: ship.wouldAutoMerge,
  autoMergeRequested: mayAutoMerge,
  shadow: SHADOW,
  decisions: settled.map(d => `${d.question} → ${d.decision}`),
  findingsFixed: fixedFindings.length,
  findingsDisputed: disputedFindings.length,
  githubReview: respondOutcome,
  githubFindingsFixed: respondFixed.length,
  githubFindingsDisputed: respondDisputed.length,
  lessonsProposed: ship.lessonsProposed,
  checkout: wt.path,
}
