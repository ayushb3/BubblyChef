# Self-Review Skill

Multi-agent PR self-review orchestration that posts consolidated findings to GitHub.

## Quick Start

```bash
# Review current branch's PR
/self-review

# Review specific PR number
/self-review 123

# Review PR in different repo
/self-review owner/repo#123
```

## What It Does

1. **Launches 5 specialized agents in parallel:**
   - Code Reviewer (style, bugs, architecture)
   - Silent Failure Hunter (error handling)
   - Test Analyzer (coverage quality)
   - Type Design Analyzer (encapsulation)
   - Comment Analyzer (staleness, accuracy)

2. **Synthesizes findings:**
   - Deduplicates overlapping findings
   - Prioritizes by severity (blocking → important → suggestions)
   - Groups by category

3. **Interactive triage:**
   - Presents findings to author
   - Author decides: fix now, defer, or dismiss
   - Captures reasoning for each decision

4. **Posts to GitHub:**
   - Consolidated report as PR comment
   - Shows what was found AND what was done
   - Includes summary stats and next steps

## Output Format

The final GitHub comment includes:

```markdown
# 🤖 Self-Review Report

📊 Summary table (findings by category)
✅ Addressed findings (with resolutions)
📝 Deferred findings (with reasons/tickets)
🚫 Dismissed findings (with justifications)
🎯 Self-review checklist
📌 Next steps for human reviewers
```

## Workflow Structure

The skill uses the `Workflow` tool with this structure:

```javascript
Phase 1: Analysis (parallel agents)
  ├─ code-reviewer
  ├─ silent-failure-hunter
  ├─ test-analyzer
  ├─ type-design-analyzer
  └─ comment-analyzer

Phase 2: Synthesis
  ├─ Deduplicate findings
  ├─ Prioritize by severity
  └─ Group by category
```

## Requirements

- GitHub CLI (`gh`) authenticated
- PR must exist (open or draft)
- The six review agents vendored in `.claude/agents/` (code-reviewer, silent-failure-hunter, pr-test-analyzer, type-design-analyzer, comment-analyzer, code-simplifier)

## Tips

- Run this BEFORE requesting human review
- Address blocking issues immediately
- Document deferred items with tracking links
- Use the report to guide reviewer focus

## Integration with CI/CD

You can automate this by:
1. Triggering on PR creation via GitHub Actions
2. Running `/self-review` in CI
3. Posting results automatically

Example GitHub Action:
```yaml
- name: Self-Review
  run: |
    gh pr comment ${{ github.event.pull_request.number }} \
      --body "$(claude-code --skill self-review ${{ github.event.pull_request.number }})"
```

## Customization

Edit `workflow-template.js` to:
- Add/remove agents
- Adjust finding schemas
- Customize severity thresholds
- Change grouping logic

## Troubleshooting

**"PR not found"**
- Ensure you're on a branch with an open PR
- Try specifying PR number explicitly

**Agent fails**
- Check agent is available: `/help agents`
- Verify agent has required permissions

**`gh` auth issues**
- Run: `gh auth status`
- Re-auth: `gh auth login`
