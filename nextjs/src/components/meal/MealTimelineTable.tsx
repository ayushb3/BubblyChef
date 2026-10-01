'use client'

/**
 * Issue #649 — the timeline table: renders a `MealTimeline` (from
 * `@/lib/meal-scheduler`) as one column per dish and one row per moment
 * something starts. Restyled in the signature look (issue #745, Goal 3's
 * "meal timeline", drawn to the Signature "Timeline" board):
 *
 *  - one pastel per dish column, from the theme-invariant dish tokens, so a
 *    dish keeps its colour from its card to its column (`dish-style.ts`);
 *  - a step you do is SOLID (pastel fill, ink edge); a step that is just
 *    cooking is HATCHED (dashed muted edge over stripes) and never animates;
 *  - a "Now" line over the row being cooked, a Serve row closing the plan,
 *    and cues as plain-language glue between rows.
 *
 * `progress` (issue #653, additive) marks cells done/skipped/current for the
 * cook-along's timeline sheet. The scheduler and the cook-along logic are
 * unchanged; this file only draws their output.
 */

import type { ReactNode } from 'react'
import type { Column, MealTimeline, RowCell, SchedulerWarning, TimelineRow } from '@/lib/meal-scheduler'
import { anchoredTimeLabel, type MealAnchorResult } from '@/lib/meal-anchor'
import { DISH_BG, HATCHED, SOLID_EDGE } from './dish-style'

const COLUMN_LABELS: Record<Column, string> = {
  main: 'Main',
  side_1: 'Side 1',
  side_2: 'Side 2',
}

/** The time column is wide enough for "6:36 PM" and "+18 min". */
const grid = (columns: number) => ({ gridTemplateColumns: `3.5rem repeat(${columns}, minmax(0, 1fr))` })

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

/** `step_index` (contract 1b) only exists on the two cell kinds that map to an actual step. */
function cellStepIndex(cell: RowCell): number | undefined {
  if (cell.kind !== 'start' && cell.kind !== 'ongoing') return undefined
  return cell.step_index
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
      <p className="text-sm text-[var(--color-muted)]" data-testid="meal-timeline-empty">
        Nothing to cook yet.
      </p>
    )
  }

  // The first row holding the step being cooked gets the "Now" line.
  const current = progress?.current
  const nowOffset = current
    ? timeline.rows.find((row) => {
        const cell = row.cells[current.column]
        return cell != null && cellStepIndex(cell) === current.step_index
      })?.offset_minutes
    : undefined

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`} data-testid="meal-timeline-table">
      <div
        className="grid items-end gap-1.5 border-b-2 border-[color:var(--color-text)] pb-1.5 text-xs leading-[15px] font-extrabold"
        style={grid(columns.length)}
        data-testid="meal-timeline-lane-headers"
      >
        {/* The time track. It must be an in-flow grid item: an `sr-only` (absolutely positioned)
            child takes no cell, which slid every lane header one track left (issue #800). */}
        <span>
          <span className="sr-only">Time</span>
        </span>
        {columns.map(({ column, title }) => (
          <span key={column} data-column={column} className="flex min-w-0 flex-col gap-[3px]">
            <span
              aria-hidden="true"
              className={`h-2 rounded-full border-[1.5px] border-[color:var(--color-text)] ${DISH_BG[column]}`}
            />
            <span className="line-clamp-2 min-w-0 break-words text-[color:var(--color-text)]">
              {title || COLUMN_LABELS[column]}
            </span>
          </span>
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {timeline.rows.map((row) => (
          <TimelineRowView
            key={row.offset_minutes}
            row={row}
            columns={columns}
            anchor={anchor}
            progress={progress}
            isNow={row.offset_minutes === nowOffset}
          />
        ))}
        <li className="grid items-stretch gap-1.5" style={grid(columns.length)} data-testid="meal-timeline-serve-row">
          <TimeLabel>{anchoredTimeLabel(anchor, timeline.total_minutes)}</TimeLabel>
          {columns.map(({ column }) => (
            <div
              key={column}
              data-column={column}
              className="rounded-[10px] bg-[var(--color-text)] px-2 py-1.5 text-center text-xs font-extrabold text-[color:var(--color-surface)]"
            >
              Serve
            </div>
          ))}
        </li>
      </ul>
    </div>
  )
}

function TimeLabel({ children, done = false }: { children: ReactNode; done?: boolean }) {
  return (
    <span
      className={`pt-1.5 text-[13px] font-extrabold tabular-nums text-[color:var(--color-text)] ${done ? 'opacity-60' : ''}`}
    >
      {done && (
        <span aria-hidden="true" className="mr-0.5">
          ✓
        </span>
      )}
      {children}
    </span>
  )
}

function TimelineRowView({
  row,
  columns,
  anchor,
  progress,
  isNow,
}: {
  row: TimelineRow
  columns: MealTimelineTableColumn[]
  anchor: MealAnchorResult
  progress?: MealTimelineProgress
  isNow: boolean
}) {
  const timeLabel = anchoredTimeLabel(anchor, row.offset_minutes)
  // A row reads as done once every step cell in it is done or skipped.
  const stepStatuses = columns.flatMap(({ column }) => {
    const cell = row.cells[column]
    const idx = cell ? cellStepIndex(cell) : undefined
    return progress && idx != null ? [progress.statuses[`${column}:${idx}`]] : []
  })
  const rowDone = stepStatuses.length > 0 && stepStatuses.every((s) => s === 'done' || s === 'skipped')

  return (
    <li data-testid="meal-timeline-row" data-offset-minutes={row.offset_minutes} className="flex flex-col gap-1.5">
      {isNow && (
        <div role="presentation" aria-hidden="true" className="my-0.5 flex items-center" data-testid="meal-timeline-now-line">
          <span className="flex-none rounded-full bg-[var(--color-text)] px-2 py-0.5 text-xs leading-4 font-extrabold tabular-nums text-[color:var(--color-surface)]">
            Now · {timeLabel}
          </span>
          <span className="h-[3px] flex-1 bg-[var(--color-text)]" />
        </div>
      )}
      {row.cue && (
        <div
          className="ml-[3.875rem] self-start rounded-full border border-[color:var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs leading-4 font-bold text-[color:var(--color-text)] italic"
          data-testid="meal-timeline-cue"
        >
          {row.cue}
        </div>
      )}
      <div className="grid items-stretch gap-1.5" style={grid(columns.length)}>
        <TimeLabel done={rowDone}>{timeLabel}</TimeLabel>
        {columns.map(({ column }) => (
          <CellView key={column} column={column} cell={row.cells[column]} progress={progress} />
        ))}
      </div>
    </li>
  )
}

/**
 * Review round 1 (S5) — progress must never be colour-only: a visible marker
 * plus, for "done", an sr-only word backs every colour cue. `isRunning` is
 * scoped to hands-off cells — a running hands-on step is the Now card
 * elsewhere on the page, not something this table calls out separately.
 *
 * Issue #745: the current step's visible marker is now the row's "Now" line,
 * so the cell keeps only a screen-reader "Now" (plus the ring).
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
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {isCurrent && (
        <span className="sr-only" data-testid="meal-timeline-cell-now-marker">
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
        <span className="text-[10px] font-bold tracking-wide uppercase" data-testid="meal-timeline-cell-skipped-marker">
          skipped
        </span>
      )}
      {isRunning && (
        <span className="text-[10px] font-bold tracking-wide uppercase" data-testid="meal-timeline-cell-cooking-marker">
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
    return <div data-column={column} />
  }

  const base = 'rounded-[10px] px-2 py-1.5 text-[11px] leading-[14px] font-bold text-[color:var(--color-text)]'

  const stepIndex = cellStepIndex(cell)
  const status = progress && stepIndex != null ? progress.statuses[`${column}:${stepIndex}`] : undefined
  const isCurrent =
    !!progress?.current && progress.current.column === column && progress.current.step_index === stepIndex
  const isDone = status === 'done'
  const isSkipped = status === 'skipped'
  const isRunning = status === 'running' && (cell.kind === 'start' || cell.kind === 'ongoing') && !cell.hands_on
  // Review round 1 (S5) — the ring is `--color-text` (soft-charcoal), never
  // one of the pastel dish colours: it has to contrast against every dish's
  // own tinted fill, not blend into whichever one happens to be current.
  const progressStyle = isCurrent ? { boxShadow: '0 0 0 2px var(--color-text)' } : undefined
  // Done rows fade to 60% (the board's value); the hatching itself never animates.
  const faded = isDone || isSkipped ? 'opacity-60' : ''

  switch (cell.kind) {
    case 'start':
      return (
        <div
          className={`${base} ${SOLID_EDGE} ${DISH_BG[column]} ${faded}`}
          style={progressStyle}
          data-testid="meal-timeline-cell-start"
          data-look="solid"
          data-column={column}
          data-status={status}
          aria-current={isCurrent ? 'step' : undefined}
        >
          <span
            className="block text-[13px] leading-[17px] font-extrabold"
            style={isSkipped ? { textDecoration: 'line-through' } : undefined}
          >
            {cell.label}
          </span>
          <span className="block tabular-nums">
            {cell.hands_on ? '' : 'hands-off · '}
            {cell.duration_minutes} min
          </span>
          <CellMarkers isCurrent={isCurrent} isDone={isDone} isSkipped={isSkipped} isRunning={isRunning} />
        </div>
      )
    case 'ongoing':
      return (
        <div
          className={`${base} ${HATCHED} ${faded}`}
          style={progressStyle}
          data-testid="meal-timeline-cell-ongoing"
          data-look="hatched"
          data-column={column}
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
      // This dish hasn't started: a blank cell, said aloud for screen readers.
      return (
        <div data-testid="meal-timeline-cell-waiting" data-column={column}>
          <span className="sr-only">waiting to start</span>
        </div>
      )
    case 'done':
      return (
        <div className={`${base} ${HATCHED}`} data-testid="meal-timeline-cell-done" data-look="hatched" data-column={column}>
          done · keep warm
        </div>
      )
  }
}
