import { Home, LayoutGrid, Camera, MessageCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/',       icon: Home,         label: 'Dashboard' },
  { path: '/pantry', icon: LayoutGrid,    label: 'Pantry'    },
  { path: '/scan',   icon: Camera,        label: 'Scan'      },
  { path: '/chat',   icon: MessageCircle, label: 'Chat'      },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="hidden lg:flex flex-col w-60 min-h-screen bg-white dark:bg-night-base border-r border-border-subtle dark:border-night-border fixed top-0 left-0 z-40 p-6">
      {/* Brand */}
      <div className="flex items-center gap-3 mb-8">
        <img
          src="/mascot/bubbles-happy.png"
          alt="Bubbles the chef"
          className="w-10 h-10 rounded-full"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="text-xl font-extrabold text-soft-charcoal dark:text-night-text">BubblyChef</span>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-1" aria-label="Main navigation">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path || (path === '/chat' && location.pathname.startsWith('/chat'));
          return (
            <Link
              key={path}
              to={path}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 active:scale-95 ${
                isActive
                  ? 'bg-pastel-pink text-deep-pink font-bold dark:bg-night-pink dark:text-white'
                  : 'text-soft-charcoal dark:text-night-text hover:bg-cream dark:hover:bg-night-surface'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} className="flex-shrink-0" />
              <span className="text-sm">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
