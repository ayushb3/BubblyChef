/**
 * The pixel sprites and where they sit on the wall (issue #751): category
 * sprites keyed by pantry category, the wilting variants, the 24 decoration
 * sprites, and the layout that places them. Pure data and geometry.
 */
import {
  SPRITE_KINDS,
  WALL_SPRITE_PALETTE,
  spriteArt,
  spriteKindFor,
  type SpriteKind,
} from '@/lib/kitchen/sprites/category'
import { DECORATION_PALETTE, DECORATION_SPRITES } from '@/lib/kitchen/sprites/decorations'
import { droopRows, rowsToPaths, wiltPalette } from '@/lib/kitchen/sprites/pixel'
import { CATALOG } from '@/lib/kitchen/catalog'
import { SLOTS, WALL_H, WALL_W } from '@/lib/kitchen/slots'
import { PLACE_SLOTS, layoutStock } from '@/lib/kitchen/sprite-layout'
import { PLACE_KEYS, kitchenStock, type StockItem } from '@/lib/kitchen/places'

const size = (rows: readonly string[]) => [rows[0].length, rows.length]

describe('category sprites (#751)', () => {
  it('has about 20 sprites', () => {
    expect(SPRITE_KINDS.length).toBeGreaterThanOrEqual(20)
    expect(SPRITE_KINDS.length).toBeLessThanOrEqual(24)
  })

  it.each(SPRITE_KINDS)('%s is a rectangular grid that only uses palette colours', (kind) => {
    for (const wilting of [false, true]) {
      const { rows, palette } = spriteArt(kind, wilting)
      const [w] = size(rows)
      expect(w).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row).toHaveLength(w)
        for (const ch of row) if (ch !== '.') expect(palette[ch]).toBeTruthy()
      }
      // Something is actually drawn.
      expect(rows.join('')).toMatch(/[^.]/)
    }
  })

  it('matches the Category sprites board for the 12 it shows (sizes in pixels)', () => {
    const board: Record<string, [number, number]> = {
      jar: [6, 8],
      bottle: [5, 9],
      carton: [5, 8],
      leafy: [7, 8],
      fruit: [6, 7],
      egg_box: [8, 5],
      cheese: [7, 5],
      meat: [7, 6],
      bread: [8, 5],
      can: [5, 7],
      frozen_bag: [6, 7],
      herb_pot: [6, 8],
    }
    for (const [kind, [w, h]] of Object.entries(board)) {
      expect(size(spriteArt(kind as SpriteKind, false).rows)).toEqual([w, h])
    }
  })

  it('matches the board for the 3 wilting items it shows', () => {
    expect(size(spriteArt('leafy', true).rows)).toEqual([7, 8]) // Romaine
    expect(size(spriteArt('bread', true).rows)).toEqual([8, 4]) // Bread
    expect(size(spriteArt('banana', true).rows)).toEqual([8, 5]) // Bananas
  })

  it('draws a wilting sprite in drained colours, not the upright ones', () => {
    for (const kind of SPRITE_KINDS) {
      const up = rowsToPaths(spriteArt(kind, false).rows, spriteArt(kind, false).palette)
      const down = rowsToPaths(spriteArt(kind, true).rows, spriteArt(kind, true).palette)
      const upFills = new Set(up.map((p) => p.fill))
      const downFills = new Set(down.map((p) => p.fill))
      expect([...downFills].some((f) => !upFills.has(f))).toBe(true)
    }
  })

  it('uses the wall ink for outlines, so a kitchen theme recolours them', () => {
    expect(WALL_SPRITE_PALETTE.k).toBe('var(--wall-ink)')
  })
})

describe('droopRows / wiltPalette (#751)', () => {
  it('droops a tall sprite by dropping one row, bottom-anchored', () => {
    const rows = ['.kk.', 'kwwk', 'kwwk', 'kwwk', 'kkkk']
    const out = droopRows(rows)
    expect(out).toHaveLength(rows.length - 1)
    expect(out[out.length - 1]).toBe(rows[rows.length - 1])
  })

  it('leaves a very short sprite as it is', () => {
    const rows = ['kkkk', 'kwwk', 'kkkk']
    expect(droopRows(rows)).toEqual(rows)
  })

  it('drains hex colours toward a dull olive and leaves css variables alone', () => {
    const out = wiltPalette({ a: '#00ff00', k: 'var(--wall-ink)' })
    expect(out.k).toBe('var(--wall-ink)')
    expect(out.a).not.toBe('#00ff00')
    expect(out.a).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('spriteKindFor: sprites keyed by pantry category (#751)', () => {
  it.each([
    ['romaine', 'produce', 'leafy'],
    ['apples', 'produce', 'fruit'],
    ['bananas', 'produce', 'banana'],
    ['carrots', 'produce', 'veg'],
    ['onions', 'produce', 'root'],
    ['basil', 'produce', 'herb_pot'],
    ['mystery vegetable', 'produce', 'veg'],
    ['milk', 'dairy', 'carton'],
    ['cheddar cheese', 'dairy', 'cheese'],
    ['eggs', 'dairy', 'egg_box'],
    ['eggplant', 'produce', 'veg'],
    ['yogurt', 'dairy', 'tub'],
    ['chicken breast', 'meat', 'meat'],
    ['salmon', 'seafood', 'fish'],
    ['sourdough bread', 'bakery', 'bread'],
    ['rice', 'dry_goods', 'sack'],
    ['spaghetti', 'dry_goods', 'box'],
    ['chickpeas canned', 'dry_goods', 'can'],
    ['ketchup', 'condiments', 'bottle'],
    ['strawberry jam', 'condiments', 'jar'],
    ['something saucy', 'condiments', 'jar'],
    ['crisps', 'snacks', 'chips'],
    ['orange juice', 'beverages', 'juice'],
    ['frozen peas', 'frozen', 'frozen_bag'],
    ['mystery', 'other', 'box'],
    ['mystery', undefined, 'box'],
    ['mystery', 'something-new', 'box'],
  ])('%s (%s) is a %s', (name, category, kind) => {
    expect(spriteKindFor({ name, category })).toBe(kind)
  })

  it('shows anything frozen produce as a frozen bag in the freezer, and leaves the rest alone', () => {
    expect(spriteKindFor({ name: 'peas', category: 'produce' }, 'freezer')).toBe('frozen_bag')
    expect(spriteKindFor({ name: 'chicken', category: 'meat' }, 'freezer')).toBe('meat')
  })
})

describe('decoration sprites (#751)', () => {
  it('has a sprite for every catalog entry', () => {
    for (const d of CATALOG) expect(DECORATION_SPRITES[d.id]).toBeDefined()
    expect(Object.keys(DECORATION_SPRITES).sort()).toEqual(CATALOG.map((d) => d.id).sort())
  })

  it.each(CATALOG.map((d) => [d.id, d] as const))(
    '%s fills its slot exactly (so swapping the art never moves the layout)',
    (_id, d) => {
      const slot = SLOTS.find((s) => s.key === d.slot)!
      const rows = DECORATION_SPRITES[d.id]
      const slotW = Math.floor((slot.w * WALL_W) / 100 + 0.01)
      const slotH = Math.floor((slot.h * WALL_H) / 100 + 0.01)
      expect(size(rows)).toEqual([slotW, slotH])
      for (const row of rows) {
        expect(row).toHaveLength(slotW)
        for (const ch of row) if (ch !== '.') expect(DECORATION_PALETTE[ch]).toMatch(/^#[0-9a-f]{6}$/i)
      }
      expect(rows.join('')).toMatch(/[^.]/)
    },
  )

  it('gives every catalog entry art through the catalog art field, as an image the browser can fetch', () => {
    for (const d of CATALOG) {
      expect(d.art).toMatch(/^data:image\/svg\+xml/)
      expect(d.emoji).toBeTruthy() // the fallback stays for any entry whose art is removed
    }
  })

  it('draws the two decorations of a slot differently', () => {
    const bySlot = new Map<string, string[]>()
    for (const d of CATALOG) bySlot.set(d.slot, [...(bySlot.get(d.slot) ?? []), d.art ?? ''])
    for (const arts of bySlot.values()) expect(new Set(arts).size).toBe(arts.length)
  })
})

describe('layoutStock (#751)', () => {
  const item = (over: Partial<StockItem> & { id: string }): StockItem => ({
    name: 'thing',
    category: 'produce',
    location: 'fridge',
    quantity: 1,
    expiry_date: null,
    ...over,
  })

  it('sits every sprite on its slot, inside the wall', () => {
    const stock = kitchenStock(
      [
        item({ id: '1', name: 'milk', category: 'dairy' }),
        item({ id: '2', name: 'cheddar cheese', category: 'dairy' }),
        item({ id: '3', name: 'chicken', category: 'meat' }),
        item({ id: '4', name: 'rice', category: 'dry_goods', location: 'pantry' }),
        item({ id: '5', name: 'ketchup', category: 'condiments', location: 'pantry' }),
        item({ id: '6', name: 'apples', location: 'counter' }),
        item({ id: '7', name: 'peas', location: 'freezer' }),
      ],
      '2026-10-01',
    )
    const { sprites } = layoutStock(stock)
    expect(sprites).toHaveLength(7)
    for (const s of sprites) {
      const bases = PLACE_SLOTS[s.place].map((slot) => slot.base)
      expect(bases).toContain(s.y + s.h)
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x + s.w).toBeLessThanOrEqual(WALL_W)
      expect(s.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('puts the board A stock where board A draws it', () => {
    const stock = kitchenStock(
      [
        item({ id: 'm', name: 'milk', category: 'dairy' }),
        item({ id: 'c', name: 'cheddar cheese', category: 'dairy' }),
        item({ id: 'p', name: 'chicken', category: 'meat' }),
        item({ id: 'r', name: 'romaine', expiry_date: '2026-10-01' }),
      ],
      '2026-10-01',
    )
    const at = (kind: string) => {
      const s = layoutStock(stock).sprites.find((p) => p.kind === kind)!
      return [s.x, s.y]
    }
    // Fridge in board A: milk carton (7,18), meat (7,33); cheese and romaine one unit
    // right of the board (x 14, not 13) so an 8-wide egg box never touches its neighbour.
    expect(at('carton')).toEqual([7, 18])
    expect(at('cheese')).toEqual([14, 21])
    expect(at('meat')).toEqual([7, 33])
    expect(at('leafy')).toEqual([14, 31])
  })

  it('never lets two sprites on the same fridge shelf touch, with an 8-wide egg box on the top shelf', () => {
    const none = { kinds: [] as SpriteKind[], wilting: [] }
    const { sprites } = layoutStock({
      fridge: { kinds: ['egg_box', 'cheese', 'meat', 'leafy'], wilting: [] },
      freezer: none,
      shelves: none,
      basket: none,
    })
    expect(sprites).toHaveLength(4)
    for (const a of sprites) {
      for (const b of sprites) {
        if (a === b || a.y + a.h !== b.y + b.h) continue
        expect([a.key, b.key, a.x + a.w <= b.x || b.x + b.w <= a.x]).toEqual([a.key, b.key, true])
      }
    }
    // And they stay inside the fridge's cavity (x 6 to 20 in wall units).
    for (const s of sprites) {
      expect(s.x).toBeGreaterThanOrEqual(6)
      expect(s.x + s.w - 1).toBeLessThanOrEqual(20)
    }
  })

  it('draws the wilting item and tags it with its time left', () => {
    const stock = kitchenStock(
      [
        item({ id: 'a', name: 'bread', category: 'bakery', location: 'pantry', expiry_date: '2026-10-02' }),
        item({ id: 'b', name: 'milk', category: 'dairy', expiry_date: '2026-09-28' }),
      ],
      '2026-10-01',
    )
    const { sprites, tags } = layoutStock(stock)
    expect(sprites.filter((s) => s.wilting).map((s) => s.wilting!.id).sort()).toEqual(['a', 'b'])
    expect(tags.map((t) => t.text).sort()).toEqual(['1 day', 'expired'])
  })

  it('keeps wilting tags inside the wall and clear of each other, even with three in one place', () => {
    const stock = kitchenStock(
      [
        item({ id: 'a', name: 'milk', category: 'dairy', expiry_date: '2026-09-28' }),
        item({ id: 'b', name: 'chicken', category: 'meat', expiry_date: '2026-09-29' }),
        item({ id: 'c', name: 'cheese', category: 'dairy', expiry_date: '2026-10-01' }),
      ],
      '2026-10-01',
    )
    const { tags } = layoutStock(stock)
    expect(tags).toHaveLength(3)
    for (const t of tags) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(WALL_W)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.y + t.h).toBeLessThanOrEqual(WALL_H)
    }
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i]
        const b = tags[j]
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect([a.text, b.text, apart]).toEqual([a.text, b.text, true])
      }
    }
  })

  it('has slots for every place', () => {
    for (const key of PLACE_KEYS) expect(PLACE_SLOTS[key].length).toBeGreaterThan(0)
  })
})
