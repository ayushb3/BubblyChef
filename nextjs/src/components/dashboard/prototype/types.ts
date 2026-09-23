/**
 * PROTOTYPE ONLY (throwaway) — shared prop contract for the three home
 * layout variants (HomeVariantA/B/C). All three variants receive the SAME
 * data HeroHome already fetches; they only differ in how they arrange it.
 */
import type { ComponentType } from 'react'
import type { BubblesState } from '@/components/ui/BubblesMascot'
import type { UnlockedDecoration } from '@/components/kitchen/KitchenScene'
import type { MockMilestoneOption } from './speech'

export interface IconProps {
  size?: number
  weight?: 'fill' | 'regular'
  className?: string
}

export interface QuickAction {
  icon: ComponentType<IconProps>
  label: string
  detail: string
  href: string
  gradient: string
  pending: boolean
}

export interface HomeVariantProps {
  displayName: string
  greeting: string
  emoji: string
  loading: boolean
  totalCount: number
  expiringCount: number
  tip: string
  tipHref: string
  mood: BubblesState
  speechMessage: string
  speechButton: { label: string; href: string }
  kitchen: { unlocked: UnlockedDecoration[]; balance: number | null; loading: boolean }
  showMilestone: boolean
  milestoneOptions: MockMilestoneOption[]
  milestoneThreshold: number | null
  quickActions: QuickAction[]
}
