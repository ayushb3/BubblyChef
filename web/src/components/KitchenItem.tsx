import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { PantryItem } from '../types';

interface KitchenItemProps {
  item: PantryItem;
  position: { top: string; left: string };
  onClick: () => void;
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

const SPRITE_COLS = 12;
const SPRITESHEET_PATH = '/kitchen/items/food-category-spritesheet.png';

const CATEGORY_SPRITE_INDEX: Record<string, number> = {
  produce: 0, dairy: 1, meat: 2, seafood: 3, frozen: 4,
  canned: 5, dry_goods: 6, condiments: 7, beverages: 8,
  snacks: 9, bakery: 10, other: 11,
};

function getSpritePosition(category: string): string {
  const idx = CATEGORY_SPRITE_INDEX[category] ?? 11;
  const pct = (idx / (SPRITE_COLS - 1)) * 100;
  return `${pct}% 50%`;
}

function getExpiryColor(days: number | null): string {
  if (days === null) return '#ccc';
  if (days <= 0) return '#ff6b6b';
  if (days <= 2) return '#ffa94d';
  if (days <= 5) return '#ffd43b';
  return '#69db7c';
}

/** Fetch per-item sprite URL from backend. Returns null if not yet approved. */
function useSpriteUrl(itemName: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const normalized = itemName.toLowerCase().trim();
    const spriteUrl = `/api/sprites/${encodeURIComponent(normalized)}`;

    fetch(spriteUrl, { method: 'HEAD' })
      .then((res) => { if (res.ok) setUrl(spriteUrl); })
      .catch(() => { /* no sprite, use fallback */ });
  }, [itemName]);

  return url;
}

export function KitchenItem({ item, position, onClick }: KitchenItemProps) {
  const emoji = CATEGORY_EMOJI[item.category] ?? CATEGORY_EMOJI.other;
  const [sheetError, setSheetError] = useState(false);
  const spriteUrl = useSpriteUrl(item.name);

  return (
    <motion.button
      className="absolute flex flex-col items-center gap-0.5 cursor-pointer"
      style={{ top: position.top, left: position.left }}
      whileHover={{ scale: 1.15, y: -2 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
    >
      {/* Priority: per-item generated sprite → spritesheet → emoji */}
      {spriteUrl ? (
        <img
          src={spriteUrl}
          alt={item.name}
          className="w-8 h-8 image-pixelated"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : !sheetError ? (
        <div
          className="w-8 h-8 image-pixelated"
          style={{
            backgroundImage: `url(${SPRITESHEET_PATH})`,
            backgroundPosition: getSpritePosition(item.category),
            backgroundSize: `${SPRITE_COLS * 100}% auto`,
            backgroundRepeat: 'no-repeat',
          }}
          role="img"
          aria-label={item.category}
        >
          <img
            src={SPRITESHEET_PATH}
            alt=""
            className="hidden"
            onError={() => setSheetError(true)}
          />
        </div>
      ) : (
        <span className="text-xl leading-none">{emoji}</span>
      )}

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
