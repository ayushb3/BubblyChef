/**
 * PROTOTYPE ONLY (throwaway) — shared mood -> speech-bubble derivation for
 * the three home-layout variants, implementing the draft copy table from
 * issue #593 ("Bubbles' speech bubble should match his mood"). Not used by
 * the default `/` render — HeroHome's existing #347 ordering (suggestion
 * always leads) is untouched there. `?mood=` overrides let every variant be
 * screenshotted in every state without needing real pantry data.
 */
import type { BubblesState } from '@/components/ui/BubblesMascot'
import type { DashboardSuggestion } from '@/lib/api/dashboard'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'
import { titleCase } from '@/lib/format'
import { estimatedExpirySuffix } from '@/lib/pantry-helpers'
import { cookThisHref } from '@/lib/chat-seed'

export interface SpeechResult {
  mood: BubblesState
  message: string
  button: { label: string; href: string }
}

export interface MockMilestoneOption {
  id: string
  name: string
  emoji: string
  slot: string
}

/** Mock "pick 1 of 3" choices for `?milestone=1` when no real offer is pending. */
export const MOCK_MILESTONE_OPTIONS: MockMilestoneOption[] = [
  { id: 'shelf_mugs', name: 'Mug collection', emoji: '☕', slot: 'wall_shelf' },
  { id: 'sill_succulent', name: 'Succulent', emoji: '🪴', slot: 'window_sill' },
  { id: 'counter_fruit_bowl', name: 'Fruit bowl', emoji: '🍎', slot: 'counter_left' },
]

export interface DeriveSpeechArgs {
  totalCount: number
  hasUnusedExpired: boolean
  expiredItem: EnrichedPantryItem | null
  expiredCount: number
  urgentItem: EnrichedPantryItem | null
  expiringCount: number
  suggestion: DashboardSuggestion | null
  /** `?mood=` override — lets the switcher preview every row of the table. */
  moodOverride?: BubblesState | null
}

/**
 * Derives ONE mood, then a message + button that speak for that mood, per
 * the #593 table. Natural (non-overridden) mood mirrors `BubblesMascot`'s
 * own rule (worried > surprised > happy) so the face and bubble can't drift.
 */
export function deriveMoodAndSpeech(args: DeriveSpeechArgs): SpeechResult {
  const {
    totalCount,
    hasUnusedExpired,
    expiredItem,
    expiredCount,
    urgentItem,
    expiringCount,
    suggestion,
    moodOverride,
  } = args

  if (totalCount === 0 && !moodOverride) {
    return {
      mood: 'happy',
      message: "Your pantry is empty — let's stock up!",
      button: { label: 'Scan receipt', href: '/pantry?add=scan' },
    }
  }

  const naturalMood: BubblesState = hasUnusedExpired ? 'worried' : urgentItem ? 'surprised' : 'happy'
  const mood = moodOverride ?? naturalMood

  switch (mood) {
    case 'worried': {
      const item = expiredItem ?? urgentItem
      const name = item ? titleCase(item.name) : 'yogurt'
      const extra = expiredCount > 1 ? ` (and ${expiredCount - 1} more)` : ''
      return {
        mood,
        message: `Oh no, your ${name} went past its date${extra}. Want to clear it out?`,
        button: { label: 'Review pantry', href: '/pantry?filter=expired' },
      }
    }
    case 'surprised': {
      const item = urgentItem
      const name = item ? titleCase(item.name) : 'basil'
      const when = item?.days_until_expiry === 0 ? 'today' : 'tomorrow'
      const suffix = item?.estimated_expiry ? estimatedExpirySuffix(item.estimated_expiry) : ''
      return {
        mood,
        message: `Your ${name} expires ${when}${suffix}! Let's use it.`,
        button: {
          label: 'Find a recipe',
          href: item ? cookThisHref(item.name, item.expiry_date) : '/chat',
        },
      }
    }
    case 'celebrate': {
      return {
        mood,
        message: 'Yay, you hit a new bubbles milestone! Pick something for your kitchen.',
        button: { label: 'Pick a reward', href: '#milestone' },
      }
    }
    case 'happy':
    default: {
      if (suggestion) {
        const mentionsMinutes =
          suggestion.total_time_minutes != null &&
          new RegExp(`\\b${suggestion.total_time_minutes}\\b\\s*min`, 'i').test(suggestion.copy)
        const message = `${suggestion.copy}${
          suggestion.total_time_minutes && !mentionsMinutes ? ` Only ${suggestion.total_time_minutes} min!` : ''
        }`
        return {
          mood: 'happy',
          message,
          button: { label: 'Open recipe', href: `/recipes/${suggestion.recipe_id}` },
        }
      }
      if (expiringCount > 0) {
        return {
          mood: 'happy',
          message: "Check the 'Use Soon' tile — some items need your attention!",
          button: { label: 'View pantry', href: '/pantry' },
        }
      }
      return {
        mood: 'happy',
        message: 'Your kitchen is looking great!',
        button: { label: 'Ask Bubbles', href: '/chat' },
      }
    }
  }
}
