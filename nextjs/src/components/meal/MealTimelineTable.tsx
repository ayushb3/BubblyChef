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
 * dish tagging, so they're named constants here.
 */

import type { Column, MealTimeline, RowCell, TimelineRow } from '@/lib/meal-scheduler'
import { anchoredTimeLabel, type MealAnchorResult } from '@/lib/meal-anchor'

const COLUMN_COLORS: Record<Column, string> = {
  main: '#FFB5C5', // pastel pink
  side_1: '#B5EAD7', // pastel mint
  side_2: '#FFDAB3', // pastel peach
}

const COLUMN_LABELS: Record<Column, string> = {
  main: 'Main',
  side_1: 'Side 1',
  side_2: 'Side 2',
}

export interface MealTimelineTableColumn {
  column: Column
  title: string
}

export interface MealTimelineTableProps {
  timeline: MealTimeline
  /** Only the columns actually present in the meal, in display order (one or two sides both work). */
  columns: MealTimelineTableColumn[]
  /** Defaults to `{ status: 'relative' }` — renders "+N min" offsets. */
  anchor?: MealAnchorResult
  className?: string
}

export default function MealTimelineTable({
  timeline,
  columns,
  anchor = { status: 'relative' },
  className,
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
          <div key={column} className="flex items-center gap-1.5 truncate">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: COLUMN_COLORS[column] }}
            />
            <span className="truncate">{title || COLUMN_LABELS[column]}</span>
          </div>
        ))}
      </div>

      <ul>
        {timeline.rows.map((row) => (
          <TimelineRowView key={row.offset_minutes} row={row} columns={columns} anchor={anchor} />
        ))}
      </ul>
    </div>
  )
}

function TimelineRowView({
  row,
  columns,
  anchor,
}: {
  row: TimelineRow
  columns: MealTimelineTableColumn[]
  anchor: MealAnchorResult
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
          <CellView key={column} column={column} cell={row.cells[column]} />
        ))}
      </div>
    </li>
  )
}

function CellView({ column, cell }: { column: Column; cell?: RowCell }) {
  if (!cell) {
    return <div />
  }

  const base = 'rounded-xl px-2 py-1.5 text-xs'
  const fontStyle = { fontFamily: 'Nunito, sans-serif' } as const

  switch (cell.kind) {
    case 'start':
      return (
        <div
          className={`${base} font-bold`}
          style={{
            background: `color-mix(in srgb, ${COLUMN_COLORS[column]} 45%, var(--color-surface))`,
            color: 'var(--color-text)',
            ...fontStyle,
          }}
          data-testid="meal-timeline-cell-start"
        >
          <span>{cell.hands_on ? '✋ ' : '⏳ '}{cell.label}</span>
          <div className="font-normal opacity-70 tabular-nums">{cell.duration_minutes} min</div>
        </div>
      )
    case 'ongoing':
      return (
        <div
          className={`${base} opacity-50`}
          style={{
            background: `color-mix(in srgb, ${COLUMN_COLORS[column]} 20%, var(--color-surface))`,
            color: 'var(--color-text)',
            ...fontStyle,
          }}
          data-testid="meal-timeline-cell-ongoing"
        >
          {cell.ongoing_label ?? cell.label}
          {' · '}
          <span className="tabular-nums">{cell.remaining_minutes} min</span> left
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
