import { useState } from 'react';
import { usePantryItems } from '../api/client';
import { AddItemModal } from './AddItemModal';
import DOMKitchenScene from './DOMKitchenScene';
import type { PantryItem } from '../types';

export function KitchenView() {
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { data, isLoading } = usePantryItems({});

  const handleItemClick = (item: PantryItem) => {
    setEditingItem(item);
    setIsAddModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingItem(null);
  };

  if (isLoading) {
    return (
      <div className="text-center py-16 text-soft-charcoal/50">
        Loading your kitchen...
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <DOMKitchenScene items={data?.items ?? []} onItemClick={handleItemClick} />
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        editItem={editingItem}
      />
    </div>
  );
}
