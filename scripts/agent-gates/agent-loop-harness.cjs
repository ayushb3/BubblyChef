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
  const agent = async (prompt, opts) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    return respond(opts.label, prompt)
  }
  const parallel = async thunks => Promise.all(thunks.map(t => t()))
  return {
    calls,
    prompts,
    run: args => makeRun(args, agent, parallel, () => {}, () => {}),
  }
}

const FACTS = {
  agentsEnabled: 'true', runsLast24h: 0, issueState: 'OPEN', issueLabels: ['ready-for-agent'],
  openPrsForIssue: [], title: 'T', kind: 'feature', devRole: 'frontend', slug: 's', summary: 'x',
}
const SETUP_OK = { ok: true, branchCreated: true, path: '/wt', branch: 'feat/x', originalBranch: 'main', problem: '' }
const HAPPY = (label, extra = {}) => {
  if (label === 'preflight') return extra.facts || FACTS
  if (label === 'setup') return extra.setup || SETUP_OK
  if (label === 'plan') return { plan: 'p', filesToChange: ['a.ts'], protectedPaths: [], userVisible: true, questions: [] }
  if (label.startsWith('implement')) return { gatesPassed: true, gateOutput: 'ok', summary: 'did it', filesChanged: ['a.ts'] }
  if (label.startsWith('verify')) return { verified: true, applicable: true, commitVerified: 'abc', evidence: 'e', screenshots: [], problems: '', couldNotVerify: '' }
  if (label.startsWith('review')) return { verdict: 'mergeable', findings: [] }
  if (label === 'ship') return { prUrl: 'u', prNumber: 1, protectedPaths: [], wouldAutoMerge: true, lessonsProposed: [] }
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
    ['kill switch off', { agentsEnabled: 'false' }, /kill switch/],
    ['kill switch empty', { agentsEnabled: '' }, /kill switch/],
    ['daily cap reached', { runsLast24h: 3 }, /daily cap/],
    ['issue closed', { issueState: 'CLOSED' }, /CLOSED/],
    ['not ready-for-agent', { issueLabels: ['bug'] }, /not labelled ready-for-agent/],
    ['PR already open', { openPrsForIssue: [470] }, /already has open PR/],
  ]
  for (const [name, override, reason] of stops) {
    const h = harness(label => HAPPY(label, { facts: { ...FACTS, ...override } }))
    const r = await h.run({ issue: 405 })
    check(`preflight stops: ${name}`, r.status === 'skipped' && reason.test(r.reason) && h.calls.join() === 'preflight',
      `got ${r.status} "${r.reason}", agents: ${h.calls.join()}`)
  }
  {
    const h = harness(label => HAPPY(label, { facts: { ...FACTS, runsLast24h: 2 } }))
    const r = await h.run({ issue: 405, dryRun: true })
    check('preflight allows 2 runs in 24h (under cap)', r.status === 'dry-run', `got ${r.status}`)
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
