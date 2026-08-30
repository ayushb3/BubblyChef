# Mattpocock Skills — superseded

**This guide is no longer the doc of record. See [`WORKFLOW.md`](../WORKFLOW.md) §9
for the current skill map, and §3 for the planning pipeline.**

It described a 12-skill pipeline (`/grill-with-docs` → `/to-prd` → `/to-issues` →
`/tdd`) that no longer exists. Six of those commands were renamed or deleted
upstream, and the pipeline itself was replaced by the one in `WORKFLOW.md` §3.
Keeping both meant two competing descriptions of how work flows through this repo,
and this was the stale one.

## What the old names map to

| Old command | Now | Notes |
|---|---|---|
| `/to-prd` | `/to-spec` | Renamed upstream |
| `/to-issues` | `/to-tickets` | Renamed upstream |
| `/diagnose` | `/diagnosing-bugs` | Renamed upstream |
| `/write-a-skill` | `/writing-for-agents` | Renamed upstream |
| `/caveman` | — | Removed upstream, no successor |
| `/zoom-out` | — | Removed upstream, no successor |

`/grill-me`, `/grill-with-docs`, `/tdd`, `/triage`, `/improve-codebase-architecture`
and `/setup-matt-pocock-skills` kept their names and are still installed.

## What changed about the pipeline

The old flow front-loaded an interview (`/grill-with-docs`) on every feature. The
current one picks an entry point based on how shaped the work already is —
`/wayfinder` for a loose idea, `/to-spec` when a conversation already shaped it —
and adds an execution step the old guide had no equivalent for
(`/implement-issue`, which drains the `ready-for-agent` queue). See
`WORKFLOW.md` §3.

## Where the skills actually live

`.claude/skills/<name>/`, committed to this repo, pinned in `skills-lock.json`.
They used to be installed only under `~/.claude/skills/`, which is why they were
missing from every fresh clone and every Claude Code web session.
