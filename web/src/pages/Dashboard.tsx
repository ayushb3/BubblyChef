import { Camera, Plus, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useExpiringItems, useRecentActivity } from '../api/client';
import { categoryEmojis } from '../constants/categories';
import { ExpiryBadge } from '../components/ExpiryBadge';
import { ListItemSkeleton } from '../components/Skeleton';
import { ThemeToggle } from '../components/ThemeToggle';

const GREETINGS = {
  morning: [
    'Good morning! ☀️',
    'Rise and shine! 🌅',
    'Morning, chef! 🍳',
    "Good morning! Let's cook something great ✨",
  ],
  afternoon: [
    'Good afternoon! 🌤️',
    'Hey there, hungry? 😋',
    "Afternoon! What's cooking? 🥘",
    'Good afternoon, chef! 👨‍🍳',
  ],
  evening: [
    'Good evening! 🌙',
    'Evening, chef! 🍽️',
    "What's for dinner? 🌟",
    'Good evening! Time to cook 🕯️',
  ],
  night: [
    'Burning the midnight oil? 🌙',
    'Late night snack time? 🦉',
    'Night owl mode 🌙✨',
  ],
} as const;

const getGreetingMessage = (): string => {
  const hour = new Date().getHours();
  const key: keyof typeof GREETINGS =
    hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'night';
  const list = GREETINGS[key];
  const idx = (new Date().getDay() * 3 + hour) % list.length;
  return list[idx];
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

const TIPS = [
  "Use up what you have before it goes bad — every ingredient counts!",
  "Batch cooking on weekends saves time and reduces food waste.",
  "Fresh herbs lose flavour fast — use them in sauces or freeze them.",
  "Got leftover veggies? Toss them into a quick stir-fry or soup.",
  "Check expiry dates before shopping — you may already have what you need.",
];

function TipOfTheDay({ expiringItem, onTryNow }: { expiringItem: string | null; onTryNow: () => void }) {
  const tip = expiringItem
    ? `Got ${expiringItem} expiring soon? Ask Bubbles for a recipe to use it up!`
    : TIPS[new Date().getDay() % TIPS.length];

  return (
    <div className="bg-deep-mint dark:bg-night-raised rounded-2xl p-4 flex items-start justify-between gap-3 lg:col-span-2">
      <div className="flex-1">
        <p className="text-xs font-bold text-white opacity-80 uppercase tracking-wide mb-1">Tip of the Day 💡</p>
        <p className="text-white text-sm font-semibold leading-snug">{tip}</p>
      </div>
      <button
        onClick={onTryNow}
        className="shrink-0 bg-white text-deep-mint text-xs font-bold rounded-pill px-3 py-1.5 active:scale-95 transition-all shadow-soft"
      >
        Try Now
      </button>
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { data: expiringItems, isLoading } = useExpiringItems(7);
  const { data: recentItems, isLoading: isLoadingRecent } = useRecentActivity(5);

  return (
    <div className="min-h-screen bg-cream dark:bg-night-base pb-20 lg:pb-0">

      {/* Mobile header */}
      <header className="lg:hidden pt-4 px-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/mascot/bubbles-happy.png"
            alt="Bubbles the chef"
            className="w-12 h-12 rounded-full"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <div>
            <h1 className="text-display font-extrabold text-soft-charcoal dark:text-night-text leading-tight">
              BubblyChef
            </h1>
            <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-70">
              {getGreetingMessage()}
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      {/* Desktop greeting row */}
      <div className="hidden lg:flex items-center justify-between pt-8 px-8 pb-2">
        <p className="text-xl text-soft-charcoal dark:text-night-text opacity-70">{getGreetingMessage()}</p>
        <ThemeToggle />
      </div>

      {/* Content */}
      <section className="p-4 lg:p-8 space-y-6">

        {/* Desktop: 2-col grid; mobile: single col */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-6 lg:space-y-0">

          {/* Use Soon card */}
          <div className="bg-white dark:bg-night-surface rounded-2xl p-5 shadow-soft">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl" role="img" aria-label="worried face">🥺</span>
                <h2 className="text-xl font-bold text-soft-charcoal dark:text-night-text">Use Soon!</h2>
              </div>
              <button
                onClick={() => navigate('/pantry')}
                className="text-sm text-deep-pink font-semibold active:scale-95 transition-all"
              >
                View All
              </button>
            </div>

            {isLoading ? (
              <div aria-busy="true" className="space-y-1">
                {[0, 1, 2].map((i) => <ListItemSkeleton key={i} />)}
              </div>
            ) : expiringItems && expiringItems.length > 0 ? (
              <div className="space-y-2">
                {expiringItems.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-cream dark:bg-night-raised rounded-xl hover:shadow-soft transition-shadow cursor-pointer"
                    onClick={() => navigate('/pantry')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate('/pantry'); }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl" role="img" aria-label={item.category}>
                        {categoryEmojis[item.category] ?? '📦'}
                      </span>
                      <div>
                        <p className="text-base font-semibold text-soft-charcoal dark:text-night-text">
                          {item.name}
                        </p>
                        <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-70">
                          {item.quantity} {item.unit}
                        </p>
                      </div>
                    </div>
                    <ExpiryBadge daysUntilExpiry={item.days_until_expiry} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-2xl mb-2" role="img" aria-label="sparkles">✨</p>
                <p className="text-base font-semibold text-soft-charcoal dark:text-night-text">All good!</p>
                <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-70">Nothing expiring soon.</p>
              </div>
            )}
          </div>

          {/* Quick Actions card */}
          <div className="bg-white dark:bg-night-surface rounded-2xl p-5 shadow-soft">
            <h2 className="text-xl font-bold text-soft-charcoal dark:text-night-text mb-4">
              Quick Actions
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => navigate('/scan')}
                className="flex flex-col items-center gap-2 p-4 bg-pastel-pink dark:bg-night-pink rounded-2xl hover:shadow-soft transition-all active:scale-95 min-h-[44px]"
              >
                <Camera className="text-deep-pink dark:text-white" size={28} strokeWidth={2} />
                <span className="text-xs font-semibold text-soft-charcoal dark:text-white text-center">
                  Scan Receipt
                </span>
              </button>

              <button
                onClick={() => navigate('/pantry')}
                className="flex flex-col items-center gap-2 p-4 bg-pastel-mint dark:bg-night-mint rounded-2xl hover:shadow-soft transition-all active:scale-95 min-h-[44px]"
              >
                <Plus className="text-deep-mint dark:text-white" size={28} strokeWidth={2} />
                <span className="text-xs font-semibold text-soft-charcoal dark:text-white text-center">
                  Add Item
                </span>
              </button>

              <button
                onClick={() => navigate('/chat?mode=recipe')}
                className="flex flex-col items-center gap-2 p-4 bg-pastel-lavender dark:bg-night-lavender rounded-2xl hover:shadow-soft transition-all active:scale-95 min-h-[44px]"
              >
                <Sparkles className="text-deep-lavender dark:text-white" size={28} strokeWidth={2} />
                <span className="text-xs font-semibold text-soft-charcoal dark:text-white text-center">
                  Get Recipe
                </span>
              </button>
            </div>
          </div>

          {/* Recent Activity card — full width on desktop */}
          <div className="bg-white dark:bg-night-surface rounded-2xl p-5 shadow-soft lg:col-span-2">
            <h2 className="text-xl font-bold text-soft-charcoal dark:text-night-text mb-4">
              Recent Activity
            </h2>

            {isLoadingRecent ? (
              <div aria-busy="true" className="space-y-1">
                {[0, 1, 2].map((i) => <ListItemSkeleton key={i} />)}
              </div>
            ) : recentItems && recentItems.length > 0 ? (
              <div className="space-y-3">
                {recentItems.map((item, idx) => (
                  <div key={item.id}>
                    <div className="flex items-center gap-3">
                      <span className="text-xl" role="img" aria-label={item.category}>
                        {categoryEmojis[item.category] ?? '📦'}
                      </span>
                      <div className="flex-1">
                        <p className="text-base font-semibold text-soft-charcoal dark:text-night-text">
                          Added {item.name}
                        </p>
                        <p className="text-xs text-soft-charcoal dark:text-night-secondary opacity-60">
                          {getRelativeTime(item.added_at)}
                        </p>
                      </div>
                    </div>
                    {idx < recentItems.length - 1 && (
                      <div className="h-px bg-border-subtle dark:bg-night-border mt-3" />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-2xl mb-2" role="img" aria-label="seedling">🌱</p>
                <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-60">
                  No items yet — add something to your pantry!
                </p>
              </div>
            )}
          </div>

          {/* Tip of the Day — full width on desktop */}
          <TipOfTheDay expiringItem={expiringItems?.[0]?.name ?? null} onTryNow={() => navigate('/chat?mode=recipe')} />

        </div>
      </section>
    </div>
  );
}
