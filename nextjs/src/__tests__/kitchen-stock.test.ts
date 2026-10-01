/**
 * Which sprites each place draws and which items wilt (issue #751): the
 * representative-categories and wilting-set logic in `lib/kitchen/places.ts`.
 * Pure, with `today` injected.
 */
import {
  MAX_WILTING,
  PLACES,
  PLACE_KEYS,
  kitchenStock,
  wiltTag,
  wiltingItems,
  type StockItem,
} from '@/lib/kitchen/places'
import { PLACE_SLOTS } from '@/lib/kitchen/sprite-layout'

const TODAY = '2026-10-01'

/** `YYYY-MM-DD` for TODAY plus `days` (local calendar, like the app's own clock). */
function inDays(days: number): string {
  const d = new Date(2026, 9, 1 + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function stockItem(over: Partial<StockItem> & { id: string }): StockItem {
  return {
    name: 'thing',
    category: 'produce',
    location: 'fridge',
    quantity: 1,
    expiry_date: null,
    ...over,
  }
}

describe('wiltTag', () => {
  it.each([
    [-5, 'expired'],
    [-1, 'expired'],
    [0, 'today'],
    [1, '1 day'],
    [2, '2 days'],
    [3, '3 days'],
  ])('reads %i days left as "%s"', (days, tag) => {
    expect(wiltTag(days)).toBe(tag)
  })
})

describe('wiltingItems (#751)', () => {
  it('is empty when nothing needs attention: nothing wilts', () => {
    const items = [
      stockItem({ id: 'a', expiry_date: inDays(4) }),
      stockItem({ id: 'b', expiry_date: inDays(30) }),
      stockItem({ id: 'c', expiry_date: null }),
    ]
    expect(wiltingItems(items, TODAY)).toEqual([])
    expect(wiltingItems([], TODAY)).toEqual([])
  })

  it('never returns more than 3 items overall', () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      stockItem({ id: `i${i}`, expiry_date: inDays(i % 4), location: PLACES[i % 4].location }),
    )
    expect(MAX_WILTING).toBe(3)
    expect(wiltingItems(items, TODAY)).toHaveLength(3)
  })

  it('orders by urgency, soonest first', () => {
    const items = [
      stockItem({ id: 'two', expiry_date: inDays(2) }),
      stockItem({ id: 'zero', expiry_date: inDays(0) }),
      stockItem({ id: 'one', expiry_date: inDays(1) }),
    ]
    expect(wiltingItems(items, TODAY).map((w) => w.id)).toEqual(['zero', 'one', 'two'])
  })

  it('puts expired-but-unresolved items first, the most overdue before the rest', () => {
    const items = [
      stockItem({ id: 'today', expiry_date: inDays(0) }),
      stockItem({ id: 'late1', expiry_date: inDays(-1) }),
      stockItem({ id: 'soon', expiry_date: inDays(3) }),
      stockItem({ id: 'late5', expiry_date: inDays(-5) }),
    ]
    expect(wiltingItems(items, TODAY).map((w) => w.id)).toEqual(['late5', 'late1', 'today'])
  })

  it('does not wilt an item that is already used up (quantity 0): it is resolved', () => {
    const items = [
      stockItem({ id: 'gone', expiry_date: inDays(-2), quantity: 0 }),
      stockItem({ id: 'here', expiry_date: inDays(1) }),
    ]
    expect(wiltingItems(items, TODAY).map((w) => w.id)).toEqual(['here'])
  })

  it('is deterministic when two items are equally urgent', () => {
    const items = [
      stockItem({ id: 'b', name: 'beans', expiry_date: inDays(1) }),
      stockItem({ id: 'a', name: 'apples', expiry_date: inDays(1) }),
    ]
    expect(wiltingItems(items, TODAY).map((w) => w.id)).toEqual(['a', 'b'])
    expect(wiltingItems([...items].reverse(), TODAY).map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('draws each item at its own place with its own tag and sprite', () => {
    const [romaine, bread, bananas] = wiltingItems(
      [
        stockItem({ id: 'r', name: 'Romaine', category: 'produce', location: 'fridge', expiry_date: inDays(0) }),
        stockItem({ id: 'b', name: 'Bread', category: 'bakery', location: 'pantry', expiry_date: inDays(1) }),
        stockItem({ id: 'n', name: 'Bananas', category: 'produce', location: 'counter', expiry_date: inDays(2) }),
      ],
      TODAY,
    )
    expect([romaine.place, romaine.tag, romaine.kind]).toEqual(['fridge', 'today', 'leafy'])
    expect([bread.place, bread.tag, bread.kind]).toEqual(['shelves', '1 day', 'bread'])
    expect([bananas.place, bananas.tag, bananas.kind]).toEqual(['basket', '2 days', 'banana'])
  })

  it('skips an item with no room left at its place and takes the next one that fits', () => {
    // The freezer drawer holds 2 sprites. Three expiring freezer items: the
    // third is passed over and the fridge's later item is drawn instead.
    const items = [
      stockItem({ id: 'f1', location: 'freezer', expiry_date: inDays(-3) }),
      stockItem({ id: 'f2', location: 'freezer', expiry_date: inDays(-2) }),
      stockItem({ id: 'f3', location: 'freezer', expiry_date: inDays(-1) }),
      stockItem({ id: 'm', location: 'fridge', expiry_date: inDays(3) }),
    ]
    expect(wiltingItems(items, TODAY).map((w) => w.id)).toEqual(['f1', 'f2', 'm'])
  })
})

describe('kitchenStock (#751)', () => {
  it('has no sprites and no wilting for an empty pantry', () => {
    const stock = kitchenStock([], TODAY)
    for (const key of PLACE_KEYS) {
      expect(stock[key].kinds).toEqual([])
      expect(stock[key].wilting).toEqual([])
    }
  })

  it("picks a place's sprites from its most-stocked categories, most stocked first", () => {
    const rows = (n: number, over: Partial<StockItem>) =>
      Array.from({ length: n }, (_, i) =>
        stockItem({ id: `${over.name}${i}`, location: 'pantry', ...over }),
      )
    const stock = kitchenStock(
      [
        ...rows(2, { name: 'ketchup', category: 'condiments' }),
        ...rows(5, { name: 'pasta', category: 'dry_goods' }),
        ...rows(3, { name: 'crisps', category: 'snacks' }),
      ],
      TODAY,
    )
    expect(stock.shelves.kinds).toEqual(['box', 'chips', 'bottle'])
  })

  it('shows a few sprites per place, never one per item, for a seeded ~80-item pantry', () => {
    const categories = [
      'produce', 'dairy', 'meat', 'dry_goods', 'condiments',
      'snacks', 'beverages', 'frozen', 'bakery', 'other',
    ]
    const locations = ['fridge', 'freezer', 'pantry', 'counter']
    const items = Array.from({ length: 80 }, (_, i) =>
      stockItem({
        id: `p${i}`,
        name: `item ${i}`,
        category: categories[i % categories.length],
        location: locations[i % locations.length],
        expiry_date: i % 9 === 0 ? inDays(i % 4) : inDays(40 + i),
      }),
    )
    const stock = kitchenStock(items, TODAY)
    let drawn = 0
    for (const key of PLACE_KEYS) {
      const n = stock[key].kinds.length + stock[key].wilting.length
      expect(n).toBeLessThanOrEqual(PLACE_SLOTS[key].length)
      expect(new Set(stock[key].kinds).size).toBe(stock[key].kinds.length) // no repeats in a place
      drawn += n
    }
    expect(drawn).toBeLessThanOrEqual(14)
    expect(drawn).toBeLessThan(items.length / 4)
  })

  it('draws an expiring item by itself, so it is not also counted into its category sprite', () => {
    const stock = kitchenStock(
      [
        stockItem({ id: 'rom', name: 'romaine', location: 'fridge', expiry_date: inDays(0) }),
        stockItem({ id: 'milk', name: 'milk', category: 'dairy', location: 'fridge', expiry_date: inDays(20) }),
      ],
      TODAY,
    )
    expect(stock.fridge.wilting.map((w) => w.id)).toEqual(['rom'])
    expect(stock.fridge.kinds).toEqual(['carton'])
  })

  it('leaves a used-up item (quantity 0) out of the sprites too', () => {
    const stock = kitchenStock(
      [stockItem({ id: 'x', name: 'milk', category: 'dairy', quantity: 0, expiry_date: inDays(20) })],
      TODAY,
    )
    expect(stock.fridge.kinds).toEqual([])
  })

  it('files a row with an unknown location under the Shelves, like the counts do', () => {
    const stock = kitchenStock(
      [stockItem({ id: 'g', name: 'rice', category: 'dry_goods', location: 'garage' })],
      TODAY,
    )
    expect(stock.shelves.kinds).toEqual(['sack'])
  })

  it('shows frozen produce as a frozen bag in the freezer', () => {
    const stock = kitchenStock(
      [stockItem({ id: 'p', name: 'peas', category: 'produce', location: 'freezer' })],
      TODAY,
    )
    expect(stock.freezer.kinds).toEqual(['frozen_bag'])
  })
})
