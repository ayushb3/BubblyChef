'use client'

import Chip from '@/components/ui/Chip'
import type { ChipTone } from '@/components/ui/Chip'

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
  if (chips.length === 0) return null

  return (
    <div
      className={`flex flex-wrap gap-2 mt-2 max-w-full ${align === 'center' ? 'justify-center' : 'ml-11'}`}
    >
      {chips.map((chip) => {
        if (chip.kind === 'action') {
          // Model output can never carry an action (§1a's closed union), so
          // the only way this branch renders a dead pill is a caller that
          // hasn't wired a handler — omit it rather than render a no-op tap.
          if (!onChipAction || !chip.action) return null
          return (
            <Chip
              key={chip.label}
              tone={chip.tone ?? 'muted'}
              emoji={chip.emoji}
              onClick={() => onChipAction(chip.action as ChipAction)}
              ariaLabel={chip.label}
              title={chip.label}
              className="min-w-0 max-w-full"
            >
              {chip.label}
            </Chip>
          )
        }

        return (
          <Chip
            key={chip.label}
            tone={chip.tone ?? 'muted'}
            emoji={chip.emoji}
            onClick={() => onChipTap(chip)}
            ariaLabel={chip.label}
            title={chip.label}
            className="min-w-0 max-w-full"
          >
            {chip.label}
          </Chip>
        )
      })}
    </div>
  )
}
