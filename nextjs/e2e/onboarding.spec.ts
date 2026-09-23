// e2e/onboarding.spec.ts — Coach-mark onboarding tour (issue #390)
//
// Auth setup: global-setup.ts writes a storageState to e2e/.auth/user.json
// with a signed-in user. Each describe block that needs a clean first-run
// state uses an empty storageState so the TourProvider sees no existing
// Supabase session flag (anonymous sign-in middleware creates a guest on
// first page load).

import { test as authenticatedTest, expect } from './fixtures/auth'
import { test as baseTest } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helper: "no-flag" storage state — fresh guest, onboarding flag NOT set.
// ---------------------------------------------------------------------------
const freshTest = baseTest.extend({})
freshTest.use({ storageState: { cookies: [], origins: [] } })

// ---------------------------------------------------------------------------
// TC1: first-run auto-open — fresh session on '/' shows step 1 copy
// ---------------------------------------------------------------------------
freshTest.describe('onboarding / TC1: first-run auto-open', () => {
  freshTest('step 1 copy visible on fresh "/" visit', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText("Hi! I'm Bubbles, your kitchen assistant.")).toBeVisible({
      timeout: 10_000,
    })
  })
})

// ---------------------------------------------------------------------------
// TC2: Next through all 6 steps; final button reads "Done"
// ---------------------------------------------------------------------------
freshTest.describe('onboarding / TC2: full step navigation', () => {
  freshTest('next through all 6 steps; last control reads Done', async ({ page }) => {
    // Stub updateUser so the test doesn't write to real DB.
    await page.route('**/auth/v1/user**', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200, body: JSON.stringify({ user: {} }) })
      } else {
        await route.continue()
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const steps = [
      "Hi! I'm Bubbles, your kitchen assistant.",
      'Quick actions: see what to use soon, scan a receipt, or ask me anything.',
      'Your pantry lives here — tap + Add Item inside it to scan a receipt.',
      'Ask me anything about cooking, anytime.',
      'Browse and save recipes here.',
      'Your profile and settings — re-take this tour here whenever you like.',
    ]

    for (let i = 0; i < steps.length; i++) {
      await expect(page.getByText(steps[i])).toBeVisible({ timeout: 8_000 })
      if (i < steps.length - 1) {
        await page.getByRole('button', { name: 'Next' }).click()
      }
    }

    // Last step: button should read "Done"
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// TC3: Skip fires the updateUser write and closes the overlay
// ---------------------------------------------------------------------------
freshTest.describe('onboarding / TC3: skip persists flag and closes overlay', () => {
  freshTest('Skip fires updateUser PUT and overlay disappears', async ({ page }) => {
    let updateUserCalled = false

    await page.route('**/auth/v1/user**', async (route) => {
      if (route.request().method() === 'PUT') {
        updateUserCalled = true
        await route.fulfill({ status: 200, body: JSON.stringify({ user: {} }) })
      } else {
        await route.continue()
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText("Hi! I'm Bubbles, your kitchen assistant.")).toBeVisible({
      timeout: 10_000,
    })

    await page.getByRole('button', { name: 'Skip' }).click()

    await expect(
      page.getByText("Hi! I'm Bubbles, your kitchen assistant."),
    ).not.toBeVisible({ timeout: 5_000 })

    expect(updateUserCalled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TC4: Completed flag in user_metadata suppresses auto-open on /
//
// This test robustly stubs the getUser response to return
// onboarding_completed: true BEFORE the page loads, so the TourProvider
// never auto-opens. It does NOT rely on first-closing-then-reloading, which
// was fragile due to Playwright LIFO route-handler stacking.
// ---------------------------------------------------------------------------
freshTest.describe('onboarding / TC4: completed flag suppresses auto-open', () => {
  freshTest(
    'overlay absent when getUser returns onboarding_completed: true',
    async ({ page }) => {
      // Set up the stub BEFORE navigating so TourProvider's first getUser call
      // already sees the completed flag. Playwright handlers are LIFO, so
      // register this as the only handler — no continuation shadows it.
      await page.route('**/auth/v1/user**', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'test-user',
              user_metadata: { onboarding_completed: true },
              aud: 'authenticated',
              app_metadata: {},
              created_at: new Date().toISOString(),
            }),
          })
        } else {
          await route.continue()
        }
      })

      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // The tour must NOT appear — step-1 copy should be absent.
      await expect(
        page.getByText("Hi! I'm Bubbles, your kitchen assistant."),
      ).not.toBeVisible({ timeout: 5_000 })
    },
  )
})

// ---------------------------------------------------------------------------
// TC5: Profile "Take the tour" button opens tour on /
// ---------------------------------------------------------------------------
authenticatedTest.describe('onboarding / TC5: profile re-open', () => {
  authenticatedTest(
    'Take the tour on /profile navigates to / and opens overlay',
    async ({ page }) => {
      // Stub all /user requests: GET returns flag=true (suppresses auto-open on /),
      // PUT is swallowed (don't write to real DB).
      await page.route('**/auth/v1/user**', async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({ status: 200, body: JSON.stringify({ user: {} }) })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'test-user',
              user_metadata: { onboarding_completed: true },
              aud: 'authenticated',
              app_metadata: {},
              created_at: new Date().toISOString(),
            }),
          })
        }
      })

      await page.goto('/profile')
      await page.waitForLoadState('networkidle')

      const takeTourBtn = page.getByRole('button', { name: /take the tour/i })
      await expect(takeTourBtn).toBeVisible({ timeout: 8_000 })
      await takeTourBtn.click()

      // Should navigate to / and open the tour (openTour() bypasses the flag check).
      await expect(page).toHaveURL('/', { timeout: 8_000 })
      await expect(
        page.getByText("Hi! I'm Bubbles, your kitchen assistant."),
      ).toBeVisible({ timeout: 8_000 })
    },
  )
})
