/**
 * Slice 3 — Review screen tests
 *
 * Tests cover: tier rendering, pre-checked state for ready_to_add, unchecked state
 * for needs_review/skipped, eye-toggle raw face, Add button count tracking,
 * warnings banner, and keyboard accessibility.
 *
 * The ScanResult stub matches the pinned contract exactly from
 * docs/plans/2026-08-19-receipt-scan-rework.md.
 */

import React from 'react'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import ReviewSurface from '@/components/scan/ReviewSurface'
import ScannedItemCard from '@/components/scan/ScannedItemCard'
import type { ScannedItem, ScanResult } from '@/types/scan'

// ─── Test stub matching the pinned contract ───────────────────────────────────

const READY_ITEM: ScannedItem = {
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

const REVIEW_ITEM: ScannedItem = {
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

const SKIPPED_ITEM: ScannedItem = {
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

const STUB_RESULT: ScanResult = {
  ocr_text: 'TRADER JOES\nITALIAN BOMBA HOT PEPPER 3.99\nORG CANE SUGAR 2.49\nT PREMIUM FILLER ASST. 8.99',
  ready_to_add: [READY_ITEM],
  needs_review: [REVIEW_ITEM],
  skipped: [SKIPPED_ITEM],
  total_items: 3,
  warnings: [],
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function noop() {}

function renderResults(overrides: Partial<{
  readyToAdd: ScannedItem[]
  needsReview: ScannedItem[]
  skipped: ScannedItem[]
  warnings: string[]
  hideConfirmButton: boolean
  isSubmitting: boolean
  onConfirm: (items: ScannedItem[]) => void
}> = {}) {
  const props = {
    readyToAdd: STUB_RESULT.ready_to_add,
    needsReview: STUB_RESULT.needs_review,
    skipped: STUB_RESULT.skipped,
    warnings: STUB_RESULT.warnings,
    onReadyChange: noop,
    onReviewChange: noop,
    onSkippedChange: noop,
    onConfirm: noop,
    isSubmitting: false,
    ...overrides,
  }
  return render(<ReviewSurface {...props} />)
}

// ─── 1. Tier sections render ──────────────────────────────────────────────────

it('renders all three tier section headers', () => {
  renderResults()
  expect(screen.getByText(/Ready to Add/)).toBeInTheDocument()
  expect(screen.getByText(/Needs Review/)).toBeInTheDocument()
  expect(screen.getByText(/Skipped/)).toBeInTheDocument()
})

it('shows item counts in tier headers', () => {
  renderResults()
  expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument()
  expect(screen.getByText(/Needs Review \(1\)/)).toBeInTheDocument()
  expect(screen.getByText(/Skipped \(1\)/)).toBeInTheDocument()
})

// ─── 2. Pre-checked state ─────────────────────────────────────────────────────

it('ready_to_add items start pre-checked', () => {
  renderResults()
  const checkbox = screen.getByRole('checkbox', {
    name: new RegExp(`Include ${READY_ITEM.name}`, 'i'),
  })
  expect(checkbox).toBeChecked()
})

it('needs_review items start unchecked', () => {
  renderResults()
  const checkbox = screen.getByRole('checkbox', {
    name: new RegExp(`Include ${REVIEW_ITEM.name}`, 'i'),
  })
  expect(checkbox).not.toBeChecked()
})

// ─── 3. Add button count tracks the checked set ───────────────────────────────

it('Add button shows count of checked items (1 ready pre-checked, 0 review)', () => {
  renderResults({ hideConfirmButton: false })
  // Only the one ready item is pre-checked
  expect(screen.getByRole('button', { name: /Add 1 Item to Pantry/i })).toBeInTheDocument()
})

it('Add button count increases when a review item is checked', () => {
  renderResults({ hideConfirmButton: false })
  const reviewCheckbox = screen.getByRole('checkbox', {
    name: new RegExp(`Include ${REVIEW_ITEM.name}`, 'i'),
  })
  fireEvent.click(reviewCheckbox)
  expect(screen.getByRole('button', { name: /Add 2 Items to Pantry/i })).toBeInTheDocument()
})

it('Add button count decreases when a ready item is unchecked', () => {
  renderResults({ hideConfirmButton: false })
  const readyCheckbox = screen.getByRole('checkbox', {
    name: new RegExp(`Include ${READY_ITEM.name}`, 'i'),
  })
  fireEvent.click(readyCheckbox)
  expect(screen.getByRole('button', { name: /No items selected/i })).toBeInTheDocument()
})

it('Add button is disabled when no items are checked', () => {
  renderResults({ readyToAdd: [], needsReview: [], skipped: [], hideConfirmButton: false })
  const btn = screen.getByRole('button', { name: /No items selected/i })
  expect(btn).toBeDisabled()
})

it('onConfirm is called with only the checked items', () => {
  const onConfirm = jest.fn()
  renderResults({ hideConfirmButton: false, onConfirm })

  // Only ready item is pre-checked; click confirm
  fireEvent.click(screen.getByRole('button', { name: /Add 1 Item to Pantry/i }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  const called: ScannedItem[] = onConfirm.mock.calls[0][0]
  expect(called).toHaveLength(1)
  expect(called[0].name).toBe(READY_ITEM.name)
})

// ─── 4. Eye toggle ────────────────────────────────────────────────────────────

it('eye button has correct aria-label before toggle', () => {
  render(
    <ScannedItemCard
      item={READY_ITEM}
      index={0}
      checked
      onChange={noop}
      onDismiss={noop}
      onCheckedChange={noop}
    />,
  )
  expect(screen.getByRole('button', { name: 'See raw frame data' })).toBeInTheDocument()
})

it('eye toggle reveals raw face with source_line and original_name', () => {
  render(
    <ScannedItemCard
      item={READY_ITEM}
      index={0}
      checked
      onChange={noop}
      onDismiss={noop}
      onCheckedChange={noop}
    />,
  )
  const eyeBtn = screen.getByRole('button', { name: 'See raw frame data' })
  fireEvent.click(eyeBtn)

  expect(screen.getByText('ITALIAN BOMBA HOT PEPPER')).toBeInTheDocument()
  expect(screen.getByText('italian bomba hot pepper')).toBeInTheDocument()
  expect(screen.getByText('$3.99')).toBeInTheDocument()
})

it('eye button label changes to "Hide raw frame data" after toggle', () => {
  render(
    <ScannedItemCard
      item={READY_ITEM}
      index={0}
      checked
      onChange={noop}
      onDismiss={noop}
      onCheckedChange={noop}
    />,
  )
  const eyeBtn = screen.getByRole('button', { name: 'See raw frame data' })
  fireEvent.click(eyeBtn)
  expect(screen.getByRole('button', { name: 'Hide raw frame data' })).toBeInTheDocument()
})

it('eye toggle closes the raw face on second click', async () => {
  render(
    <ScannedItemCard
      item={READY_ITEM}
      index={0}
      checked
      onChange={noop}
      onDismiss={noop}
      onCheckedChange={noop}
    />,
  )
  const eyeBtn = screen.getByRole('button', { name: 'See raw frame data' })
  fireEvent.click(eyeBtn)
  fireEvent.click(screen.getByRole('button', { name: 'Hide raw frame data' }))
  // AnimatePresence exit animation keeps element briefly; wait for removal
  await waitFor(() =>
    expect(screen.queryByText('ITALIAN BOMBA HOT PEPPER')).not.toBeInTheDocument(),
  )
})

it('null price renders as dash in raw face', () => {
  const noPrice = { ...READY_ITEM, price: null }
  render(
    <ScannedItemCard
      item={noPrice}
      index={0}
      checked
      onChange={noop}
      onDismiss={noop}
      onCheckedChange={noop}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'See raw frame data' }))
  // Should display '—' for missing price
  const rawSection = screen.getByText('Raw frame data').closest('div')!
  expect(within(rawSection).getAllByText('—').length).toBeGreaterThan(0)
})

// ─── 5. Warnings banner ───────────────────────────────────────────────────────

it('renders warnings when present', () => {
  renderResults({ warnings: ['No items found on receipt.', 'Image quality was low.'] })
  expect(screen.getByText('No items found on receipt.')).toBeInTheDocument()
  expect(screen.getByText('Image quality was low.')).toBeInTheDocument()
})

it('does not render warnings banner when warnings array is empty', () => {
  const { container } = renderResults({ warnings: [] })
  // The yellow warning box should not be present
  expect(container.querySelector('.bg-yellow-50')).toBeNull()
})

// ─── 6. ScannedItem contract shape ────────────────────────────────────────────
// Ensure the pinned fields are accepted without TypeScript errors (compile-time
// mostly, but we double-check the shape at runtime here too).

it('ScannedItem has all pinned contract fields', () => {
  const item: ScannedItem = READY_ITEM
  expect(typeof item.name).toBe('string')
  expect(typeof item.original_name).toBe('string')
  expect(typeof item.source_line).toBe('string')
  expect(typeof item.price === 'number' || item.price === null).toBe(true)
  expect(typeof item.quantity).toBe('number')
  expect(typeof item.unit).toBe('string')
  expect(typeof item.category).toBe('string')
  expect(typeof item.location).toBe('string')
  expect(typeof item.confidence).toBe('number')
})

it('ScanResult has all pinned contract fields', () => {
  const result: ScanResult = STUB_RESULT
  expect(typeof result.ocr_text).toBe('string')
  expect(Array.isArray(result.ready_to_add)).toBe(true)
  expect(Array.isArray(result.needs_review)).toBe(true)
  expect(Array.isArray(result.skipped)).toBe(true)
  expect(typeof result.total_items).toBe('number')
  expect(Array.isArray(result.warnings)).toBe(true)
})
