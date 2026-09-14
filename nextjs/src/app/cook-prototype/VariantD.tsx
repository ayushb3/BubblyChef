// PROTOTYPE — throwaway. Variant D: Chat-anchored bottom sheet.
// The distinguishing idea: steps live in a persistent bottom sheet OVER the
// chat thread. Chat stays reachable behind it, so "ask Bubbles about this
// step" needs no context switch — you drag the sheet down, type, drag back up.
// Deduction preview lives in the sheet's expanded ("peek up") state.
'use client'

import { useState } from 'react'
import { MOCK_RECIPE } from './mock'
import { DeductionPreview, TimerChip, DoneState } from './shared'

const FONT = { fontFamily: 'Nunito, sans-serif' } as const

export default function VariantD() {
  const steps = MOCK_RECIPE.steps
  const [idx, setIdx] = useState(0)
  const [expanded, setExpanded] = useState(false) // sheet raised to show pantry impact
  const [finished, setFinished] = useState(false)
  const [exited, setExited] = useState(false)

  if (exited)
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', ...FONT }}>
        ← back in chat, banner cleared. (switch variant below to reset)
      </div>
    )

  const step = steps[idx]

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'var(--color-bg)', ...FONT }}>
      {/* faux chat thread behind the sheet */}
      <div className="max-w-[480px] mx-auto px-4 pt-6 pb-[340px] space-y-3">
        <FauxBubble who="bot">Cooking {MOCK_RECIPE.title} {MOCK_RECIPE.emoji} — I’m here if a step needs a hand.</FauxBubble>
        <FauxBubble who="me">what can I use instead of cream?</FauxBubble>
        <FauxBubble who="bot">A quick roux — melt butter, whisk in flour, then milk. I’ve swapped it into your steps. 👩‍🍳</FauxBubble>
        <p className="text-center text-xs pt-4" style={{ color: 'var(--color-muted)' }}>
          ↑ chat stays live behind the sheet — tap the thread to ask about the current step
        </p>
      </div>

      {/* bottom sheet */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] rounded-t-3xl transition-all"
        style={{
          background: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
          boxShadow: '0 -8px 32px rgba(0,0,0,.12)',
          maxHeight: expanded ? '70vh' : 'auto',
          paddingBottom: 72,
        }}
      >
        {/* grabber */}
        <button onClick={() => setExpanded((v) => !v)} className="w-full flex flex-col items-center pt-2 pb-1">
          <span className="w-10 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }} />
          <span className="text-[10px] font-bold uppercase mt-1" style={{ color: 'var(--color-muted)' }}>
            {expanded ? 'Hide pantry impact' : 'Pantry impact ▾'}
          </span>
        </button>

        {expanded && (
          <div className="px-5 pb-3 overflow-y-auto" style={{ maxHeight: '38vh' }}>
            <DeductionPreview />
          </div>
        )}

        <div className="px-5 pt-1">
          {finished ? (
            <DoneState onExit={() => setExited(true)} />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                  Step {step.n}/{steps.length}
                </span>
                {step.timerMin && <TimerChip min={step.timerMin} />}
              </div>
              <p className="text-base font-semibold leading-relaxed mb-3" style={{ color: 'var(--color-text)' }}>
                {step.text}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setIdx((i) => Math.max(0, i - 1))}
                  disabled={idx === 0}
                  className="flex-1 rounded-full py-2.5 font-bold text-sm disabled:opacity-30"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  Back
                </button>
                <button
                  onClick={() => (idx === steps.length - 1 ? setFinished(true) : setIdx((i) => i + 1))}
                  className="flex-[2] rounded-full py-2.5 font-bold text-sm"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
                >
                  {idx === steps.length - 1 ? 'Finish cooking' : 'Next step'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FauxBubble({ who, children }: { who: 'me' | 'bot'; children: React.ReactNode }) {
  const me = who === 'me'
  return (
    <div className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div
        className="rounded-2xl px-3.5 py-2 text-sm max-w-[80%]"
        style={{
          background: me ? 'var(--color-primary)' : 'var(--color-surface)',
          border: me ? 'none' : '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
