/**
 * Deterministic "pick 1 of 3" offer for a milestone (issue #522).
 *
 * The offer must be reproducible from the same inputs on every call — the
 * unlock route recomputes it to verify the tapped decoration was actually
 * offered (see `app/api/kitchen/unlock/route.ts`) — so it can't depend on
 * `Math.random()` or wall-clock time. Instead each eligible catalog entry is
 * hashed with a small FNV-1a-style string hash seeded from
 * `userId + milestoneKey + entry.id`, and the three lowest hashes win. No
 * crypto import, so this is usable from either a Next.js route handler or a
 * plain unit test.
 */
import type { Decoration } from './catalog'

/** 32-bit FNV-1a over a UTF-16 string — deterministic, no external dependency. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash *= 16777619 (FNV prime), done with shifts to stay in 32-bit ints.
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * The (up to) three decorations offered to `userId` for `milestoneKey`.
 *
 * Eligible = catalog entries whose `id` isn't already in `unlockedIds` AND
 * whose `slot` isn't already occupied by some other unlocked entry — a slot
 * only ever shows one decoration at a time, so offering a second option for
 * an already-filled slot would be a dead end.
 *
 * At most one candidate per slot is ever placed into a single offer, even
 * when two unclaimed siblings share a slot (the catalog has exactly two
 * entries per slot). Offering both at once would mean picking either one
 * permanently retires the other — the sibling's slot becomes "occupied" the
 * moment either is claimed — with no chance for the sibling to appear in a
 * later offer instead. Per slot, the sibling with the lowest hash is the one
 * that competes for this offer; the other remains eligible for a future
 * offer for as long as the slot stays unclaimed.
 *
 * Returns fewer than 3 (or none) when fewer than 3 (or 0) slots are
 * eligible — never pads or throws.
 */
export function offerFor(
  userId: string,
  milestoneKey: string,
  catalog: Decoration[],
  unlockedIds: string[],
): Decoration[] {
  const unlocked = new Set(unlockedIds)

  const occupiedSlots = new Set(
    catalog.filter((entry) => unlocked.has(entry.id)).map((entry) => entry.slot),
  )

  const eligible = catalog
    .filter((entry) => !unlocked.has(entry.id) && !occupiedSlots.has(entry.slot))
    .map((entry) => ({ entry, hash: fnv1a(`${userId}:${milestoneKey}:${entry.id}`) }))

  const bestPerSlot = new Map<string, { entry: Decoration; hash: number }>()
  for (const candidate of eligible) {
    const current = bestPerSlot.get(candidate.entry.slot)
    if (!current || candidate.hash < current.hash) {
      bestPerSlot.set(candidate.entry.slot, candidate)
    }
  }

  return Array.from(bestPerSlot.values())
    .sort((a, b) => a.hash - b.hash)
    .slice(0, 3)
    .map(({ entry }) => entry)
}
