import { Home, Package, Camera, Sparkles, User, ChefHat } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/pantry', icon: Package, label: 'Pantry' },
  { path: '/scan', icon: Camera, label: 'Scan' },
  { path: '/recipes', icon: Sparkles, label: 'Recipes' },
  { path: '/profile', icon: User, label: 'Profile' },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="hidden lg:flex flex-col w-56 min-h-screen bg-white/95 backdrop-blur-sm border-r border-pastel-pink/20 shadow-soft fixed top-0 left-0 z-40">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-6 border-b border-pastel-pink/10">
        <ChefHat className="text-pastel-pink" size={28} strokeWidth={2.5} />
        <span className="text-xl font-bold text-soft-charcoal">BubblyChef</span>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 p-3 flex-1">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200 ${
                isActive
                  ? 'bg-pastel-pink/20 text-pastel-pink'
                  : 'text-soft-charcoal/60 hover:text-soft-charcoal hover:bg-soft-charcoal/5'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} className="flex-shrink-0" />
              <span className={`text-sm font-semibold ${isActive ? 'font-bold' : ''}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
