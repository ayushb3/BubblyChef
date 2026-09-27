// Tests for the deterministic half of the nightly lesson curation (curate-lessons.cjs):
// extracting the "Lessons proposed" section, skipping "none" entries, and the
// watermark / idempotence logic. No GitHub calls, no model.
//   node scripts/agent-gates/curate-lessons.test.cjs     (exit 1 on any failure)
'use strict'
const L = require('./curate-lessons.cjs')

let failures = 0
function check(name, cond, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── extractLessonsSection ────────────────────────────────────────────────────
{
  const body = '## Summary\nx\n\n## Lessons proposed\n\n- **A thing goes wrong.** Do B.\n- Second\n  continued.\n\nFixes #311\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n'
  const s = L.extractLessonsSection(body)
  check('heading form: stops at the Fixes line', s === '- **A thing goes wrong.** Do B.\n- Second\n  continued.', JSON.stringify(s))
}
{
  const s = L.extractLessonsSection('### Lessons proposed\r\n\r\nNone.\r\n\r\nFixes #406\r\n')
  check('CRLF body, level-3 heading', s === 'None.', JSON.stringify(s))
}
{
  const s = L.extractLessonsSection('## Lessons proposed\n- one\n## Not covered\n- other\n')
  check('heading form: stops at the next heading of the same level', s === '- one', JSON.stringify(s))
}
{
  const body = '- Verified: yes\n- Lessons proposed (for the nightly curation): `gh` needs X, so do Y.\n  More detail.\n- Fixes #9\n'
  const s = L.extractLessonsSection(body)
  check('bullet form: inline text plus indented continuation', s === '`gh` needs X, so do Y.\n  More detail.', JSON.stringify(s))
}
{
  const s = L.extractLessonsSection('**Lessons proposed:** none\n\nCloses #3')
  check('bold form with inline text', s === 'none', JSON.stringify(s))
}
check('no section → null', L.extractLessonsSection('## Summary\nNothing about it.\nFixes #1') === null)
check('empty section → null', L.extractLessonsSection('## Lessons proposed\n\nFixes #1') === null)

// ── splitEntries ─────────────────────────────────────────────────────────────
{
  const text = 'Framing prose that is not a lesson.\n\n**Git and GitHub**\n\n- first\n  wraps here\n- second\n\n**Frontend**\n\n- third\n  - nested detail\n'
  const e = L.splitEntries(text)
  check('list: one entry per top-level item, framing skipped', e.length === 3, JSON.stringify(e))
  check('list: continuation lines folded in', e[0].text === 'first wraps here', JSON.stringify(e[0]))
  check('list: bold line becomes the group', e[0].group === 'Git and GitHub' && e[2].group === 'Frontend', JSON.stringify(e))
  check('list: nested bullet folded into its parent', /nested detail/.test(e[2].text), JSON.stringify(e[2]))
}
{
  const text = 'Plain framing.\n\n- item one\n\n**The gate set is three commands.** tsc and\neslint and jest.\n\nMore framing.\n'
  const e = L.splitEntries(text)
  check('list: a top-level paragraph opening in bold is an entry; plain framing is not',
    eq(e.map(x => x.text), ['item one', '**The gate set is three commands.** tsc and eslint and jest.']), JSON.stringify(e))
}
{
  const e = L.splitEntries('Para one\nstill one.\n\nPara two.')
  check('prose: one entry per paragraph', eq(e.map(x => x.text), ['Para one still one.', 'Para two.']), JSON.stringify(e))
}

// ── isNoneEntry ──────────────────────────────────────────────────────────────
for (const t of ['None', 'None.', 'none', '_None._', '*None*', 'N/A', 'None — the fix was mechanical.', 'Nothing new.', 'No lessons.', 'No new lessons', 'None (straightforward change)']) {
  check(`"${t}" is a none entry`, L.isNoneEntry(t) === true)
}
for (const t of ['None of the tests covered the stream path; add one.', 'Nothing in CI checks eslint, so run it.', '`gh` reads GH_TOKEN first.', 'Noneable types need a guard']) {
  check(`"${t}" is NOT a none entry`, L.isNoneEntry(t) === false)
}

// ── linkedSources / marker ───────────────────────────────────────────────────
{
  const md = '- **X.** Y.\n  Source: [PR #572](https://github.com/ayushb3/BubblyChef/pull/572), [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md).\n- Plain mention of PR #452 is not a source link.\n'
  const k = L.linkedSources(md)
  check('lessons.md: PR links are handled', k.has('pr:572'))
  check('lessons.md: backfill doc links are handled', k.has('doc:docs/plans/2026-09-20-autonomous-session-report.md'))
  check('lessons.md: a bare "PR #452" is not a source link', !k.has('pr:452'))
}
{
  const line = L.markerLine(new Set(['pr:9', 'doc:docs/plans/a.md', 'pr:10']))
  check('marker round-trips', eq(L.parseMarker(`body\n\n${line}\n\n🤖`).sort(), ['doc:docs/plans/a.md', 'pr:10', 'pr:9']), line)
  check('no marker → []', eq(L.parseMarker('no marker here'), []))
}

// ── collect: watermark and idempotence ───────────────────────────────────────
const PR = (number, mergedAt, lessons, extra = {}) => ({
  number, mergedAt, title: `t${number}`, url: `https://github.com/ayushb3/BubblyChef/pull/${number}`, headRefName: `fix/issue-${number}-x`,
  body: `## Summary\ns\n\n## Lessons proposed\n\n${lessons}\n\nFixes #${number}`, ...extra,
})
const prs = [
  PR(600, '2026-09-24T10:00:00Z', '- **Real lesson A.** Do this.'),
  PR(601, '2026-09-24T11:00:00Z', 'None.'),
  PR(602, '2026-09-25T09:00:00Z', '- **Real lesson B.** Do that.\n- None'),
  PR(603, '2026-09-25T10:00:00Z', 'no lessons section here', { body: 'Just a summary.\n\nFixes #603' }),
  PR(604, '2026-09-26T10:00:00Z', '- **Curated lessons.**', { headRefName: `${L.BRANCH_PREFIX}2026-09-26` }),
  PR(590, '2026-09-10T10:00:00Z', '- **Before the watermark.**'),
]
const docs = [{ path: 'docs/plans/2026-09-20-autonomous-session-report.md', label: '09-20 §9', text: '**Frontend**\n\n- **Doc lesson.** Do D.\n' }]
{
  const r = L.collect({ prs, docs, handled: new Set(), watermark: null })
  const texts = r.candidates.map(c => c.text)
  check('first run: backfill doc is collected', texts.includes('**Doc lesson.** Do D.'), JSON.stringify(texts))
  check('first run: real PR lessons collected', texts.includes('**Real lesson A.** Do this.') && texts.includes('**Real lesson B.** Do that.'), JSON.stringify(texts))
  check('"none" entries never become candidates', !texts.some(t => /^none\.?$/i.test(t)), JSON.stringify(texts))
  check('a PR that only said none is recorded as none-only', eq(r.noneOnly, ['pr:601']), JSON.stringify(r.noneOnly))
  check('a PR merged before the watermark is ignored', !texts.some(t => /Before the watermark/.test(t)))
  check("the job's own curation PRs are never read back", !texts.some(t => /Curated lessons/.test(t)))
  check('a PR with no lessons section is not a source', !r.sources.some(s => s.key === 'pr:603'))
  check('candidate ids are unique', new Set(r.candidates.map(c => c.id)).size === r.candidates.length)

  // Save state as a successful run would, then run again over the same window.
  const state = L.nextState(null, { prs, sourceKeys: r.sources.map(s => s.key) })
  check('watermark advances to the newest merge read', state.watermark === '2026-09-26T10:00:00Z', state.watermark)
  const again = L.collect({ prs, docs, handled: new Set(state.seen), watermark: state.watermark })
  check('second run over the same window: nothing to curate (no second PR)', again.candidates.length === 0, JSON.stringify(again.candidates))

  // Lost state file: the links already in lessons.md still stop a repeat.
  const lessonsAfterMerge = '## Frontend\n\n- **Doc lesson.** Do D.\n  Source: [x](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md).\n- **Real lesson A.** Do this.\n  Source: [PR #600](https://github.com/ayushb3/BubblyChef/pull/600), [PR #602](https://github.com/ayushb3/BubblyChef/pull/602).\n'
  const noState = L.collect({ prs, docs, handled: L.linkedSources(lessonsAfterMerge), watermark: null })
  check('state lost: linked sources are still handled', noState.candidates.length === 0, JSON.stringify(noState.candidates))

  // Lost state, curation PR still open: its marker stops a repeat.
  const marker = L.markerLine(new Set(r.sources.map(s => s.key)))
  const viaMarker = L.collect({ prs, docs, handled: new Set(L.parseMarker(marker)), watermark: null })
  check('state lost: sources on an earlier curation PR are handled', viaMarker.candidates.length === 0, JSON.stringify(viaMarker.candidates))

  // A new PR after the window is picked up, alone.
  const later = [...prs, PR(610, '2026-09-27T01:00:00Z', '- **Newer lesson.** Do N.')]
  const next = L.collect({ prs: later, docs, handled: new Set(state.seen), watermark: state.watermark })
  check('next window: only the new PR is collected', eq(next.candidates.map(c => c.source), ['pr:610']), JSON.stringify(next.candidates))
}
{
  const s = L.nextState({ version: 1, watermark: '2026-09-30T00:00:00Z', seen: ['pr:1'] }, { prs: [PR(5, '2026-09-20T00:00:00Z', '-')], sourceKeys: ['pr:5'] })
  check('watermark never moves backwards', s.watermark === '2026-09-30T00:00:00Z', s.watermark)
  check('seen accumulates', eq(s.seen, ['pr:1', 'pr:5']), JSON.stringify(s.seen))
}

// ── validateJudgment ─────────────────────────────────────────────────────────
{
  const cands = [{ id: 'c1', source: 'pr:1', text: 'a' }, { id: 'c2', source: 'pr:2', text: 'b' }, { id: 'c3', source: 'pr:2', text: 'c' }]
  const good = { keep: [{ section: 'Agents', text: '**X.** Y.', from: ['c1', 'c2'] }], drop: [{ id: 'c3', reason: 'issue-specific', why: 'one PR' }] }
  check('valid judgment passes', L.validateJudgment(good, cands).length === 0, L.validateJudgment(good, cands).join('; '))
  const missing = { keep: [], drop: [{ id: 'c1', reason: 'other', why: '' }] }
  check('a candidate left undecided is an error', L.validateJudgment(missing, cands).some(e => /c2 is neither/.test(e)))
  const twice = { keep: [{ section: 'A', text: 't', from: ['c1'] }], drop: [{ id: 'c1', reason: 'other', why: '' }, { id: 'c2', reason: 'other', why: '' }, { id: 'c3', reason: 'other', why: '' }] }
  check('a candidate both kept and dropped is an error', L.validateJudgment(twice, cands).some(e => /both/.test(e)))
  const unknown = { keep: [{ section: 'A', text: 't', from: ['c9'] }], drop: cands.map(c => ({ id: c.id, reason: 'other', why: '' })) }
  check('an unknown candidate id is an error', L.validateJudgment(unknown, cands).some(e => /unknown candidate c9/.test(e)))
  const heading = { keep: [{ section: 'A', text: '# Injected\n**x**', from: ['c1'] }], drop: [{ id: 'c2', reason: 'other', why: '' }, { id: 'c3', reason: 'other', why: '' }] }
  check('a kept lesson that contains a heading is an error', L.validateJudgment(heading, cands).some(e => /heading/.test(e)))
}

// ── renderLessons ────────────────────────────────────────────────────────────
{
  const md = '# Lessons\n\nIntro.\n\n---\n\n## Git and GitHub\n\n- **Old.** Keep.\n\n## Agents\n\n- **Old agent.** Keep.\n'
  const cands = [{ id: 'c1', source: 'pr:572' }, { id: 'c2', source: 'doc:docs/plans/r.md' }, { id: 'c3', source: 'pr:600' }]
  const src = new Map([
    ['pr:572', { label: 'PR #572', url: 'https://github.com/ayushb3/BubblyChef/pull/572' }],
    ['doc:docs/plans/r.md', { label: 'report §9', url: 'https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/r.md' }],
    ['pr:600', { label: 'PR #600', url: 'https://github.com/ayushb3/BubblyChef/pull/600' }],
  ])
  const out = L.renderLessons(md, { keep: [
    { section: 'Git and GitHub', text: '**New git.** Do G.\nSecond line.', from: ['c1', 'c2'] },
    { section: 'Backend', text: '**New backend.** Do B.', from: ['c3'] },
  ], drop: [] }, cands, src)
  const gitBlock = out.split('## Agents')[0]
  check('render: lesson lands at the end of its existing section', /- \*\*Old\.\*\* Keep\.\n- \*\*New git\.\*\* Do G\. Second line\.\n {2}Source:/.test(gitBlock), gitBlock)
  const long = L.renderLessons('## A\n', { keep: [{ section: 'A', text: 'word '.repeat(60).trim(), from: ['c1'] }], drop: [] }, cands, src)
  check('render: long lessons wrap to the file\'s width with a two-space hang',
    long.split('\n').every(l => l.length <= 86 || l.startsWith('  Source:')) && long.split('\n').filter(l => /^ {2}word/.test(l)).length >= 2, long)
  check('render: every source is linked, by code', gitBlock.includes('Source: [PR #572](https://github.com/ayushb3/BubblyChef/pull/572), [report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/r.md).'), gitBlock)
  check('render: a new area becomes a new section at the end', /## Backend\n\n- \*\*New backend\.\*\* Do B\.\n {2}Source: \[PR #600\]/.test(out), out)
  check('render: existing lessons untouched', out.includes('- **Old agent.** Keep.'))
  check('render: rendered file links its sources, so a rerun treats them as handled', ['pr:572', 'pr:600', 'doc:docs/plans/r.md'].every(k => L.linkedSources(out).has(k)))
}

// ── judge schema sanity ──────────────────────────────────────────────────────
check('judge schema requires keep and drop', eq(L.JUDGE_SCHEMA.required, ['keep', 'drop']))
check('judge prompt carries the candidates and the file', (() => { const p = L.judgePrompt('LESSONS-BODY', [{ id: 'c1', source: 'pr:1', text: 'PROPOSAL' }], new Map([['pr:1', { label: 'PR #1' }]])); return p.includes('LESSONS-BODY') && p.includes('PROPOSAL') && p.includes('"c1"') })())

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
