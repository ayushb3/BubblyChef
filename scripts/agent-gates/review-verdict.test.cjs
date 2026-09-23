// Tests for the review-verdict merge gate (review-verdict.cjs). No GitHub calls.
//   node scripts/agent-gates/review-verdict.test.cjs     (exit 1 on any failure)
'use strict'
const fs = require('fs')
const path = require('path')
const { decide, parseVerdict, REVIEW_JOB, REVIEW_STEP } = require('./review-verdict.cjs')

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

// the workflow wiring the gate depends on
{
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'claude-review.yml'), 'utf8').replace(/\r/g, '')
  const verdictJob = (wf.split(/\n  verdict:\n/)[1] || '')
  check('workflow: a "Claude review verdict" job exists', /name: Claude review verdict/.test(verdictJob), 'job missing')
  check('workflow: the verdict job always runs (a skipped required check counts as passing)', /\n    if: always\(\)/.test(verdictJob) && !/\n    if: (?!always\(\))/.test(verdictJob), 'verdict job has a non-always if')
  check('workflow: the verdict job runs this script', /review-verdict\.cjs/.test(verdictJob), 'script not called')
  check('workflow: re-evaluated when a review is submitted (approval clears the hold)', /pull_request_review:\n\s+types: \[submitted\]/.test(wf), 'no pull_request_review trigger')
  check('workflow: the Opus review never runs on a review event', /github\.event_name == 'pull_request'/.test(wf.split(/\n  verdict:\n/)[0]), 'review job if lacks event guard')
  check(`workflow: the review job and step names the script reads exist ("${REVIEW_JOB}", "${REVIEW_STEP}")`,
    new RegExp(`\\n  ${REVIEW_JOB}:\\n`).test(wf) && new RegExp(`name: ${REVIEW_STEP}\\n`).test(wf), 'names drifted')
}

console.log(failures ? `\n${failures} failure(s)` : '\nall review-verdict gate checks passed')
process.exit(failures ? 1 : 0)
