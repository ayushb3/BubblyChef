'use client'

import type { ReactNode } from 'react'

interface PostMessageChipsProps {
  onSave?: () => void
  onTryAnother?: () => void
  onTellMore?: () => void
}

interface ChipProps {
  emoji: string
  onClick: () => void
  children: ReactNode
  variant?: 'primary' | 'accent' | 'muted'
}

function Chip({ emoji, onClick, children, variant = 'primary' }: ChipProps) {
  const variantClass =
    variant === 'primary'
      ? 'bg-[var(--color-primary)] text-white'
      : variant === 'accent'
        ? 'bg-[var(--color-accent)] text-[var(--color-text)]'
        : 'bg-[var(--color-surface)] text-[var(--color-muted)] border border-[var(--color-border)]'

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
        'transition-all active:scale-95 hover:opacity-90',
        variantClass,
      ].join(' ')}
    >
      <span>{emoji}</span>
      <span>{children}</span>
    </button>
  )
}

export default function PostMessageChips({
  onSave,
  onTryAnother,
  onTellMore,
}: PostMessageChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 mt-2 ml-10">
      {onSave && (
        <Chip variant="primary" emoji="🔖" onClick={onSave}>
          Save this
        </Chip>
      )}
      {onTryAnother && (
        <Chip variant="accent" emoji="🔄" onClick={onTryAnother}>
          Try another
        </Chip>
      )}
      {onTellMore && (
        <Chip variant="muted" emoji="💬" onClick={onTellMore}>
          Tell me more
        </Chip>
      )}
    </div>
  )
}
