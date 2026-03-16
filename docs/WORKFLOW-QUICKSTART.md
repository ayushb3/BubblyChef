# Workflow Quick Start

## 5 commands for 90% of work

```
/status               → where am I? what's ready?
/rpi "goal"           → full cycle: research + plan + implement + validate
/vibe recent          → is this code shippable?
/plan "goal"          → break into issues, then /crank to execute
/evolve               → run overnight against GOALS.md fitness gates
```

## Session start

```bash
/status               # loads context, shows current work
```

## After writing code

```bash
/vibe recent          # validate changes before committing
git commit -m "..."   # commit clean diff
/retro --quick "what I learned"   # feed the knowledge flywheel
```

## Start a new feature

```bash
/rpi "describe what you want to build"
# → research → plan [approval] → parallel implementation → validate
# You review diff, then commit
```

## Key files

| File | Purpose |
|------|---------|
| `GOALS.md` | Fitness gates — `/evolve` runs until these pass |
| `.agents/` | Knowledge store — auto-injected each session |
| `docs/WORKFLOW.md` | Full workflow reference |
| `docs/AGENTOPS.md` | Complete command reference |
