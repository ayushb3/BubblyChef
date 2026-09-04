'use client'

import Chip from '@/components/ui/Chip'
import type { ChipTone } from '@/components/ui/Chip'

export interface ChipConfig {
  label: string
  /** The text sent to the AI when the chip is tapped. */
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
}

export interface PostMessageChipsProps {
  chips: ChipConfig[]
  onChipTap: (message: string) => void
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
          onClick={() => onChipTap(chip.message)}
          ariaLabel={chip.label}
        >
          {chip.label}
        </Chip>
      ))}
    </div>
  )
}
