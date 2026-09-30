/**
 * Issue #621 — CookModal names the pantry items the server refused to deduct
 * (`deductions_skipped`), pauses the auto-redirect while the notice shows, and
 * routes every exit (Continue, ✕, backdrop, Escape) through the same hand-off
 * the redirect timer performs, exactly once.
 */

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CookModal from '@/components/recipes/CookModal'
import type { CookProposal } from '@/types/recipes'

jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
      return React.createElement(Tag, rest, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) })
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  }
})

const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
jest.mock('@/lib/api/recipes', () => ({
  cookRecipe: jest.fn(),
  confirmCook: jest.fn(),
}))

const { cookRecipe, confirmCook } = jest.requireMock('@/lib/api/recipes') as {
  cookRecipe: jest.Mock
  confirmCook: jest.Mock
}

const PROPOSAL = {
  recipe_id: 'r1',
  recipe_title: 'Buttery Toast',
  matches: [
    {
      ingredient_name: 'butter',
      ingredient_qty: 20,
      ingredient_unit: 'g',
      pantry_item_id: 'p-butter',
      pantry_item_name: 'Butter',
      pantry_qty_available: 200,
      deduct_qty: 20,
      base_unit: 'g',
      status: 'ready',
      shortfall: null,
      match_type: 'exact',
      substitution_note: null,
    },
  ],
  missing: [],
  unit_conflicts: [],
  compound_suggestions: [],
} as unknown as CookProposal

function renderModal(props: Partial<React.ComponentProps<typeof CookModal>> = {}) {
  const onClose = jest.fn()
  const onCooked = jest.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CookModal
        recipeId="r1"
        recipeTitle="Buttery Toast"
        onClose={onClose}
        onCooked={onCooked}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onClose, onCooked }
}

async function confirm() {
  fireEvent.click(await screen.findByRole('button', { name: /yes, i cooked this/i }))
  await screen.findByText(/pantry updated/i)
}

function resolveConfirm(deductions_skipped: string[] | undefined) {
  confirmCook.mockResolvedValue(
    deductions_skipped === undefined
      ? undefined
      : { success: true, deductions_applied: 0, deductions_requested: 1, deductions_skipped },
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  // endCookSession('r1') persists on a successful confirm (#440) and would
  // short-circuit the next test's confirm before confirmCook is called.
  window.localStorage.clear()
  cookRecipe.mockResolvedValue(PROPOSAL)
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('CookModal — skipped deductions (issue #621)', () => {
  it('names the refused item in the success state and hides the "taking you to chat" line', async () => {
    resolveConfirm(['p-butter'])
    renderModal()
    await confirm()
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't update 1 item: Butter. Check your pantry.")
    expect(screen.queryByText(/taking you to chat/i)).not.toBeInTheDocument()
  })

  it('moves focus to Continue when the notice appears', async () => {
    resolveConfirm(['p-butter'])
    renderModal()
    await confirm()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
  })

  it('schedules no redirect when the confirm resolves after the modal unmounted', async () => {
    let resolve!: (v: unknown) => void
    confirmCook.mockReturnValue(new Promise((r) => { resolve = r }))
    const { onCooked } = renderModal()
    fireEvent.click(await screen.findByRole('button', { name: /yes, i cooked this/i }))
    cleanup() // the modal closed while the request was in flight
    await act(async () => {
      resolve({ success: true, deductions_applied: 1, deductions_requested: 1, deductions_skipped: [] })
    })
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(push).not.toHaveBeenCalled()
    expect(onCooked).not.toHaveBeenCalled()
  })

  it('does not auto-redirect; Continue hands off to chat', async () => {
    resolveConfirm(['p-butter'])
    const { onClose, onCooked } = renderModal()
    await confirm()
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onCooked).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/chat?cooking=r1')
  })

  it('the close button runs the same hand-off', async () => {
    resolveConfirm(['p-butter'])
    const { onClose, onCooked } = renderModal()
    await confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onCooked).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/chat?cooking=r1')
  })

  it('Escape runs the same hand-off', async () => {
    resolveConfirm(['p-butter'])
    const { onClose, onCooked } = renderModal()
    await confirm()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCooked).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/chat?cooking=r1')
  })

  it('Continue then Escape calls onCooked once', async () => {
    resolveConfirm(['p-butter'])
    const { onClose, onCooked } = renderModal()
    await confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCooked).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('a draft with the notice keeps its own exits: the close button only calls onClose', async () => {
    resolveConfirm(['p-butter'])
    const { onClose, onCooked } = renderModal({ isDraft: true, onAddToLibrary: jest.fn() })
    await confirm()
    expect(screen.getByRole('status')).toHaveTextContent('Butter')
    expect(screen.getByText(/to your library\?/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCooked).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('an empty skipped list keeps today\'s auto-redirect and shows no notice', async () => {
    resolveConfirm([])
    const { onClose, onCooked } = renderModal()
    await confirm()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(/taking you to chat/i)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(onCooked).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/chat?cooking=r1')
  })

  it('a confirm that resolves nothing still redirects', async () => {
    resolveConfirm(undefined)
    renderModal()
    await confirm()
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(push).toHaveBeenCalledWith('/chat?cooking=r1')
  })

  it('counts a refused id it cannot name', async () => {
    resolveConfirm(['p-unknown'])
    renderModal()
    await confirm()
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't update 1 item. Check your pantry.")
  })
})
