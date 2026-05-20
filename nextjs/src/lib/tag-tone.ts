import type { ChipTone } from '@/components/ui/Chip'

interface TagToneEntry {
  tone: ChipTone
  emoji: string
}

const TAG_MAP: Record<string, TagToneEntry> = {
  vegan: { tone: 'fresh', emoji: '🌿' },
  vegetarian: { tone: 'fresh', emoji: '🥗' },
  'gluten-free': { tone: 'fresh', emoji: '🌾' },
  'dairy-free': { tone: 'fresh', emoji: '🥛' },
  spicy: { tone: 'expired', emoji: '🌶️' },
  hot: { tone: 'expired', emoji: '🔥' },
  sweet: { tone: 'primary', emoji: '🍯' },
  dessert: { tone: 'primary', emoji: '🍰' },
  breakfast: { tone: 'expiring', emoji: '🍳' },
  lunch: { tone: 'accent', emoji: '🥪' },
  dinner: { tone: 'accent', emoji: '🍽️' },
  snack: { tone: 'expiring', emoji: '🍿' },
  easy: { tone: 'fresh', emoji: '✨' },
  quick: { tone: 'expiring', emoji: '⚡' },
  comfort: { tone: 'accent', emoji: '🤗' },
  healthy: { tone: 'fresh', emoji: '🥬' },
  italian: { tone: 'expired', emoji: '🍝' },
  mexican: { tone: 'expiring', emoji: '🌮' },
  asian: { tone: 'accent', emoji: '🍜' },
  japanese: { tone: 'primary', emoji: '🍣' },
  chinese: { tone: 'expired', emoji: '🥡' },
  indian: { tone: 'expiring', emoji: '🍛' },
  french: { tone: 'primary', emoji: '🥐' },
}

export function tagToTone(tag: string): TagToneEntry {
  return TAG_MAP[tag.toLowerCase().trim()] ?? { tone: 'muted', emoji: '' }
}
