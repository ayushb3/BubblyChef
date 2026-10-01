'use client'

import { motion } from 'framer-motion'
import Chip from '@/components/ui/Chip'
import type { ChipTone } from '@/components/ui/Chip'
import { staggerContainer, staggerItem, useMotionConfig } from '@/lib/motion'

/**
 * The pill look (issue #746, Signature "ChatBubble" board): a 44 px keycap on
 * the surface fill with a 2 px ink edge and a 2 px ink "key" shadow, bold ink
 * label. The model-supplied tone is not used for the fill here: every pill in a
 * row reads as the same kind of key.
 */
const PILL_CLASS =
  'min-w-0 max-w-full font-bold! shadow-[0_2px_0_var(--color-text)] active:translate-y-[1px] active:shadow-[0_1px_0_var(--color-text)] motion-reduce:active:translate-y-0'

/** Reduced motion: the pills fade in together instead of springing up. */
const FADE_ITEM = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.15 } } }

/** Client-coded app actions. A closed union: model output can never name one.
 *  PR B/C extend it here, in one place. */
export type ChipAction = 'save_meal' | 'open_scan' | 'open_meal'

export interface ChipConfig {
  label: string
  /** Sent on a send-kind tap. Unused for action-kind. */
  message: string
  /**
   * Display string for the empty-state suggestion row.  When present, the
   * empty-state row renders this string instead of `message`, so the row can
   * show the emoji-decorated prompt while `message` stays clean prose for the
   * chat bubble and the LLM.  Defaults to `message` when absent.
   */
  suggestion?: string
  tone?: ChipTone
  emoji?: string
  /** Default 'send'. */
  kind?: 'send' | 'action'
  /** Required when kind === 'action'. Ignored otherwise. */
  action?: ChipAction
  /** Client-set request context, forwarded with a send-kind tap. Set only by
   *  the resolver (`{ meal_followup: true }`), never from model output. */
  context?: Record<string, unknown>
}

export interface PostMessageChipsProps {
  chips: ChipConfig[]
  /** Send-kind tap. Gets the whole chip, so `context` travels with it. */
  onChipTap: (chip: ChipConfig) => void
  /** Action-kind tap. When absent, action chips are not rendered. */
  onChipAction?: (action: ChipAction) => void
  /** 'bubble' (default) = today's `ml-11` mascot-gutter indent.
   *  'center' = centred, no indent (the empty chat). */
  align?: 'bubble' | 'center'
}

/**
 * Contextual follow-up affordances rendered under the last settled assistant
 * message (or centred in the empty chat, see `align`). Indentation matches
 * the 36px mascot + gap-2 gutter beside the bubble.
 *
 * Two pill kinds (issue #651):
 * - **send** (default) — taps `onChipTap(chip)`. A tap sends; there is no
 *   edit-before-send path (issue #730 removed the ✎ button).
 * - **action** — taps `onChipAction(chip.action)`. Omitted entirely when
 *   `onChipAction` is absent so a caller that hasn't wired an action handler
 *   never renders a dead pill.
 *
 * This component never caps, dedupes or reorders `chips` — that's the
 * resolver's job (`lib/chat-chips.ts`).
 */
export default function PostMessageChips({
  chips,
  onChipTap,
  onChipAction,
  align = 'bubble',
}: PostMessageChipsProps) {
  const { reduced } = useMotionConfig()
  if (chips.length === 0) return null

  // Pills stagger in 40 ms apart once the reply has finished (this row only
  // mounts under the last settled reply); under reduced motion they fade.
  const item = reduced ? FADE_ITEM : staggerItem

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={`flex flex-wrap gap-2 mt-2 max-w-full ${align === 'center' ? 'justify-center' : 'ml-11'}`}
    >
      {chips.map((chip) => {
        if (chip.kind === 'action') {
          // Model output can never carry an action (§1a's closed union), so
          // the only way this branch renders a dead pill is a caller that
          // hasn't wired a handler — omit it rather than render a no-op tap.
          if (!onChipAction || !chip.action) return null
          return (
            <motion.div key={chip.label} variants={item} className="min-w-0 max-w-full">
              <Chip
                tone="muted"
                emoji={chip.emoji}
                onClick={() => onChipAction(chip.action as ChipAction)}
                ariaLabel={chip.label}
                title={chip.label}
                className={PILL_CLASS}
              >
                {chip.label}
              </Chip>
            </motion.div>
          )
        }

        return (
          <motion.div key={chip.label} variants={item} className="min-w-0 max-w-full">
            <Chip
              tone="muted"
              emoji={chip.emoji}
              onClick={() => onChipTap(chip)}
              ariaLabel={chip.label}
              title={chip.label}
              className={PILL_CLASS}
            >
              {chip.label}
            </Chip>
          </motion.div>
        )
      })}
    </motion.div>
  )
}
