import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { usePantryItems } from '../api/client';
import { AddItemModal } from '../components/AddItemModal';
import { ExpiryBadge } from '../components/ExpiryBadge';
import { CardSkeleton } from '../components/CardSkeleton';
import { PantryItemIcon } from '../components/PantryItemIcon';
import type { PantryItem } from '../types';

const titleCase = (s: string) => s.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

type LocationFilter = '' | 'fridge' | 'freezer' | 'pantry' | 'counter';

interface FilterChip {
  value: LocationFilter;
  label: string;
  emoji: string;
  unselectedBg: string;
  selectedBg: string;
}

const LOCATION_FILTERS: FilterChip[] = [
  { value: '',        label: 'All Items', emoji: '📋', unselectedBg: 'bg-pastel-pink dark:bg-night-pink',        selectedBg: 'bg-deep-pink' },
  { value: 'fridge',  label: 'Fridge',    emoji: '🧊', unselectedBg: 'bg-pastel-mint dark:bg-night-mint',        selectedBg: 'bg-deep-mint' },
  { value: 'freezer', label: 'Freezer',   emoji: '❄️', unselectedBg: 'bg-pastel-lavender dark:bg-night-lavender',selectedBg: 'bg-deep-lavender' },
  { value: 'pantry',  label: 'Pantry',    emoji: '🏠', unselectedBg: 'bg-pastel-peach dark:bg-night-peach',      selectedBg: 'bg-deep-peach' },
  { value: 'counter', label: 'Counter',   emoji: '🍎', unselectedBg: 'bg-pastel-pink dark:bg-night-pink',        selectedBg: 'bg-deep-pink' },
];

export function Pantry() {
  const [selectedLocation, setSelectedLocation] = useState<LocationFilter>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);

  const { data, isLoading } = usePantryItems({});

  // Client-side filtering
  const allItems = data?.items ?? [];
  const filteredItems = allItems.filter((item) => {
    const matchesLocation = !selectedLocation || item.location === selectedLocation;
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLocation && matchesSearch;
  });

  const handleEditItem = (item: PantryItem) => {
    setEditingItem(item);
    setIsAddModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingItem(null);
  };

  const showEmptySearch = !isLoading && searchQuery && filteredItems.length === 0;
  const showEmptyPantry = !isLoading && !searchQuery && allItems.length === 0;

  return (
    <div className="min-h-screen bg-cream dark:bg-night-base pb-20">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-cream dark:bg-night-base">
        {/* Title row */}
        <div className="flex items-center justify-between px-5 pt-6 pb-3">
          <h1 className="text-display font-extrabold text-deep-pink dark:text-deep-pink">
            My Pantry
          </h1>
          <img
            src="/mascot/bubbles-happy.png"
            alt="Bubbles the chef"
            className="w-8 h-8 rounded-full"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        {/* Search bar */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-soft-charcoal dark:text-night-secondary opacity-50 pointer-events-none" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-pill border border-border-input bg-white dark:bg-night-surface dark:border-night-border dark:text-night-text dark:placeholder-night-secondary shadow-soft focus:outline-none focus:border-deep-pink focus:shadow-soft-lg transition-shadow text-base"
              aria-label="Search pantry items"
            />
          </div>
        </div>

        {/* Filter chips */}
        <div
          className="flex gap-2 overflow-x-auto px-5 pb-4 hide-scrollbar"
          role="group"
          aria-label="Filter by location"
        >
          {LOCATION_FILTERS.map((filter) => {
            const isSelected = selectedLocation === filter.value;
            return (
              <button
                key={filter.value || 'all'}
                onClick={() => setSelectedLocation(filter.value)}
                aria-pressed={isSelected}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-bold whitespace-nowrap transition-all active:scale-95 shadow-soft ${
                  isSelected
                    ? `${filter.selectedBg} text-white shadow-soft-lg`
                    : `${filter.unselectedBg} text-soft-charcoal dark:text-night-text hover:shadow-soft-lg`
                }`}
              >
                <span>{filter.emoji}</span>
                <span>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4"
          aria-busy="true"
          aria-label="Loading pantry items"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : showEmptyPantry ? (
        <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
          <img
            src="/mascot/bubbles-surprised.png"
            alt="Bubbles the chef looking surprised"
            className="w-20 h-20 mb-4"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <h3 className="text-xl font-bold text-soft-charcoal dark:text-night-text mb-2">
            Your pantry is empty!
          </h3>
          <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-70 mb-6">
            Add items to get started.
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-6 py-3 bg-deep-pink text-white rounded-pill font-bold shadow-soft hover:shadow-soft-lg active:scale-95 active:shadow-none transition-all min-h-[44px]"
          >
            Add Item
          </button>
        </div>
      ) : showEmptySearch ? (
        <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
          <img
            src="/mascot/bubbles-surprised.png"
            alt="Bubbles the chef looking surprised"
            className="w-20 h-20 mb-4"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <h3 className="text-xl font-bold text-soft-charcoal dark:text-night-text mb-2">
            No results
          </h3>
          <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-70 mb-6">
            Try a different search term.
          </p>
          <button
            onClick={() => setSearchQuery('')}
            className="px-4 py-2 text-deep-pink font-semibold text-sm rounded-pill hover:bg-pastel-pink dark:hover:bg-night-pink active:scale-95 transition-all"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleEditItem(item)}
              className="bg-white dark:bg-night-surface rounded-2xl shadow-soft hover:shadow-soft-lg transition-shadow p-3 text-left cursor-pointer active:scale-95 relative"
            >
              <div className="flex flex-col items-center text-center gap-2">
                <PantryItemIcon item={item} />
                <span className="text-sm font-bold text-soft-charcoal dark:text-night-text leading-tight line-clamp-2 w-full text-center">
                  {titleCase(item.name)}
                </span>
                <span className="text-xs text-soft-charcoal dark:text-night-secondary opacity-60">
                  {item.quantity} {item.unit.charAt(0).toUpperCase() + item.unit.slice(1)}
                </span>
                <ExpiryBadge daysUntilExpiry={item.days_until_expiry} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setIsAddModalOpen(true)}
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-deep-pink dark:bg-night-pink text-white shadow-soft-lg hover:opacity-90 hover:shadow-soft-xl active:scale-95 active:shadow-soft transition-all flex items-center justify-center z-40 focus-visible:ring-2 focus-visible:ring-deep-pink/50 focus-visible:ring-offset-2"
        aria-label="Add pantry item"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>

      {/* Add/Edit Modal */}
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        editItem={editingItem}
      />
    </div>
  );
}
