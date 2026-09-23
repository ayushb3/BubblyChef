// Gate: an agent-loop PR merges only on the independent reviewer's "looks mergeable"
// for its EXACT head commit, or on a code owner's approval of that commit.
//
// Runs as the "Claude review verdict" job in .github/workflows/claude-review.yml, which
// is a required check on main. That is what lets the agent loop request auto-merge on a
// small PR without waiting for the GitHub review itself: GitHub waits instead, and a
// "needs changes" or "needs a human" verdict holds the merge. Human PRs (no `agent-loop`
// label) pass straight through: they are gated by the human who opens them.
//
// The decision is a pure function of facts (decide), so it is tested without GitHub:
//   node scripts/agent-gates/review-verdict.test.cjs
// CLI: node scripts/agent-gates/review-verdict.cjs <repo> <pr> <head-sha>   (exit 1 = hold)
'use strict'
const fs = require('fs')
const path = require('path')

const LOOP_LABEL = 'agent-loop'
const REVIEW_JOB = 'review'
const REVIEW_STEP = 'Claude review'

// The first backticked value after "Verdict", in both shapes the reviewer writes:
// **Verdict: `looks mergeable`**   and   **Verdict:** `needs changes`
function parseVerdict(body) {
  const m = /Verdict\W{0,6}`([^`]+)`/i.exec(body || '')
  return m ? m[1].trim().toLowerCase() : ''
}

function decide(f) {
  const hold = reason => ({ pass: false, reason })
  const pass = reason => ({ pass: true, reason })
  if (!f.labels.includes(LOOP_LABEL)) return pass(`not an ${LOOP_LABEL} PR: not gated by the review verdict`)
  if (f.approvals.some(a => a.state === 'APPROVED' && a.commitId === f.headSha && f.owners.includes(a.user))) {
    return pass(`a code owner approved ${f.headSha.slice(0, 8)}`)
  }
  const job = f.reviewJob
  if (!job) return hold(`no Claude review run for ${f.headSha.slice(0, 8)} yet`)
  if (job.status !== 'completed') return hold('the Claude review of this commit is still running')
  if (job.conclusion !== 'success') return hold(`the Claude review job ended "${job.conclusion}", so there is no verdict for this commit`)
  if (!f.sticky) return hold('no review summary comment found')
  // A push that only merged the base branch keeps the previous review (the review step
  // is skipped by design), so the existing summary stands for it.
  const baseOnly = job.reviewStep === 'skipped'
  if (!baseOnly && !(f.sticky.updatedAt >= job.startedAt)) {
    return hold('the review summary was not updated by the review of this commit (it describes an older one)')
  }
  const verdict = parseVerdict(f.sticky.body)
  if (verdict !== 'looks mergeable') return hold(`the review verdict is "${verdict || 'unreadable'}", not "looks mergeable"`)
  return pass(`the Claude review of ${f.headSha.slice(0, 8)} says "looks mergeable"`)
}

function owners(root) {
  const text = fs.readFileSync(path.join(root, '.github', 'CODEOWNERS'), 'utf8')
  return [...new Set((text.match(/@[\w-]+/g) || []).map(s => s.slice(1)))]
}

function gather(repo, pr, headSha) {
  const { execFileSync } = require('child_process')
  const api = p => JSON.parse(execFileSync('gh', ['api', p], { encoding: 'utf8', maxBuffer: 32 << 20 }))
  const labels = api(`repos/${repo}/issues/${pr}/labels`).map(l => l.name)
  const approvals = api(`repos/${repo}/pulls/${pr}/reviews?per_page=100`)
    .map(r => ({ user: r.user && r.user.login, state: r.state, commitId: r.commit_id }))
  // The newest non-cancelled review run for this exact commit. A newer push cancels an
  // older run, and that newer commit then has its own run and its own verdict.
  const runs = api(`repos/${repo}/actions/workflows/claude-review.yml/runs?head_sha=${headSha}&event=pull_request&per_page=50`).workflow_runs
    .filter(r => r.conclusion !== 'cancelled')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  let reviewJob = null
  if (runs.length) {
    const job = api(`repos/${repo}/actions/runs/${runs[0].id}/jobs`).jobs.find(j => j.name === REVIEW_JOB)
    if (job) {
      const step = (job.steps || []).find(s => s.name === REVIEW_STEP)
      reviewJob = { status: job.status, conclusion: job.conclusion, startedAt: job.started_at, reviewStep: step ? step.conclusion : '' }
    }
  }
  const sticky = api(`repos/${repo}/issues/${pr}/comments?per_page=100`)
    .filter(c => c.user && (c.user.login === 'claude[bot]' || c.user.login === 'claude') && /Verdict/.test(c.body || ''))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0]
  return {
    labels, approvals, headSha, reviewJob,
    owners: owners(path.join(__dirname, '..', '..')),
    sticky: sticky ? { updatedAt: sticky.updated_at, body: sticky.body } : null,
  }
}

module.exports = { decide, parseVerdict, LOOP_LABEL, REVIEW_JOB, REVIEW_STEP }

if (require.main === module) {
  const [repo, pr, headSha] = process.argv.slice(2)
  if (!repo || !pr || !headSha) { console.error('usage: review-verdict.cjs <repo> <pr> <head-sha>'); process.exit(2) }
  const r = decide(gather(repo, pr, headSha))
  console.log(`${r.pass ? 'PASS' : 'HOLD'}: ${r.reason}`)
  if (!r.pass) console.log(`::error::Agent-loop PR held: ${r.reason}. A code owner's approval of this commit also clears it.`)
  process.exit(r.pass ? 0 : 1)
}
