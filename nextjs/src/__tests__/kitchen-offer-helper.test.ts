/**
 * Tests for the deterministic offer helper (issue #522).
 */
import { offerFor } from '@/lib/kitchen/offer'
import type { Decoration } from '@/lib/kitchen/catalog'

const CATALOG: Decoration[] = [
  { id: 'a1', name: 'A1', slot: 'slot_a', emoji: '🅰️' },
  { id: 'a2', name: 'A2', slot: 'slot_a', emoji: '🅰️' },
  { id: 'b1', name: 'B1', slot: 'slot_b', emoji: '🅱️' },
  { id: 'b2', name: 'B2', slot: 'slot_b', emoji: '🅱️' },
  { id: 'c1', name: 'C1', slot: 'slot_c', emoji: '🇨' },
]

describe('offerFor', () => {
  it('is deterministic for the same inputs', () => {
    const first = offerFor('user-1', 'm25', CATALOG, [])
    const second = offerFor('user-1', 'm25', CATALOG, [])
    expect(second).toEqual(first)
  })

  it('varies by user', () => {
    const a = offerFor('user-1', 'm25', CATALOG, [])
    const b = offerFor('user-2', 'm25', CATALOG, [])
    // Not a strict guarantee for arbitrary catalogs, but true for this one —
    // if it ever collides, that's a hash-quality regression worth catching.
    expect(a.map((d) => d.id)).not.toEqual(b.map((d) => d.id))
  })

  it('excludes already-unlocked ids', () => {
    const options = offerFor('user-1', 'm25', CATALOG, ['a1'])
    expect(options.some((d) => d.id === 'a1')).toBe(false)
  })

  it('excludes every entry in a slot already occupied by an unlocked entry', () => {
    // a1 is unlocked, so a2 (same slot_a) must not be offered even though
    // a2 itself is unlocked by nobody.
    const options = offerFor('user-1', 'm25', CATALOG, ['a1'])
    expect(options.some((d) => d.id === 'a2')).toBe(false)
  })

  it('falls back to fewer than 3 when fewer are eligible', () => {
    // Only slot_c (c1) remains eligible once slot_a and slot_b are both occupied.
    const options = offerFor('user-1', 'm25', CATALOG, ['a1', 'b1'])
    expect(options).toHaveLength(1)
    expect(options[0].id).toBe('c1')
  })

  it('returns an empty array when nothing is eligible', () => {
    const options = offerFor('user-1', 'm25', CATALOG, ['a1', 'b1', 'c1'])
    expect(options).toEqual([])
  })

  it('never offers two entries from the same slot in one offer', () => {
    // slot_a and slot_b each have two unclaimed siblings; only one per slot
    // may appear together, so the sibling stays eligible for a later offer
    // instead of being permanently retired by losing to its own sibling.
    for (const userId of ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']) {
      const options = offerFor(userId, 'm25', CATALOG, [])
      const slots = options.map((d) => d.slot)
      expect(new Set(slots).size).toBe(slots.length)
    }
  })

  it('leaves a same-slot sibling eligible for a future offer', () => {
    // Whichever of a1/a2 doesn't win this offer must still be selectable
    // in some other offer while the slot is still unclaimed — i.e. it was
    // out-competed for *this* milestone key, not permanently excluded.
    const options = offerFor('user-1', 'm25', CATALOG, [])
    const chosenInA = options.find((d) => d.slot === 'slot_a')
    expect(chosenInA).toBeDefined()
    const sibling = CATALOG.find((d) => d.slot === 'slot_a' && d.id !== chosenInA!.id)!

    // Confirm the sibling itself, not just "some slot_a entry", wins at
    // least one differently-keyed offer while both remain unlocked. If the
    // same-slot exclusion were reverted (both a1 and a2 offered together,
    // one permanently losing on every key), this would never find the
    // sibling winning any of them.
    const siblingWinsSomeOffer = ['m60', 'm120', 'm200', 'm300', 'm25-b', 'm25-c'].some(
      (key) => offerFor('user-1', key, CATALOG, []).find((d) => d.slot === 'slot_a')?.id ===
        sibling.id,
    )
    expect(siblingWinsSomeOffer).toBe(true)

    // Once the winner is actually unlocked, the slot is occupied and the
    // sibling is excluded outright, regardless of milestone key.
    const laterOptions = offerFor('user-1', 'm60', CATALOG, [chosenInA!.id])
    expect(laterOptions.some((d) => d.id === sibling.id)).toBe(false)
  })

  it('caps at 3 options when more are eligible', () => {
    const bigCatalog: Decoration[] = [
      { id: 's1', name: 'S1', slot: 'slot_1', emoji: '1' },
      { id: 's2', name: 'S2', slot: 'slot_2', emoji: '2' },
      { id: 's3', name: 'S3', slot: 'slot_3', emoji: '3' },
      { id: 's4', name: 'S4', slot: 'slot_4', emoji: '4' },
    ]
    const options = offerFor('user-1', 'm25', bigCatalog, [])
    expect(options).toHaveLength(3)
  })
})
