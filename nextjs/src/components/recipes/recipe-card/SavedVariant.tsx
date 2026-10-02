'use client'

/**
 * Recipe card, `saved` variant: one saved recipe in the library (issue #801). The
 * Recipes tab lists these, so a saved recipe looks like the saved meal (`compact`)
 * and every other card. A pastel tile (the recipe's photo when it has one), the
 * title, one meta line (minutes, servings, cuisine, difficulty), up to three tags,
 * then the row's own controls: a heart and an overflow menu (Edit, Delete).
 *
 * The text area is the open control (a button calling `onOpen`); with no `onOpen`
 * the card is only a header, as on the opened recipe. The heart and the menu are
 * siblings of that control, never inside it, and are each 44 px. A row clamps its
 * title to two lines; the header (no `onOpen`) shows it whole. `busy` disables
 * both while a save is in flight; opening stays available.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useAnimation } from 'framer-motion'
import { Heart, DotsThree } from '@phosphor-icons/react'
import { heartPopVariants, springs } from '@/lib/motion'
import { CARD_FRAME, CARD_KEY_SHADOW, MetaPill, TITLE_FONT } from './parts'

export interface SavedCardProps {
  title: string
  /** Emoji on the tile; also what shows when the photo fails to load. */
  emoji?: string
  thumbnailUrl?: string | null
  /** Total minutes; hidden when unknown. */
  minutes?: number | null
  servings?: number | null
  cuisine?: string | null
  difficulty?: string | null
  tags?: string[]
  /** "Cooked 3x, last 2 days ago" (issue #855); hidden when absent. */
  cookedLabel?: string | null
  favorite?: boolean
  /** Makes the text area a button that opens the recipe. */
  onOpen?: () => void
  onToggleFavorite?: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** A save is in flight: the heart and the menu are disabled. */
  busy?: boolean
}

const MAX_TAGS = 3
const ROUND_CONTROL =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:scale-95 transition-transform disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100'
const MENU_ITEM =
  'flex min-h-[44px] w-full items-center gap-2 px-4 text-left text-sm font-extrabold hover:bg-[var(--color-bg)] transition-colors'

export default function SavedVariant({
  title,
  emoji = '🍳',
  thumbnailUrl,
  minutes,
  servings,
  cuisine,
  difficulty,
  tags = [],
  cookedLabel,
  favorite = false,
  onOpen,
  onToggleFavorite,
  onEdit,
  onDelete,
  busy = false,
}: SavedCardProps) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const heartControls = useAnimation()
  const hasMenu = Boolean(onEdit || onDelete)

  // Close the menu on an outside press, and on Escape (focus goes back to the trigger).
  useEffect(() => {
    if (!menuOpen) return
    const onPress = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPress)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPress)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const meta: string[] = []
  if (minutes && minutes > 0) meta.push(`${minutes} min`)
  if (servings && servings > 0) meta.push(`Serves ${servings}`)
  if (cuisine) meta.push(cuisine)
  if (difficulty) meta.push(difficulty)

  const shownTags = tags.slice(0, MAX_TAGS)
  const moreTags = tags.length - shownTags.length

  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[var(--color-text)] bg-[var(--color-primary)] text-[26px]"
      >
        {thumbnailUrl && !photoFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-supplied, arbitrary hosts
          <img
            src={thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          emoji
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={`${TITLE_FONT} ${onOpen ? 'line-clamp-2 ' : ''}text-[17px] leading-[22px] font-bold break-words`}
        >
          {title}
        </span>
        {meta.length > 0 && (
          <span className="text-xs leading-4 font-bold tabular-nums">{meta.join(' · ')}</span>
        )}
        {cookedLabel && <span className="text-xs leading-4 font-bold">{cookedLabel}</span>}
        {shownTags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {shownTags.map((tag) => (
              <MetaPill key={tag}>{tag}</MetaPill>
            ))}
            {moreTags > 0 && <MetaPill>+{moreTags}</MetaPill>}
          </span>
        )}
      </span>
    </>
  )

  const ROW = 'flex min-h-[72px] min-w-0 flex-1 items-center gap-3 p-3 text-left'

  return (
    <div
      className={`${CARD_FRAME} ${CARD_KEY_SHADOW} relative flex w-full items-stretch`}
      data-testid="recipe-card-saved"
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open recipe: ${title}`}
          className={`${ROW} rounded-l-2xl active:bg-[var(--color-bg)]`}
        >
          {body}
        </button>
      ) : (
        <div className={ROW}>{body}</div>
      )}

      <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => {
              void heartControls.start('pop').then(() => heartControls.start('idle'))
              onToggleFavorite()
            }}
            disabled={busy}
            aria-pressed={favorite}
            aria-label={`${favorite ? 'Unfavorite' : 'Favorite'}: ${title}`}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            className={ROUND_CONTROL}
          >
            <motion.span variants={heartPopVariants} animate={heartControls} initial="idle" className="flex">
              <Heart
                size={22}
                weight={favorite ? 'fill' : 'regular'}
                color={favorite ? 'var(--color-coral)' : 'var(--color-text)'}
              />
            </motion.span>
          </button>
        )}

        {hasMenu && (
          <div className="relative" ref={menuRef}>
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              disabled={busy}
              aria-label={`More options for ${title}`}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              className={ROUND_CONTROL}
            >
              <DotsThree size={22} weight="bold" color="var(--color-text)" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -4 }}
                  transition={springs.snappy}
                  className="absolute top-12 right-0 z-20 min-w-[140px] overflow-hidden rounded-2xl border-2 border-[var(--color-text)] bg-[var(--color-surface)] shadow-[0_3px_0_var(--color-text)]"
                >
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        onEdit()
                      }}
                      className={`${MENU_ITEM} text-[var(--color-text)]`}
                    >
                      ✏️ Edit
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        onDelete()
                      }}
                      className={`${MENU_ITEM} text-[var(--color-expired-text)]`}
                    >
                      🗑️ Delete
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
