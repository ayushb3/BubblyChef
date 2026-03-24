// ButtonChip — interactive filter/tag chip
// Shadow present = interactive affordance (design-decisions §7)

type ChipColor = 'pink' | 'mint' | 'lavender' | 'peach' | 'coral';

interface ButtonChipProps {
  label: string;
  selected?: boolean;
  color?: ChipColor;
  onClick?: () => void;
  'aria-pressed'?: boolean;
}

const colorMap: Record<ChipColor, { idle: string; selected: string }> = {
  pink:     { idle: 'bg-pastel-pink text-soft-charcoal',     selected: 'bg-deep-pink text-white'     },
  mint:     { idle: 'bg-pastel-mint text-soft-charcoal',     selected: 'bg-deep-mint text-white'     },
  lavender: { idle: 'bg-pastel-lavender text-soft-charcoal', selected: 'bg-deep-lavender text-white' },
  peach:    { idle: 'bg-pastel-peach text-soft-charcoal',    selected: 'bg-deep-peach text-white'    },
  coral:    { idle: 'bg-pastel-coral text-soft-charcoal',    selected: 'bg-deep-coral text-white'    },
};

export function ButtonChip({ label, selected = false, color = 'pink', onClick, ...props }: ButtonChipProps) {
  const { idle, selected: sel } = colorMap[color];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`
        inline-flex items-center rounded-pill px-3 py-1.5 text-xs font-bold
        transition-all duration-150 active:scale-95
        ${selected ? `${sel} shadow-soft-lg` : `${idle} shadow-soft hover:shadow-soft-lg`}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-pink focus-visible:ring-offset-2
      `}
      {...props}
    >
      {label}
    </button>
  );
}

/** Display-only chip (non-interactive, no shadow) */
interface ButtonDisplayChipProps {
  label: string;
  className?: string;
}

export function ButtonDisplayChip({ label, className = '' }: ButtonDisplayChipProps) {
  return (
    <span className={`inline-flex items-center rounded-pill px-3 py-1 text-xs font-semibold bg-cream text-soft-charcoal ${className}`}>
      {label}
    </span>
  );
}
