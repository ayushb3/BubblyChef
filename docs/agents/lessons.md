# Lessons

Mistakes agents made in this repo that the loop caught, written down so the next
run doesn't repeat them. Read by the agent loop's implement and verify steps; not
loaded into interactive sessions (that is what `CLAUDE.md` is for).

**How entries get here.** The loop *proposes* a lesson in a PR body when it hits a
mistake worth remembering. A nightly job reviews the proposals, adds the good ones
here and removes duplicates. Agents do not append to this file directly: one bad
lesson written unsupervised would steer every later run
(`docs/plans/2026-09-17-autonomous-agent-loop.md`, "Lessons").

**Format.** One lesson per bullet, under a heading for the area. Say what goes
wrong and what to do instead, in that order. Keep it to things that are true of
*this* repo and not obvious from reading the code. Delete a lesson when the code
changes so it no longer applies.

---

## Git and GitHub

- **Stacked PRs strand if the parent merges first.** A PR based on another PR's
  branch merges into that branch, not `main`, and nothing then reads from it. This
  stranded the whole merge-gate change once. Base PRs on `main`; if stacking is
  unavoidable, retarget the child to `main` before merging it.
- **In Git Bash, `git show origin/main:path` gets its path mangled** into a Windows
  path and fails with "ambiguous argument". Prefix the command with
  `MSYS_NO_PATHCONV=1`.
- **A check-existence script that swallows errors lies.** `git cat-file -e` failing
  for the path-mangling reason above looks exactly like "file is missing". When a
  result is surprising, check it a second way before acting on it.
- **The Claude GitHub Action skips a workflow file that differs from `main`'s**,
  and exits successfully. A PR that adds or changes a Claude workflow can't test
  that workflow on itself; test it after merge.

## Agents

- **Subagent `isolation: worktree` branches from the default branch**, not the
  parent session's HEAD. A dev role delegated with it won't see the feature branch
  it's meant to build on. Isolate per session instead.
- **Agents can only write inside their session's own worktree.** A workflow's agents
  inherit the launching session's write scope, so they can *read* another worktree but
  not write to it. The first agent-loop pilot created a separate worktree per issue and
  blocked on this. Work on a branch in the session's own checkout instead. If a guard
  refuses a write, don't route around it with shell commands; report it.
- **Agent PRs must be opened as `bubblychef-bot`**, never as `ayushb3`. GitHub
  skips code-owner review when the author is the only code owner, so a PR opened
  under Ayush's account bypasses the protected-path gate entirely.

## Frontend

- **`NEXT_PUBLIC_*` variables are inlined at build time**, in server code as well
  as client code. Setting one for `next start` does nothing; set it for
  `next build`.
- **ai-service allows CORS only from `http://localhost:3000` by default.** A
  frontend on any other port loads fine and then has every AI call blocked by the
  browser. `scripts/dev/stack.sh` passes the right origin; do the same by hand.
- **Dev mode hides hydration bugs.** Specs that passed on `next dev` failed on a
  production build (issue #345). Verify against a production build.

## Tests and gates

- **A shrinking test count isn't the only way tests disappear.** Deleting old tests
  while adding the same number of new ones keeps the count level.
  `scripts/agent-gates/test-count-guard.sh` checks for removed tests directly.
- **The five catalog-emoji tests fail on Windows only** (`test_issue_300_catalog_emoji.py`):
  a UTF-8 file read without an explicit encoding. They pass in CI. Don't chase
  them as a regression from your change. Remove this entry once PR #452 (*pass
  encoding="utf-8" on every text-mode file read and write*) merges.
