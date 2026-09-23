// Behavioural tests for the agent loop's CONTROL FLOW (.claude/workflows/agent-loop.js).
//
// Runs the real script with agent() mocked, so no model is called and nothing is
// written. It checks the parts that must hold no matter what any agent says: the
// preflight stops are decided in code, a failed Setup cleans up after itself, review
// gets exactly MAX_REVIEW_ROUNDS fix rounds, and a disputed finding is never
// reported as fixed. These are the loop's limits; a later edit that weakens one
// should fail here, in CI, before it can merge.
//
//   node scripts/agent-gates/agent-loop-harness.cjs     (exit 1 on any failure)
'use strict'
const fs = require('fs')
const path = require('path')

const SCRIPT = path.join(__dirname, '..', '..', '.claude', 'workflows', 'agent-loop.js')
const body = fs.readFileSync(SCRIPT, 'utf8').replace('export const meta', 'const meta')

// Build the script as a function of its runtime hooks, the way the Workflow runtime does.
// eslint-disable-next-line no-new-func
const makeRun = new Function('args', 'agent', 'parallel', 'phase', 'log', `return (async () => {\n${body}\n})()`)

function harness(respond) {
  const calls = []
  const prompts = {}
  const opts = {}
  let fixN = 0
  const optsSeen = opts
  const agent = async (prompt, opts) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    optsSeen[opts.label] = opts
    let r = await respond(opts.label, prompt)
    // SHA plumbing, so each test only has to state what it is about. A gh-review mock
    // that doesn't name the commit it read is taken to have read the expected one; a
    // Respond fix that doesn't say what it pushed is taken to have pushed a new commit.
    if (r && typeof r === 'object' && opts.label.startsWith('gh-review') && r.reviewedSha === undefined) {
      const m = /Expected head commit: (\S+)/.exec(prompt)
      r = { ...r, reviewedSha: m ? m[1] : '' }
    }
    if (r && typeof r === 'object' && opts.label.startsWith('respond-fix')) {
      r = { ...r, pushedSha: r.pushedSha === undefined ? `sha-fix-${++fixN}` : r.pushedSha, protectedPaths: r.protectedPaths || [] }
    }
    if (opts.label === 'finish' && (r === 'none' || r === undefined)) r = { returnedToOriginal: true, ranMergeCommand: false }
    return r
  }
  const parallel = async thunks => Promise.all(thunks.map(t => t()))
  return {
    calls,
    prompts,
    opts,
    run: args => makeRun(args, agent, parallel, () => {}, () => {}),
  }
}

const FACTS = {
  agentsEnabled: 'true', agentsEnabledRead: true, agentsEnabledError: '', runsLast24h: 0, issueState: 'OPEN', issueLabels: ['ready-for-agent'],
  openPrsForIssue: [], title: 'T', kind: 'feature', devRole: 'frontend', slug: 's', summary: 'x',
}
const SETUP_OK = { ok: true, branchCreated: true, path: '/wt', branch: 'feat/x', originalBranch: 'main', problem: '' }
// The environment probe every other test needs to pass before it reaches its own subject.
const CAPABILITY_OK = { ghPresent: true, botLogin: 'bubblychef-bot', probe: 'bubblychef-bot' }
const HAPPY = (label, extra = {}) => {
  if (label === 'capability') return extra.capability || CAPABILITY_OK
  if (label === 'preflight') return extra.facts || FACTS
  if (label === 'setup') return extra.setup || SETUP_OK
  if (label === 'plan') return { plan: 'p', filesToChange: ['a.ts'], protectedPaths: [], userVisible: true, questions: [] }
  if (label.startsWith('implement')) return { gatesPassed: true, gateOutput: 'ok', summary: 'did it', filesChanged: ['a.ts'] }
  if (label.startsWith('verify')) return { verified: true, applicable: true, commitVerified: 'abc', evidence: 'e', screenshots: [], problems: '', couldNotVerify: '' }
  if (label.startsWith('review')) return { verdict: 'mergeable', findings: [] }
  if (label === 'ship') return { prUrl: 'u', prNumber: 1, headSha: 'sha-ship', protectedPaths: extra.protectedPaths || [], wouldAutoMerge: true, lessonsProposed: [] }
  if (label.startsWith('gh-review')) return { reviewRan: true, verdict: 'looks mergeable', findings: [], note: '' }
  return 'none'
}

let failures = 0
function check(name, cond, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

async function main() {
  // ── Preflight: every stop is decided by the script, and nothing else runs ──
  const stops = [
    ['kill switch off', { agentsEnabled: 'false' }, /kill switch: AGENTS_ENABLED is "false"/],
    // The bug #474 was filed about: a FAILED READ was reported as the switch's VALUE,
    // so "gh: unknown command" read as "Ayush turned the loop off". Still reachable on a
    // laptop whose gh predates `gh variable get`, where the identity gate passes first.
    ['kill switch unreadable', { agentsEnabledRead: false, agentsEnabled: '', agentsEnabledError: 'unknown command "get" for "gh variable"' }, /could not read the kill switch/],
    ['an unreadable switch is never reported as a set one', { agentsEnabledRead: false, agentsEnabled: 'ERROR: gh not found', agentsEnabledError: 'command not found' }, /could not read the kill switch/],
    ['kill switch empty', { agentsEnabled: '' }, /kill switch/],
    ['daily cap reached', { runsLast24h: 15 }, /daily cap/],
    ['issue closed', { issueState: 'CLOSED' }, /CLOSED/],
    ['not ready-for-agent', { issueLabels: ['bug'] }, /not labelled ready-for-agent/],
    ['PR already open', { openPrsForIssue: [470] }, /already has open PR/],
  ]
  for (const [name, override, reason] of stops) {
    const h = harness(label => HAPPY(label, { facts: { ...FACTS, ...override } }))
    const r = await h.run({ issue: 405 })
    check(`preflight stops: ${name}`, r.status === 'skipped' && reason.test(r.reason) && h.calls.join() === 'capability,preflight',
      `got ${r.status} "${r.reason}", agents: ${h.calls.join()}`)
  }
  {
    const h = harness(label => HAPPY(label, { facts: { ...FACTS, runsLast24h: 14 } }))
    const r = await h.run({ issue: 405, dryRun: true })
    check('preflight allows 14 runs in 24h (under cap)', r.status === 'dry-run', `got ${r.status}`)
  }

  // ── The bot-identity gate: nothing at all runs in an environment that would
  // write as the wrong account. This is the loop's central safety property —
  // GitHub skips code-owner review when the PR author is the only code owner, so
  // a run that falls back to Ayush's identity bypasses the protected-path gate
  // while looking clean. It is checked before the issue is even read, so these
  // stops must fire with ONLY the probe having run.
  const envStops = [
    ['no gh binary', { ghPresent: false, botLogin: '', probe: 'command not found' }, /gh CLI is not installed/],
    ['identity resolves to a human', { ghPresent: true, botLogin: 'ayushb3', probe: 'ayushb3' }, /attributed to "ayushb3", not bubblychef-bot/],
    ['identity cannot be resolved', { ghPresent: true, botLogin: '', probe: 'exit 4' }, /an unresolved identity/],
    ['identity is some other bot', { ghPresent: true, botLogin: 'other-bot', probe: 'other-bot' }, /attributed to "other-bot"/],
    // Exact match only — not a prefix, suffix, case-fold or a stray trailing space.
    ['lookalike: suffixed', { ghPresent: true, botLogin: 'bubblychef-bot2', probe: 'x' }, /attributed to "bubblychef-bot2"/],
    ['lookalike: prefixed', { ghPresent: true, botLogin: 'not-bubblychef-bot', probe: 'x' }, /attributed to "not-bubblychef-bot"/],
    ['lookalike: different case', { ghPresent: true, botLogin: 'Bubblychef-Bot', probe: 'x' }, /attributed to "Bubblychef-Bot"/],
    ['lookalike: trailing space', { ghPresent: true, botLogin: 'bubblychef-bot ', probe: 'x' }, /attributed to "bubblychef-bot "/],
  ]
  for (const [name, capability, reason] of envStops) {
    const h = harness(label => HAPPY(label, { capability }))
    const r = await h.run({ issue: 405 })
    check(`environment stops: ${name}`, r.status === 'skipped' && reason.test(r.reason) && h.calls.join() === 'capability',
      `got ${r.status} "${r.reason}", agents: ${h.calls.join()}`)
  }
  {
    // ...and the probe itself must never be told to fix what it finds: an agent
    // that installs gh or authenticates something would defeat the whole check.
    const h = harness(label => HAPPY(label, { capability: CAPABILITY_OK }))
    await h.run({ issue: 405, dryRun: true })
    const p = h.prompts.capability || ''
    check('the capability probe is read-only and cannot self-heal',
      /Read-only/.test(p) && /do not try to fix or install anything/.test(p) && /authenticate nothing/.test(p),
      'capability prompt')
    check('the capability probe clears ambient tokens before resolving the identity',
      /GH_TOKEN= GITHUB_TOKEN= GH_CONFIG_DIR=/.test(p), 'capability prompt')
  }
  {
    // Every bot write clears the ambient token: gh reads GH_TOKEN/GITHUB_TOKEN
    // ahead of GH_CONFIG_DIR, so without this the write lands as that token's owner.
    // A full run, NOT dryRun: dryRun returns after Decide, so no AS_BOT-derived prompt
    // (ship, respond-fix, blocked-path, finish, escalate) is ever emitted and the check
    // passes vacuously against the capability probe alone. botPrompts.length > 1 pins
    // that: with dryRun the count is 1 and this fails.
    const h = harness(label => HAPPY(label))
    await h.run({ issue: 405 })
    const botPrompts = Object.entries(h.prompts).filter(([, v]) => /GH_CONFIG_DIR="\$HOME\/\.config\/gh-bubblychef-bot"/.test(v))
    const bad = botPrompts.filter(([, v]) =>
      /(?<!GH_TOKEN= GITHUB_TOKEN= )GH_CONFIG_DIR="\$HOME\/\.config\/gh-bubblychef-bot" gh /.test(v))
    check('every bot gh command clears GH_TOKEN/GITHUB_TOKEN first', bad.length === 0 && botPrompts.length > 1,
      `unguarded in: ${bad.map(([k]) => k).join(', ') || 'none'}; bot prompts inspected: ${botPrompts.length}`)
  }

  // ── Setup: a half-finished setup drops its branch; one that failed before creating it doesn't ──
  {
    const h = harness(label => HAPPY(label, { setup: { ok: false, branchCreated: true, path: '/wt', branch: 'b', originalBranch: 'main', problem: 'npm ci failed' } }))
    const r = await h.run({ issue: 405 })
    check('setup failing after the branch was created cleans it up', r.status === 'agent-blocked' && h.calls.includes('setup-cleanup'), `calls: ${h.calls.join()}`)
  }
  {
    const h = harness(label => HAPPY(label, { setup: { ok: false, branchCreated: false, path: '/wt', branch: '', originalBranch: 'main', problem: 'exists' } }))
    await h.run({ issue: 405 })
    check('setup failing before the branch was created does not clean up', !h.calls.includes('setup-cleanup'), `calls: ${h.calls.join()}`)
  }

  // ── Review: MAX_REVIEW_ROUNDS fix rounds, then blocked ──
  const reviewing = (verdicts, fix) => {
    let n = 0
    return label => {
      if (label.startsWith('review')) {
        const v = verdicts[Math.min(n++, verdicts.length - 1)]
        return v === 'ok' ? { verdict: 'mergeable', findings: [] }
          : { verdict: 'needs-changes', findings: [{ severity: 'important', file: 'a.ts', problem: `P${n}`, why: 'w' }] }
      }
      if (label.startsWith('fix')) return fix
      return HAPPY(label)
    }
  }
  const FIXED = { gatesPassed: true, gateOutput: 'ok', fixed: ['P fixed'], disputed: [] }
  {
    const h = harness(reviewing(['bad'], FIXED))
    const r = await h.run({ issue: 405 })
    const reviews = h.calls.filter(c => c.startsWith('review')).length
    const fixes = h.calls.filter(c => c.startsWith('fix')).length
    check('never-mergeable review blocks after 3 fixes / 4 reviews', r.status === 'agent-blocked' && r.stage === 'Review' && fixes === 3 && reviews === 4,
      `status ${r.status}, fixes ${fixes}, reviews ${reviews}`)
  }
  {
    const h = harness(reviewing(['bad', 'bad', 'bad', 'ok'], FIXED))
    const r = await h.run({ issue: 405 })
    check('mergeable on the 4th review ships', r.status === 'pr-opened', `status ${r.status}`)
  }

  // ── Disputes are reported as disputes, never as fixes ──
  {
    const h = harness(reviewing(['bad', 'ok'], { gatesPassed: true, gateOutput: 'ok', fixed: [], disputed: [{ finding: 'P1', reason: 'misread' }] }))
    const r = await h.run({ issue: 405 })
    const ship = h.prompts.ship || ''
    check('disputed finding counted as disputed, not fixed', r.findingsFixed === 0 && r.findingsDisputed === 1,
      `fixed ${r.findingsFixed}, disputed ${r.findingsDisputed}`)
    check('PR body lists the dispute and no false "passed first review"',
      /disputed and accepted by the re-review: P1/.test(ship) && !/passed the first review/.test(ship), 'ship prompt wording')
  }

  // ── Setup works in the session's own checkout, never a separate worktree ──
  // The host only lets a session's agents write inside the session's own worktree; the
  // first pilot run blocked because Setup created a separate one. Guard against regressing.
  {
    const h = harness(label => HAPPY(label))
    await h.run({ issue: 405, dryRun: true })
    const setup = h.prompts.setup || ''
    check('setup works in place and never creates a worktree',
      /git switch -c/.test(setup) && !/git worktree add/.test(setup), 'setup prompt')
  }

  // ── Every exit path returns the caller's checkout to its original branch ──
  // The loop runs in the session's own checkout, so a path that forgets to switch back
  // leaves a human's working directory parked on an issue branch. `git checkout` (not
  // `git switch`) because the original may be a detached commit hash. (Found by the
  // independent review on PR #463.)
  {
    const BACK = 'git checkout "main"'
    const paths = {}
    // shipped PR
    { const h = harness(label => HAPPY(label)); await h.run({ issue: 405 }); paths.finish = h.prompts.finish }
    // dry run
    { const h = harness(label => HAPPY(label)); await h.run({ issue: 405, dryRun: true }); paths['dry-run-cleanup'] = h.prompts['dry-run-cleanup'] }
    // escalation to Ayush
    {
      const h = harness(label => {
        if (label === 'plan') return { plan: 'p', filesToChange: [], protectedPaths: [], userVisible: false, questions: [{ question: 'q', options: ['a', 'b'], implementerTake: 'a' }] }
        if (label.startsWith('decide')) return { decision: 'd', reasoning: 'r', escalate: true, escalateReason: 'protected path' }
        return HAPPY(label)
      })
      const r = await h.run({ issue: 405 })
      check('escalation stops the run as needs-decision', r.status === 'needs-decision', `status ${r.status}`)
      paths.escalate = h.prompts.escalate
    }
    // blocked mid-run (implement never passes its gates)
    {
      const h = harness(label => label.startsWith('implement') ? { gatesPassed: false, gateOutput: 'x', summary: 's', filesChanged: [] } : HAPPY(label))
      await h.run({ issue: 405 })
      paths['blocked-path'] = h.prompts['blocked-path']
    }
    // setup failed after creating the branch
    {
      const h = harness(label => HAPPY(label, { setup: { ok: false, branchCreated: true, path: '/wt', branch: 'b', originalBranch: 'main', problem: 'npm' } }))
      await h.run({ issue: 405 })
      paths['setup-cleanup'] = h.prompts['setup-cleanup']
    }
    for (const [name, prompt] of Object.entries(paths)) {
      check(`exit path "${name}" returns to the original branch`, typeof prompt === 'string' && prompt.includes(BACK), `prompt ${prompt ? 'lacks ' + BACK : 'missing'}`)
    }
    const h = harness(label => HAPPY(label)); await h.run({ issue: 405 })
    check('no prompt tells an agent to "never switch branches" (it would override the cleanup step)',
      !Object.values(h.prompts).some(p => /Never switch branches\./.test(p)), 'contradictory rule present')
  }

  // ── Respond: the GitHub review is read and answered, with a hard round cap ──
  const ghSeq = (verdicts, fix, extra = {}) => {
    let n = 0
    return label => {
      if (label.startsWith('gh-review')) {
        const v = verdicts[Math.min(n++, verdicts.length - 1)]
        if (v === 'none') return { reviewRan: false, verdict: 'none', findings: [], note: 'run skipped' }
        return { reviewRan: true, verdict: v, note: '',
          findings: v === 'needs changes' ? [{ severity: 'important', file: 'a.ts', problem: `G${n}`, why: 'w' }] : [] }
      }
      if (label.startsWith('respond-fix')) return fix
      return HAPPY(label, extra)
    }
  }
  const count = (h, prefix) => h.calls.filter(c => c.startsWith(prefix)).length
  {
    const h = harness(ghSeq(['looks mergeable'], FIXED))
    const r = await h.run({ issue: 405 })
    check('respond: mergeable first time -> no fixes, PR stands', r.status === 'pr-opened' && r.githubReview === 'looks mergeable' && count(h, 'respond-fix') === 0,
      `${r.status} ${r.githubReview} fixes ${count(h, 'respond-fix')}`)
  }
  {
    const h = harness(ghSeq(['needs changes', 'looks mergeable'], FIXED))
    const r = await h.run({ issue: 405 })
    check('respond: one fix round then mergeable', r.status === 'pr-opened' && count(h, 'respond-fix') === 1 && count(h, 'gh-review') === 2,
      `${r.status} fixes ${count(h, 'respond-fix')} reviews ${count(h, 'gh-review')}`)
    check('respond: fix prompt requires a fixed/disputed resolutions comment', /"fixed: <what changed>" or "disputed: <why>"/.test(h.prompts['respond-fix-1'] || ''), 'respond-fix prompt')
  }
  {
    const h = harness(ghSeq(['needs changes'], FIXED))
    const r = await h.run({ issue: 405 })
    check('respond: never mergeable -> blocked after 2 fixes / 3 reviews', r.status === 'agent-blocked' && r.githubReview === 'unresolved' && count(h, 'respond-fix') === 2 && count(h, 'gh-review') === 3,
      `${r.status} ${r.githubReview} fixes ${count(h, 'respond-fix')} reviews ${count(h, 'gh-review')}`)
    check('respond: unresolved PR is labelled agent-blocked and drafted', /agent-blocked/.test(h.prompts.finish || '') && /--undo/.test(h.prompts.finish || ''), 'finish prompt')
  }
  {
    const h = harness(ghSeq(['needs a human'], FIXED))
    const r = await h.run({ issue: 405 })
    check('respond: "needs a human" stops without fixing', r.githubReview === 'needs a human' && count(h, 'respond-fix') === 0, `${r.githubReview} fixes ${count(h, 'respond-fix')}`)
  }
  {
    const h = harness(ghSeq(['none'], FIXED))
    const r = await h.run({ issue: 405 })
    check('respond: review that never ran is flagged, not treated as approval', r.githubReview === 'no-review' && count(h, 'respond-fix') === 0 && /could not be read/.test(h.prompts.finish || ''),
      `${r.githubReview}`)
  }
  {
    const h = harness(ghSeq(['needs changes'], { gatesPassed: false, gateOutput: 'x', fixed: [], disputed: [] }))
    const r = await h.run({ issue: 405 })
    check('respond: a fix that breaks the gates ends unresolved', r.githubReview === 'unresolved' && count(h, 'respond-fix') === 1, `${r.githubReview} fixes ${count(h, 'respond-fix')}`)
  }

  // ── Respond: every review read is pinned to the exact commit (found by review of PR #463) ──
  {
    const h = harness(ghSeq(['needs changes', 'looks mergeable'], FIXED))
    await h.run({ issue: 405 })
    check('respond: first review read is pinned to the commit Ship pushed', /Expected head commit: sha-ship/.test(h.prompts['gh-review-1'] || ''), 'gh-review-1 prompt')
    check('respond: the next read is pinned to the commit the fix pushed', /Expected head commit: sha-fix-1/.test(h.prompts['gh-review-2'] || ''), 'gh-review-2 prompt')
  }
  {
    // the reader reports a review of a DIFFERENT commit (a previous round's)
    const h = harness(label => label.startsWith('gh-review')
      ? { reviewRan: true, verdict: 'looks mergeable', findings: [], note: '', reviewedSha: 'some-older-sha' } : HAPPY(label))
    const r = await h.run({ issue: 405, shadow: false })
    check('respond: a review of any other commit is treated as no review, never approval', r.githubReview === 'no-review' && r.autoMergeRequested === false,
      `${r.githubReview} autoMerge ${r.autoMergeRequested}`)
  }
  {
    // every finding disputed, nothing pushed: must not re-read the same review
    const h = harness(ghSeq(['needs changes'], { gatesPassed: true, gateOutput: 'ok', fixed: [], disputed: [{ finding: 'G1', reason: 'wrong' }], pushedSha: '' }))
    const r = await h.run({ issue: 405 })
    check('respond: dispute-only round with no push hands to Ayush instead of re-reading', r.githubReview === 'needs a human' && count(h, 'gh-review') === 1 && count(h, 'respond-fix') === 1,
      `${r.githubReview} reviews ${count(h, 'gh-review')} fixes ${count(h, 'respond-fix')}`)
  }
  {
    // reviewer says "needs changes" but only minor points
    const h = harness(label => label.startsWith('gh-review')
      ? { reviewRan: true, verdict: 'needs changes', note: '', findings: [{ severity: 'minor', file: 'a', problem: 'nit', why: 'w' }] } : HAPPY(label))
    const r = await h.run({ issue: 405, shadow: false })
    check('respond: "needs changes" with only minor points is not approval (no auto-merge)', r.githubReview === 'minor only' && r.autoMergeRequested === false,
      `${r.githubReview} autoMerge ${r.autoMergeRequested}`)
  }
  {
    // a Respond fix touches a protected path, then the review passes
    const h = harness(ghSeq(['needs changes', 'looks mergeable'], { ...FIXED, protectedPaths: ['.github/CODEOWNERS'] }))
    const r = await h.run({ issue: 405, shadow: false })
    check('respond: a fix that touches a protected path blocks auto-merge', r.autoMergeRequested === false && r.protectedPaths.includes('.github/CODEOWNERS'),
      `autoMerge ${r.autoMergeRequested} protected ${r.protectedPaths}`)
  }
  {
    // the finish agent fails to return the checkout
    const h = harness(label => label === 'finish' ? { returnedToOriginal: false, ranMergeCommand: false } : HAPPY(label))
    await h.run({ issue: 405 })
    check('finish: a failed return to the original branch triggers the fallback', h.calls.includes('finish-fallback') && /git checkout "main"/.test(h.prompts['finish-fallback'] || ''), `calls ${h.calls.join()}`)
  }
  {
    const h = harness(label => label === 'finish' ? { returnedToOriginal: true, ranMergeCommand: true } : HAPPY(label))
    const r = await h.run({ issue: 405 })
    check('finish: a merge command run in shadow mode is reported', r.mergeRuleBroken === true, `mergeRuleBroken ${r.mergeRuleBroken}`)
  }

  {
    // the fix pushed nothing but reports the CURRENT head instead of "" (found by re-review)
    const h = harness(ghSeq(['needs changes'], { ...FIXED, pushedSha: 'sha-ship' }))
    const r = await h.run({ issue: 405 })
    check('respond: a fix reporting the unchanged head counts as no push (no stale re-read)', r.githubReview === 'needs a human' && count(h, 'gh-review') === 1,
      `${r.githubReview} reviews ${count(h, 'gh-review')}`)
  }
  {
    const h = harness(label => label === 'finish' ? null : HAPPY(label))
    await h.run({ issue: 405 })
    check('finish: a dead finish agent re-runs the whole step, not just the checkout', h.calls.includes('finish-retry'), `calls ${h.calls.join()}`)
  }
  {
    const h = harness(label => label === 'finish' ? { returnedToOriginal: true, ranMergeCommand: true } : HAPPY(label))
    await h.run({ issue: 405 })
    check('finish: a forbidden merge command is undone, not just logged', h.calls.includes('undo-auto-merge') && /--disable-auto/.test(h.prompts['undo-auto-merge'] || ''), `calls ${h.calls.join()}`)
  }

  // ── Auto-merge is requested only when EVERY condition holds ──
  {
    const cases = [
      ['shadow (default), mergeable', {}, ['looks mergeable'], {}, false],
      ['not shadow, mergeable, no protected paths', { shadow: false }, ['looks mergeable'], {}, true],
      ['not shadow, mergeable, protected path', { shadow: false }, ['looks mergeable'], { protectedPaths: ['.github/x'] }, false],
      ['not shadow, unresolved review', { shadow: false }, ['needs changes'], {}, false],
      ['not shadow, review never ran', { shadow: false }, ['none'], {}, false],
      ['not shadow, needs a human', { shadow: false }, ['needs a human'], {}, false],
    ]
    for (const [name, args, verdicts, extra, expect] of cases) {
      const h = harness(ghSeq(verdicts, FIXED, extra))
      const r = await h.run({ issue: 405, ...args })
      const asked = /gh pr merge \d+ --repo \S+ --auto/.test(h.prompts.finish || '')
      check(`auto-merge ${expect ? 'requested' : 'NOT requested'}: ${name}`, r.autoMergeRequested === expect && asked === expect,
        `autoMergeRequested ${r.autoMergeRequested}, prompt asks ${asked}`)
    }
  }

  // ── Every agent has a lean, explicit type (cost guard) ──
  // Untyped agents load every tool the session has (~40k tokens per agent before doing
  // anything). Every stage must be either the dev role or `loop-runner`.
  {
    const seen = {}
    const runs = [
      harness(label => HAPPY(label)),
      harness(ghSeq(['needs changes', 'looks mergeable'], FIXED)),
      harness(label => label.startsWith('implement') ? { gatesPassed: false, gateOutput: 'x', summary: 's', filesChanged: [] } : HAPPY(label)),
      harness(label => HAPPY(label, { setup: { ok: false, branchCreated: true, path: '/wt', branch: 'b', originalBranch: 'main', problem: 'x' } })),
    ]
    for (const h of runs) { await h.run({ issue: 405 }); Object.assign(seen, h.opts) }
    { const h = harness(label => HAPPY(label)); await h.run({ issue: 405, dryRun: true }); Object.assign(seen, h.opts) }
    const untyped = Object.entries(seen).filter(([, o]) => !o.agentType).map(([l]) => l)
    const plumbingNotLean = Object.entries(seen).filter(([l, o]) => o.agentType !== 'frontend' && o.agentType !== 'backend' && o.agentType !== 'ui-ux' && o.agentType !== 'loop-runner').map(([l]) => l)
    check(`every agent call is typed (checked ${Object.keys(seen).length} stages)`, untyped.length === 0, `untyped: ${untyped.join(', ')}`)
    check('non-dev stages use the lean loop-runner', plumbingNotLean.length === 0, `other types: ${plumbingNotLean.join(', ')}`)
  }

  // ── Behaviour changes beyond the issue must reach Ayush (found on issue #406 / PR #468) ──
  {
    const h = harness(label => HAPPY(label))
    await h.run({ issue: 405, dryRun: true })
    check('plan must raise user-visible changes beyond the issue as questions',
      /ALWAYS include as a question any change a user would notice beyond what the issue/.test(h.prompts.plan || ''), 'plan prompt')
  }
  {
    // such a question, escalated by the decision agent, stops the run for Ayush
    const h = harness(label => {
      if (label === 'plan') return { plan: 'p', filesToChange: [], protectedPaths: [], userVisible: true, questions: [{ question: 'should we also stop auto-adding medium-confidence items?', options: ['yes', 'no'], implementerTake: 'yes' }] }
      if (label.startsWith('decide')) return { decision: 'yes', reasoning: 'r', escalate: true, escalateReason: 'product behaviour beyond the issue' }
      return HAPPY(label)
    })
    const r = await h.run({ issue: 406 })
    check('a behaviour-change question escalated by Decide stops as needs-decision, before any code', r.status === 'needs-decision' && !h.calls.some(c => c.startsWith('implement')),
      `${r.status} calls ${h.calls.join()}`)
  }

  // ── Re-verify after review fixes (found on the blocked #402 run, PR #471) ──
  {
    const h = harness(label => HAPPY(label))
    const r = await h.run({ issue: 405 })
    check('no review fixes -> verified once, no re-verification', r.status === 'pr-opened' && !h.calls.includes('verify-recheck'), `calls ${h.calls.join()}`)
  }
  {
    const rv = reviewing(['bad', 'ok'], FIXED)
    const h = harness(label => {
      if (label === 'verify-recheck') return { verified: true, applicable: true, commitVerified: 'final', evidence: 'FRESH-EVIDENCE', screenshots: [], problems: '', couldNotVerify: '' }
      return rv(label)
    })
    const r = await h.run({ issue: 405 })
    check('after a review fix round, verification re-runs on the final commit', h.calls.includes('verify-recheck') && r.status === 'pr-opened', `calls ${h.calls.join()}`)
    check('the PR carries the re-verified evidence, not the stale one', /FRESH-EVIDENCE/.test(h.prompts.ship || ''), 'ship prompt lacks recheck evidence')
    check('re-verification is told it is a from-scratch recheck of current HEAD', /THIS IS A RE-VERIFICATION/.test(h.prompts['verify-recheck'] || ''), 'recheck prompt')
    check('the reviewer after a fix is told the evidence predates the fixes', /verification was done BEFORE 1 fix round/.test(h.prompts['review-2'] || ''), 'review-2 prompt')
  }
  {
    const rv = reviewing(['bad', 'ok'], FIXED)
    const h = harness(label => label === 'verify-recheck'
      ? { verified: false, applicable: true, commitVerified: 'final', evidence: 'e', screenshots: [], problems: 'footer wrong after fix', couldNotVerify: '' }
      : rv(label))
    const r = await h.run({ issue: 405 })
    check('a failed re-verification blocks instead of shipping', r.status === 'agent-blocked' && r.stage === 'Verify' && !h.calls.includes('ship'), `${r.status} ${r.stage}`)
  }
  {
    const h = harness(ghSeq(['needs changes', 'looks mergeable'], FIXED))
    await h.run({ issue: 405 })
    check('respond fixes must re-verify user-visible changes before pushing', /re-verify that flow on your new commit/.test(h.prompts['respond-fix-1'] || ''), 'respond-fix prompt')
  }

  // ── The loop never merges in shadow mode ──
  {
    const h = harness(label => HAPPY(label))
    await h.run({ issue: 405 })
    const ship = h.prompts.ship || ''
    check('shadow mode (default) tells Ship not to enable auto-merge', /Shadow mode: do NOT enable auto-merge/.test(ship), 'ship prompt')
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nall agent-loop control-flow checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
