# Triage Label Vocabulary

These are the canonical label names used by the mattpocock engineering skills (`triage`, `to-issues`, `diagnose`, etc.). When these skills process or create issues, they apply these labels.

## The Five Canonical Roles

| Label | Meaning | Applied When |
|-------|---------|--------------|
| `needs-triage` | Maintainer needs to evaluate | New issue arrives; not yet classified |
| `needs-info` | Waiting on reporter | Issue description is incomplete; needs clarification |
| `ready-for-agent` | Fully specified, agent-ready | Issue has clear acceptance criteria, no blockers |
| `ready-for-human` | Needs human implementation | Issue requires judgment calls outside agent scope |
| `wontfix` | Will not be actioned | Issue is out of scope or explicitly declined |

## Default Mapping

BubblyChef uses the **default label names** — there is no custom mapping. Skills will apply labels exactly as named above:

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

If you want to rename labels (e.g., `needs-triage` → `bug:triage`), edit this file and re-run the setup skill.

## Additional Labels

Beyond the five canonical roles, use GitHub's built-in category labels for organization:

- `type:bug` — Bug report
- `type:feature` — Feature request
- `type:enhancement` — Improvement to existing feature
- `type:docs` — Documentation
- `type:chore` — Maintenance, tooling, cleanup
- `priority:p0` — Critical blocker
- `priority:p1` — High priority
- `priority:p2` — Medium priority
- `priority:p3` — Low priority / backlog

These are informational and don't affect skill workflows. Use them to organize your backlog.

---

*Last updated: 2026-04-29*
