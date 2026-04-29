# Issue Tracker: GitHub

This project tracks work in **GitHub Issues** on https://github.com/ayushb3/BubblyChef.

## How Skills Interact

Skills like `to-issues`, `triage`, `to-prd`, and `diagnose` read/write issues via the GitHub CLI (`gh`).

### Reading Issues
Skills call:
```bash
gh issue list --json title,number,body,labels,state
gh issue view <number> --json title,body,labels,assignees
```

### Creating Issues
Skills call:
```bash
gh issue create --title "..." --body "..." --label "label1,label2"
```

### Updating Issues
Skills call:
```bash
gh issue edit <number> --title "..." --body "..." --label "label1,label2"
gh issue close <number>
```

### Labeling
Skills apply labels based on the triage vocabulary in `docs/agents/triage-labels.md`. See that file for the canonical label names.

## Prerequisites

- GitHub CLI installed: `brew install gh` (or `gh` available in PATH)
- Authenticated: `gh auth status` should show your GitHub account
- Remote configured: `git remote` includes `origin` pointing to https://github.com/ayushb3/BubblyChef

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `gh` command not found | Install: `brew install gh` |
| "Not authenticated" error | Run `gh auth login` and authenticate with GitHub |
| "Could not resolve to a repository" | Ensure `.git/config` has correct remote; run `git remote -v` to verify |
| Issue not appearing after create | Check `gh issue list` directly; may have default filters applied |

## Labels Reference

See `docs/agents/triage-labels.md` for the full label vocabulary and what each means.

---

*Last updated: 2026-04-29*
