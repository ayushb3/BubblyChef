import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ViewMode = 'grid' | 'kitchen';

interface PantryViewStore {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const usePantryViewStore = create<PantryViewStore>()(
  persist(
    (set) => ({
      viewMode: 'grid',
      setViewMode: (mode) => set({ viewMode: mode }),
    }),
    { name: 'pantry-view-mode' }
  )
);
