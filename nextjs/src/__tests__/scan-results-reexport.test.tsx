/**
 * Issue #259 — `ScanResults` collapsed to a thin re-export of `ReviewSurface`
 * for backward compatibility with any existing import sites. This pins that
 * the alias still renders correctly rather than asserting on the full
 * behaviour (covered by scan-review.test.tsx against `ReviewSurface` itself).
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import ScanResults from '@/components/scan/ScanResults'
import ReviewSurface from '@/components/scan/ReviewSurface'
import type { ScannedItem } from '@/types/scan'

const ITEM: ScannedItem = {
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

it('ScanResults renders the tiered review UI via the ReviewSurface alias', () => {
  render(
    <ScanResults
      readyToAdd={[ITEM]}
      needsReview={[]}
      skipped={[]}
      onReadyChange={noop}
      onReviewChange={noop}
      onSkippedChange={noop}
      onConfirm={noop}
      isSubmitting={false}
    />,
  )
  expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument()
  expect(screen.getByDisplayValue('Whole Milk')).toBeInTheDocument()
})
