import { useState } from 'react';
import { Plus, Search, Home, LayoutGrid } from 'lucide-react';
import { usePantryItems } from '../api/client';
import { AddItemModal } from '../components/AddItemModal';
import { KitchenView } from '../components/KitchenView';
import { usePantryViewStore } from '../store/pantryViewStore';
import { categoryEmojis } from '../constants/categories';
import type { PantryItem } from '../types';

const locationFilters = [
  { value: '', label: 'All', emoji: '📋' },
  { value: 'fridge', label: 'Fridge', emoji: '🧊' },
  { value: 'freezer', label: 'Freezer', emoji: '❄️' },
  { value: 'pantry', label: 'Pantry', emoji: '🏠' },
  { value: 'counter', label: 'Counter', emoji: '🍎' },
];

export function Pantry() {
  const [selectedLocation, setSelectedLocation] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const { viewMode, setViewMode } = usePantryViewStore();

  const { data, isLoading } = usePantryItems({
    location: selectedLocation || undefined,
    search: searchQuery || undefined,
  });

  const getExpiryBadgeColor = (days: number | null) => {
    if (days === null) return 'bg-gray-100 text-gray-600';
    if (days < 0) return 'bg-pastel-coral text-white';
    if (days <= 2) return 'bg-pastel-peach text-soft-charcoal';
    return 'bg-pastel-mint text-soft-charcoal';
  };

  const getExpiryText = (days: number | null) => {
    if (days === null) return 'No date';
    if (days < 0) return 'Expired';
    if (days === 0) return 'Today!';
    if (days === 1) return 'Tomorrow';
    return `${days} days`;
  };

  const handleEditItem = (item: PantryItem) => {
    setEditingItem(item);
    setIsAddModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingItem(null);
  };

  return (
    <div className="p-4 space-y-4 lg:p-8">
      {/* Header */}
      <div className="pt-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-soft-charcoal flex items-center gap-2">
            My Pantry 🥕
          </h1>
          <p className="text-soft-charcoal/60 text-sm mt-1">
            {data?.total_count || 0} items
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'kitchen' : 'grid')}
            className="w-10 h-10 rounded-full bg-white border border-pastel-pink/20 text-soft-charcoal flex items-center justify-center shadow-soft hover:shadow-soft-lg transition-all active:scale-95"
            aria-label={viewMode === 'grid' ? 'Switch to kitchen view' : 'Switch to grid view'}
          >
            {viewMode === 'grid' ? <Home size={18} /> : <LayoutGrid size={18} />}
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="w-12 h-12 rounded-full bg-pastel-pink text-white flex items-center justify-center shadow-soft hover:shadow-soft-lg transition-all active:scale-95"
          >
            <Plus size={24} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {viewMode === 'kitchen' ? (
        <KitchenView />
      ) : (
        <>
          {/* Search Bar */}
          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-soft-charcoal/40"
              size={20}
            />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-2xl border border-pastel-pink/20 bg-white focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all"
            />
          </div>

          {/* Location Filter Chips */}
          <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
            {locationFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setSelectedLocation(filter.value)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                  selectedLocation === filter.value
                    ? 'bg-pastel-pink text-white shadow-soft'
                    : 'bg-white border border-pastel-pink/20 text-soft-charcoal hover:border-pastel-pink/40'
                }`}
              >
                <span>{filter.emoji}</span>
                <span>{filter.label}</span>
              </button>
            ))}
          </div>

          {/* Items List */}
          {isLoading ? (
            <div className="text-center py-16 text-soft-charcoal/50">
              Loading your pantry...
            </div>
          ) : data && data.items.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
              {data.items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleEditItem(item)}
                  className="bg-white rounded-2xl p-4 shadow-soft hover:shadow-soft-lg transition-all cursor-pointer border-l-4"
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
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <span className="text-3xl">
                        {categoryEmojis[item.category] || '📦'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-soft-charcoal text-lg leading-tight">
                          {item.name}
                        </h3>
                        <p className="text-sm text-soft-charcoal/60 mt-0.5">
                          {item.quantity} {item.unit} · {item.category}
                        </p>
                        <p className="text-xs text-soft-charcoal/40 mt-1 capitalize">
                          {item.location}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${getExpiryBadgeColor(
                        item.days_until_expiry
                      )}`}
                    >
                      {getExpiryText(item.days_until_expiry)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-6xl mb-4">🥺</p>
              <h3 className="text-xl font-bold text-soft-charcoal mb-2">
                Your pantry is empty!
              </h3>
              <p className="text-soft-charcoal/60 mb-6">
                Let's add some yummy ingredients
              </p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-6 py-3 bg-pastel-pink text-white rounded-full font-semibold shadow-soft hover:shadow-soft-lg transition-all active:scale-95"
              >
                Add First Item
              </button>
            </div>
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        editItem={editingItem}
      />
    </div>
  );
}
