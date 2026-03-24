import { ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-cream dark:bg-night-base">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content — offset by sidebar width on desktop, bottom nav height on mobile */}
      <div className="lg:ml-56 pb-20 lg:pb-0">
        <div className="max-w-5xl mx-auto">
          {children}
        </div>
      </div>

      {/* Mobile bottom nav — hidden on desktop */}
      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
