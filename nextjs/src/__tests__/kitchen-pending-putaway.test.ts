/**
 * The pending put-away record (issue #753): a parsed scan kept in local storage
 * until it is put away or discarded. Pure module, storage injected, so it is
 * tested without rendering. Defensive reads, like `lib/cook-session.ts`: junk
 * in storage reads as "no pending scan", never a crash.
 */
import {
  PENDING_PUTAWAY_KEY,
  clearPendingPutAway,
  incomingByPlace,
  pendingFromScan,
  pendingItemCount,
  readPendingPutAway,
  savePendingPutAway,
  type PendingPutAway,
} from '@/lib/kitchen/pending-putaway'
import type { ScanResult } from '@/types/scan'

function item(name: string, location: string, confidence = 0.95) {
  return {
    name,
    original_name: name.toLowerCase(),
    source_line: name.toUpperCase(),
    price: 1,
    quantity: 1,
    unit: 'item',
    category: 'other',
    location,
    confidence,
  }
}

const SCAN: ScanResult = {
  ocr_text: "TRADER JOE'S\nMILK 4.29\nPEAS 1.99",
  ready_to_add: [item('Milk', 'fridge'), item('Peas', 'freezer'), item('Orzo', 'pantry')],
  needs_review: [item('Green peppers', 'fridge', 0.6)],
  skipped: [item('Bag fee', 'pantry', 0.2)],
  total_items: 5,
  warnings: ['One line was blurry'],
}

const NOW = new Date('2026-10-01T18:30:00.000Z')

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

describe('pendingFromScan', () => {
  it('keeps the three tiers, stamps each item with an id and carries the warnings', () => {
    const rec = pendingFromScan(SCAN, NOW)
    expect(rec.ready.map((i) => i.name)).toEqual(['Milk', 'Peas', 'Orzo'])
    expect(rec.review.map((i) => i.name)).toEqual(['Green peppers'])
    expect(rec.skipped.map((i) => i.name)).toEqual(['Bag fee'])
    expect(rec.warnings).toEqual(['One line was blurry'])
    expect(rec.savedAt).toBe(NOW.toISOString())
    const ids = [...rec.ready, ...rec.review, ...rec.skipped].map((i) => i._id)
    expect(new Set(ids).size).toBe(5)
  })

  it('reads the store off the top of the receipt text, when there is one', () => {
    expect(pendingFromScan(SCAN, NOW).store).toBe("Trader Joe's")
    expect(pendingFromScan({ ...SCAN, ocr_text: '' }, NOW).store).toBeNull()
  })
})

describe('counts', () => {
  it('counts what will be put away: Going in plus the asked-about items, never skipped lines', () => {
    expect(pendingItemCount(pendingFromScan(SCAN, NOW))).toBe(4)
  })

  it('groups what is headed to each place, review items under their guessed place', () => {
    expect(incomingByPlace(pendingFromScan(SCAN, NOW))).toEqual({
      fridge: 2,
      freezer: 1,
      shelves: 1,
      basket: 0,
    })
  })

  it('files an unknown location under Shelves, like the wall does', () => {
    const rec = pendingFromScan({ ...SCAN, ready_to_add: [item('Rice', 'cupboard')], needs_review: [] }, NOW)
    expect(incomingByPlace(rec).shelves).toBe(1)
  })
})

describe('save / read / clear', () => {
  it('round-trips a record through storage', () => {
    const storage = memoryStorage()
    const rec = pendingFromScan(SCAN, NOW)
    savePendingPutAway(rec, storage)
    expect(readPendingPutAway(storage)).toEqual(rec)
  })

  it('is null before anything is saved, and again after clear', () => {
    const storage = memoryStorage()
    expect(readPendingPutAway(storage)).toBeNull()
    savePendingPutAway(pendingFromScan(SCAN, NOW), storage)
    clearPendingPutAway(storage)
    expect(readPendingPutAway(storage)).toBeNull()
    expect(storage.getItem(PENDING_PUTAWAY_KEY)).toBeNull()
  })

  it('tells subscribers in this tab (the storage event only fires in other tabs)', () => {
    const storage = memoryStorage()
    const heard = jest.fn()
    window.addEventListener('bubblychef:putaway-changed', heard)
    savePendingPutAway(pendingFromScan(SCAN, NOW), storage)
    clearPendingPutAway(storage)
    window.removeEventListener('bubblychef:putaway-changed', heard)
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['not JSON', '{nope'],
    ['not an object', '"hello"'],
    ['an array', '[]'],
    ['an unknown version', JSON.stringify({ v: 99, ready: [], review: [], skipped: [] })],
    ['no items at all', JSON.stringify({ v: 1, savedAt: NOW.toISOString(), ready: [], review: [], skipped: [] })],
    ['tiers that are not lists', JSON.stringify({ v: 1, savedAt: 'x', ready: 'milk', review: 4, skipped: null })],
  ])('reads %s as no pending scan', (_label, raw) => {
    const storage = memoryStorage()
    storage.setItem(PENDING_PUTAWAY_KEY, raw)
    expect(readPendingPutAway(storage)).toBeNull()
  })

  it('drops items that are not items and fills in what is missing from the rest', () => {
    const storage = memoryStorage()
    storage.setItem(
      PENDING_PUTAWAY_KEY,
      JSON.stringify({
        v: 1,
        savedAt: NOW.toISOString(),
        store: 42,
        ready: [{ name: 'Milk' }, 7, null, { name: '' }, { quantity: 2 }],
        review: [],
        skipped: [],
        warnings: ['ok', 3],
      }),
    )
    const rec = readPendingPutAway(storage) as PendingPutAway
    expect(rec.ready).toHaveLength(1)
    expect(rec.ready[0]).toMatchObject({
      name: 'Milk',
      quantity: 1,
      unit: 'item',
      category: 'other',
      location: 'pantry',
      source_line: '',
    })
    expect(typeof rec.ready[0]._id).toBe('string')
    expect(rec.store).toBeNull()
    expect(rec.warnings).toEqual(['ok'])
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(readPendingPutAway(broken)).toBeNull()
    expect(() => savePendingPutAway(pendingFromScan(SCAN, NOW), broken)).not.toThrow()
    expect(() => clearPendingPutAway(broken)).not.toThrow()
  })
})
