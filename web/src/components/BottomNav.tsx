import { Home, LayoutGrid, Camera, MessageCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/',       icon: Home,          label: 'Dashboard', isScan: false },
  { path: '/pantry', icon: LayoutGrid,    label: 'Pantry',    isScan: false },
  { path: '/scan',   icon: Camera,        label: 'Scan',      isScan: true  },
  { path: '/chat',   icon: MessageCircle, label: 'Chat',      isScan: false },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 bg-white dark:bg-night-base border-t border-border-subtle dark:border-night-border h-16 z-50 grid grid-cols-4"
    >
      {navItems.map(({ path, icon: Icon, label, isScan }) => {
        const isActive = location.pathname === path || (path === '/chat' && location.pathname.startsWith('/chat'));

        if (isScan) {
          // Scan tab: raised pink circle (primary action pattern)
          return (
            <Link
              key={path}
              to={path}
              className="flex flex-col items-center justify-center gap-1 py-2 transition-all active:scale-95"
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="w-12 h-12 -mt-3 rounded-full bg-deep-pink flex items-center justify-center shadow-soft-lg">
                <Icon size={22} strokeWidth={2.5} className="text-white" />
              </div>
              <span className={`text-xs mt-0.5 ${isActive ? 'text-deep-pink font-bold' : 'text-soft-charcoal dark:text-night-secondary opacity-60'}`}>
                {label}
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={path}
            to={path}
            className="flex flex-col items-center justify-center gap-1 py-2 transition-all active:scale-95"
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon
              size={20}
              strokeWidth={isActive ? 2.5 : 2}
              className={isActive ? 'text-deep-pink' : 'text-soft-charcoal dark:text-night-secondary opacity-60'}
            />
            <span className={`text-xs ${isActive ? 'text-deep-pink font-bold' : 'text-soft-charcoal dark:text-night-secondary opacity-60'}`}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
