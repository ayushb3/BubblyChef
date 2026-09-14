// PROTOTYPE — throwaway. Variant E: Recipe-native card (the recommendation).
//
// Composed from the winning bits of the other four:
//   - B's one-step-at-a-time focus, BUT the step lives in a content-SIZED card
//     floating in the flow — no full-page dead space when a step is short.
//   - A's check-off satisfaction: progress dots fill ✓ as steps complete.
//   - C's per-step ingredient list ("You'll need"), reframed as recipe language.
//   - D's intent (ask Bubbles mid-cook) as a persistent per-step button that
//     opens a chat overlay and returns you to the same step — chat always one
//     tap away, no heavy bottom sheet.
//
// Pantry framing: the section is "You'll need" (a normal recipe would say
// this). The pantry subtraction is demoted to a grey sub-line shown ONLY when
// notable (substitute / missing / approx) — clean matches get no sub-line, so
// it reads like a recipe, not an inventory diff.
'use client'

import { useState } from 'react'
import { MOCK_RECIPE, notableNote } from './mock'
import { TimerChip, DeductionPreview, DoneState } from './shared'

const FONT = { fontFamily: 'Nunito, sans-serif' } as const
const PREP = -1

export default function VariantE() {
  const steps = MOCK_RECIPE.steps
  const [idx, setIdx] = useState<number>(PREP)
  const [chatOpen, setChatOpen] = useState(false)
  const [exited, setExited] = useState(false)

  if (exited)
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', ...FONT }}>
        ← back in chat, banner cleared. (switch variant below to reset)
      </div>
    )

  const isPrep = idx === PREP
  const isDone = idx >= steps.length
  const step = !isPrep && !isDone ? steps[idx] : null

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)', ...FONT }}>
      {/* header: title + progress dots that fill ✓ (A) */}
      {!isDone && (
        <div className="max-w-[480px] w-full mx-auto px-5 pt-5">
          <p className="text-sm font-extrabold mb-3" style={{ color: 'var(--color-text)' }}>
            {MOCK_RECIPE.emoji} {MOCK_RECIPE.title}
          </p>
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => {
              const complete = !isPrep && i < idx
              const currentDot = !isPrep && i === idx
              return (
                <span
                  key={s.n}
                  className="rounded-full flex items-center justify-center transition-all"
                  style={{
                    width: currentDot ? 24 : 16,
                    height: 16,
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#fff',
                    background: complete ? 'var(--color-accent-dark)' : currentDot ? 'var(--color-primary-dark)' : 'var(--color-border)',
                  }}
                >
                  {complete ? '✓' : ''}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* body — content-sized card, vertically centred but NOT stretched */}
      <div className="flex-1 flex items-center justify-center px-5 py-6">
        <div className="w-full max-w-[440px]">
          {isPrep && (
            <div className="rounded-3xl px-5 py-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-soft)' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                Before you start · optional
              </p>
              <h2 className="text-xl font-extrabold mb-3" style={{ color: 'var(--color-text)' }}>
                Get your ingredients ready 🧺
              </h2>
              <DeductionPreview compact />
            </div>
          )}

          {step && (
            <div className="rounded-3xl px-5 py-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-soft)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
                >
                  {step.n}
                </span>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                  Step {step.n} of {steps.length}
                </span>
                {step.timerMin && <span className="ml-auto"><TimerChip min={step.timerMin} /></span>}
              </div>

              <p className="text-lg font-semibold leading-relaxed mb-4" style={{ color: 'var(--color-text)' }}>
                {step.text}
              </p>

              {/* "You'll need" — recipe framing; pantry note only when notable */}
              {step.uses && step.uses.length > 0 && (
                <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--color-bg)' }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>
                    You&rsquo;ll need
                  </p>
                  {step.uses.map((ing) => {
                    const note = notableNote(ing)
                    return (
                      <div key={ing} className="py-0.5">
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                          {ing}
                        </span>
                        {note && (
                          <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                            {note}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* persistent ask-Bubbles — chat always one tap away (D) */}
              <button
                onClick={() => setChatOpen(true)}
                className="mt-4 w-full rounded-full py-2 text-sm font-bold flex items-center justify-center gap-2"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text)' }}
              >
                💬 Ask Bubbles about this step
              </button>
            </div>
          )}

          {isDone && (
            <div className="rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <DoneState onExit={() => setExited(true)} />
            </div>
          )}
        </div>
      </div>

      {/* footer nav */}
      {!isDone && (
        <div className="sticky bottom-0 w-full">
          <div className="max-w-[480px] mx-auto px-5 py-4 flex gap-3" style={{ background: 'linear-gradient(to top, var(--color-bg) 70%, transparent)' }}>
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
        </div>
      )}

      {/* chat overlay — slides up, returns you to the same step on close */}
      {chatOpen && (
        <div className="fixed inset-0 z-[9998] flex flex-col justify-end" style={{ background: 'var(--color-backdrop)' }} onClick={() => setChatOpen(false)}>
          <div
            className="w-full max-w-[480px] mx-auto rounded-t-3xl px-5 pt-3 pb-6"
            style={{ background: 'var(--color-surface)', maxHeight: '75vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center mb-3">
              <span className="w-10 h-1.5 rounded-full mx-auto" style={{ background: 'var(--color-border)' }} />
            </div>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>
              Asking about step {step?.n ?? '—'}
            </p>
            <div className="space-y-2 mb-4">
              <Bubble who="me">Can I skip the simmering?</Bubble>
              <Bubble who="bot">You can, but the sauce stays thin — 8 minutes lets it reduce and cling to the pasta. 🍅</Bubble>
            </div>
            <div className="flex gap-2">
              <input
                placeholder="Ask about this step…"
                className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
              <button className="rounded-full px-4 font-bold text-sm" style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}>
                Send
              </button>
            </div>
            <button onClick={() => setChatOpen(false)} className="mt-3 w-full text-sm font-bold" style={{ color: 'var(--color-muted)' }}>
              ↓ Back to step {step?.n ?? ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Bubble({ who, children }: { who: 'me' | 'bot'; children: React.ReactNode }) {
  const me = who === 'me'
  return (
    <div className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div
        className="rounded-2xl px-3.5 py-2 text-sm max-w-[80%]"
        style={{
          background: me ? 'var(--color-primary)' : 'var(--color-bg)',
          border: me ? 'none' : '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
