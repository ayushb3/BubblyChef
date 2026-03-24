interface ExpiryBadgeProps {
  daysUntilExpiry: number | null;
}

export function ExpiryBadge({ daysUntilExpiry }: ExpiryBadgeProps) {
  const days = daysUntilExpiry;

  let className: string;
  let label: string;

  if (days === null) {
    className = 'bg-cream border border-border-input text-soft-charcoal/60 dark:bg-night-surface dark:border-night-border dark:text-night-secondary';
    label = 'No date';
  } else if (days < 0) {
    className = 'bg-deep-coral text-white';
    label = 'Expired';
  } else if (days === 0) {
    className = 'bg-pastel-coral text-white';
    label = 'Today!';
  } else if (days <= 3) {
    className = 'bg-pastel-peach text-soft-charcoal dark:bg-night-peach dark:text-white';
    label = days === 1 ? 'Tomorrow' : `${days} days`;
  } else {
    className = 'bg-pastel-mint text-soft-charcoal dark:bg-night-mint dark:text-white';
    if (days > 365) {
      label = '1 yr+';
    } else if (days > 180) {
      label = `${Math.round(days / 30)} mo`;
    } else {
      label = `${days} days`;
    }
  }

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}
