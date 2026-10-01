'use client'

/**
 * Issue #653 — the cook-along's timeline sheet: a bottom sheet filled by the
 * caller with `MealTimelineTable` in clock mode. It is a `PixelSheet` (issue
 * #742), which owns the scrim, the focus trap, Escape, focus return and the
 * close button.
 */

import type { ReactNode } from 'react'
import PixelSheet from '@/components/ui/PixelSheet'

export interface MealTimelineSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export default function MealTimelineSheet({ open, onClose, children }: MealTimelineSheetProps) {
  return (
    <PixelSheet
      open={open}
      onClose={onClose}
      title="Timeline"
      titleId="meal-timeline-sheet-title"
      closeLabel="Close timeline"
      testId="meal-timeline-sheet"
      backdropTestId="meal-timeline-sheet-backdrop"
    >
      {children}
    </PixelSheet>
  )
}
