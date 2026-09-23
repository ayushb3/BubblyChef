export const meta = {
  name: 'agent-loop',
  description: 'Take one ready-for-agent issue to a reviewed PR opened as bubblychef-bot: plan, decide, reproduce, implement, verify, review, ship, respond to the GitHub review',
  whenToUse: 'One issue per run. args: {issue: <number>}. Optional: shadow (default true), dryRun (stop after Decide). See docs/plans/2026-09-17-autonomous-agent-loop.md.',
  phases: [
    { title: 'Preflight', detail: 'environment + bot identity, kill switch, daily cap, issue readiness, classify' },
    { title: 'Setup', detail: "fresh branch from main in the session's own checkout" },
    { title: 'Plan', detail: 'dev role reads issue, lessons and code; lists open questions' },
    { title: 'Decide', detail: 'Opus decides each open question, or escalates to Ayush' },
    { title: 'Reproduce', detail: 'bugs: failing test first, before-screenshots (small non-visible bugs do this inside Implement)' },
    { title: 'Implement', detail: 'implement and pass quality gates, max 2 attempts' },
    { title: 'Verify', detail: 'run the real app and walk the flow (verify skill)' },
    { title: 'Review', detail: 'fresh-context Opus review, up to 3 fix rounds' },
    { title: 'Ship', detail: 'commit and PR as bubblychef-bot; or the blocked path' },
    { title: 'Respond', detail: 'read the GitHub review and answer it, max 2 fix rounds (skipped for the small tier); then finish' },
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
const DAILY_CAP = 15
const MAX_IMPLEMENT_ATTEMPTS = 2
// Fix rounds after review: up to 3 fixes, so up to 4 reviews.
const MAX_REVIEW_ROUNDS = 3

// ── Size tiers ───────────────────────────────────────────────────────────────
// Every issue used to run the same pipeline. Measured on small frontend fixes
// (runs for #405/#406, see the PR that added this), the stages that don't earn their
// cost on a small change are: a separate Reproduce agent for a bug nobody can see
// (the CI fail-to-pass job already enforces that its test fails on main), and Respond,
// a second review that waits up to ~25 min for the GitHub reviewer after the in-loop
// Opus review already passed. The tier is decided HERE, in code, from what Plan says
// and then from the real diff. It can only go UP during a run, never down.
//   small     — at most SMALL_MAX_LINES changed lines, SMALL_MAX_FILES files, no
//               protected path. Skips the two stages above. Verify still always runs.
//   standard  — anything else; the full pipeline.
//   protected — touches a .github/CODEOWNERS path; the full pipeline. Never small.
// An unknown size (an agent that didn't report it) is standard, not small.
const SMALL_MAX_LINES = 150
const SMALL_MAX_FILES = 5
const TIER_RANK = { small: 0, standard: 1, protected: 2 }

function sizeTier({ lines, files, protectedPaths }) {
  if (protectedPaths.length) return { tier: 'protected', why: `touches protected path(s): ${protectedPaths.join(', ')}` }
  if (!Number.isInteger(lines) || lines < 0) return { tier: 'standard', why: 'diff size unknown' }
  if (lines > SMALL_MAX_LINES) return { tier: 'standard', why: `${lines} changed lines > ${SMALL_MAX_LINES}` }
  if (files > SMALL_MAX_FILES) return { tier: 'standard', why: `${files} files > ${SMALL_MAX_FILES}` }
  return { tier: 'small', why: `${lines} lines, ${files} files, no protected paths` }
}

// Plumbing stages run as the lean `loop-runner` agent (.claude/agents/loop-runner.md):
// Bash/Read/Grep/Glob only. As default workflow subagents they loaded every tool the
// session has, about 40k tokens of context per agent before doing anything, repeated
// on every call: the largest single cost in the first full pilot run (issue #405).
// Dev-role stages keep their own agent type.
const RUNNER = 'loop-runner'

// How every agent acts as the bot. Kept in one place so no stage improvises it.
const AS_BOT = `
ACTING AS THE BOT — follow exactly; never use Ayush's identity for writes.
- GitHub CLI writes (PRs, comments, labels): prefix with
    GH_TOKEN= GITHUB_TOKEN= GH_CONFIG_DIR="$HOME/.config/gh-bubblychef-bot" gh ...
  The two empty assignments are load-bearing: gh reads GH_TOKEN/GITHUB_TOKEN from the
  environment ahead of anything in GH_CONFIG_DIR, so an ambient token silently wins and
  the write lands as its owner instead of the bot. Clear them on every bot command.
- Commits: git -c user.name="bubblychef-bot" -c user.email="330798838+bubblychef-bot@users.noreply.github.com" commit ...
- Pushes: git -c credential.helper= -c 'credential.helper=!f() { GH_TOKEN= GITHUB_TOKEN= GH_CONFIG_DIR="$HOME/.config/gh-bubblychef-bot" gh auth git-credential "$@"; }; f' push ...
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
// The loop's central safety property is that every write lands as bubblychef-bot.
// GitHub skips code-owner review when the PR author is the only code owner, so a run
// that quietly falls back to Ayush's identity bypasses the protected-path gate while
// looking like a clean run. That is worse than not running at all, so the identity is
// PROBED before anything else and the run stops unless it resolves to the bot.
//
// This is deliberately separate from the Preflight facts: it answers "can this
// environment run the loop at all", which is a different question from "should this
// issue be picked up", and it has to be answered first. Claude Code cloud sessions
// answer it "no" — see issue #474.
const CAPABILITY = {
  type: 'object',
  properties: {
    ghPresent: { type: 'boolean', description: 'true only if `gh --version` exits 0' },
    botLogin: { type: 'string', description: 'the login the bot config dir actually resolves to, or "" if it could not be determined' },
    probe: { type: 'string', description: 'raw trimmed output or error of the identity probe, for the log' },
  },
  required: ['ghPresent', 'botLogin', 'probe'],
}

// Preflight returns RAW FACTS only. The script decides whether to proceed (see
// "Preflight" below): the kill switch and the cap must bind in code, not rest on an
// agent's judgement of its own limits. (Found by the independent review on PR #461.)
const PREFLIGHT = {
  type: 'object',
  properties: {
    agentsEnabled: { type: 'string', description: 'exact output of gh variable get AGENTS_ENABLED, trimmed; "" if the command failed' },
    agentsEnabledRead: { type: 'boolean', description: 'true only if the AGENTS_ENABLED command exited 0. An error message is NOT a value.' },
    runsLast24h: { type: 'integer' },
    issueState: { type: 'string', description: 'OPEN or CLOSED, exactly as gh reports it' },
    issueLabels: { type: 'array', items: { type: 'string' } },
    openPrsForIssue: { type: 'array', items: { type: 'integer' }, description: 'open PR numbers that target this issue' },
    title: { type: 'string' },
    kind: { type: 'string', enum: ['bug', 'feature', 'refactor', 'docs'] },
    devRole: { type: 'string', enum: ['frontend', 'backend', 'ui-ux'] },
    slug: { type: 'string', description: 'kebab-case, <= 5 words' },
    agentsEnabledError: { type: 'string', description: 'error text if the AGENTS_ENABLED read failed, else ""' },
    summary: { type: 'string', description: 'what the issue asks for, 2-3 sentences' },
  },
  required: ['agentsEnabled', 'agentsEnabledRead', 'runsLast24h', 'issueState', 'issueLabels', 'openPrsForIssue', 'title', 'kind', 'devRole', 'slug', 'summary', 'agentsEnabledError'],
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
    expectedChangedLines: { type: 'integer', description: 'your estimate of added + deleted lines in the finished diff, tests included' },
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
  required: ['plan', 'filesToChange', 'protectedPaths', 'expectedChangedLines', 'userVisible', 'questions'],
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
    linesChanged: { type: 'integer', description: 'insertions + deletions from git diff --shortstat origin/main...HEAD' },
    protectedPaths: { type: 'array', items: { type: 'string' }, description: 'files in git diff --name-only origin/main...HEAD matching .github/CODEOWNERS' },
  },
  required: ['gatesPassed', 'gateOutput', 'summary', 'filesChanged', 'linesChanged', 'protectedPaths'],
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
    reviewedSha: { type: 'string', description: 'the headSha of the workflow run whose review you read' },
  },
  required: ['reviewRan', 'verdict', 'findings', 'note', 'reviewedSha'],
}

const SHIP = {
  type: 'object',
  properties: {
    prUrl: { type: 'string' },
    prNumber: { type: 'integer' },
    headSha: { type: 'string', description: 'full SHA of the commit you pushed (git rev-parse HEAD after pushing)' },
    protectedPaths: { type: 'array', items: { type: 'string' } },
    linesChanged: { type: 'integer', description: 'insertions + deletions from git diff --shortstat origin/main...HEAD' },
    filesChanged: { type: 'integer', description: 'number of files in git diff --name-only origin/main...HEAD' },
    wouldAutoMerge: { type: 'boolean' },
    lessonsProposed: { type: 'array', items: { type: 'string' } },
  },
  required: ['prUrl', 'prNumber', 'headSha', 'protectedPaths', 'linesChanged', 'filesChanged', 'wouldAutoMerge', 'lessonsProposed'],
}

// A Respond fix round. Like FIX, plus what it pushed, so the next review read can be
// pinned to that exact commit (never a previous round's review), and the protected
// paths of the WHOLE diff after the fix (a fix can touch a protected file).
const RESPOND_FIX = {
  type: 'object',
  properties: {
    ...FIX.properties,
    pushedSha: { type: 'string', description: 'full SHA you pushed, or "" if you committed nothing (e.g. every finding disputed)' },
    protectedPaths: { type: 'array', items: { type: 'string' }, description: 'files in git diff --name-only origin/main...HEAD matching .github/CODEOWNERS, after your fix' },
  },
  required: [...FIX.required, 'pushedSha', 'protectedPaths'],
}

const FINISH = {
  type: 'object',
  properties: {
    returnedToOriginal: { type: 'boolean', description: 'git branch --show-current (or rev-parse HEAD) now shows the original branch/commit' },
    ranMergeCommand: { type: 'boolean', description: 'you ran any gh pr merge command' },
  },
  required: ['returnedToOriginal', 'ranMergeCommand'],
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
    { agentType: RUNNER, label: 'blocked-path', phase: 'Ship', model: 'sonnet', effort: 'low' },
  )
  return { status: 'agent-blocked', issue: ISSUE, stage, detail, pr: result }
}

// ── Preflight ────────────────────────────────────────────────────────────────
phase('Preflight')

// Step 0: can this environment run the loop as the bot? Nothing else is asked until
// this is settled. Previously the first `gh` call was the kill-switch read, so an
// environment with no `gh` reported its error string as the kill switch's value and
// the run logged `AGENTS_ENABLED is "ERROR: gh CLI not found..."` — which reads as
// "Ayush turned the loop off" and sent the last session diagnosing the wrong thing.
const BOT_LOGIN = 'bubblychef-bot'
const cap = await agent(
  `Report three facts about this environment. Read-only: change nothing, create nothing,
authenticate nothing, and do not try to fix or install anything you find missing.
Report what is true right now, even if the answer is "no" — a false "yes" here lets
writes land under the wrong GitHub account.

1. ghPresent: run  gh --version  and report whether it exited 0.
2. botLogin: if and only if ghPresent, run exactly

     GH_TOKEN= GITHUB_TOKEN= GH_CONFIG_DIR="$HOME/.config/gh-bubblychef-bot" gh api user --jq .login

   and report the trimmed login it prints. If the command fails, or ghPresent is false,
   report botLogin as the empty string. Never substitute the login from a different
   config dir or from \`gh auth status\`, and never report a login the command did not
   actually print.
3. probe: the raw trimmed output (or error text) of that command, for the log.`,
  { agentType: RUNNER, label: 'capability', phase: 'Preflight', schema: CAPABILITY, model: 'sonnet', effort: 'low' },
)
if (!cap) throw new Error('capability agent died')

const envStop =
  !cap.ghPresent
    ? 'environment: the gh CLI is not installed, and the loop shells out to it throughout. ' +
      'See issue #474.'
  : cap.botLogin !== BOT_LOGIN
    ? `environment: writes would be attributed to ${cap.botLogin ? `"${cap.botLogin}"` : 'an unresolved identity'}, ` +
      `not ${BOT_LOGIN}. GitHub skips code-owner review when the PR author is the only code owner, ` +
      `so this run would open PRs that silently bypass the protected-path gate. Probe said: ${cap.probe}. ` +
      'See issue #474.'
  : ''
// Both Preflight gates end the same way, so the shape lives in one place: a third
// gate should not have to copy it (and get it subtly wrong).
const skip = reason => {
  if (!reason) return null
  log(`Not starting: ${reason}`)
  return { status: 'skipped', issue: ISSUE, reason }
}

const envSkip = skip(envStop)
if (envSkip) return envSkip
log(`Environment OK: writes resolve to ${cap.botLogin}`)

const pre = await agent(
  `Gather facts for the agent loop on ${REPO} issue #${ISSUE}. Read-only: change nothing,
and do not judge whether the run should proceed: report the raw values exactly.
Use the default \`gh\` (Ayush's login) for these reads.

1. agentsEnabled / agentsEnabledRead: run  gh variable get AGENTS_ENABLED --repo ${REPO}
   If it exits 0, agentsEnabledRead=true and agentsEnabled is its trimmed output.
   If it exits non-zero FOR ANY REASON — no such subcommand on an older gh, no
   permission, no network — agentsEnabledRead=false and agentsEnabled is "", with the
   error text in agentsEnabledError. Never report an error message as the value: doing
   that is what made a missing gh look like a kill switch someone had deliberately set.
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
  { agentType: RUNNER, label: 'preflight', phase: 'Preflight', schema: PREFLIGHT, model: 'sonnet', effort: 'low' },
)
if (!pre) throw new Error('preflight agent died')
log(`Issue #${ISSUE}: ${pre.title} — ${pre.kind}, ${pre.devRole}; runs in last 24h ${pre.runsLast24h}/${DAILY_CAP}`)

// The go/no-go is decided HERE, from the raw facts — not by the agent.
const stopReason =
  !pre.agentsEnabledRead ? `could not read the kill switch: \`gh variable get AGENTS_ENABLED\` failed (${pre.agentsEnabledError || 'no error text'}). ` +
    'The loop does not run while its own off switch is unreadable — and an unreadable switch is not a switch that is set.'
  : pre.agentsEnabled !== 'true' ? `kill switch: AGENTS_ENABLED is "${pre.agentsEnabled}", not "true"`
  : pre.runsLast24h >= DAILY_CAP ? `daily cap: ${pre.runsLast24h} loop PRs in the last 24h (cap ${DAILY_CAP})`
  : pre.issueState !== 'OPEN' ? `issue #${ISSUE} is ${pre.issueState}`
  : !pre.issueLabels.includes('ready-for-agent') ? `issue #${ISSUE} is not labelled ready-for-agent`
  : pre.openPrsForIssue.length ? `issue #${ISSUE} already has open PR(s): ${pre.openPrsForIssue.map(n => '#' + n).join(', ')}`
  : ''
const preSkip = skip(stopReason)
if (preSkip) return preSkip

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
  { agentType: RUNNER, label: 'setup', phase: 'Setup', schema: SETUP, model: 'sonnet', effort: 'low' },
)
if (!wt || !wt.ok) {
  // A half-finished Setup must not leave the issue branch checked out: the next run would
  // find the branch already exists and block on this issue forever. Nothing has been
  // committed yet, so dropping it loses nothing. (Found by the independent review on PR #461.)
  if (wt && wt.branchCreated) {
    await agent(
      `A failed setup left an issue branch behind. In ${wt.path}: git checkout "${wt.originalBranch}" then git branch -D "${wt.branch}". Nothing was committed on it. Nothing else.`,
      { agentType: RUNNER, label: 'setup-cleanup', phase: 'Setup', model: 'haiku', effort: 'low' },
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
  questions; an issue that is clear gets an empty list.
  ALWAYS include as a question any change a user would notice beyond what the issue
  literally describes, even when you are confident it is correct: for example, the
  fix also changes what gets saved, which items are selected by default, or copy the
  user sees elsewhere. Frame it as "should we also <change>?", with your take. The
  decision step routes those to Ayush. (Issue #406's fix also stopped medium-confidence
  scanned items being added automatically; nobody was asked, and in non-shadow mode it
  would have merged unseen.)`,
  { label: 'plan', phase: 'Plan', schema: PLAN, agentType: pre.devRole },
)
if (!plan) return await blocked(wt, 'Plan', 'plan agent died', pre)
log(`Plan: ${plan.filesToChange.length} files, ${plan.protectedPaths.length} protected, ${plan.questions.length} open questions`)

// The tier starts from Plan's estimate and is re-checked against the real diff after
// Implement and again at Ship. raiseTier never lowers it: a change that turns out bigger
// than planned gets the fuller pipeline, one that turns out smaller keeps what it had.
let tier = sizeTier({ lines: plan.expectedChangedLines, files: plan.filesToChange.length, protectedPaths: plan.protectedPaths })
const tierLog = [`plan: ${tier.tier} (${tier.why})`]
log(`Tier: ${tier.tier} — ${tier.why}`)
function raiseTier(stage, facts) {
  const next = sizeTier(facts)
  tierLog.push(`${stage}: ${next.tier} (${next.why})`)
  if (TIER_RANK[next.tier] > TIER_RANK[tier.tier]) {
    log(`Tier raised at ${stage}: ${tier.tier} → ${next.tier} — ${next.why}`)
    tier = next
  }
}

// ── Decide ───────────────────────────────────────────────────────────────────
// A strong model settles ambiguity with the implementer's view as input. It
// escalates to Ayush only for protected areas or product behaviour the issue
// doesn't describe — those need him at merge anyway, so asking up front is cheaper.
// One agent per open question, in every tier, so a clear issue runs no Decide agent at all.
phase('Decide')
if (!plan.questions.length) log('Decide: no open questions, no decision agents run')
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
  { agentType: RUNNER, label: `decide-${i + 1}`, phase: 'Decide', schema: DECISION, model: 'opus', effort: 'high' },
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
    { agentType: RUNNER, label: 'escalate', phase: 'Ship', model: 'sonnet', effort: 'low' },
  )
  return { status: 'needs-decision', issue: ISSUE, questions: escalations.map(d => d.question) }
}
const DECIDED = settled.length
  ? `Decisions already made for you (follow them; do not reopen them):\n${settled.map(d => `- ${d.question} → ${d.decision}`).join('\n')}`
  : 'No open questions: the issue is clear.'

if (DRY_RUN) {
  log('Dry run: stopping after Decide and removing the issue branch.')
  await agent(`In ${wt.path}: git checkout "${wt.originalBranch}" and then git branch -D "${wt.branch}". Nothing was committed on it. Nothing else.`,
    { agentType: RUNNER, label: 'dry-run-cleanup', phase: 'Decide', model: 'haiku', effort: 'low' })
  return { status: 'dry-run', issue: ISSUE, pre, plan, decisions: settled, tier: tier.tier, tierLog }
}

// ── Reproduce (bugs only) ────────────────────────────────────────────────────
// A small bug nobody can see skips this stage: the implementer writes the failing test
// first, in the same agent, and the CI fail-to-pass job checks it fails on main. A
// user-visible bug always reproduces here, because the before-screenshots have to be
// taken on the unfixed code.
let repro = null
const reproduceInImplement = pre.kind === 'bug' && tier.tier === 'small' && !plan.userVisible
if (reproduceInImplement) log('Reproduce: small, not user-visible bug — the failing test is written first inside Implement')
if (pre.kind === 'bug' && !reproduceInImplement) {
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

// One verify prompt, used for the first verification and for the re-verification
// after review fixes, so both walk the same flow to the same standard.
function verifyPrompt(summary, recheckNote) {
  return `${WORKTREE_RULES(wt)}
${AS_BOT}

Verify issue #${ISSUE} ("${pre.title}") by following .claude/skills/verify/SKILL.md exactly,
in the checkout above. What was implemented: ${summary}
${recheckNote}
${repro && repro.beforeScreenshots.length ? `Before-screenshots already exist: ${repro.beforeScreenshots.join(', ')}. Take the matching -after.png shots${recheckNote ? ', replacing any earlier -after shots' : ''}.` : ''}
${plan.userVisible ? '' : 'The change is not user-visible: verify its observable effect as the skill describes for backend-only changes, or mark applicable=false only if there is genuinely no runtime behaviour to check.'}

Walk the flow the issue describes AND its neighbours. Check both health endpoints report
the checkout's HEAD. Run the smoke suite. Always run scripts/dev/stack.sh down at the end.
Commit screenshots as the bot. Never report verified=true for anything you did not run.`
}

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
${repro ? `A failing test already reproduces the bug: ${repro.testFiles.join(', ')}. Make it pass by fixing the cause. Do not weaken, skip or delete it.`
  : reproduceInImplement ? `This is a bug. BEFORE changing any code, write the smallest unit test that reproduces it (Jest for nextjs, pytest for ai-service), run it, and confirm it FAILS on the current code for the reason the bug describes. Only then fix the cause. The CI fail-to-pass job re-runs your test against main and fails the PR if it passes there.`
  : 'Add tests for the new behaviour alongside the code.'}
${feedback ? `\nThis is attempt ${attempt}. The previous attempt failed:\n${feedback}\nFix the cause, not the symptom.` : ''}

Follow CLAUDE.md's Dev Guidelines. Stay within the issue: if you find an unrelated bug,
note it in your summary instead of fixing it. Never delete or skip an existing test.

${GATES}

When the gates pass, commit as the bot with a message that says what changed and why.
Do not push. Report linesChanged (insertions + deletions from git diff --shortstat origin/main...HEAD)
and protectedPaths (files in git diff --name-only origin/main...HEAD matching .github/CODEOWNERS).`,
    { label: `implement-${attempt}`, phase: 'Implement', schema: IMPLEMENT, agentType: pre.devRole },
  )
  if (!impl) return await blocked(wt, 'Implement', 'implement agent died', pre)
  raiseTier(`implement-${attempt}`, { lines: impl.linesChanged, files: (impl.filesChanged || []).length, protectedPaths: impl.protectedPaths || [] })
  if (!impl.gatesPassed) {
    feedback = `Quality gates failed:\n${impl.gateOutput}`
    log(`Attempt ${attempt}: gates failed`)
    continue
  }

  phase('Verify')
  verify = await agent(verifyPrompt(impl.summary, ''), { label: `verify-${attempt}`, phase: 'Verify', schema: VERIFY, agentType: pre.devRole })
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
let fixRounds = 0
for (let round = 1; round <= MAX_REVIEW_ROUNDS + 1; round++) {
  phase('Review')
  review = await agent(
    `You are reviewing a change you did not write. Work in ${wt.path} (cd into it); do not edit anything.
Diff: git diff origin/main...HEAD. The issue: gh issue view ${ISSUE} --repo ${REPO} --comments.
What the implementer says it did: ${impl.summary}
Verification evidence: ${verify.evidence}
${fixRounds ? `\nNOTE: that verification was done BEFORE ${fixRounds} fix round(s) changed the code. The loop re-runs verification on the final commit before the PR is opened, so do not raise stale evidence by itself as a finding: judge the CURRENT code, and raise any behaviour you believe the fixes broke.` : ''}
${disputedFindings.length ? `\nThe implementer disputed these earlier findings. Judge each on its merits; raise it again only if the dispute is wrong:\n${disputedFindings.map(d => `- ${d.finding} — implementer says: ${d.reason}`).join('\n')}` : ''}

Review against the issue and CLAUDE.md. In priority order: behaviour that doesn't match
the issue or the claims; bugs (anything that passes tests but is wrong); security
(missing requireAuth, RLS, data crossing users); tests that don't really test the change
or were weakened; guideline violations. Only concrete problems, each with why it matters.
Skip style the linters enforce.
verdict=mergeable only if nothing blocking or important remains.`,
    { agentType: RUNNER, label: `review-${round}`, phase: 'Review', schema: REVIEW, model: 'opus' },
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
  fixRounds++
}

// ── Re-verify after review fixes ─────────────────────────────────────────────
// Verification ran before the review's fix rounds, so once a fix changes the code the
// evidence describes older code. The blocked #402 run (PR #471) shipped-to-draft exactly
// that: screenshots and a walkthrough of behaviour three commits had since changed.
// So if any fix round happened, verify again on the final commit, and the PR carries
// only that fresh evidence. A failed re-verification takes the blocked path.
if (fixRounds > 0) {
  phase('Verify')
  const recheck = await agent(
    verifyPrompt(
      `${impl.summary}\nThen ${fixRounds} review fix round(s) changed it further: ${fixedFindings.join('; ') || 'see git log'}.`,
      'THIS IS A RE-VERIFICATION: the code changed after the first verification. Verify the CURRENT HEAD from scratch; do not reuse or trust any earlier result. Check the health endpoints report the current HEAD.',
    ),
    { label: 'verify-recheck', phase: 'Verify', schema: VERIFY, agentType: pre.devRole },
  )
  if (!recheck) return await blocked(wt, 'Verify', 're-verification agent died', pre)
  if (!(recheck.verified || recheck.applicable === false)) {
    return await blocked(wt, 'Verify', `Re-verification after ${fixRounds} review fix round(s) failed on the final commit:\n${recheck.problems}`, pre)
  }
  verify = recheck
  log(`Re-verified on the final commit after ${fixRounds} fix round(s)`)
}

// ── Ship ─────────────────────────────────────────────────────────────────────
phase('Ship')
const ship = await agent(
  `${WORKTREE_RULES(wt)}
${AS_BOT}

Open the PR for issue #${ISSUE}: "${pre.title}".

1. Work out which changed files match .github/CODEOWNERS (git diff --name-only origin/main...HEAD),
   and report linesChanged (insertions + deletions from git diff --shortstat origin/main...HEAD)
   and filesChanged (the number of files in that diff).
2. Push the branch as the bot, then record headSha = \`git rev-parse HEAD\` (the exact commit
   the GitHub review will run on).
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
   - Loop tier: ${tier.tier} (${tier.why}).${tier.tier === 'small' ? ' If the final diff is still small, the loop does NOT wait for or answer the GitHub review on this PR (it passed the in-loop review); a human reads it before merging.' : ''}
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
  { agentType: RUNNER, label: 'ship', phase: 'Ship', schema: SHIP, model: 'sonnet' },
)
if (!ship) return await blocked(wt, 'Ship', 'ship agent died before the PR was confirmed', pre)
// The final diff, after any review fixes, is what decides whether Respond may be skipped.
raiseTier('ship', { lines: ship.linesChanged, files: ship.filesChanged, protectedPaths: ship.protectedPaths || [] })

// ── Respond ──────────────────────────────────────────────────────────────────
// The GitHub reviewer (claude-review.yml) reviews the PR from a context that never saw
// this run, and in practice it finds things the in-loop review missed. Its findings used
// to sit unread on the PR until a human got to them, which kept the human as the
// bottleneck. Respond reads that review and answers it, with the same rules as the
// in-loop review: each finding fixed or disputed with a reason, reported separately,
// and a hard cap on rounds.
//
// Every review read is PINNED TO AN EXACT COMMIT, checked here in code: the reader must
// report the SHA of the run it read, and anything else is treated as "no review", never
// as approval. Without that, a read could pick up a previous round's review (GitHub
// updates the PR head asynchronously after a push, and a round that only disputes
// pushes nothing, so no new review runs). (Found by an independent review of PR #463.)
//
// Re-reviews: claude-review.yml also fires on pushes to PRs labelled `agent-loop`, so
// each fix push gets a fresh GitHub review of the new commit.
//
// Small tier: skipped. The in-loop Opus review already passed, and it's the one that
// runs before the PR opens, so the fixes it asks for are re-verified before any evidence
// goes into the PR. The GitHub reviewer still runs and posts on the PR for a human; the
// loop just doesn't wait on it. And because auto-merge needs that reviewer's "looks
// mergeable", a small-tier PR is never auto-merged: this saves time, it doesn't lower the bar.
phase('Respond')
const MAX_RESPOND_ROUNDS = 2
let expectedSha = ship.headSha
let protectedNow = [...ship.protectedPaths]
let ghReview = null
let respondOutcome = 'looks mergeable'
const respondFixed = []
const respondDisputed = []
const skipRespond = tier.tier === 'small'
if (skipRespond) {
  respondOutcome = 'not read (small tier)'
  log('Respond: small tier — not waiting for the GitHub review; a human reads it, and no auto-merge')
}
for (let round = 0; !skipRespond && round <= MAX_RESPOND_ROUNDS; round++) {
  ghReview = await agent(
    `Read the GitHub review of ${REPO} PR #${ship.prNumber} for ONE exact commit. Read-only: change nothing.
Expected head commit: ${expectedSha}
1. Wait until GitHub shows that commit as the PR head: poll
     gh pr view ${ship.prNumber} --repo ${REPO} --json headRefOid --jq .headRefOid
   every 20s for up to 5 minutes until it equals the expected commit. If it never does,
   reviewRan=false and say so.
2. List the "Claude PR review" runs for that commit:
     gh run list --repo ${REPO} --workflow claude-review.yml --commit ${expectedSha} --json databaseId,headSha,status,conclusion,createdAt
   Use the NEWEST run whose conclusion is not "cancelled" (rapid pushes cancel older runs).
   If none exists yet, check again every 30s for up to 5 minutes; if still none, reviewRan=false.
3. Wait for it to finish: gh run watch <id> --repo ${REPO}. It can take several minutes; if a
   single watch times out, run it again, up to 25 minutes in total. A run that ends
   "skipped" or "failure" without posting a review means reviewRan=false, with why in note.
4. Read the review THAT run posted. The summary is ONE "sticky" comment by claude that each
   run edits in place, so use its last-updated time, not its creation time:
     gh api repos/${REPO}/issues/${ship.prNumber}/comments --jq '.[] | select(.user.login=="claude[bot]" or .user.login=="claude") | {updated_at, body}'
   Inline comments are new for each run: gh api repos/${REPO}/pulls/${ship.prNumber}/comments
   Use only the summary UPDATED after the run started, and inline comments CREATED after it.
   If the summary wasn't updated by this run, reviewRan=false.
5. reviewedSha: the headSha of the run you read. verdict: exactly the review's own verdict —
   "looks mergeable", "needs changes" or "needs a human". findings: each concrete problem it
   raised (file, problem, why, and severity as it states it; if it doesn't state one, use
   "important", never guess "minor").`,
    { agentType: RUNNER, label: `gh-review-${round + 1}`, phase: 'Respond', schema: GH_REVIEW, model: 'sonnet', effort: 'low' },
  )
  // Enforced here, not by the reader: a review of any other commit is not a review of this one.
  if (!ghReview || !ghReview.reviewRan || ghReview.reviewedSha !== expectedSha) {
    respondOutcome = 'no-review'
    log(`No usable GitHub review for ${expectedSha.slice(0, 8)}: ${!ghReview ? 'agent died' : !ghReview.reviewRan ? ghReview.note : `it read ${String(ghReview.reviewedSha).slice(0, 8)} instead`}`)
    break
  }
  const serious = ghReview.findings.filter(f => f.severity !== 'minor')
  log(`GitHub review round ${round + 1}: ${ghReview.verdict}, ${serious.length} serious finding(s)`)
  if (ghReview.verdict === 'looks mergeable') { respondOutcome = 'looks mergeable'; break }
  if (ghReview.verdict === 'needs a human') { respondOutcome = 'needs a human'; break }  // expected for protected paths
  if (ghReview.verdict === 'needs changes' && !serious.length) {
    // The reviewer still said "needs changes"; only minor points remain. The PR stands,
    // but this is NOT the reviewer's approval, so it can never lead to auto-merge.
    respondOutcome = 'minor only'
    break
  }
  if (round === MAX_RESPOND_ROUNDS) { respondOutcome = 'unresolved'; break }

  const fix = await agent(
    `${WORKTREE_RULES(wt)}
${AS_BOT}

The independent GitHub reviewer found these problems in PR #${ship.prNumber} (issue #${ISSUE}).
Fix each one. If you are CERTAIN a finding is wrong, put it in \`disputed\` with the reason.
List every finding you actually fixed in \`fixed\`, with what you changed.
${serious.map(f => `- [${f.severity}] ${f.file}: ${f.problem} — ${f.why}`).join('\n')}

${GATES}

If your fix changes anything a user can see or trigger, the PR's verification evidence now
describes older code. Before pushing, re-verify that flow on your new commit by following
.claude/skills/verify/SKILL.md (stack up, walk the flow, health endpoints report the new HEAD,
smoke suite, stack down), replace the affected -after screenshots, and update the PR's
Verified section to match (gh pr edit ${ship.prNumber} --repo ${REPO} --body-file ... as the bot).
Say in your resolutions comment that it was re-verified. Never leave evidence in the PR that
describes code that has since changed.

Then, as the bot:
- If you changed anything: commit, push the branch (this triggers a fresh GitHub review of the
  new commit), and set pushedSha to \`git rev-parse HEAD\`.
- If you only disputed and changed nothing: do not make an empty commit; set pushedSha to "".
  A dispute with no new commit cannot be re-reviewed, so the loop hands it to Ayush.
- Post ONE comment on PR #${ship.prNumber} listing each finding with one line:
  "fixed: <what changed>" or "disputed: <why>". Never call a disputed finding fixed.
- protectedPaths: files in \`git diff --name-only origin/main...HEAD\` matching .github/CODEOWNERS.`,
    { label: `respond-fix-${round + 1}`, phase: 'Respond', schema: RESPOND_FIX, agentType: pre.devRole },
  )
  if (!fix || !fix.gatesPassed) {
    respondOutcome = 'unresolved'
    log(`Respond fix round ${round + 1} failed: ${fix ? fix.gateOutput : 'agent died'}`)
    break
  }
  respondFixed.push(...fix.fixed)
  respondDisputed.push(...fix.disputed)
  protectedNow = [...new Set([...protectedNow, ...fix.protectedPaths])]
  if (!fix.pushedSha || fix.pushedSha === expectedSha) {
    // Nothing new pushed means nothing new to review: re-reading would only return the
    // same review. "The same commit as before" counts as nothing pushed, since an agent
    // may report the current head instead of "". (Found by re-review of PR #463.)
    // The disagreement is Ayush's to settle.
    respondOutcome = 'needs a human'
    log('Every remaining finding was disputed and nothing was pushed: handing to Ayush.')
    break
  }
  expectedSha = fix.pushedSha
}

// ── Finish ───────────────────────────────────────────────────────────────────
// Always runs once a PR exists: labels an unresolved PR for Ayush, requests auto-merge
// only when EVERY condition holds, and returns the caller's checkout. Auto-merge needs
// the reviewer's own "looks mergeable" on the exact final commit, and protected paths
// are taken from the WHOLE diff after any Respond fixes, not just what Ship saw.
const mayAutoMerge = !SHADOW && respondOutcome === 'looks mergeable' && protectedNow.length === 0
const finishPrompt = `${WORKTREE_RULES(wt)}
${AS_BOT}

Finish the agent loop run for PR #${ship.prNumber} (issue #${ISSUE}). Do exactly these steps.
1. ${respondOutcome === 'unresolved'
    ? `The GitHub review still needs changes after ${MAX_RESPOND_ROUNDS} rounds. As the bot: add the label "agent-blocked" to PR #${ship.prNumber}, convert it to draft (gh pr ready ${ship.prNumber} --repo ${REPO} --undo), and comment which findings remain and why the loop stopped.`
    : respondOutcome === 'no-review'
      ? `The GitHub review did not run, or could not be read for the final commit. As the bot, comment on PR #${ship.prNumber} saying so, so a human knows it is unreviewed by the GitHub reviewer.`
      : respondOutcome === 'needs a human'
        ? `The GitHub review needs a human (a protected path, or findings disputed without a new commit). As the bot, comment on PR #${ship.prNumber} saying what Ayush needs to decide.`
        : 'Nothing to label.'}
2. ${mayAutoMerge
    ? `Every condition holds (not shadow mode; the GitHub review of the final commit says "looks mergeable"; no protected paths): as the bot, enable auto-merge with gh pr merge ${ship.prNumber} --repo ${REPO} --auto --merge. GitHub still waits for every required check.`
    : 'Do NOT enable auto-merge and do not run any gh pr merge command.'}
3. Stop any stack you started, then return the checkout to its original branch:
   git checkout "${wt.originalBranch}"  (keep the local issue branch; it is pushed).
   Report whether that worked, and whether you ran any gh pr merge command.`
let fin = await agent(finishPrompt, { agentType: RUNNER, label: 'finish', phase: 'Respond', schema: FINISH, model: 'haiku', effort: 'low' })
if (!fin) {
  // The finish agent died: its labelling and drafting of an unresolved PR matter as much
  // as the checkout, so re-run the whole step once, not just the checkout.
  fin = await agent(finishPrompt, { agentType: RUNNER, label: 'finish-retry', phase: 'Respond', schema: FINISH, model: 'haiku', effort: 'low' })
}
if (!fin || !fin.returnedToOriginal) {
  // Never leave a human's checkout parked on the issue branch because one agent failed.
  await agent(
    `In ${wt.path}: run  git checkout "${wt.originalBranch}"  and confirm with git branch --show-current. Nothing else.`,
    { agentType: RUNNER, label: 'finish-fallback', phase: 'Respond', model: 'haiku', effort: 'low' },
  )
}
if (fin && fin.ranMergeCommand && !mayAutoMerge) {
  // Undo, don't just warn: a forbidden auto-merge left on would merge once checks pass.
  log('WARNING: the finish agent ran gh pr merge when it was not allowed to. Disabling auto-merge.')
  await agent(
    `${AS_BOT}
As the bot, run: gh pr merge ${ship.prNumber} --repo ${REPO} --disable-auto
Then comment on PR #${ship.prNumber}: "Auto-merge was enabled by the agent loop in error and has been disabled; a human must merge this PR." Nothing else.`,
    { agentType: RUNNER, label: 'undo-auto-merge', phase: 'Respond', model: 'haiku', effort: 'low' },
  )
}

return {
  status: respondOutcome === 'unresolved' ? 'agent-blocked' : 'pr-opened',
  issue: ISSUE,
  pr: ship.prUrl,
  protectedPaths: protectedNow,
  wouldAutoMerge: ship.wouldAutoMerge,
  autoMergeRequested: mayAutoMerge,
  mergeRuleBroken: !!(fin && fin.ranMergeCommand && !mayAutoMerge),
  shadow: SHADOW,
  decisions: settled.map(d => `${d.question} → ${d.decision}`),
  findingsFixed: fixedFindings.length,
  findingsDisputed: disputedFindings.length,
  githubReview: respondOutcome,
  tier: tier.tier,
  tierLog,
  githubFindingsFixed: respondFixed.length,
  githubFindingsDisputed: respondDisputed.length,
  lessonsProposed: ship.lessonsProposed,
  checkout: wt.path,
}
