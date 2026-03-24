import { useState } from 'react';
import { API_BASE_URL } from '../api/client';
import { categoryEmojis } from '../constants/categories';
import type { PantryItem } from '../types';

/** Show icon for a pantry item. The /api/icons endpoint handles all fallback tiers. */
export function PantryItemIcon({ item }: { item: PantryItem }) {
  const [useEmoji, setUseEmoji] = useState(false);
  const fallback = categoryEmojis[item.category] || '📦';
  const iconUrl = `${API_BASE_URL}/api/icons/${encodeURIComponent(item.name.toLowerCase().trim())}`;

  if (useEmoji) return <span className="text-4xl">{fallback}</span>;
  return (
    <img
      src={iconUrl}
      alt={item.name}
      className="w-10 h-10"
      onError={() => setUseEmoji(true)}
    />
  );
}
