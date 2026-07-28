'use client'

import Link from 'next/link'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'

interface BubbleMessageAction {
  label: string
  href: string
}

interface BubbleMessageProps {
  children: React.ReactNode
  actions?: BubbleMessageAction[]
  delay?: number
  bubbleState?: 'happy' | 'surprised' | 'thinking'
  onDismiss?: () => void
  dismissLabel?: string
}

export default function BubbleMessage({
  children,
  actions,
  delay = 0,
  bubbleState = 'happy',
  onDismiss,
  dismissLabel = 'Not now',
}: BubbleMessageProps) {
  return (
    <FadeInView delay={delay}>
      <div className="flex gap-3 items-start">
        {/* Mascot avatar */}
        <div className="flex-shrink-0">
          <BubblesMascot size={36} animate={false} state={bubbleState} />
        </div>

        {/* Speech bubble */}
        <div
          className="flex-1 min-w-0 rounded-2xl rounded-tl-sm p-4 shadow-sm border border-[var(--color-border)]"
          style={{ background: 'var(--color-surface)' }}
        >
          <div className="text-sm text-[var(--color-text)] leading-relaxed">{children}</div>

          {/* Action buttons */}
          {(actions && actions.length > 0) || onDismiss ? (
            <div className="flex flex-wrap gap-2 mt-3">
              {actions?.map((action, i) => (
                <Link
                  key={action.href + action.label}
                  href={action.href}
                  className="focus-ring min-h-[44px] flex items-center text-xs font-semibold px-4 py-2 rounded-full transition-opacity hover:opacity-90 active:scale-95"
                  style={{
                    background: i % 2 === 0 ? 'var(--color-primary)' : 'var(--color-accent)',
                    color: 'white',
                  }}
                >
                  {action.label}
                </Link>
              ))}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="focus-ring min-h-[44px] text-xs font-semibold px-4 py-2 rounded-full transition-opacity hover:opacity-90 active:scale-95"
                  style={{
                    background: 'var(--color-border)',
                    color: 'var(--color-muted)',
                  }}
                >
                  {dismissLabel}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </FadeInView>
  )
}
