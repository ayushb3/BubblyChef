// PROTOTYPE — throwaway. Shared atoms used across variants.
'use client'

import { MOCK_DEDUCTIONS, STATUS_META, MOCK_RECIPE } from './mock'

const FONT = { fontFamily: 'Nunito, sans-serif' } as const

/** Placeholder timer affordance (#45 owns real timers). Purely decorative. */
export function TimerChip({ min }: { min: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
      style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px dashed var(--color-border)' }}
      title="Timer affordance — prototype only, not functional"
    >
      ⏱️ {min}m
    </span>
  )
}

/** The deduction preview — reused wherever a variant places it. */
export function DeductionPreview({ compact }: { compact?: boolean }) {
  return (
    <div className="space-y-1.5" style={FONT}>
      {!compact && (
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          This cook will use
        </p>
      )}
      {MOCK_DEDUCTIONS.map((d) => {
        const m = STATUS_META[d.status]
        return (
          <div key={d.ingredient} className="flex items-start gap-2 text-sm">
            <span style={{ color: m.tone }} className="font-bold w-4 text-center shrink-0">
              {m.emoji}
            </span>
            <span className="flex-1" style={{ color: 'var(--color-text)' }}>
              <span className="font-semibold">{d.ingredient}</span>
              <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                {d.detail}
              </span>
            </span>
            <span className="text-[10px] font-bold uppercase mt-0.5 shrink-0" style={{ color: m.tone }}>
              {m.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The source recipe card in its LOCKED state (#269) — greyed, non-interactive,
 * with a "cooking now" stamp instead of the Cook/Save/Try-Another buttons.
 */
export function LockedRecipeCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden opacity-70 pointer-events-none select-none"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', filter: 'grayscale(0.35)' }}
      aria-disabled
    >
      <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
        <span className="text-lg">{MOCK_RECIPE.emoji}</span>
        <span className="font-extrabold" style={{ ...FONT, color: 'var(--color-text)' }}>
          {MOCK_RECIPE.title}
        </span>
        <span
          className="ml-auto text-[10px] font-bold uppercase rounded-full px-2 py-0.5"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary-dark)' }}
        >
          🔒 cooking now
        </span>
      </div>
      <div className="px-4 py-2 text-xs" style={{ ...FONT, color: 'var(--color-muted)' }}>
        Locked while you cook — no second recipe, no double deduction.
      </div>
    </div>
  )
}

/** Clean done-state (#268) — exits the mode, banner cleared. */
export function DoneState({ onExit }: { onExit: () => void }) {
  return (
    <div className="text-center py-8 px-6" style={FONT}>
      <div className="text-5xl mb-3">🎉</div>
      <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--color-text)' }}>
        Nicely done!
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
        Your pantry’s been updated. The cooking banner is gone.
      </p>
      <button
        onClick={onExit}
        className="rounded-full px-6 py-2.5 font-bold text-sm"
        style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
      >
        Back to chat
      </button>
    </div>
  )
}

export const SHEET_FONT = FONT
