'use client'

/**
 * The storage sheet's select-mode footer (issue #750, board A4 panel 2): what
 * "Move to...", "Used up" and "Tossed" do to the ticked items. It replaces the
 * "Add to the <place>" key while the List (or search results) is in select mode.
 *
 * Three steps, one at a time, so a stray tap cannot cost food:
 *  - actions: Move to... / Used up / Tossed, all off until something is ticked;
 *  - move: the four places to send the selection to (and Cancel);
 *  - toss: "Toss 3 items?" with a confirm. "Tossed" is irreversible (the rows go
 *    and an event is written), the same reason a single toss asks first
 *    (`ResolveActions`); "Used up" is the happy path and commits on one tap.
 *
 * Presentation only: it reports the choice (`onMove`, `onUsed`, `onTossed`) and
 * the sheet runs it. `busy` switches every control off while the request runs.
 */
import { useState } from 'react'
import { PIXEL_INK } from '@/components/ui/PixelPanel'
import { PLACES, type PlaceKey } from '@/lib/kitchen/places'

type Step = 'actions' | 'move' | 'toss'

export interface StorageBulkBarProps {
  /** How many items are ticked (and on screen). */
  count: number
  busy: boolean
  onMove: (place: PlaceKey) => void
  onUsed: () => void
  onTossed: () => void
}

const PILL =
  'flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border-2 px-2 text-sm leading-5 font-extrabold whitespace-nowrap text-[color:var(--color-text)] shadow-[0_3px_0_var(--color-text)] active:translate-y-px disabled:opacity-50 disabled:shadow-none motion-reduce:active:translate-y-0'

function items(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  )
}

export default function StorageBulkBar({
  count,
  busy,
  onMove,
  onUsed,
  onTossed,
}: StorageBulkBarProps) {
  const [step, setStep] = useState<Step>('actions')
  // Nothing ticked (or everything acted on) always goes back to the three actions.
  const shown: Step = count === 0 ? 'actions' : step
  const none = count === 0 || busy

  if (shown === 'move') {
    return (
      <div role="group" aria-label={`Move ${items(count)} to`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-extrabold text-[color:var(--color-text)]" aria-hidden="true">
            Move {items(count)} to
          </p>
          <button
            type="button"
            onClick={() => setStep('actions')}
            disabled={busy}
            className="min-h-[44px] px-3 text-[13px] font-extrabold text-[color:var(--color-text)] underline underline-offset-[3px]"
          >
            Cancel
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {PLACES.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={busy}
              onClick={() => {
                setStep('actions')
                onMove(p.key)
              }}
              className={`${PILL} flex-none`}
              style={{ borderColor: PIXEL_INK, background: 'var(--color-surface)' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (shown === 'toss') {
    return (
      <div className="flex flex-col gap-2" role="group" aria-label="Confirm toss">
        <p role="alert" className="text-sm font-extrabold text-[color:var(--color-text)]">
          Toss {items(count)}? They&apos;re removed and counted as wasted.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep('actions')}
            className={PILL}
            style={{ borderColor: PIXEL_INK, background: 'var(--color-surface)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setStep('actions')
              onTossed()
            }}
            className={PILL}
            style={{
              borderColor: PIXEL_INK,
              background: 'var(--color-expired)',
              color: 'var(--color-expired-text)',
            }}
          >
            Yes, toss them
          </button>
        </div>
      </div>
    )
  }

  return (
    <div role="group" aria-label={`Actions for ${items(count)} selected`} className="flex gap-2">
      <button
        type="button"
        disabled={none}
        onClick={() => setStep('move')}
        className={PILL}
        style={{ borderColor: PIXEL_INK, background: 'var(--color-surface)' }}
      >
        Move to…
      </button>
      <button
        type="button"
        disabled={none}
        aria-busy={busy}
        onClick={onUsed}
        className={PILL}
        style={{ borderColor: PIXEL_INK, background: 'var(--color-primary)' }}
      >
        Used up
      </button>
      <button
        type="button"
        disabled={none}
        onClick={() => setStep('toss')}
        className={PILL}
        style={{
          borderColor: PIXEL_INK,
          background: 'var(--color-surface)',
          color: 'var(--color-expired-text)',
        }}
      >
        <TrashIcon />
        Tossed
      </button>
    </div>
  )
}
