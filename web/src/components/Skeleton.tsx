// Skeleton loading primitives

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  className?: string;
}

export function Skeleton({ width = '100%', height = '20px', borderRadius = '12px', className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton dark:skeleton-dark ${className}`}
      style={{ width, height, borderRadius }}
      aria-hidden="true"
    />
  );
}

/** Mimics CardPantryItem layout */
export function CardSkeleton() {
  return (
    <div
      className="bg-white dark:bg-night-surface rounded-2xl p-3 shadow-soft"
      aria-busy="true"
      aria-label="Loading item"
    >
      <div className="flex flex-col items-center gap-2">
        <div className="skeleton dark:skeleton-dark w-10 h-10 rounded-full" />
        <div className="skeleton dark:skeleton-dark w-4/5 h-4 rounded-lg" />
        <div className="skeleton dark:skeleton-dark w-1/2 h-3 rounded-lg" />
        <div className="skeleton dark:skeleton-dark w-16 h-5 rounded-full" />
      </div>
    </div>
  );
}

/** Mimics CardExpiry row */
export function ListItemSkeleton() {
  return (
    <div className="flex items-center justify-between p-3" aria-busy="true" aria-label="Loading item">
      <div className="flex items-center gap-3">
        <div className="skeleton dark:skeleton-dark w-8 h-8 rounded-full" />
        <div className="flex flex-col gap-1">
          <div className="skeleton dark:skeleton-dark w-32 h-4 rounded-lg" />
          <div className="skeleton dark:skeleton-dark w-16 h-3 rounded-lg" />
        </div>
      </div>
      <div className="skeleton dark:skeleton-dark w-16 h-6 rounded-full" />
    </div>
  );
}

/** Chat bubble skeleton — user (right-aligned) */
export function ChatBubbleSkeletonUser() {
  return (
    <div className="flex justify-end mb-2" aria-hidden="true">
      <div className="skeleton dark:skeleton-dark h-10 rounded-2xl rounded-br-sm" style={{ width: '60%' }} />
    </div>
  );
}

/** Chat bubble skeleton — assistant (left-aligned with avatar) */
export function ChatBubbleSkeletonAssistant() {
  return (
    <div className="flex items-end gap-2 mb-2" aria-hidden="true">
      <div className="skeleton dark:skeleton-dark w-6 h-6 rounded-full flex-shrink-0" />
      <div className="skeleton dark:skeleton-dark h-12 rounded-2xl rounded-bl-sm" style={{ width: '70%' }} />
    </div>
  );
}
