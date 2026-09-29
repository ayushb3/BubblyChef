'use client'

// DEV-ONLY — see page.tsx for the production gate. Delete this whole folder
// once the real meal screen (a later ticket in issue #647's build order)
// mounts MealTimelineTable with real data and this fixture page is no
// longer needed for verification.

import { useMemo, useState } from 'react'
import MealTimelineTable, { timelineNotes } from '@/components/meal/MealTimelineTable'
import { scheduleMeal } from '@/lib/meal-scheduler'
import { resolveMealAnchor, formatClockTime } from '@/lib/meal-anchor'
import { ALL_MEAL_FIXTURES } from '@/lib/meal-fixtures'
import { COLUMN_ORDER } from '@/lib/meal-scheduler'

function defaultServeAtInput(now: Date): string {
  const in90 = new Date(now.getTime() + 90 * 60_000)
  return `${String(in90.getHours()).padStart(2, '0')}:${String(in90.getMinutes()).padStart(2, '0')}`
}

export default function MealTimelineDemoClient() {
  // Fixed for the life of this page load — not re-read per render, so the
  // demo doesn't drift while you're looking at it. Real code never reads
  // the clock inside the scheduler or anchor modules themselves; this is
  // the one place, in the UI, that has to.
  const [now] = useState(() => new Date())
  const [fixtureIndex, setFixtureIndex] = useState(0)
  const [mode, setMode] = useState<'start-now' | 'serve-at'>('start-now')
  const [serveAtInput, setServeAtInput] = useState(() => defaultServeAtInput(now))

  const fixture = ALL_MEAL_FIXTURES[fixtureIndex]

  const timeline = useMemo(() => scheduleMeal({ dishes: fixture.dishes, constraints: fixture.constraints }), [fixture])

  const columns = useMemo(
    () =>
      COLUMN_ORDER.filter((col) => fixture.dishes.some((d) => d.column === col)).map((col) => ({
        column: col,
        title: fixture.dishes.find((d) => d.column === col)!.title,
      })),
    [fixture],
  )

  const serveAt = useMemo(() => {
    if (mode !== 'serve-at') return undefined
    const [h, m] = serveAtInput.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return undefined
    const d = new Date(now)
    d.setHours(h, m, 0, 0)
    return d
  }, [mode, serveAtInput, now])

  const anchor = resolveMealAnchor({
    mode,
    total_minutes: timeline.total_minutes,
    now,
    serve_at: serveAt,
  })

  return (
    <div
      className="min-h-screen p-6 max-w-xl mx-auto space-y-6"
      style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}
    >
      <div>
        <h1 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--color-text)' }}>
          Meal timeline demo
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Issue #649 — dev-only fixture page for the deterministic meal scheduler.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Fixture meal
        </h2>
        <div className="flex flex-wrap gap-2">
          {ALL_MEAL_FIXTURES.map((f, i) => (
            <button
              key={f.slug}
              type="button"
              onClick={() => setFixtureIndex(i)}
              className="rounded-full px-3 py-1.5 text-xs font-bold border"
              style={{
                background: i === fixtureIndex ? 'var(--color-primary)' : 'var(--color-surface)',
                color: i === fixtureIndex ? '#fff' : 'var(--color-text)',
                borderColor: 'var(--color-border)',
              }}
              data-testid={`fixture-picker-${f.slug}`}
            >
              {f.title}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Start
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text)' }}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'start-now'}
              onChange={() => setMode('start-now')}
            />
            Start now
          </label>
          <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text)' }}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'serve-at'}
              onChange={() => setMode('serve-at')}
            />
            Serve at
          </label>
          {mode === 'serve-at' && (
            <input
              type="time"
              value={serveAtInput}
              onChange={(e) => setServeAtInput(e.target.value)}
              className="rounded-lg border px-2 py-1 text-sm"
              style={{ borderColor: 'var(--color-border)' }}
              aria-label="Serve at time"
            />
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Timeline — {timeline.total_minutes} min total, {timeline.hands_on_minutes} min hands-on
        </h2>
        {timeline.warnings.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--color-primary-dark)' }} data-testid="meal-timeline-warnings">
            {timelineNotes(timeline).join(' ')}
          </p>
        )}

        {anchor.status === 'too_late' ? (
          <div
            className="rounded-2xl border p-4 text-sm"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            data-testid="meal-timeline-too-late"
          >
            <p className="font-bold" style={{ color: 'var(--color-text)' }}>
              That&apos;s too soon — this meal needs {timeline.total_minutes} minutes.
            </p>
            <p style={{ color: 'var(--color-muted)' }}>
              The earliest it could be ready is {formatClockTime(anchor.earliest_ready_at)}.
            </p>
          </div>
        ) : (
          <MealTimelineTable timeline={timeline} columns={columns} anchor={anchor} />
        )}
      </section>
    </div>
  )
}
