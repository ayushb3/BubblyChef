// Tests for the review-verdict merge gate (review-verdict.cjs). No GitHub calls.
//   node scripts/agent-gates/review-verdict.test.cjs     (exit 1 on any failure)
'use strict'
const fs = require('fs')
const path = require('path')
const { decide, parseVerdict, prDiffUnchanged, makeGit, REVIEW_JOB, REVIEW_STEP } = require('./review-verdict.cjs')

let failures = 0
function check(name, cond, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

const HEAD = 'a'.repeat(40)
const OK = {
  labels: ['agent-loop'], headSha: HEAD, owners: ['ayushb3'], approvals: [],
  reviewJob: { status: 'completed', conclusion: 'success', startedAt: '2026-09-23T10:00:00Z', reviewStep: 'success' },
  sticky: { updatedAt: '2026-09-23T10:05:00Z', body: '## Review\n**Verdict: `looks mergeable`.** fine' },
}
const run = over => decide({ ...OK, ...over })

// parsing, in both shapes the reviewer has actually written
check('parses **Verdict: `x`**', parseVerdict('**Verdict: `looks mergeable`** (note)') === 'looks mergeable', '')
check('parses **Verdict:** `x`', parseVerdict('- **Verdict:** `needs changes`') === 'needs changes', '')
check('no verdict parses as empty', parseVerdict('no verdict here') === '', '')

check('passes: fresh "looks mergeable" for this commit', run({}).pass === true, run({}).reason)
check('passes: a PR without the agent-loop label is not gated', run({ labels: ['bug'], sticky: null, reviewJob: null }).pass === true, '')

for (const v of ['needs changes', 'needs a human']) {
  const r = run({ sticky: { ...OK.sticky, body: `**Verdict: \`${v}\`**` } })
  check(`holds: verdict "${v}"`, r.pass === false && r.reason.includes(v), r.reason)
}
check('holds: an unreadable verdict', run({ sticky: { ...OK.sticky, body: 'Verdict unclear' } }).pass === false, '')
check('holds: "looks mergeable" in prose but a different verdict', run({ sticky: { ...OK.sticky, body: '**Verdict: `needs changes`** — would otherwise be looks mergeable' } }).pass === false, '')
check('holds: no review run for this commit', run({ reviewJob: null }).pass === false, '')
{
  const r = run({ reviewJob: { ...OK.reviewJob, status: 'in_progress', conclusion: null } })
  check('holds: review still running, and says so', r.pass === false && /still running/.test(r.reason), r.reason)
}
check('holds: review job failed', run({ reviewJob: { ...OK.reviewJob, conclusion: 'failure' } }).pass === false, '')
check('holds: review job skipped (kill switch off, draft)', run({ reviewJob: { ...OK.reviewJob, conclusion: 'skipped' } }).pass === false, '')
check('holds: no summary comment', run({ sticky: null }).pass === false, '')
{
  // the summary predates this commit's review: it is an older commit's verdict
  const r = run({ sticky: { ...OK.sticky, updatedAt: '2026-09-23T09:59:59Z' } })
  check('holds: a stale summary from an older commit', r.pass === false && /older/.test(r.reason), r.reason)
}
check('passes: base-only merge push keeps the existing verdict', run({ reviewJob: { ...OK.reviewJob, reviewStep: 'skipped' }, sticky: { ...OK.sticky, updatedAt: '2026-09-01T00:00:00Z' } }).pass === true, '')
check('holds: base-only merge push does not rescue a bad verdict', run({ reviewJob: { ...OK.reviewJob, reviewStep: 'skipped' }, sticky: { updatedAt: '2026-09-01T00:00:00Z', body: '**Verdict: `needs changes`**' } }).pass === false, '')

// the human way out
const BAD = { reviewJob: null, sticky: null }
check('passes: code owner approved this exact commit', run({ ...BAD, approvals: [{ user: 'ayushb3', state: 'APPROVED', commitId: HEAD }] }).pass === true, '')
check('holds: approval of an older commit', run({ ...BAD, approvals: [{ user: 'ayushb3', state: 'APPROVED', commitId: 'b'.repeat(40) }] }).pass === false, '')
check('holds: approval by someone who is not a code owner', run({ ...BAD, approvals: [{ user: 'bubblychef-bot', state: 'APPROVED', commitId: HEAD }] }).pass === false, '')
check('holds: a code owner comment that is not an approval', run({ ...BAD, approvals: [{ user: 'ayushb3', state: 'COMMENTED', commitId: HEAD }] }).pass === false, '')

// an approval of an earlier commit, carried across pushes that only merged the base in
const A = 'b'.repeat(40)
const approvedA = [{ user: 'ayushb3', state: 'APPROVED', commitId: A, submittedAt: '2026-09-22T10:00:00Z' }]
const unchanged = same => sha => (sha === A ? { same, why: same ? '' : 'the PR diff changed' } : { same: false, why: 'unexpected sha' })
check('passes: approval of A, and HEAD only merged the base in', run({ ...BAD, approvals: approvedA, prDiffUnchanged: unchanged(true) }).pass === true, '')
{
  const r = run({ ...BAD, approvals: approvedA, prDiffUnchanged: unchanged(false) })
  check('holds: approval of A, but the PR diff changed since (new code or an altered merge)', r.pass === false && /does not carry/.test(r.reason), r.reason)
}
{
  const r = run({ ...BAD, approvals: approvedA, prDiffUnchanged: () => { throw new Error('boom') } })
  check('holds: the git comparison throws', r.pass === false && /boom/.test(r.reason), r.reason)
}
check('holds: the git comparison answers something other than same: true', run({ ...BAD, approvals: approvedA, prDiffUnchanged: () => ({ same: 'yes' }) }).pass === false, '')
check('holds: no git comparison available', run({ ...BAD, approvals: approvedA }).pass === false, '')
{
  let called = false
  const r = run({ approvals: approvedA, prDiffUnchanged: () => { called = true; return { same: true } } })
  check('no git work when the Claude review already clears it', r.pass === true && !called, `called=${called}`)
}
{
  const approvals = [...approvedA, { user: 'ayushb3', state: 'CHANGES_REQUESTED', commitId: HEAD, submittedAt: '2026-09-22T11:00:00Z' }]
  check('holds: a later "changes requested" overrides an approval of A', run({ ...BAD, approvals, prDiffUnchanged: unchanged(true) }).pass === false, '')
}
{
  const approvals = [{ user: 'ayushb3', state: 'APPROVED', commitId: HEAD, submittedAt: '2026-09-22T10:00:00Z' },
    { user: 'ayushb3', state: 'CHANGES_REQUESTED', commitId: HEAD, submittedAt: '2026-09-22T11:00:00Z' }]
  check('holds: a later "changes requested" overrides an approval of HEAD', run({ ...BAD, approvals }).pass === false, '')
}
{
  const approvals = [{ user: 'ayushb3', state: 'CHANGES_REQUESTED', commitId: A, submittedAt: '2026-09-22T09:00:00Z' }, ...approvedA]
  check('passes: an approval after an earlier "changes requested" stands', run({ ...BAD, approvals, prDiffUnchanged: unchanged(true) }).pass === true, '')
}
{
  const approvals = [...approvedA, { user: 'ayushb3', state: 'COMMENTED', commitId: HEAD, submittedAt: '2026-09-22T11:00:00Z' }]
  check('passes: a later plain comment does not withdraw an approval', run({ ...BAD, approvals, prDiffUnchanged: unchanged(true) }).pass === true, '')
}
{
  const approvals = [...approvedA, { user: 'other-owner', state: 'CHANGES_REQUESTED', commitId: A, submittedAt: '2026-09-22T11:00:00Z' }]
  check('holds: another code owner\'s standing "changes requested"', run({ ...BAD, owners: ['ayushb3', 'other-owner'], approvals, prDiffUnchanged: unchanged(true) }).pass === false, '')
}
check('holds: a dismissed approval', run({ ...BAD, approvals: [{ ...approvedA[0], state: 'DISMISSED' }], prDiffUnchanged: unchanged(true) }).pass === false, '')
check('holds: approval of A by someone who is not a code owner', run({ ...BAD, approvals: [{ ...approvedA[0], user: 'bubblychef-bot' }], prDiffUnchanged: unchanged(true) }).pass === false, '')

// prDiffUnchanged against a real repository: the patch-id comparison itself
{
  const os = require('os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-gate-'))
  const emptyConfig = path.join(dir, 'empty-gitconfig')
  fs.writeFileSync(emptyConfig, '')
  const repoDir = path.join(dir, 'repo')
  fs.mkdirSync(repoDir)
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  }
  const git = makeGit(repoDir, env)
  const write = (f, text) => fs.writeFileSync(path.join(repoDir, f), text)
  const commit = msg => { git(['add', '-A']); git(['commit', '-q', '-m', msg]); return git(['rev-parse', 'HEAD']).trim() }
  const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const same = (approvedSha, headSha) => prDiffUnchanged({ git, baseRef: 'main', approvedSha, headSha })
  try {
    git(['init', '-q', '-b', 'main'])
    git(['config', 'core.autocrlf', 'false'])
    write('app.txt', lines(40)); write('other.txt', 'other\n')
    commit('base')
    git(['checkout', '-q', '-b', 'pr'])
    write('app.txt', lines(40).replace('line 20\n', 'line 20 changed by the PR\n'))
    const approved = commit('pr change')

    // main moves on: an unrelated file, and new lines above the PR's hunk (shifts its line numbers)
    git(['checkout', '-q', 'main'])
    write('other.txt', 'other, changed on main\n')
    write('app.txt', 'new top line\n' + lines(40))
    commit('main moves on')

    git(['checkout', '-q', 'pr'])
    git(['merge', '-q', '--no-edit', 'main'])
    const baseMerged = git(['rev-parse', 'HEAD']).trim()
    const r1 = same(approved, baseMerged)
    check('git: a base-only merge (clean, shifts the PR hunk) keeps the PR diff unchanged', r1.same === true, r1.why)
    check('git: the same commit compares equal to itself', same(approved, approved).same === true, '')

    write('app.txt', fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8') + 'new code\n')
    const newCode = commit('more code')
    const r2 = same(approved, newCode)
    check('git: a new code commit after the approval changes the PR diff', r2.same === false && /changed/.test(r2.why), r2.why)

    // a merge whose conflict resolution alters the PR's own line
    git(['checkout', '-q', '-b', 'pr2', approved])
    git(['checkout', '-q', 'main'])
    write('app.txt', fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8').replace('line 20\n', 'line 20 changed by main\n'))
    commit('main edits the same line')
    git(['checkout', '-q', 'pr2'])
    try { git(['merge', '-q', '--no-edit', 'main']) } catch { /* conflict expected */ }
    write('app.txt', fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8')
      .replace(/<<<<<<< [^\n]*\n[\s\S]*?>>>>>>> [^\n]*\n/, 'line 20 resolved some third way\n'))
    const resolved = commit('merge main, resolving the conflict')
    const r3 = same(approved, resolved)
    check('git: a merge whose conflict resolution changed the PR lines alters the PR diff', r3.same === false, r3.why)

    // a binary file the PR adds, altered after approval: the diff text must not hide it
    // (with a text change alongside, so the diff has a patch-id without the binary part)
    git(['checkout', '-q', '-b', 'pr3', 'main'])
    write('other.txt', 'other, changed by pr3\n')
    fs.writeFileSync(path.join(repoDir, 'img.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
    const binApproved = commit('add binary')
    fs.writeFileSync(path.join(repoDir, 'img.bin'), Buffer.from([0, 1, 2, 3, 0, 254]))
    const binChanged = commit('change binary')
    check('git: a changed binary file alters the PR diff', same(binApproved, binChanged).same === false, '')

    const r4 = same('c'.repeat(40), baseMerged)
    check('git: an unknown commit is a git error, answered as not unchanged', r4.same === false && /failed/.test(r4.why), r4.why)
    const r5 = same(approved, git(['rev-parse', 'main']).trim())
    check('git: an approved commit that is not an ancestor of HEAD does not carry', r5.same === false && /ancestor/.test(r5.why), r5.why)
    const r6 = prDiffUnchanged({ git: () => { throw new Error('git exploded') }, baseRef: 'main', approvedSha: approved, headSha: baseMerged })
    check('git: prDiffUnchanged never throws', r6.same === false && /exploded/.test(r6.why), r6.why)
  } catch (e) {
    check('git: repository scenarios ran', false, String((e && (e.stderr || e.message)) || e))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// the workflow wiring the gate depends on
{
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'claude-review.yml'), 'utf8').replace(/\r/g, '')
  const verdictJob = (wf.split(/\n  verdict:\n/)[1] || '')
  check('workflow: a "Claude review verdict" job exists', /name: Claude review verdict/.test(verdictJob), 'job missing')
  check('workflow: the verdict job always runs (a skipped required check counts as passing)', (verdictJob.match(/\n    if:.*/g) || []).join() === '\n    if: always()', 'verdict job has a non-always if')
  check('workflow: the verdict job runs this script', /review-verdict\.cjs/.test(verdictJob), 'script not called')
  check('workflow: re-evaluated when a review is submitted (approval clears the hold)', /pull_request_review:\n\s+types: \[submitted\]/.test(wf), 'no pull_request_review trigger')
  check('workflow: the Opus review never runs on a review event', /github\.event_name == 'pull_request'/.test(wf.split(/\n  verdict:\n/)[0]), 'review job if lacks event guard')
  check(`workflow: the review job and step names the script reads exist ("${REVIEW_JOB}", "${REVIEW_STEP}")`,
    new RegExp(`\\n  ${REVIEW_JOB}:\\n`).test(wf) && new RegExp(`name: ${REVIEW_STEP}\\n`).test(wf), 'names drifted')
}

console.log(failures ? `\n${failures} failure(s)` : '\nall review-verdict gate checks passed')
process.exit(failures ? 1 : 0)
