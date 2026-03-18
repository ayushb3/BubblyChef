import { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import type { PantryItem, PantryListResponse, Location } from '../types';
import { useDecorations, updateSlotIndex } from '../api/client';
import { InteriorView } from './InteriorView';

interface DOMKitchenSceneProps {
  items: PantryItem[];
  onItemClick: (item: PantryItem) => void;
}

const ZONE_LABELS: Record<Location, string> = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  pantry: 'Pantry Shelf',
  counter: 'Counter',
};

/** Fallback background colors matching the current palette */
const ZONE_FALLBACK_BG: Record<Location, string> = {
  fridge: '#b5d8eb',
  freezer: '#c9b5e8',
  pantry: '#ffdab3',
  counter: '#d4c4a8',
};

/**
 * Appliance positions as percentages of the 800×520 room.
 * Layout: pantry (back-left near window), fridge+freezer (back-right together),
 * counter (foreground along back wall above floor line).
 */
const APPLIANCE_POSITIONS: Record<Location, CSSProperties> = {
  pantry:  { top: '45%',   left: '18%',   width: '35%',  height: '35%', zIndex: 2 },
  fridge:  { top: '40%',   left: '40%',  width: '40%',  height: '40%', zIndex: 2 },
  freezer: { top: '40%',   left: '58%',  width: '40%',  height: '40%', zIndex: 2 },
  counter: { top: '51%',  left: '25%',   width: '50%',  height: '50%', zIndex: 3 },
};

/** Decoration overlay positions (percentage-based on the 800×520 room) */
const DECORATION_POSITIONS: Record<string, CSSProperties> = {
  flower_pot:  { bottom: '2%', left: '3%',  width: '8%' },
  cactus:      { top: '38%',   left: '54%', width: '6%' },
  herb_garden: { top: '37%',   left: '19%', width: '10%' },
};

const LOCATIONS: Location[] = ['fridge', 'pantry', 'freezer', 'counter'];

export default function DOMKitchenScene({ items, onItemClick }: DOMKitchenSceneProps) {
  const [zoomedZone, setZoomedZone] = useState<Location | null>(null);
  const queryClient = useQueryClient();
  const { data: decorations } = useDecorations();
  const unlockedDecos = decorations?.filter((d) => d.unlocked) ?? [];

  const counts = useMemo(() => {
    const c: Record<Location, number> = { fridge: 0, freezer: 0, pantry: 0, counter: 0 };
    for (const item of items) c[item.location]++;
    return c;
  }, [items]);

  const zoneItems = useMemo(
    () => (zoomedZone ? items.filter((i) => i.location === zoomedZone) : []),
    [items, zoomedZone],
  );

  const handleSlotChange = useCallback(
    async (itemId: string, newSlotIndex: number) => {
      // Optimistic: update React Query cache immediately
      queryClient.setQueryData<PantryListResponse>(['pantry', {}], (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((it) =>
            it.id === itemId ? { ...it, slot_index: newSlotIndex } : it
          ),
        };
      });
      // Persist to backend (non-critical — silently ignore failures)
      try {
        await updateSlotIndex(itemId, newSlotIndex);
      } catch {
        // Position will reset on next reload
      }
    },
    [queryClient],
  );

  return (
    <div className="flex justify-center">
      <div
        className="relative w-full overflow-hidden rounded-2xl"
        style={{
          maxWidth: 800,
          aspectRatio: '800 / 520',
          imageRendering: 'pixelated' as CSSProperties['imageRendering'],
        }}
      >
        <AnimatePresence mode="wait">
          {!zoomedZone ? (
            <motion.div
              key="room"
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Room background: PNG if available, CSS fallback */}
              <RoomBackground />

              {/* Appliance buttons */}
              {LOCATIONS.map((loc) => (
                <ApplianceButton
                  key={loc}
                  location={loc}
                  position={APPLIANCE_POSITIONS[loc]}
                  count={counts[loc]}
                  onClick={() => setZoomedZone(loc)}
                />
              ))}

              {/* Decoration overlays (unlocked milestones) */}
              {unlockedDecos.map((deco) => (
                <img
                  key={deco.name}
                  src={`/kitchen/decorations/${deco.name}.png`}
                  alt={deco.name}
                  className="absolute pointer-events-none z-10"
                  style={{
                    imageRendering: 'pixelated',
                    ...DECORATION_POSITIONS[deco.name],
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ))}
            </motion.div>
          ) : (
            <InteriorView
              key={`interior-${zoomedZone}`}
              location={zoomedZone}
              items={zoneItems}
              onItemClick={onItemClick}
              onBack={() => setZoomedZone(null)}
              onSlotChange={handleSlotChange}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Room background with PNG support and CSS fallback */
function RoomBackground() {
  return (
    <>
      {/* CSS fallback background (always rendered behind) */}
      <div className="absolute inset-0 bg-[#fff9f5]">
        {/* Wall (upper 45%) */}
        <div className="absolute top-0 left-0 right-0 h-[44%] bg-[#fff9f5]">
          {/* Crown molding */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#f0dcc8]" />
          {/* Wainscoting lower half */}
          <div className="absolute bottom-0 left-0 right-0 h-[45%] bg-[#fff0ea]">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#ebd8c8]" />
          </div>
          {/* Window area (decorative) */}
          <div className="absolute top-[15%] left-[26%] w-[10%] h-[55%]">
            <div className="absolute inset-0 bg-[#d5eef8] border-2 border-[#f0dcc8] rounded-sm" />
            {/* Curtain left */}
            <div className="absolute -left-[30%] top-0 w-[30%] h-full bg-[#ffb5c5]/50 rounded-sm" />
            {/* Curtain right */}
            <div className="absolute -right-[30%] top-0 w-[30%] h-full bg-[#ffb5c5]/50 rounded-sm" />
          </div>
          {/* Backsplash */}
          <div className="absolute bottom-0 left-[6%] right-[6%] h-[35%] bg-[#f0e8e0]/60" />
        </div>
        {/* Floor (lower 55%) — checkerboard */}
        <div className="absolute bottom-0 left-0 right-0 h-[56%] bg-[#f5edd9]">
          {/* Baseboard */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#e5cdb5]" />
          {/* Checkerboard pattern via gradient */}
          <div
            className="absolute inset-0 mt-1.5 opacity-30"
            style={{
              backgroundImage: `
                linear-gradient(45deg, #ecdcc3 25%, transparent 25%),
                linear-gradient(-45deg, #ecdcc3 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, #ecdcc3 75%),
                linear-gradient(-45deg, transparent 75%, #ecdcc3 75%)
              `,
              backgroundSize: '32px 32px',
              backgroundPosition: '0 0, 0 16px, 16px -16px, -16px 0px',
            }}
          />
        </div>
      </div>

      {/* PNG room background (layers on top, hides CSS fallback when loaded) */}
      <img
        src="/kitchen/room/background.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover image-pixelated z-0"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </>
  );
}

/** Clickable appliance zone with hover animation */
function ApplianceButton({
  location,
  position,
  count,
  onClick,
}: {
  location: Location;
  position: CSSProperties;
  count: number;
  onClick: () => void;
}) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const [pngLoaded, setPngLoaded] = useState(false);

  const handlePngLoad = useCallback(() => {
    setPngLoaded(true);
    if (fallbackRef.current) fallbackRef.current.style.display = 'none';
  }, []);

  return (
    <motion.button
      className="absolute cursor-pointer"
      style={position}
      whileHover={{ scale: 1.04, filter: 'brightness(1.08)' }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      aria-label={ZONE_LABELS[location]}
    >
      <div className="relative w-full h-full">
        {/* CSS fallback shape (removed from DOM when PNG loads) */}
        <div ref={fallbackRef}>
          <ApplianceFallback location={location} />
        </div>

        {/* PNG sprite */}
        <img
          src={`/kitchen/appliances/${location === 'pantry' ? 'pantry-shelf' : location}.png`}
          alt=""
          className="absolute inset-0 w-full h-full object-contain image-pixelated"
          onLoad={handlePngLoad}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      {/* Item count badge — bottom-right of the visible PNG area */}
      {count > 0 && (
        <span
          className="absolute min-w-[20px] h-5 px-1.5 bg-pastel-coral text-white text-[11px] font-bold rounded-full flex items-center justify-center border border-white/80 z-10"
          style={{
            bottom: pngLoaded ? '2px' : '-6px',
            right: pngLoaded ? '2px' : '-6px',
          }}
        >
          {count}
        </span>
      )}
    </motion.button>
  );
}

/** CSS-drawn fallback appliance shapes when PNGs aren't available */
function ApplianceFallback({ location }: { location: Location }) {
  const bg = ZONE_FALLBACK_BG[location];

  switch (location) {
    case 'fridge':
      return (
        <div className="w-full h-full rounded-md overflow-hidden" style={{ backgroundColor: bg }}>
          {/* 3D side panel */}
          <div className="absolute top-[2%] right-0 w-[8%] h-[98%] bg-black/5" />
          {/* Top freezer compartment */}
          <div className="absolute top-[3%] left-[5%] right-[13%] h-[30%] bg-white/20 rounded-sm border border-white/30">
            {/* Snowflake */}
            <div className="absolute top-1/3 left-1/4 w-2 h-2 text-white/50 text-[8px]">&times;</div>
          </div>
          {/* Divider */}
          <div className="absolute top-[36%] left-[3%] right-[10%] h-[2%] bg-black/10" />
          {/* Main door */}
          <div className="absolute top-[40%] left-[5%] right-[13%] h-[55%] bg-white/15 rounded-sm border border-white/25">
            {/* Handle */}
            <div className="absolute top-[25%] right-[8%] w-1.5 h-5 bg-gray-400/50 rounded-full" />
            {/* Magnets */}
            <div className="absolute top-[8%] left-[12%] w-2.5 h-2.5 rounded-sm bg-pastel-coral/60" />
            <div className="absolute top-[15%] left-[25%] w-2 h-2 rounded-sm bg-pastel-mint/60" />
          </div>
          {/* Feet */}
          <div className="absolute bottom-[-3%] left-[10%] w-[12%] h-[2%] bg-gray-600/30 rounded-sm" />
          <div className="absolute bottom-[-3%] right-[16%] w-[12%] h-[2%] bg-gray-600/30 rounded-sm" />
        </div>
      );

    case 'freezer':
      return (
        <div className="w-full h-full rounded-md overflow-hidden" style={{ backgroundColor: bg }}>
          {/* 3D side panel */}
          <div className="absolute top-[2%] right-0 w-[8%] h-[98%] bg-black/5" />
          {/* Door panel */}
          <div className="absolute top-[3%] left-[5%] right-[13%] h-[93%] bg-white/15 rounded-sm border border-white/25">
            {/* Handle */}
            <div className="absolute top-[40%] right-[8%] w-1.5 h-6 bg-gray-400/50 rounded-full" />
            {/* Frost patches */}
            <div className="absolute top-[5%] left-[8%] w-4 h-1 bg-white/40 rounded-full" />
            <div className="absolute top-[10%] right-[15%] w-3 h-1 bg-white/35 rounded-full" />
            <div className="absolute bottom-[8%] left-[10%] w-5 h-1 bg-white/40 rounded-full" />
          </div>
          {/* LED */}
          <div className="absolute bottom-[15%] left-[15%] w-1 h-1 rounded-full bg-emerald-400" />
          {/* Feet */}
          <div className="absolute bottom-[-3%] left-[10%] w-[12%] h-[2%] bg-gray-600/30 rounded-sm" />
          <div className="absolute bottom-[-3%] right-[16%] w-[12%] h-[2%] bg-gray-600/30 rounded-sm" />
        </div>
      );

    case 'pantry':
      return (
        <div className="w-full h-full" style={{ backgroundColor: '#ffecd0' }}>
          {/* Side frames */}
          <div className="absolute top-0 left-0 w-[4.5%] h-full bg-amber-700/40" />
          <div className="absolute top-0 right-0 w-[4.5%] h-full bg-amber-700/40" />
          {/* Top cap */}
          <div className="absolute top-[-3%] left-[-1%] right-[-1%] h-[4%] bg-amber-700/40 rounded-t-sm" />
          {/* Shelves */}
          {[22, 42, 62, 82].map((top) => (
            <div key={top}>
              <div
                className="absolute left-[3%] right-[3%] h-[4%] bg-amber-600/40 rounded-sm"
                style={{ top: `${top}%` }}
              />
              {/* Shelf shadow */}
              <div
                className="absolute left-[4%] right-[4%] h-[1%] bg-amber-800/10"
                style={{ top: `${top + 4}%` }}
              />
              {/* Decorative silhouettes */}
              <div
                className="absolute h-[10%] bg-amber-700/15 rounded-sm"
                style={{ top: `${top - 12}%`, left: '12%', width: '15%' }}
              />
              <div
                className="absolute h-[8%] bg-amber-700/10 rounded-sm"
                style={{ top: `${top - 10}%`, left: '40%', width: '20%' }}
              />
              <div
                className="absolute h-[9%] bg-amber-700/12 rounded-sm"
                style={{ top: `${top - 11}%`, left: '70%', width: '12%' }}
              />
            </div>
          ))}
        </div>
      );

    case 'counter':
      return (
        <div className="w-full h-full" style={{ backgroundColor: bg }}>
          {/* Countertop surface */}
          <div className="absolute top-0 left-[-0.5%] right-[-0.5%] h-[16%] bg-[#e0d0b8]">
            <div className="absolute top-0 left-0 right-0 h-[25%] bg-white/10" />
          </div>
          {/* Cabinet front */}
          <div className="absolute top-[16%] left-0 right-0 bottom-0 bg-[#c0b090] border-t border-gray-400/20">
            {/* Cabinet doors */}
            {[8, 25, 42, 59, 76].map((left) => (
              <div
                key={left}
                className="absolute top-[10%] h-[80%] w-[15%] bg-[#ccc0a8] rounded-sm border border-[#b8ac94]/30"
                style={{ left: `${left}%` }}
              >
                {/* Knob */}
                <div className="absolute top-[55%] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#b8b0a0]" />
              </div>
            ))}
          </div>
          {/* Fruit bowl decoration */}
          <div className="absolute top-[-20%] left-[10%] flex gap-0.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
            <div className="w-2 h-2 rounded-full bg-green-400/50 mt-0.5" />
            <div className="w-2 h-2 rounded-full bg-yellow-400/50" />
          </div>
        </div>
      );
  }
}
