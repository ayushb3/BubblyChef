// PROTOTYPE — throwaway, delete after #273 resolves.
// Mock data for the guided-cooking prototype. No fetching, no persistence.

export interface MockStep {
  n: number
  text: string
  /** Placeholder timer affordance only (non-functional). Real timers = #45 / Spec B. */
  timerMin?: number
  /** Ingredients this step pulls in — powers per-step deduction (variant C). */
  uses?: string[]
}

export type MatchStatus = 'ready' | 'substitute' | 'imprecise' | 'assumed' | 'missing'

export interface MockDeduction {
  ingredient: string
  detail: string
  status: MatchStatus
}

export const MOCK_RECIPE = {
  title: 'Creamy Tomato Pasta',
  emoji: '🍝',
  servings: 2,
  totalMin: 25,
  ingredients: [
    '200g pasta',
    '400g canned tomatoes',
    '100ml cream',
    '2 cloves garlic',
    '1 tbsp olive oil',
    'Salt & pepper',
    'Fresh basil',
  ],
  steps: [
    { n: 1, text: 'Bring a large pot of salted water to the boil.', timerMin: 5, uses: ['Salt & pepper'] },
    { n: 2, text: 'Add pasta and cook until al dente.', timerMin: 10, uses: ['200g pasta'] },
    { n: 3, text: 'Meanwhile, gently fry the sliced garlic in olive oil.', timerMin: 2, uses: ['2 cloves garlic', '1 tbsp olive oil'] },
    { n: 4, text: 'Pour in the canned tomatoes, simmer to thicken.', timerMin: 8, uses: ['400g canned tomatoes'] },
    { n: 5, text: 'Stir through the cream, season, and toss with the drained pasta.', uses: ['100ml cream', 'Salt & pepper'] },
    { n: 6, text: 'Plate up and tear over fresh basil.', uses: ['Fresh basil'] },
  ] as MockStep[],
}

// Deduction preview — mirrors CookModal's match-status vocabulary so the
// prototype reads like the real thing. Covers the interesting cases:
// clean deduct, a compound substitute, imprecise (piece-vs-package), assumed
// seasoning, and a genuine miss with a reason.
export const MOCK_DEDUCTIONS: MockDeduction[] = [
  { ingredient: '200g pasta', detail: 'Remove 200g from “Spaghetti 500g”', status: 'ready' },
  { ingredient: '400g canned tomatoes', detail: 'Remove 1 can from “Chopped tomatoes ×3”', status: 'ready' },
  { ingredient: '100ml cream', detail: 'Substitute: butter + milk + flour (roux)', status: 'substitute' },
  { ingredient: '2 cloves garlic', detail: 'Used from “Garlic bulb” — count may drift', status: 'imprecise' },
  { ingredient: 'Salt & pepper', detail: 'Assumed on hand', status: 'assumed' },
  { ingredient: 'Fresh basil', detail: 'Not in pantry — the sauce will taste flatter without it', status: 'missing' },
]

export const STATUS_META: Record<MatchStatus, { label: string; emoji: string; tone: string }> = {
  ready: { label: 'Ready', emoji: '✓', tone: 'var(--color-accent-dark)' },
  substitute: { label: 'Substitute', emoji: '↺', tone: 'var(--color-primary-dark)' },
  imprecise: { label: 'Approx.', emoji: '≈', tone: 'var(--color-muted)' },
  assumed: { label: 'Assumed', emoji: '·', tone: 'var(--color-muted)' },
  missing: { label: 'Missing', emoji: '✗', tone: '#D9534F' },
}

export const VARIANT_NAMES: Record<string, string> = {
  A: 'Checklist column',
  B: 'One-step card',
  C: 'Hybrid strip + body',
  D: 'Chat-anchored sheet',
  E: 'Recipe-native card (recommended)',
  F: 'Multi-dish meal (explores #289)',
}

// ---------------------------------------------------------------------------
// Variant F only — a two-dish coordinated MEAL, transcribed from the real
// Gemini session (Xi'an cumin potatoes + pork/cabbage stir-fry, plated
// together). BubblyChef cannot represent this today (issue #289, Spec B): one
// RecipeCard = one flat dish. F is a throwaway probe to see whether the E card
// idiom survives a multi-dish meal before #263 locks single-dish.
// ---------------------------------------------------------------------------

export interface MockDish {
  id: string
  emoji: string
  title: string
  pan: string
  steps: MockStep[]
}

export const MOCK_MEAL: { title: string; dishes: MockDish[] } = {
  title: 'Cumin Potatoes + Pork Stir-Fry',
  dishes: [
    {
      id: 'potatoes',
      emoji: '🥔',
      title: 'Xi’an Cumin Potato Rounds',
      pan: 'Wide skillet',
      steps: [
        { n: 1, text: 'Heat 2 tbsp neutral oil in a wide skillet over medium-high. Lay the dried potato rounds flat in a single layer.', timerMin: 1, uses: ['1 tbsp olive oil'] },
        { n: 2, text: 'Fry undisturbed 2–3 min until deep golden blister spots appear, then flip and fry 2 more min until tender.', timerMin: 5 },
        { n: 3, text: 'Turn heat to medium-low, push potatoes aside, drop in minced garlic and stir 20–30s until fragrant.', timerMin: 1, uses: ['2 cloves garlic'] },
        { n: 4, text: 'Dump the dry cumin spice mix + scallion greens over the potatoes, toss 20–30s, transfer to a plate so spices don’t burn.', uses: ['Salt & pepper'] },
      ],
    },
    {
      id: 'pork',
      emoji: '🥩',
      title: 'Pork Stir-Fry w/ Cabbage & Green Pepper',
      pan: 'Wok — max heat',
      steps: [
        { n: 1, text: 'Mix 1 tsp cornstarch into the marinated pork until silky, then stir in 1 tsp oil so slices separate.' },
        { n: 2, text: 'Heat the wok until lightly smoking, add 1 tbsp oil, sear the pork flat 45s, stir-fry 45s until just past pink. Remove.', timerMin: 2 },
        { n: 3, text: 'Add 1 tbsp oil, toss garlic + scallion whites 10s, then dump in cabbage and green pepper, stir-fry hard 90s.', timerMin: 2, uses: ['400g canned tomatoes'] },
        { n: 4, text: 'Return pork + juices, pour 1 tbsp soy sauce around the hot wok rim, toss 30–45s until glossy. Plate beside the potatoes.', uses: ['Salt & pepper'] },
      ],
    },
  ],
}

/**
 * The cross-dish plating timeline — the single most valuable thing in the
 * Gemini doc, and the thing that has NO home in BubblyChef today. Ordered
 * segments the cook follows across both pans.
 */
export const MEAL_TIMELINE: { label: string; dish: string; note: string }[] = [
  { label: 'Potatoes first', dish: '🥔', note: 'They hold warmth & texture 10–15 min' },
  { label: 'Hold', dish: '⏸️', note: 'Rest potatoes, fire up the wok' },
  { label: 'Pork last', dish: '🥩', note: 'Moves fast — under 4 min' },
  { label: 'Plate together', dish: '🍽️', note: 'Serve side by side' },
]

/**
 * For variant E: the "notable" pantry note for an ingredient, worded like a
 * recipe rather than an inventory system. Returns undefined for a clean match
 * (`ready`) — those get no sub-line at all ("only when notable").
 */
export function notableNote(ingredient: string): string | undefined {
  const d = MOCK_DEDUCTIONS.find((x) => x.ingredient === ingredient)
  if (!d || d.status === 'ready') return undefined
  switch (d.status) {
    case 'substitute':
      return 'using butter + milk instead'
    case 'imprecise':
      return 'from your garlic bulb'
    case 'assumed':
      return "you'll have this on hand"
    case 'missing':
      return 'not in your pantry — the sauce will taste flatter without it'
    default:
      return undefined
  }
}
