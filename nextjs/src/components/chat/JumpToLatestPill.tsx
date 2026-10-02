'use client'

/**
 * "Jump to latest ↓" (issues #811, #847, #900).
 *
 * Just the pill, floating over the bottom of the message list: out of normal
 * flow (`absolute`), so showing or hiding it never resizes the list or shifts
 * the composer, and with no row or background behind it, so the list stays
 * visible around it. The parent must be `relative` and sit over the list.
 *
 * It is only shown while the thread is off its end, so what it floats over is
 * mid-thread content, never the newest message's actions.
 */
export default function JumpToLatestPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="jump-to-latest"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 text-xs font-semibold text-[var(--color-primary-dark)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md px-3 py-1.5 rounded-full hover:bg-[var(--color-border)] transition-colors"
    >
      Jump to latest ↓
    </button>
  )
}
