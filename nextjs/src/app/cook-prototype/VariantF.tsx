// PROTOTYPE — throwaway. Variant F: Multi-dish coordinated meal.
//
// Probes issue #289 (Spec B): "chat only proposes a single all-in-one dish;
// no notion of a meal with separate components." Transcribed from a real Gemini
// session (cumin potatoes + pork stir-fry, plated together).
//
// The question F answers: does E's step-card idiom survive a two-dish meal?
// It adds two things E lacks:
//   - a dish switcher (🥔 Potatoes | 🥩 Pork), each dish its own step list
//   - a PLATING TIMELINE strip — the cross-dish "potatoes first, hold, pork
//     last, plate together" coordination that has no home in BubblyChef today.
//
// Reuses E's card look. NOT folded into #263 (Spec A is single-dish); this
// informs how #289 should be shaped in Spec B.
'use client'

import { useState } from 'react'
import { MOCK_MEAL, MEAL_TIMELINE } from './mock'
import { TimerChip } from './shared'

const FONT = { fontFamily: 'Nunito, sans-serif' } as const

export default function VariantF() {
  const dishes = MOCK_MEAL.dishes
  const [dishIdx, setDishIdx] = useState(0)
  // per-dish step index so switching dishes keeps each one's place
  const [stepByDish, setStepByDish] = useState<number[]>(dishes.map(() => 0))

  const dish = dishes[dishIdx]
  const stepIdx = stepByDish[dishIdx]
  const step = dish.steps[stepIdx]

  const setStep = (di: number, si: number) =>
    setStepByDish((prev) => prev.map((v, i) => (i === di ? si : v)))

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)', ...FONT }}>
      <div className="max-w-[480px] w-full mx-auto px-5 pt-5 flex-1 flex flex-col">
        <p className="text-sm font-extrabold mb-3" style={{ color: 'var(--color-text)' }}>
          🍽️ {MOCK_MEAL.title}
        </p>

        {/* plating timeline — the cross-dish coordination (the #289 payload) */}
        <div className="rounded-2xl px-3 py-3 mb-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>
            Plating timeline
          </p>
          <div className="flex items-stretch gap-1">
            {MEAL_TIMELINE.map((seg, i) => (
              <div key={seg.label} className="flex-1 flex flex-col items-center text-center">
                <span className="text-base leading-none mb-1">{seg.dish}</span>
                <span className="text-[10px] font-bold leading-tight" style={{ color: 'var(--color-text)' }}>
                  {seg.label}
                </span>
                <span className="text-[9px] leading-tight mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {seg.note}
                </span>
                {i < MEAL_TIMELINE.length - 1 && (
                  <span className="text-[10px] mt-1" style={{ color: 'var(--color-border)' }}>
                    ▸
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* dish switcher */}
        <div className="flex gap-2 mb-4">
          {dishes.map((d, i) => (
            <button
              key={d.id}
              onClick={() => setDishIdx(i)}
              className="flex-1 rounded-2xl px-3 py-2.5 text-left transition-all"
              style={{
                background: i === dishIdx ? 'var(--color-primary)' : 'var(--color-surface)',
                border: `1px solid ${i === dishIdx ? 'var(--color-primary-dark)' : 'var(--color-border)'}`,
              }}
            >
              <span className="text-lg">{d.emoji}</span>
              <span className="block text-xs font-bold leading-tight mt-0.5" style={{ color: 'var(--color-text)' }}>
                {d.title}
              </span>
              <span className="block text-[10px]" style={{ color: 'var(--color-muted)' }}>
                {d.pan} · {stepByDish[i] + 1}/{d.steps.length}
              </span>
            </button>
          ))}
        </div>

        {/* active dish step card (E's idiom) */}
        <div className="flex-1 flex items-start justify-center">
          <div className="w-full rounded-3xl px-5 py-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-soft)' }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--color-accent)', color: 'var(--color-text)' }}>
                {step.n}
              </span>
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                {dish.emoji} Step {step.n} of {dish.steps.length}
              </span>
              {step.timerMin && <span className="ml-auto"><TimerChip min={step.timerMin} /></span>}
            </div>
            <p className="text-lg font-semibold leading-relaxed" style={{ color: 'var(--color-text)' }}>
              {step.text}
            </p>
          </div>
        </div>
      </div>

      {/* footer — advances the ACTIVE dish only */}
      <div className="sticky bottom-0 w-full">
        <div className="max-w-[480px] mx-auto px-5 py-4 flex gap-3" style={{ background: 'linear-gradient(to top, var(--color-bg) 70%, transparent)' }}>
          <button
            onClick={() => setStep(dishIdx, Math.max(0, stepIdx - 1))}
            disabled={stepIdx === 0}
            className="flex-1 rounded-full py-3 font-bold text-sm disabled:opacity-30"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            Back
          </button>
          <button
            onClick={() => setStep(dishIdx, Math.min(dish.steps.length - 1, stepIdx + 1))}
            disabled={stepIdx === dish.steps.length - 1}
            className="flex-[2] rounded-full py-3 font-bold text-sm disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
          >
            {stepIdx === dish.steps.length - 1 ? `${dish.emoji} dish done — switch dishes above` : 'Next step'}
          </button>
        </div>
      </div>
    </div>
  )
}
