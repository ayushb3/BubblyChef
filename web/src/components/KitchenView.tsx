import { useState } from 'react';
import { X } from 'lucide-react';
import { usePantryItems } from '../api/client';
import { AddItemModal } from './AddItemModal';
import { categoryEmojis } from '../constants/categories';
import type { PantryItem, Location } from '../types';

interface ZoneConfig {
  id: Location;
  label: string;
  emoji: string;
  description: string;
  gradient: string;
  accentColor: string;
  borderColor: string;
}

const KITCHEN_ZONES: ZoneConfig[] = [
  {
    id: 'fridge',
    label: 'Fridge',
    emoji: '🧊',
    description: 'Cold storage',
    gradient: 'from-blue-50 to-cyan-50',
    accentColor: 'border-cyan-200',
    borderColor: 'border-cyan-400',
  },
  {
    id: 'freezer',
    label: 'Freezer',
    emoji: '❄️',
    description: 'Deep freeze',
    gradient: 'from-blue-100 to-indigo-50',
    accentColor: 'border-blue-200',
    borderColor: 'border-blue-400',
  },
  {
    id: 'pantry',
    label: 'Pantry',
    emoji: '🏠',
    description: 'Dry goods',
    gradient: 'from-amber-50 to-orange-50',
    accentColor: 'border-amber-200',
    borderColor: 'border-amber-400',
  },
  {
    id: 'counter',
    label: 'Counter',
    emoji: '🍎',
    description: 'Ready to use',
    gradient: 'from-pink-50 to-rose-50',
    accentColor: 'border-pink-200',
    borderColor: 'border-pink-400',
  },
];

function getExpiryDotColor(days: number | null): string {
  if (days === null) return 'bg-gray-300';
  if (days < 0) return 'bg-pastel-coral';
  if (days <= 2) return 'bg-pastel-peach';
  return 'bg-pastel-mint';
}

function MiniItemCard({
  item,
  onClick,
}: {
  item: PantryItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 hover:bg-white transition-all text-left"
      aria-label={`${item.name}, ${item.quantity} ${item.unit}`}
    >
      <span className="text-lg shrink-0">
        {categoryEmojis[item.category] || '📦'}
      </span>
      <span className="text-sm font-semibold text-soft-charcoal truncate flex-1">
        {item.name}
      </span>
      <span
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${getExpiryDotColor(item.days_until_expiry)}`}
        title={
          item.days_until_expiry === null
            ? 'No expiry'
            : item.days_until_expiry < 0
              ? 'Expired'
              : `${item.days_until_expiry} days`
        }
      />
    </button>
  );
}

function ZoneCard({
  zone,
  items,
  onItemClick,
}: {
  zone: ZoneConfig;
  items: PantryItem[];
  onItemClick: (item: PantryItem) => void;
}) {
  return (
    <div
      className={`rounded-2xl border-2 ${zone.accentColor} bg-gradient-to-br ${zone.gradient} p-4 flex flex-col min-h-[200px]`}
      role="region"
      aria-label={`${zone.label}: ${items.length} items`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{zone.emoji}</span>
          <h3 className="font-bold text-soft-charcoal">{zone.label}</h3>
        </div>
        <span className="text-xs font-semibold text-soft-charcoal/50 bg-white/60 px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 max-h-[280px]">
          {items.map((item) => (
            <MiniItemCard
              key={item.id}
              item={item}
              onClick={() => onItemClick(item)}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-soft-charcoal/40">
          <span className="text-4xl mb-1">{zone.emoji}</span>
          <span className="text-sm">No items yet</span>
        </div>
      )}
    </div>
  );
}

function MobileZoneButton({
  zone,
  itemCount,
  isActive,
  onClick,
}: {
  zone: ZoneConfig;
  itemCount: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border-2 p-4 flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
        isActive
          ? `${zone.borderColor} bg-gradient-to-br ${zone.gradient} shadow-soft-lg ring-2 ring-offset-1 ring-pastel-pink/30`
          : `${zone.accentColor} bg-gradient-to-br ${zone.gradient} shadow-soft`
      }`}
      role="button"
      aria-label={`${zone.label}: ${itemCount} items${isActive ? ' (selected)' : ''}`}
      aria-pressed={isActive}
    >
      <span className="text-3xl">{zone.emoji}</span>
      <span className="font-bold text-sm text-soft-charcoal">{zone.label}</span>
      <span className="text-xs text-soft-charcoal/50">{itemCount} items</span>
    </button>
  );
}

export function KitchenView() {
  const [activeZone, setActiveZone] = useState<Location | null>(null);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { data, isLoading } = usePantryItems({});

  const itemsByZone = KITCHEN_ZONES.reduce<Record<Location, PantryItem[]>>(
    (acc, zone) => {
      acc[zone.id] = data?.items.filter((i) => i.location === zone.id) ?? [];
      return acc;
    },
    {} as Record<Location, PantryItem[]>
  );

  const handleEditItem = (item: PantryItem) => {
    setEditingItem(item);
    setIsAddModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingItem(null);
  };

  const handleZoneTap = (zoneId: Location) => {
    setActiveZone((prev) => (prev === zoneId ? null : zoneId));
  };

  if (isLoading) {
    return (
      <div className="text-center py-16 text-soft-charcoal/50">
        Loading your kitchen...
      </div>
    );
  }

  const activeZoneConfig = KITCHEN_ZONES.find((z) => z.id === activeZone);
  const activeZoneItems = activeZone ? itemsByZone[activeZone] : [];

  return (
    <>
      {/* Mobile layout */}
      <div className="lg:hidden space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {KITCHEN_ZONES.map((zone) => (
            <MobileZoneButton
              key={zone.id}
              zone={zone}
              itemCount={itemsByZone[zone.id].length}
              isActive={activeZone === zone.id}
              onClick={() => handleZoneTap(zone.id)}
            />
          ))}
        </div>

        {activeZone && activeZoneConfig && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-soft-charcoal flex items-center gap-2">
                <span>{activeZoneConfig.emoji}</span>
                {activeZoneConfig.label}
                <span className="text-sm font-normal text-soft-charcoal/50">
                  ({activeZoneItems.length})
                </span>
              </h3>
              <button
                onClick={() => setActiveZone(null)}
                className="w-8 h-8 rounded-full bg-white border border-pastel-pink/20 flex items-center justify-center text-soft-charcoal/60 hover:text-soft-charcoal transition-colors"
                aria-label="Close zone view"
              >
                <X size={16} />
              </button>
            </div>

            {activeZoneItems.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {activeZoneItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleEditItem(item)}
                    className="bg-white rounded-2xl p-4 shadow-soft hover:shadow-soft-lg transition-all text-left border-l-4"
                    style={{
                      borderLeftColor:
                        item.category === 'produce'
                          ? '#B5EAD7'
                          : item.category === 'dairy'
                            ? '#FFB5C5'
                            : item.category === 'meat'
                              ? '#FF9AA2'
                              : item.category === 'frozen'
                                ? '#B5D8EB'
                                : '#FFDAB3',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">
                        {categoryEmojis[item.category] || '📦'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-soft-charcoal leading-tight">
                          {item.name}
                        </h4>
                        <p className="text-sm text-soft-charcoal/60">
                          {item.quantity} {item.unit} · {item.category}
                        </p>
                      </div>
                      <span
                        className={`w-3 h-3 rounded-full shrink-0 ${getExpiryDotColor(item.days_until_expiry)}`}
                      />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-soft-charcoal/40">
                <span className="text-4xl block mb-2">
                  {activeZoneConfig.emoji}
                </span>
                <span className="text-sm">No items yet</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop layout */}
      <div className="hidden lg:grid grid-cols-2 gap-4">
        {KITCHEN_ZONES.map((zone) => (
          <ZoneCard
            key={zone.id}
            zone={zone}
            items={itemsByZone[zone.id]}
            onItemClick={handleEditItem}
          />
        ))}
      </div>

      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        editItem={editingItem}
      />
    </>
  );
}
