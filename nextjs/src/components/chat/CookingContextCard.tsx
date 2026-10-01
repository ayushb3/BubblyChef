'use client'

import PixelPanel from '@/components/ui/PixelPanel'
import ChatCardHeader from './ChatCardHeader'

interface CookingContextCardProps {
  title: string
  ingredientCount: number
  onDismiss: () => void
  onFinishCooking?: () => void
}

/**
 * Shown at the top of the chat thread after the user starts cooking a recipe,
 * so they can see what Bubbles is answering about without scrolling back.
 *
 * Dismissible because the handoff is a convenience, not a mode the user should
 * be stuck in — dismissing also drops the ?cooking= param so a refresh does not
 * bring the card back.
 */
export default function CookingContextCard({
  title,
  ingredientCount,
  onDismiss,
  onFinishCooking,
}: CookingContextCardProps) {
  const hasBody = ingredientCount > 0 || Boolean(onFinishCooking)

  return (
    <PixelPanel entrance contentClassName="p-0" className="mb-4 mr-1">
      <ChatCardHeader
        emoji="🍳"
        eyebrow="Cooking now"
        title={title}
        divider={false}
        className={hasBody ? 'pb-1' : ''}
        trailing={
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss cooking context"
            className="-mr-2 -my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition-transform hover:text-[var(--color-text)] active:scale-95"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ✕
            </span>
          </button>
        }
      />
      {hasBody && (
        <div className="px-4 pb-3 pl-[49px]">
          {ingredientCount > 0 && (
            <p className="text-xs text-[var(--color-muted)]">
              {ingredientCount} {ingredientCount === 1 ? 'ingredient' : 'ingredients'} · ask me
              anything about it
            </p>
          )}
          {onFinishCooking && (
            <button
              type="button"
              onClick={onFinishCooking}
              className="mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-[var(--color-primary-dark)] hover:underline"
            >
              Finished cooking →
            </button>
          )}
        </div>
      )}
    </PixelPanel>
  )
}
