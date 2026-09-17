---
name: start-work
description: 'Start a coding work session in the user''s usual tiered-orchestrator flow: main session drives as orchestrator, delegating exploration to haiku, implementation to sonnet, and review to opus/low. Triggers: "start work", "start a session", "let''s work on", "spin up work", "/start-work".'
argument-hint: "[ticket / task / repo path?]"
disable-model-invocation: true
---

# /start-work — tiered orchestrator session

Spin up a coding session the way the user normally works: **you (the main session) act as the orchestrator**, and you delegate down a cost-tiered team. Cheap navigation is haiku, implementation is sonnet, judgment (orchestration + review) is opus. This mirrors the routing table in `~/.claude/CLAUDE.md` and the global agent team in `~/.claude/agents/` (`orchestrator`, `implementer`, `explorer`, `code-reviewer`).

Keep the user in the loop — this is an interactive session flow, not a fire-and-forget workflow. The user is the human above the orchestrator; you never merge/deploy without them.

**Caveman mode:** already defaults to full on session start on this machine — do not toggle it, just work in it.

## The flow

1. **Orient (cheap).** Read the repo's `CLAUDE.md` / `AGENTS.md` / `WORKFLOW.md` if present to learn its tracker, stack, and conventions. For anything beyond those small docs — locating code, "how does X work", mapping a subsystem — delegate to `explorer` (haiku/low). Do **not** page through large source files or logs in the main thread; your context is the scarcest resource.

2. **Decompose.** Turn the ask into a small plan or a few agent-sized slices — each vertical and demoable on its own, each closeable in one implementer session. If a slice wants to fan out further, it wasn't small enough; split it. For a heavy decomposition you may spawn the `orchestrator` agent (opus/medium) instead of doing it in-thread.

3. **Delegate by tier:**
   - explore / locate / summarize → `explorer` (haiku/low)
   - implement on a solid slice → `implementer` (sonnet/medium), handed clear acceptance criteria and the file paths it owns
   - review the resulting diff → `code-reviewer` (opus/low)

4. **One-level cap.** Human → orchestrator → {explorer, implementer, code-reviewer}. Leaf agents never spawn subagents. Consume **summaries**, not transcripts — route bulk output to the leaves, keep the main thread to decisions.

5. **Autonomy gate.** Proceed autonomously on reversible work (explore, implement, review, open a draft PR). Stop for the human only at irreversible steps: merge/deploy, force-push, deleting data, sending external messages.

## Notes

- `opus/high` is not a standing tier — bump one agent to `high` for a single genuinely-hard task, then drop back.
- If the target repo has its own agent team (e.g. BubblyChef's `pm`/`backend`/… under its `.claude/agents/`), prefer that repo-local team — it wins over the global one in that repo. Use the global team for repos that don't ship their own.
- **Scope:** this skill drives work inside the target repo's normal flow. It writes nothing to the WorkNotes vault and creates no files outside the repo you're working in.
