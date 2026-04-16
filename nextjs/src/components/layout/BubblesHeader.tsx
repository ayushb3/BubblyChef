'use client'

import BubblesMascot from '@/components/ui/BubblesMascot'

interface BubblesHeaderProps {
  showSubtitle?: boolean
  rightSlot?: React.ReactNode
  mascotState?: 'happy' | 'thinking' | 'surprised'
  mascotAnimate?: boolean
}

export default function BubblesHeader({
  showSubtitle = false,
  rightSlot,
  mascotState = 'happy',
  mascotAnimate = false,
}: BubblesHeaderProps) {
  return (
    <div className="p-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-[var(--color-border)]">
      <BubblesMascot state={mascotState} size={36} animate={mascotAnimate} />
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-extrabold text-[var(--color-text)] leading-tight">
          Bubbles
        </h1>
        {showSubtitle && (
          <p className="text-xs text-[var(--color-muted)]">Your AI kitchen assistant</p>
        )}
      </div>
      {rightSlot && <div className="flex-shrink-0">{rightSlot}</div>}
    </div>
  )
}
