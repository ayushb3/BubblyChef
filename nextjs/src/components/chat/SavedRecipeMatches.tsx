'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { springs } from '@/lib/motion'
import type { SavedRecipeMatch } from '@/types/chat'

export interface SavedRecipeMatchesProps {
  /** The saved-recipe matches this turn returned, in backend-ranked order. */
  matches: SavedRecipeMatch[]
  /** Called with the match the user tapped (many-match branch only). */
  onSelect: (match: SavedRecipeMatch) => void
  /**
   * When true the cards render statically without pointer interaction
   * (applied to older assistant messages that are no longer the last
   * settled reply — same rule BrainstormOptions applies).
   */
  disabled?: boolean
}

/**
 * Renders saved-recipe search results as tappable cards (issue #494), robust
 * to whatever count the backend returns:
 *
 * - **Zero** matches → renders nothing; the assistant's prose ("none found —
 *   want me to make one?") stands alone with the existing chips.
 * - **One** match → a single card with an Open recipe link (library entry)
 *   and a Cook this button. Both the single card's Cook this button and
 *   every many-match tap call the *same* `onSelect` callback — there is
 *   exactly one place (`handlePickSavedRecipe` in `app/chat/page.tsx`) that
 *   decides what picking a saved recipe does (start the cook session, clear
 *   a stale dismissal, pin via `?cooking=<id>`), so the two entry points
 *   cannot drift out of sync the way they did across PR #614's review
 *   rounds — round 2 fixed the ended-cook-record gap in only one of the two
 *   paths, and round 3's dismiss fix repeated the same split-brain mistake.
 * - **Many** matches → a ranked list of tappable mini cards, shaped like
 *   BrainstormOptions. Tapping one calls `onSelect` with the match; the
 *   caller acts on it by id, not by re-sending the title as chat text.
 */
export default function SavedRecipeMatches({
  matches,
  onSelect,
  disabled = false,
}: SavedRecipeMatchesProps) {
  if (matches.length === 0) return null

  if (matches.length === 1) {
    return <SingleMatchCard match={matches[0]} onSelect={onSelect} disabled={disabled} />
  }

  return (
    <div
      className="flex flex-col gap-2 w-full max-w-[85%]"
      role="list"
      aria-label="Saved recipes — tap one to pick it"
    >
      {matches.map((match, i) => (
        <motion.button
          key={match.id}
          type="button"
          role="listitem"
          aria-label={`Pick ${match.title}`}
          disabled={disabled}
          onClick={() => !disabled && onSelect(match)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.snappy, delay: i * 0.07 }}
          whileTap={disabled ? undefined : { scale: 0.97 }}
          className={[
            'rounded-2xl bg-[var(--color-surface)] border border-[var(--color-accent)] shadow-sm overflow-hidden',
            'w-full text-left',
            disabled
              ? 'cursor-default opacity-70'
              : 'cursor-pointer hover:brightness-97 active:brightness-90',
          ].join(' ')}
        >
          <div className="bg-[var(--color-accent)]/55 px-4 py-2.5 flex items-center justify-between gap-3">
            <h4 className="text-[var(--color-text)] font-bold text-sm leading-snug flex-1">
              {match.title}
            </h4>
            {!disabled && (
              <span
                aria-hidden
                className="text-[var(--color-text)] text-xs font-semibold flex-shrink-0"
              >
                Tap to pick →
              </span>
            )}
          </div>
          {(match.cuisine || match.description) && (
            <div className="px-4 py-2 flex flex-col gap-1">
              {match.cuisine && (
                <span className="inline-block self-start px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-accent)]/30 text-[var(--color-text)]">
                  {match.cuisine}
                </span>
              )}
              {match.description && (
                <p className="text-xs text-[var(--color-muted)] line-clamp-2">
                  {match.description}
                </p>
              )}
            </div>
          )}
        </motion.button>
      ))}
    </div>
  )
}

function SingleMatchCard({
  match,
  onSelect,
  disabled,
}: {
  match: SavedRecipeMatch
  onSelect: (match: SavedRecipeMatch) => void
  disabled: boolean
}) {
  const linkClass = (variant: 'primary' | 'secondary') =>
    [
      'flex-1 text-center py-2.5 px-3 rounded-full text-sm font-semibold transition-colors',
      variant === 'primary'
        ? 'bg-[var(--color-primary)] text-white'
        : 'border border-[var(--color-border)] bg-white text-[var(--color-muted)] hover:bg-[var(--color-bg)]',
      disabled ? 'pointer-events-none opacity-60' : 'cursor-pointer',
    ].join(' ')
  const buttonClass = (variant: 'primary' | 'secondary') =>
    [
      'flex-1 text-center py-2.5 px-3 rounded-full text-sm font-semibold transition-colors',
      variant === 'primary'
        ? 'bg-[var(--color-primary)] text-white'
        : 'border border-[var(--color-border)] bg-white text-[var(--color-muted)] hover:bg-[var(--color-bg)]',
      disabled ? 'cursor-default opacity-60' : 'cursor-pointer',
    ].join(' ')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.snappy}
      className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-accent)] shadow-sm overflow-hidden w-full max-w-[85%]"
    >
      <div className="bg-[var(--color-accent)]/55 px-4 py-2.5">
        <h4 className="text-[var(--color-text)] font-bold text-sm leading-snug">
          {match.title}
        </h4>
        {match.cuisine && (
          <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-surface)] text-[var(--color-text)]">
            {match.cuisine}
          </span>
        )}
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        {match.description && (
          <p className="text-sm text-[var(--color-text)] line-clamp-3">{match.description}</p>
        )}
        <div className="flex gap-2 mx-0.5">
          <Link
            href={`/recipes/${encodeURIComponent(match.id)}`}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : undefined}
            onClick={(e) => disabled && e.preventDefault()}
            className={linkClass('secondary')}
          >
            Open recipe
          </Link>
          <button
            type="button"
            disabled={disabled}
            // A plain <button> that defers entirely to the shared onSelect
            // handler (`handlePickSavedRecipe` in app/chat/page.tsx), the
            // same one the many-match tap uses — not a <Link>, so there is
            // no second, independent place that decides what "cook this
            // saved recipe" means. Round 2 fixed the ended-cook-record gap
            // only in the many-match path and had to fix this Link
            // separately; round 3 fixed the dismissed-banner gap only in
            // handlePickSavedRecipe and missed this Link entirely. Routing
            // both through one function removes the seam that kept letting
            // the two drift out of sync (PR #614 round 4).
            onClick={() => !disabled && onSelect(match)}
            className={buttonClass('primary')}
          >
            Cook this
          </button>
        </div>
      </div>
    </motion.div>
  )
}
