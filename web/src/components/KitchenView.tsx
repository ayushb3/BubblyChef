import React, { Suspense, useState, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { usePantryItems } from '../api/client';
import { AddItemModal } from './AddItemModal';
import type { PantryItem } from '../types';

const KitchenScene = React.lazy(() => import('./KitchenScene'));

class PixiErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('KitchenScene failed to render:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-center py-16 text-soft-charcoal/50">
          <p className="text-4xl mb-3">🍳</p>
          <p className="font-semibold">Kitchen scene couldn't load</p>
          <p className="text-sm mt-1">Try switching to grid view</p>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      <PixiErrorBoundary>
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
      </PixiErrorBoundary>
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        editItem={editingItem}
      />
    </div>
  );
}
