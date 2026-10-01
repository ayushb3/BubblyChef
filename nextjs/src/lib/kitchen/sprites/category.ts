/**
 * The category sprites (issue #751): about 20 front-on pixel sprites on the
 * wall's 16 px grid, drawn in code and keyed by pantry category. A place never
 * draws one sprite per item; it draws the sprites of its most-stocked categories
 * (`kitchenStock` in `lib/kitchen/places.ts`), so ~80 items still read as a tidy
 * kitchen.
 *
 * The first 12 are the Category sprites board of the Kitchen Home canvas, pixel
 * for pixel (the grids were read off the board's SVG). The other nine fill out
 * the pantry's categories in the same style: 1 px ink outline, flat fills, one
 * highlight pixel.
 *
 * A pantry row picks its sprite from its category, refined by its name where the
 * category is too coarse for a recognisable picture (`produce` covers a lettuce, an
 * apple and an onion). The mapping is `spriteKindFor`.
 *
 * Colours: `k` is the wall's ink and `t` its trim (themed, so a kitchen theme
 * recolours the outlines); every other colour is the food's own and does not
 * change with the theme, like the rest of the room's food, wood and steel.
 */
import { droopRows, wiltPalette, type PixelPalette, type PixelRows } from '@/lib/kitchen/sprites/pixel'

export type SpriteKind =
  | 'jar'
  | 'bottle'
  | 'carton'
  | 'leafy'
  | 'fruit'
  | 'egg_box'
  | 'cheese'
  | 'meat'
  | 'bread'
  | 'can'
  | 'frozen_bag'
  | 'herb_pot'
  | 'banana'
  | 'veg'
  | 'root'
  | 'fish'
  | 'sack'
  | 'box'
  | 'chips'
  | 'tub'
  | 'juice'

export const WALL_SPRITE_PALETTE: PixelPalette = {
  k: 'var(--wall-ink)',
  t: 'var(--wall-trim)',
  i: '#eaf6fb',
  y: '#ffe0a3',
  w: '#ffffff',
  g: '#6fbf73',
  Y: '#f5d36b',
  b: '#7fc4f0',
  G: '#9ed27a',
  f: '#fff1d6',
  r: '#ff9aa2',
  e: '#f3d29b',
  E: '#d9bb9c',
  c: '#ffd98c',
  C: '#e8b64a',
  m: '#f4a3a8',
  M: '#fde4e6',
  n: '#e0a868',
  N: '#b98556',
  s: '#c9d3dc',
  S: '#9aa6b2',
  B: '#9fd3f0',
  o: '#e08f6a',
  O: '#f5a66b',
  // The wilting art's own colours (the board's hand-drawn romaine, bread, bananas).
  L: '#cfd27a',
  l: '#aba86c',
  q: '#e3d9bf',
  a: '#cdbb9b',
  z: '#93a07f',
  A: '#a3927a',
  u: '#d6c47e',
  U: '#8a6a3a',
}

/** Colours that are already the drained version: never drained a second time. */
const WILT_OWN = new Set(['L', 'l', 'q', 'a', 'z', 'A', 'u', 'U'])
const WILTED_PALETTE = wiltPalette(WALL_SPRITE_PALETTE, WILT_OWN)

interface SpriteDef {
  label: string
  rows: PixelRows
  /** Hand-drawn drooped version (the board's three); the rest are derived by `droopRows`. */
  wilt?: PixelRows
}

const SPRITES: Record<SpriteKind, SpriteDef> = {
  jar: {
    label: 'Jar',
    rows: ['.tttt.', 'kkkkkk', 'kiiiik', 'kiwiik', 'kyyyyk', 'kyyyyk', 'kyyyyk', 'kkkkkk'],
  },
  bottle: {
    label: 'Bottle',
    rows: ['.ggg.', '.kik.', '.kik.', 'kkkkk', 'kYYYk', 'kwwwk', 'kYYYk', 'kYYYk', 'kkkkk'],
  },
  carton: {
    label: 'Carton',
    rows: ['..k..', '.kwk.', 'kwwwk', 'kkkkk', 'kwwwk', 'kbbbk', 'kwwwk', 'kkkkk'],
  },
  leafy: {
    label: 'Leafy bunch',
    rows: ['..G.G..', '.GGGGG.', 'GGgGgGG', 'GGgGgGG', '.GgGgG.', '..ggg..', '..fff..', '..fff..'],
    wilt: ['.......', '..LLL..', '.LlLlL.', 'LLlLlLL', 'L.lLl.L', 'L.qqq.L', '..qqq..', '..qqq..'],
  },
  fruit: {
    label: 'Fruit',
    rows: ['...kg.', '.kkkk.', 'krwrrk', 'krrrrk', 'krrrrk', '.krrk.', '..kk..'],
  },
  egg_box: {
    label: 'Egg box',
    rows: ['ee.ee.ee', 'ee.ee.ee', 'kkkkkkkk', 'kEEEEEEk', '.kkkkkk.'],
  },
  cheese: {
    label: 'Cheese wedge',
    rows: ['.....kk', '...kkck', '.kkccck', 'kccCcck', 'kkkkkkk'],
  },
  meat: {
    label: 'Meat parcel',
    rows: ['.kkkkk.', 'kmmmmmk', 'kmMmmMk', 'kmmmmmk', 'kwwwwwk', 'kkkkkkk'],
  },
  bread: {
    label: 'Bread loaf',
    rows: ['..kkkk..', '.knnnnk.', 'knNnNnNk', 'knnnnnnk', 'kkkkkkkk'],
    wilt: ['.kkkkkk.', 'kazaaAak', 'kaaaAaak', 'kkkkkkkk'],
  },
  can: {
    label: 'Can',
    rows: ['kkkkk', 'ksSsk', 'krrrk', 'krwrk', 'krrrk', 'ksSsk', 'kkkkk'],
  },
  frozen_bag: {
    label: 'Frozen bag',
    rows: ['.kkkk.', 'kBBBBk', 'kBgBBk', 'kBBgBk', 'kwBBBk', 'kBBBBk', 'kkkkkk'],
  },
  herb_pot: {
    label: 'Herb pot',
    rows: ['.g..g.', 'gggggg', '.gggg.', 'kkkkkk', 'kooook', '.kook.', '.kook.', '.kkkk.'],
  },
  banana: {
    label: 'Bananas',
    rows: ['......kk', 'k....kYk', 'kYkkkYYk', '.kYUYUk.', '..kkkk..'],
    wilt: ['......kk', 'k....kuk', 'kukkkuuk', '.kuUuUk.', '..kkkk..'],
  },
  veg: {
    label: 'Vegetable',
    rows: ['.g.g.', '.ggg.', 'kkkkk', 'kOwOk', '.kOk.', '.kOk.', '..k..'],
  },
  root: {
    label: 'Onion',
    rows: ['..kg..', '..kk..', '.kffk.', 'kffwfk', 'kffffk', '.kffk.', '..kk..'],
  },
  fish: {
    label: 'Fish',
    rows: ['..kkkk.k', '.kBBBBkk', 'kBkBBBBk', '.kBBBBkk', '..kkkk.k'],
  },
  sack: {
    label: 'Sack',
    rows: ['.k..k.', '.kkkk.', 'kwwwwk', 'kwrrwk', 'kwwwwk', 'kwwwwk', 'kkkkkk'],
  },
  box: {
    label: 'Box',
    rows: ['kkkkkk', 'kYYYYk', 'krrrrk', 'krwwrk', 'krrrrk', 'kYYYYk', 'kkkkkk'],
  },
  chips: {
    label: 'Snack bag',
    rows: ['k.kk.k', 'kkkkkk', 'kYYYYk', 'kYrrYk', 'kYrrYk', 'kYYYYk', 'kYYYYk', 'kkkkkk'],
  },
  tub: {
    label: 'Tub',
    rows: ['kkkkkk', 'kbbbbk', 'kwwwwk', 'kwwwwk', '.kkkk.'],
  },
  juice: {
    label: 'Juice box',
    rows: ['...kk', '...k.', 'kkkkk', 'kOOOk', 'kOwOk', 'kOOOk', 'kkkkk'],
  },
}

/** Every sprite, in the order that breaks ties between equally stocked categories. */
export const SPRITE_KINDS = Object.keys(SPRITES) as SpriteKind[]

export function spriteLabel(kind: SpriteKind): string {
  return SPRITES[kind].label
}

/**
 * The grid and palette to draw: upright, or the drooped version. A wilting sprite
 * is shorter by a row and drained of colour, so it reads as wilted with no help
 * from motion (which is why reduced motion can simply hold it).
 */
export function spriteArt(
  kind: SpriteKind,
  wilting: boolean,
): { rows: PixelRows; palette: PixelPalette } {
  const def = SPRITES[kind]
  if (!wilting) return { rows: def.rows, palette: WALL_SPRITE_PALETTE }
  if (def.wilt) return { rows: def.wilt, palette: WALL_SPRITE_PALETTE }
  return { rows: droopRows(def.rows), palette: WILTED_PALETTE }
}

// ---------------------------------------------------------------------------
// Which sprite a pantry row gets
// ---------------------------------------------------------------------------

/** The sprite for a category on its own (the fallback when a name says nothing). */
const KIND_BY_CATEGORY: Record<string, SpriteKind> = {
  produce: 'veg',
  dairy: 'carton',
  meat: 'meat',
  protein: 'meat',
  seafood: 'fish',
  bakery: 'bread',
  baking: 'sack',
  grains: 'sack',
  dry_goods: 'box',
  condiments: 'jar',
  snacks: 'chips',
  beverages: 'bottle',
  frozen: 'frozen_bag',
  other: 'box',
}

// Name hints, tried in order, first hit wins: the ones that must beat a later,
// broader word come first ("peanut butter" is a jar, not butter; "orange juice" is
// a juice box, not an orange; "green beans" are a vegetable, not a can).
const NAME_RULES: readonly (readonly [RegExp, SpriteKind])[] = [
  [/\b(frozen)\b/, 'frozen_bag'],
  [/\b(peanut butter|almond butter|nut butter|jam|jelly|honey|pickles?|salsa|spread|tahini|pasta sauce|pesto)\b/, 'jar'],
  [/\b(juice|smoothie)\b/, 'juice'],
  [/\b(canned|tuna|sardines|chickpeas|soup|tomato paste|coconut milk|(?:black|kidney|baked|pinto|white) beans)\b/, 'can'],
  [/\b(eggs?)\b/, 'egg_box'],
  [/\b(cheese|cheddar|parmesan|mozzarella|feta|brie|gouda)\b/, 'cheese'],
  [/\b(butter|margarine|yogh?urt|sour cream|hummus|tofu)\b/, 'tub'],
  [/\b(milk|cream|half and half|kefir)\b/, 'carton'],
  [/\b(bread|bagels?|buns?|rolls?|baguette|loaf|toast|tortillas?|pita|croissants?|muffins?|naan|sourdough)\b/, 'bread'],
  [/\b(bananas?|plantains?)\b/, 'banana'],
  [/\b(basil|parsley|cilantro|coriander|mint|thyme|rosemary|dill|chives|sage|oregano|herbs?)\b/, 'herb_pot'],
  [/\b(lettuce|romaine|spinach|kale|arugula|cabbage|chard|bok choy|salad|greens|celery|collards)\b/, 'leafy'],
  [/\b(potato(?:es)?|onions?|garlic|ginger|beets?|turnips?|shallots?|yams?|radish(?:es)?|leeks?)\b/, 'root'],
  [/\b(carrots?|broccoli|cauliflower|peppers?|cucumbers?|zucchini|courgettes?|squash|corn|peas|green beans|mushrooms?|eggplant|aubergines?)\b/, 'veg'],
  [/\b(apples?|pears?|peach(?:es)?|oranges?|lemons?|limes?|berr(?:y|ies)|strawberr(?:y|ies)|blueberr(?:y|ies)|grapes?|plums?|mango(?:es)?|melon|pineapple|cherr(?:y|ies)|kiwi|tomato(?:es)?|avocados?)\b/, 'fruit'],
  [/\b(rice|flour|sugar|oats?|lentils?|quinoa|couscous|salt)\b/, 'sack'],
  [/\b(oil|vinegar|soy sauce|ketchup|dressing|syrup|sauce|wine|beer|soda|water|cola)\b/, 'bottle'],
]

/** Fresh produce in the freezer is a frozen bag: that is how it is stored. */
const FROZEN_COLLAPSE: ReadonlySet<SpriteKind> = new Set([
  'veg',
  'root',
  'leafy',
  'fruit',
  'banana',
  'herb_pot',
])

/**
 * The sprite for a pantry row: its name where a name makes the picture clearer,
 * else its category, else a plain box. `place` is the wall place the row lives in:
 * fresh produce in the freezer is drawn as a frozen bag.
 */
export function spriteKindFor(
  item: { name?: string | null; category?: string | null },
  place?: string,
): SpriteKind {
  const category = (item.category ?? '').trim().toLowerCase()
  const name = (item.name ?? '').trim().toLowerCase()
  let kind: SpriteKind | undefined
  if (category === 'frozen') kind = 'frozen_bag'
  else kind = NAME_RULES.find(([re]) => re.test(name))?.[1]
  kind ??= KIND_BY_CATEGORY[category] ?? 'box'
  if (place === 'freezer' && FROZEN_COLLAPSE.has(kind)) return 'frozen_bag'
  return kind
}
