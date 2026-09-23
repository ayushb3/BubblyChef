/**
 * Bubbles-balance milestones for the kitchen decoration unlock (issue #522).
 *
 * The `decorations` table (see the header comment added to
 * `supabase/migrations/00011_gamification_bubbles_ledger.sql`) mirrors:
 *   - `name`            -> catalog id (`lib/kitchen/catalog.ts`'s `Decoration.id`)
 *   - `decoration_type` -> slot key (`lib/kitchen/slots.ts`'s `Slot.key`)
 *   - `milestone`       -> the `key` below; at most one claimed row per user
 *                          per milestone (enforced by a partial unique index)
 *   - `unlocked_at`     -> when the user claimed it
 *
 * `DECORATION_MILESTONES` values are provisional starting points (v1
 * friend-ready PRD, `docs/plans/2026-09-23-v1-friend-ready-prd.md`, open
 * question 1: "tune once it's playable") — not a final balance curve. Keeping
 * every threshold in this one exported array means retuning later is a data
 * change here, not a change to the callers that walk it.
 *
 * The gaps between thresholds (25/60/120/200/300) are deliberately wider than
 * the worst-case overshoot a single ledger event can cause (#550's ledger:
 * at most one extra `daily_visit` (+1) or one extra `cook_confirm` (+10) in a
 * short window) — a balance can jump past at most a couple of thresholds in
 * one award, never skip past a whole milestone unnoticed by more than that.
 */

export interface DecorationMilestone {
  key: string
  threshold: number
}

export const DECORATION_MILESTONES: DecorationMilestone[] = [
  { key: 'm25', threshold: 25 },
  { key: 'm60', threshold: 60 },
  { key: 'm120', threshold: 120 },
  { key: 'm200', threshold: 200 },
  { key: 'm300', threshold: 300 },
]

/** Every milestone whose threshold the balance has reached, ascending by threshold. */
export function reachedMilestones(balance: number): DecorationMilestone[] {
  return DECORATION_MILESTONES.filter((m) => m.threshold <= balance).sort(
    (a, b) => a.threshold - b.threshold,
  )
}

/**
 * Reached milestones the user hasn't claimed yet, ascending by threshold —
 * index 0 is the oldest pending milestone, the one the offer route should
 * try first.
 */
export function pendingMilestones(
  balance: number,
  claimedKeys: string[],
): DecorationMilestone[] {
  const claimed = new Set(claimedKeys)
  return reachedMilestones(balance).filter((m) => !claimed.has(m.key))
}
