// PR Self-Review Workflow
// Orchestrates multiple specialized review agents in parallel

export const meta = {
  name: 'pr-self-review',
  description: 'Multi-agent PR review analyzing code quality, tests, types, and error handling',
  phases: [
    { title: 'Analysis', detail: 'Running 6 specialized review agents in parallel' },
    { title: 'Verify', detail: 'Adversarially verifying blocking and important findings' },
    { title: 'Synthesis', detail: 'Consolidating and deduplicating findings' }
  ]
}

// Schema for structured findings output
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['correctness', 'test-coverage', 'error-handling', 'type-design', 'comments', 'style', 'simplification']
          },
          severity: {
            type: 'string',
            enum: ['blocking', 'important', 'suggestion', 'nice-to-have']
          },
          file: { type: 'string' },
          line: { type: 'number' },
          title: { type: 'string' },
          description: { type: 'string' },
          suggestion: { type: 'string' }
        },
        required: ['category', 'severity', 'file', 'title', 'description']
      }
    }
  },
  required: ['findings']
}

// Phase 1: Parallel Analysis
phase('Analysis')
log('Launching 6 specialized review agents...')

const results = await parallel([
  () => agent(
    `Review the code changes for style adherence, potential bugs, and architectural fit. Focus on:
    - Code quality and maintainability
    - Potential bugs or logic errors
    - Consistency with project patterns
    - Performance concerns

    Return structured findings with category, severity, file, line, title, description, and suggestion.`,
    {
      label: 'code-reviewer',
      phase: 'Analysis',
      agentType: 'code-reviewer',
      schema: FINDING_SCHEMA
    }
  ),

  () => agent(
    `Hunt for silent failures and inadequate error handling. Look for:
    - Catch blocks that swallow errors
    - Missing logging in error paths
    - Ignored promise rejections
    - Fallback logic that hides failures
    - Missing error propagation

    Return structured findings with category='error-handling', severity, file, line, title, description, and suggestion.`,
    {
      label: 'silent-failure-hunter',
      phase: 'Analysis',
      agentType: 'silent-failure-hunter',
      schema: FINDING_SCHEMA
    }
  ),

  () => agent(
    `Analyze test coverage quality and completeness. Check:
    - Are new behaviors covered by tests?
    - Do tests validate the right things?
    - Are edge cases tested?
    - Are assertions meaningful?
    - Is happy path AND error path tested?

    Return structured findings with category='test-coverage', severity, file, line, title, description, and suggestion.`,
    {
      label: 'test-analyzer',
      phase: 'Analysis',
      agentType: 'pr-test-analyzer',
      schema: FINDING_SCHEMA
    }
  ),

  () => agent(
    `Review type design and encapsulation quality. Focus on:
    - Are new types well-encapsulated?
    - Do types express invariants?
    - Is primitive obsession avoided?
    - Are types as specific as they should be?
    - Is type safety maximized?

    Return structured findings with category='type-design', severity, file, line, title, description, and suggestion.`,
    {
      label: 'type-design',
      phase: 'Analysis',
      agentType: 'type-design-analyzer',
      schema: FINDING_SCHEMA
    }
  ),

  () => agent(
    `Analyze code comments for accuracy and value. Check for:
    - Stale comments that don't match code
    - Comments explaining WHAT instead of WHY
    - Misleading or outdated documentation
    - Comments that should be code instead
    - Missing comments where WHY is non-obvious

    Return structured findings with category='comments', severity, file, line, title, description, and suggestion.`,
    {
      label: 'comment-analyzer',
      phase: 'Analysis',
      agentType: 'comment-analyzer',
      schema: FINDING_SCHEMA
    }
  ),

  () => agent(
    `Identify over-engineered or unnecessarily complex code. Look for:
    - Abstractions that add indirection without value
    - Classes/functions doing too many things
    - Patterns applied where simpler code would suffice
    - Premature generalization or speculative flexibility
    - Dead code paths or unused parameters

    Return structured findings with category='simplification', severity, file, line, title, description, and suggestion.`,
    {
      label: 'code-simplifier',
      phase: 'Analysis',
      agentType: 'code-simplifier',
      schema: FINDING_SCHEMA
    }
  )
])

log('All agents completed. Synthesizing findings...')

// Phase 2: Synthesis
phase('Synthesis')

// LOC metrics from diff (added lines only)
const metrics = (() => {
  const diff = (args && args.diff) || ''
  const addedLines = diff
    .split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1))

  const isComment = line => {
    const t = line.trimStart()
    return t.startsWith('#') || t.startsWith('//') || t.startsWith('/*') ||
           t.startsWith('*') || t.startsWith('"""') || t.startsWith("'''")
  }

  const testFiles = (args && args.changedFiles || [])
    .filter(f => /test|spec|__tests__|_test/.test(f))

  const commentLines = addedLines.filter(isComment).length
  const testLines = (() => {
    if (!diff) return 0
    let inTestFile = false
    let count = 0
    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git')) {
        inTestFile = testFiles.some(f => line.includes(f))
      }
      if (inTestFile && line.startsWith('+') && !line.startsWith('+++')) {
        count++
      }
    }
    return count
  })()
  const linesAdded = addedLines.length
  const prodLines = linesAdded - commentLines - testLines

  return {
    filesChanged: (args && args.changedFiles || []).length,
    linesAdded,
    prodLines: Math.max(0, prodLines),
    testLines,
    commentLines
  }
})()

log(`LOC — ${metrics.linesAdded} added | ${metrics.prodLines} prod / ${metrics.testLines} test / ${metrics.commentLines} comments`)

// Filter out null results (failed agents)
const validResults = results.filter(Boolean)

// Combine all findings
const allFindings = validResults.flatMap(r => r.findings || [])

log(`Found ${allFindings.length} total findings across ${validResults.length} agents`)

// Deduplicate by file+line+title
const seen = new Set()
const dedupedFindings = allFindings.filter(f => {
  const key = `${f.file}:${f.line}:${f.title}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

log(`After deduplication: ${dedupedFindings.length} unique findings`)

// Adversarial verification — only blocking and important findings get a skeptic
phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' }
  },
  required: ['refuted', 'reason']
}

const highPriority = dedupedFindings.filter(f => f.severity === 'blocking' || f.severity === 'important')
const lowPriority = dedupedFindings.filter(f => f.severity !== 'blocking' && f.severity !== 'important')

log(`Verifying ${highPriority.length} blocking/important findings (${lowPriority.length} suggestions skipped)...`)

const verifyResults = await pipeline(
  highPriority,
  f => agent(
    `You are a skeptical code reviewer trying to identify false positives.

A review agent flagged this finding:
- File: ${f.file}${f.line ? ':' + f.line : ''}
- Category: ${f.category}
- Severity: ${f.severity}
- Title: ${f.title}
- Description: ${f.description}
${f.suggestion ? '- Suggested fix: ' + f.suggestion : ''}

Your job: try to REFUTE this finding. Read the actual code at the file location and determine whether the finding is a real problem or a false positive.

Consider: Is the described problem actually present in the code? Does the context make the finding irrelevant? Is there a reason this pattern is intentional?

Return refuted=true if this is a false positive. Return refuted=false if the finding is legitimate. Always provide a reason.`,
    {
      label: `verify:${f.file}:${f.line || 0}`,
      phase: 'Verify',
      schema: VERIFY_SCHEMA
    }
  )
)

const verifiedFindings = highPriority.filter((f, i) => {
  const result = verifyResults[i]
  if (!result) return true // agent failed — keep the finding
  if (result.refuted) {
    log(`Dropped (false positive): ${f.file}:${f.line} — ${f.title} | Reason: ${result.reason}`)
    return false
  }
  return true
})

log(`Verification complete: ${verifiedFindings.length}/${highPriority.length} blocking/important findings confirmed`)

const confirmedFindings = [...verifiedFindings, ...lowPriority]

// Group by severity
const grouped = {
  blocking: confirmedFindings.filter(f => f.severity === 'blocking'),
  important: confirmedFindings.filter(f => f.severity === 'important'),
  suggestion: confirmedFindings.filter(f => f.severity === 'suggestion'),
  'nice-to-have': confirmedFindings.filter(f => f.severity === 'nice-to-have')
}

// Group by category
const byCategory = {}
confirmedFindings.forEach(f => {
  if (!byCategory[f.category]) byCategory[f.category] = []
  byCategory[f.category].push(f)
})

// Reviewer handoff — one-liner and focus files for human reviewer
const focusFiles = [...new Set(
  [...grouped.blocking, ...grouped.important].map(f => f.file)
)]

const simplificationFiles = [...new Set(
  dedupedFindings
    .filter(f => f.category === 'simplification')
    .map(f => f.file)
)]

const prLabel = (args && args.prTitle) ? `"${args.prTitle}"` : `#${(args && args.prNumber) || '?'}`
const focusPart = focusFiles.length
  ? `| focus: ${focusFiles.slice(0, 3).join(', ')}${focusFiles.length > 3 ? ` +${focusFiles.length - 3} more` : ''}`
  : ''
const deferredCount = grouped.important.length + grouped.blocking.length
const deferredPart = deferredCount > 0 ? `| ⚠️ ${deferredCount} need attention` : '| ✅ clean'

const oneLiner = [
  `PR ${prLabel}`,
  `${metrics.filesChanged} files`,
  `${metrics.linesAdded} LOC (${metrics.prodLines} prod / ${metrics.testLines} test / ${metrics.commentLines} comments)`,
  deferredPart,
  focusPart
].filter(Boolean).join(' | ')

const handoff = {
  oneLiner,
  focusFiles,
  simplificationFiles,
  dismissedCategories: []
}

// Return structured results
return {
  metrics,
  handoff,
  summary: {
    total: dedupedFindings.length,
    blocking: grouped.blocking.length,
    important: grouped.important.length,
    suggestions: grouped.suggestion.length + grouped['nice-to-have'].length,
    byCategory: Object.keys(byCategory).map(cat => ({
      category: cat,
      count: byCategory[cat].length
    }))
  },
  findings: {
    blocking: grouped.blocking,
    important: grouped.important,
    suggestions: [...grouped.suggestion, ...grouped['nice-to-have']]
  },
  allFindings: confirmedFindings
}
