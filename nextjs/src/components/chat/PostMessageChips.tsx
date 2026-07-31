'use client'

import Chip from '@/components/ui/Chip'

export interface PostMessageChipsProps {
  /** Ask for a different answer to the same question. */
  onTryAnother?: () => void
  /** Ask Bubbles to expand on the last answer. */
  onTellMore?: () => void
}

/**
 * Contextual follow-up affordances rendered under the last settled assistant
 * message. Indentation matches the 36px mascot + gap-2 gutter beside the bubble.
 */
export default function PostMessageChips({
  onTryAnother,
  onTellMore,
}: PostMessageChipsProps) {
  if (!onTryAnother && !onTellMore) return null

  return (
    <div className="flex flex-wrap gap-2 mt-2 ml-11">
      {onTryAnother && (
        <Chip
          tone="accent"
          emoji="🔄"
          onClick={onTryAnother}
          ariaLabel="Ask for another answer"
        >
          Try another
        </Chip>
      )}
      {onTellMore && (
        <Chip
          tone="primary"
          emoji="💬"
          onClick={onTellMore}
          ariaLabel="Ask Bubbles to explain further"
        >
          Tell me more
        </Chip>
      )}
    </div>
  )
}
