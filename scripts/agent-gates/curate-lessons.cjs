// Nightly lesson curation for the agent loop (issue #630).
//
// Every loop run ends its PR body with a "Lessons proposed" section
// (.claude/workflows/agent-loop.js, Ship stage), and every run reads
// docs/agents/lessons.md before it starts. Agents may not edit lessons.md: one bad
// lesson written unsupervised would steer every later run. This job is the missing
// middle: it collects the proposals, has a model judge which are real lessons, and
// opens ONE human-reviewed PR that adds the survivors, each linked to its source.
//
// Same split as the loop itself: control flow in code, judgement in a model.
//   - Deterministic (this file): which PRs are new (watermark + source links already
//     in lessons.md + markers on earlier curation PRs), extracting the section,
//     dropping "none" entries, rendering the file, git/gh plumbing as the bot.
//   - Judgement (one `claude -p --json-schema` call, read-only tools): is this a
//     lesson for future runs or a one-issue note, does it duplicate an existing
//     lesson, which proposals are near-duplicates of each other, and the wording.
//     The model never writes a file or a link; it returns ids, and code renders.
//
// Why not a Workflow script like agent-loop.js: Workflow scripts have no filesystem
// or process access (so the collector could not live there), and a Workflow launch
// is approved in an interactive session. This runs unattended at night from Windows
// Task Scheduler, so it is a plain Node script whose one model call is the headless
// equivalent of agent(prompt, {schema}).
//
// Run by hand (from the main checkout, any branch that has this file):
//   node scripts/agent-gates/curate-lessons.cjs --dry-run   # reads everything, writes nothing
//   node scripts/agent-gates/curate-lessons.cjs             # the real nightly run
//   node scripts/agent-gates/curate-lessons.cjs --collect-only   # no model call; list candidates
// Tests (no GitHub, no model):
//   node scripts/agent-gates/curate-lessons.test.cjs
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = 'ayushb3/BubblyChef'
const LESSONS_PATH = 'docs/agents/lessons.md'
const BRANCH_PREFIX = 'chore/lessons-curation-'
const MARKER = 'lessons-curation-sources'
// lessons.md was last curated by hand on 2026-09-18; everything merged since is unread.
const DEFAULT_WATERMARK = '2026-09-18T00:00:00Z'
// One-time backfill: lessons proposed in planning docs rather than PR bodies. They are
// keyed by document, so once handled (linked in lessons.md, listed on a curation PR, or
// recorded in the state file) they are never collected again.
const BACKFILL = [
  { path: 'docs/plans/2026-09-20-autonomous-session-report.md', heading: /^##\s+9\.\s/, label: '2026-09-20 session report §9' },
  // §7 of the handoff is a pointer: it says its lessons are "listed in full" in the
  // 09-20 report §9 and the load-bearing ones are "inlined in §5". So §5 is read too.
  { path: 'docs/plans/2026-09-21-handoff-post-autonomous-batch.md', heading: /^##\s+7\.\s/, label: '2026-09-21 handoff §7' },
  { path: 'docs/plans/2026-09-21-handoff-post-autonomous-batch.md', heading: /^##\s+5\.\s/, label: '2026-09-21 handoff §5' },
]
const BOT = { name: 'bubblychef-bot', email: '330798838+bubblychef-bot@users.noreply.github.com' }
const BOT_GH_DIR = path.join(os.homedir(), '.config', 'gh-bubblychef-bot')
const STATE_FILE = path.join(os.homedir(), '.config', 'bubblychef', 'lessons-curation.json')

// ── Pure parsing ─────────────────────────────────────────────────────────────

const lf = s => String(s || '').replace(/\r\n?/g, '\n')
const indentOf = line => line.match(/^\s*/)[0].length
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
const TERMINATOR = /^\s*(?:(?:fixes|closes|resolves|related to)\s+#\d+|🤖|<!--|---+\s*$)/i

// The "Lessons proposed" part of a PR body, as text, or null if there is none. The loop
// writes it as a heading, a bold line, or a bullet ("- Lessons proposed: ..."), since
// the Ship prompt only says what to include, not the markup.
function extractLessonsSection(body) {
  const lines = lf(body).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heading = /^(#{1,6})\s*(?:\d+\.\s*)?(?:\*\*)?lessons proposed\b.*$/i.exec(line)
    const bold = !heading && /^\s*\*\*lessons proposed\b[^*]*\*\*\s*:?\s*(.*)$/i.exec(line)
    const bullet = !heading && !bold && /^(\s*)[-*+]\s+(?:\*\*)?lessons proposed\b[^:*]*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(.*)$/i.exec(line)
    if (!heading && !bold && !bullet) continue

    const out = []
    if (heading) {
      const level = heading[1].length
      for (let j = i + 1; j < lines.length; j++) {
        const h = /^(#{1,6})\s/.exec(lines[j])
        if ((h && h[1].length <= level) || TERMINATOR.test(lines[j])) break
        out.push(lines[j])
      }
    } else if (bold) {
      if (bold[1].trim()) out.push(bold[1])
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,6}\s/.test(lines[j]) || TERMINATOR.test(lines[j])) break
        if (/^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(lines[j]) && out.some(l => l.trim())) break
        out.push(lines[j])
      }
    } else {
      const base = bullet[1].length
      if (bullet[2].trim()) out.push(bullet[2])
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]
        if (!l.trim()) { out.push(l); continue }
        if (indentOf(l) <= base || TERMINATOR.test(l)) break
        out.push(l)
      }
    }
    const text = out.join('\n').trim()
    return text || null
  }
  return null
}

// A section of a markdown document: the lines after the first heading matching `re`,
// up to the next heading of the same or a higher level.
function extractDocSection(md, re) {
  const lines = lf(md).split('\n')
  const i = lines.findIndex(l => re.test(l))
  if (i < 0) return null
  const level = /^(#+)/.exec(lines[i])[1].length
  const out = []
  for (let j = i + 1; j < lines.length; j++) {
    const h = /^(#{1,6})\s/.exec(lines[j])
    if (h && h[1].length <= level) break
    out.push(lines[j])
  }
  return out.join('\n').replace(/\n---+\s*$/m, '').trim() || null
}

// Split a section into proposed entries. With a list: one entry per top-level item
// (continuation lines folded in); prose outside the list is framing and is skipped,
// except a bold-only line ("**Frontend**"), which becomes the group of the items under
// it. Without a list: one entry per paragraph.
function splitEntries(text) {
  const lines = lf(text).split('\n')
  const items = lines.map(l => LIST_ITEM.exec(l)).filter(Boolean)
  const entries = []
  if (items.length) {
    const top = Math.min(...items.map(m => m[1].length))
    let group = ''
    let cur = null
    const flush = () => { if (cur) entries.push({ text: cur.parts.join(' ').replace(/\s+/g, ' ').trim(), group: cur.group }); cur = null }
    for (const l of lines) {
      const m = LIST_ITEM.exec(l)
      if (m && m[1].length === top) { flush(); cur = { parts: [m[2]], group }; continue }
      if (!l.trim()) { if (cur && cur.para) flush(); continue }
      const g = /^\s*\*\*([^*]+)\*\*\s*:?\s*$/.exec(l)
      if (g && indentOf(l) <= top) { flush(); group = g[1].trim(); continue }
      if (cur && indentOf(l) > top) { cur.parts.push(l.trim()); continue }
      if (cur && cur.para) { cur.parts.push(l.trim()); continue }
      flush() // top-level prose ends the current item
      // A top-level paragraph that opens in bold ("**The gate set is three commands.**
      // ...") is written as a lesson; plain framing prose is not.
      if (/^\s*\*\*[^*]+\*\*\S*\s+\S/.test(l)) cur = { parts: [l.trim()], group, para: true }
    }
    flush()
  } else {
    for (const para of lf(text).split(/\n\s*\n/)) {
      const t = para.replace(/\s+/g, ' ').trim()
      if (t) entries.push({ text: t, group: '' })
    }
  }
  return entries.filter(e => e.text)
}

// "None", "None.", "_None._", "N/A", "None — the fix was mechanical." Not "None of the
// tests covered X", which is a lesson that happens to start with the word.
function isNoneEntry(text) {
  const t = String(text).replace(/^[\s_*`]+/, '')
  return /^(?:none|n\/a|nothing(?: new| to add| to propose)?|no (?:new )?lessons?)\b\s*(?:$|[.!,;:—–\-(_*])/i.test(t)
}

// ── Idempotence ──────────────────────────────────────────────────────────────
// A source is handled if ANY of these says so, so losing one record never causes a
// second PR: (1) lessons.md already links it, (2) an earlier curation PR (open, merged
// or closed) lists it in its marker, (3) the local state file has seen it (this covers
// runs where every proposal was dropped, which open no PR). The watermark only bounds
// the GitHub query.

const prKey = n => `pr:${n}`
const docKey = p => `doc:${p}`

function linkedSources(lessonsMd) {
  const keys = new Set()
  for (const m of lf(lessonsMd).matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g)) keys.add(prKey(Number(m[1])))
  for (const m of lf(lessonsMd).matchAll(/(docs\/plans\/[\w.-]+\.md)/g)) keys.add(docKey(m[1]))
  return keys
}

function markerLine(keys) { return `<!-- ${MARKER}: ${[...keys].sort().join(' ')} -->` }
function parseMarker(body) {
  const m = new RegExp(`<!--\\s*${MARKER}:\\s*([^>]*?)\\s*-->`).exec(lf(body))
  return m ? m[1].split(/\s+/).filter(Boolean) : []
}

function emptyState() { return { version: 1, watermark: null, seen: [] } }

// Everything new since the last run, as judge-ready candidates.
//   prs:       merged PRs [{number, title, url, mergedAt, body, headRefName}]
//   docs:      [{path, label, text}] backfill sections (text already extracted)
//   handled:   Set of source keys already dealt with
// Returns {candidates, sources, noneOnly, skipped}. `sources` is every source whose
// section was read this run (so it can be recorded as seen once the run succeeds).
function collect({ prs, docs, handled, watermark }) {
  const wm = watermark || DEFAULT_WATERMARK
  const candidates = []
  const sources = []
  const noneOnly = []
  const skipped = []
  let n = 0
  const add = (source, entries) => {
    const real = entries.filter(e => !isNoneEntry(e.text))
    sources.push(source)
    if (!real.length) { noneOnly.push(source.key); return }
    for (const e of real) candidates.push({ id: `c${++n}`, source: source.key, group: e.group, text: e.text })
  }
  for (const doc of docs) {
    const key = docKey(doc.path)
    if (handled.has(key)) { skipped.push({ key, why: 'already handled' }); continue }
    if (!doc.text) { skipped.push({ key, why: 'section not found' }); continue }
    add({ key, label: doc.label, url: `https://github.com/${REPO}/blob/main/${doc.path}` }, splitEntries(doc.text))
  }
  const sorted = [...prs].sort((a, b) => a.number - b.number)
  for (const pr of sorted) {
    const key = prKey(pr.number)
    if (String(pr.headRefName || '').startsWith(BRANCH_PREFIX)) continue // our own output
    if (pr.mergedAt && pr.mergedAt < wm) continue
    if (handled.has(key)) { skipped.push({ key, why: 'already handled' }); continue }
    const section = extractLessonsSection(pr.body)
    if (!section) continue
    add({ key, label: `PR #${pr.number}`, url: pr.url || `https://github.com/${REPO}/pull/${pr.number}`, title: pr.title }, splitEntries(section))
  }
  return { candidates, sources, noneOnly, skipped }
}

// The state to save after a successful run: the watermark moves to the newest merge
// read, and every source read this run is remembered.
function nextState(state, { prs, sourceKeys }) {
  const s = { ...emptyState(), ...(state || {}) }
  const seen = new Set(s.seen || [])
  for (const k of sourceKeys) seen.add(k)
  let wm = s.watermark || DEFAULT_WATERMARK
  for (const pr of prs) if (pr.mergedAt && pr.mergedAt > wm) wm = pr.mergedAt
  return { version: 1, watermark: wm, seen: [...seen].sort() }
}

// ── Judgement: validate, then render ─────────────────────────────────────────

const DROP_REASONS = ['none', 'duplicate-of-existing', 'issue-specific', 'not-a-lesson', 'no-longer-true', 'other']
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    keep: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'an existing "## " heading of lessons.md, verbatim without the hashes; or a new short area name' },
          text: { type: 'string', description: 'the lesson as it should appear, WITHOUT the leading "- " and WITHOUT any source link. Start with a **bold one-line statement of what goes wrong**, then what to do instead. 1-4 short sentences.' },
          from: { type: 'array', items: { type: 'string' }, description: 'candidate ids merged into this lesson (one or more)' },
        },
        required: ['section', 'text', 'from'],
      },
    },
    drop: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reason: { type: 'string', enum: DROP_REASONS },
          why: { type: 'string', description: 'one line; for duplicate-of-existing, quote the existing lesson it duplicates' },
        },
        required: ['id', 'reason', 'why'],
      },
    },
  },
  required: ['keep', 'drop'],
}

// Every candidate must be accounted for exactly once. Anything else is a judge error,
// and the run stops without recording anything, so those candidates come back tomorrow.
function validateJudgment(j, candidates) {
  const ids = new Set(candidates.map(c => c.id))
  const seen = new Map()
  const errors = []
  const mark = (id, where) => {
    if (!ids.has(id)) errors.push(`${where} names unknown candidate ${id}`)
    else if (seen.has(id)) errors.push(`${id} is in both ${seen.get(id)} and ${where}`)
    else seen.set(id, where)
  }
  for (const [i, k] of (j.keep || []).entries()) {
    if (!k.from || !k.from.length) errors.push(`keep[${i}] has no source candidates`)
    if (!String(k.text || '').trim()) errors.push(`keep[${i}] has no text`)
    if (/^\s*#/m.test(k.text || '')) errors.push(`keep[${i}] contains a heading`)
    if (!String(k.section || '').trim()) errors.push(`keep[${i}] has no section`)
    for (const id of k.from || []) mark(id, `keep[${i}]`)
  }
  for (const d of j.drop || []) {
    mark(d.id, 'drop')
    if (!DROP_REASONS.includes(d.reason)) errors.push(`drop ${d.id} has unknown reason ${d.reason}`)
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`candidate ${id} is neither kept nor dropped`)
  return errors
}

function sourceLinks(keep, candidates, sourcesByKey) {
  const byId = new Map(candidates.map(c => [c.id, c]))
  const keys = [...new Set(keep.from.map(id => byId.get(id).source))]
  return keys.map(k => { const s = sourcesByKey.get(k); return `[${s.label}](${s.url})` })
}

// lessons.md is hand-wrapped at about 85 columns; new bullets match it.
const WRAP_AT = 86
function wrap(text, width) {
  const out = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = word } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

// Insert the kept lessons into lessons.md: appended to the end of their "## " section,
// or in a new section at the end of the file. The model's text is used as the bullet
// body; the source links are always added here, by code.
function renderLessons(lessonsMd, judgment, candidates, sourcesByKey) {
  let lines = lf(lessonsMd).replace(/\n+$/, '').split('\n')
  for (const k of judgment.keep) {
    const wrapped = wrap(lf(k.text).replace(/\s+/g, ' ').trim(), WRAP_AT - 2)
    const bullet = [`- ${wrapped[0]}`, ...wrapped.slice(1).map(l => `  ${l}`), `  Source: ${sourceLinks(k, candidates, sourcesByKey).join(', ')}.`]
    const want = k.section.trim().replace(/^#+\s*/, '').toLowerCase()
    const h = lines.findIndex(l => /^##\s/.test(l) && l.replace(/^##\s+/, '').trim().toLowerCase() === want)
    if (h < 0) {
      lines.push('', `## ${k.section.trim().replace(/^#+\s*/, '')}`, '', ...bullet)
      continue
    }
    let end = lines.length
    for (let j = h + 1; j < lines.length; j++) if (/^#{1,2}\s/.test(lines[j])) { end = j; break }
    let at = end
    while (at > h + 1 && !lines[at - 1].trim()) at--
    lines = [...lines.slice(0, at), ...bullet, ...lines.slice(at)]
  }
  return lines.join('\n') + '\n'
}

function judgePrompt(lessonsMd, candidates, sourcesByKey) {
  const list = candidates.map(c => {
    const s = sourcesByKey.get(c.source)
    return { id: c.id, source: s.label + (s.title ? ` (${s.title})` : ''), group: c.group || undefined, proposal: c.text }
  })
  return `You curate docs/agents/lessons.md for the BubblyChef repo. Every agent-loop run reads that
file before it starts, so a lesson in it steers every later run. Agents propose lessons in PR
bodies; you decide which proposals become lessons. A human reviews your result as a PR.

The current file is below, including its own rules for what belongs there. Follow them.

<lessons.md>
${lessonsMd}
</lessons.md>

Candidate proposals (JSON). Each has an id; "source" is where it was proposed.
<candidates>
${JSON.stringify(list, null, 2)}
</candidates>

Decide every candidate: it goes into exactly one keep[].from, or into drop. Drop when:
- none: it proposes nothing.
- duplicate-of-existing: an existing lesson already says it (quote which in "why").
- issue-specific: it is about one issue, one PR or one run, not something a future run on a
  different issue would need (e.g. "issue #478 said delete AddItemModal").
- not-a-lesson: a status note, a todo, a decision record, or framing text.
- no-longer-true: the repo no longer behaves that way. You may check with Read/Grep/Glob in the
  current directory, a checkout of main. Only use this when you checked.
- other: say why.
Keep a proposal when it is true of this repo, not obvious from reading the code, and would stop a
future run making the same mistake. Merge near-duplicates (including proposals from different
sources) into ONE lesson listing every id in "from". Keep the file short: prefer fewer, sharper
lessons; fold small related points together. Write each kept lesson in the file's format: a
**bold statement of what goes wrong**, then what to do instead, in that order, 1-4 short
sentences, plain and specific. Do not include source links; they are added for you. Put it under
an existing section heading when one fits (use the heading text verbatim), else a new short one.
Do not propose edits to existing lessons.`
}

// ── Side effects (not unit-tested; the dry run exercises the read side) ──────

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.error) throw new Error(`${cmd} ${args.join(' ')}: ${r.error.message}`)
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} … exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 800)}`)
  return r
}
const gh = (args, opts) => run('gh', args, opts).stdout
function botEnv() {
  const env = { ...process.env, GH_CONFIG_DIR: BOT_GH_DIR }
  // gh reads GH_TOKEN/GITHUB_TOKEN ahead of GH_CONFIG_DIR: an ambient token would make a
  // "bot" command land as its owner. Clear them on every bot command.
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  return env
}
const BOT_CRED_HELPER = '!f() { GH_TOKEN= GITHUB_TOKEN= GH_CONFIG_DIR="$HOME/.config/gh-bubblychef-bot" gh auth git-credential "$@"; }; f'

function readState() {
  try { return { ...emptyState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } } catch { return emptyState() }
}
function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n')
}

function judge(prompt, cwd) {
  const r = run('claude', ['-p', '--model', 'opus', '--tools', 'Read,Grep,Glob', '--output-format', 'json', '--json-schema', JSON.stringify(JUDGE_SCHEMA)], { input: prompt, cwd, timeout: 20 * 60 * 1000 })
  const out = JSON.parse(r.stdout)
  if (out.is_error || !out.structured_output) throw new Error(`judge returned no structured output: ${String(out.result || r.stdout).slice(0, 500)}`)
  return out.structured_output
}

function main(argv) {
  const dry = argv.includes('--dry-run')
  const collectOnly = argv.includes('--collect-only')
  const repoRoot = run('git', ['rev-parse', '--show-toplevel']).stdout.trim()
  const git = (args, opts) => run('git', args, { cwd: repoRoot, ...opts }).stdout
  const say = s => console.log(s)
  say(`lessons curation — ${new Date().toISOString()}${dry ? ' (DRY RUN: nothing is written)' : ''}${collectOnly ? ' (collect only)' : ''}`)

  // 1. Kill switch and identity, as the loop does. Checked, not assumed.
  const enabled = run('gh', ['variable', 'get', 'AGENTS_ENABLED', '--repo', REPO], { allowFail: true })
  const on = enabled.status === 0 && enabled.stdout.trim() === 'true'
  if (!on) {
    say(`AGENTS_ENABLED is not "true" (${(enabled.stdout || enabled.stderr).trim() || 'unreadable'}).`)
    if (!dry && !collectOnly) { say('Stopping: the kill switch is on or could not be read.'); return 0 }
  }
  const who = run('gh', ['api', 'user', '--jq', '.login'], { env: botEnv(), allowFail: true }).stdout.trim()
  if (who !== BOT.name) {
    say(`Bot identity resolves to "${who || 'nothing'}", not ${BOT.name}.`)
    if (!dry && !collectOnly) { say('Stopping: writes must land as the bot.'); return 1 }
  }

  // 2. Read main as it is on GitHub, never the working tree (the checkout may be on
  //    any branch).
  git(['fetch', '--quiet', 'origin', 'main'])
  const show = p => git(['show', `origin/main:${p}`], { allowFail: true }) || ''
  const lessonsMd = lf(show(LESSONS_PATH))
  if (!lessonsMd.trim()) throw new Error(`${LESSONS_PATH} not found on origin/main`)

  // 3. What is already handled.
  const state = readState()
  const handled = new Set([...linkedSources(lessonsMd), ...(state.seen || [])])
  const curationPrs = JSON.parse(gh(['pr', 'list', '--repo', REPO, '--state', 'all', '--limit', '100', '--search', `"${MARKER}" in:body`, '--json', 'number,state,headRefName,body']))
    .filter(p => String(p.headRefName).startsWith(BRANCH_PREFIX))
  for (const p of curationPrs) for (const k of parseMarker(p.body)) handled.add(k)
  const open = curationPrs.filter(p => p.state === 'OPEN')
  if (open.length) {
    say(`A curation PR is still open: ${open.map(p => `#${p.number}`).join(', ')}. Its sources count as handled.`)
    if (!dry && !collectOnly) { say('Stopping: one curation PR at a time; the next run resumes once it merges or closes.'); return 0 }
  }

  // 4. Collect.
  const watermark = state.watermark || DEFAULT_WATERMARK
  say(`Watermark: merged since ${watermark}. Already handled: ${handled.size} source(s).`)
  const prs = JSON.parse(gh(['pr', 'list', '--repo', REPO, '--state', 'merged', '--limit', '500', '--search', `merged:>=${watermark}`, '--json', 'number,title,url,mergedAt,body,headRefName']))
  const docs = BACKFILL.map(b => ({ path: b.path, label: b.label, text: extractDocSection(show(b.path), b.heading) }))
  // Backfill sections from one document share a source key; join them.
  const docsByPath = new Map()
  for (const d of docs) {
    const prev = docsByPath.get(d.path)
    docsByPath.set(d.path, prev ? { ...prev, label: `${prev.label}, ${d.label.replace(/^.*?(§\d+)$/, '$1')}`, text: [prev.text, d.text].filter(Boolean).join('\n\n') || null } : d)
  }
  const { candidates, sources, noneOnly, skipped } = collect({ prs, docs: [...docsByPath.values()], handled, watermark })
  const sourcesByKey = new Map(sources.map(s => [s.key, s]))
  const newState = nextState(state, { prs, sourceKeys: sources.map(s => s.key) })
  say(`Read ${prs.length} merged PR(s); ${sources.length} new source(s) with a lessons section; ${noneOnly.length} said "none" (${noneOnly.join(', ') || '-'}); ${skipped.length} already handled.`)
  say(`${candidates.length} candidate proposal(s).`)
  if (collectOnly || dry) for (const c of candidates) say(`  ${c.id} [${sourcesByKey.get(c.source).label}${c.group ? ` / ${c.group}` : ''}] ${c.text}`)
  if (collectOnly) return 0
  if (!candidates.length) {
    say('Nothing new to curate. No PR.')
    if (!dry) writeState(newState)
    return 0
  }

  // 5. Judge. Read-only tools, run in the repo so it can check a claim against the code.
  const judgment = judge(judgePrompt(lessonsMd, candidates, sourcesByKey), repoRoot)
  const errors = validateJudgment(judgment, candidates)
  if (errors.length) { say(`Judge output rejected, nothing recorded (retries next run):\n  ${errors.join('\n  ')}`); return 1 }
  const byId = new Map(candidates.map(c => [c.id, c]))
  const report = []
  report.push(`\nWould add ${judgment.keep.length} lesson(s):`)
  for (const k of judgment.keep) report.push(`  + [${k.section}] ${k.text.replace(/\s+/g, ' ')}\n      from ${k.from.map(id => `${id} (${sourcesByKey.get(byId.get(id).source).label})`).join(', ')}`)
  report.push(`\nDropped ${judgment.drop.length} proposal(s):`)
  for (const d of judgment.drop) report.push(`  - ${d.id} (${sourcesByKey.get(byId.get(d.id).source).label}) ${d.reason}: ${d.why}\n      proposal: ${byId.get(d.id).text.slice(0, 160)}`)
  say(report.join('\n'))
  if (!judgment.keep.length) {
    say('\nNothing worth adding. No PR.')
    if (!dry) writeState(newState)
    return 0
  }
  const newMd = renderLessons(lessonsMd, judgment, candidates, sourcesByKey)
  if (dry) {
    say(`\n--- ${LESSONS_PATH} after curation (dry run, not written) ---\n${newMd}`)
    return 0
  }

  // 6. One PR, as the bot, from a throwaway worktree at origin/main, so the checkout
  //    this runs from is never touched.
  const day = new Date().toISOString().slice(0, 10)
  let branch = `${BRANCH_PREFIX}${day}`
  if (git(['ls-remote', '--heads', 'origin', branch]).trim()) branch += `-${new Date().toISOString().slice(11, 16).replace(':', '')}`
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-curation-'))
  try {
    git(['worktree', 'add', '--detach', wt, 'origin/main'])
    const w = (args, opts) => run('git', args, { cwd: wt, ...opts }).stdout
    w(['switch', '-c', branch])
    fs.writeFileSync(path.join(wt, LESSONS_PATH), newMd)
    w(['add', LESSONS_PATH])
    w(['-c', `user.name=${BOT.name}`, '-c', `user.email=${BOT.email}`, 'commit', '-m', `docs(lessons): curate ${judgment.keep.length} proposed lesson(s)`])
    w(['-c', 'credential.helper=', '-c', `credential.helper=${BOT_CRED_HELPER}`, 'push', 'origin', `HEAD:refs/heads/${branch}`], { env: botEnv() })
    const keys = sources.map(s => s.key)
    const body = [
      `> Human review required. \`docs/agents/lessons.md\` steers every agent-loop run, and its own rule is that agents never write it unreviewed. Do not merge this without reading it.`,
      '',
      `Nightly lesson curation (\`scripts/agent-gates/curate-lessons.cjs\`, issue #630). It read the "Lessons proposed" sections of PRs merged since ${watermark}${keys.some(k => k.startsWith('doc:')) ? ', plus the one-time backfill from the planning docs' : ''}, and a model judged which are lessons for future runs. Each added lesson ends with a link to where it was proposed.`,
      '',
      report.join('\n').replace(/^\n/, '').replace(/^(Would add|Dropped)/gm, '### $1').replace(/^ {2}([+-]) /gm, '- ').replace(/^ {6}/gm, '  '),
      '',
      `Sources read this run: ${sources.map(s => s.label).join(', ')}.`,
      '',
      markerLine(keys),
      '',
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    ].join('\n')
    const url = gh(['pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', `docs(lessons): curate ${judgment.keep.length} proposed lesson(s) (${day})`, '--body', body], { env: botEnv() }).trim()
    writeState(newState)
    say(`\nOpened ${url}`)
  } finally {
    run('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, allowFail: true })
  }
  return 0
}

module.exports = {
  extractLessonsSection, extractDocSection, splitEntries, isNoneEntry, linkedSources, markerLine, parseMarker,
  collect, nextState, validateJudgment, renderLessons, judgePrompt, JUDGE_SCHEMA, DEFAULT_WATERMARK, BRANCH_PREFIX,
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (e) { console.error(`lessons curation failed: ${e.message}`); process.exitCode = 1 }
}
