import { useState } from 'react';
import { motion } from 'framer-motion';
import type { PantryItem } from '../types';

interface KitchenItemProps {
  item: PantryItem;
  position: { top: string; left: string };
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

const CATEGORY_EMOJI: Record<string, string> = {
  produce: '\u{1F34E}',
  dairy: '\u{1F95B}',
  meat: '\u{1F357}',
  seafood: '\u{1F41F}',
  frozen: '\u{1F9CA}',
  canned: '\u{1F96B}',
  dry_goods: '\u{1F4E6}',
  condiments: '\u{1F9C8}',
  beverages: '\u{1F375}',
  snacks: '\u{1F37F}',
  bakery: '\u{1F35E}',
  other: '\u{2753}',
};

function getExpiryColor(days: number | null): string {
  if (days === null) return '#ccc';
  if (days <= 0) return '#ff6b6b';
  if (days <= 2) return '#ffa94d';
  if (days <= 5) return '#ffd43b';
  return '#69db7c';
}

function KitchenItemIcon({ item }: { item: PantryItem }) {
  const [useEmoji, setUseEmoji] = useState(false);
  const emoji = CATEGORY_EMOJI[item.category] ?? CATEGORY_EMOJI.other;
  const iconUrl = `/api/icons/${encodeURIComponent(item.name.toLowerCase().trim())}`;

  if (useEmoji) return <span className="text-xl leading-none">{emoji}</span>;
  return (
    <img
      src={iconUrl}
      alt={item.name}
      className="w-8 h-8"
      onError={() => setUseEmoji(true)}
    />
  );
}

export function KitchenItem({ item, position, onClick, draggable, onDragStart }: KitchenItemProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    onDragStart?.(e);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <motion.button
      className={`absolute flex flex-col items-center gap-0.5 transition-opacity ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${isDragging ? 'opacity-40' : ''}`}
      style={{ top: position.top, left: position.left }}
      whileHover={{ scale: 1.15, y: -2 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      draggable={draggable}
      onDragStart={handleDragStart as any}
      onDragEnd={handleDragEnd as any}
    >
      <KitchenItemIcon item={item} />

      {/* Expiry indicator dot */}
      <div
        className="w-2 h-2 rounded-full absolute -top-0.5 right-0"
        style={{ backgroundColor: getExpiryColor(item.days_until_expiry) }}
      />

      {/* Name label */}
      <span className="text-[9px] text-soft-charcoal text-center leading-tight max-w-[55px] truncate">
        {item.name}
      </span>

      {/* Quantity badge */}
      {item.quantity > 1 && (
        <span className="text-[8px] text-gray-400">&times;{item.quantity}</span>
      )}
    </motion.button>
  );
}
