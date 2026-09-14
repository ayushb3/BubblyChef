// PROTOTYPE — throwaway. Floating variant switcher. Hidden in production.
'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { VARIANT_NAMES } from './mock'

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

export default function Switcher() {
  const router = useRouter()
  const params = useSearchParams()
  const current = (params.get('variant') ?? 'A').toUpperCase()

  const go = (key: string) => router.replace(`/cook-prototype?variant=${key}`)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const i = KEYS.indexOf(current as (typeof KEYS)[number])
      if (i === -1) return
      if (e.key === 'ArrowLeft') go(KEYS[(i - 1 + KEYS.length) % KEYS.length])
      if (e.key === 'ArrowRight') go(KEYS[(i + 1) % KEYS.length])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  if (process.env.NODE_ENV === 'production') return null

  const i = KEYS.indexOf(current as (typeof KEYS)[number])
  const prev = KEYS[(i - 1 + KEYS.length) % KEYS.length]
  const next = KEYS[(i + 1) % KEYS.length]

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-1 rounded-full px-2 py-1.5"
      style={{ background: '#1a1a1a', color: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}
    >
      <button onClick={() => go(prev)} className="px-2 text-lg leading-none" aria-label="Previous variant">
        ←
      </button>
      <span className="text-xs font-mono px-2 whitespace-nowrap">
        {current} — {VARIANT_NAMES[current] ?? '?'}
      </span>
      <button onClick={() => go(next)} className="px-2 text-lg leading-none" aria-label="Next variant">
        →
      </button>
    </div>
  )
}
