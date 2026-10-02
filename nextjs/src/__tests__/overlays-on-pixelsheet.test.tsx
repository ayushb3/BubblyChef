/**
 * Issue #743 — the remaining overlays (recipe edit / import / refine, the kitchen
 * theme picker, Ask Bubbly, the tour shell) sit on PixelSheet, so every sheet
 * frames, traps focus and closes the same way.
 *
 * Behaviour only: each sheet opens as a dialog with the sheet's handle and close
 * button, Escape and a scrim tap close it (unless a request is in flight), and
 * the cook-surface sheet sits above the full-screen cook flow. Plus a source
 * guard for the acceptance grep: only PixelSheet draws a backdrop and calls the
 * focus-trap hook.
 */

import fs from 'fs'
import path from 'path'
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RecipeEditModal from '@/components/recipes/RecipeEditModal'
import RecipeImportModal from '@/components/recipes/RecipeImportModal'
import RecipeRefinementModal from '@/components/recipes/RecipeRefinementModal'
import KitchenThemePicker from '@/components/kitchen/KitchenThemePicker'
import AskBubblesOverlay from '@/components/cook/AskBubblesOverlay'
import { TourProvider, useTour } from '@/components/onboarding/TourProvider'
import { TourOverlay } from '@/components/onboarding/TourOverlay'
import { TOUR_STEPS } from '@/components/onboarding/steps'

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { user_metadata: { onboarding_completed: true } } },
      }),
      updateUser: jest.fn().mockResolvedValue({}),
    },
  }),
}))
jest.mock('@/lib/api/chat', () => ({ streamChatMessage: jest.fn() }))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  })
  Element.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  document.body.style.overflow = ''
})

const RECIPE = {
  id: 'r1',
  title: 'Pasta',
  ingredients: ['pasta'],
  instructions: ['Boil'],
  tags: [],
} as never

/** The sheet chrome PixelSheet draws: handle + named 44px close button. */
function expectSheetChrome() {
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByTestId('pixel-sheet-handle')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
}

describe('recipe modals on PixelSheet', () => {
  it('edit: sheet chrome, Escape closes, and a save in flight blocks every close path', async () => {
    let finishSave!: () => void
    const onSave = jest.fn(() => new Promise<void>((r) => (finishSave = r)))
    const onClose = jest.fn()
    render(<RecipeEditModal recipe={RECIPE} onSave={onSave} onClose={onClose} />)
    expectSheetChrome()
    expect(screen.getByRole('dialog', { name: 'Edit Recipe' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => finishSave())
  })

  it('edit: a tap on the scrim closes it', () => {
    const onClose = jest.fn()
    render(<RecipeEditModal recipe={RECIPE} onSave={jest.fn()} onClose={onClose} />)
    const scrimLayer = screen.getByRole('dialog').parentElement!
    fireEvent.click(scrimLayer)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('import: sheet chrome, Escape and the close button close, the URL field is focused', () => {
    const onClose = jest.fn()
    render(<RecipeImportModal onImported={jest.fn()} onClose={onClose} />)
    expectSheetChrome()
    expect(screen.getByPlaceholderText(/Recipe page or YouTube link/)).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('import: while importing, Escape, the scrim and the close button are all blocked', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch
    const onClose = jest.fn()
    render(<RecipeImportModal onImported={jest.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText(/Recipe page or YouTube link/), {
      target: { value: 'https://example.com/r' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    })
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refine: renders nothing closed; open gives the sheet chrome and Escape closes', () => {
    const onClose = jest.fn()
    const { rerender } = render(
      <RecipeRefinementModal isOpen={false} onClose={onClose} recipe={{ title: 'Pasta' }} onSave={jest.fn()} />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <RecipeRefinementModal isOpen onClose={onClose} recipe={{ title: 'Pasta' }} onSave={jest.fn()} />,
    )
    expectSheetChrome()
    expect(screen.getByRole('dialog', { name: 'Refine with AI' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('KitchenThemePicker on PixelSheet', () => {
  const props = {
    currentThemeKey: 'pastel',
    unlockedKeys: new Set(['pastel']),
    balance: 0,
    onSelect: jest.fn(),
    onOpen: jest.fn(),
  }

  it('opens as a sheet; Escape and the scrim close; closed it renders no dialog', () => {
    const onClose = jest.fn()
    const { rerender } = render(<KitchenThemePicker {...props} isOpen={false} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<KitchenThemePicker {...props} isOpen onClose={onClose} />)
    expectSheetChrome()
    expect(screen.getByRole('dialog', { name: 'Kitchen theme' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('AskBubblesOverlay on PixelSheet', () => {
  it('is a sheet above the cook surface, keeps its name, and Escape / Back close it', () => {
    const onClose = jest.fn()
    render(<AskBubblesOverlay stepN={2} stepText="Stir" recipeTitle="Pasta" onClose={onClose} />)
    expectSheetChrome()
    const dialog = screen.getByRole('dialog', { name: 'Ask Bubbly about step 2' })
    // The cook surface is z-9990; the sheet must sit above it.
    expect(dialog.parentElement!.className).toContain('z-[9998]')
    expect(screen.getByText('Asking about step 2')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to step 2' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('TourOverlay on the sheet layer', () => {
  function Harness() {
    const { openTour } = useTour()
    React.useEffect(() => {
      openTour()
    }, [openTour])
    return (
      <div>
        {TOUR_STEPS.map((st) => (
          <div key={st.id} data-tour={st.id} />
        ))}
      </div>
    )
  }

  it('Escape skips the tour, a backdrop tap does not, and page scroll is not locked', async () => {
    await act(async () => {
      render(
        <TourProvider>
          <Harness />
          <TourOverlay />
        </TourProvider>,
      )
    })
    const dialog = await screen.findByRole('dialog', { name: /Onboarding tour step/ })
    expect(document.body.style.overflow).not.toBe('hidden')

    // A tap on the full-viewport layer is swallowed: the tour stays open.
    fireEvent.click(dialog.parentElement!)
    expect(screen.queryByRole('dialog', { name: /Onboarding tour step/ })).not.toBeNull()

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    // The tooltip fades out before it leaves the DOM.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Onboarding tour step/ })).toBeNull(),
    )
  })
})

describe('one PixelSheet (source guard)', () => {
  const root = path.join(__dirname, '..', 'components')
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name)
      return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : []
    })
  }
  const rel = (p: string) => path.relative(root, p).replace(/\\/g, '/')

  it('only PixelSheet, the tour spotlight layers and GuidedCookFlow draw a fixed inset-0 layer', () => {
    const hits = files(root)
      .filter((f) => /fixed inset-0/.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
      .sort()
    expect(hits).toEqual([
      'kitchen/PutAwayFlight.tsx', // pointer-events-none effects layer for the hop animation (#754), never a modal
      'onboarding/TourOverlay.tsx', // spotlight dim + ring (the cut-out is the tour's own)
      'recipes/GuidedCookFlow.tsx', // full-screen cook surface, not a sheet
      'ui/PixelSheet.tsx',
    ])
  })

  it('only PixelSheet and the two non-sheet traps call the modal focus-trap hook', () => {
    const hits = files(root)
      .filter((f) => /useModalFocusTrap\(/.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
      .sort()
    expect(hits).toEqual([
      'recipes/RecipeDeleteConfirm.tsx', // inline confirm row (alertdialog), not a sheet
      'ui/PixelSheet.tsx',
      'ui/ThemePicker.tsx', // anchored popover, no backdrop
    ])
  })
})
