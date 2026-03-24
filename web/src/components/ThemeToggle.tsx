// ThemeToggle — reads/writes Zustand theme store + persists to localStorage
import { useEffect } from 'react';
import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'light',
  setTheme: (theme) => {
    set({ theme });
    localStorage.setItem('bubbly-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  },
}));

/** Call once at app root to hydrate theme from localStorage on mount. */
export function useThemeInit() {
  const setTheme = useThemeStore((s) => s.setTheme);
  useEffect(() => {
    const saved = localStorage.getItem('bubbly-theme') as Theme | null;
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
    }
  }, [setTheme]);
}

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="rounded-pill px-3 py-1.5 bg-cream dark:bg-night-surface shadow-soft text-xs font-bold text-soft-charcoal dark:text-night-text transition-all active:scale-95"
    >
      {theme === 'dark' ? '☀️ Day' : '🌙 Night'}
    </button>
  );
}
