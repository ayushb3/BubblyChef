'use client'

/**
 * PROTOTYPE ONLY (throwaway) — floating pill that cycles the home screen
 * through `?variant=A|B|C` and `?mood=happy|surprised|worried|celebrate` via
 * `router.replace`, so the three layouts + every Bubbles mood can be judged
 * side by side without touching real data. Hidden in production builds
 * unless `NEXT_PUBLIC_PROTOTYPE=1` is set (see verify/screenshot step).
 */
import { useCallback, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr'

const VARIANTS = ['A', 'B', 'C'] as const
const VARIANT_LABELS: Record<(typeof VARIANTS)[number], string> = {
  A: 'Bubbles in the kitchen',
  B: 'Bubbles first',
  C: 'Full-screen kitchen',
}
const MOODS = ['happy', 'surprised', 'worried', 'celebrate'] as const

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export default function PrototypeSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Hidden in production unless explicitly opted in — this is a throwaway
  // dev/screenshot tool, not a shipped affordance.
  const shouldRender =
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_PROTOTYPE === '1'

  const variantParam = searchParams.get('variant')
  const currentVariant: (typeof VARIANTS)[number] = (
    VARIANTS.includes(variantParam as (typeof VARIANTS)[number]) ? variantParam : 'A'
  ) as (typeof VARIANTS)[number]

  const moodParam = searchParams.get('mood')
  const currentMood: (typeof MOODS)[number] = (
    MOODS.includes(moodParam as (typeof MOODS)[number]) ? moodParam : 'happy'
  ) as (typeof MOODS)[number]

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set(key, value)
      router.replace(`${pathname}?${next.toString()}`)
    },
    [pathname, router, searchParams],
  )

  const cycleVariant = useCallback(
    (dir: 1 | -1) => {
      const idx = VARIANTS.indexOf(currentVariant)
      const next = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length]
      setParam('variant', next)
    },
    [currentVariant, setParam],
  )

  const cycleMood = useCallback(
    (dir: 1 | -1) => {
      const idx = MOODS.indexOf(currentMood)
      const next = MOODS[(idx + dir + MOODS.length) % MOODS.length]
      setParam('mood', next)
    },
    [currentMood, setParam],
  )

  useEffect(() => {
    if (!shouldRender) return
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        cycleVariant(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        cycleVariant(1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shouldRender, cycleVariant])

  if (!shouldRender) return null

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1.5 rounded-full px-3 py-2 shadow-lg border-2"
      style={{
        bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
        background: 'repeating-linear-gradient(45deg, #1a1a1a, #1a1a1a 8px, #2a2a2a 8px, #2a2a2a 16px)',
        borderColor: '#ffe066',
      }}
      data-testid="prototype-switcher"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous layout variant"
          onClick={() => cycleVariant(-1)}
          className="flex items-center justify-center w-8 h-8 rounded-full text-white active:scale-90 transition-transform"
          style={{ background: '#ffe066' }}
        >
          <CaretLeft size={16} weight="fill" className="text-black" />
        </button>
        <span className="text-xs font-bold text-white whitespace-nowrap px-1">
          {currentVariant} · {VARIANT_LABELS[currentVariant]}
        </span>
        <button
          type="button"
          aria-label="Next layout variant"
          onClick={() => cycleVariant(1)}
          className="flex items-center justify-center w-8 h-8 rounded-full text-white active:scale-90 transition-transform"
          style={{ background: '#ffe066' }}
        >
          <CaretRight size={16} weight="fill" className="text-black" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous mood"
          onClick={() => cycleMood(-1)}
          className="flex items-center justify-center w-6 h-6 rounded-full text-black active:scale-90 transition-transform"
          style={{ background: '#b5ead7' }}
        >
          <CaretLeft size={12} weight="fill" />
        </button>
        <span className="text-[10px] font-semibold text-[#ffe066] uppercase tracking-wide">
          mood: {currentMood}
        </span>
        <button
          type="button"
          aria-label="Next mood"
          onClick={() => cycleMood(1)}
          className="flex items-center justify-center w-6 h-6 rounded-full text-black active:scale-90 transition-transform"
          style={{ background: '#b5ead7' }}
        >
          <CaretRight size={12} weight="fill" />
        </button>
      </div>
    </div>
  )
}
