// PROTOTYPE — throwaway. Variant B: One-step card (NYT/Apple cook-mode idiom).
// Full-screen ONE step at a time. Deduction preview = a mise-en-place screen
// BEFORE step 1 (its own screen, #267). Big text, Next/Back, progress dots.
// Dedicated done-state screen at the end (#268).
'use client'

import { useState } from 'react'
import { MOCK_RECIPE } from './mock'
import { DeductionPreview, TimerChip, DoneState } from './shared'

const FONT = { fontFamily: 'Nunito, sans-serif' } as const
// -1 = mise-en-place preview screen, 0..n-1 = steps, n = done
const PREP = -1

export default function VariantB() {
  const steps = MOCK_RECIPE.steps
  const [idx, setIdx] = useState<number>(PREP)
  const [exited, setExited] = useState(false)

  if (exited) return <ExitedNote />

  const isPrep = idx === PREP
  const isDone = idx >= steps.length
  const step = !isPrep && !isDone ? steps[idx] : null

  return (
    <div className="min-h-screen flex flex-col pb-24" style={{ background: 'var(--color-bg)', ...FONT }}>
      <div className="max-w-[480px] w-full mx-auto flex-1 flex flex-col px-5 pt-6">
        {/* progress dots */}
        {!isDone && (
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {steps.map((s, i) => (
              <span
                key={s.n}
                className="rounded-full transition-all"
                style={{
                  width: i === idx ? 22 : 7,
                  height: 7,
                  background: i < idx || isPrep === false && i <= idx ? 'var(--color-primary-dark)' : 'var(--color-border)',
                }}
              />
            ))}
          </div>
        )}

        {isPrep && (
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
              Before you start · optional
            </p>
            <h2 className="text-2xl font-extrabold mb-4" style={{ color: 'var(--color-text)' }}>
              Mise en place 🧺
            </h2>
            <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <DeductionPreview />
            </div>
          </div>
        )}

        {step && (
          <div className="flex-1 flex flex-col justify-center text-center">
            <div className="text-5xl font-black mb-4" style={{ color: 'var(--color-primary-dark)' }}>
              {step.n}
            </div>
            <p className="text-xl font-semibold leading-relaxed mb-4" style={{ color: 'var(--color-text)' }}>
              {step.text}
            </p>
            {step.timerMin && <div className="flex justify-center"><TimerChip min={step.timerMin} /></div>}
          </div>
        )}

        {isDone && <div className="flex-1 flex items-center justify-center"><DoneState onExit={() => setExited(true)} /></div>}
      </div>

      {/* footer nav */}
      {!isDone && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-5 flex gap-3">
          <button
            onClick={() => setIdx((i) => i - 1)}
            disabled={isPrep}
            className="flex-1 rounded-full py-3 font-bold text-sm disabled:opacity-30"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            Back
          </button>
          <button
            onClick={() => setIdx((i) => i + 1)}
            className="flex-[2] rounded-full py-3 font-bold text-sm"
            style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
          >
            {isPrep ? 'Skip prep — start cooking' : idx === steps.length - 1 ? 'Finish cooking' : 'Next step'}
          </button>
        </div>
      )}
    </div>
  )
}

function ExitedNote() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', ...FONT }}>
      ← back in chat, banner cleared. (switch variant below to reset)
    </div>
  )
}
