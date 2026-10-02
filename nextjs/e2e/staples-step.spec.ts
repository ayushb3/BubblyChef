// e2e/staples-step.spec.ts — first-run "tick what you usually have" step (issue #853)
//
// A fresh guest has no onboarding flag, so `/` opens the staples sheet before the
// tour. The pantry write and the auth-metadata writes are captured and stubbed
// here, so nothing touches the hosted DB; the real write is covered by the
// route/unit tests and the verify walk. Every AI route is blocked: this flow
// makes no AI call (category is supplied, expiry is a server-side estimate).

import { test as baseTest, expect, type Page } from '@playwright/test'

const test = baseTest.extend({})
test.use({ storageState: { cookies: [], origins: [] } })

interface Captured {
  bulkBodies: Array<{ items: Array<Record<string, unknown>> }>
  userPuts: Array<Record<string, unknown>>
}

async function stubNetwork(page: Page): Promise<Captured> {
  const captured: Captured = { bulkBodies: [], userPuts: [] }

  // The AI service's routes all sit under /v1 (Supabase's own /auth/v1/ must not match).
  await page.route(
    (url) => url.pathname.startsWith('/v1/'),
    (route) => route.fulfill({ status: 503, body: 'blocked in test' }),
  )

  await page.route('**/api/pantry/bulk', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    captured.bulkBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], count: 0 }),
    })
  })

  await page.route('**/auth/v1/user**', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    const body = route.request().postDataJSON() as { data?: Record<string, unknown> }
    captured.userPuts.push(body.data ?? {})
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })

  return captured
}

const TOUR_COPY = "Hi! I'm Bubbly, your kitchen assistant."

test.describe('first-run staples step (#853)', () => {
  test('adds exactly the ticked items, saves household size, then the tour starts', async ({
    page,
  }) => {
    const captured = await stubNetwork(page)
    await page.goto('/')

    const sheet = page.getByRole('dialog', { name: /tick what you usually have/i })
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    // The tour waits behind it.
    await expect(page.getByText(TOUR_COPY)).not.toBeVisible()

    await sheet.getByRole('button', { name: 'Olive oil' }).click()
    await sheet.getByRole('button', { name: 'Salt' }).click()
    await sheet.getByRole('button', { name: 'Eggs' }).click()
    await sheet.getByRole('button', { name: '3 people' }).click()

    await sheet.getByRole('button', { name: 'Add 3' }).click()

    await expect(page.getByText(TOUR_COPY)).toBeVisible({ timeout: 10_000 })

    expect(captured.bulkBodies).toHaveLength(1)
    const items = captured.bulkBodies[0].items
    expect(items.map((i) => i.name).sort()).toEqual(['Eggs', 'Olive oil', 'Salt'])
    expect(items.find((i) => i.name === 'Salt')).toMatchObject({ no_expiry: true })
    expect(items.find((i) => i.name === 'Eggs')).toMatchObject({ storage_location: 'fridge' })
    expect(items.find((i) => i.name === 'Eggs')?.no_expiry).toBeUndefined()

    expect(captured.userPuts).toContainEqual({ household_size: 3 })
    // The seen-flag write is fire-and-forget after the sheet closes.
    await expect.poll(() => captured.userPuts).toContainEqual({ staples_step_done: true })
  })

  test('skip adds nothing, saves nothing, and still starts the tour', async ({ page }) => {
    const captured = await stubNetwork(page)
    await page.goto('/')

    const sheet = page.getByRole('dialog', { name: /tick what you usually have/i })
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await sheet.getByRole('button', { name: 'Salt' }).click()
    await sheet.getByRole('button', { name: 'Skip for now' }).click()

    await expect(page.getByText(TOUR_COPY)).toBeVisible({ timeout: 10_000 })
    expect(captured.bulkBodies).toHaveLength(0)
    await expect.poll(() => captured.userPuts).toContainEqual({ staples_step_done: true })
    expect(captured.userPuts.some((d) => 'household_size' in d)).toBe(false)
  })
})
