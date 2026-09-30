/**
 * Issue #651, §7b/§11 — `rankStarterPills` is pure: `now` is always injected,
 * never read from the clock. `jest.useFakeTimers().setSystemTime(...)` is set
 * to a different date in every describe block below to prove that.
 */
import { rankStarterPills } from '@/lib/starter-pills'
import { ingredientSeedMessage } from '@/lib/chat-seed'
import type { StarterContext } from '@/types/chat'

function ctx(overrides: Partial<StarterContext> = {}): StarterContext {
  return {
    expiring: [],
    pantry_count: 5,
    recent_cooks: [],
    recent_cuisines: [],
    default_servings: 2,
    ...overrides,
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  // A date well away from anything under test, to catch an accidental
  // `new Date()` inside the ranker itself.
  jest.setSystemTime(new Date(2020, 0, 1, 3, 0, 0))
})

afterEach(() => {
  jest.useRealTimers()
})

describe('rankStarterPills — null context, time-of-day table', () => {
  it.each([
    [18, 30, ['Plan dinner for 2', 'What can I make tonight?', 'Quick weeknight dinner']],
    [8, 0, ['Something quick for breakfast', 'What can I make today?', 'Something quick and easy']],
    [12, 30, ['Something quick for lunch', 'What can I make tonight?', 'Quick weeknight dinner']],
    [23, 0, ['A late-night snack idea', 'What can I make tonight?', 'Quick weeknight dinner']],
    [0, 0, ['A late-night snack idea', 'What can I make today?', 'Something quick and easy']],
  ])('%s:%s → %j', (hour, minute, expected) => {
    const now = new Date(2026, 5, 1, hour, minute)
    const chips = rankStarterPills(null, now)
    expect(chips.map((c) => c.label)).toEqual(expected)
  })
})

describe('rankStarterPills — evening dinner with servings', () => {
  it('uses ctx.default_servings in the dinner label', () => {
    const now = new Date(2026, 5, 1, 18, 30)
    const chips = rankStarterPills(ctx({ default_servings: 4 }), now)
    expect(chips[0].label).toBe('Plan dinner for 4')
  })
})

describe('rankStarterPills — expiring item and day grammar', () => {
  const now = new Date(2026, 9, 1, 18, 30) // Thu 2026-10-01, 18:30 local

  it('2 days out → "before {Weekday}", with the tuned ingredient message', () => {
    const chips = rankStarterPills(ctx({ expiring: [{ name: 'spinach', expiry_date: '2026-10-03' }] }), now)
    const pill = chips.find((c) => c.label.startsWith('Use up'))
    expect(pill?.label).toBe('Use up the spinach before Saturday')
    expect(pill?.message).toBe(ingredientSeedMessage('spinach'))
    expect(pill?.message).toBe('What can I make with my spinach before they go bad?')
  })

  it('0 days out → "today"', () => {
    const chips = rankStarterPills(ctx({ expiring: [{ name: 'milk', expiry_date: '2026-10-01' }] }), now)
    expect(chips.find((c) => c.label.startsWith('Use up'))?.label).toBe('Use up the milk today')
  })

  it('1 day out → "by tomorrow"', () => {
    const chips = rankStarterPills(ctx({ expiring: [{ name: 'yogurt', expiry_date: '2026-10-02' }] }), now)
    expect(chips.find((c) => c.label.startsWith('Use up'))?.label).toBe('Use up the yogurt by tomorrow')
  })

  it('5 days out → no expiring pill', () => {
    const chips = rankStarterPills(ctx({ expiring: [{ name: 'eggs', expiry_date: '2026-10-06' }] }), now)
    expect(chips.some((c) => c.label.startsWith('Use up'))).toBe(false)
  })

  it('already expired (yesterday) → no expiring pill', () => {
    const chips = rankStarterPills(ctx({ expiring: [{ name: 'lettuce', expiry_date: '2026-09-30' }] }), now)
    expect(chips.some((c) => c.label.startsWith('Use up'))).toBe(false)
  })

  it('two items on the same day → the first in route order wins', () => {
    const chips = rankStarterPills(
      ctx({
        expiring: [
          { name: 'cream', expiry_date: '2026-10-02' },
          { name: 'butter', expiry_date: '2026-10-02' },
        ],
      }),
      now,
    )
    expect(chips.find((c) => c.label.startsWith('Use up'))?.label).toBe('Use up the cream by tomorrow')
  })
})

describe('rankStarterPills — the scan pill', () => {
  const now = new Date(2026, 5, 1, 15, 0)

  it('pantry_count 0 → an action pill for open_scan in slot 2', () => {
    const chips = rankStarterPills(ctx({ pantry_count: 0 }), now)
    expect(chips[1]).toMatchObject({ kind: 'action', action: 'open_scan' })
  })

  it('pantry_count null (unknown) never triggers the scan pill', () => {
    const chips = rankStarterPills(ctx({ pantry_count: null }), now)
    expect(chips.some((c) => c.action === 'open_scan')).toBe(false)
  })
})

describe('rankStarterPills — make again', () => {
  const now = new Date(2026, 5, 1, 18, 0)

  it('builds the label and message from the recipe title', () => {
    const chips = rankStarterPills(
      ctx({
        recent_cooks: [{ recipe_id: 'r1', title: 'Lemon pasta', last_cooked_at: '2026-05-01', cuisine: null }],
      }),
      now,
    )
    const pill = chips.find((c) => c.label.startsWith('Make the'))
    expect(pill?.label).toBe('Make the Lemon pasta again')
    expect(pill?.message).toBe('Show me my saved Lemon pasta')
  })

  it('prefers the recipe matching a recent cuisine over the most-recent-cooked one', () => {
    const chips = rankStarterPills(
      ctx({
        recent_cooks: [
          { recipe_id: 'r1', title: 'Beef stew', last_cooked_at: '2026-05-01', cuisine: 'french' },
          { recipe_id: 'r2', title: 'Pad thai', last_cooked_at: '2026-04-20', cuisine: 'thai' },
        ],
        recent_cuisines: ['thai'],
      }),
      now,
    )
    expect(chips.find((c) => c.label.startsWith('Make the'))?.label).toBe('Make the Pad thai again')
  })

  it('a 40-character title is truncated in the label only, never the message', () => {
    const longTitle = 'A'.repeat(40)
    const chips = rankStarterPills(
      ctx({ recent_cooks: [{ recipe_id: 'r1', title: longTitle, last_cooked_at: '2026-05-01', cuisine: null }] }),
      now,
    )
    const pill = chips.find((c) => c.label.startsWith('Make the'))
    expect(pill?.label).toBe(`Make the ${'A'.repeat(28)}… again`)
    expect(pill?.message).toBe(`Show me my saved ${longTitle}`)
  })
})

describe('rankStarterPills — cuisine', () => {
  it('"Something Thai tonight?" in the evening', () => {
    const now = new Date(2026, 5, 1, 18, 30)
    const chips = rankStarterPills(ctx({ recent_cuisines: ['thai'] }), now)
    expect(chips.some((c) => c.label === 'Something Thai tonight?')).toBe(true)
  })

  it('"Something Thai today?" before 11:00', () => {
    const now = new Date(2026, 5, 1, 9, 0)
    const chips = rankStarterPills(ctx({ recent_cuisines: ['thai'] }), now)
    expect(chips.some((c) => c.label === 'Something Thai today?')).toBe(true)
  })

  it('never phrases the cuisine pill as personalisation ("you like" / "because" / "taste")', () => {
    const now = new Date(2026, 5, 1, 18, 30)
    const chips = rankStarterPills(ctx({ recent_cuisines: ['korean'] }), now)
    chips.forEach((c) => expect(c.label).not.toMatch(/you like|because|taste/i))
  })
})

describe('rankStarterPills — priority order', () => {
  const now = new Date(2026, 9, 1, 18, 30) // Thu 2026-10-01, 18:30 local

  it('expiring + make-again + cuisine → [time, expiring, make again]', () => {
    const chips = rankStarterPills(
      ctx({
        expiring: [{ name: 'spinach', expiry_date: '2026-10-02' }],
        recent_cooks: [{ recipe_id: 'r1', title: 'Lemon pasta', last_cooked_at: '2026-05-01', cuisine: null }],
        recent_cuisines: ['italian'],
      }),
      now,
    )
    expect(chips.map((c) => c.label)).toEqual([
      'Plan dinner for 2',
      'Use up the spinach by tomorrow',
      'Make the Lemon pasta again',
    ])
  })

  it('scan + make-again → [time, scan, make again]', () => {
    const chips = rankStarterPills(
      ctx({
        pantry_count: 0,
        recent_cooks: [{ recipe_id: 'r1', title: 'Lemon pasta', last_cooked_at: '2026-05-01', cuisine: null }],
      }),
      now,
    )
    expect(chips[0].label).toBe('Plan dinner for 2')
    expect(chips[1]).toMatchObject({ kind: 'action', action: 'open_scan' })
    expect(chips[2].label).toBe('Make the Lemon pasta again')
  })
})

describe('rankStarterPills — with ctx === null', () => {
  it('is the time pill plus the two fillers', () => {
    const now = new Date(2026, 5, 1, 20, 0)
    expect(rankStarterPills(null, now).map((c) => c.label)).toEqual([
      'Plan dinner for 2',
      'What can I make tonight?',
      'Quick weeknight dinner',
    ])
  })
})

describe('rankStarterPills — property: every hour, every context variant', () => {
  function buildVariant(kind: string): StarterContext {
    switch (kind) {
      case 'empty':
        return ctx()
      case 'scan':
        return ctx({ pantry_count: 0 })
      case 'expiring':
        return ctx({ expiring: [{ name: 'kale', expiry_date: '2026-10-02' }] })
      case 'cook':
        return ctx({
          recent_cooks: [{ recipe_id: 'r1', title: 'Chili', last_cooked_at: '2026-05-01', cuisine: 'mexican' }],
        })
      case 'cuisine':
        return ctx({ recent_cuisines: ['mexican'] })
      default:
        return ctx()
    }
  }

  const CASES: Array<StarterContext | null> = [
    null,
    buildVariant('empty'),
    buildVariant('scan'),
    buildVariant('expiring'),
    buildVariant('cook'),
    buildVariant('cuisine'),
  ]

  it('always returns exactly 3 pills with unique labels, and no "tonight"/"weeknight" before 11:00', () => {
    for (let hour = 0; hour < 24; hour++) {
      for (const c of CASES) {
        const now = new Date(2026, 9, 1, hour, 0)
        const result = rankStarterPills(c, now)
        expect(result).toHaveLength(3)
        const labels = result.map((chip) => chip.label.toLowerCase())
        expect(new Set(labels).size).toBe(3)
        if (hour < 11) {
          labels.forEach((label) => {
            expect(label).not.toMatch(/tonight|weeknight/)
          })
        }
      }
    }
  })
})
