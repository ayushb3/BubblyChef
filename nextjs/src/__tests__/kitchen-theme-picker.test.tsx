/**
 * Tests for `KitchenThemePicker` (issue #523; the error-clear-on-open
 * behaviour added per the review on PR #598, finding 2).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenThemePicker from '@/components/kitchen/KitchenThemePicker'
import { KITCHEN_THEMES } from '@/lib/kitchen/themes'

const baseProps = {
  currentThemeKey: 'pastel',
  unlockedKeys: new Set(['pastel']),
  balance: 0,
  onSelect: jest.fn(),
  onOpen: jest.fn(),
}

describe('KitchenThemePicker — error lifetime (#598 review)', () => {
  it('shows the error banner while open and it is set', () => {
    render(
      <KitchenThemePicker
        {...baseProps}
        isOpen
        onClose={jest.fn()}
        error="Could not save your theme — try again"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save your theme')
  })

  it('calls clearError when the sheet opens', () => {
    const clearError = jest.fn()
    const { rerender } = render(
      <KitchenThemePicker
        {...baseProps}
        isOpen={false}
        onClose={jest.fn()}
        error={null}
        clearError={clearError}
      />,
    )
    expect(clearError).not.toHaveBeenCalled()

    rerender(
      <KitchenThemePicker
        {...baseProps}
        isOpen
        onClose={jest.fn()}
        error={null}
        clearError={clearError}
      />,
    )
    expect(clearError).toHaveBeenCalledTimes(1)
  })

  it('a stale error from a prior, already-closed attempt is gone by the time the sheet reopens', async () => {
    // Mirrors how HeroHome actually wires this: the picker calls
    // `clearError` whenever `isOpen` flips true, and the owner
    // (`useKitchenTheme`) drops `error` in response — this harness plays
    // the owner's part by wiring its own `error` state to that callback,
    // exactly as `HeroHome` wires `useKitchenTheme`'s.
    function Harness() {
      const [isOpen, setIsOpen] = React.useState(false)
      const [error, setError] = React.useState<string | null>(
        'Could not save your theme — try again',
      )
      return (
        <div>
          <button type="button" onClick={() => setIsOpen(true)} data-testid="reopen">
            reopen
          </button>
          <KitchenThemePicker
            {...baseProps}
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            error={error}
            clearError={() => setError(null)}
          />
        </div>
      )
    }
    const { rerender } = render(<Harness />)
    // Closed: the sheet itself isn't in the DOM, so there's nothing to
    // assert about the banner yet — this just documents the starting state
    // (a stale error already sitting in the owner from a prior attempt).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    screen.getByTestId('reopen').click()
    rerender(<Harness />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('KitchenThemePicker — rows', () => {
  it('renders every theme as a row', () => {
    render(
      <KitchenThemePicker {...baseProps} isOpen onClose={jest.fn()} />,
    )
    for (const theme of KITCHEN_THEMES) {
      expect(screen.getByTestId(`kitchen-theme-row-${theme.key}`)).toBeInTheDocument()
    }
  })
})
