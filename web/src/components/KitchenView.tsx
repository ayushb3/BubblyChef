import React, { Suspense, useState } from 'react';
import { usePantryItems } from '../api/client';
import { AddItemModal } from './AddItemModal';
import type { PantryItem } from '../types';

const KitchenScene = React.lazy(() => import('./KitchenScene'));

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
      <Suspense
        fallback={
          <div className="text-center py-16 text-soft-charcoal/50">
            Rendering kitchen...
          </div>
        }
      >
        <KitchenScene
          items={data?.items ?? []}
          onItemClick={handleItemClick}
        />
      </Suspense>
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        editItem={editingItem}
      />
    </div>
  );
}
