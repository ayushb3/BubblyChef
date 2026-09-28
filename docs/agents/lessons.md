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
- **A cloud session is always `ayushb3`, whatever credential it sends.** The proxy
  strips the client's `Authorization` header to `api.github.com` and injects the
  session's own — sending no header at all still returns `ayushb3`. A bot token is
  discarded in transit, not consulted, so don't build token plumbing for cloud; run
  anything that must be the bot where `GH_CONFIG_DIR` is honoured.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md), [PR #486](https://github.com/ayushb3/BubblyChef/pull/486).
- **`GH_TOKEN`/`GITHUB_TOKEN` outrank `GH_CONFIG_DIR`.** An ambient token silently
  wins while the command still looks like a bot command, so the PR opens under the
  wrong author and skips code-owner review. Clear both before any `gh` call that has
  to be the bot.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md), [PR #486](https://github.com/ayushb3/BubblyChef/pull/486).
- **Not every `gh` is a `gh`.** Ubuntu apt ships 2.45.0, which has no `gh variable
  get`, and the Actions REST API is no substitute in cloud — the proxy 403s every
  `/actions/*` path. Check `gh --version` before relying on a subcommand.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md), [PR #486](https://github.com/ayushb3/BubblyChef/pull/486).

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
- **The issue is often wrong about the cause.** Reproduce the reported behaviour and
  confirm the mechanism before changing anything — in one overnight batch seven issues
  named the wrong cause, and the briefs that said "the issue may be wrong, verify
  first" produced the usable work. If the stated fix turns out to be destructive, stop
  and report rather than carrying it out.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **Long implementer runs die silently, and uncommitted work dies with them** — three
  of fifteen agents lost 60+ minutes that way. Tell implementers to commit early and
  often. Treat a long gap with no completion notification as death, not busyness:
  check `git log` on the agent's branch instead of waiting.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).

## Frontend

- **`NEXT_PUBLIC_*` variables are inlined at build time**, in server code as well
  as client code. Setting one for `next start` does nothing; set it for
  `next build`.
- **ai-service allows CORS only from `http://localhost:3000` by default.** A
  frontend on any other port loads fine and then has every AI call blocked by the
  browser. `scripts/dev/stack.sh` passes the right origin; do the same by hand.
- **Dev mode hides hydration bugs.** Specs that passed on `next dev` failed on a
  production build (issue #345). Verify against a production build.
- **Never run `npx prettier`.** There is no prettier config in this repo, so it
  defaults to double quotes and rewrites a single-quote file wholesale — it once
  turned a 10-line change into 144 insertions / 108 deletions. Match the surrounding
  style by hand.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md), [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **`components/pantry/AddItemModal.tsx` is the pantry edit/delete surface, not an add
  surface** — it is imported everywhere as `EditItemModal` and is the only caller of
  `PUT`/`DELETE` on `/api/pantry/[id]`. A component's name is not its mount: grep for
  the trigger and the props it's mounted with before assuming what it does, and
  especially before deleting it.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md), [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).

## Tests and gates

- **A shrinking test count isn't the only way tests disappear.** Deleting old tests
  while adding the same number of new ones keeps the count level.
  `scripts/agent-gates/test-count-guard.sh` checks for removed tests directly.
- **The five catalog-emoji tests fail on Windows only** (`test_issue_300_catalog_emoji.py`):
  a UTF-8 file read without an explicit encoding. They pass in CI. Don't chase
  them as a regression from your change. Remove this entry once PR #452 (*pass
  encoding="utf-8" on every text-mode file read and write*) merges.
- **Run `scripts/agent-gates/agent-loop-harness.cjs` before pushing any
  `agent-loop.js` edit.** Its mock returns `'none'` for unknown labels, so a new stage
  fails its own gate and collapses every downstream assertion. This has turned CI red
  more than once.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md), [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md), [PR #486](https://github.com/ayushb3/BubblyChef/pull/486).
- **The removal check greps removed `it(` / `def test_` lines, not test semantics.**
  Changing `it('name', () =>` to `async () =>` reads as a deleted test; conversely,
  keeping a test's name while gutting its body passes the guard and leaves a passing
  test that lies. When a test genuinely has to go, take `test-removal-approved` with
  the reason in the PR body.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md).
- **`test-removal-approved` applied after the PR is open does nothing.**
  `agent-gates.yml` reads labels from the frozen `pull_request` event payload and
  triggers on `opened`/`synchronize`/`reopened`, not `labeled` — a re-run replays the
  same payload. Label before opening, or push a new commit to refresh it.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **`no-f2p` is not an escape hatch for "hard to test".** `exemption-check.sh` fails
  the PR if the diff touches anything outside docs and markdown. If the change is
  code, write the failing-first test.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **`mypy_gate.sh` reports `fixed: 0` when you remove a `type: ignore`** — a
  suppression was never a baselined error, so removing it can't reduce the count.
  Don't read that as "no effect", and don't `--sync` the baseline to make the number
  move.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **The frontend gate set is three commands, not the single typecheck in CLAUDE.md's
  quick start.** CI runs `npx tsc --noEmit`, `npx eslint src/ --max-warnings=-1` and
  `npm test`; tsc and jest both pass code eslint rejects. On ai-service use the venv
  binaries: `.venv/bin/pytest`, `.venv/bin/ruff`, `./scripts/mypy_gate.sh`.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).

## Backend

- **A per-attempt timeout is not a budget when the caller retries.** Bound the whole
  leg with one `asyncio.wait_for` around the `AIManager` call instead of timing each
  attempt, and put the arithmetic in the `Settings` field comment so the total is
  visible to the next reader.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md).
- **`/v1/chat/stream` does not run the chat nodes for `general_chat` and
  `cooking_help`.** `run_chat_workflow_streaming` in `workflows/router.py` rebuilds
  the prompt and pantry context inline, mirroring `workflows/chat/nodes.py`. A change
  made only in `nodes.py` passes the tests and never reaches the UI — check which path
  the intent takes and change both.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md).
- **Leg-2 errors in the receipt workflow never reach the client.** `parse_receipt_llm`
  writes to `state["errors"]`, but `api/routes/scan.py` forwards only `warnings`. If a
  failure has to be visible in the scan UI, put it in `warnings`.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md).

## Environment

- **A fresh worktree or container has no `node_modules` and no venv**, and this killed
  three agents outright. The main checkout's `nextjs/node_modules` is
  lockfile-identical and gitignored, so a symlink is enough. Build `ai-service/.venv`
  from `pip install -e ".[dev]"`, never from `requirements.lock` — its numpy pin
  conflicts with `pyproject.toml`'s `numpy<2`.
  Source: [2026-09-20 session report §9](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-20-autonomous-session-report.md), [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **`scripts/dev/stack.sh` calls a bare `python -m uvicorn`**, which resolves to
  system python with no dependencies, so the AI service silently fails to start. Put
  `ai-service/.venv/bin` on `PATH` before running it.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **Don't run `playwright install` in a container.** The pre-baked Chromium's revision
  won't match the one this Playwright expects, and re-downloading is blocked or
  wasteful. Point `PLAYWRIGHT_CHROMIUM_PATH` at the existing binary —
  `nextjs/e2e/browser.ts` feeds it to both the runner and the auth bootstrap.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
- **`.env` files are gitignored, so a fresh container has none** — but every
  credential is already present as an environment variable. Write `nextjs/.env.local`
  and `ai-service/.env` from the environment before starting either service.
  Source: [2026-09-21 handoff §7, §5](https://github.com/ayushb3/BubblyChef/blob/main/docs/plans/2026-09-21-handoff-post-autonomous-batch.md).
