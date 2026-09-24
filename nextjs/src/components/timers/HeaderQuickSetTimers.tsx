'use client'

/**
 * Issue #495 — Spec B.3, shape C: header quick-set.
 *
 * Prep / Cook / Total buttons built from the recipe's own
 * `*_time_minutes` fields — only the fields that are actually set render a
 * button, per the acceptance criteria. Tapping one starts a timer named
 * after that field ("Prep · 10:00").
 */

import { useCookingTimers } from '@/lib/useCookingTimers'
import Chip from '@/components/ui/Chip'

export interface HeaderQuickSetTimersProps {
  prepTimeMinutes?: number | null
  cookTimeMinutes?: number | null
  totalTimeMinutes?: number | null
  className?: string
}

interface QuickSetField {
  key: 'prep' | 'cook' | 'total'
  label: string
  emoji: string
  minutes: number | null | undefined
}

export default function HeaderQuickSetTimers({
  prepTimeMinutes,
  cookTimeMinutes,
  totalTimeMinutes,
  className,
}: HeaderQuickSetTimersProps) {
  const { start } = useCookingTimers()

  const allFields: QuickSetField[] = [
    { key: 'prep', label: 'Prep', emoji: '\u{1FA9A}', minutes: prepTimeMinutes },
    { key: 'cook', label: 'Cook', emoji: '\u{1F373}', minutes: cookTimeMinutes },
    { key: 'total', label: 'Total', emoji: '⏱️', minutes: totalTimeMinutes },
  ]
  const fields = allFields.filter((f) => typeof f.minutes === 'number' && f.minutes > 0)

  if (fields.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`} data-testid="header-quick-set-timers">
      {fields.map((f) => (
        <Chip
          key={f.key}
          tone="primary"
          emoji={f.emoji}
          onClick={() => start(f.label, (f.minutes as number) * 60)}
          ariaLabel={`Start a ${f.minutes} minute ${f.label.toLowerCase()} timer`}
          size="sm"
        >
          {f.label} {f.minutes}m
        </Chip>
      ))}
    </div>
  )
}
