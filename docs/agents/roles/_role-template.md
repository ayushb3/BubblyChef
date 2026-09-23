# How to write a role file

Copy this structure into `docs/agents/roles/<role-name>.md` for each dev role a
project needs. One file per role, committed (never gitignored — a workflow that
disappears on a fresh clone doesn't survive switching machines).

A role file is the persona's full mandate: what it owns, what it may read, and any
conventions specific to its domain. The PM delegates by pointing a subagent at this
file plus a task-specific context packet — the role file should be stable across
tasks, the context packet is what changes per delegation.

## The agent file vs this file

A role file is the mandate. The matching `.claude/agents/<role>.md` is what Claude
Code actually loads, and its frontmatter carries the execution tier:

| Key | Use |
|---|---|
| `model` | `opus` for judgement (pm, reviewers), `sonnet` for dev roles, `haiku` for read-only utility agents |
| `effort` | `low`–`max`; set it only to pin a cheap tier (e.g. `explorer`), otherwise it inherits the session |
| `tools` | Least privilege — a read-only agent gets `Read, Grep, Glob` and no `Bash` |

Do **not** put `isolation: worktree` on a dev role: it branches from the default
branch rather than the parent session's HEAD, so the role would not see the feature
branch it is meant to build on. Isolate per session instead (`WORKFLOW.md` §5).

## Template

```markdown
---
role: <role-name>
---

# <Role Name>

<One-sentence description of what this role is responsible for.>

## Owns (writes)

- `<path>` — <what lives here>
- `<path>` — <what lives here>

## Reads (does not edit)

- `<path>` — <why this role needs to read it>

## Stack / domain context

<The tech this role works in, and any non-obvious constraints — e.g. "all DB access
goes through the repository layer" or "never call the SDK directly, always through
the provider abstraction.">

## Conventions

<Lint/type/test commands this role must run before reporting done. Naming
conventions, patterns to follow, patterns to avoid.>

## Verification

<How this role proves its own work before handing back to the PM — see
WORKFLOW.md §8, prove-it-works. Not "tests pass" alone if there's a runtime path to
exercise.>
```

## Guidance

- **No overlapping ownership.** If two roles need to write the same file, that's a
  contract the PM should resolve (split the file, add an interface boundary,
  reassign ownership) — not something to leave ambiguous.
- **Keep it current.** When a role's boundary changes (a directory gets split, a new
  service is added), update the role file in the same PR that causes the drift.
- **Match roles to actual seams in the codebase**, not to job titles. A `frontend`
  role for a Next.js app and a `frontend` role for a Vite SPA look different even
  if the label is the same — write what's actually true of this project.
