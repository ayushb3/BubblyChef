'use client'

/**
 * A pixel speech bubble for Bubbles' lines (issue #915).
 *
 * The line types out one character at a time (a stepped reveal, no easing) and a
 * tap on the bubble finishes it. Under reduced motion the whole line is simply
 * there. Assistive tech always gets the full line at once (a polite live region);
 * the typed copy is hidden from it so a screen reader never hears fragments.
 */

import { useEffect, useState } from 'react'
import type React from 'react'
import { useMotionConfig } from '@/lib/motion'

/** Time between characters. */
const TYPE_MS = 28

export interface SpeechBubbleProps {
  text: string
  testId?: string
  className?: string
  /**
   * Render the polite live region here (default). A caller that swaps lines by
   * remounting the bubble passes `false` and keeps one live region mounted
   * outside it, since a freshly mounted live region is not announced.
   */
  announce?: boolean
}

export default function SpeechBubble({ text, testId, className = '', announce = true }: SpeechBubbleProps) {
  const { reduced } = useMotionConfig()
  const [typed, setTyped] = useState({ text, count: 0 })

  // A new line starts from nothing (adjusting state during render, React's
  // pattern for state derived from a changed prop).
  if (typed.text !== text) setTyped({ text, count: 0 })

  const chars = Array.from(text)
  const count = reduced ? chars.length : typed.count
  const done = count >= chars.length

  const finish = () => setTyped({ text, count: chars.length })

  useEffect(() => {
    if (reduced || done) return
    const id = setInterval(() => {
      setTyped((t) => ({ ...t, count: t.count + 1 }))
    }, TYPE_MS)
    return () => clearInterval(id)
  }, [reduced, done, text])

  return (
    <div
      className={`relative rounded-2xl border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] px-4 py-3 text-[15px] leading-[22px] font-semibold text-[color:var(--color-text)] ${className}`}
      // While typing, the bubble is a control: tap, Enter or Space shows the whole line.
      {...(done
        ? {}
        : {
            role: 'button',
            tabIndex: 0,
            'aria-label': 'Show the whole line',
            onClick: finish,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                finish()
              }
            },
          })}
    >
      {/* The tail, pointing at Bubbles beside it. */}
      <span
        aria-hidden="true"
        className="absolute top-4 -left-[9px] h-4 w-4 rotate-45 border-b-2 border-l-2 border-[color:var(--color-text)] bg-[var(--color-surface)]"
      />
      {announce && (
        <p className="sr-only" aria-live="polite" data-testid={testId}>
          {text}
        </p>
      )}
      {/* The full line sets the bubble's size, so it does not grow while typing. */}
      <p aria-hidden="true" className="relative">
        <span className="invisible">{text}</span>
        <span className="absolute inset-0" data-testid="speech-typed">{chars.slice(0, count).join('')}</span>
      </p>
    </div>
  )
}
