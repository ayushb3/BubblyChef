'use client'

import { useEffect, useState } from 'react'
import BubbleMessage from './BubbleMessage'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'

interface Recipe {
  id: string
  title: string
  total_time_minutes: number | null
}

interface FeedData {
  totalCount: number
  expiringWeekCount: number
  urgentItem: EnrichedPantryItem | null
  recipe: Recipe | null
}

interface BubblesFeedProps {
  displayName: string
}

const tips = [
  "Season your pan, not just your food! Salt and pepper go in during cooking, not just at the end.",
  "Let meat rest after cooking — it redistributes the juices and stays way more tender.",
  "Freeze fresh herbs in olive oil using an ice cube tray. Instant flavor bombs!",
  "Toast your spices in a dry pan for 30 seconds before using. The aroma difference is huge.",
  "Add a splash of pasta water to your sauce — the starch makes it silky and helps it cling.",
  "Store green onions in a glass of water in the fridge. They'll keep growing for weeks!",
  "Taste as you cook! The best chefs adjust seasoning throughout, not just at the end.",
]

function getTimeGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good morning! ☀️'
  if (hour >= 12 && hour < 18) return 'Good afternoon! 🌤️'
  if (hour >= 18 && hour < 22) return 'Good evening! 🌙'
  return 'Still cooking? 🌙'
}

function SkeletonFeed() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading messages">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 items-start">
          <div
            className="flex-shrink-0 w-9 h-9 rounded-full animate-pulse"
            style={{ background: 'var(--color-border)' }}
          />
          <div
            className="flex-1 rounded-2xl rounded-tl-sm animate-pulse"
            style={{
              background: 'var(--color-border)',
              height: i === 0 ? 56 : i === 1 ? 80 : 64,
            }}
          />
        </div>
      ))}
    </div>
  )
}

export default function BubblesFeed({ displayName }: BubblesFeedProps) {
  const [loading, setLoading] = useState(true)
  const [feedData, setFeedData] = useState<FeedData>({
    totalCount: 0,
    expiringWeekCount: 0,
    urgentItem: null,
    recipe: null,
  })
  const [dismissedUrgent, setDismissedUrgent] = useState(false)

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [pantryRes, expiringRes, recipesRes] = await Promise.all([
          fetch('/api/pantry'),
          fetch('/api/pantry/expiring?days=3'),
          fetch('/api/recipes?limit=5'),
        ])

        const [pantryData, expiringData, recipesData] = await Promise.all([
          pantryRes.ok ? pantryRes.json() : { items: [], total_count: 0 },
          expiringRes.ok ? expiringRes.json() : { items: [], count: 0 },
          recipesRes.ok ? recipesRes.json() : { recipes: [], total_count: 0 },
        ])

        const allItems: EnrichedPantryItem[] = pantryData.items ?? []
        const expiringItems: EnrichedPantryItem[] = expiringData.items ?? []
        const recipes: Recipe[] = recipesData.recipes ?? []

        // Find item expiring within 1 day
        const urgentItem =
          expiringItems.find(
            (item) => item.days_until_expiry !== null && item.days_until_expiry <= 1
          ) ?? null

        // Weekly expiring count (within 7 days)
        const expiringWeekCount = allItems.filter(
          (item) => item.is_expiring_soon || (item.days_until_expiry !== null && item.days_until_expiry <= 7)
        ).length

        // Random recipe from the fetched list
        const recipe =
          recipes.length > 0
            ? recipes[Math.floor(Math.random() * recipes.length)]
            : null

        setFeedData({
          totalCount: pantryData.total_count ?? allItems.length,
          expiringWeekCount,
          urgentItem,
          recipe,
        })
      } catch {
        // Silent fail — feed will show with empty data
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [])

  if (loading) {
    return <SkeletonFeed />
  }

  const greeting = getTimeGreeting()
  const tip = tips[new Date().getDay() % tips.length]
  const { totalCount, expiringWeekCount, urgentItem, recipe } = feedData

  const pantryEmoji =
    expiringWeekCount === 0
      ? 'Looking great! 🎉'
      : expiringWeekCount <= 3
        ? 'Not bad! 👍'
        : "Let's use some up! 💪"

  const urgentExpiryLabel =
    urgentItem?.days_until_expiry === 0
      ? 'today'
      : urgentItem?.days_until_expiry === 1
        ? 'tomorrow'
        : 'very soon'

  const delays = [0, 0.15, 0.3, 0.45, 0.6]
  const hasUrgent = Boolean(urgentItem && !dismissedUrgent)

  return (
    <div className="space-y-4">
      {/* Message 1: Greeting — always shown */}
      <BubbleMessage delay={delays[0]} bubbleState="happy">
        <span>
          {greeting} How&apos;s it going,{' '}
          <strong className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            {displayName}
          </strong>
          ?
        </span>
      </BubbleMessage>

      {/* Message 2: Urgent expiry — shown only if within 1 day and not dismissed */}
      {urgentItem && !dismissedUrgent && (
        <BubbleMessage
          delay={delays[1]}
          bubbleState="surprised"
          actions={[{ label: 'Yes please! ✨', href: '/chat?mode=recipe' }]}
          onDismiss={() => setDismissedUrgent(true)}
          dismissLabel="Not now"
        >
          Heads up! Your{' '}
          <strong className="font-semibold">{urgentItem.name}</strong> expires{' '}
          {urgentExpiryLabel}! Want me to find a quick recipe using it?
        </BubbleMessage>
      )}

      {/* Message 3: Pantry summary — always shown */}
      {totalCount === 0 ? (
        <BubbleMessage
          delay={delays[hasUrgent ? 2 : 1]}
          bubbleState="surprised"
          actions={[{ label: 'Scan a receipt 📷', href: '/pantry?add=scan' }]}
        >
          Your pantry is empty! Let&apos;s fix that.
        </BubbleMessage>
      ) : (
        <BubbleMessage
          delay={delays[hasUrgent ? 2 : 1]}
          bubbleState="happy"
        >
          You have{' '}
          <strong className="font-semibold">{totalCount} items</strong> in your pantry and{' '}
          <strong className="font-semibold">{expiringWeekCount}</strong> expiring this week.{' '}
          {pantryEmoji}
        </BubbleMessage>
      )}

      {/* Message 4: Recipe suggestion — shown if recipes exist */}
      {recipe && (
        <BubbleMessage
          delay={delays[Math.min(hasUrgent ? 3 : 2, 4)]}
          bubbleState="happy"
          actions={[
            { label: 'Open recipe 📖', href: '/recipes' },
            { label: 'Something else', href: '/chat?mode=recipe' },
          ]}
        >
          How about <strong className="font-semibold">{recipe.title}</strong> tonight?{' '}
          {recipe.total_time_minutes
            ? `Only ${recipe.total_time_minutes} minutes!`
            : 'Looks delicious!'}
        </BubbleMessage>
      )}

      {/* Message 5: Tip of the day — always shown last */}
      <BubbleMessage
        delay={delays[Math.min(hasUrgent ? 4 : recipe ? 3 : 2, 4)]}
        bubbleState="thinking"
        actions={[{ label: 'Tell me more', href: '/chat' }]}
      >
        💡 <strong className="font-semibold">Tip:</strong> {tip}
      </BubbleMessage>
    </div>
  )
}
