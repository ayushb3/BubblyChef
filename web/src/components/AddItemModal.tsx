import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
  useCreatePantryItem,
  useUpdatePantryItem,
  useDeletePantryItem,
} from '../api/client';
import type { PantryItem, Category, Location } from '../types';

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  editItem?: PantryItem | null;
}

const categories: { value: Category; label: string; emoji: string }[] = [
  { value: 'produce', label: 'Produce', emoji: '🥬' },
  { value: 'dairy', label: 'Dairy', emoji: '🥛' },
  { value: 'meat', label: 'Meat', emoji: '🍖' },
  { value: 'seafood', label: 'Seafood', emoji: '🐟' },
  { value: 'frozen', label: 'Frozen', emoji: '❄️' },
  { value: 'dry_goods', label: 'Pantry Staples', emoji: '🏠' },
  { value: 'beverages', label: 'Beverages', emoji: '🥤' },
  { value: 'condiments', label: 'Condiments', emoji: '🧂' },
  { value: 'bakery', label: 'Bakery', emoji: '🥖' },
  { value: 'snacks', label: 'Snacks', emoji: '🍿' },
  { value: 'other', label: 'Other', emoji: '📦' },
];

const locations: { value: Location; label: string; emoji: string }[] = [
  { value: 'fridge', label: 'Fridge', emoji: '🧊' },
  { value: 'freezer', label: 'Freezer', emoji: '❄️' },
  { value: 'pantry', label: 'Pantry', emoji: '🏠' },
  { value: 'counter', label: 'Counter', emoji: '🍎' },
];

const units = [
  'item',
  'lb',
  'oz',
  'g',
  'kg',
  'ml',
  'L',
  'gallon',
  'cup',
  'bunch',
  'package',
];

export function AddItemModal({ isOpen, onClose, editItem }: AddItemModalProps) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('item');
  const [category, setCategory] = useState<Category>('other');
  const [location, setLocation] = useState<Location>('pantry');
  const [expiryDate, setExpiryDate] = useState('');

  const createMutation = useCreatePantryItem();
  const updateMutation = useUpdatePantryItem();
  const deleteMutation = useDeletePantryItem();

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      setQuantity(editItem.quantity.toString());
      setUnit(editItem.unit);
      setCategory(editItem.category);
      setLocation(editItem.location);
      setExpiryDate(
        editItem.expiry_date
          ? new Date(editItem.expiry_date).toISOString().split('T')[0]
          : ''
      );
    } else {
      resetForm();
    }
  }, [editItem, isOpen]);

  const resetForm = () => {
    setName('');
    setQuantity('1');
    setUnit('item');
    setCategory('other');
    setLocation('pantry');
    setExpiryDate('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const itemData = {
      name,
      quantity: parseFloat(quantity) || 1,
      unit,
      category,
      storage_location: location,
      expiry_date: expiryDate || undefined,
    };

    try {
      if (editItem) {
        await updateMutation.mutateAsync({ id: editItem.id, item: itemData });
      } else {
        await createMutation.mutateAsync(itemData);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save item:', error);
    }
  };

  const handleDelete = async () => {
    if (!editItem) return;
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      await deleteMutation.mutateAsync(editItem.id);
      onClose();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg lg:max-w-xl bg-white dark:bg-night-surface rounded-t-3xl sm:rounded-3xl shadow-soft-lg max-h-[90vh] overflow-y-auto">
        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-12 h-1.5 bg-soft-charcoal/20 dark:bg-night-border rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-2xl font-bold text-soft-charcoal dark:text-night-text">
            {editItem ? 'Edit Item' : 'Add Item'} ✨
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-soft-charcoal/5 dark:hover:bg-white/5 rounded-full transition-colors"
          >
            <X size={24} className="text-soft-charcoal/60 dark:text-night-secondary" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
          {/* Item Name */}
          <div>
            <label className="block text-sm font-semibold text-soft-charcoal dark:text-night-text mb-2">
              What did you get? 🛒
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Milk, Chicken breast..."
              required
              className="w-full px-4 py-3 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all dark:bg-night-raised dark:border-night-border dark:text-night-text dark:placeholder-night-secondary"
            />
          </div>

          {/* Quantity & Unit */}
          <div>
            <label className="block text-sm font-semibold text-soft-charcoal dark:text-night-text mb-2">
              How much?
            </label>
            <div className="flex gap-3">
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="0"
                step="0.1"
                className="w-2/5 px-4 py-3 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all dark:bg-night-raised dark:border-night-border dark:text-night-text"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="flex-1 px-4 py-3 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all bg-white dark:bg-night-raised dark:border-night-border dark:text-night-text"
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-soft-charcoal dark:text-night-text mb-2">
              Category 📦
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="w-full px-4 py-3 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all bg-white dark:bg-night-raised dark:border-night-border dark:text-night-text"
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.emoji} {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Storage Location */}
          <div>
            <label className="block text-sm font-semibold text-soft-charcoal dark:text-night-text mb-2">
              Where does it go?
            </label>
            <div className="grid grid-cols-4 gap-2">
              {locations.map((loc) => (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => setLocation(loc.value)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${
                    location === loc.value
                      ? 'bg-pastel-mint text-soft-charcoal shadow-soft dark:bg-deep-mint/30 dark:text-night-text'
                      : 'bg-white border border-pastel-pink/20 text-soft-charcoal/60 hover:border-pastel-pink/40 dark:bg-night-raised dark:border-night-border dark:text-night-secondary dark:hover:border-night-border/80'
                  }`}
                >
                  <span className="text-2xl">{loc.emoji}</span>
                  <span className="text-xs font-semibold">{loc.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Expiry Date */}
          <div>
            <label className="block text-sm font-semibold text-soft-charcoal dark:text-night-text mb-2">
              Best by 📅
            </label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all dark:bg-night-raised dark:border-night-border dark:text-night-text"
            />
            <p className="text-xs text-soft-charcoal/50 dark:text-night-secondary mt-1">
              💡 Leave blank to auto-estimate
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            {editItem && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-6 py-3 text-pastel-coral font-semibold rounded-full hover:bg-pastel-coral/10 transition-all"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-soft-charcoal/60 dark:text-night-secondary font-semibold rounded-full hover:bg-soft-charcoal/5 dark:hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                createMutation.isPending || updateMutation.isPending || !name
              }
              className="flex-1 px-6 py-3 bg-pastel-pink text-white font-semibold rounded-full shadow-soft hover:shadow-soft-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editItem ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
