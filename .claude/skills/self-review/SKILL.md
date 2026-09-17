---
name: self-review
description: Orchestrate multi-agent PR self-review with consolidated findings posted as GitHub PR comment
---

# Self-Review Skill

Runs a comprehensive multi-agent self-review on a pull request and posts consolidated findings as a GitHub comment.

**Announce at start:** "I'm using the self-review skill to run a comprehensive multi-agent review of your PR."

## Overview

This skill:
1. Launches specialized review agents in parallel via Workflow
2. Adversarially verifies blocking and important findings (filters false positives)
3. Synthesizes findings into a consolidated report
4. Guides interactive triage with the author
5. Posts final report as a PR comment via `gh pr comment`

## Usage

```
/self-review [pr-number]
/self-review [owner/repo#pr-number]
```

If no PR number is provided, will detect from current branch.

## Checklist

You MUST create a task for each of these items:

1. **Identify target PR** — determine PR number and repository
2. **Launch parallel review agents** — spawn all agents via Workflow tool
3. **Verify findings** — adversarial skeptic pass on blocking/important findings
4. **Synthesize findings** — consolidate, deduplicate, prioritize
5. **Interactive triage** — guide author through findings
6. **Generate final report** — create markdown summary
7. **Post to GitHub** — add report as PR comment via gh CLI

## Step 1: Identify Target PR

Determine what PR to review:

```bash
# If PR number provided
gh pr view <number>

# If not provided, detect from branch
gh pr list --head $(git branch --show-current) --json number,title,url
```

Extract:
- PR number
- Repository (owner/repo)
- PR title
- Files changed

Collect the diff and file list for the workflow `args`:

```bash
# Get raw diff
gh pr diff <number> > /tmp/pr-diff.txt

# Get changed files list
gh pr view <number> --json files --jq '[.files[].path]'
```

Pass both into the Workflow tool's `args` parameter:
```javascript
args: {
  diff: "<contents of /tmp/pr-diff.txt>",
  changedFiles: ["path/to/file.ts", "path/to/other.py"],
  prNumber: 42,
  prTitle: "Add auth middleware"
}
```

## Step 2: Launch Parallel Review Agents

Use the **Workflow** tool to orchestrate agents in parallel. Create a workflow script that spawns these agents:

### Agents to Launch

1. **code-reviewer** (subagent_type: `code-reviewer`)
   - Focus: style, bugs, architectural fit
   - Input: Files changed in the PR

2. **silent-failure-hunter** (subagent_type: `silent-failure-hunter`)
   - Focus: swallowed errors, missing logging, inadequate error handling
   - Input: Files changed in the PR

3. **pr-test-analyzer** (subagent_type: `pr-test-analyzer`)
   - Focus: test coverage quality, edge cases, assertion meaningfulness
   - Input: PR number and repository

4. **type-design-analyzer** (subagent_type: `type-design-analyzer`)
   - Focus: type encapsulation, invariant expression
   - Input: Files changed in the PR (focus on new/modified types)

5. **comment-analyzer** (subagent_type: `comment-analyzer`)
   - Focus: stale comments, comment rot, misleading docs
   - Input: Files changed in the PR

6. **code-simplifier** (subagent_type: `code-simplifier`)
   - Focus: over-engineered code, unnecessary abstractions, premature generalization
   - Input: Files changed in the PR

### Workflow Script Structure

The workflow receives an `args` object with this shape:
```javascript
// args shape:
// args.diff         — raw git diff string (for LOC counting)
// args.changedFiles — string[] of changed file paths
// args.prNumber     — PR number
// args.prTitle      — PR title string
```

```javascript
export const meta = {
  name: 'pr-self-review',
  description: 'Multi-agent PR review with specialized agents',
  phases: [
    { title: 'Analysis', detail: 'Running specialized review agents' },
    { title: 'Synthesis', detail: 'Consolidating findings' }
  ]
}

phase('Analysis')

const results = await parallel([
  () => agent('Review code for style, bugs, and architecture', {
    label: 'code-reviewer',
    phase: 'Analysis',
    agentType: 'code-reviewer',
    schema: FINDINGS_SCHEMA
  }),
  () => agent('Hunt for silent failures and error handling issues', {
    label: 'silent-failure-hunter',
    phase: 'Analysis',
    agentType: 'silent-failure-hunter',
    schema: FINDINGS_SCHEMA
  }),
  () => agent('Analyze test coverage quality', {
    label: 'pr-test-analyzer',
    phase: 'Analysis',
    agentType: 'pr-test-analyzer',
    schema: FINDINGS_SCHEMA
  }),
  () => agent('Review type design and encapsulation', {
    label: 'type-design-analyzer',
    phase: 'Analysis',
    agentType: 'type-design-analyzer',
    schema: FINDINGS_SCHEMA
  }),
  () => agent('Analyze comments for accuracy and staleness', {
    label: 'comment-analyzer',
    phase: 'Analysis',
    agentType: 'comment-analyzer',
    schema: FINDINGS_SCHEMA
  })
])

phase('Synthesis')
// Note: actual return shape is {metrics, handoff, summary, findings, allFindings}
// See workflow-template.js for the full implementation
return { findings: results.filter(Boolean) }
```

**Important:** 
- Get the list of changed files BEFORE launching the workflow
- Pass file list to agents that need it
- Use structured output schemas for consistent finding format

## Step 2b: Verify Findings

After the workflow completes, the Workflow has already run an adversarial verification pass on all `blocking` and `important` findings. Each finding was reviewed by a skeptic agent that read the actual code at `file:line` and attempted to refute it.

- Findings the skeptic **could not refute** → confirmed, shown in triage
- Findings the skeptic **refuted** → dropped as false positives, logged in the workflow output

`suggestion` and `nice-to-have` findings skip verification — they are surfaced directly in triage.

You do not need to run additional verification steps. The workflow result already contains only confirmed findings.

## Step 3: Synthesize Findings

After workflow completes, consolidate all agent findings:

### Deduplication
- Merge findings about the same file/line from different agents
- Keep the most specific/actionable version

### Prioritization
Categorize findings:
- **🚨 Blocking** — bugs, security issues, silent failures
- **⚠️ Important** — poor type design, missing tests, error handling gaps
- **💡 Suggestions** — style improvements, simplifications
- **✨ Nice-to-have** — comment improvements, minor refactors

### Grouping
Organize by:
1. Category (correctness, test coverage, type design, etc.)
2. File path
3. Severity

## Step 3b: Print Reviewer One-Liner

After the workflow completes, print the reviewer handoff line to the terminal. The author can copy this into Slack or chat when requesting a review:

```
📋 Reviewer handoff (copy this to send to your reviewer):

<value of workflowResult.handoff.oneLiner>
```

Example output:
```
PR "Add auth middleware" | 3 files | 220 LOC (140 prod / 60 test / 20 comments) | ⚠️ 2 need attention | focus: auth.ts, user_model.py
```

Print `workflowResult.handoff.oneLiner` directly to your output. This is terminal-only — do NOT include the one-liner in the GitHub PR comment.

## Step 4: Interactive Triage

Present findings to the author for triage. All `blocking` and `important` findings shown here have already passed adversarial verification — a skeptic agent reviewed each one against the actual code and could not refute it.

Present findings to the author for triage:

```markdown
# Self-Review Findings

## 🚨 Blocking Issues (X)
[List blocking findings]

## ⚠️ Important Issues (Y)
[List important findings]

## 💡 Suggestions (Z)
[List suggestions]
```

For each finding, ask author:
- **Fix now?** — will address immediately
- **Defer?** — acknowledge but handle in follow-up (requires reason)
- **Disagree?** — mark as false positive (requires justification)

Track responses for the final report.

## Step 5: Generate Final Report

Before generating the report, compute these values from the workflow result and triage outcome:
- `focusFiles` — `workflowResult.handoff.focusFiles` (files with blocking/important findings)
- `simplificationFiles` — `workflowResult.handoff.simplificationFiles`
- `dismissedImportantFindings` — findings with severity `blocking` or `important` that the author marked "Disagree" during triage
- `deferredCount` — count of findings the author marked "Defer"

Create a markdown report with this structure:

```markdown
# 🤖 Self-Review Report

**PR:** #<number> - <title>
**Reviewed:** <timestamp>
**Review Type:** Multi-Agent Analysis

---

## 📊 Summary

| Category | Findings | Addressed | Deferred | Dismissed |
|----------|----------|-----------|----------|-----------|
| Code Quality | X | Y | Z | W |
| Silent Failures | X | Y | Z | W |
| Test Coverage | X | Y | Z | W |
| Type Design | X | Y | Z | W |
| Comments | X | Y | Z | W |

---

## ✅ Addressed Findings

### Code Quality
- [x] **File:** `path/to/file.ts:123`
  - **Issue:** Description of issue
  - **Resolution:** How it was fixed

### Silent Failures
...

---

## 📝 Deferred Findings

### Test Coverage
- [ ] **File:** `path/to/file.ts:456`
  - **Issue:** Missing edge case tests
  - **Reason:** Will add in follow-up PR #XXX
  - **Ticket:** [Link to tracking issue]

---

## 🚫 Dismissed Findings

### Type Design
- **File:** `path/to/file.ts:789`
  - **Issue:** Type could be more specific
  - **Justification:** This type is intentionally broad for extensibility

---

## 🎯 Self-Review Checklist

- [x] All blocking issues addressed
- [x] Test coverage reviewed and gaps documented
- [x] Error handling validated
- [x] Type design evaluated
- [x] Comments checked for accuracy
- [x] Simplification opportunities reviewed

---

## 📌 Next Steps

### 👁️ Human Reviewer Focus

**Files to prioritize** (have blocking/important findings):
{{focusFiles — one per line as `- \`path/to/file\``}}

**Simplification candidates** (over-engineered areas):
{{simplificationFiles — one per line as `- \`path/to/file\``, or omit section if empty}}

**Author dismissed — verify these are intentional:**
{{dismissedImportantFindings — each as `- \`file:line\` — title`, or omit section if empty}}

### 📋 Follow-up

- [ ] {{deferredCount}} deferred findings need follow-up tickets
- [ ] Link follow-up PRs/issues in the deferred findings section above

---

*This report was generated by multi-agent self-review using:*
- *Code Reviewer*
- *Silent Failure Hunter*
- *Test Analyzer*
- *Type Design Analyzer*
- *Comment Analyzer*
- *Code Simplifier*
```

## Step 6: Post to GitHub

Post the report as a PR comment:

```bash
# Post report
gh pr comment <pr-number> --body-file <report-file>

# Or with inline markdown
gh pr comment <pr-number> --body "<markdown-content>"
```

Confirm success and provide link to comment.

## Key Principles

- **Parallel execution** — Launch all agents at once via Workflow
- **Structured output** — Use schemas for consistent finding format
- **Author ownership** — Author triages every finding, doesn't just ack
- **Transparency** — Final report shows what was found AND what was done
- **GitHub integration** — Report lives on PR as a comment for reviewers to see
- **Adversarial verification** — Blocking and important findings are verified by a skeptic before triage; author sees only confirmed findings
- **Simplification coverage** — Code simplifier runs in parallel with other agents; never skip it
- **Reviewer handoff** — Always print the one-liner to terminal before triage; it is easy to forget after a long review session

## Common Mistakes

### Running agents sequentially
- **Problem:** Wastes time, defeats the purpose of multi-agent
- **Fix:** Use Workflow with parallel() to run all agents at once

### Posting raw agent output
- **Problem:** Unstructured, duplicative, overwhelming
- **Fix:** Synthesize first, then format nicely

### Skipping interactive triage
- **Problem:** No author accountability, just another bot comment
- **Fix:** Force author to acknowledge each finding with action

### Not checking PR exists
- **Problem:** Workflow runs but there's no PR to comment on
- **Fix:** Validate PR exists with `gh pr view` first

### Forgetting to print the reviewer one-liner
- **Problem:** Author finishes triage, posts report, then has nothing concise to share when requesting review
- **Fix:** Print `workflowResult.handoff.oneLiner` to terminal immediately after workflow completes (Step 3b), before triage begins

## Red Flags

**Never:**
- Run agents sequentially when parallel is possible
- Post findings without synthesis and deduplication
- Skip the interactive triage step
- Forget to post the final report to GitHub
- Run review on non-existent PR
- Present unverified blocking/important findings to the author — run the verify pass first
- Skip the code-simplifier agent — over-engineering is a real review concern
- Omit the reviewer one-liner terminal output

**Always:**
- Validate PR exists before launching agents
- Use Workflow tool for orchestration
- Synthesize and deduplicate findings
- Guide author through every finding
- Post consolidated report as PR comment
- Include summary stats in final report
- Include code-simplifier in the parallel agent batch
- Print reviewer one-liner to terminal after workflow, before triage

## Troubleshooting

### "PR not found"
- Check if on correct branch
- Verify PR is open (not draft or closed)
- Try specifying owner/repo explicitly

### Agent fails
- Check agent is available in system
- Verify input format matches agent expectations
- Review agent-specific error messages

### `gh` command fails
- Ensure GitHub CLI is authenticated: `gh auth status`
- Check repository access permissions
- Verify PR number is correct

## Example Usage

```bash
# Review current branch's PR
/self-review

# Review specific PR
/self-review 123

# Review PR in different repo
/self-review owner/repo#123
```

## Integration Points

This skill works with:
- **The six review agents in `.claude/agents/`** — code-reviewer, silent-failure-hunter, pr-test-analyzer, type-design-analyzer, comment-analyzer, code-simplifier
- **GitHub CLI** — for PR metadata and posting comments
- **Workflow tool** — for parallel agent orchestration
- **Git** — for detecting current branch and changes
