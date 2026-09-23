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
