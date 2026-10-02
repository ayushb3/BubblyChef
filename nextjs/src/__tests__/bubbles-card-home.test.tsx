/**
 * The Bubbles card on the kitchen home (issue #755), end to end through `HeroHome`:
 * the five cases as a user meets them, where every key goes, the once-a-day rule,
 * Not now, expiry priority Off and the unlock offer taking the card's place.
 *
 * Fetches are mocked (pantry, recipes, meals, starter context, daily tip, offer);
 * no model is called. Local storage is the real jsdom one, because the cook
 * session, the pending scan, tonight's plan and the card's records all live there.
 * Only `Date` is faked, so React Query and waitFor keep their timers.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import { getActiveCookSession, saveCookProgress, startGuidedCookSession } from '@/lib/cook-session'
import { getActiveMealCookSession, startMealCookSession } from '@/lib/meal-cook-session'
import { dishStepSignaturesForMeal } from '@/lib/meal-dishes'
import {
  pendingFromScan,
  readPendingPutAway,
  savePendingPutAway,
} from '@/lib/kitchen/pending-putaway'
import { readPlannedTonight, savePlannedTonight } from '@/lib/kitchen/planned-tonight'
import { HOME_CARD_KEY, readHomeCardRecords } from '@/lib/kitchen/home-card-store'
import { CATALOG } from '@/lib/kitchen/catalog'
import type { ScanResult } from '@/types/scan'
import type { Meal } from '@/types/meals'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

const LEMON_PASTA = {
  id: 'r-lemon',
  user_id: 'u',
  title: 'Lemon pasta',
  ingredients: [],
  instructions: ['1', '2', '3', '4', '5', '6', '7'].map((n) => `Step ${n}`),
}

const STARTER = {
  expiring: [],
  pantry_count: 12,
  recent_cooks: [
    { recipe_id: 'r-lemon', title: 'Lemon pasta', last_cooked_at: '2026-09-28T18:00:00Z', cuisine: 'italian' },
  ],
  recent_cuisines: ['italian'],
  default_servings: 2,
}

const TIP = 'Rinse rice until the water runs clear. It cooks up fluffier and less sticky.'

interface World {
  expiring?: Array<Record<string, unknown>>
  offer?: unknown
  meal?: Meal
  /** `'empty'`: nothing in the pantry. `'failed'`: the pantry read errors (unknown, not empty). */
  pantry?: 'empty' | 'failed'
}

function mockWorld({ expiring = [], offer = null, meal, pantry }: World = {}) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/kitchen/offer')) return jsonResponse(offer)
    if (url.includes('/api/chat/starter-context')) return jsonResponse(STARTER)
    if (url.includes('/api/recipes/r-lemon')) return jsonResponse(LEMON_PASTA)
    if (meal && url.includes(`/api/meals/${meal.id}`)) return jsonResponse(meal)
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: expiring, count: expiring.length })
    if (url.includes('/api/pantry') && pantry === 'failed') return jsonResponse({ error: 'down' }, false)
    if (url.includes('/api/pantry') && pantry === 'empty') return jsonResponse({ items: [], total_count: 0 })
    if (url.includes('/api/pantry')) {
      return jsonResponse({ items: [{ id: 'p1', name: 'eggs' }, ...expiring], total_count: 1 + expiring.length })
    }
    if (url.includes('/api/ai/dashboard/daily')) {
      return jsonResponse({
        tip: { text: TIP, category: 'technique' },
        suggestion: null,
        generated_at: '2026-10-01T08:00:00Z',
        source: 'ai',
      })
    }
    return jsonResponse({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

function renderHome(props: Partial<React.ComponentProps<typeof HeroHome>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" {...props} />
    </QueryClientProvider>,
  )
}

function fixClock(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
      'clearImmediate', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
      'nextTick', 'performance', 'hrtime', 'requestIdleCallback', 'cancelIdleCallback',
    ],
  })
}

// Thursday 1 October 2026. 15:30 is between meals (a quiet moment); 18:30 is dinner.
const QUIET = '2026-10-01T15:30:00'
const DINNER = '2026-10-01T18:30:00'

const originalFetch = global.fetch
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  fixClock(QUIET)
})
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

const card = () => screen.findByTestId('bubbles-card')
const message = () => screen.getByTestId('bubbles-card-message').textContent
const keys = () => {
  // In document order, so the order of the keys on the card is part of what is checked.
  return Array.from(screen.getByTestId('bubbles-card').querySelectorAll('a, button'))
    .filter((el) => el.getAttribute('aria-label') !== 'Not now')
    .map((el) => el.textContent)
}

const at = (h: number, m = 0) => new Date(2026, 9, 1, h, m).getTime()

describe('case 1: something in progress', () => {
  it('a cook left mid-recipe: Pick up at step 4, or I finished it', async () => {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 3)
    mockWorld()
    renderHome()

    const c = await card()
    expect(message()).toBe('Back to the Lemon pasta? You were on step 4 of 7.')
    expect(keys()).toEqual(['I finished it', 'Pick up at step 4'])
    expect(within(c).getByRole('link', { name: 'Pick up at step 4' })).toHaveAttribute(
      'href',
      '/recipes?resume=r-lemon',
    )

    fireEvent.click(within(c).getByRole('button', { name: 'I finished it' }))
    await waitFor(() => expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument())
    expect(getActiveCookSession()).toBeNull()
  })

  it('a meal cook-along picks up on the cook route and finishes with the meal session', async () => {
    const meal = {
      id: 'm-1',
      user_id: 'u',
      title: 'Pasta night',
      description: null,
      servings: 2,
      constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
      is_draft: false,
      source_type: 'chat',
      last_cooked_at: null,
      times_cooked: 0,
      created_at: 't',
      updated_at: 't',
      dishes: [{ role: 'main', position: 0, recipe: { ...LEMON_PASTA, id: 'd-1', steps: null } }],
    } as unknown as Meal
    startMealCookSession('m-1', ['d-1'], Date.now(), dishStepSignaturesForMeal(meal))
    mockWorld({ meal })
    renderHome()

    const c = await card()
    expect(message()).toBe('Back to the Pasta night? You were on step 1 of 7.')
    expect(within(c).getByRole('link', { name: 'Pick up at step 1' })).toHaveAttribute(
      'href',
      '/meals/m-1/cook',
    )
    fireEvent.click(within(c).getByRole('button', { name: 'I finished it' }))
    await waitFor(() => expect(getActiveMealCookSession()).toBeNull())
  })

  it('"I finished it" on a guided cook ends it in the scene too: the steam stops, no reload (#837)', async () => {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 3)
    mockWorld()
    renderHome()

    const c = await card()
    expect(screen.getByTestId('stove-steam')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Bubbly is at the stove, cooking/ })).toBeInTheDocument()

    fireEvent.click(within(c).getByRole('button', { name: 'I finished it' }))
    await waitFor(() => expect(screen.queryByTestId('stove-steam')).toBeNull())
    expect(screen.getByRole('group', { name: /Bubbly is at the stove\./ })).toBeInTheDocument()
  })

  it('"I finished it" on a meal cook-along ends it in the scene too (#837)', async () => {
    const meal = {
      id: 'm-1',
      user_id: 'u',
      title: 'Pasta night',
      description: null,
      servings: 2,
      constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
      is_draft: false,
      source_type: 'chat',
      last_cooked_at: null,
      times_cooked: 0,
      created_at: 't',
      updated_at: 't',
      dishes: [{ role: 'main', position: 0, recipe: { ...LEMON_PASTA, id: 'd-1', steps: null } }],
    } as unknown as Meal
    startMealCookSession('m-1', ['d-1'], Date.now(), dishStepSignaturesForMeal(meal))
    mockWorld({ meal })
    renderHome()

    const c = await card()
    expect(screen.getByTestId('stove-steam')).toBeInTheDocument()
    fireEvent.click(within(c).getByRole('button', { name: 'I finished it' }))
    await waitFor(() => expect(screen.queryByTestId('stove-steam')).toBeNull())
  })

  it('a recipe that cannot be fetched gives no cook card, and the next case shows', async () => {
    startGuidedCookSession('gone')
    saveCookProgress('gone', 1)
    mockWorld()
    renderHome()

    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'quiet')
  })

  describe('scanned groceries not put away', () => {
    const SCAN: ScanResult = {
      ocr_text: 'GROCERY MART',
      ready_to_add: ['Milk', 'Eggs', 'Peas'].map((name) => ({
        name,
        original_name: name,
        source_line: name,
        price: 1,
        quantity: 1,
        unit: 'item',
        category: 'other',
        location: 'fridge',
        confidence: 0.95,
      })),
      needs_review: [],
      skipped: [],
      total_items: 3,
      warnings: [],
    }

    it('says so, with Put it away (it opens the sheet) and Discard the scan', async () => {
      savePendingPutAway(pendingFromScan(SCAN))
      mockWorld()
      renderHome()

      // The sheet opens over the scene on a visit with a pending scan.
      const dialog = await screen.findByRole('dialog', { name: 'Put the shopping away?' })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      const c = await card()
      expect(message()).toBe('Shopping is waiting at the door. 3 items to put away.')
      expect(keys()).toEqual(['Discard the scan', 'Put it away'])
      fireEvent.click(within(c).getByRole('button', { name: 'Put it away' }))
      expect(await screen.findByRole('dialog', { name: 'Put the shopping away?' })).toBeInTheDocument()
    })

    it('Discard the scan asks first, then clears the scan and the card', async () => {
      savePendingPutAway(pendingFromScan(SCAN))
      mockWorld()
      renderHome()
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }),
      )
      const c = await card()

      fireEvent.click(within(c).getByRole('button', { name: 'Discard the scan' }))
      expect(message()).toBe('Discard this scan?')
      expect(readPendingPutAway()).not.toBeNull()

      // Keep it backs out.
      fireEvent.click(within(c).getByRole('button', { name: 'Keep it' }))
      expect(message()).toBe('Shopping is waiting at the door. 3 items to put away.')

      fireEvent.click(within(c).getByRole('button', { name: 'Discard the scan' }))
      fireEvent.click(within(c).getByRole('button', { name: 'Yes, discard it' }))
      await waitFor(() => expect(readPendingPutAway()).toBeNull())
      await waitFor(() => expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument())
    })

    it('a cook in progress comes before the scan', async () => {
      startGuidedCookSession('r-lemon')
      saveCookProgress('r-lemon', 3)
      savePendingPutAway(pendingFromScan(SCAN))
      mockWorld()
      renderHome()
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }),
      )
      await card()
      expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'cook')
    })
  })
})

describe("case 2: tonight's planned meal", () => {
  const plan = () =>
    savePlannedTonight({
      v: 1,
      mealId: 'm-1',
      title: 'Pasta night',
      servings: 2,
      serveAtMs: at(19),
      startAtMs: at(18, 15),
      startDish: 'Rice',
    })

  it('says when to start, with Show the timeline and Move it to tomorrow', async () => {
    plan()
    mockWorld()
    renderHome()

    const c = await card()
    expect(message()).toBe('Dinner for two at 7:00. Start the Rice at 6:15 and everything lands together.')
    expect(keys()).toEqual(['Move it to tomorrow', 'Show the timeline'])
    expect(within(c).getByRole('link', { name: 'Show the timeline' })).toHaveAttribute('href', '/meals/m-1')
  })

  it('Move it to tomorrow shifts the plan a day and the card goes for today', async () => {
    plan()
    mockWorld()
    renderHome()

    fireEvent.click(within(await card()).getByRole('button', { name: 'Move it to tomorrow' }))

    await waitFor(() => expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument())
    expect(readPlannedTonight()?.serveAtMs).toBe(new Date(2026, 9, 2, 19, 0).getTime())
  })

  it('a plan that was moved to tomorrow is not tonight', async () => {
    plan()
    const moved = readPlannedTonight()!
    savePlannedTonight({ ...moved, serveAtMs: at(19) + 86_400_000, startAtMs: at(18, 15) + 86_400_000 })
    mockWorld()
    renderHome()

    await card()
    expect(screen.getByTestId('bubbles-card')).not.toHaveAttribute('data-card-kind', 'planned')
  })
})

describe('case 3: food expires today or tomorrow', () => {
  const romaine = {
    id: 'p-r',
    name: 'romaine',
    days_until_expiry: 0,
    is_expiring_soon: true,
    expiry_date: '2026-10-01',
  }

  it('offers dinner around it, a quick one, the recent dish again, and a whole dinner', async () => {
    mockWorld({ expiring: [romaine] })
    renderHome()

    const c = await card()
    expect(message()).toBe('Your romaine needs using today. Want me to plan dinner around it?')
    expect(keys()).toEqual([
      'Dinner with the romaine',
      'Something in 20 minutes',
      'Make the Lemon pasta again',
      'Plan a whole dinner',
    ])
    expect(within(c).getByRole('link', { name: 'Dinner with the romaine' })).toHaveAttribute(
      'href',
      '/chat?plan=dinner&with=romaine',
    )
    expect(within(c).getByRole('link', { name: 'Plan a whole dinner' })).toHaveAttribute(
      'href',
      '/chat?plan=dinner',
    )
    const quick = within(c).getByRole('link', { name: 'Something in 20 minutes' })
    expect(quick.getAttribute('href')).toMatch(/^\/chat\?ask=/)
  })

  it('is skipped when expiry priority is Off', async () => {
    mockWorld({ expiring: [romaine] })
    renderHome({ initialExpiryPriority: 'off' })

    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'quiet')
    expect(screen.queryByText(/romaine/)).not.toBeInTheDocument()
  })
})

describe('case 4: mealtime, nothing urgent', () => {
  it('asks what you are in the mood for, with the ranked pills and Surprise me', async () => {
    fixClock(DINNER)
    mockWorld()
    renderHome()

    const c = await card()
    expect(message()).toBe('Dinner time! What are you in the mood for?')
    expect(keys()).toEqual([
      'Make the Lemon pasta again',
      'Something Italian tonight?',
      'Surprise me',
      'Plan a whole dinner',
    ])
    expect(within(c).getByRole('link', { name: 'Surprise me' }).getAttribute('href')).toMatch(
      /^\/chat\?ask=Surprise/,
    )
    expect(within(c).getByRole('link', { name: 'Plan a whole dinner' })).toHaveAttribute(
      'href',
      '/chat?plan=dinner',
    )
  })

  it.each([
    ['08:00', 'Breakfast time!'],
    ['12:00', 'Lunch time!'],
  ])('at %s it says %s', async (time, word) => {
    fixClock(`2026-10-01T${time}:00`)
    mockWorld()
    renderHome()
    await card()
    expect(message()).toMatch(new RegExp(`^${word}`))
  })
})

describe('an empty pantry: the first-run prompt', () => {
  it('says so with Scan receipt, and beats mealtime and the tip', async () => {
    fixClock(DINNER)
    mockWorld({ pantry: 'empty' })
    renderHome()

    const c = await card()
    expect(c).toHaveAttribute('data-card-kind', 'empty')
    expect(message()).toBe("Your kitchen's empty. Let's stock up!")
    expect(keys()).toEqual(['Add by hand', 'Scan receipt'])
    expect(within(c).getByRole('link', { name: 'Scan receipt' })).toHaveAttribute('href', '/?add=scan')
  })

  it('beats the tip between meals too', async () => {
    mockWorld({ pantry: 'empty' })
    renderHome()
    expect(await card()).toHaveAttribute('data-card-kind', 'empty')
  })

  it('a pantry that failed to load is not called empty', async () => {
    mockWorld({ pantry: 'failed' })
    renderHome()
    expect(await card()).toHaveAttribute('data-card-kind', 'quiet')
  })

  it('Not now holds for the day, and it asks again tomorrow', async () => {
    mockWorld({ pantry: 'empty' })
    const first = renderHome()
    fireEvent.click(within(await card()).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument())
    first.unmount()

    renderHome()
    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'quiet')
    jest.useRealTimers()
    cleanup()

    fixClock('2026-10-02T15:30:00')
    renderHome()
    expect(await card()).toHaveAttribute('data-card-kind', 'empty')
  })
})

describe('case 5: a quiet moment', () => {
  it("shows the daily tip, Another tip moves on, Show me how seeds the chat", async () => {
    mockWorld()
    renderHome()

    const c = await card()
    expect(message()).toBe(`Tip: ${TIP}`)
    expect(keys()).toEqual(['Another tip', 'Show me how'])
    expect(within(c).getByRole('link', { name: 'Show me how' }).getAttribute('href')).toBe(
      `/chat?${new URLSearchParams({ tip: TIP })}`,
    )

    fireEvent.click(within(c).getByRole('button', { name: 'Another tip' }))
    await waitFor(() => expect(message()).not.toBe(`Tip: ${TIP}`))
    expect(message()).toMatch(/^Tip: /)
    expect(screen.getAllByTestId('bubbles-card')).toHaveLength(1)
  })

  it('alternates with a seasonal idea the next day', async () => {
    fixClock('2026-10-02T15:30:00')
    mockWorld()
    renderHome()

    await card()
    expect(message()).toMatch(/^In season right now: .+\. Want an idea for tonight\?$/)
  })
})

describe('once a day, per nudge', () => {
  it('a nudge stays up for its visit and the next visit that day falls through', async () => {
    fixClock(DINNER)
    mockWorld()
    const first = renderHome()

    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'mealtime')
    first.unmount()

    renderHome()
    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'quiet')
  })

  // Issue #848: the way back to a cook in progress is not a once-a-day nudge.
  it('a cook in progress is still there on the next visit the same day', async () => {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 3)
    mockWorld()
    const first = renderHome()

    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'cook')
    first.unmount()

    renderHome()
    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'cook')
    expect(message()).toMatch(/Back to the .+\? You were on step 4/)
  })

  it('the next day it is fresh again', async () => {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 3)
    mockWorld()
    renderHome().unmount()

    fixClock('2026-10-02T15:30:00')
    renderHome()
    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'cook')
  })

  it('the quiet moment is never capped', async () => {
    mockWorld()
    renderHome().unmount()
    renderHome()
    await card()
    expect(message()).toBe(`Tip: ${TIP}`)
  })
})

describe('Not now', () => {
  it('a dismissed mealtime card is back tomorrow, not never', async () => {
    fixClock(DINNER)
    mockWorld()
    const first = renderHome()
    fireEvent.click(within(await card()).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument())
    first.unmount()

    // Same evening, another visit: away.
    const second = renderHome()
    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'quiet')
    second.unmount()

    // The next evening, same slot: back.
    jest.useRealTimers()
    fixClock('2026-10-02T18:30:00')
    renderHome()
    expect(await card()).toHaveAttribute('data-card-kind', 'mealtime')
  })

  it('hides the card, and it stays hidden until what it is about changes', async () => {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 3)
    mockWorld()
    const first = renderHome()

    fireEvent.click(within(await card()).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument())
    expect(JSON.parse(window.localStorage.getItem(HOME_CARD_KEY)!).dismissed).toContain(
      'cook:recipe:r-lemon:4',
    )
    first.unmount()

    // A later visit, same step: still hidden (the quiet card shows instead).
    window.localStorage.setItem(
      HOME_CARD_KEY,
      JSON.stringify({ v: 1, seen: {}, dismissed: ['cook:recipe:r-lemon:4'] }),
    )
    const second = renderHome()
    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'quiet')
    second.unmount()

    // A different step is a different nudge.
    saveCookProgress('r-lemon', 4)
    renderHome()
    await card()
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'cook')
    expect(message()).toBe('Back to the Lemon pasta? You were on step 5 of 7.')
  })

  it('the cross is a 44px target named Not now', async () => {
    mockWorld()
    renderHome()
    const x = within(await card()).getByRole('button', { name: 'Not now' })
    expect(x.className).toContain('h-11')
    expect(x.className).toContain('w-11')
  })
})

describe('one card, always', () => {
  it('a pending unlock offer takes the card\'s place, showing pixel art, and the card is not stacked', async () => {
    const picks = CATALOG.slice(0, 3)
    mockWorld({
      offer: { milestone_key: 'm25', threshold: 25, options: picks.map(({ id, name, slot, emoji }) => ({ id, name, slot, emoji })) },
    })
    const { container } = renderHome()

    const offer = await screen.findByTestId('unlock-offer')
    expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument()
    expect(within(offer).getByText(/You reached 🫧 25!/)).toBeInTheDocument()
    // The decoration's pixel art, not its emoji, where it has any.
    expect(offer.querySelectorAll('img[src^="data:image/svg"]').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelectorAll('[data-testid="bubbles-card"], [data-testid="unlock-offer"]')).toHaveLength(1)
  })

  it('an offer in the cards place does not use up the days nudge: it is not recorded as seen', async () => {
    const picks = CATALOG.slice(0, 3)
    const romaine = {
      id: 'i-1', name: 'romaine', days_until_expiry: 0, is_expiring_soon: true, expiry_date: '2026-10-01',
    }
    const offer = {
      milestone_key: 'm25', threshold: 25,
      options: picks.map(({ id, name, slot, emoji }) => ({ id, name, slot, emoji })),
    }
    mockWorld({ expiring: [romaine], offer })
    renderHome()

    await screen.findByTestId('unlock-offer')
    // Give the card every chance to be (wrongly) recorded.
    await new Promise((r) => setTimeout(r, 50))
    expect(readHomeCardRecords().seen).toEqual({})
    expect(window.localStorage.getItem(HOME_CARD_KEY)).toBeNull()

    // The offer is claimed and resolves: now the expiring card shows, and only now is it seen.
    mockWorld({ expiring: [romaine], offer: null })
    fireEvent.click(within(screen.getByTestId('unlock-offer')).getByRole('button', { name: new RegExp(picks[0].name) }))
    expect(await screen.findByText(/Your romaine needs using today/)).toBeInTheDocument()
    await waitFor(() =>
      expect(readHomeCardRecords().seen).toEqual({ 'expiring:romaine:2026-10-01': '2026-10-01' }),
    )
  })

  it('never more than one card across every situation at once', async () => {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 3)
    savePlannedTonight({
      v: 1, mealId: 'm-1', title: 'Pasta night', servings: 2,
      serveAtMs: at(19), startAtMs: at(18, 15), startDish: 'Rice',
    })
    fixClock(DINNER)
    mockWorld({
      expiring: [{ id: 'p-r', name: 'romaine', days_until_expiry: 0, is_expiring_soon: true, expiry_date: '2026-10-01' }],
    })
    renderHome()

    await card()
    await act(async () => {})
    expect(screen.getAllByTestId('bubbles-card')).toHaveLength(1)
    // The first that matches wins: the cook.
    expect(screen.getByTestId('bubbles-card')).toHaveAttribute('data-card-kind', 'cook')
  })

  it('the old always-a-recipe speech bubble and the waiting row are gone', async () => {
    mockWorld()
    renderHome()
    await card()
    expect(screen.queryByTestId('put-away-waiting')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open recipe/i })).not.toBeInTheDocument()
  })
})
