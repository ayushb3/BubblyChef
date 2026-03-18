import { useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import type { PantryItem, Location } from '../types';
import { KitchenItem } from './KitchenItem';

interface InteriorViewProps {
  location: Location;
  items: PantryItem[];
  onItemClick: (item: PantryItem) => void;
  onBack: () => void;
  onSlotChange: (itemId: string, newSlotIndex: number) => void;
}

const ZONE_LABELS: Record<Location, string> = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  pantry: 'Pantry Shelf',
  counter: 'Counter',
};

const ZONE_EMOJIS: Record<Location, string> = {
  fridge: '\u{1F9CA}',
  freezer: '\u2744\uFE0F',
  pantry: '\u{1F3E0}',
  counter: '\u{1F34E}',
};

interface InteriorConfig {
  maxItems: number;
  cols: number;
  rows: number;
  emptyHint: string;
  fallbackBg: string;
  getItemPosition: (idx: number, total: number) => { top: string; left: string };
}

const INTERIOR_CONFIGS: Record<Location, InteriorConfig> = {
  fridge: {
    maxItems: 32,
    cols: 8,
    rows: 4,
    emptyHint: 'Your fridge is empty!\nAdd items to see them here',
    fallbackBg: '#e8f4fa',
    getItemPosition: (idx) => {
      const shelf = Math.floor(idx / 8);
      const col = idx % 8;
      return {
        top: `${18 + shelf * 20}%`,
        left: `${5 + col * 8.5}%`,
      };
    },
  },
  freezer: {
    maxItems: 24,
    cols: 6,
    rows: 4,
    emptyHint: 'Nothing in the freezer\nAdd frozen items to stock up',
    fallbackBg: '#d8e8f5',
    getItemPosition: (idx) => {
      // Top shelf (first 6), then 3 drawers of 6
      if (idx < 6) {
        return { top: '8%', left: `${8 + idx * 13}%` };
      }
      const drawerIdx = idx - 6;
      const drawer = Math.floor(drawerIdx / 6);
      const col = drawerIdx % 6;
      return {
        top: `${30 + drawer * 22}%`,
        left: `${8 + col * 13}%`,
      };
    },
  },
  pantry: {
    maxItems: 40,
    cols: 8,
    rows: 5,
    emptyHint: 'Pantry shelves are bare!\nScan a receipt to fill them',
    fallbackBg: '#fff5e8',
    getItemPosition: (idx) => {
      const shelf = Math.floor(idx / 8);
      const col = idx % 8;
      return {
        top: `${10 + shelf * 17}%`,
        left: `${6 + col * 9}%`,
      };
    },
  },
  counter: {
    maxItems: 24,
    cols: 8,
    rows: 3,
    emptyHint: 'Counter is clear\nItems on the counter show here',
    fallbackBg: '#e8dcc8',
    getItemPosition: (idx) => {
      const col = idx % 8;
      const row = Math.floor(idx / 8);
      // Slight deterministic offset for a natural scattered look
      const ox = ((idx * 7) % 11 - 5) * 0.15;
      const oy = ((idx * 13) % 9 - 4) * 0.15;
      return {
        top: `${18 + row * 25 + oy}%`,
        left: `${6 + col * 10 + ox}%`,
      };
    },
  },
};

export function InteriorView({ location, items, onItemClick, onBack, onSlotChange }: InteriorViewProps) {
  const config = INTERIOR_CONFIGS[location];
  const visibleItems = items.slice(0, config.maxItems);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const itemId = e.dataTransfer.getData('text/plain');
      if (!itemId) return;

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const col = Math.min(Math.floor(relX * config.cols), config.cols - 1);
      const row = Math.min(Math.floor(relY * config.rows), config.rows - 1);
      const newSlotIndex = row * config.cols + col;
      onSlotChange(itemId, newSlotIndex);
    },
    [onSlotChange, config.cols, config.rows],
  );

  return (
    <motion.div
      className="relative w-full h-full overflow-hidden rounded-2xl"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {/* Interior background: PNG if available, fallback to styled div */}
      <img
        src={`/kitchen/interiors/${location}-interior.png`}
        alt=""
        className="absolute inset-0 w-full h-full object-cover image-pixelated"
        onError={(e) => {
          // Hide broken image, fallback bg will show
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      {/* Fallback background (always behind the image) */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: config.fallbackBg, zIndex: -1 }}
      />

      {/* Interior decorative details (CSS-only, per location) */}
      <InteriorDecoration location={location} />

      {/* Items placed on shelves/surfaces — drop zone */}
      <div
        className="absolute inset-0"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {visibleItems.map((item, idx) => (
          <KitchenItem
            key={item.id}
            item={item}
            position={config.getItemPosition(item.slot_index ?? idx, visibleItems.length)}
            onClick={() => onItemClick(item)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', item.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
          />
        ))}
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-400 italic text-sm bg-white/80 px-4 py-2 rounded-xl text-center whitespace-pre-line">
            {config.emptyHint}
          </p>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute top-3 left-3 w-10 h-10 bg-white/85 rounded-xl border border-gray-200/50 flex items-center justify-center hover:bg-white transition-colors cursor-pointer z-10"
      >
        <ArrowLeft size={18} className="text-soft-charcoal" />
      </button>

      {/* Zone title */}
      <div className="absolute top-3.5 left-16 bg-white/85 rounded-lg px-4 py-1.5 z-10">
        <span className="text-sm font-bold text-soft-charcoal">
          {ZONE_EMOJIS[location]} {ZONE_LABELS[location]}
        </span>
      </div>
    </motion.div>
  );
}

/** CSS-only decorative details for each interior type as fallback when no PNG */
function InteriorDecoration({ location }: { location: Location }) {
  switch (location) {
    case 'fridge':
      return (
        <div className="absolute inset-0 pointer-events-none">
          {/* Fridge light at top */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-yellow-100/30 rounded-b-full" />
          {/* Glass shelves */}
          {[18, 35, 53, 72].map((top) => (
            <div
              key={top}
              className="absolute left-[3%] right-[25%] h-[2px] bg-blue-200/60"
              style={{ top: `${top}%` }}
            />
          ))}
          {/* Door shelf divider */}
          <div className="absolute top-[5%] right-0 w-[22%] h-[90%] border-l-2 border-blue-200/40" />
          {/* Seal border */}
          <div className="absolute inset-0 border-4 border-blue-100/40 rounded-2xl" />
        </div>
      );
    case 'freezer':
      return (
        <div className="absolute inset-0 pointer-events-none">
          {/* Top shelf */}
          <div className="absolute top-[20%] left-[4%] right-[4%] h-[2px] bg-blue-200/50" />
          {/* Drawer dividers */}
          {[38, 56, 74].map((top) => (
            <div key={top}>
              <div
                className="absolute left-[4%] right-[4%] h-8 bg-blue-100/20 border border-blue-200/30 rounded"
                style={{ top: `${top}%` }}
              />
              {/* Handle */}
              <div
                className="absolute left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-300/40 rounded"
                style={{ top: `${top + 5}%` }}
              />
            </div>
          ))}
          {/* Frost border */}
          <div className="absolute inset-0 border-4 border-blue-50/50 rounded-2xl" />
          {/* Fog at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-blue-100/20 to-transparent" />
        </div>
      );
    case 'pantry':
      return (
        <div className="absolute inset-0 pointer-events-none">
          {/* Side frames */}
          <div className="absolute top-0 left-0 w-[3%] h-full bg-amber-700/20" />
          <div className="absolute top-0 right-0 w-[3%] h-full bg-amber-700/20" />
          {/* Top cap */}
          <div className="absolute top-0 left-0 right-0 h-[3%] bg-amber-700/20" />
          {/* Shelves */}
          {[16, 33, 50, 67, 84].map((top) => (
            <div key={top}>
              <div
                className="absolute left-[3%] right-[3%] h-2 bg-amber-600/25 rounded-sm"
                style={{ top: `${top}%` }}
              />
              {/* Shelf shadow */}
              <div
                className="absolute left-[4%] right-[4%] h-1 bg-amber-800/10"
                style={{ top: `${top + 1.5}%` }}
              />
            </div>
          ))}
        </div>
      );
    case 'counter':
      return (
        <div className="absolute inset-0 pointer-events-none">
          {/* Wood grain lines */}
          {Array.from({ length: 20 }, (_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 h-[1px] bg-amber-700/8"
              style={{ top: `${5 + i * 5}%` }}
            />
          ))}
          {/* Cutting board area */}
          <div className="absolute top-[5%] right-[5%] w-[25%] h-[28%] bg-amber-500/10 border border-amber-600/15 rounded" />
          {/* Counter edge highlight */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-100/30" />
          {/* Bottom shadow */}
          <div className="absolute bottom-0 left-0 right-0 h-3 bg-amber-900/5" />
        </div>
      );
  }
}
