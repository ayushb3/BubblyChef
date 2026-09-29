'use client'

/**
 * Issue #649 — the timeline table: renders a `MealTimeline` (from
 * `@/lib/meal-scheduler`) as one column per dish and one row per moment
 * something starts. Functional UI on existing tokens per #647's "all UI in
 * these tickets is functional UI built on the existing components" note —
 * final visual design is Goal 3, on the Claude Design canvas.
 *
 * Column colours are the CLAUDE.md Sanrio pastel trio (pink/mint/peach),
 * fixed regardless of the user's active kitchen theme, so "main" always
 * reads as pink etc. — there's no existing design token for this three-way
 * dish tagging, so they're named constants here. Exported (issue #653) so
 * the cook-along components (`MealNowCard`, `MealNextUp`,
 * `MealRunningStrip`) tag a dish with the same colour the table does.
 *
 * `progress` (issue #653, additive) marks cells done/skipped/current for the
 * cook-along's timeline sheet. With no `progress`, output is byte-for-byte
 * unchanged from #649 — every existing test keeps passing.
 */

import type { Column, MealTimeline, RowCell, SchedulerWarning, TimelineRow } from '@/lib/meal-scheduler'
import { anchoredTimeLabel, type MealAnchorResult } from '@/lib/meal-anchor'

export const COLUMN_COLORS: Record<Column, string> = {
  main: '#FFB5C5', // pastel pink
  side_1: '#B5EAD7', // pastel mint
  side_2: '#FFDAB3', // pastel peach
}

const COLUMN_LABELS: Record<Column, string> = {
  main: 'Main',
  side_1: 'Side 1',
  side_2: 'Side 2',
}

/**
 * Plain-language notes for a timeline's warnings. The scheduler's warnings
 * are machine codes; this is the one place they become copy, so the fixture
 * page and the real meal screen say the same thing.
 */
export function timelineNotes(timeline: MealTimeline): string[] {
  const copy: Record<SchedulerWarning, string> = {
    finish_spread: `The dishes finish up to ${timeline.finish_spread_minutes} min apart: the steps can't line up any closer.`,
    estimated_duration: 'Some step times are estimates.',
    sequential_fallback: "One dish's steps run strictly in order, because their order couldn't be read.",
  }
  return timeline.warnings.map((w) => copy[w])
}

export interface MealTimelineTableColumn {
  column: Column
  title: string
}

/**
 * Issue #653 — cook-along cell marking. `statuses` is keyed
 * `${column}:${step_index}` (the column, not `dish_id` — this table already
 * indexes everything by column). `current` rings the one cell in progress;
 * `done`/`skipped` fade the rest (skipped also strikes the label through).
 */
export interface MealTimelineProgress {
  statuses: Record<string, 'done' | 'skipped' | 'running'>
  current?: { column: Column; step_index: number }
}

export interface MealTimelineTableProps {
  timeline: MealTimeline
  /** Only the columns actually present in the meal, in display order (one or two sides both work). */
  columns: MealTimelineTableColumn[]
  /** Defaults to `{ status: 'relative' }` — renders "+N min" offsets. */
  anchor?: MealAnchorResult
  className?: string
  /** Additive (issue #653) — omitted, the table renders exactly as #649 left it. */
  progress?: MealTimelineProgress
}

export default function MealTimelineTable({
  timeline,
  columns,
  anchor = { status: 'relative' },
  className,
  progress,
}: MealTimelineTableProps) {
  if (timeline.rows.length === 0) {
    return (
      <p
        className="text-sm text-[var(--color-muted)]"
        style={{ fontFamily: 'Nunito, sans-serif' }}
        data-testid="meal-timeline-empty"
      >
        Nothing to cook yet.
      </p>
    )
  }

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${className ?? ''}`}
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      data-testid="meal-timeline-table"
    >
      <div
        className="grid text-xs font-bold px-3 py-2"
        style={{
          gridTemplateColumns: `4.5rem repeat(${columns.length}, 1fr)`,
          background: 'var(--color-bg)',
          fontFamily: 'Nunito, sans-serif',
        }}
      >
        <div className="text-[var(--color-muted)]">Time</div>
        {columns.map(({ column, title }) => (
          <div key={column} className="flex items-start gap-1.5 min-w-0">
            <span
              aria-hidden="true"
              className="mt-1 inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: COLUMN_COLORS[column] }}
            />
            <span className="min-w-0 break-words line-clamp-2">{title || COLUMN_LABELS[column]}</span>
          </div>
        ))}
      </div>

      <ul>
        {timeline.rows.map((row) => (
          <TimelineRowView key={row.offset_minutes} row={row} columns={columns} anchor={anchor} progress={progress} />
        ))}
      </ul>
    </div>
  )
}

function TimelineRowView({
  row,
  columns,
  anchor,
  progress,
}: {
  row: TimelineRow
  columns: MealTimelineTableColumn[]
  anchor: MealAnchorResult
  progress?: MealTimelineProgress
}) {
  return (
    <li
      className="border-t"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="meal-timeline-row"
      data-offset-minutes={row.offset_minutes}
    >
      {row.cue && (
        <div
          className="px-3 pt-2 text-[11px] italic"
          style={{ color: 'var(--color-primary-dark)', fontFamily: 'Nunito, sans-serif' }}
          data-testid="meal-timeline-cue"
        >
          💡 {row.cue}
        </div>
      )}
      <div
        className="grid px-3 py-2 gap-1.5 items-start"
        style={{ gridTemplateColumns: `4.5rem repeat(${columns.length}, 1fr)` }}
      >
        <div
          className="text-xs font-bold tabular-nums pt-2"
          style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
        >
          {anchoredTimeLabel(anchor, row.offset_minutes)}
        </div>
        {columns.map(({ column }) => (
          <CellView key={column} column={column} cell={row.cells[column]} progress={progress} />
        ))}
      </div>
    </li>
  )
}

/** `step_index` (contract 1b) only exists on the two cell kinds that map to an actual step. */
function cellStepIndex(cell: RowCell): number | undefined {
  if (cell.kind !== 'start' && cell.kind !== 'ongoing') return undefined
  return cell.step_index
}

/**
 * Review round 1 (S5) — progress must never be colour-only: a visible marker
 * plus, for "done", an sr-only word backs every colour cue. `isRunning` is
 * scoped to hands-off cells — a running hands-on step is the Now card
 * elsewhere on the page, not something this table calls out separately.
 */
function CellMarkers({
  isCurrent,
  isDone,
  isSkipped,
  isRunning,
}: {
  isCurrent: boolean
  isDone: boolean
  isSkipped: boolean
  isRunning: boolean
}) {
  if (!isCurrent && !isDone && !isSkipped && !isRunning) return null
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {isCurrent && (
        <span
          className="text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
          style={{ background: 'var(--color-text)', color: 'var(--color-surface)' }}
          data-testid="meal-timeline-cell-now-marker"
        >
          Now
        </span>
      )}
      {isDone && (
        <span className="text-xs font-bold" data-testid="meal-timeline-cell-done-marker">
          <span aria-hidden="true">✓</span>
          <span className="sr-only"> done</span>
        </span>
      )}
      {isSkipped && (
        <span
          className="text-[10px] font-bold uppercase tracking-wide"
          data-testid="meal-timeline-cell-skipped-marker"
        >
          skipped
        </span>
      )}
      {isRunning && (
        <span
          className="text-[10px] font-bold uppercase tracking-wide"
          data-testid="meal-timeline-cell-cooking-marker"
        >
          cooking
        </span>
      )}
    </div>
  )
}

function CellView({
  column,
  cell,
  progress,
}: {
  column: Column
  cell?: RowCell
  progress?: MealTimelineProgress
}) {
  if (!cell) {
    return <div />
  }

  const base = 'rounded-xl px-2 py-1.5 text-xs'
  const fontStyle = { fontFamily: 'Nunito, sans-serif' } as const

  const stepIndex = cellStepIndex(cell)
  const status =
    progress && stepIndex != null ? progress.statuses[`${column}:${stepIndex}`] : undefined
  const isCurrent =
    !!progress?.current &&
    progress.current.column === column &&
    progress.current.step_index === stepIndex
  const isDone = status === 'done'
  const isSkipped = status === 'skipped'
  const isRunning =
    status === 'running' && (cell.kind === 'start' || cell.kind === 'ongoing') && !cell.hands_on
  // Review round 1 (S5) — the ring is `--color-text` (soft-charcoal), never
  // one of the pastel dish colours: it has to contrast against every dish's
  // own tinted fill, not blend into whichever one happens to be current.
  const progressStyle = isCurrent ? { boxShadow: '0 0 0 2px var(--color-text)' } : undefined

  switch (cell.kind) {
    case 'start':
      return (
        <div
          className={`${base} font-bold ${isDone || isSkipped ? 'opacity-40' : ''}`}
          style={{
            background: `color-mix(in srgb, ${COLUMN_COLORS[column]} 45%, var(--color-surface))`,
            color: 'var(--color-text)',
            ...progressStyle,
            ...fontStyle,
          }}
          data-testid="meal-timeline-cell-start"
          data-status={status}
          aria-current={isCurrent ? 'step' : undefined}
        >
          <span style={isSkipped ? { textDecoration: 'line-through' } : undefined}>
            {cell.hands_on ? '✋ ' : '⏳ '}
            {cell.label}
          </span>
          <div className="font-normal opacity-70 tabular-nums">{cell.duration_minutes} min</div>
          <CellMarkers isCurrent={isCurrent} isDone={isDone} isSkipped={isSkipped} isRunning={isRunning} />
        </div>
      )
    case 'ongoing':
      return (
        <div
          className={`${base} ${isDone || isSkipped ? 'opacity-30' : 'opacity-50'}`}
          style={{
            background: `color-mix(in srgb, ${COLUMN_COLORS[column]} 20%, var(--color-surface))`,
            color: 'var(--color-text)',
            ...progressStyle,
            ...fontStyle,
          }}
          data-testid="meal-timeline-cell-ongoing"
          data-status={status}
          aria-current={isCurrent ? 'step' : undefined}
        >
          <span style={isSkipped ? { textDecoration: 'line-through' } : undefined}>
            {cell.ongoing_label ?? cell.label}
          </span>
          {' · '}
          <span className="tabular-nums">{cell.remaining_minutes} min</span> left
          <CellMarkers isCurrent={isCurrent} isDone={isDone} isSkipped={isSkipped} isRunning={isRunning} />
        </div>
      )
    case 'waiting':
      return (
        <div
          className={base}
          style={{ color: 'var(--color-muted)', ...fontStyle }}
          data-testid="meal-timeline-cell-waiting"
        >
          waiting…
        </div>
      )
    case 'done':
      return (
        <div
          className={base}
          style={{ color: 'var(--color-muted)', ...fontStyle }}
          data-testid="meal-timeline-cell-done"
        >
          ✓ done
        </div>
      )
  }
}
