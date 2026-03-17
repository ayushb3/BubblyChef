import { Camera, Plus, Sparkles, ChefHat } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useExpiringItems, useRecentActivity } from '../api/client';
import { categoryEmojis } from '../constants/categories';

export function Dashboard() {
  const navigate = useNavigate();
  const { data: expiringItems, isLoading } = useExpiringItems(7);
  const { data: recentItems, isLoading: isLoadingRecent } = useRecentActivity(5);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 2) return 'just now';
    if (diffMin < 60) return `${diffMin} minutes ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay} days ago`;
    return date.toLocaleDateString();
  };

  const getExpiryBadgeColor = (days: number | null) => {
    if (days === null) return 'bg-gray-100 text-gray-600';
    if (days < 0) return 'bg-pastel-coral text-white';
    if (days <= 2) return 'bg-pastel-peach text-soft-charcoal';
    return 'bg-pastel-mint text-soft-charcoal';
  };

  const getExpiryText = (days: number | null) => {
    if (days === null) return 'No date';
    if (days < 0) return 'Expired';
    if (days === 0) return 'Today!';
    if (days === 1) return 'Tomorrow';
    return `${days} days`;
  };

  return (
    <div className="p-4 space-y-6 lg:p-8">
      {/* Header — hidden on desktop (sidebar shows brand) */}
      <div className="pt-4 lg:hidden">
        <div className="flex items-center gap-2 mb-2">
          <ChefHat className="text-pastel-pink" size={32} strokeWidth={2.5} />
          <h1 className="text-3xl font-bold text-soft-charcoal">BubblyChef</h1>
        </div>
        <p className="text-soft-charcoal/70 text-lg">
          {getGreeting()}! 🍳
        </p>
      </div>

      {/* Card grid — single col mobile, two col desktop */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-6 lg:space-y-0">

      {/* Desktop greeting (sidebar hides the mobile header) */}
      <div className="hidden lg:block lg:col-span-2 pt-2">
        <p className="text-soft-charcoal/70 text-lg">{getGreeting()}! 🍳</p>
      </div>

      {/* Expiring Soon Card */}
      <div className="bg-white rounded-2xl p-5 shadow-soft">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🥺</span>
          <h2 className="text-xl font-bold text-soft-charcoal">Use Soon!</h2>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-soft-charcoal/50">
            Loading...
          </div>
        ) : expiringItems && expiringItems.length > 0 ? (
          <div className="space-y-3">
            {expiringItems.slice(0, 4).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-cream rounded-xl hover:shadow-soft transition-shadow cursor-pointer"
                onClick={() => navigate('/pantry')}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {categoryEmojis[item.category] || '📦'}
                  </span>
                  <div>
                    <p className="font-semibold text-soft-charcoal">
                      {item.name}
                    </p>
                    <p className="text-sm text-soft-charcoal/60">
                      {item.quantity} {item.unit}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${getExpiryBadgeColor(
                    item.days_until_expiry
                  )}`}
                >
                  {getExpiryText(item.days_until_expiry)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">✨</p>
            <p className="text-soft-charcoal/70">Nothing expiring soon!</p>
          </div>
        )}
      </div>

      {/* Quick Actions Card */}
      <div className="bg-white rounded-2xl p-5 shadow-soft">
        <h2 className="text-xl font-bold text-soft-charcoal mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 lg:grid-cols-3 gap-3">
          <button
            onClick={() => navigate('/scan')}
            className="flex flex-col items-center gap-2 p-4 bg-pastel-pink/20 rounded-2xl hover:bg-pastel-pink/30 transition-colors active:scale-95"
          >
            <Camera className="text-pastel-pink" size={28} strokeWidth={2.5} />
            <span className="text-sm font-semibold text-soft-charcoal text-center">
              Scan Receipt
            </span>
          </button>

          <button
            onClick={() => navigate('/pantry')}
            className="flex flex-col items-center gap-2 p-4 bg-pastel-mint/20 rounded-2xl hover:bg-pastel-mint/30 transition-colors active:scale-95"
          >
            <Plus className="text-pastel-mint" size={28} strokeWidth={2.5} />
            <span className="text-sm font-semibold text-soft-charcoal text-center">
              Add Item
            </span>
          </button>

          <button
            onClick={() => navigate('/recipes')}
            className="flex flex-col items-center gap-2 p-4 bg-pastel-lavender/20 rounded-2xl hover:bg-pastel-lavender/30 transition-colors active:scale-95"
          >
            <Sparkles
              className="text-pastel-lavender"
              size={28}
              strokeWidth={2.5}
            />
            <span className="text-sm font-semibold text-soft-charcoal text-center">
              Get Recipe
            </span>
          </button>
        </div>
      </div>

      {/* Recent Activity Card */}
      <div className="bg-white rounded-2xl p-5 shadow-soft lg:col-span-2">
        <h2 className="text-xl font-bold text-soft-charcoal mb-4">
          Recent Activity
        </h2>
        {isLoadingRecent ? (
          <div className="text-center py-6 text-soft-charcoal/50 text-sm">Loading…</div>
        ) : recentItems && recentItems.length > 0 ? (
          <div className="space-y-3">
            {recentItems.map((item, idx) => (
              <div key={item.id}>
                <div className="flex items-center gap-3 text-soft-charcoal/70">
                  <span className="text-xl">
                    {categoryEmojis[item.category] ?? '📦'}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm">Added {item.name}</p>
                    <p className="text-xs text-soft-charcoal/50">
                      {getRelativeTime(item.added_at)}
                    </p>
                  </div>
                </div>
                {idx < recentItems.length - 1 && (
                  <div className="h-px bg-pastel-pink/10 mt-3" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-2xl mb-2">🌱</p>
            <p className="text-soft-charcoal/60 text-sm">
              No items yet — add something to your pantry!
            </p>
          </div>
        )}
      </div>

      </div>{/* end card grid */}
    </div>
  );
}
