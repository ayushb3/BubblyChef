---
name: prune-media
description: Delete PR evidence screenshots under docs/media/ whose issue has closed, on a branch with a PR. Use when the user says "prune media", "clean up screenshots", "docs/media is getting big", or when the media-budget CI job flags prunable directories.
---

# Prune demo media

`docs/media/issue-<n>/` holds the screenshots that made a PR reviewable. Once
issue `<n>` closes, that evidence has done its job — it is not documentation,
and nothing links to it.

Nobody prunes it as part of normal work, because the session that adds the
images has already moved on by the time the issue closes. This skill is the
scheduled sweep that closes that loop.

## What this does and does not buy you

Deleting these files shrinks the **working tree**, not the repository. Every
image ever committed stays in git history permanently, and only a history
rewrite removes it. So this keeps the checkout navigable and stops the
directory becoming an undifferentiated pile — it does not reclaim clone size.

Say this plainly if the user expects the repo to get smaller. The real lever
on repo size is not committing large images in the first place, which is what
the 2 MB per-file cap in `scripts/check-media-budget.sh` enforces.

## Steps

1. **Confirm the working tree is clean.** `git status --porcelain`. If there
   are uncommitted changes, stop and say so — a deletion sweep should not be
   tangled up with unrelated edits.

2. **Never work on `main`.** Branch as `chore/prune-media-<yyyy-mm-dd>`. This
   repo merges through PRs; a direct commit to `main` is a production deploy.

3. **List candidates.** For each `docs/media/issue-<n>/`, resolve issue `<n>`:

   ```bash
   gh issue view <n> --json state,title -q '[.state, .title] | @tsv'
   ```

   A directory is prunable only when the issue is `CLOSED`. If `gh` cannot
   resolve an issue, treat it as **not** prunable and say which ones you
   skipped — an unresolvable issue is missing information, not permission.

4. **Check nothing references the files before deleting.** A closed issue does
   not guarantee the screenshots are unlinked — a doc or an ADR may embed one:

   ```bash
   grep -rn "docs/media/issue-<n>" --include='*.md' . | grep -v '^./docs/media/'
   ```

   If anything references them, leave that directory and report the reference.
   Silently breaking an inline image in a doc is worse than a large directory.

5. **Show the user the list and get confirmation before deleting.** Directory,
   size, issue number, issue title. Deletion is the point of the skill, but it
   is still deletion — the user decides.

6. **Delete with `git rm -r`,** one commit for the sweep. Commit message states
   which issues closed and the space reclaimed in the working tree. Do not
   claim the repo got smaller.

7. **Open a PR.** Body lists each removed directory with its issue number and
   title, so a reviewer can see at a glance that only closed-issue evidence
   went. Note in the body that history retains the images.

## When to refuse

- **An open issue's directory.** Even if the PR merged — the issue may reopen,
  and the evidence is what makes the original PR readable later.
- **`docs/media/` files not under an `issue-<n>/` directory.** Those were put
  somewhere deliberate; they are not this skill's business.
- **A directory referenced from any Markdown file** outside `docs/media/`.

## Scheduling

There is no cron for this. It runs when the `media-budget` CI job flags
prunable directories in a PR check, or when the user asks. That is deliberate:
a scheduled job opening PRs against a repo whose gate requires human review at
merge would just accumulate unreviewed PRs.
