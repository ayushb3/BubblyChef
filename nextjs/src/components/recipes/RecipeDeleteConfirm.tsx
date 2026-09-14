'use client'

import { useRef } from 'react'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'

interface RecipeDeleteConfirmProps {
  recipeTitle: string
  onConfirm: () => Promise<void>
  onCancel: () => void
  deleting: boolean
}

export default function RecipeDeleteConfirm({
  recipeTitle,
  onConfirm,
  onCancel,
  deleting,
}: RecipeDeleteConfirmProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // This swaps in for whatever "Delete" trigger opened it (usually inside an
  // overflow menu that closes/unmounts at the same time). Reusing the shared
  // hook here — rather than a one-off effect — is what gets requirement #5
  // (issue #291) for free: on mount, nothing inside this panel is focused
  // yet, so the hook deliberately moves focus onto the first focusable
  // element here (the "Delete" confirm button below) instead of letting it
  // fall back to <body>. Escape cancels, same as every other modal in the
  // app; Tab is trapped between "Delete" and "Cancel" while this is showing.
  useModalFocusTrap(true, onCancel, panelRef)

  return (
    <div
      ref={panelRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="recipe-delete-confirm-title"
      tabIndex={-1}
      className="flex items-center gap-3 mt-2 px-3 py-2.5 rounded-xl outline-none"
      style={{
        background: 'var(--color-bg)',
        border: '1.5px solid var(--color-border)',
        fontFamily: 'Nunito, sans-serif',
      }}
    >
      <span
        id="recipe-delete-confirm-title"
        className="text-sm flex-1 truncate"
        style={{ color: 'var(--color-text)' }}
      >
        Delete &ldquo;{recipeTitle}&rdquo;?
      </span>
      <button
        onClick={onConfirm}
        disabled={deleting}
        className="px-3 py-1 rounded-full text-xs font-bold disabled:opacity-50 active:scale-95 transition-transform"
        style={{
          color: 'var(--color-coral, #ff9aa2)',
          border: '1.5px solid var(--color-coral, #ff9aa2)',
          background: 'transparent',
          fontFamily: 'Nunito, sans-serif',
        }}
      >
        {deleting ? 'Deleting...' : 'Delete'}
      </button>
      <button
        onClick={onCancel}
        disabled={deleting}
        className="px-3 py-1 rounded-full text-xs font-bold disabled:opacity-50 active:scale-95 transition-transform"
        style={{
          color: 'var(--color-muted)',
          border: '1.5px solid var(--color-border)',
          background: 'transparent',
          fontFamily: 'Nunito, sans-serif',
        }}
      >
        Cancel
      </button>
    </div>
  )
}
