// Gate: an agent-loop PR merges only on the independent reviewer's "looks mergeable"
// for its EXACT head commit, or on a code owner's approval of that commit, or of an
// earlier commit when everything pushed since only merged the base branch in (so
// "Update branch" does not force a re-approval: the PR's own diff must be unchanged).
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

// The three verdicts the reviewer is instructed to write (see .github/workflows/claude-review.yml).
const KNOWN_VERDICTS = ['looks mergeable', 'needs changes', 'needs a human']

// The value after the LAST "Verdict:" label in the body, however the reviewer formatted
// it: backticked or not, bold or not, any case, trailing punctuation, extra spaces —
// `**Verdict: \`looks mergeable\`**`, `Verdict: looks mergeable.`, `VERDICT: NEEDS A
// HUMAN` all parse the same way. Only the three known verdicts are ever accepted;
// anything else — an unknown word, or no "Verdict:" label at all — is "unreadable" (fail
// closed), returned as ''. Requires the literal label "Verdict" immediately followed by
// a colon, so ordinary prose that merely mentions "verdict" never matches.
function parseVerdict(body) {
  const lines = String(body || '').split(/\r?\n/)
  let value = ''
  for (const line of lines) {
    const m = /\bVerdict\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    // Backticks, when present, delimit the value exactly (so trailing prose after the
    // closing backtick, e.g. a parenthetical aside, is never swept in). Without
    // backticks the rest of the line is the value.
    const backticked = /^\**\s*`([^`]+)`/.exec(m[1])
    value = backticked ? backticked[1] : m[1]
  }
  const normalized = value
    .replace(/[`*_]/g, '')
    .trim()
    .replace(/[.,;:!?]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return KNOWN_VERDICTS.includes(normalized) ? normalized : ''
}

// Each code owner's standing approval: their latest APPROVED / CHANGES_REQUESTED /
// DISMISSED review decides, as on GitHub (a plain comment changes nothing). Returns the
// approvals still standing; none at all if any owner's latest word is "changes requested".
function standingOwnerApprovals(f) {
  const latest = new Map()
  const decisive = f.approvals
    .map((a, i) => ({ ...a, i }))
    .filter(a => f.owners.includes(a.user) && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(a.state))
    .sort((a, b) => ((a.submittedAt || '') === (b.submittedAt || '') ? a.i - b.i : (a.submittedAt || '') < (b.submittedAt || '') ? -1 : 1))
  for (const a of decisive) latest.set(a.user, a)
  const standing = [...latest.values()]
  if (standing.some(a => a.state === 'CHANGES_REQUESTED')) return []
  return standing.filter(a => a.state === 'APPROVED')
}

function decide(f) {
  const hold = reason => ({ pass: false, reason })
  const pass = reason => ({ pass: true, reason })
  if (!f.labels.includes(LOOP_LABEL)) return pass(`not an ${LOOP_LABEL} PR: not gated by the review verdict`)
  const approvals = standingOwnerApprovals(f)
  if (approvals.some(a => a.commitId === f.headSha)) {
    return pass(`a code owner approved ${f.headSha.slice(0, 8)}`)
  }
  const review = decideReview(f, hold, pass)
  if (review.pass) return review
  // An approval of an earlier commit still stands when everything pushed since only
  // merged the base branch in: the PR's own diff is exactly what was approved.
  // prDiffUnchanged runs git; any failure, or any doubt, is "not unchanged" (hold).
  let note = ''
  for (const a of approvals) {
    let r
    try { r = f.prDiffUnchanged ? f.prDiffUnchanged(a.commitId) : { same: false, why: 'no git comparison available' } }
    catch (e) { r = { same: false, why: `git comparison failed: ${e && e.message}` } }
    if (r && r.same === true) {
      return pass(`a code owner approved ${String(a.commitId).slice(0, 8)}, and every commit since only merged the base branch in (the PR's own diff is unchanged)`)
    }
    note = `; a code owner approved ${String(a.commitId).slice(0, 8)}, but that approval does not carry to this commit: ${(r && r.why) || 'unknown'}`
  }
  return hold(review.reason + note)
}

function decideReview(f, hold, pass) {
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

// Run git in `cwd`; returns stdout, throws on a non-zero exit.
function makeGit(cwd, env) {
  const { execFileSync } = require('child_process')
  return (args, input) => execFileSync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 256 << 20, input,
    env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'],
  })
}

// Is the PR's own change at `headSha` identical to what it was at `approvedSha`?
// "The PR's own change" at a commit C is `git diff $(git merge-base <base> C) C`: what C
// adds on top of the base it last merged. A commit that only merges the base branch in
// moves that merge base forward and leaves this diff alone, so its stable patch-id
// (which ignores line numbers, hence text shifted by base changes above the PR's hunks)
// is unchanged. New code, or a conflict resolution that alters the PR's lines, changes
// it. Also requires approvedSha to be an ancestor of headSha (no force-push rewrites).
// Never throws: any git failure answers { same: false } with the reason.
function prDiffUnchanged({ git, baseRef, approvedSha, headSha }) {
  const short = s => String(s).slice(0, 8)
  try {
    try { git(['merge-base', '--is-ancestor', approvedSha, headSha]) }
    catch (e) {
      if (e && e.status === 1) return { same: false, why: `${short(approvedSha)} is not an ancestor of ${short(headSha)}` }
      throw e
    }
    const patchId = sha => {
      const mb = git(['merge-base', baseRef, sha]).trim()
      const diff = git(['-c', 'core.quotepath=false', 'diff', '--binary', '--full-index', '--no-renames',
        '--no-ext-diff', '--no-textconv', '--no-color', mb, sha, '--'])
      if (!diff.trim()) return ''
      return (git(['patch-id', '--stable'], diff).trim().split(/\s+/)[0]) || ''
    }
    const approved = patchId(approvedSha)
    const head = patchId(headSha)
    if (!approved || !head) return { same: false, why: 'the PR diff is empty at one of the two commits' }
    if (approved !== head) return { same: false, why: `the PR's own diff changed after ${short(approvedSha)} (new code, or a merge that altered the PR's lines)` }
    return { same: true, why: '' }
  } catch (e) {
    const detail = String((e && (e.stderr || e.message)) || e).trim().split('\n')[0]
    return { same: false, why: `git comparison failed: ${detail}` }
  }
}

// The verdict job checks out the base commit shallowly; fetch the full history of the
// base branch and the PR head, plus any commit still missing (e.g. an approved commit
// no longer on the branch). Throws on failure; the caller turns that into a hold.
function fetchHistory(git, pr, baseRef) {
  const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true'
  git(['fetch', '--quiet', '--no-tags', ...(shallow ? ['--unshallow'] : []), 'origin',
    `+refs/heads/${baseRef}:refs/verdict-gate/base`, `+refs/pull/${pr}/head:refs/verdict-gate/head`])
}
function ensureCommits(git, shas) {
  for (const sha of shas) {
    try { git(['cat-file', '-e', `${sha}^{commit}`]) }
    catch { git(['fetch', '--quiet', '--no-tags', 'origin', sha]) }
  }
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
    .map(r => ({ user: r.user && r.user.login, state: r.state, commitId: r.commit_id, submittedAt: r.submitted_at || '' }))
  // Only runs when a code owner's standing approval is on an older commit (lazy: most
  // runs never touch git history).
  const root = path.join(__dirname, '..', '..')
  const git = makeGit(root)
  let fetched = null
  const prDiffUnchangedAt = approvedSha => {
    if (!/^[0-9a-f]{40}$/.test(String(approvedSha)) || !/^[0-9a-f]{40}$/.test(headSha)) {
      return { same: false, why: 'not a full commit sha' }
    }
    try {
      if (!fetched) {
        fetchHistory(git, pr, api(`repos/${repo}/pulls/${pr}`).base.ref)
        fetched = true
      }
      ensureCommits(git, [headSha, approvedSha])
    } catch (e) {
      const detail = String((e && (e.stderr || e.message)) || e).trim().split('\n')[0]
      return { same: false, why: `could not fetch the history to compare: ${detail}` }
    }
    return prDiffUnchanged({ git, baseRef: 'refs/verdict-gate/base', approvedSha, headSha })
  }
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
    labels, approvals, headSha, reviewJob, prDiffUnchanged: prDiffUnchangedAt,
    owners: owners(path.join(__dirname, '..', '..')),
    sticky: sticky ? { updatedAt: sticky.updated_at, body: sticky.body } : null,
  }
}

module.exports = { decide, parseVerdict, prDiffUnchanged, makeGit, fetchHistory, ensureCommits, LOOP_LABEL, REVIEW_JOB, REVIEW_STEP }

if (require.main === module) {
  const [repo, pr, headSha] = process.argv.slice(2)
  if (!repo || !pr || !headSha) { console.error('usage: review-verdict.cjs <repo> <pr> <head-sha>'); process.exit(2) }
  const r = decide(gather(repo, pr, headSha))
  console.log(`${r.pass ? 'PASS' : 'HOLD'}: ${r.reason}`)
  if (!r.pass) console.log(`::error::Agent-loop PR held: ${r.reason}. A code owner's approval of this commit (or of an earlier one, when every commit since only merged the base branch in) also clears it.`)
  process.exit(r.pass ? 0 : 1)
}
