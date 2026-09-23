/**
 * Catalog integrity tests for the kitchen scene (issue #521).
 *
 * These guard the two invariants `KitchenScene` and `useDecorations` rely on
 * without re-checking at runtime: every catalog entry's `slot` is a real
 * slot key, every `id` is unique, and every slot has at least one entry —
 * otherwise a slot could render permanently empty with no way to unlock it.
 */
import { CATALOG } from '@/lib/kitchen/catalog'
import { SLOT_KEYS } from '@/lib/kitchen/slots'

describe('CATALOG (#521)', () => {
  it('has every entry\'s slot present in SLOT_KEYS', () => {
    for (const entry of CATALOG) {
      expect(SLOT_KEYS).toContain(entry.slot)
    }
  })

  it('has unique ids', () => {
    const ids = CATALOG.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has at least one entry per slot key', () => {
    const coveredSlots = new Set(CATALOG.map((d) => d.slot))
    for (const key of SLOT_KEYS) {
      expect(coveredSlots.has(key)).toBe(true)
    }
  })
})
