/**
 * "Resume cooking?" banner instead of silent auto-resume (PR #475).
 *
 * Before this change, `RecipeBook` reopened an in-progress guided cook the
 * instant it found a saved session (`getActiveCookSession()`), on *every*
 * mount — including a genuinely fresh visit to /recipes, forever, until the
 * cook was finished or exited. That's a surprising, forced full-screen
 * takeover on a page load that never asked for one.
 *
 * The fix: a fresh visit shows a small dismissible banner ("You were cooking
 * <title> — step N of M") with Resume/Dismiss, and only opens the guided flow
 * when Resume is tapped. A reload *in the middle* of an already-open guided
 * cook (without leaving /recipes) still restores directly into the flow, as
 * before (#441) — see `wasGuidedFlowOpen` in `lib/cook-session.ts` for the
 * "fresh visit vs. reload" rule this relies on: a `sessionStorage` flag is
 * written the instant the guided flow mounts and cleared the instant it
 * cleanly unmounts (Exit/Finish/Dismiss/navigating away); only an abrupt
 * reload skips that cleanup, leaving the flag behind for the next mount to
 * find.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
      return React.createElement(Tag, rest, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  // RecipeBook's subtree reaches for a handful of different motion.<tag>
  // elements (div/button/li/...) — a Proxy avoids enumerating every one and
  // silently breaking again the next time a component adds a new tag.
  const motion = new Proxy(
    {},
    { get: (_target, tag: string) => passthrough(tag) },
  )
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAnimation: () => ({ start: jest.fn().mockResolvedValue(undefined) }),
  }
})

jest.mock('@/lib/motion', () => ({
  useMotionConfig: () => ({
    reduced: false,
    springs: { soft: {}, snappy: {}, pop: {}, page: {} },
  }),
  springs: { soft: {}, snappy: {}, pop: {}, page: {} },
  heartPopVariants: {},
}))

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('@phosphor-icons/react', () => ({
  Heart: () => <span data-testid="icon-heart" />,
  DotsThree: () => <span data-testid="icon-dots" />,
}))

import RecipeBook from '@/components/recipes/RecipeBook'
import type { Recipe } from '@/components/recipes/RecipePage'
import { startGuidedCookSession, saveCookProgress, getActiveCookSession } from '@/lib/cook-session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// RecipeBook reads useQueryClient() (#520, to invalidate the bubbles balance), so
// it needs a QueryClientProvider to render.
function QueryWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderWithQuery(ui: React.ReactElement) {
  return render(ui, { wrapper: QueryWrapper })
}

const RECIPE: Recipe = {
  id: 'r1',
  user_id: 'u1',
  title: 'Creamy Tomato Pasta',
  description: 'Quick weeknight pasta',
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'canned tomatoes', quantity: 400, unit: 'g' },
  ],
  instructions: [
    'Boil salted water and cook pasta until al dente.',
    'Fry garlic in olive oil until fragrant.',
    'Add canned tomatoes and simmer for 8 minutes.',
  ],
  servings: 2,
} as Recipe

describe('RecipeBook — "Resume cooking?" banner (PR #475)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('a fresh visit with a saved session shows the banner, not the guided flow', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1) // step index 1 -> "step 2 of 3"

    renderWithQuery(<RecipeBook recipes={[RECIPE]} />)

    const banner = screen.getByTestId('resume-cook-banner')
    expect(within(banner).getByText(/creamy tomato pasta/i)).toBeInTheDocument()
    expect(within(banner).getByText(/step 2 of 3/i)).toBeInTheDocument()
    expect(screen.queryByTestId('guided-cook-flow')).not.toBeInTheDocument()
  })

  it('no banner and no auto-open when there is no saved session', () => {
    renderWithQuery(<RecipeBook recipes={[RECIPE]} />)
    expect(screen.queryByTestId('resume-cook-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('guided-cook-flow')).not.toBeInTheDocument()
  })

  it('tapping Resume opens the guided flow at the saved step and dismisses the banner', async () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)

    renderWithQuery(<RecipeBook recipes={[RECIPE]} />)

    fireEvent.click(screen.getByRole('button', { name: /resume/i }))

    await waitFor(() => expect(screen.getByTestId('guided-cook-flow')).toBeInTheDocument())
    expect(screen.queryByTestId('resume-cook-banner')).not.toBeInTheDocument()
    // Resumes at the persisted step (index 1 -> step 2), not the prep screen.
    expect(screen.getByTestId('guided-cook-step-2')).toBeInTheDocument()
  })

  it('tapping Dismiss clears the saved session and does not open the guided flow', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)

    renderWithQuery(<RecipeBook recipes={[RECIPE]} />)

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByTestId('resume-cook-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('guided-cook-flow')).not.toBeInTheDocument()
    expect(getActiveCookSession('r1')).toBeNull()
  })

  it('a reload mid-cook (flow already marked open in this tab) restores directly, no banner', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)
    // Simulate the guided flow having been mounted before an abrupt reload —
    // markGuidedFlowOpen was called and its cleanup never ran.
    window.sessionStorage.setItem('bubblychef:cook:guidedFlowOpen', 'r1')

    renderWithQuery(<RecipeBook recipes={[RECIPE]} />)

    expect(screen.getByTestId('guided-cook-flow')).toBeInTheDocument()
    expect(screen.queryByTestId('resume-cook-banner')).not.toBeInTheDocument()
  })
})
