/**
 * Issue #259 — `ScanResults` collapsed to a thin re-export of `ReviewSurface`
 * for backward compatibility with any existing import sites. This pins that
 * the alias still renders correctly rather than asserting on the full
 * behaviour (covered by scan-review.test.tsx against `ReviewSurface` itself).
 *
 * Reworked for issue #753: `ReviewSurface` is the put-away review now, so the
 * alias renders "Going in" with the item as a chip rather than the old "Ready to
 * Add" tier with an editable name field.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import ScanResults from '@/components/scan/ScanResults'
import ReviewSurface from '@/components/scan/ReviewSurface'
import type { ScannedItemWithId } from '@/lib/scan-helpers'

const ITEM: ScannedItemWithId = {
  _id: 'item-1',
  name: 'Whole Milk',
  original_name: 'whole milk',
  source_line: 'WHOLE MILK',
  price: 4.29,
  quantity: 1,
  unit: 'gallon',
  category: 'dairy',
  location: 'fridge',
  confidence: 0.92,
}

function noop() {}

it('ScanResults is the same component as ReviewSurface', () => {
  expect(ScanResults).toBe(ReviewSurface)
})

it('ScanResults renders the put-away review via the ReviewSurface alias', () => {
  render(<ScanResults readyToAdd={[ITEM]} needsReview={[]} skipped={[]} onChange={noop} />)
  expect(screen.getByRole('heading', { name: /Going in 1/ })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: /Fridge, 1 item/ })).toBeInTheDocument()
  expect(screen.getByText('Whole Milk')).toBeInTheDocument()
})
