'use client'

import Chip from '@/components/ui/Chip'
import type { ChipTone } from '@/components/ui/Chip'

/** Client-coded app actions. A closed union: model output can never name one.
 *  PR B/C extend it here, in one place. */
export type ChipAction = 'save_meal' | 'open_scan' | 'open_meal'

export interface ChipConfig {
  label: string
  /** Sent on a send-kind tap; put in the input by ✎. Unused for action-kind. */
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
  /** ✎ tap on a send-kind chip. When absent, no ✎ renders. */
  onEditChip?: (message: string) => void
  /** Action-kind tap. When absent, action chips are not rendered. */
  onChipAction?: (action: ChipAction) => void
  /** 'bubble' (default) = today's `ml-11` mascot-gutter indent.
   *  'center' = centred, no indent (the empty chat). */
  align?: 'bubble' | 'center'
}

/**
 * Contextual follow-up affordances rendered under the last settled assistant
 * message. Indentation matches the 36px mascot + gap-2 gutter beside the bubble.
 */
export default function PostMessageChips({ chips, onChipTap }: PostMessageChipsProps) {
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mt-2 ml-11">
      {chips.map((chip) => (
        <Chip
          key={chip.label}
          tone={chip.tone ?? 'muted'}
          emoji={chip.emoji}
          onClick={() => onChipTap(chip)}
          ariaLabel={chip.label}
        >
          {chip.label}
        </Chip>
      ))}
    </div>
  )
}
