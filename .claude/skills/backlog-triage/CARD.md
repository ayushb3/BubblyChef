# Triage card

One card per issue. The pass agents write cards, the board renders them, and Ayush
signs off on them. A card is a **suggestion**: its job is to make Ayush's call fast
and to show him exactly where it is standing on thin ice. It never makes the call
itself.

## Voice: hesitant

Write every card as a colleague who checked some things and not others, and says
which. The human driving the pass fills the gaps, so a clearly marked gap is worth
more than a confident guess.

- Say "suggest", "looks like", "I think". Keep "is" and "will" for things you
  actually read on main.
- Every claim in `why` either points at evidence in `checked` or is phrased as a guess.
- When the right move depends on what Ayush wants (product intent, scope, taste),
  say so in `questions` and set confidence no higher than medium.
- Name what you did not do in `notChecked`: not reproduced, not run, did not read
  the whole thread, did not check production. An empty `notChecked` claims you
  checked everything. That is almost never true.

## Confidence

Confidence decides whether the board offers bulk approval, so grade it against the
evidence, not against how the card reads.

- **high**: the claim is verified on main (the code path read, or the merged PR
  that fixed it found), the move follows mechanically, and there is no product call
  in it. Only high cards can be bulk-approved.
- **medium**: the code path plausibly matches but was not verified end to end, or
  there is one open question for Ayush.
- **low**: you could not find the code path, the evidence conflicts, or the move
  depends on product intent.

## Moves

`move` is the state the issue should end in:

| move | when |
|---|---|
| `ready-for-agent` | Clear enough for an agent to build with no call from Ayush. A fix touching a protected path (prompts/, supabase/, .github/, .claude/, auth, manifests) is still ready-for-agent: CODEOWNERS makes Ayush review the PR, not do the work. |
| `ready-for-human` | The next step itself needs Ayush: a product decision, a production write, credentials or a key rotation, art, a paid-plan change. Say which in `why`. |
| `needs-info` | Nobody can act until a question is answered. The question goes in `questions`. |
| `wontfix` | Out of scope or declined. Always low or medium confidence: declining is Ayush's call. |
| `close` | Already fixed, a duplicate, or stale. Set `closeReason`, and `duplicateOf` for a duplicate. |
| `hold` | Leave it in `needs-triage` untouched for the next run. Only as a question option ("wait until #546 merges"), never as a card's own move. |

`priority` uses the repo's labels: `high` (user-facing breakage or real value),
`med`, `low` (polish), `defer` (not now). `category` is `bug`, `enhancement` or
`tech-debt`.

## Group

`group` places the card on the board:

- `close`: every `close` move, at any confidence.
- `quick`: high confidence, any other move.
- `judgment`: everything else. These carry the questions.

## Shape

```json
{
  "run": "2026-09-23",
  "issue": 311,
  "title": "bug(chat): high-confidence pantry proposals render a card whose approve button silently no-ops",
  "url": "https://github.com/ayushb3/BubblyChef/issues/311",
  "summary": "Pantry cards the AI is confident about show an Approve button that does nothing, so the items never reach the pantry.",
  "category": "bug",
  "move": "ready-for-agent",
  "priority": "high",
  "closeReason": null,
  "duplicateOf": null,
  "confidence": "high",
  "group": "quick",
  "why": "useChat only tracks pending proposals when requires_review is true, so a requires_review:false proposal has no entry for Approve to act on. Core add flow, so I'd put it high.",
  "checked": [
    "useChat gates pendingProposals on requires_review (read on main at 9789d0d)",
    "No open PR mentions #311"
  ],
  "notChecked": [
    "Not reproduced in a running app",
    "Did not check whether the backend still emits requires_review:false for chat adds"
  ],
  "questions": [
    {
      "text": "Fix it by tracking every pantry proposal as pending, or by auto-applying confident adds?",
      "options": [
        {"label": "Track every proposal with actions, so Approve works"},
        {"label": "Auto-apply confident adds and drop the card", "priority": "med"}
      ],
      "recommended": 0
    }
  ],
  "followUp": null,
  "order": 1,
  "applied": null
}
```

- `summary`: what is wrong or wanted, in plain words, from the user's side. Not the title reworded.
- `checked` and `notChecked`: short, concrete, one fact per item.
- `questions`: only questions whose answer changes the outcome. Write each as a
  choice, `{"text", "options": [...], "recommended": <index or null>}`. Each option
  is `{"label"}` plus any of `move`, `priority`, `closeReason`, `duplicateOf` that
  picking it would set. The board shows the result live ("If approved: …").
  - `recommended` pre-selects an option, so Approve takes it. Set it only when you
    would defend that choice. Leave it `null` for a real product call: Approve then
    stays disabled until Ayush picks, so no default slips through unexamined.
  - An option may name extra work in its label ("split the helper into its own
    issue"). The apply step does it.
  - A plain string is an open question, answered in free text.
- `followUp`: filled only after Ayush asks for more on this card (see the skill's sign-off step).
- `order`: sort order within the group, most important first.
- `applied`: written by the apply step. The pass leaves it `null`.
