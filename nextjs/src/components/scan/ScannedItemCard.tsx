'use client'

/**
 * One "Did I read these right?" card (issue #753, board A3): the items the scan
 * was unsure about (the needs-review tier), asked about before they go in.
 *
 * Shows the food's emoji, "name · quantity", the raw receipt line it was read
 * from (monospace, so a misread is easy to spot) and "→ <Place>", the place it
 * is headed to. Two answers:
 *
 *  - **Fix** opens the inline editor: name, quantity, place (and leaving the item
 *    out). The item stays in this section, unanswered, while it is being edited;
 *    the editor's **Done** answers it (as Yes does, with the fixed values).
 *  - **Yes** accepts the reading: the item moves to "Going in".
 *
 * Presentation-only: edits and answers go out through callbacks; nothing here
 * writes to the pantry.
 */
import { motion } from 'framer-motion'
import type { ScannedItemWithId } from '@/lib/scan-helpers'
import { scanItemPlace, scanQuantityLabel } from '@/lib/scan-helpers'
import { placeDef } from '@/lib/kitchen/places'
import { getFoodEmoji } from '@/lib/food-emoji'
import { useMotionConfig } from '@/lib/motion'
import SpringButton from '@/components/ui/SpringButton'
import ItemEditor from './ItemEditor'

interface ScannedItemCardProps {
  item: ScannedItemWithId
  /** The inline editor is open. */
  editing: boolean
  onFix: () => void
  onYes: () => void
  /** The editor's Done: the item has been fixed, so it is answered. Defaults to closing (`onFix`). */
  onDone?: () => void
  onChange: (updated: ScannedItemWithId) => void
  onLeaveOut: () => void
  disabled?: boolean
  index?: number
}

export default function ScannedItemCard({
  item,
  editing,
  onFix,
  onYes,
  onDone,
  onChange,
  onLeaveOut,
  disabled = false,
  index = 0,
}: ScannedItemCardProps) {
  const { reduced } = useMotionConfig()
  const place = placeDef(scanItemPlace(item))

  return (
    <motion.li
      aria-label={item.name}
      layout={reduced ? false : 'position'}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: reduced ? 0 : index * 0.04 }}
      className="list-none rounded-xl border-2 border-dashed border-[color:var(--color-text)] bg-[var(--color-surface)] px-3 py-2"
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="text-2xl leading-7">
          {getFoodEmoji(item.name, item.category)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-px text-[color:var(--color-text)]">
          <span className="text-sm leading-[19px] font-extrabold tabular-nums break-words">
            {item.name} · {scanQuantityLabel(item)}
          </span>
          {item.source_line && (
            <span className="truncate font-mono text-[11px] leading-[15px] font-bold">
              {item.source_line}
            </span>
          )}
          <span className="text-xs leading-4 font-bold">→ {place.label}</span>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <SpringButton
            variant="secondary"
            size="sm"
            onClick={onFix}
            disabled={disabled}
            aria-label={`Fix ${item.name}`}
          >
            Fix
          </SpringButton>
          <SpringButton
            variant="primary"
            size="sm"
            onClick={onYes}
            disabled={disabled}
            aria-label={`Yes, ${item.name} is right`}
          >
            Yes
          </SpringButton>
        </div>
      </div>

      {editing && (
        <ItemEditor
          item={item}
          onChange={onChange}
          onLeaveOut={onLeaveOut}
          onDone={onDone ?? onFix}
          disabled={disabled}
        />
      )}
    </motion.li>
  )
}
