# Expiry emphasis audit

**Date:** 2026-09-04
**Status:** Audit only — no code changes. Direction TBD.
**Prompted by:** concern that the app over-focuses on expiring items — expiry should be *a* signal, surfaced when relevant, not the default lead on every surface.

---

## Thesis

Expiry is not just *present* in the product — it is **structurally privileged**. It
leads the dashboard hero, it is the heaviest-weighted axis in recipe ranking (above
cuisine and dietary fit), and it owns a dedicated dashboard tile. Several open issues
would add a fourth and fifth expiry surface. The result is a product that feels like
it is *about* expiry, when expiry should be one input to "what should I cook?"

This is a coherence concern, not a bug. Nothing is broken. But the cumulative weight
of expiry across surfaces pushes the app toward "use-it-or-lose-it manager" and away
from "kitchen assistant that happens to track freshness."

---

## Where expiry is privileged today

### 1. Recipe ranking — expiry outweighs fit (the root cause)

`ai-service/bubbly_chef/workflows/recipe/nodes.py:367` `score_and_rank()`:

| Signal | Score |
|---|---|
| "use up my X" (explicit user ask) | +20 |
| **expiring ≤ 3 days** | **+10** |
| **expiring ≤ 7 days** | **+5** |
| in preferred_ingredients | +5 |
| cuisine keyword match | +3 |
| excluded ingredient | −100 |

The consequence, in one comparison: an expiring item with **no** cuisine or preference
match (score 10) **outranks** a perfect cuisine + preferred match that isn't expiring
(3 + 5 = 8). Expiry beats fit roughly **10-to-3**. Only the explicit "use up my X"
request outranks expiry.

This deterministic ranking produces the top-15 pantry items handed to the LLM as
context. So even though the *prompt* was softened (see below), the model's **input**
is already expiry-sorted before it reasons about fit.

### 2. Prompt layer — softened, but disagrees with the ranking

Lines 133–139 and 151–180 of the same file. Post-#288, the prompt tells the model
expiring items are "a strong preference, not a hard requirement," to "leave an expiring
item out when it doesn't belong," and not to "force an expiring ingredient into a dish
just because it's expiring."

**The two layers disagree.** The prompt says "don't force it"; the pre-ranking has
already forced it, by handing the model an expiry-first list. Softening the words
without re-weighting the scores leaves the bias in the substrate.

### 3. Dashboard hero — expiring item wins the headline

`nextjs/src/components/dashboard/HeroHome.tsx:187` `heroMessage`:

```
urgentItem ? "Your {X} expires today/tomorrow! Let's cook it up."
  : totalCount === 0 ? "empty pantry"
  : suggestion ? <AI suggestion copy>
  : ...
```

The urgent-expiring branch is checked **first** — before the AI-generated, pantry-ranked
suggestion (#168). Whenever any item expires within 1 day, the expiry message is the
hero; the ranked suggestion never gets the headline. The suggestion the whole #225/#168
work produced is demoted the moment anything is close to expiring.

### 4. Dedicated "Use Soon" dashboard tile

`HeroHome.tsx:271` — a permanent top-row action card counting expiring items. Always
present, always counting. Fine on its own; part of the cumulative weight in aggregate.

---

## Open issues that add *more* expiry emphasis

Each is individually reasonable. The concern is the sum.

- **#43 — notification center for expiry alerts + pantry nudges.** Would add a *fourth*
  always-on expiry surface, and the first *proactive/push* one — the strongest emphasis
  escalation of any open issue. Worth re-scoping so it isn't expiry-first.
- **#264 — warn and prompt to clear expired items before cooking.** Adds an expiry gate
  *in front of* cook mode. More expiry-keyed friction on a core flow.
- **#183 — backfill expiry estimates for rows with no date.** Widens the set of items
  that enter expiring surfaces. Increases reach of every surface above.
- **#42 — auto grocery list from depleted + low items.** Consumes expiry/depletion;
  another downstream expiry consumer.

## Open issues that *counterweight* expiry emphasis (worth prioritising)

- **#182 — flag estimated expiry dates as estimates.** Right now an *estimated* date
  looks as authoritative as a receipt date. Since estimated dates drive the urgency
  surfaces above, a guessed "expires tomorrow" gets full hero billing. Distinguishing
  estimates would **reduce false urgency** — directly on-thesis.
- **#288 (closed) — expiring items forced into every suggestion.** The prompt-layer fix.
  Landed the softened wording; did **not** re-weight `score_and_rank`. This audit is
  partly "the other half of #288."

---

## Candidate directions (not decided)

1. **Re-weight `score_and_rank`** so expiry is comparable to, not dominant over, fit —
   e.g. expiry ≤3d closer to +4/+5 so a strong cuisine+preference match can win. The
   surgical root-cause change; makes the prompt and the ranking agree.
2. **Reorder the dashboard hero** so the AI suggestion can lead, with expiry as secondary
   copy ("…and it uses your spinach that expires tomorrow") rather than the headline.
3. **Re-triage #43 / #264** against this thesis before building — decide whether they
   should be expiry-first at all.
4. **Prioritise #182** as the cheapest de-emphasis (stop guessed dates from driving
   urgency).

## What this audit deliberately does NOT do

- No code changes. Weights, hero order, and prompts are unchanged.
- No decision on which direction to take — that's the follow-up conversation.
- Does not touch the closed #288 or reopen it.
