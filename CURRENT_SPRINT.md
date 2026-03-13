# BubblyChef — Current Sprint

> **PM instructions:** Edit this file to define tasks. The Dev agent reads it and executes one task at a time.
> **Dev agent prompt:** `Read CURRENT_SPRINT.md. Execute the next PENDING task only. Stop and wait for review when done.`
> **QA agent prompt:** `Read CURRENT_SPRINT.md. Verify the most recent [x] task meets all acceptance criteria.`

---

## Sprint Goal

_Write one sentence here describing what "done" looks like for this sprint._

**Example:** Ship Phase 2 — a dashboard home page + chat interface so users can ask natural language questions about their pantry.

---

## 📋 Task Queue

> **Status key:** `[ ]` PENDING → `[~]` IN PROGRESS → `[x]` DONE — `[!]` BLOCKED
> The Dev agent works strictly top-to-bottom. Only one `[~]` at a time.

### Current Tasks

- [ ] **TASK 1 — Title here**
  - **What:** Short description of what needs to be built/changed.
  - **Files:** List the expected files to touch (helps agent stay focused).
  - **Done when:** Concrete, testable acceptance criteria.
  - **Hints:** Any gotchas, patterns to follow, or constraints.

- [ ] **TASK 2 — Title here**
  - **What:** ...
  - **Files:** ...
  - **Done when:** ...
  - **Hints:** ...

---

## 🧪 QA Checklist Template

> Copy this for each task when QA runs. QA agent fills it out.

**Task:** [Task name]
**QA Run Date:** [Date]

- [ ] All tests pass (`pytest --cov=bubbly_chef -v`)
- [ ] Acceptance criteria met (from "Done when" section)
- [ ] Manual testing passes (if UI component)
- [ ] Edge cases handled (null, empty, errors)
- [ ] No console errors or warnings
- [ ] Code follows project patterns (CLAUDE.md)

**Status:** ✅ APPROVED / ❌ BLOCKED
**Notes:** [Any issues found or things to watch]

---

## ✅ Completed This Sprint

> Move tasks here (change `[x]`) after you review and commit the diff.

---

## 🚫 Out of Scope

List anything the Dev agent should NOT touch this sprint, even if it seems related:

- (Example) Do not modify the receipt scanning flow
- (Example) Do not upgrade any npm dependencies

---

## 🐛 Known Bugs / Blocked Tasks

> QA agent adds bugs here as `[!] BLOCKED` tasks. Dev fixes these before moving to next feature.

---

## 🗒️ PM Notes for Dev

Context the Dev agent needs that isn't obvious from the code:

- **Arch pattern:** Services layer handles business logic; routes are thin.
- **AI:** Use `AIManager` from `bubbly_chef/ai/manager.py` — never call Gemini SDK directly.
- **Frontend:** React Query for server state; avoid `useState` for fetched data.
- **Style:** Sanrio/kawaii pastel aesthetic — see `CLAUDE.md` Design System section.
- **Tests:** Write tests alongside the code, not after. Run `pytest` before marking done.

---

## ⚙️ Project Quick Reference

| Thing             | Command                                                |
| ----------------- | ------------------------------------------------------ |
| Start backend     | `uvicorn bubbly_chef.api.app:app --reload --port 8888` |
| Start frontend    | `cd web && npm run dev`                                |
| Run tests         | `pytest`                                               |
| Run specific test | `pytest tests/path/test_file.py -v`                    |
| Lint              | `ruff check bubbly_chef/`                              |
| API docs          | `http://localhost:8888/docs`                           |
| Launch dev agent  | `./scripts/dev-agent.sh`                               |
| Launch QA agent   | `./scripts/qa-agent.sh`                                |

---

_Last updated by PM:_ <!-- Update this when you edit the file -->
