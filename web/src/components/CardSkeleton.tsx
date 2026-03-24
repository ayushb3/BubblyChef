export function CardSkeleton() {
  return (
    <div
      className="bg-white dark:bg-night-surface rounded-2xl p-3 shadow-soft"
      aria-busy="true"
      aria-label="Loading item"
    >
      <div className="flex flex-col items-center gap-2">
        {/* Emoji placeholder */}
        <div className="skeleton w-10 h-10 rounded-full" />
        {/* Name line */}
        <div className="skeleton w-4/5 h-4 rounded-lg" />
        {/* Qty line */}
        <div className="skeleton w-1/2 h-3 rounded-lg" />
        {/* Badge placeholder */}
        <div className="skeleton w-16 h-5 rounded-full" />
      </div>
    </div>
  );
}
