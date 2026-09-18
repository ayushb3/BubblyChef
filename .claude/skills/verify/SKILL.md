---
name: verify
description: Prove a BubblyChef change works by running the real app and walking the flow it affects, with screenshots as evidence. Use after implementing any change a user could see or trigger, before opening its PR, when asked to "verify", "prove it works", "click through it", or "get screenshots". Not a substitute for tests; it is the evidence tests can't give.
---

# Verify

Tests prove the code does what the tests say. This proves the app does what the
issue asked, in a running production build, with pictures. It is the evidence
`WORKFLOW.md` §6 relies on to let a PR merge without a human reading the diff, so
a verify that was skipped or faked is worse than none: it makes an unchecked
change look checked.

The failure this exists to catch: a chat action that posted to a route that did not
exist, reported success, and lost every item the user added. Typechecked, tested,
read plausibly. Anyone who clicked it once would have seen it.

## 1. Bring up the stack

```bash
eval "$(scripts/dev/stack.sh ports)"   # PORT, AI_PORT, PLAYWRIGHT_BASE_URL, AI_SERVICE_URL
scripts/dev/stack.sh up                # production build, this worktree's own ports
```

`up` builds the frontend with the AI service URL baked in, starts both services,
and waits for `/api/health` and `/health`. Both report the commit they are running
as `sha`: **check it matches `git rev-parse HEAD`**. If it doesn't, you are
verifying a stale build.

Env files are gitignored, so a fresh worktree lacks them. Copy
`nextjs/.env.local` and `ai-service/.env` from the main checkout. Never commit them
and never print them.

If `up` fails, read `.verify/<service>.log`. Do not work around a stack that won't
start; that is itself a finding.

## 2. Walk the flow

Write a throwaway Playwright script in `.verify/` (gitignored) that does what a
user would do. Sign in the way `nextjs/e2e/global-setup.ts` does, as the test user
(`TEST_USERNAME` / `TEST_PASSWORD`). Then:

- **Do the thing the issue describes**, start to finish, the way a user would:
  navigate, click, type, submit. Not an API call standing in for the UI.
- **Check the outcome, not just the absence of an error.** An item added shows up
  in the pantry list; a count that should change, changed. Read the result back.
- **Walk the neighbours.** A change breaks what shares its code, not what it
  touches. If you changed the scan review footer, also add an item manually and
  check the pantry list. Name which neighbours you walked.
- Save a screenshot at each meaningful state:
  `await page.screenshot({ path: 'docs/media/issue-<n>/<step>.png' })`.

**For a bug, capture it broken first.** Before implementing, run the flow on the
unfixed code and screenshot the bug. After the fix, the same script, the same
screenshot names with an `-after` suffix. A before/after pair is the strongest
evidence there is; an "after" alone only shows the screen looks fine now.

Keep screenshots small: one viewport, not full-page captures of long lists.
`scripts/check-media-budget.sh` fails CI on oversized files.

## 3. Run the smoke suite

```bash
cd nextjs && npx playwright test e2e/smoke
```

With `PLAYWRIGHT_BASE_URL` exported from step 1, Playwright uses the running stack
instead of starting its own. A red smoke test means the change broke something
core. Fix it; do not skip it.

## 4. Tear down

```bash
scripts/dev/stack.sh down
```

Always, including after a failure. It stops whatever is listening on this
worktree's ports, so a crashed run is cleaned up too.

## 5. Put the evidence in the PR body

A **Verified** section, written for someone who will not open the diff:

- The commit verified (`sha` from `/api/health`).
- What you did, as user steps: "Opened the add sheet, scanned the fixture receipt,
  unchecked Bananas, footer went from *Add 8 Items* to *Add 7 Items*."
- The screenshots, embedded from `docs/media/issue-<n>/`, before and after.
- The neighbouring flows you walked, and that they still work.
- Smoke suite result.
- **What you could not verify, and why.** An unstated gap reads as a claim it was
  handled.

## Rules

- **Never fake it.** No screenshots of a mocked page presented as the real flow,
  no "verified" for a flow you didn't run. If you couldn't verify something, say
  so. That is a legitimate result; a pretended one is not.
- **Test data cleans up after itself.** Local env points at the hosted Supabase
  project, not a sandbox. Anything you create, name it recognisably
  (`verify-<issue>-<timestamp>`) and delete it before tearing down.
- **UI changes need screenshots. Backend-only changes need the observable
  effect:** the response the UI receives, or the state it leaves behind, read back
  through the app.
- If a verify reveals a bug you weren't asked to fix, note it in the PR under "Not
  covered" and file an issue. Don't widen the PR.

## When it's not applicable

Pure docs, pure refactors covered by existing tests, and CI/config changes can
skip steps 1–4. Say so in the PR body with the reason: "No runtime behaviour
changed: docs only."
