/** Issue #621 — the notice naming pantry items the server refused to deduct. */

import React from 'react'
import { render, screen } from '@testing-library/react'
import SkippedDeductionsNotice from '@/components/cook/SkippedDeductionsNotice'

describe('SkippedDeductionsNotice', () => {
  it('names two items', () => {
    render(<SkippedDeductionsNotice names={['Butter', 'Flour']} unnamed={0} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't update 2 items: Butter, Flour. Check your pantry.",
    )
  })

  it('uses the singular for one item', () => {
    render(<SkippedDeductionsNotice names={['Butter']} unnamed={0} />)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't update 1 item: Butter. Check your pantry.")
  })

  it('names at most three and counts the rest', () => {
    render(<SkippedDeductionsNotice names={['Butter', 'Flour', 'Eggs', 'Milk', 'Salt']} unnamed={0} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't update 5 items: Butter, Flour, Eggs and 2 more. Check your pantry.",
    )
  })

  it('counts ids it could not name toward the total', () => {
    render(<SkippedDeductionsNotice names={['Butter']} unnamed={2} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't update 3 items: Butter and 2 more. Check your pantry.",
    )
  })

  it('still reads sensibly with only unnamed ids', () => {
    render(<SkippedDeductionsNotice names={[]} unnamed={2} />)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't update 2 items. Check your pantry.")
  })

  it('reads two same-named rows as two items, without an "and more"', () => {
    render(<SkippedDeductionsNotice names={['Butter']} unnamed={0} total={2} />)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't update 2 items: Butter. Check your pantry.")
    expect(screen.getByRole('status')).not.toHaveTextContent('more')
  })

  it('renders nothing at zero', () => {
    const { container } = render(<SkippedDeductionsNotice names={[]} unnamed={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})
