'use client'

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
  return (
    <div
      className="flex items-center gap-3 mt-2 px-3 py-2.5 rounded-xl"
      style={{
        background: 'var(--color-bg)',
        border: '1.5px solid var(--color-border)',
        fontFamily: 'Nunito, sans-serif',
      }}
    >
      <span
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
