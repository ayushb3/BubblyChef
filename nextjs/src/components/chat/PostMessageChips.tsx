'use client'

import Chip from '@/components/ui/Chip'

interface PostMessageChipsProps {
  onTryAnother?: () => void
  onTellMore?: () => void
}

/**
 * Quick-action chips shown below the most recently settled assistant
 * message. Only ever rendered for the last message once streaming has
 * finished — see chat/page.tsx's isLastMessage wiring.
 */
export default function PostMessageChips({ onTryAnother, onTellMore }: PostMessageChipsProps) {
  if (!onTryAnother && !onTellMore) return null

  return (
    <div className="flex flex-wrap gap-2 mt-1 ml-10">
      {onTryAnother && (
        <Chip tone="accent" size="sm" emoji="🔄" onClick={onTryAnother}>
          Try another
        </Chip>
      )}
      {onTellMore && (
        <Chip tone="muted" size="sm" emoji="💬" onClick={onTellMore}>
          Tell me more
        </Chip>
      )}
    </div>
  )
}
