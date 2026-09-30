/**
 * Issue #665 — only real toggles are announced as toggle buttons. `Chip`
 * renders `aria-pressed` only when its `pressed` prop is defined; `selected`
 * stays purely visual. One-shot pills (PostMessageChips, …) are plain buttons,
 * and the two multi-select cards pass `pressed` and rely on their visible
 * text as the accessible name.
 * See docs/plans/2026-09-30-meal-chat-polish-contract.md §3.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Chip from '@/components/ui/Chip'
import PostMessageChips, { type ChipConfig } from '@/components/chat/PostMessageChips'
import ClarificationCard from '@/components/chat/ClarificationCard'
import PantryProposalCard from '@/components/chat/PantryProposalCard'
import type { TermSuggestion } from '@/types/chat'

describe('Chip aria-pressed', () => {
  it('a clickable chip with no `pressed` has no aria-pressed attribute', () => {
    render(<Chip onClick={jest.fn()}>Send me</Chip>)
    expect(screen.getByRole('button', { name: 'Send me' })).not.toHaveAttribute('aria-pressed')
  })

  it('`selected` alone is visual and does not add aria-pressed', () => {
    render(
      <Chip onClick={jest.fn()} selected>
        Filled
      </Chip>,
    )
    expect(screen.getByRole('button', { name: 'Filled' })).not.toHaveAttribute('aria-pressed')
  })

  it('`pressed` renders "true" or "false"', () => {
    const { rerender } = render(
      <Chip onClick={jest.fn()} pressed>
        Toggle
      </Chip>,
    )
    expect(screen.getByRole('button', { name: 'Toggle' })).toHaveAttribute('aria-pressed', 'true')

    rerender(
      <Chip onClick={jest.fn()} pressed={false}>
        Toggle
      </Chip>,
    )
    expect(screen.getByRole('button', { name: 'Toggle' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a non-clickable chip is a span with no aria-pressed (guard)', () => {
    const { container } = render(<Chip pressed>Static</Chip>)
    const root = container.firstElementChild as HTMLElement
    expect(root.tagName).toBe('SPAN')
    expect(root).not.toHaveAttribute('aria-pressed')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('PostMessageChips', () => {
  it('renders one-shot pills as plain buttons with no aria-pressed', () => {
    const chips: ChipConfig[] = [
      { label: 'Different ideas', message: 'Show me different meal options' },
      { label: 'Quicker', message: 'Make it quicker' },
    ]
    render(<PostMessageChips chips={chips} onChipTap={jest.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b).not.toHaveAttribute('aria-pressed')
    expect(document.querySelectorAll('button[aria-pressed]')).toHaveLength(0)
  })
})

const TERMS: TermSuggestion[] = [{ term: 'milk', suggestions: ['whole milk', 'oat milk'] }]

describe('ClarificationCard pills', () => {
  it('a selected pill is aria-pressed="true", named by its visible text', () => {
    render(<ClarificationCard terms={TERMS} />)
    const pill = screen.getByRole('button', { name: 'Whole Milk' })
    expect(pill).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(pill)
    const selected = screen.getByRole('button', { name: 'Whole Milk' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    // Unselected sibling is still a toggle, still "false".
    expect(screen.getByRole('button', { name: 'Oat Milk' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('no longer carries the "Select X" / "Deselect X" label', () => {
    render(<ClarificationCard terms={TERMS} />)
    expect(screen.queryByRole('button', { name: /^select /i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Whole Milk' }))
    expect(screen.queryByRole('button', { name: /^deselect /i })).not.toBeInTheDocument()
  })
})

describe('PantryProposalCard clarification pills', () => {
  it('toggle pills carry aria-pressed and use the visible text as their name', () => {
    render(
      <PantryProposalCard
        proposal={{ actions: [] }}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        state="pending"
        clarificationTerms={TERMS}
      />,
    )
    const pill = screen.getByRole('button', { name: 'Oat Milk' })
    expect(pill).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pill)
    expect(screen.getByRole('button', { name: 'Oat Milk' })).toHaveAttribute('aria-pressed', 'true')
  })
})
