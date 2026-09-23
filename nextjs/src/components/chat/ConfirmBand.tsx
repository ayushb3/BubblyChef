'use client'

import { motion } from 'framer-motion'
import { springs } from '@/lib/motion'

export interface ConfirmOption {
  label: string
  forced_intent: 'recipe_card' | 'recipe_brainstorm'
}

export interface ConfirmBandProps {
  /** The two options returned by the backend in metadata.confirm_options. */
  options: ConfirmOption[]
  /** Called with the chosen forced_intent and the button's label text. */
  onSelect: (forcedIntent: 'recipe_card' | 'recipe_brainstorm', label: string) => void
  /**
   * When true the buttons render statically without pointer interaction
   * (applied to older confirm-band messages that are no longer the last settled turn).
   */
  disabled?: boolean
}

/**
 * A two-button decision prompt that appears when the backend can't tell whether
 * the user wants to modify the pinned recipe or start a new one (#416 AC3).
 *
 * Shape and motion mirror BrainstormOptions — same rounded-2xl accent-family
 * shell, framer-motion stagger, role="list"/listitem a11y — so it sits
 * naturally next to other assistant cards in the thread.
 */
export default function ConfirmBand({
  options,
  onSelect,
  disabled = false,
}: ConfirmBandProps) {
  if (options.length === 0) return null

  return (
    <div
      className="flex flex-col gap-2 w-full max-w-[85%]"
      role="group"
      aria-label="Choose how to continue — tap one"
    >
      {options.map((option, i) => (
        <motion.button
          key={option.forced_intent}
          type="button"
          aria-label={option.label}
          disabled={disabled}
          onClick={() => !disabled && onSelect(option.forced_intent, option.label)}
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
              {option.label}
            </h4>
            {!disabled && (
              <span
                aria-hidden
                className="text-[var(--color-text)] text-xs font-semibold flex-shrink-0"
              >
                Tap →
              </span>
            )}
          </div>
        </motion.button>
      ))}
    </div>
  )
}
