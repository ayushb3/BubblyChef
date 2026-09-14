// PROTOTYPE — throwaway. Variant A: Checklist column (Claude task-list idiom).
// All steps in ONE scrollable column. Current step emphasized; done steps
// checked + dimmed but still visible. Deduction preview = collapsible header
// block at the top (before cooking). Done-state appears when all steps checked.
'use client'

import { useState } from 'react'
import { MOCK_RECIPE } from './mock'
import { DeductionPreview, TimerChip, LockedRecipeCard, DoneState } from './shared'

const FONT = { fontFamily: 'Nunito, sans-serif' } as const

export default function VariantA() {
  const [done, setDone] = useState<Set<number>>(new Set())
  const [showPreview, setShowPreview] = useState(true)
  const [exited, setExited] = useState(false)
  const steps = MOCK_RECIPE.steps
  const allDone = done.size === steps.length
  const current = steps.find((s) => !done.has(s.n))

  if (exited) return <ExitedNote />

  const toggle = (n: number) =>
    setDone((prev) => {
      const next = new Set(prev)
      next.has(n) ? next.delete(n) : next.add(n)
      return next
    })

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--color-bg)', ...FONT }}>
      <div className="max-w-[480px] mx-auto px-4 pt-4 space-y-3">
        <LockedRecipeCard />

        {/* Collapsible deduction preview — sits before the steps (#267). */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold"
            style={{ color: 'var(--color-text)' }}
          >
            <span>🧺 Pantry impact</span>
            <span style={{ color: 'var(--color-muted)' }}>{showPreview ? 'Hide' : 'Show'}</span>
          </button>
          {showPreview && <div className="px-4 pb-4"><DeductionPreview compact /></div>}
        </div>

        {allDone ? (
          <div className="rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <DoneState onExit={() => setExited(true)} />
          </div>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-wide px-1" style={{ color: 'var(--color-muted)' }}>
              {done.size}/{steps.length} done — tap to check off
            </p>
            <div className="space-y-2">
              {steps.map((s) => {
                const isDone = done.has(s.n)
                const isCurrent = s.n === current?.n
                return (
                  <button
                    key={s.n}
                    onClick={() => toggle(s.n)}
                    className="w-full text-left rounded-2xl px-4 py-3 flex items-start gap-3 transition-all"
                    style={{
                      background: isCurrent ? 'var(--color-surface)' : 'transparent',
                      border: `1px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      boxShadow: isCurrent ? 'var(--shadow-soft)' : 'none',
                      opacity: isDone ? 0.5 : 1,
                    }}
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                      style={{
                        background: isDone ? 'var(--color-accent-dark)' : isCurrent ? 'var(--color-primary)' : 'var(--color-bg)',
                        color: isDone ? '#fff' : 'var(--color-text)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      {isDone ? '✓' : s.n}
                    </span>
                    <span className="flex-1 text-sm" style={{ color: 'var(--color-text)', textDecoration: isDone ? 'line-through' : 'none' }}>
                      {s.text}
                      {s.timerMin && <span className="ml-2 inline-block align-middle"><TimerChip min={s.timerMin} /></span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
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
