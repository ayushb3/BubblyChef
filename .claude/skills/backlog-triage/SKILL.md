---
name: backlog-triage
description: Batch-triage the needs-triage backlog for Ayush's sign-off. A read-only pass checks each issue against main, a triage board artifact shows one hedged card per issue with a suggested move, and only the moves Ayush signs off are applied on GitHub. Use when needs-triage has piled up, when asked to "triage the backlog" or "go through needs-triage", or after a loop batch files new issues.
---

# Backlog triage

`needs-triage` means "not signed off yet", not "not ready". Issues pile up there
because signing off one at a time is slow, and the agent loop files issues faster
than that. This skill runs the evaluation in one batch, puts the result in front of
Ayush as a **board** he can clear in minutes, and applies only what he signs off.

The board's cards are **suggestions**. Ayush is the one deciding. Write for someone
who will fill in your gaps: show what you checked, name what you did not, and ask
where the answer depends on him. The card schema, voice and confidence rubric are
in [CARD.md](CARD.md). Read it before step 2.

For a single issue, use `/triage` instead. This skill uses its state labels and its
agent-brief format ([../triage/AGENT-BRIEF.md](../triage/AGENT-BRIEF.md)), and
adds the batch pass and the board.

## 1. Collect

```bash
gh issue list --state open --label needs-triage --limit 200 --json number,title,labels,updatedAt
gh issue list --state open --limit 300 --json number,title,labels \
  --jq '[.[] | select([.labels[].name] | any(. == "needs-triage" or . == "needs-info" or . == "ready-for-agent" or . == "ready-for-human" or . == "wontfix") | not)]'
```

The first list is the queue. Add any issue from the second list (no state label at
all) unless it is a parent spec or wayfinder map; list those as skipped. Exclude
issues already owned by a running loop or session: if the Bubbly Agent Loop
orchestrator session exists, its live status doc names what is in flight.

Record `git rev-parse --short origin/main` after `git fetch`. Every card is
checked against that commit.

Done when you have the issue list, the skipped list with reasons, and the commit.

## 2. Pass

Split the queue into batches of about 8 issues and dispatch one read-only
`Explore` subagent per batch, all in parallel. Each agent gets the commit, its
issue numbers, CARD.md's full text, and this job:

> For each issue: read the body and every comment. Decide whether it is still real
> on main at `<commit>`. Search for the code path by domain concept, not just the
> issue's words. Run `git log origin/main --oneline --grep "#<n>"` and
> `gh pr list --state all --search "<n>"` to find a fix or an open PR. Look for a
> duplicate among the other open issues. Do not run the app or change anything.
> Return one card per issue, as JSON in the CARD.md shape, with `run`, `order`
> and `applied` left null.

Then do the pass's cross-batch work yourself, since each agent saw only its batch:

- Collapse duplicates that span batches: keep the older or better-specified issue,
  and turn the other card into a `close` with `duplicateOf`.
- Check each card against the CARD.md rubric: `high` confidence needs evidence in
  `checked` that was read on main, and a `notChecked` list that is not empty.
  Downgrade any card that doesn't meet it.
- Set `group`, then `order` within each group, most urgent first.

Done when every queued issue has exactly one card that passes the rubric.

## 3. Board

The board is [board.html](board.html), published once and reused. Look for it
first:

- `Artifact` `action: "list"`, find the title **BubblyChef Triage Board**. If it
  exists, read it (`action: "read"`) and republish `board.html` to its `url`, but
  only if the file changed.
- If not, publish `board.html` with `icon: "checklist"` and these capabilities:

  ```json
  {"db": {"rules": [
    {"path": "", "read": "interact", "write": "admin"},
    {"path": "decisions", "read": "interact", "write": "interact"}
  ]}}
  ```

  Cards and run metadata are Claude's to write. Decisions are Ayush's.

Seed the run with one `ArtifactData` `batch`. The run id is today's date, with a
suffix if the date is already used:

- `set` `runs/current` to `{runId, commit, startedAt, count}`.
- `set` `cards/<runId>-<issue>` for every card, with `run` set to the run id.

Check it with `ArtifactData` `list` on `cards`. The run's card count must equal the
queue. Give Ayush the link.

Done when the board shows every card for this run and Ayush has the link.

## 4. Sign-off

Now Ayush decides. If another agent invoked this skill (the orchestrator, say),
stop here: report the board link and the counts per group, and pick up at the
apply step when told the sign-off is done.

When Ayush is driving, help him through it. Start with **Needs your judgment**,
where the questions are. Answer what he asks in chat. Anything he decides in chat
also goes onto the board (`set` the decision doc) so the board stays the record.

Each decision lives at `decisions/<runId>-<issue>`:
`{verdict: approve | change | ask | skip, move, priority, note}`. A `change`
carries his `move` and `priority`. His words win over the card.

For every `ask`: dig into what his note asks, then `update` that card's
`followUp` with what you found and re-grade its confidence. Leave his decision
doc alone. He decides again on the board.

Done when every card has a verdict other than `ask`, or Ayush says to apply what
is decided so far.

## 5. Apply

Read every decision with `ArtifactData` `list` on `decisions` for this run. For
each `approve` or `change`, compute the final move and priority (his values over
the card's). Read his note first: when it asks for something other than the verdict
(an "approve" whose note says "fold this into #502"), hold that issue and ask him
which one he meant. Then on GitHub:

| move | action |
|---|---|
| `ready-for-agent` | Swap `needs-triage` for `ready-for-agent`, set the priority and category labels, and post an agent brief per AGENT-BRIEF.md. |
| `ready-for-human` | Swap in `ready-for-human`, set labels, and comment what the human step is. |
| `needs-info` | Swap in `needs-info` and comment the questions. |
| `wontfix` | Swap in `wontfix`, comment the reason, and close as not planned. |
| `close` | Comment the evidence (and `Duplicate of #<n>` for a duplicate), then `gh issue close` with `--reason completed` for fixed and `--reason "not planned"` otherwise. |

Every comment starts with `> *This was generated by AI during triage.*`, and
includes his note if he left one. Priority labels are `priority:high`,
`priority:med`, `priority:low` and `priority:defer`. Remove any other priority
label already on the issue.

After each issue, `update` its card with `applied: {move, priority, at}`, so a
rerun of this step skips it. `skip` and undecided cards are not touched: they stay
`needs-triage` for the next run.

Done when every approved or changed card has `applied` set, and `gh issue view`
shows the labels you meant to set.

## 6. Report

Close out per CLAUDE.md: a TL;DR (what moved where, what closed) and action
items. The action items are the skipped and undecided issues, plus every
`ready-for-human` issue, since those now wait on Ayush.
