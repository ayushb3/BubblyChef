/**
 * Issue #490 (library half) + #489 — the recipe library's guided cook shows and
 * deducts the amended list when a chat amendment is on record for the recipe
 * being cooked, and a saved library recipe is never changed by it.
 *
 * The reload is the same one recipe-book-resume-banner.test.tsx uses: the flow
 * was marked open in this tab, and the step position is persisted (#441).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
      const { initial: _i, animate: _a, transition: _t, exit: _e, ...safe } = rest as Record<string, unknown>
      return React.createElement(Tag, safe, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_target, tag: string) => passthrough(tag) })
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAnimation: () => ({ start: jest.fn().mockResolvedValue(undefined) }),
    useReducedMotion: () => false,
  }
})

jest.mock('@/lib/motion', () => ({
  // BubblesMascot's thinking flip-book (#887) reads this; a fixed frame keeps these tests timer-free.
  useSteppedFrame: () => 0,
  useMotionConfig: () => ({ reduced: false, springs: { soft: {}, snappy: {}, pop: {}, page: {} } }),
  springs: { soft: {}, snappy: {}, pop: {}, page: {} },
  heartPopVariants: {},
}))

jest.mock('@/lib/api/chat', () => ({ streamChatMessage: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock('@phosphor-icons/react', () => ({
  Heart: () => <span data-testid="icon-heart" />,
  DotsThree: () => <span data-testid="icon-dots" />,
}))

const cookRecipe = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  cookRecipe: (...args: unknown[]) => cookRecipe(...args),
  confirmCook: jest.fn(),
}))

import RecipeBook from '@/components/recipes/RecipeBook'
import type { Recipe } from '@/components/recipes/RecipePage'
import {
  startGuidedCookSession,
  saveCookProgress,
  saveAmendedCook,
  getAmendedIngredients,
} from '@/lib/cook-session'

function QueryWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const RECIPE: Recipe = {
  id: 'r1',
  user_id: 'u1',
  title: 'Creamy Tomato Garlic Pasta',
  description: 'Quick weeknight pasta',
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'heavy cream', quantity: 150, unit: 'ml' },
  ],
  instructions: ['Boil the pasta.', 'Stir in the cream.', 'Serve.'],
  servings: 2,
} as Recipe

const ROUX = [
  { name: 'pasta', quantity: 200, unit: 'g' },
  { name: 'butter', quantity: 30, unit: 'g' },
  { name: 'flour', quantity: 30, unit: 'g' },
]

function reloadMidGuidedCook(step: number) {
  startGuidedCookSession('r1')
  saveCookProgress('r1', step)
  saveAmendedCook('r1', { title: RECIPE.title, ingredients: ROUX })
  window.sessionStorage.setItem('bubblychef:cook:guidedFlowOpen', 'r1')
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  cookRecipe.mockReturnValue(new Promise(() => {}))
})

describe('guided cook after a reload, with an amendment on record (#490)', () => {
  it('restores the step AND the amended ingredients on the prep screen', () => {
    reloadMidGuidedCook(-1)
    render(<RecipeBook recipes={[RECIPE]} />, { wrapper: QueryWrapper })

    const prep = screen.getByTestId('guided-cook-prep')
    expect(within(prep).getByText(/butter/i)).toBeInTheDocument()
    expect(within(prep).getByText(/flour/i)).toBeInTheDocument()
    expect(within(prep).queryByText(/cream/i)).not.toBeInTheDocument()
  })

  it('"Update my pantry" deducts against the amended list', async () => {
    reloadMidGuidedCook(3) // past the last step: the done screen
    render(<RecipeBook recipes={[RECIPE]} />, { wrapper: QueryWrapper })

    fireEvent.click(screen.getByTestId('guided-cook-deduct'))

    await waitFor(() => expect(cookRecipe).toHaveBeenCalledTimes(1))
    const [id, ingredients] = cookRecipe.mock.calls[0]
    expect(id).toBe('r1')
    expect((ingredients as { name: string }[]).map((i) => i.name)).toEqual(['pasta', 'butter', 'flour'])
  })

  it('does not change the saved recipe: the amendment is an overlay on what is cooked', () => {
    reloadMidGuidedCook(-1)
    render(<RecipeBook recipes={[RECIPE]} />, { wrapper: QueryWrapper })
    expect(RECIPE.ingredients.map((i) => (i as { name: string }).name)).toEqual(['pasta', 'heavy cream'])
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
  })

  it('with no amendment on record, the guided flow and the deduction are exactly as before', async () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 3)
    window.sessionStorage.setItem('bubblychef:cook:guidedFlowOpen', 'r1')
    render(<RecipeBook recipes={[RECIPE]} />, { wrapper: QueryWrapper })

    fireEvent.click(screen.getByTestId('guided-cook-deduct'))
    await waitFor(() => expect(cookRecipe).toHaveBeenCalledTimes(1))
    expect(cookRecipe.mock.calls[0][1]).toBeUndefined()
  })
})
