/**
 * Home-screen kitchen scene (issue #521).
 *
 * Pure presentation component: 12 fixed slots (`lib/kitchen/slots.ts`) laid
 * out over a fixed 4:3 box, each showing the matched unlocked decoration's
 * emoji (from `lib/kitchen/catalog.ts`) or a dashed-outline placeholder when
 * empty. The aspect-ratio wrapper always renders, loading or not, so nothing
 * shifts layout once data arrives — only the slot contents change.
 *
 * `unlocked` rows are looked up by `id` against `CATALOG` and by `slot`
 * against `SLOTS`; a row that matches neither is dropped silently (a stale
 * or renamed catalog entry must never crash the dashboard).
 */
import { SLOTS } from '@/lib/kitchen/slots'
import { CATALOG } from '@/lib/kitchen/catalog'

export interface UnlockedDecoration {
  id: string
  slot: string
}

export interface KitchenSceneProps {
  unlocked: UnlockedDecoration[]
  balance: number
  loading?: boolean
}

const CATALOG_BY_ID = new Map(CATALOG.map((d) => [d.id, d]))
const VALID_SLOT_KEYS = new Set(SLOTS.map((s) => s.key))

export default function KitchenScene({ unlocked, balance, loading = false }: KitchenSceneProps) {
  // Build slot -> emoji lookup from the rows that actually resolve. A row
  // whose id isn't in the catalog, or whose slot isn't one of SLOTS', is
  // dropped here rather than thrown on — the source data (a decorations
  // table row) can drift ahead of the frontend's catalog.
  const emojiBySlot = new Map<string, string>()
  if (!loading) {
    for (const row of unlocked) {
      if (!VALID_SLOT_KEYS.has(row.slot)) continue
      const decoration = CATALOG_BY_ID.get(row.id)
      if (!decoration) continue
      if (decoration.slot !== row.slot) continue
      emojiBySlot.set(row.slot, decoration.emoji)
    }
  }

  return (
    <div
      className="relative w-full max-w-[480px] aspect-[4/3] rounded-2xl overflow-hidden border border-[var(--color-border)]"
      style={{
        background:
          'linear-gradient(160deg, var(--pastel-peach, #ffdab3) 0%, var(--pastel-pink, #ffb5c5) 55%, var(--pastel-lavender, #c9b5e8) 100%)',
      }}
      data-testid="kitchen-scene"
    >
      {SLOTS.map((slot) => {
        const emoji = emojiBySlot.get(slot.key)
        return (
          <div
            key={slot.key}
            data-testid={`kitchen-slot-${slot.key}`}
            data-filled={emoji ? 'true' : 'false'}
            className="absolute flex items-center justify-center"
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              width: `${slot.w}%`,
              height: `${slot.h}%`,
            }}
            aria-label={slot.label}
          >
            {emoji ? (
              <span className="text-3xl leading-none" role="img" aria-label={slot.label}>
                {emoji}
              </span>
            ) : (
              <div className="w-full h-full rounded-xl border-2 border-dashed border-white/60" />
            )}
          </div>
        )
      })}

      <div
        className="absolute top-2 right-2 rounded-full px-3 py-1 text-xs font-bold text-[var(--color-text,#4a4a4a)] shadow-sm"
        style={{ background: 'var(--cream-white, #fff9f5)' }}
        data-testid="kitchen-bubbles-balance"
      >
        🫧 {balance}
      </div>
    </div>
  )
}
