// PROTOTYPE — throwaway. Variant C: Hybrid strip + body.
// Tappable step-strip/timeline pinned at top (jump anywhere) + active step
// body below. Deduction shown INLINE per step ("this step uses X"), not as a
// separate preview. Densest / most navigable. Done via a persistent footer.
'use client'

import { useState } from 'react'
import { MOCK_RECIPE, MOCK_DEDUCTIONS, STATUS_META } from './mock'
import { TimerChip, DoneState } from './shared'

const FONT = { fontFamily: 'Nunito, sans-serif' } as const

export default function VariantC() {
  const steps = MOCK_RECIPE.steps
  const [active, setActive] = useState(0)
  const [exited, setExited] = useState(false)
  const [finished, setFinished] = useState(false)

  if (exited)
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', ...FONT }}>
        ← back in chat, banner cleared. (switch variant below to reset)
      </div>
    )

  const step = steps[active]
  // inline deduction: match this step's `uses` against the mock deductions
  const stepDeductions = MOCK_DEDUCTIONS.filter((d) => step.uses?.includes(d.ingredient))

  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--color-bg)', ...FONT }}>
      <div className="max-w-[480px] mx-auto">
        {/* pinned step strip */}
        <div className="sticky top-0 z-10 px-4 py-3 flex gap-2 overflow-x-auto" style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
          {steps.map((s, i) => (
            <button
              key={s.n}
              onClick={() => { setActive(i); setFinished(false) }}
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all"
              style={{
                background: i === active ? 'var(--color-primary)' : i < active ? 'var(--color-accent)' : 'var(--color-surface)',
                border: `1px solid ${i === active ? 'var(--color-primary-dark)' : 'var(--color-border)'}`,
                color: 'var(--color-text)',
              }}
            >
              {i < active ? '✓' : s.n}
            </button>
          ))}
        </div>

        {finished ? (
          <DoneState onExit={() => setExited(true)} />
        ) : (
          <div className="px-5 pt-6">
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>
              Step {step.n} of {steps.length}
            </p>
            <p className="text-lg font-semibold leading-relaxed mb-4" style={{ color: 'var(--color-text)' }}>
              {step.text}
              {step.timerMin && <span className="ml-2 inline-block align-middle"><TimerChip min={step.timerMin} /></span>}
            </p>

            {/* inline per-step deduction */}
            {stepDeductions.length > 0 && (
              <div className="rounded-2xl px-4 py-3 mb-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>
                  This step uses
                </p>
                {stepDeductions.map((d) => {
                  const m = STATUS_META[d.status]
                  return (
                    <div key={d.ingredient} className="flex items-center gap-2 text-sm py-0.5">
                      <span style={{ color: m.tone }} className="font-bold w-4 text-center">{m.emoji}</span>
                      <span style={{ color: 'var(--color-text)' }}>{d.ingredient}</span>
                      <span className="ml-auto text-[10px] font-bold uppercase" style={{ color: m.tone }}>{m.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* footer */}
      {!finished && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-5 flex gap-3">
          <button
            onClick={() => setActive((i) => Math.max(0, i - 1))}
            disabled={active === 0}
            className="flex-1 rounded-full py-3 font-bold text-sm disabled:opacity-30"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            Back
          </button>
          <button
            onClick={() => (active === steps.length - 1 ? setFinished(true) : setActive((i) => i + 1))}
            className="flex-[2] rounded-full py-3 font-bold text-sm"
            style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
          >
            {active === steps.length - 1 ? 'Finish cooking' : 'Next step'}
          </button>
        </div>
      )}
    </div>
  )
}
