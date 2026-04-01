# Workflow Quick Start

## 5 commands for 90% of work

```
describe goal         → Claude enters plan mode → approve → agents implement
/vibe recent          → is this code shippable?
"run gates + fix"     → autonomous improvement loop
"save handoff"        → persist context for next session
```

## Session start

```bash
# Just describe what you want — Claude reads MEMORY.md + ROADMAP.md automatically
"what's the current state of the project?"
```

## After writing code

```bash
/vibe recent          # validate changes before committing
git commit -m "..."   # commit clean diff
"save to memory: [what we decided and why]"
```

## Start a new feature

```
"implement [feature] — here's the spec: docs/plans/my-feature.md"
→ Claude creates task tree → assigns dev1/dev2/designer → they execute in parallel
→ You review diff, then commit
```

## Run quality gates autonomously

```
"run pytest + mypy + ruff + tsc, fix any failures, keep going until all green"
```

## Key files

| File | Purpose |
|------|---------|
| `ROADMAP.md` | Current phase, open issues, success criteria |
| `MEMORY.md` | Auto-loaded decisions and lessons |
| `docs/WORKFLOW.md` | Full workflow reference |
| `docs/guides/testing.md` | Test patterns |
