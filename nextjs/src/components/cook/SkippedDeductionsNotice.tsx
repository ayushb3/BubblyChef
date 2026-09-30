'use client'

/**
 * Issue #621 — tells the cook which pantry items the server refused to
 * deduct (row deleted in another tab, no base unit). The cook itself landed,
 * so this is a heads-up in the success state, not an error. Presentational:
 * the caller resolves ids to names (`lib/cook-skipped.ts`).
 *
 * Names at most `MAX_NAMED`; the rest (including ids that couldn't be
 * resolved to a name) read "and N more". Renders nothing at zero.
 */

export interface SkippedDeductionsNoticeProps {
  names: string[]
  /** Ids the caller couldn't resolve to a name. */
  unnamed: number
}

const MAX_NAMED = 3

export default function SkippedDeductionsNotice({ names, unnamed }: SkippedDeductionsNoticeProps) {
  const total = names.length + unnamed
  if (total <= 0) return null

  const shown = names.slice(0, MAX_NAMED)
  const more = total - shown.length
  const list =
    shown.length > 0 ? `: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}` : ''

  return (
    <div
      role="status"
      data-testid="skipped-deductions-notice"
      className="w-full rounded-2xl px-4 py-3 text-left text-xs font-semibold leading-relaxed break-words"
      style={{
        background: 'color-mix(in srgb, var(--color-coral) 12%, var(--color-surface))',
        border: '1.5px solid color-mix(in srgb, var(--color-coral) 45%, var(--color-border))',
        color: 'var(--color-text)',
        fontFamily: 'Nunito, sans-serif',
      }}
    >
      <span aria-hidden="true">⚠️ </span>
      {`Couldn't update ${total} ${total === 1 ? 'item' : 'items'}${list}. Check your pantry.`}
    </div>
  )
}
