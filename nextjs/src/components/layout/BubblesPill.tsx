'use client'

import Chip from '@/components/ui/Chip'
import { useBubbles } from '@/lib/api/bubbles'

/**
 * Header pill showing the caller's lifetime bubbles balance (issue #520).
 *
 * Renders nothing while the balance is loading rather than flashing a `0`
 * that would read as "you have zero bubbles" before the real number arrives.
 */
export default function BubblesPill() {
  const { data, isLoading } = useBubbles()

  if (isLoading || !data) return null

  return (
    <Chip emoji="🫧" tone="primary">
      {data.balance}
    </Chip>
  )
}
