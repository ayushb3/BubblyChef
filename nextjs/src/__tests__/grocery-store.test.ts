/**
 * Issue #497 (Spec B.5): the localStorage round trip (`lib/grocery-store.ts`)
 * and the share action (`lib/grocery-share.ts`).
 *
 * The list is per-browser by the issue's decision: check-off and manual-add
 * state is keyed by user id and every storage access is wrapped in try/catch
 * (private windows, blocked site data), so a broken store degrades to "no
 * saved list", never to a crash.
 */

import {
  addToGroceryList,
  groceryStorageKey,
  loadGroceryLines,
  saveGroceryLines,
  subscribeGrocery,
} from '@/lib/grocery-store'
import { shareGroceryText } from '@/lib/grocery-share'
import {
  addManualLines,
  regenerateGroceryList,
  setLineChecked,
  type GroceryLine,
} from '@/lib/grocery'

const ALICE = 'user-alice'
const BOB = 'user-bob'

beforeEach(() => {
  window.localStorage.clear()
  jest.restoreAllMocks()
})

function sample(): GroceryLine[] {
  return addManualLines([], [{ name: 'Eggs', quantity: 12, unit: 'item' }, 'Milk'])
}

describe('localStorage round trip', () => {
  it('a checked line is still checked after a reload', () => {
    const lines = setLineChecked(sample(), 'egg', true)
    expect(saveGroceryLines(ALICE, lines)).toBe(true)

    const reloaded = loadGroceryLines(ALICE)
    expect(reloaded).toEqual(lines)
    expect(reloaded.find((l) => l.key === 'egg')?.checked).toBe(true)
  })

  it('is keyed by user id: one user never sees another\'s list', () => {
    saveGroceryLines(ALICE, sample())
    expect(loadGroceryLines(BOB)).toEqual([])
    expect(groceryStorageKey(ALICE)).not.toBe(groceryStorageKey(BOB))
    expect(groceryStorageKey(ALICE)).toContain(ALICE)
  })

  it('regenerate after a reload keeps checked and manual lines and refreshes the generated ones', () => {
    // Session 1: regenerate from the pantry, check the eggs, add a manual line.
    const pantry1 = [
      { name: 'eggs', category: 'dairy', quantity: 0, unit: 'item' },
      { name: 'milk', category: 'dairy', quantity: 1, unit: 'L', days_until_expiry: 1 },
    ]
    let lines = regenerateGroceryList([], pantry1)
    lines = setLineChecked(lines, 'egg', true)
    lines = addManualLines(lines, ['paper towels'])
    saveGroceryLines(ALICE, lines)

    // Session 2 (reload): the milk was replaced, flour ran out.
    const pantry2 = [
      { name: 'eggs', category: 'dairy', quantity: 0, unit: 'item' },
      { name: 'milk', category: 'dairy', quantity: 2, unit: 'L', days_until_expiry: 9 },
      { name: 'flour', category: 'dry_goods', quantity: 0, unit: 'kg' },
    ]
    const next = regenerateGroceryList(loadGroceryLines(ALICE), pantry2)
    saveGroceryLines(ALICE, next)

    const after = loadGroceryLines(ALICE)
    expect(after.map((l) => l.name).sort()).toEqual(['eggs', 'flour', 'paper towels'])
    expect(after.find((l) => l.name === 'eggs')?.checked).toBe(true)
  })

  it('a corrupt or foreign value reads as an empty list', () => {
    for (const bad of ['not json', '{"lines": 5}', '[1,2,3]', 'null', '"x"']) {
      window.localStorage.setItem(groceryStorageKey(ALICE), bad)
      expect(loadGroceryLines(ALICE)).toEqual([])
    }
  })

  it('drops malformed lines but keeps the good ones', () => {
    window.localStorage.setItem(
      groceryStorageKey(ALICE),
      JSON.stringify({
        v: 1,
        lines: [
          { key: 'egg', name: 'Eggs', quantity: 12, unit: 'item', category: 'dairy', source: 'manual', checked: true },
          { key: 'x' },
          { key: 'y', name: 'Y', quantity: 'many', unit: null, category: 'other', source: 'manual', checked: false },
          { key: 'z', name: 'Z', quantity: null, unit: null, category: 'other', source: 'bogus', checked: false },
        ],
      })
    )
    expect(loadGroceryLines(ALICE).map((l) => l.name)).toEqual(['Eggs'])
  })

  it('never throws when storage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(loadGroceryLines(ALICE)).toEqual([])
    expect(saveGroceryLines(ALICE, sample())).toBe(false)
    expect(() => addToGroceryList(ALICE, ['basil'])).not.toThrow()
  })

  it('a missing user id reads and writes nothing', () => {
    expect(saveGroceryLines('', sample())).toBe(false)
    expect(loadGroceryLines('')).toEqual([])
    expect(window.localStorage.length).toBe(0)
  })
})

describe('addToGroceryList (the pantry item "Add to list" helper)', () => {
  it('appends to the manual set and persists', () => {
    saveGroceryLines(ALICE, sample())
    const lines = addToGroceryList(ALICE, [{ name: 'Olive oil', quantity: 1, unit: 'L', category: 'condiments' }])
    expect(lines.find((l) => l.key === 'olive oil')).toMatchObject({ source: 'manual', checked: false })
    expect(loadGroceryLines(ALICE)).toEqual(lines)
    expect(lines).toHaveLength(3)
  })

  it('takes plain names (a meal\'s to-buy list) and never duplicates a food', () => {
    addToGroceryList(ALICE, ['basil', 'feta'])
    addToGroceryList(ALICE, ['Basil'])
    expect(loadGroceryLines(ALICE).map((l) => l.name)).toEqual(['basil', 'feta'])
  })

  it('does not touch another user\'s list', () => {
    saveGroceryLines(BOB, sample())
    addToGroceryList(ALICE, ['basil'])
    expect(loadGroceryLines(BOB)).toEqual(sample())
  })
})

describe('subscribeGrocery', () => {
  it('notifies on a save in this tab and on a storage event from another, then unsubscribes', () => {
    const cb = jest.fn()
    const off = subscribeGrocery(cb)
    saveGroceryLines(ALICE, sample())
    expect(cb).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new StorageEvent('storage', { key: groceryStorageKey(ALICE) }))
    expect(cb).toHaveBeenCalledTimes(2)

    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
    expect(cb).toHaveBeenCalledTimes(2)

    off()
    saveGroceryLines(ALICE, sample())
    expect(cb).toHaveBeenCalledTimes(2)
  })
})

describe('shareGroceryText', () => {
  const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share')
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  function setNav(share?: unknown, clipboard?: unknown) {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  }

  afterEach(() => {
    for (const [name, desc] of [['share', originalShare], ['clipboard', originalClipboard]] as const) {
      if (desc) Object.defineProperty(navigator, name, desc)
      else delete (navigator as unknown as Record<string, unknown>)[name]
    }
  })

  const TEXT = '- Eggs (12 items)\n- Milk (1 L)'

  it('uses the Web Share API when available', async () => {
    const share = jest.fn().mockResolvedValue(undefined)
    const writeText = jest.fn()
    setNav(share, { writeText })
    expect(await shareGroceryText(TEXT)).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'Grocery list', text: TEXT })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('treats a dismissed share sheet as cancelled, not as a failure to copy', async () => {
    const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' })
    const writeText = jest.fn()
    setNav(jest.fn().mockRejectedValue(abort), { writeText })
    expect(await shareGroceryText(TEXT)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies to the clipboard when there is no Web Share API', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    setNav(undefined, { writeText })
    expect(await shareGroceryText(TEXT)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(TEXT)
  })

  it('falls back to copy when sharing itself fails', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    setNav(jest.fn().mockRejectedValue(new Error('NotAllowedError')), { writeText })
    expect(await shareGroceryText(TEXT)).toBe('copied')
  })

  it('reports unavailable when neither works, and never shares an empty list', async () => {
    setNav(undefined, undefined)
    expect(await shareGroceryText(TEXT)).toBe('unavailable')
    const share = jest.fn()
    setNav(share, undefined)
    expect(await shareGroceryText('')).toBe('empty')
    expect(share).not.toHaveBeenCalled()
  })
})
