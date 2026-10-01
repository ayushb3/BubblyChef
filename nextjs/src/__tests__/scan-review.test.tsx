/**
 * Slice 3 — Review screen tests; rewritten for issue #753.
 *
 * `ReviewSurface` is still the one presentation-only receipt review, mounted by
 * put-away. Its tiers are the same, regrouped by place and worded as putting the
 * shopping away: needs review is "Did I read these right?", ready is "Going in"
 * (by place), skipped is "Skipped N lines". The checkbox model is gone with the
 * old look (an item is in unless it is left out), so the tests that pinned the
 * pre-checked state, the "Add N Items to Pantry" count, `onCheckedItemsChange`
 * and the eye toggle's raw face were retired; the PR names them. What each one
 * protected is covered here or in kitchen-putaway-sheet.test.tsx:
 *
 *   tier headers and counts      -> "tier sections" below
 *   needs-review asked, ready in -> "tier sections" below, and Yes/Fix there
 *   count tracks what goes in    -> the sheet's key count (leave out, Yes, add back)
 *   raw receipt line visible     -> "the card shows the receipt line" below
 *   warnings banner              -> "warnings" below
 *
 * The ScanResult stubs match the pinned contract from
 * docs/plans/2026-08-19-receipt-scan-rework.md.
 */

import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import ReviewSurface, { type PutAwayTiers } from '@/components/scan/ReviewSurface'
import ScannedItemCard from '@/components/scan/ScannedItemCard'
import type { ScannedItemWithId } from '@/lib/scan-helpers'

const READY_ITEM: ScannedItemWithId = {
  _id: 'ready-1',
  name: 'Italian Bomba Hot Pepper Spread',
  original_name: 'italian bomba hot pepper',
  source_line: 'ITALIAN BOMBA HOT PEPPER',
  price: 3.99,
  quantity: 1,
  unit: 'jar',
  category: 'condiments',
  location: 'pantry',
  confidence: 0.92,
}

const REVIEW_ITEM: ScannedItemWithId = {
  _id: 'review-1',
  name: 'Organic Cane Sugar',
  original_name: 'org cane sugar',
  source_line: 'ORG CANE SUGAR',
  price: 2.49,
  quantity: 1,
  unit: 'bag',
  category: 'dry_goods',
  location: 'pantry',
  confidence: 0.65,
}

const SKIPPED_ITEM: ScannedItemWithId = {
  _id: 'skipped-1',
  name: 'T Premium Filler Assortment',
  original_name: 't premium filler asst',
  source_line: 'T PREMIUM FILLER ASST.',
  price: 8.99,
  quantity: 1,
  unit: 'bunch',
  category: 'dry_goods',
  location: 'pantry',
  confidence: 0.35,
}

function noop() {}

function renderSurface(
  overrides: Partial<{
    readyToAdd: ScannedItemWithId[]
    needsReview: ScannedItemWithId[]
    skipped: ScannedItemWithId[]
    warnings: string[]
    disabled: boolean
    onChange: (next: PutAwayTiers) => void
  }> = {},
) {
  return render(
    <ReviewSurface
      readyToAdd={[READY_ITEM]}
      needsReview={[REVIEW_ITEM]}
      skipped={[SKIPPED_ITEM]}
      onChange={noop}
      {...overrides}
    />,
  )
}

describe('tier sections', () => {
  it('names the three tiers and counts them', () => {
    renderSurface()
    expect(screen.getByRole('heading', { name: /Did I read these right\? 1/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Going in 1/ })).toBeInTheDocument()
    expect(screen.getByText(/Skipped 1 line:/)).toBeInTheDocument()
  })

  it('shows only the tiers that have something in them', () => {
    renderSurface({ needsReview: [], skipped: [] })
    expect(screen.queryByRole('heading', { name: /Did I read these right/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Skipped/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Going in 1/ })).toBeInTheDocument()
  })

  it('files Going in under the place each item is headed to', () => {
    renderSurface({ needsReview: [], skipped: [] })
    expect(screen.getByRole('group', { name: /Shelves, 1 item/ })).toBeInTheDocument()
  })
})

describe('the card shows the receipt line', () => {
  it('shows the raw line the item was read from, and where it is headed', () => {
    renderSurface()
    const card = screen.getByRole('listitem', { name: 'Organic Cane Sugar' })
    expect(within(card).getByText('ORG CANE SUGAR')).toBeInTheDocument()
    expect(within(card).getByText('→ Shelves')).toBeInTheDocument()
    expect(within(card).getByText('Organic Cane Sugar · 1 bag')).toBeInTheDocument()
  })

  it('has no receipt line row when the item has none', () => {
    render(
      <ul>
        <ScannedItemCard
          item={{ ...REVIEW_ITEM, source_line: '' }}
          editing={false}
          onFix={noop}
          onYes={noop}
          onChange={noop}
          onLeaveOut={noop}
        />
      </ul>,
    )
    expect(screen.queryByText('ORG CANE SUGAR')).not.toBeInTheDocument()
  })
})

describe('changes go out whole, through onChange', () => {
  it('Yes moves the item from needs-review to ready, leaving skipped alone', () => {
    const onChange = jest.fn()
    renderSurface({ onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Organic Cane Sugar is right' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next: PutAwayTiers = onChange.mock.calls[0][0]
    expect(next.needsReview).toEqual([])
    expect(next.readyToAdd.map((i) => i._id)).toEqual(['ready-1', 'review-1'])
    expect(next.skipped.map((i) => i._id)).toEqual(['skipped-1'])
  })

  it('moving an item to another place changes only its location', () => {
    const onChange = jest.fn()
    renderSurface({ onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Fix Organic Cane Sugar' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Fridge' }))
    const next: PutAwayTiers = onChange.mock.calls[0][0]
    expect(next.needsReview[0]).toEqual({ ...REVIEW_ITEM, location: 'fridge' })
  })

  it('locks every control while a write is in flight', () => {
    renderSurface({ disabled: true })
    expect(screen.getByRole('button', { name: 'Fix Organic Cane Sugar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Yes, Organic Cane Sugar is right' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit Shelves items' })).toBeDisabled()
  })
})

describe('warnings', () => {
  it('renders warnings when present', () => {
    renderSurface({ warnings: ['No items found on receipt.', 'Image quality was low.'] })
    expect(screen.getByText('No items found on receipt.')).toBeInTheDocument()
    expect(screen.getByText('Image quality was low.')).toBeInTheDocument()
  })

  it('does not render a warnings banner when there are none', () => {
    renderSurface({ warnings: [] })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
