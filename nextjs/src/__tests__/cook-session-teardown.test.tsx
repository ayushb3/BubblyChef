/**
 * Issue #440 — the COOKING banner must not survive a confirmed deduction,
 * and there must be no route back into a second deduction for the same
 * recipe. Confirming a deduction ends the cook session; cancelling/closing
 * the sheet must not.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  startCookSession,
  endCookSession,
  isCookSessionEnded,
} from '@/lib/cook-session'

// ─── cook-session.ts — the persisted record itself ────────────────────────────

describe('cook-session (#440)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('a recipe with no recorded session is not considered ended', () => {
    expect(isCookSessionEnded('r1')).toBe(false)
  })

  it('endCookSession marks the recipe as ended', () => {
    endCookSession('r1')
    expect(isCookSessionEnded('r1')).toBe(true)
  })

  it('startCookSession clears a stale ended record for the same recipe', () => {
    endCookSession('r1')
    expect(isCookSessionEnded('r1')).toBe(true)
    startCookSession('r1')
    expect(isCookSessionEnded('r1')).toBe(false)
  })

  it('ending one recipe does not mark a different recipe as ended', () => {
    endCookSession('r1')
    expect(isCookSessionEnded('r2')).toBe(false)
  })

  it('is idempotent — ending an already-ended session is a no-op', () => {
    endCookSession('r1')
    endCookSession('r1')
    expect(isCookSessionEnded('r1')).toBe(true)
  })

  // ─── PR #475 code review — Bug 1: single-slot record double-deducted ──────

  it('ending recipe B does NOT un-end recipe A (regression for the reintroduced double-deduction bug)', () => {
    endCookSession('r1')
    endCookSession('r2')
    expect(isCookSessionEnded('r1')).toBe(true)
    expect(isCookSessionEnded('r2')).toBe(true)
  })

  it('ending several recipes in sequence keeps all of them ended', () => {
    endCookSession('r1')
    endCookSession('r2')
    endCookSession('r3')
    expect(isCookSessionEnded('r1')).toBe(true)
    expect(isCookSessionEnded('r2')).toBe(true)
    expect(isCookSessionEnded('r3')).toBe(true)
  })

  it('starting a fresh cook for B after ending A leaves A ended', () => {
    endCookSession('r1')
    endCookSession('r2')
    startCookSession('r2')
    expect(isCookSessionEnded('r1')).toBe(true)
    expect(isCookSessionEnded('r2')).toBe(false)
  })

  it('reads the pre-fix single-string storage format without crashing, and honours it', () => {
    window.localStorage.setItem('bubblychef:cook:endedRecipeId', 'legacy-recipe')
    expect(isCookSessionEnded('legacy-recipe')).toBe(true)
    expect(isCookSessionEnded('other-recipe')).toBe(false)
  })

  it('a corrupt stored value degrades to "nothing ended" instead of throwing', () => {
    window.localStorage.setItem('bubblychef:cook:endedRecipeId', '{not valid json at all')
    expect(() => isCookSessionEnded('r1')).not.toThrow()
    expect(isCookSessionEnded('r1')).toBe(false)

    window.localStorage.setItem('bubblychef:cook:endedRecipeId', '{"unexpected":"shape"}')
    expect(() => isCookSessionEnded('r1')).not.toThrow()
    expect(isCookSessionEnded('r1')).toBe(false)
  })

  it('caps the ended-recipe list, evicting the oldest entry first', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `r${i}`)
    ids.forEach((id) => endCookSession(id))

    // The cap is 20 — the oldest 5 (r0..r4) should have been evicted.
    for (let i = 0; i < 5; i++) {
      expect(isCookSessionEnded(`r${i}`)).toBe(false)
    }
    // The most recent 20 (r5..r24) should still be recorded as ended.
    for (let i = 5; i < 25; i++) {
      expect(isCookSessionEnded(`r${i}`)).toBe(true)
    }
  })
})

// ─── CookModal — confirm ends the session, cancel/close does not ─────────────

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const mockCookRecipe = jest.fn()
const mockConfirmCook = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  cookRecipe: (...args: unknown[]) => mockCookRecipe(...args),
  confirmCook: (...args: unknown[]) => mockConfirmCook(...args),
}))

import CookModal from '@/components/recipes/CookModal'
import type { CookProposal, IngredientMatch } from '@/types/recipes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// CookModal reads useQueryClient() (#520, to invalidate the bubbles balance), so
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

const readyMatch = (over: Partial<IngredientMatch> = {}): IngredientMatch =>
  ({
    ingredient_name: 'egg',
    pantry_item_id: 'p1',
    pantry_item_name: 'egg',
    status: 'ready',
    match_type: 'exact',
    deduct_qty: 2,
    base_unit: 'item',
    substitution_note: null,
    ...over,
  } as IngredientMatch)

const PROPOSAL: CookProposal = {
  recipe_id: 'r1',
  recipe_title: 'Omelette',
  matches: [readyMatch()],
  missing: [],
  unit_conflicts: [],
  compound_suggestions: [],
} as unknown as CookProposal

describe('CookModal — confirm vs. cancel (#440)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    mockCookRecipe.mockResolvedValue(PROPOSAL)
    mockConfirmCook.mockResolvedValue(undefined)
  })

  it('"Yes, I cooked this" ends the cook session for the recipe once the deduction confirms', async () => {
    renderWithQuery(
      <CookModal recipeId="r1" recipeTitle="Omelette" onClose={jest.fn()} onCooked={jest.fn()} />,
    )

    const confirmBtn = await screen.findByRole('button', { name: /yes, i cooked this/i })
    expect(isCookSessionEnded('r1')).toBe(false)

    fireEvent.click(confirmBtn)

    await waitFor(() => expect(mockConfirmCook).toHaveBeenCalledWith('r1', [
      { pantry_item_id: 'p1', deduct_qty: 2, base_unit: 'item' },
    ]))
    await waitFor(() => expect(isCookSessionEnded('r1')).toBe(true))
  })

  it('Cancel does not confirm the deduction and does not end the session', async () => {
    const onClose = jest.fn()
    renderWithQuery(
      <CookModal recipeId="r1" recipeTitle="Omelette" onClose={onClose} onCooked={jest.fn()} />,
    )

    const cancelBtn = await screen.findByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)

    expect(mockConfirmCook).not.toHaveBeenCalled()
    expect(isCookSessionEnded('r1')).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ─── /chat banner derivation — mirrors ChatSurface's `cookingRecipe` gate ─────
//
// ChatSurface itself pulls in useChat, streaming, and a large tree that isn't
// worth mounting here; the derivation is a pure boolean expression (see
// app/chat/page.tsx), mirrored the same way the pre-existing #268
// `endCookingSession` test above mirrors the page handler.

describe('/chat cookingRecipe banner gate (#440)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  const deriveCookingRecipe = (
    cookingRecipeId: string | null,
    dismissedRecipeId: string | null,
    loadedRecipeId: string | null,
  ): boolean =>
    Boolean(
      cookingRecipeId &&
        cookingRecipeId !== dismissedRecipeId &&
        !isCookSessionEnded(cookingRecipeId) &&
        loadedRecipeId === cookingRecipeId,
    )

  it('shows the banner for a freshly loaded, non-ended, non-dismissed session', () => {
    expect(deriveCookingRecipe('r1', null, 'r1')).toBe(true)
  })

  it('hides the banner once the session is recorded as ended, even with fresh component state', () => {
    endCookSession('r1')
    // dismissedRecipeId is null here on purpose — a brand-new mount of the
    // page (e.g. after CookModal's post-confirm redirect from /recipes) never
    // had the chance to set it locally. Only the persisted record catches it.
    expect(deriveCookingRecipe('r1', null, 'r1')).toBe(false)
  })

  it('shows the banner again once a fresh session is started for the same recipe', () => {
    endCookSession('r1')
    startCookSession('r1')
    expect(deriveCookingRecipe('r1', null, 'r1')).toBe(true)
  })

  it('leaves a different, still-active recipe session alone', () => {
    endCookSession('r1')
    expect(deriveCookingRecipe('r2', null, 'r2')).toBe(true)
  })
})
