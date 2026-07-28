import BubblesMascot from '@/components/ui/BubblesMascot'

/**
 * Route-level Suspense fallback (issue #135).
 *
 * Next.js renders this immediately on navigation while the server component for
 * the segment (and anything nested below it) is still awaiting data — without it
 * the previous page stays frozen on screen with zero feedback.
 *
 * Every colour comes from a CSS custom property so the skeleton is correct in all
 * five themes (sakura / mint / lavender / yuzu / bluebell). `motion-reduce:animate-none`
 * mirrors the reduced-motion path the framer-motion components take via `useMotionConfig()`.
 */

const PULSE = 'rounded animate-pulse motion-reduce:animate-none'
const PULSE_BG = { background: 'var(--color-border)' } as const

export default function Loading() {
  return (
    <div className="min-h-screen pb-24" role="status" aria-label="Loading">
      <span className="sr-only">Loading…</span>

      {/* Header strip — mirrors BubblesHeader so the shell doesn't jump */}
      <div className="p-4 pb-3 flex items-center gap-3 border-b border-[var(--color-border)]">
        <BubblesMascot state="thinking" size={36} />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-extrabold text-[var(--color-text)] leading-tight">
            Bubbles
          </h1>
          <p className="text-xs text-[var(--color-muted)]">Warming up the kitchen…</p>
        </div>
      </div>

      <div className="px-4 pt-6 max-w-lg mx-auto flex flex-col items-center">
        {/* Greeting line */}
        <span className={`${PULSE} w-40 h-3.5`} style={PULSE_BG} />

        {/* Hero mascot */}
        <div className="mt-4 mb-4">
          <BubblesMascot state="thinking" size={120} />
        </div>

        {/* Speech bubble */}
        <div className="relative max-w-sm w-full mx-auto mb-6">
          <div
            className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-l border-t border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
          />
          <div
            className="relative rounded-2xl p-4 flex flex-col items-center gap-2 shadow-sm border border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
          >
            <span className={`${PULSE} w-11/12 h-3`} style={PULSE_BG} />
            <span className={`${PULSE} w-2/3 h-3`} style={PULSE_BG} />
            <span className={`${PULSE} w-28 h-7 rounded-full mt-2`} style={PULSE_BG} />
          </div>
        </div>

        {/* Action card row */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`${PULSE} h-[88px] rounded-2xl border border-[var(--color-border)]`}
              style={PULSE_BG}
            />
          ))}
        </div>

        {/* Tip strip */}
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-[var(--color-border)] max-w-sm w-full"
          style={{ background: 'var(--color-surface)' }}
        >
          <span className={`${PULSE} w-5 h-5 rounded-full flex-shrink-0`} style={PULSE_BG} />
          <span className={`${PULSE} flex-1 h-3`} style={PULSE_BG} />
        </div>
      </div>
    </div>
  )
}
