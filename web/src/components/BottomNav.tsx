import { Home, Package, Camera, Sparkles, User, MessageCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/pantry', icon: Package, label: 'Pantry' },
  { path: '/scan', icon: Camera, label: 'Scan' },
  { path: '/chat', icon: MessageCircle, label: 'Chat' },
  { path: '/recipes', icon: Sparkles, label: 'Recipes' },
  { path: '/profile', icon: User, label: 'Profile' },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-pastel-pink/20 shadow-soft-lg z-50">
      <div className="max-w-lg mx-auto px-4 py-2">
        <div className="flex items-center justify-around">
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-all duration-200 ${
                  isActive
                    ? 'bg-pastel-pink/20 text-pastel-pink'
                    : 'text-soft-charcoal/60 hover:text-soft-charcoal'
                }`}
              >
                <Icon
                  size={24}
                  strokeWidth={isActive ? 2.5 : 2}
                  className="transition-all"
                />
                <span className={`text-xs font-semibold ${isActive ? 'font-bold' : ''}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
