/**
 * Route-level Suspense fallback for `/profile`.
 *
 * `app/profile/page.tsx` is an async server component (it awaits
 * `supabase.auth.getUser()`), so the segment suspends on navigation. Without a
 * fallback here the *root* `app/loading.tsx` is used — and that one is
 * deliberately dashboard-shaped (hero mascot, speech bubble, three action
 * cards), so you'd briefly see a fake dashboard on the way to the profile.
 * This skeleton mirrors the profile page's own layout instead: header strip,
 * overlapping avatar, name block, dietary pills, About rows.
 *
 * Every colour resolves through a CSS custom property so the skeleton is
 * correct in all five themes. `motion-reduce:animate-none` mirrors the
 * reduced-motion path the framer-motion components take via `useMotionConfig()`.
 */

const PULSE = 'rounded animate-pulse motion-reduce:animate-none'
const PULSE_BG = { background: 'var(--color-border)' } as const

export default function Loading() {
  return (
    <div className="pb-24" role="status" aria-label="Loading profile">
      <span className="sr-only">Loading profile…</span>

      {/* Header strip with the avatar slot straddling its bottom edge */}
      <div className="relative">
        <div className="chowder-panel h-28" />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2">
          <span
            className={`${PULSE} block w-20 h-20 rounded-full border border-[var(--color-border)]`}
            style={{ background: 'var(--color-surface)' }}
          />
        </div>
      </div>

      {/* Display name + email */}
      <div className="mt-14 mb-6 px-6 flex flex-col items-center gap-2">
        <span className={`${PULSE} w-32 h-5`} style={PULSE_BG} />
        <span className={`${PULSE} w-44 h-3`} style={PULSE_BG} />
      </div>

      <div className="px-6 space-y-6 max-w-md mx-auto">
        {/* Dietary preferences */}
        <section>
          <span className={`${PULSE} block w-36 h-3 mb-3`} style={PULSE_BG} />
          <div className="flex flex-wrap gap-2">
            {[72, 56, 92, 84].map((w) => (
              <span
                key={w}
                className={`${PULSE} h-8 rounded-full`}
                style={{ ...PULSE_BG, width: w }}
              />
            ))}
          </div>
        </section>

        {/* About */}
        <section>
          <span className={`${PULSE} block w-20 h-3 mb-3`} style={PULSE_BG} />
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {[0, 1].map((i) => (
              <div key={i} className="px-4 py-3 flex justify-between items-center">
                <span className={`${PULSE} w-16 h-3`} style={PULSE_BG} />
                <span className={`${PULSE} w-24 h-3`} style={PULSE_BG} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
