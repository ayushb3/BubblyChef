import type { ReactNode } from 'react'

/**
 * The one header every structured chat card shares (issue #746, Goal 3):
 * PantryProposalCard, ClarificationCard, CookingAmendmentCard and
 * CookingContextCard each used to hand-roll an emoji + title row. They now sit
 * inside a `PixelPanel` (with `contentClassName="p-0"`) and start with this.
 *
 * Contract for the cards:
 *  - `emoji` + `emojiLabel`: the leading emoji. With a label it is announced as
 *    an image; without one it is decorative (`aria-hidden`).
 *  - `title`: the card's name. Wraps (never truncates), so it survives 200% text.
 *  - `eyebrow`: a small caps line above the title ("Cooking now").
 *  - `trailing`: right-aligned slot for a count or a dismiss button. A 44px
 *    button there can pull itself in with negative margins.
 *  - `divider`: draws the rule under the header (default true). Turn it off for
 *    a card whose header is followed by its own content with no body rule.
 *
 * Nunito only (no pixel lettering): chat cards are not part of the world.
 */
interface ChatCardHeaderProps {
  emoji: string
  emojiLabel?: string
  title: ReactNode
  eyebrow?: ReactNode
  trailing?: ReactNode
  divider?: boolean
  className?: string
}

export default function ChatCardHeader({
  emoji,
  emojiLabel,
  title,
  eyebrow,
  trailing,
  divider = true,
  className = '',
}: ChatCardHeaderProps) {
  return (
    <div
      data-chat-card-header=""
      className={[
        'flex items-center gap-2 px-4 py-3',
        divider ? 'border-b-2 border-[var(--color-border)]' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {emojiLabel ? (
        <span className="text-lg leading-none" role="img" aria-label={emojiLabel}>
          {emoji}
        </span>
      ) : (
        <span className="text-lg leading-none" aria-hidden="true">
          {emoji}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
            {eyebrow}
          </p>
        )}
        <p className="break-words text-sm font-extrabold leading-snug text-[var(--color-text)]">
          {title}
        </p>
      </div>
      {trailing}
    </div>
  )
}
