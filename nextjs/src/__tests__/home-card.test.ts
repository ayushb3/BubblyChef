/**
 * The Bubbles card picker (issue #755): pure, deterministic, clock injected.
 * One card at a time, the first case that matches wins.
 */
import { pickHomeCard, type HomeCardSnapshot } from '@/lib/kitchen/home-card'
import { SEASONAL_IDEAS } from '@/lib/kitchen/quiet-ideas'
import type { StarterContext } from '@/types/chat'

// Thursday 1 October 2026, 18:30 local.
const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m)
const TODAY = '2026-10-01'

const STARTER: StarterContext = {
  expiring: [],
  pantry_count: 12,
  recent_cooks: [
    { recipe_id: 'r-lemon', title: 'Lemon pasta', last_cooked_at: '2026-09-28T18:00:00Z', cuisine: 'italian' },
  ],
  recent_cuisines: ['italian'],
  default_servings: 2,
}

const COOK = { kind: 'recipe' as const, id: 'r-lemon', title: 'lemon pasta', step: 4, totalSteps: 7 }
const MEAL_COOK = { kind: 'meal' as const, id: 'm-1', title: 'Pasta night', step: 3, totalSteps: 9 }
const SCAN = { savedAt: '2026-10-01T16:00:00.000Z', itemCount: 6 }
const PLANNED = {
  v: 1 as const,
  mealId: 'm-1',
  title: 'Pasta night',
  servings: 2,
  serveAtMs: at(19, 0).getTime(),
  startAtMs: at(18, 15).getTime(),
  startDish: 'Rice',
}
const ROMAINE = { name: 'romaine', daysUntil: 0, expiryDate: '2026-10-01' }

function snap(over: Partial<HomeCardSnapshot> = {}): HomeCardSnapshot {
  return {
    now: at(15, 30), // quiet by default: between lunch and dinner
    cook: null,
    pending: null,
    planned: null,
    expiring: [],
    expiryPriority: 'gentle',
    starter: STARTER,
    tip: 'Rinse rice until the water runs clear. It cooks up fluffier and less sticky.',
    tipTaps: 0,
    seen: {},
    dismissed: [],
    ...over,
  }
}

const labels = (c: NonNullable<ReturnType<typeof pickHomeCard>>) => [
  ...c.options.map((o) => o.label),
  c.primary.label,
]

describe('each case alone', () => {
  it('1. a cook left mid-recipe', () => {
    const card = pickHomeCard(snap({ cook: COOK }))!
    expect(card.kind).toBe('cook')
    expect(card.message).toBe('Back to the lemon pasta? You were on step 4 of 7.')
    expect(labels(card)).toEqual(['I finished it', 'Pick up at step 4'])
    expect(card.options[0].action).toBe('finish-cook')
    expect(card.primary.href).toBe('/recipes?resume=r-lemon')
  })

  it('1. a meal cook picks up on the cook-along route', () => {
    const card = pickHomeCard(snap({ cook: MEAL_COOK }))!
    expect(card.primary.href).toBe('/meals/m-1/cook')
    expect(card.message).toBe('Back to the pasta night? You were on step 3 of 9.')
  })

  it('1. scanned groceries not put away', () => {
    const card = pickHomeCard(snap({ pending: SCAN }))!
    expect(card.kind).toBe('scan')
    expect(card.message).toBe('Shopping is waiting at the door. 6 items to put away.')
    expect(labels(card)).toEqual(['Discard the scan', 'Put it away'])
    expect(card.options[0].action).toBe('discard-scan')
    expect(card.primary.action).toBe('put-away')
  })

  it('1. one scanned item reads singular', () => {
    const card = pickHomeCard(snap({ pending: { ...SCAN, itemCount: 1 } }))!
    expect(card.message).toBe('Shopping is waiting at the door. 1 item to put away.')
  })

  it("2. tonight's planned meal", () => {
    const card = pickHomeCard(snap({ now: at(15, 30), planned: PLANNED }))!
    expect(card.kind).toBe('planned')
    expect(card.message).toBe(
      'Dinner for two at 7:00. Start the rice at 6:15 and everything lands together.',
    )
    expect(labels(card)).toEqual(['Move it to tomorrow', 'Show the timeline'])
    expect(card.options[0].action).toBe('move-tomorrow')
    expect(card.primary.href).toBe('/meals/m-1')
  })

  it('2. the start time has passed: start now', () => {
    const card = pickHomeCard(snap({ now: at(18, 30), planned: PLANNED }))!
    expect(card.message).toBe(
      'Dinner for two at 7:00. Start the rice now and everything lands together.',
    )
  })

  it('2. no start dish known: start cooking', () => {
    const card = pickHomeCard(snap({ planned: { ...PLANNED, startDish: null } }))!
    expect(card.message).toBe(
      'Dinner for two at 7:00. Start cooking at 6:15 and everything lands together.',
    )
  })

  it('2. a lunch meal for one', () => {
    const card = pickHomeCard(
      snap({
        now: at(9, 0),
        planned: { ...PLANNED, servings: 1, serveAtMs: at(12, 30).getTime(), startAtMs: at(11, 45).getTime() },
      }),
    )!
    expect(card.message).toMatch(/^Lunch for one at 12:30\./)
  })

  it('3. food expiring today', () => {
    const card = pickHomeCard(snap({ expiring: [ROMAINE] }))!
    expect(card.kind).toBe('expiring')
    expect(card.message).toBe('Your romaine needs using today. Want me to plan dinner around it?')
    expect(labels(card)).toEqual([
      'Dinner with the romaine',
      'Something in 20 minutes',
      'Make the lemon pasta again',
      'Plan a whole dinner',
    ])
    expect(card.options[0].href).toBe('/chat?plan=dinner&with=romaine')
    expect(card.primary.href).toBe('/chat?plan=dinner')
  })

  it('3. food expiring tomorrow', () => {
    const card = pickHomeCard(snap({ expiring: [{ ...ROMAINE, daysUntil: 1 }] }))!
    expect(card.message).toBe('Your romaine needs using by tomorrow. Want me to plan dinner around it?')
  })

  it('3. no recent cook: the make-again option is left out', () => {
    const card = pickHomeCard(snap({ expiring: [ROMAINE], starter: { ...STARTER, recent_cooks: [] } }))!
    expect(labels(card)).toEqual(['Dinner with the romaine', 'Something in 20 minutes', 'Plan a whole dinner'])
  })

  it('3. the soonest item leads, ties by name', () => {
    const card = pickHomeCard(
      snap({
        expiring: [
          { name: 'spinach', daysUntil: 1, expiryDate: '2026-10-02' },
          { name: 'milk', daysUntil: 0, expiryDate: '2026-10-01' },
          { name: 'eggs', daysUntil: 0, expiryDate: '2026-10-01' },
        ],
      }),
    )!
    expect(card.message).toMatch(/^Your eggs need using today/)
  })

  it('3. an item two days out is not urgent, and an expired one is not either', () => {
    const card = pickHomeCard(
      snap({
        expiring: [
          { name: 'kale', daysUntil: 2, expiryDate: '2026-10-03' },
          { name: 'old milk', daysUntil: -1, expiryDate: '2026-09-30' },
        ],
      }),
    )!
    expect(card.kind).not.toBe('expiring')
  })

  it('4. mealtime, nothing urgent', () => {
    const card = pickHomeCard(snap({ now: at(18, 30) }))!
    expect(card.kind).toBe('mealtime')
    expect(card.message).toBe('Dinner time! What are you in the mood for?')
    // The ranked starter pills (the dinner pill is the primary), then Surprise me.
    expect(labels(card)).toEqual([
      'Make the Lemon pasta again',
      'Something Italian tonight?',
      'Surprise me',
      'Plan a whole dinner',
    ])
    expect(card.primary.href).toBe('/chat?plan=dinner')
  })

  it('4. pills seed the chat with the same text a tap in the chat sends', () => {
    const card = pickHomeCard(snap({ now: at(18, 30) }))!
    expect(card.options[0].href).toBe('/chat?ask=Show+me+my+saved+Lemon+pasta')
    expect(card.options[1].href).toBe('/chat?ask=Something+Italian+tonight%3F')
    expect(card.options[2].href).toBe('/chat?ask=Surprise+me+with+something+to+cook')
  })

  it('4. an expiring pill reuses the cook-this seed', () => {
    const card = pickHomeCard(
      snap({
        now: at(18, 30),
        starter: { ...STARTER, expiring: [{ name: 'kale', expiry_date: '2026-10-03' }] },
        expiring: [{ name: 'kale', daysUntil: 2, expiryDate: '2026-10-03' }],
      }),
    )!
    const pill = card.options.find((o) => o.label.startsWith('Use up the kale'))
    expect(pill?.href).toBe('/chat?use=kale&expires=2026-10-03')
  })

  it('4. breakfast and lunch say so', () => {
    expect(pickHomeCard(snap({ now: at(8, 0) }))!.message).toBe(
      'Breakfast time! What are you in the mood for?',
    )
    expect(pickHomeCard(snap({ now: at(12, 0) }))!.message).toBe(
      'Lunch time! What are you in the mood for?',
    )
  })

  it('4. the starter context has not loaded: the time pill and fillers still show', () => {
    const card = pickHomeCard(snap({ now: at(8, 0), starter: null }))!
    expect(card.kind).toBe('mealtime')
    expect(card.options.length).toBeGreaterThanOrEqual(2)
    expect(card.options.length).toBeLessThanOrEqual(3)
    expect(card.options[card.options.length - 1].label).toBe('Surprise me')
  })

  it('5. a quiet moment: the daily tip', () => {
    // 1 October is day 274 of 2026 (even): a tip.
    const card = pickHomeCard(snap({ now: at(15, 30) }))!
    expect(card.kind).toBe('quiet')
    expect(card.message).toBe(
      'Tip: Rinse rice until the water runs clear. It cooks up fluffier and less sticky.',
    )
    expect(labels(card)).toEqual(['Another tip', 'Show me how'])
    expect(card.options[0].action).toBe('another-tip')
    expect(card.primary.href).toBe(
      `/chat?tip=${encodeURIComponent(
        'Rinse rice until the water runs clear. It cooks up fluffier and less sticky.',
      ).replace(/%20/g, '+')}`,
    )
  })

  it('5. the next day is a seasonal idea', () => {
    const card = pickHomeCard(snap({ now: at(15, 30, 2) }))!
    expect(card.kind).toBe('quiet')
    expect(card.fingerprint).toMatch(/^quiet:season:/)
    expect(card.message).toMatch(/^In season right now: .+\. Want an idea for tonight\?$/)
    expect(labels(card)).toEqual(['Another tip', 'Show me how'])
    expect(card.primary.href).toMatch(/^\/chat\?plan=dinner&with=/)
  })

  it('5. Another tip moves on through the tips, from either kind of day', () => {
    const first = pickHomeCard(snap({ now: at(15, 30, 2), tipTaps: 1 }))!
    expect(first.fingerprint).toMatch(/^quiet:tip:/)
    const second = pickHomeCard(snap({ now: at(15, 30, 2), tipTaps: 2 }))!
    expect(second.message).not.toBe(first.message)
  })

  it('5. no daily tip to hand: a fallback tip still fills the card', () => {
    const card = pickHomeCard(snap({ tip: null }))!
    expect(card.kind).toBe('quiet')
    expect(card.message).toMatch(/^Tip: .+/)
  })

  it('every month has seasonal produce', () => {
    for (let month = 0; month < 12; month++) {
      expect(SEASONAL_IDEAS[month].length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('precedence: the first case that matches wins', () => {
  const everything = (over: Partial<HomeCardSnapshot> = {}) =>
    snap({
      now: at(18, 30),
      cook: COOK,
      pending: SCAN,
      planned: PLANNED,
      expiring: [ROMAINE],
      ...over,
    })

  it('walks down the list as each case stops applying', () => {
    expect(pickHomeCard(everything())!.kind).toBe('cook')
    expect(pickHomeCard(everything({ cook: null }))!.kind).toBe('scan')
    expect(pickHomeCard(everything({ cook: null, pending: null }))!.kind).toBe('planned')
    expect(pickHomeCard(everything({ cook: null, pending: null, planned: null }))!.kind).toBe(
      'expiring',
    )
    expect(
      pickHomeCard(everything({ cook: null, pending: null, planned: null, expiring: [] }))!.kind,
    ).toBe('mealtime')
    expect(
      pickHomeCard(
        everything({ now: at(15, 30), cook: null, pending: null, planned: null, expiring: [] }),
      )!.kind,
    ).toBe('quiet')
  })

  it('is deterministic: the same snapshot gives the same card', () => {
    expect(pickHomeCard(everything())).toEqual(pickHomeCard(everything()))
  })
})

describe('expiry priority Off', () => {
  it('skips case 3 and falls to the next case', () => {
    const card = pickHomeCard(snap({ now: at(18, 30), expiring: [ROMAINE], expiryPriority: 'off' }))!
    expect(card.kind).toBe('mealtime')
  })

  it('falls all the way to a quiet moment outside mealtimes', () => {
    const card = pickHomeCard(snap({ now: at(15, 30), expiring: [ROMAINE], expiryPriority: 'off' }))!
    expect(card.kind).toBe('quiet')
  })

  it.each(['gentle', 'aggressive'] as const)('%s keeps case 3', (level) => {
    expect(pickHomeCard(snap({ expiring: [ROMAINE], expiryPriority: level }))!.kind).toBe('expiring')
  })

  it('does not stop the other cases', () => {
    expect(pickHomeCard(snap({ cook: COOK, expiryPriority: 'off' }))!.kind).toBe('cook')
    expect(pickHomeCard(snap({ planned: PLANNED, expiryPriority: 'off' }))!.kind).toBe('planned')
  })
})

describe("tonight's planned meal", () => {
  it('is only for today', () => {
    const tomorrow = new Date(2026, 9, 2, 19, 0).getTime()
    const yesterday = new Date(2026, 8, 30, 19, 0).getTime()
    expect(pickHomeCard(snap({ planned: { ...PLANNED, serveAtMs: tomorrow } }))!.kind).not.toBe('planned')
    expect(pickHomeCard(snap({ planned: { ...PLANNED, serveAtMs: yesterday } }))!.kind).not.toBe('planned')
  })

  it('is gone once dinner was more than an hour ago', () => {
    expect(pickHomeCard(snap({ now: at(19, 59), planned: PLANNED }))!.kind).toBe('planned')
    expect(pickHomeCard(snap({ now: at(20, 1), planned: PLANNED }))!.kind).not.toBe('planned')
  })
})

describe('once a day, per fingerprint', () => {
  it('a nudge already shown today falls through to the next case', () => {
    const first = pickHomeCard(snap({ now: at(18, 30), cook: COOK }))!
    const later = pickHomeCard(snap({ now: at(18, 30), cook: COOK, seen: { [first.fingerprint]: TODAY } }))!
    expect(later.kind).toBe('mealtime')
  })

  it('a nudge shown on an earlier day is fresh again', () => {
    const first = pickHomeCard(snap({ cook: COOK }))!
    const card = pickHomeCard(snap({ cook: COOK, seen: { [first.fingerprint]: '2026-09-30' } }))!
    expect(card.kind).toBe('cook')
  })

  it('a changed fingerprint is a new nudge: a different cook step shows again', () => {
    const first = pickHomeCard(snap({ cook: COOK }))!
    const next = pickHomeCard(
      snap({ cook: { ...COOK, step: 5 }, seen: { [first.fingerprint]: TODAY } }),
    )!
    expect(next.kind).toBe('cook')
    expect(next.fingerprint).not.toBe(first.fingerprint)
  })

  it('fingerprints follow the thing: item, step, scan, meal', () => {
    const fp = (s: Partial<HomeCardSnapshot>) => pickHomeCard(snap(s))!.fingerprint
    expect(fp({ expiring: [ROMAINE] })).not.toBe(fp({ expiring: [{ ...ROMAINE, name: 'kale' }] }))
    expect(fp({ cook: COOK })).not.toBe(fp({ cook: { ...COOK, step: 5 } }))
    expect(fp({ pending: SCAN })).not.toBe(fp({ pending: { ...SCAN, savedAt: '2026-10-01T17:00:00.000Z' } }))
    expect(fp({ planned: PLANNED })).not.toBe(fp({ planned: { ...PLANNED, mealId: 'm-2' } }))
  })

  it('case 5 is never capped', () => {
    const first = pickHomeCard(snap({}))!
    const again = pickHomeCard(snap({ seen: { [first.fingerprint]: TODAY } }))!
    expect(again.kind).toBe('quiet')
    expect(again.fingerprint).toBe(first.fingerprint)
  })

  it('case 5 always fills when every other case has been used up', () => {
    const cook = pickHomeCard(snap({ now: at(18, 30), cook: COOK }))!
    const meal = pickHomeCard(snap({ now: at(18, 30) }))!
    const card = pickHomeCard(
      snap({
        now: at(18, 30),
        cook: COOK,
        seen: { [cook.fingerprint]: TODAY, [meal.fingerprint]: TODAY },
      }),
    )!
    expect(card.kind).toBe('quiet')
  })
})

describe('Not now', () => {
  it('hides that fingerprint', () => {
    const first = pickHomeCard(snap({ cook: COOK }))!
    const next = pickHomeCard(snap({ now: at(18, 30), cook: COOK, dismissed: [first.fingerprint] }))!
    expect(next.kind).toBe('mealtime')
  })

  it('stays hidden on later days while the fingerprint is the same', () => {
    const first = pickHomeCard(snap({ cook: COOK }))!
    const next = pickHomeCard(
      snap({ now: at(15, 30, 3), cook: COOK, dismissed: [first.fingerprint] }),
    )!
    expect(next.kind).not.toBe('cook')
  })

  it('shows again once the fingerprint changes: a different step, scan or item', () => {
    const cook = pickHomeCard(snap({ cook: COOK }))!
    expect(pickHomeCard(snap({ cook: { ...COOK, step: 6 }, dismissed: [cook.fingerprint] }))!.kind).toBe('cook')

    const scan = pickHomeCard(snap({ pending: SCAN }))!
    expect(
      pickHomeCard(snap({ pending: { ...SCAN, savedAt: '2026-10-01T17:30:00.000Z' }, dismissed: [scan.fingerprint] }))!
        .kind,
    ).toBe('scan')

    const exp = pickHomeCard(snap({ expiring: [ROMAINE] }))!
    expect(
      pickHomeCard(snap({ expiring: [{ ...ROMAINE, name: 'kale' }], dismissed: [exp.fingerprint] }))!.kind,
    ).toBe('expiring')
  })

  it('dismissing the quiet card leaves no card at all', () => {
    const quiet = pickHomeCard(snap({}))!
    expect(pickHomeCard(snap({ dismissed: [quiet.fingerprint] }))).toBeNull()
  })

  it('a dismissed case does not stop a different case from showing', () => {
    const cook = pickHomeCard(snap({ cook: COOK }))!
    const card = pickHomeCard(snap({ cook: COOK, pending: SCAN, dismissed: [cook.fingerprint] }))!
    expect(card.kind).toBe('scan')
  })
})
